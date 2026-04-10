"""
Migration 040: Add pinned_importance and lifecycle_state to people table.

pinned_importance: When set (1-4), the auto-classifier never overrides this
person's importance. Used for family members and operator-designated contacts
who should maintain a fixed importance regardless of communication volume.

lifecycle_state: Tracks the person's status beyond active/archived.
States: active (default), deceased, archived, merged, blocked.
Deceased people are never nudged for drift or reclassified.

Idempotent: re-running is safe.
"""

DESCRIPTION = "Add pinned_importance and lifecycle_state columns"

import sqlite3
from pathlib import Path

DB_PATH = Path.home() / ".aos" / "data" / "people.db"


def _column_exists(conn: sqlite3.Connection, table: str, column: str) -> bool:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return any(r[1] == column for r in rows)


def check() -> bool:
    if not DB_PATH.exists():
        return True
    conn = sqlite3.connect(str(DB_PATH))
    try:
        return (
            _column_exists(conn, "people", "pinned_importance")
            and _column_exists(conn, "people", "lifecycle_state")
        )
    finally:
        conn.close()


def up() -> bool:
    if not DB_PATH.exists():
        return True
    conn = sqlite3.connect(str(DB_PATH))
    try:
        if not _column_exists(conn, "people", "pinned_importance"):
            conn.execute(
                "ALTER TABLE people ADD COLUMN pinned_importance INTEGER DEFAULT NULL"
            )
        if not _column_exists(conn, "people", "lifecycle_state"):
            conn.execute(
                "ALTER TABLE people ADD COLUMN lifecycle_state TEXT DEFAULT 'active'"
            )
        conn.commit()
        return True
    finally:
        conn.close()
