#!/usr/bin/env python3
"""Unified retroactive extraction pipeline.

Uses the existing channel adapters to extract message history, resolves
senders to person_ids, and writes interaction rows to the People DB.
One pipeline, any adapter. Adding a new channel = zero extraction work.

Usage:
    python3 pipeline.py                    # all adapters, last 365 days
    python3 pipeline.py --days 90          # last 90 days
    python3 pipeline.py --channel imessage # iMessage only
    python3 pipeline.py --dry-run          # show what would be written
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime, timedelta
from pathlib import Path

# People DB access
_PEOPLE_SERVICE = Path.home() / ".aos" / "services" / "people"
sys.path.insert(0, str(_PEOPLE_SERVICE))

import db as people_db

# Adapter access — need both runtime and dev paths for imports
_AOS_ROOT = Path.home() / "aos"
_AOS_DEV = Path.home() / "project" / "aos"
for _p in [str(_AOS_ROOT), str(_AOS_DEV)]:
    if _p not in sys.path:
        sys.path.insert(0, _p)

log = logging.getLogger(__name__)


# ── Resolver cache ───────────────────────────────────────

class ResolverCache:
    """Batch-resolve handles to person_ids with caching.

    Resolves each unique handle once, caches the result for the session.
    Much faster than resolving per-message.
    """

    def __init__(self, conn):
        self._conn = conn
        self._cache: dict[str, str | None] = {}
        self._resolve_fn = None
        self._pushnames: dict[str, str] = {}  # JID → display name
        self._unresolved: list[dict] = []  # tracks unresolved handles for later triage

    def _get_resolver(self):
        """Lazy-load the resolver (it imports db module)."""
        if self._resolve_fn is None:
            from resolver import resolve_contact
            self._resolve_fn = resolve_contact
        return self._resolve_fn

    def _normalize_phone(self, phone: str) -> str:
        """Normalize phone to digits only."""
        import re
        return re.sub(r"[^\d]", "", phone)

    def _try_identifier(self, handle: str) -> str | None:
        """Try direct identifier lookup in person_identifiers table.

        Handles phone numbers (+15551234567), emails, WhatsApp JIDs.
        """
        import re

        # Phone number detection
        clean = handle.strip().replace(" ", "").replace("-", "")
        if re.match(r'^\+?\d{7,15}$', clean):
            normalized = self._normalize_phone(clean)
            # Try exact normalized match
            row = self._conn.execute(
                "SELECT person_id FROM person_identifiers "
                "WHERE normalized = ? OR normalized = ? LIMIT 1",
                (normalized, "+" + normalized),
            ).fetchone()
            if row:
                return row[0]
            # Try suffix match (last 10 digits) for international number variations
            if len(normalized) >= 10:
                suffix = normalized[-10:]
                row = self._conn.execute(
                    "SELECT person_id FROM person_identifiers "
                    "WHERE normalized LIKE ? LIMIT 1",
                    (f"%{suffix}",),
                ).fetchone()
                if row:
                    return row[0]

        # Email detection
        if "@" in handle and "whatsapp" not in handle:
            row = self._conn.execute(
                "SELECT person_id FROM person_identifiers "
                "WHERE LOWER(value) = ? OR LOWER(normalized) = ? LIMIT 1",
                (handle.lower(), handle.lower()),
            ).fetchone()
            if row:
                return row[0]

        # WhatsApp JID (@s.whatsapp.net has phone, @lid doesn't)
        if "@s.whatsapp.net" in handle:
            phone = handle.split("@")[0]
            return self._try_identifier(phone)

        # @lid format — no phone number available, can't resolve by identifier
        # Will fall through to name-based resolver in resolve()
        return None

    def load_pushnames(self):
        """Load WhatsApp pushnames from local database for name-based resolution."""
        wa_db = Path.home() / "Library" / "Group Containers" / \
            "group.net.whatsapp.WhatsApp.shared" / "ChatStorage.sqlite"
        if not wa_db.exists():
            return
        try:
            import sqlite3 as _sql
            conn = _sql.connect(str(wa_db))
            conn.row_factory = lambda c, r: dict(zip([col[0] for col in c.description], r))
            rows = conn.execute(
                "SELECT ZJID, ZPUSHNAME FROM ZWAPROFILEPUSHNAME WHERE ZPUSHNAME IS NOT NULL"
            ).fetchall()
            conn.close()
            for row in rows:
                jid = row.get("ZJID", "")
                name = (row.get("ZPUSHNAME") or "").strip()
                if jid and name:
                    self._pushnames[jid] = name
            log.info(f"  Loaded {len(self._pushnames)} WhatsApp pushnames")
        except Exception as e:
            log.warning(f"  Could not load WhatsApp pushnames: {e}")

    def _create_person_from_pushname(self, jid: str, name: str) -> str | None:
        """Create a new person record from a WhatsApp pushname."""
        if not name or len(name) < 2:
            return None
        # Skip emoji-only names or single characters
        alpha = "".join(c for c in name if c.isalpha() or c.isspace()).strip()
        if len(alpha) < 2:
            return None

        pid = people_db.insert_person(self._conn, name=name, importance=4)
        if pid:
            # Store the JID as an identifier so future extractions resolve immediately
            phone = jid.split("@")[0] if "@" in jid else jid
            people_db.add_identifier(self._conn, pid, type="whatsapp", value=jid, normalized=phone, source="pushname")
            log.info(f"    Created person '{name}' ({pid}) from WhatsApp pushname")
        return pid

    def resolve(self, handle: str) -> str | None:
        """Resolve a handle to a person_id, using cache.

        Tries identifier lookup first (phone/email), then name-based resolver.
        """
        if handle in self._cache:
            return self._cache[handle]

        if not handle or handle == "me":
            self._cache[handle] = None
            return None

        # Try direct identifier lookup first (phone, email, JID)
        pid = self._try_identifier(handle)
        if pid:
            self._cache[handle] = pid
            return pid

        # Fall back to name-based resolver
        resolver = self._get_resolver()
        try:
            result = resolver(handle, conn=self._conn)
            pid = result.get("person_id") if result.get("resolved") else None
            if pid:
                self._cache[handle] = pid
                return pid
        except Exception:
            pass

        # For WhatsApp @lid JIDs, try pushname → name resolver → auto-create
        pushname = self._pushnames.get(handle)
        if pushname and "@lid" in handle:
            # Try matching pushname to existing person by name
            try:
                result = resolver(pushname, conn=self._conn)
                pid = result.get("person_id") if result.get("resolved") else None
                if pid:
                    # Also store the JID as identifier for future fast resolution
                    phone = handle.split("@")[0]
                    people_db.add_identifier(self._conn, pid, type="whatsapp", value=handle, normalized=phone, source="pushname")
                    self._cache[handle] = pid
                    return pid
            except Exception:
                pass

            # No existing person matches — create from pushname
            pid = self._create_person_from_pushname(handle, pushname)
            if pid:
                self._cache[handle] = pid
                return pid

        # Track unresolved for triage
        if handle not in self._cache:
            self._unresolved.append({
                "handle": handle,
                "pushname": pushname,
                "channel": "whatsapp" if "@" in handle and ("lid" in handle or "whatsapp" in handle) else "unknown",
            })

        self._cache[handle] = None
        return None

    @property
    def unresolved_handles(self) -> list[dict]:
        return self._unresolved

    @property
    def stats(self) -> dict:
        total = len(self._cache)
        resolved = sum(1 for v in self._cache.values() if v is not None)
        return {
            "total_handles": total,
            "resolved": resolved,
            "unresolved": total - resolved,
            "pushnames_loaded": len(self._pushnames),
            "created_from_pushname": sum(1 for u in self._unresolved if u.get("pushname")),
        }


# ── Interaction grouping ─────────────────────────────────

def _date_key(dt: datetime) -> str:
    """Calendar date key for grouping: YYYY-MM-DD."""
    return dt.strftime("%Y-%m-%d")


def _nanoid() -> str:
    """Generate a unique interaction ID."""
    import random
    import string
    chars = string.ascii_lowercase + string.digits
    return "ix_" + "".join(random.choices(chars, k=10))


def _group_messages(messages, resolver: ResolverCache) -> dict:
    """Group messages by (person_id, channel, date).

    IMPORTANT: For group chats, only attributes messages to the specific sender,
    not to the conversation partner. This prevents group chat noise from inflating
    individual interaction counts.

    Returns: {(person_id, channel, date_str): {"inbound": N, "outbound": N, "occurred_at": earliest_ts, "is_group": bool}}
    """
    groups: dict[tuple, dict] = {}

    for msg in messages:
        is_group = msg.metadata.get("is_group", False)
        # Also detect groups from conversation_id patterns
        if not is_group:
            conv_id = msg.conversation_id or ""
            is_group = "@g.us" in conv_id or "chat" in conv_id.lower()

        # Resolve sender
        sender = msg.sender
        if msg.from_me:
            if is_group:
                # In a group, outbound goes to the group — skip individual attribution
                # We don't know WHO in the group we're talking to
                continue
            # For DM outbound, resolve the conversation partner
            # iMessage conversation_id is a chat rowid (integer), not a phone/email.
            # Use chat_identifier (phone/email) or handle_id when available.
            handle = (
                msg.metadata.get("chat_identifier")
                or msg.metadata.get("handle_id")
                or msg.conversation_id
            )
            person_id = resolver.resolve(handle)
        else:
            if is_group:
                # In a group, only count messages FROM this specific person
                # Use the actual sender (from_jid), not the group conversation partner
                from_jid = msg.metadata.get("from_jid", "")
                person_id = resolver.resolve(from_jid) if from_jid else resolver.resolve(sender)
            else:
                person_id = resolver.resolve(sender)

        if not person_id:
            continue

        date_str = _date_key(msg.timestamp)
        key = (person_id, msg.channel, date_str)

        if key not in groups:
            groups[key] = {
                "inbound": 0,
                "outbound": 0,
                "occurred_at": msg.timestamp,
                "is_group": is_group,
            }

        if msg.from_me:
            groups[key]["outbound"] += 1
        else:
            groups[key]["inbound"] += 1

        # Track earliest timestamp
        if msg.timestamp < groups[key]["occurred_at"]:
            groups[key]["occurred_at"] = msg.timestamp

    return groups


# ── Deduplication ────────────────────────────────────────

def _interaction_exists(conn, person_id: str, channel: str, occurred_at: int, window_s: int = 86400) -> bool:
    """Check if an interaction already exists within the time window."""
    row = conn.execute(
        "SELECT 1 FROM interactions WHERE person_id = ? AND channel = ? "
        "AND ABS(occurred_at - ?) < ?",
        (person_id, channel, occurred_at, window_s),
    ).fetchone()
    return row is not None


# ── Relationship state computation ───────────────────────

def compute_relationship_state(conn):
    """Recompute relationship_state for all people with interactions."""
    ts = people_db.now_ts()

    # Get all people with interactions
    rows = conn.execute("""
        SELECT
            person_id,
            COUNT(*) as total_interactions,
            MAX(occurred_at) as last_at,
            MIN(occurred_at) as first_at,
            SUM(CASE WHEN occurred_at >= ? THEN 1 ELSE 0 END) as count_7d,
            SUM(CASE WHEN occurred_at >= ? THEN 1 ELSE 0 END) as count_30d,
            SUM(CASE WHEN occurred_at >= ? THEN 1 ELSE 0 END) as count_90d,
            SUM(CASE WHEN occurred_at >= ? THEN msg_count ELSE 0 END) as msgs_30d,
            SUM(CASE WHEN direction = 'outbound' AND occurred_at >= ? THEN msg_count ELSE 0 END) as out_30d,
            SUM(CASE WHEN direction = 'inbound' AND occurred_at >= ? THEN msg_count ELSE 0 END) as in_30d
        FROM interactions
        GROUP BY person_id
    """, (
        ts - 7 * 86400,
        ts - 30 * 86400,
        ts - 90 * 86400,
        ts - 30 * 86400,
        ts - 30 * 86400,
        ts - 30 * 86400,
    )).fetchall()

    updated = 0
    for row in rows:
        pid = row[0]
        total = row[1]
        last_at = row[2]
        first_at = row[3]

        # Compute average days between interactions
        if total > 1 and last_at and first_at:
            span_days = max(1, (last_at - first_at) / 86400)
            avg_days = span_days / total
        else:
            avg_days = None

        # Trajectory — requires bidirectional communication for "growing"
        count_30d = row[5] or 0
        count_90d = row[6] or 0
        outbound_30d = row[8] or 0
        inbound_30d = row[9] or 0
        has_inbound = inbound_30d > 0
        has_outbound = outbound_30d > 0
        bidirectional = has_inbound and has_outbound

        if count_90d == 0:
            trajectory = "dormant"
        elif count_30d == 0:
            trajectory = "drifting"
        elif bidirectional and count_30d > (count_90d / 3) * 1.5:
            # Growing requires: frequency accelerating AND two-way communication
            trajectory = "growing"
        elif bidirectional:
            trajectory = "stable"
        elif has_outbound and not has_inbound:
            # Outbound-only (ordering pizza, messaging businesses) = not a relationship
            trajectory = "stable"
        else:
            trajectory = "stable"

        days_since = int((ts - last_at) / 86400) if last_at else None

        people_db.set_relationship_state(conn, pid,
            last_interaction_at=last_at,
            avg_days_between=avg_days,
            interaction_count_7d=row[4] or 0,
            interaction_count_30d=count_30d,
            interaction_count_90d=count_90d,
            msg_count_30d=row[7] or 0,
            outbound_30d=row[8] or 0,
            inbound_30d=row[9] or 0,
            days_since_contact=days_since,
            trajectory=trajectory,
        )
        updated += 1

    conn.commit()
    return updated


# ── Main pipeline ────────────────────────────────────────

def extract_channel(adapter, days: int, conn, resolver: ResolverCache, dry_run: bool = False) -> dict:
    """Extract history from a single adapter.

    Returns stats dict.
    """
    channel_name = adapter.name
    since = datetime.now() - timedelta(days=days)

    log.info(f"  [{channel_name}] Fetching messages since {since.date()}...")

    if not adapter.is_available():
        log.warning(f"  [{channel_name}] Not available, skipping")
        return {"channel": channel_name, "status": "unavailable", "messages": 0, "interactions": 0}

    try:
        messages = adapter.get_messages(since=since)
    except Exception as e:
        log.error(f"  [{channel_name}] Failed to fetch messages: {e}")
        return {"channel": channel_name, "status": "error", "error": str(e), "messages": 0, "interactions": 0}

    if not messages:
        log.info(f"  [{channel_name}] No messages found")
        return {"channel": channel_name, "status": "ok", "messages": 0, "interactions": 0}

    log.info(f"  [{channel_name}] {len(messages)} messages fetched, grouping...")

    # Group messages
    groups = _group_messages(messages, resolver)

    # Write interactions
    written = 0
    skipped = 0
    for (person_id, channel, date_str), data in groups.items():
        occurred_at = int(data["occurred_at"].timestamp())

        # Deduplicate
        if _interaction_exists(conn, person_id, channel, occurred_at):
            skipped += 1
            continue

        if dry_run:
            written += 1
            continue

        # Determine direction
        if data["inbound"] > 0 and data["outbound"] > 0:
            direction = "both"
        elif data["outbound"] > 0:
            direction = "outbound"
        else:
            direction = "inbound"

        conn.execute(
            "INSERT OR IGNORE INTO interactions "
            "(id, person_id, occurred_at, channel, direction, msg_count, indexed_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (_nanoid(), person_id, occurred_at, channel, direction,
             data["inbound"] + data["outbound"], people_db.now_ts()),
        )
        written += 1

    if not dry_run:
        conn.commit()

    log.info(f"  [{channel_name}] {written} interactions written, {skipped} deduplicated")
    return {
        "channel": channel_name,
        "status": "ok",
        "messages": len(messages),
        "interactions": written,
        "skipped": skipped,
    }


def _classify_unresolved(conn):
    """Classify unresolved handles as person/service/spam/promo.

    Uses name patterns + message count heuristics. Runs after extraction.
    """
    import re

    rows = conn.execute(
        "SELECT handle, display_name, message_count, channel "
        "FROM unresolved_handles WHERE classification = 'unknown'"
    ).fetchall()

    if not rows:
        return

    service_patterns = [
        "shop", "store", "pizza", "food", "delivery", "service",
        "clinic", "hospital", "bank", "insurance", "pharmacy",
        "restaurant", "gym", "salon", "laundry", "repair",
        "uber", "careem", "courier", "taxi", "driver",
        "alert", "notification", "verify", "otp", "code",
        "promo", "offer", "sale", "discount", "deal",
        "noreply", "no-reply", "support", "team", "info@",
    ]

    classified = 0
    for row in rows:
        handle = row["handle"]
        name = (row["display_name"] or "").lower()
        msgs = row["message_count"] or 0

        classification = "person"  # default assumption

        # Phone-number-only name → likely service
        if name and re.match(r'^[\+\d\s\-\(\)]+$', name.strip()):
            classification = "service"
        # Name matches service patterns
        elif any(p in name for p in service_patterns):
            classification = "service"
        # Very low message count + no name → probably spam
        elif not name and msgs <= 1:
            classification = "spam"
        # Name is all caps (common for businesses)
        elif name and name == name.upper() and len(name) > 3:
            classification = "service"

        conn.execute(
            "UPDATE unresolved_handles SET classification = ? WHERE handle = ?",
            (classification, handle),
        )
        classified += 1

    conn.commit()
    if classified:
        log.info(f"  Classified {classified} unresolved handles")


def run_extraction(days: int = 365, channels: list[str] | None = None, dry_run: bool = False) -> dict:
    """Run the full extraction pipeline across all available adapters.

    Args:
        days: How far back to extract (default 365)
        channels: Filter to specific channels (default: all)
        dry_run: Show what would be written without writing

    Returns:
        Summary dict with per-channel stats
    """
    conn = people_db.connect()

    # Ensure unresolved_handles table exists (idempotent)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS unresolved_handles (
            handle TEXT PRIMARY KEY,
            channel TEXT NOT NULL DEFAULT 'unknown',
            display_name TEXT,
            first_seen INTEGER,
            last_seen INTEGER,
            message_count INTEGER DEFAULT 0,
            classification TEXT DEFAULT 'unknown',
            resolved_to TEXT,
            FOREIGN KEY (resolved_to) REFERENCES people(id)
        );
        CREATE INDEX IF NOT EXISTS idx_unresolved_class ON unresolved_handles(classification);
    """)

    resolver = ResolverCache(conn)
    resolver.load_pushnames()

    # Load adapters — registry for live services, plus local history adapters
    adapters = []
    try:
        from core.comms.registry import load_adapters
        adapters = load_adapters()
    except ImportError:
        pass

    # Fallback / additional: load adapters that aren't in the registry
    # Add the AOS root to sys.path so core.comms.* imports work
    _aos_root = str(Path.home() / "aos")
    _aos_dev = str(Path.home() / "project" / "aos")
    for p in [_aos_root, _aos_dev]:
        if p not in sys.path:
            sys.path.insert(0, p)

    _loaded_names = {a.name for a in adapters}
    _extra_adapters = [
        ("core.comms.channels.imessage", "iMessageAdapter"),
        ("core.comms.channels.whatsapp", "WhatsAppAdapter"),
        ("core.comms.channels.whatsapp_local", "WhatsAppLocalAdapter"),
        ("core.comms.channels.telegram", "TelegramAdapter"),
    ]
    for mod_path, cls_name in _extra_adapters:
        try:
            import importlib
            mod = importlib.import_module(mod_path)
            adapter = getattr(mod, cls_name)()
            if adapter.name not in _loaded_names:
                adapters.append(adapter)
                _loaded_names.add(adapter.name)
        except Exception:
            pass

    if channels:
        adapters = [a for a in adapters if a.name in channels]

    if not adapters:
        log.warning("No adapters available")
        return {"status": "no_adapters", "channels": []}

    log.info(f"Extracting {days} days of history from {len(adapters)} channels...")
    if dry_run:
        log.info("  (DRY RUN — no data will be written)")

    results = []
    for adapter in adapters:
        result = extract_channel(adapter, days, conn, resolver, dry_run)
        results.append(result)

    # Compute relationship state from all interactions
    if not dry_run:
        log.info("Recomputing relationship state...")
        state_count = compute_relationship_state(conn)
        log.info(f"  Updated state for {state_count} people")

        # Persist unresolved handles for triage
        ts = people_db.now_ts()
        for uh in resolver.unresolved_handles:
            conn.execute("""
                INSERT INTO unresolved_handles (handle, channel, display_name, first_seen, last_seen, message_count)
                VALUES (?, ?, ?, ?, ?, 1)
                ON CONFLICT(handle) DO UPDATE SET
                    last_seen = ?, message_count = message_count + 1,
                    display_name = COALESCE(excluded.display_name, display_name)
            """, (uh["handle"], uh["channel"], uh.get("pushname"), ts, ts, ts))
        if resolver.unresolved_handles:
            conn.commit()
            log.info(f"  Tracked {len(resolver.unresolved_handles)} unresolved handles")

        # Classify unresolved handles
        _classify_unresolved(conn)
    else:
        state_count = 0

    conn.close()

    # Summary
    total_messages = sum(r.get("messages", 0) for r in results)
    total_interactions = sum(r.get("interactions", 0) for r in results)

    summary = {
        "status": "ok",
        "days": days,
        "dry_run": dry_run,
        "total_messages": total_messages,
        "total_interactions": total_interactions,
        "state_updates": state_count,
        "resolver_stats": resolver.stats,
        "channels": results,
    }

    return summary


