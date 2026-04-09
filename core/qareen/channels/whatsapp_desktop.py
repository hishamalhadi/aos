"""WhatsApp Desktop ingest — reads ChatStorage.sqlite directly.

On macOS, the WhatsApp Desktop app maintains ChatStorage.sqlite as a
plaintext SQLite database in the group container. This module reads it
directly to ingest full message history (12+ years) and ongoing live
updates into comms.db.

This is the canonical WhatsApp ingest path. It is preferred over the
whatsmeow bridge for reads because:
  - Full historical access (not just from when whatsmeow was linked)
  - Richer metadata (sender JID, attachments, message type, group info)
  - Zero ban risk (read-only, no server interaction)
  - No network dependency
  - WhatsApp Desktop is effectively always running

whatsmeow remains the canonical path for OUTBOUND sends.

Used by:
  - core/bin/cli/import-whatsapp-history  — one-shot backfill CLI
  - qareen lifespan background task       — live watcher (planned)

Data source:
  ~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite

Schema notes (ZWAMESSAGE):
  Z_PK            stable primary key — used for deterministic message IDs
  ZTEXT           message body
  ZMESSAGEDATE    Apple epoch (seconds since 2001-01-01)
  ZISFROMME       1 = outbound, 0 = inbound
  ZFROMJID        actual sender JID (matters in groups)
  ZTOJID          recipient JID
  ZMESSAGETYPE    0=text, 1=image, 2=video, 3=voice, etc.
  ZCHATSESSION    FK to ZWACHATSESSION
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import shutil
import sqlite3
import tempfile
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from qareen.events.bus import EventBus

logger = logging.getLogger(__name__)

# ── Paths ────────────────────────────────────────────────────────────────

CHAT_STORAGE_PATH = (
    Path.home()
    / "Library"
    / "Group Containers"
    / "group.net.whatsapp.WhatsApp.shared"
    / "ChatStorage.sqlite"
)
WA_CONTAINER = CHAT_STORAGE_PATH.parent
COMMS_DB = Path.home() / ".aos" / "data" / "comms.db"
PEOPLE_DB = Path.home() / ".aos" / "data" / "people.db"

# Apple epoch offset: seconds between 1970-01-01 and 2001-01-01
APPLE_EPOCH = 978307200

# ── Message type codes ───────────────────────────────────────────────────

_WA_MEDIA_TYPES = {
    0: "text",
    1: "image",
    2: "video",
    3: "voice",
    5: "location",
    6: "system",
    7: "document",
    8: "voice",
    9: "sticker",
    14: "deleted",
    15: "contact",
}
# System and deleted messages carry no user content; skip them entirely.
_SKIP_TYPES = {"system", "deleted"}


# ── Stats container ──────────────────────────────────────────────────────

@dataclass
class IngestStats:
    total_scanned: int = 0
    inserted: int = 0
    skipped_existing: int = 0
    conversations_created: int = 0
    conversations_updated: int = 0
    person_matches: int = 0
    unresolved_jids: int = 0
    earliest: datetime | None = None
    latest: datetime | None = None
    errors: list[str] = field(default_factory=list)

    def summary(self) -> str:
        lines = [
            f"scanned:     {self.total_scanned:,}",
            f"inserted:    {self.inserted:,}",
            f"duplicates:  {self.skipped_existing:,}",
            f"conversations (new/updated): {self.conversations_created} / {self.conversations_updated}",
            f"person matches: {self.person_matches:,}",
            f"unresolved JIDs: {self.unresolved_jids}",
        ]
        if self.earliest and self.latest:
            lines.append(f"date range:  {self.earliest.date()} → {self.latest.date()}")
        if self.errors:
            lines.append(f"errors:      {len(self.errors)}")
        return "\n".join(lines)


# ── Helpers ──────────────────────────────────────────────────────────────

def is_available() -> bool:
    """Return True if WhatsApp Desktop is installed with a readable DB."""
    return CHAT_STORAGE_PATH.exists()


def _from_apple_ts(ts):
    if ts is None:
        return None
    try:
        return datetime.fromtimestamp(ts + APPLE_EPOCH)
    except (OSError, OverflowError, ValueError):
        return None


def _to_apple_ts(dt: datetime) -> float:
    return dt.timestamp() - APPLE_EPOCH


def _normalize_phone_from_jid(jid: str) -> str | None:
    """Extract a normalized +digits phone from a 1:1 JID.

    WhatsApp JIDs look like `<phone>@s.whatsapp.net`. Groups use `@g.us`
    and have no phone number. Returns `+<digits>` or None.
    """
    if not jid or "@g.us" in jid or "@" not in jid:
        return None
    phone_part = jid.split("@", 1)[0]
    digits = re.sub(r"[^\d]", "", phone_part)
    if len(digits) < 7:
        return None
    return "+" + digits


def _conv_id_for_jid(jid: str) -> str:
    """Deterministic conversation ID from a chat JID."""
    h = hashlib.sha1(jid.encode()).hexdigest()[:12]
    return f"conv_wa_{h}"


def _copy_chat_storage() -> str:
    """Snapshot ChatStorage.sqlite to a temp file to avoid lock contention.

    Also copies the WAL/SHM sidecars so the snapshot is consistent.
    """
    tmp = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
    tmp.close()
    shutil.copy2(str(CHAT_STORAGE_PATH), tmp.name)
    for ext in ("-wal", "-shm"):
        src = Path(str(CHAT_STORAGE_PATH) + ext)
        if src.exists():
            shutil.copy2(str(src), tmp.name + ext)
    return tmp.name


def _cleanup_tmp(path: str) -> None:
    Path(path).unlink(missing_ok=True)
    for ext in ("-wal", "-shm"):
        Path(path + ext).unlink(missing_ok=True)


def _resolve_media_path(local_path: str | None) -> str | None:
    """Resolve ZMEDIALOCALPATH to an absolute on-disk path."""
    if not local_path:
        return None
    # WhatsApp stores media under "Message/Media/..." but the DB column
    # sometimes omits the "Message/" prefix. Try both.
    for prefix in ("Message/", ""):
        full = WA_CONTAINER / prefix / local_path
        if full.exists():
            return str(full)
    return None


# ── Person resolution ────────────────────────────────────────────────────

def _build_jid_person_map(
    jids: set[str],
    people_conn: sqlite3.Connection,
) -> dict[str, str]:
    """Resolve WhatsApp JIDs to person_ids via people.db.

    Two-pass resolution:
      1. Direct wa_jid match (person_identifiers.type='wa_jid')
      2. Phone match for unresolved (JID → +digits → normalized phone)
    """
    mapping: dict[str, str] = {}
    if not jids:
        return mapping

    # Pass 1: direct wa_jid match. Chunk to respect SQLite variable limit.
    jid_list = [j for j in jids if j and j != "me"]
    CHUNK = 500
    for i in range(0, len(jid_list), CHUNK):
        chunk = jid_list[i : i + CHUNK]
        placeholders = ",".join("?" * len(chunk))
        rows = people_conn.execute(
            f"""
            SELECT value, person_id FROM person_identifiers
            WHERE type='wa_jid' AND value IN ({placeholders})
            """,
            tuple(chunk),
        ).fetchall()
        for value, person_id in rows:
            mapping[value] = person_id

    # Pass 2: phone fallback for unresolved 1:1 JIDs
    unresolved = [j for j in jid_list if j not in mapping]
    phone_to_jid: dict[str, str] = {}
    for jid in unresolved:
        phone = _normalize_phone_from_jid(jid)
        if phone:
            phone_to_jid[phone] = jid

    if phone_to_jid:
        phones = list(phone_to_jid.keys())
        for i in range(0, len(phones), CHUNK):
            chunk = phones[i : i + CHUNK]
            placeholders = ",".join("?" * len(chunk))
            rows = people_conn.execute(
                f"""
                SELECT normalized, person_id FROM person_identifiers
                WHERE type='phone' AND normalized IN ({placeholders})
                """,
                tuple(chunk),
            ).fetchall()
            for normalized, person_id in rows:
                jid = phone_to_jid.get(normalized)
                if jid and jid not in mapping:
                    mapping[jid] = person_id

    return mapping


# ── Scan ─────────────────────────────────────────────────────────────────

def scan_messages(
    since: datetime | None = None,
    limit: int | None = None,
) -> list[dict]:
    """Read messages from ChatStorage.sqlite.

    Returns a list of dicts ready for comms.db insertion. The dicts carry
    both persistable columns and internal `_` fields used for conversation
    aggregation and person resolution.
    """
    if not is_available():
        logger.warning("ChatStorage.sqlite not found at %s", CHAT_STORAGE_PATH)
        return []

    tmp_path = _copy_chat_storage()
    try:
        conn = sqlite3.connect(tmp_path)
        conn.row_factory = sqlite3.Row

        query = """
            SELECT
                m.Z_PK,
                m.ZTEXT,
                m.ZMESSAGEDATE,
                m.ZISFROMME,
                m.ZFROMJID,
                m.ZTOJID,
                m.ZMESSAGETYPE,
                c.ZCONTACTJID AS chat_jid,
                c.ZPARTNERNAME,
                c.ZSESSIONTYPE,
                mi.ZMEDIALOCALPATH,
                mi.ZMOVIEDURATION
            FROM ZWAMESSAGE m
            LEFT JOIN ZWACHATSESSION c ON m.ZCHATSESSION = c.Z_PK
            LEFT JOIN ZWAMEDIAITEM mi ON mi.ZMESSAGE = m.Z_PK
        """
        params: list = []
        if since:
            query += " WHERE m.ZMESSAGEDATE >= ?"
            params.append(_to_apple_ts(since))
        query += " ORDER BY m.ZMESSAGEDATE"
        if limit:
            query += f" LIMIT {int(limit)}"

        rows = conn.execute(query, params).fetchall()
        conn.close()
    finally:
        _cleanup_tmp(tmp_path)

    result: list[dict] = []
    for r in rows:
        ts = _from_apple_ts(r["ZMESSAGEDATE"])
        if ts is None:
            continue

        msg_type_int = r["ZMESSAGETYPE"] or 0
        media_type = _WA_MEDIA_TYPES.get(msg_type_int, "unknown")
        if media_type in _SKIP_TYPES:
            continue

        chat_jid = r["chat_jid"] or ""
        if not chat_jid:
            continue

        is_group = "@g.us" in chat_jid
        from_me = bool(r["ZISFROMME"])
        direction = "outbound" if from_me else "inbound"

        # In group chats, ZFROMJID identifies the actual sender.
        # In 1:1 chats, ZFROMJID may be NULL for inbound; fall back to chat_jid.
        if from_me:
            sender_jid = "me"
        else:
            sender_jid = r["ZFROMJID"] or chat_jid

        text = r["ZTEXT"] or ""
        media_path = _resolve_media_path(r["ZMEDIALOCALPATH"])
        has_attachment = 1 if media_type != "text" else 0

        conv_id = _conv_id_for_jid(chat_jid)
        msg_id = f"wa_{r['Z_PK']}"

        channel_meta = {
            "jid": chat_jid,
            "sender_jid": sender_jid,
            "is_group": is_group,
            "partner_name": r["ZPARTNERNAME"],
            "z_pk": r["Z_PK"],
            "media_type": media_type,
        }
        if r["ZMOVIEDURATION"]:
            channel_meta["duration"] = r["ZMOVIEDURATION"]

        result.append(
            {
                "id": msg_id,
                "channel": "whatsapp",
                "direction": direction,
                "sender_id": sender_jid,
                # For outbound, the recipient is the conversation partner
                # (1:1 chat: their JID; group: the group JID). Preserving
                # this is what lets the resolver attach person_id later.
                "recipient_id": chat_jid,
                "content": text,
                "timestamp": ts.isoformat(),
                "has_attachment": has_attachment,
                "attachment_type": media_type if has_attachment else None,
                "attachment_path": media_path,
                "channel_metadata": json.dumps(channel_meta),
                "conversation_id": conv_id,
                # Internal fields consumed by _build_conversations / ingest
                "_chat_jid": chat_jid,
                "_sender_jid": sender_jid,
                "_is_group": is_group,
                "_partner_name": r["ZPARTNERNAME"],
                "_ts": ts,
            }
        )

    return result


# ── Conversation aggregation ─────────────────────────────────────────────

def _build_conversations(messages: list[dict]) -> dict[str, dict]:
    """Aggregate messages into per-chat conversation summaries."""
    convs: dict[str, dict] = {}
    for m in messages:
        cid = m["conversation_id"]
        jid = m["_chat_jid"]
        if cid not in convs:
            convs[cid] = {
                "id": cid,
                "channel": "whatsapp",
                "name": m.get("_partner_name") or jid,
                "jid": jid,
                "is_group": m["_is_group"],
                "last_message_at": m["_ts"],
                "message_count": 0,
            }
        c = convs[cid]
        c["message_count"] += 1
        if m["_ts"] > c["last_message_at"]:
            c["last_message_at"] = m["_ts"]
        # Prefer a real partner name over a bare JID
        if (not c["name"] or c["name"] == jid) and m.get("_partner_name"):
            c["name"] = m["_partner_name"]
    return convs


# ── Ingest pipeline ──────────────────────────────────────────────────────

def ingest(
    since: datetime | None = None,
    limit: int | None = None,
    dry_run: bool = False,
    progress_cb=None,
) -> IngestStats:
    """Full ingest pipeline: scan → resolve → aggregate → persist.

    Idempotent: safe to re-run. Deterministic message IDs (`wa_<z_pk>`)
    combined with SQLite `INSERT OR IGNORE` prevent duplicates.

    Args:
        since:       Only ingest messages newer than this datetime. None = all.
        limit:       Cap scan count (useful for testing).
        dry_run:     Skip the write phase entirely.
        progress_cb: Optional callback(stage: str, current: int, total: int).
    """
    stats = IngestStats()

    if not is_available():
        logger.warning("ChatStorage.sqlite not found at %s", CHAT_STORAGE_PATH)
        return stats

    # ── Phase 1: scan ────────────────────────────────────────────────────
    if progress_cb:
        progress_cb("scanning", 0, 0)
    messages = scan_messages(since=since, limit=limit)
    stats.total_scanned = len(messages)
    if not messages:
        return stats

    stats.earliest = min(m["_ts"] for m in messages)
    stats.latest = max(m["_ts"] for m in messages)

    # ── Phase 2: resolve senders against people.db ───────────────────────
    if progress_cb:
        progress_cb("resolving", 0, stats.total_scanned)

    jid_to_person: dict[str, str] = {}
    if PEOPLE_DB.exists():
        unique_jids: set[str] = set()
        for m in messages:
            if m["_sender_jid"] and m["_sender_jid"] != "me":
                unique_jids.add(m["_sender_jid"])
            if not m["_is_group"]:
                unique_jids.add(m["_chat_jid"])

        people_conn = sqlite3.connect(str(PEOPLE_DB))
        try:
            jid_to_person = _build_jid_person_map(unique_jids, people_conn)
        finally:
            people_conn.close()

        stats.unresolved_jids = len(unique_jids) - len(jid_to_person)

    # ── Phase 3: aggregate conversations ─────────────────────────────────
    conversations = _build_conversations(messages)

    # Attach person_id to 1:1 conversations
    for c in conversations.values():
        if not c["is_group"]:
            pid = jid_to_person.get(c["jid"])
            if pid:
                c["person_id"] = pid

    # Count per-message person matches for the stats line
    stats.person_matches = sum(
        1
        for m in messages
        if (
            m["_sender_jid"] != "me"
            and jid_to_person.get(m["_sender_jid"])
        )
    )

    if dry_run:
        logger.info(
            "Dry run: would persist %d messages across %d conversations",
            stats.total_scanned,
            len(conversations),
        )
        return stats

    # ── Phase 4: persist ─────────────────────────────────────────────────
    if not COMMS_DB.exists():
        raise FileNotFoundError(f"comms.db not found at {COMMS_DB}")

    if progress_cb:
        progress_cb("persisting", 0, stats.total_scanned)

    conn = sqlite3.connect(str(COMMS_DB))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    try:
        # Upsert conversations one by one (O(chats), not O(messages))
        for c in conversations.values():
            existing = conn.execute(
                "SELECT id FROM conversations WHERE id = ?", (c["id"],)
            ).fetchone()
            person_id = c.get("person_id")
            metadata = json.dumps({"jid": c["jid"], "is_group": c["is_group"]})
            last_msg_iso = c["last_message_at"].isoformat()

            if existing:
                conn.execute(
                    """UPDATE conversations SET
                         name = COALESCE(NULLIF(?, ''), name),
                         last_message_at = MAX(COALESCE(last_message_at, ''), ?),
                         message_count = ?,
                         metadata = ?,
                         person_id = COALESCE(person_id, ?)
                       WHERE id = ?""",
                    (
                        c["name"] or "",
                        last_msg_iso,
                        c["message_count"],
                        metadata,
                        person_id,
                        c["id"],
                    ),
                )
                stats.conversations_updated += 1
            else:
                conn.execute(
                    """INSERT INTO conversations
                       (id, channel, person_id, name, status, last_message_at,
                        message_count, unread_count, metadata)
                       VALUES (?, 'whatsapp', ?, ?, 'open', ?, ?, 0, ?)""",
                    (
                        c["id"],
                        person_id,
                        c["name"],
                        last_msg_iso,
                        c["message_count"],
                        metadata,
                    ),
                )
                stats.conversations_created += 1

        # Count pre-existing messages so we can report accurate insert count.
        ids = [m["id"] for m in messages]
        existing_ids: set[str] = set()
        CHUNK = 500
        for i in range(0, len(ids), CHUNK):
            chunk = ids[i : i + CHUNK]
            placeholders = ",".join("?" * len(chunk))
            rows = conn.execute(
                f"SELECT id FROM messages WHERE id IN ({placeholders})",
                chunk,
            ).fetchall()
            existing_ids.update(r[0] for r in rows)
        stats.skipped_existing = len(existing_ids)

        # Batch-insert with OR IGNORE. Deterministic `wa_<z_pk>` IDs
        # guarantee re-runs are idempotent.
        batch = []
        for m in messages:
            if m["_sender_jid"] != "me":
                # Inbound: resolve via the actual sender JID
                person_id = jid_to_person.get(m["_sender_jid"])
            elif not m["_is_group"]:
                # Outbound 1:1: the partner is the chat JID
                person_id = jid_to_person.get(m["_chat_jid"])
            else:
                # Outbound to a group — no single person on the other end
                person_id = None
            batch.append(
                (
                    m["id"],
                    m["channel"],
                    m["direction"],
                    m["sender_id"],
                    m["recipient_id"],
                    m["content"],
                    m["timestamp"],
                    m["has_attachment"],
                    m["attachment_type"],
                    m["attachment_path"],
                    m["channel_metadata"],
                    person_id,
                    m["conversation_id"],
                )
            )

        INSERT_SQL = """
            INSERT OR IGNORE INTO messages
              (id, channel, direction, sender_id, recipient_id,
               content, timestamp, has_attachment, attachment_type,
               attachment_path, channel_metadata, person_id, conversation_id)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        """
        INSERT_CHUNK = 500
        for i in range(0, len(batch), INSERT_CHUNK):
            conn.executemany(INSERT_SQL, batch[i : i + INSERT_CHUNK])
            if progress_cb:
                progress_cb(
                    "persisting",
                    min(i + INSERT_CHUNK, len(batch)),
                    len(batch),
                )

        conn.commit()
        stats.inserted = stats.total_scanned - stats.skipped_existing
    except Exception as e:
        conn.rollback()
        stats.errors.append(str(e))
        logger.exception("WhatsApp ingest failed")
        raise
    finally:
        conn.close()

    return stats


# ── Live watcher (qareen background task) ───────────────────────────────

# Watcher polls the WAL file's mtime to detect changes. WhatsApp writes
# to ChatStorage every time a message arrives, so mtime is a reliable
# change signal without opening the DB on every tick.
_DEFAULT_POLL_INTERVAL = 5.0  # seconds
# Overlap window: re-scan this far back on each tick to catch messages
# that landed just before our last checkpoint (clock skew, WAL flush
# timing). Dedup via deterministic IDs makes this free.
_OVERLAP_SECONDS = 10


def _wal_path() -> Path:
    return Path(str(CHAT_STORAGE_PATH) + "-wal")


def _get_mtime() -> float:
    """Return the mtime of the WAL file, falling back to the main DB."""
    try:
        wal = _wal_path()
        if wal.exists():
            return os.path.getmtime(wal)
        if CHAT_STORAGE_PATH.exists():
            return os.path.getmtime(CHAT_STORAGE_PATH)
    except OSError:
        pass
    return 0.0


async def _watch_loop(
    bus: "EventBus | None",
    poll_interval: float,
) -> None:
    """Background loop: detect ChatStorage changes, ingest new messages.

    Emits `message.received` on the EventBus for each newly-persisted
    inbound message, so downstream pipelines (intelligence engine, triage,
    notifications) can react in real time.
    """
    if not is_available():
        logger.info("WhatsApp Desktop not installed — watcher inactive")
        return

    last_mtime = _get_mtime()
    # Start checkpoint at "now" — historical messages are handled by the
    # backfill CLI, not the live watcher.
    last_checkpoint = datetime.now() - timedelta(seconds=_OVERLAP_SECONDS)

    logger.info(
        "WhatsApp desktop watcher started (poll=%.1fs, source=%s)",
        poll_interval,
        CHAT_STORAGE_PATH,
    )

    while True:
        try:
            await asyncio.sleep(poll_interval)

            current_mtime = _get_mtime()
            if current_mtime <= last_mtime:
                continue
            last_mtime = current_mtime

            # Run the blocking ingest in a thread so we don't stall the
            # event loop. Small cutoff windows (seconds of new data) are
            # fast regardless.
            since = last_checkpoint - timedelta(seconds=_OVERLAP_SECONDS)
            stats = await asyncio.to_thread(ingest, since=since)

            if stats.inserted > 0:
                logger.info(
                    "WhatsApp watcher: %d new message(s) ingested (convs %d/%d)",
                    stats.inserted,
                    stats.conversations_created,
                    stats.conversations_updated,
                )

                # Advance checkpoint to the latest scanned message
                if stats.latest:
                    last_checkpoint = stats.latest

                # Emit events for downstream pipelines. Only inbound —
                # outbound messages represent operator actions which will
                # have been triggered from the UI already.
                if bus is not None and stats.inserted > 0:
                    try:
                        from qareen.events.types import Event

                        await bus.emit(
                            Event(
                                event_type="message.received",
                                source="whatsapp_desktop",
                                payload={
                                    "channel": "whatsapp",
                                    "count": stats.inserted,
                                    "earliest": (
                                        stats.earliest.isoformat()
                                        if stats.earliest
                                        else None
                                    ),
                                    "latest": (
                                        stats.latest.isoformat()
                                        if stats.latest
                                        else None
                                    ),
                                },
                            )
                        )
                    except Exception:
                        logger.debug(
                            "Failed to emit message.received event",
                            exc_info=True,
                        )
        except asyncio.CancelledError:
            logger.info("WhatsApp desktop watcher cancelled")
            raise
        except Exception:
            logger.exception("WhatsApp desktop watcher error — continuing")
            # Don't tight-loop on persistent errors
            await asyncio.sleep(poll_interval)


async def start_desktop_watcher(
    bus: "EventBus | None" = None,
    poll_interval: float = _DEFAULT_POLL_INTERVAL,
) -> asyncio.Task | None:
    """Start the WhatsApp Desktop watcher as a qareen background task.

    Returns the task handle so the lifespan shutdown can cancel it.
    Returns None if WhatsApp Desktop is not installed on this machine.
    """
    if not is_available():
        logger.info(
            "WhatsApp Desktop not installed — watcher not started"
        )
        return None

    task = asyncio.create_task(_watch_loop(bus, poll_interval))
    logger.info("WhatsApp desktop watcher task started")
    return task
