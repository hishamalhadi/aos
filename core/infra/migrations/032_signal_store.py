"""
Migration 032: signal_store table for People Intelligence.

Adds the `signal_store` table to people.db — the persistence layer for
extracted signals from the People Intelligence subsystem
(core/engine/people/intel/). Each row stores JSON-serialized signals for
one person × one source, so re-running a single adapter only overwrites
its own row.

This is Subsystem A of the People Intelligence architecture. See
docs/plans/2026-04-06-people-intelligence-v2.md for the full plan.

Idempotent: re-running is safe. Early-returns if people.db does not exist
yet (fresh install) — the table will be created on the next run once
people.db is initialized by the ontology layer.
"""

DESCRIPTION = "signal_store table for People Intelligence signal persistence"

import sqlite3
from pathlib import Path

DB_PATH = Path.home() / ".aos" / "data" / "people.db"


def _table_exists(conn: sqlite3.Connection, name: str) -> bool:
    return (
        conn.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?",
            (name,),
        ).fetchone()[0]
        > 0
    )


def check() -> bool:
    """Return True if migration has already been applied."""
    if not DB_PATH.exists():
        return True  # Fresh install — nothing to migrate
    conn = sqlite3.connect(str(DB_PATH))
    try:
        return _table_exists(conn, "signal_store")
    finally:
        conn.close()


def up() -> bool:
    """Create the signal_store table and supporting indexes."""
    if not DB_PATH.exists():
        print(f"  people.db not found at {DB_PATH}, skipping")
        return True

    conn = sqlite3.connect(str(DB_PATH))
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS signal_store (
                person_id    TEXT NOT NULL,
                source_name  TEXT NOT NULL,
                signals_json TEXT NOT NULL,
                extracted_at INTEGER NOT NULL,
                PRIMARY KEY (person_id, source_name)
            );

            CREATE INDEX IF NOT EXISTS idx_signal_store_person
                ON signal_store(person_id);

            CREATE INDEX IF NOT EXISTS idx_signal_store_source
                ON signal_store(source_name);

            CREATE INDEX IF NOT EXISTS idx_signal_store_extracted_at
                ON signal_store(extracted_at);
            """
        )
        conn.commit()
        print("  ✓ signal_store table created")
        return True
    except Exception as e:
        print(f"  ✗ Migration failed: {e}")
        return False
    finally:
        conn.close()


if __name__ == "__main__":
    if check():
        print("Migration 032 already applied")
    else:
        success = up()
        print("Done" if success else "Failed")
