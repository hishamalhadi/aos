"""
Migration 042: Create WhatsApp LID cache table.

WhatsApp group members use Linked Device IDs (LIDs) instead of phone-based
JIDs. The whatsmeow bridge can resolve LID→JID, but this requires the bridge
to be running. The cache persists these mappings so resolution works even
when the bridge is temporarily down.

Idempotent: re-running is safe.
"""

DESCRIPTION = "Create wa_lid_cache table for WhatsApp LID-to-JID mapping"

import sqlite3
from pathlib import Path

DB_PATH = Path.home() / ".aos" / "data" / "people.db"


def check() -> bool:
    if not DB_PATH.exists():
        return True
    conn = sqlite3.connect(str(DB_PATH))
    try:
        tables = [r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()]
        return "wa_lid_cache" in tables
    finally:
        conn.close()


def up() -> bool:
    if not DB_PATH.exists():
        return True
    conn = sqlite3.connect(str(DB_PATH))
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS wa_lid_cache (
                lid TEXT PRIMARY KEY,
                jid TEXT NOT NULL,
                cached_at INTEGER NOT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_lid_jid ON wa_lid_cache(jid)")
        conn.commit()
        return True
    finally:
        conn.close()
