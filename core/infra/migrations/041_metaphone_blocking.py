"""
Migration 041: Add metaphone_key column for phonetic dedup blocking.

Double Metaphone produces phonetic codes that handle Western name
variations (Catherine/Katherine, Steven/Stephen) and complement the
existing Arabic phonetic groups in normalize.py. Used as a blocking
key in the dedup engine to reduce O(n^2) comparisons.

Idempotent: re-running is safe.
"""

DESCRIPTION = "Add metaphone_key column to people table"

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
        return _column_exists(conn, "people", "metaphone_key")
    finally:
        conn.close()


def up() -> bool:
    if not DB_PATH.exists():
        return True
    conn = sqlite3.connect(str(DB_PATH))
    try:
        if not _column_exists(conn, "people", "metaphone_key"):
            conn.execute("ALTER TABLE people ADD COLUMN metaphone_key TEXT")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_people_metaphone ON people(metaphone_key)")

        # Backfill metaphone keys
        try:
            from metaphone import doublemetaphone

            rows = conn.execute(
                "SELECT id, canonical_name FROM people WHERE metaphone_key IS NULL AND canonical_name IS NOT NULL"
            ).fetchall()
            for row in rows:
                words = (row[1] or "").lower().split()
                codes = []
                for w in words:
                    primary, _ = doublemetaphone(w)
                    codes.append(primary if primary else w)
                key = " ".join(codes)
                conn.execute(
                    "UPDATE people SET metaphone_key = ? WHERE id = ?",
                    (key, row[0]),
                )
            conn.commit()
            print(f"  Backfilled {len(rows)} metaphone keys")
        except ImportError:
            print("  metaphone not installed — skipping backfill (will run on next cycle)")

        return True
    finally:
        conn.close()
