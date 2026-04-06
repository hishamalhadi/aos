"""iMessage source connector.

Extracts contact identity claims from the iMessage database. Each
unique handle (phone or email) that has sent or received messages
becomes a RawClaim.

Database location: ~/Library/Messages/chat.db
Requires Full Disk Access for the running process.

This is DIFFERENT from the iMessage ChannelAdapter (which reads messages).
This connector extracts CONTACT identity claims for the People Ontology.
"""

from __future__ import annotations

import logging
import re
import shutil
import sqlite3
import tempfile
from pathlib import Path

from .base import RawClaim, SourceConnector

log = logging.getLogger(__name__)

CHAT_DB_PATH = Path.home() / "Library" / "Messages" / "chat.db"


def _copy_db(path: Path) -> str | None:
    """Copy SQLite database (plus WAL/SHM) to a temp file."""
    if not path.exists():
        return None
    try:
        tmp = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
        tmp.close()
        shutil.copy2(path, tmp.name)
        for ext in ["-wal", "-shm"]:
            wal = path.parent / (path.name + ext)
            if wal.exists():
                shutil.copy2(wal, tmp.name + ext)
        return tmp.name
    except (PermissionError, OSError) as e:
        log.warning("Failed to copy iMessage DB: %s", e)
        return None


def _normalize_phone(phone: str) -> str:
    """Normalize phone to digits with leading +."""
    digits = re.sub(r"[^\d+]", "", phone)
    if not digits.startswith("+"):
        digits = "+" + digits
    return digits


def _is_phone(handle: str) -> bool:
    """Check if a handle looks like a phone number."""
    cleaned = handle.replace(" ", "").replace("-", "").replace("(", "").replace(")", "")
    return bool(re.match(r"^\+?\d{7,15}$", cleaned))


def _is_email(handle: str) -> bool:
    """Check if a handle looks like an email address."""
    return "@" in handle and "." in handle


class iMessageConnector(SourceConnector):
    """Source connector for iMessage contact data.

    Priority 50: iMessage handles are reliable identifiers (phone/email)
    but carry no name information. The value is in linking identifiers
    to activity patterns.
    """

    name = "imessage"
    display_name = "iMessage"
    priority = 50

    def __init__(self, db_path: Path = CHAT_DB_PATH):
        self.db_path = db_path

    def is_available(self) -> bool:
        if not self.db_path.exists():
            return False
        # Verify we can actually read it (Full Disk Access check)
        try:
            tmp_path = _copy_db(self.db_path)
            if tmp_path:
                Path(tmp_path).unlink(missing_ok=True)
                for ext in ["-wal", "-shm"]:
                    Path(tmp_path + ext).unlink(missing_ok=True)
                return True
        except Exception:
            pass
        return False

    def scan(self) -> list[RawClaim]:
        tmp_path = _copy_db(self.db_path)
        if not tmp_path:
            log.info("iMessage database not available")
            return []

        claims: list[RawClaim] = []
        seen_handles: set[str] = set()

        try:
            conn = sqlite3.connect(tmp_path)
            conn.row_factory = sqlite3.Row

            # Read all handles. Each handle is a unique phone or email
            # that has participated in iMessage/SMS conversations.
            handles = conn.execute("""
                SELECT
                    h.ROWID,
                    h.id,
                    h.uncanonicalized_id,
                    h.service
                FROM handle h
            """).fetchall()

            # Build a set of active handle ROWIDs -- handles that have
            # actually sent or received messages. This filters out stale
            # entries that may exist from old syncs.
            active_handle_ids: set[int] = set()
            try:
                active_rows = conn.execute("""
                    SELECT DISTINCT handle_id
                    FROM message
                    WHERE handle_id IS NOT NULL
                """).fetchall()
                active_handle_ids = {r["handle_id"] for r in active_rows}
            except sqlite3.OperationalError:
                # If query fails, consider all handles active
                active_handle_ids = {h["ROWID"] for h in handles}

            # Also get message counts per handle for metadata
            handle_msg_counts: dict[int, int] = {}
            try:
                count_rows = conn.execute("""
                    SELECT handle_id, COUNT(*) as cnt
                    FROM message
                    WHERE handle_id IS NOT NULL
                    GROUP BY handle_id
                """).fetchall()
                handle_msg_counts = {r["handle_id"]: r["cnt"] for r in count_rows}
            except sqlite3.OperationalError:
                pass

            for h in handles:
                rowid = h["ROWID"]
                handle_id = (h["id"] or "").strip()
                raw_id = (h["uncanonicalized_id"] or handle_id).strip()
                service = h["service"] or "iMessage"

                if not handle_id or handle_id in seen_handles:
                    continue

                # Skip handles with no message activity
                if active_handle_ids and rowid not in active_handle_ids:
                    continue

                seen_handles.add(handle_id)

                # Classify handle as phone or email
                phones: list[str] = []
                emails: list[str] = []

                if _is_phone(handle_id):
                    phones.append(_normalize_phone(handle_id))
                elif _is_email(handle_id):
                    emails.append(handle_id.lower().strip())
                else:
                    # Unknown format -- store in metadata, still create claim
                    pass

                msg_count = handle_msg_counts.get(rowid, 0)

                claim = RawClaim(
                    source="imessage",
                    source_id=str(rowid),
                    name=None,  # iMessage doesn't store contact names
                    phones=phones,
                    emails=emails,
                    metadata={
                        "service": service,
                        "handle_raw": raw_id,
                        "message_count": msg_count,
                    },
                    raw={
                        "rowid": rowid,
                        "handle_id": handle_id,
                        "uncanonicalized_id": raw_id,
                    },
                )
                claims.append(claim)

            conn.close()
        except sqlite3.Error as e:
            log.error("Failed to read iMessage database: %s", e)
        finally:
            Path(tmp_path).unlink(missing_ok=True)
            for ext in ["-wal", "-shm"]:
                Path(tmp_path + ext).unlink(missing_ok=True)

        log.info("iMessage: scanned %d handles", len(claims))
        return claims