# ── CLI ──────────────────────────────────────────────────

def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(message)s",
    )

    parser = argparse.ArgumentParser(description="Retroactive extraction pipeline")
    parser.add_argument("--days", type=int, default=365, help="Days of history to extract (default: 365)")
    parser.add_argument("--channel", type=str, help="Extract from a specific channel only")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be written")
    args = parser.parse_args()

    channels = [args.channel] if args.channel else None
    result = run_extraction(days=args.days, channels=channels, dry_run=args.dry_run)

    # Print summary
    print()
    print("═" * 50)
    print(f"  Extraction Summary {'(DRY RUN)' if result.get('dry_run') else ''}")
    print("═" * 50)
    print(f"  Window:         {result['days']} days")
    print(f"  Messages read:  {result['total_messages']}")
    print(f"  Interactions:   {result['total_interactions']}")
    print(f"  State updates:  {result['state_updates']}")

    rs = result.get("resolver_stats", {})
    print(f"  Handles seen:   {rs.get('total_handles', 0)} ({rs.get('resolved', 0)} resolved)")
    print()

    for ch in result.get("channels", []):
        status = "✅" if ch["status"] == "ok" else "⚠️" if ch["status"] == "unavailable" else "❌"
        print(f"  {status} {ch['channel']:12s}  {ch.get('messages', 0)} msgs → {ch.get('interactions', 0)} interactions")

    print("═" * 50)


if __name__ == "__main__":
    main()
