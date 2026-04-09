"""
Migration 038: operator self-identity in people.db.

Adds a `people.is_self` column to mark the operator's own person row.
This is what lets every other table answer "who is the operator?" with
a single SQL query — currently the answer lives only in
~/.aos/config/operator.yaml as a name string with no FK.

Schema change is one boolean column (default 0). This migration does
NOT pick which row is the operator — that's an instance-specific data
fix done by `core/bin/internal/operator-link` (separate tool).

Idempotent: re-running is safe. Early-returns if people.db missing.
"""

DESCRIPTION = "Add people.is_self column for operator identity"

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
        return _column_exists(conn, "people", "is_self")
    finally:
        conn.close()


def up() -> bool:
    if not DB_PATH.exists():
        print(f"  people.db not found at {DB_PATH}, skipping")
        return True

    conn = sqlite3.connect(str(DB_PATH))
    try:
        if not _column_exists(conn, "people", "is_self"):
            conn.execute("ALTER TABLE people ADD COLUMN is_self INTEGER DEFAULT 0")
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_people_is_self ON people(is_self) WHERE is_self = 1"
            )
            conn.commit()
            print("  ✓ people.is_self column added")
        else:
            print("  people.is_self already present")
        return True
    except Exception as e:
        print(f"  ✗ Migration failed: {e}")
        return False
    finally:
        conn.close()


if __name__ == "__main__":
    if check():
        print("Migration 038 already applied")
    else:
        success = up()
        print("Done" if success else "Failed")
