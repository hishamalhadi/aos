"""
Migration 039: Move people DB module from instance to framework.

The people CRUD layer (db.py, resolver.py, schema.sql) previously lived
at ~/.aos/services/people/ — an instance path. Framework code imported
from it via sys.path hacking. These modules are now shipped in the
framework at core/engine/people/. This migration removes the stale
instance copies and any leftover ghost people.db files.

Idempotent: re-running is safe.
"""

DESCRIPTION = "Move people DB module from instance to framework"

import shutil
from pathlib import Path

_SERVICES_PEOPLE = Path.home() / ".aos" / "services" / "people"
_VAULT_PEOPLE_DB = Path.home() / "vault" / "knowledge" / "people" / "people.db"
_FRAMEWORK_DB_MOD = Path.home() / "aos" / "core" / "engine" / "people" / "db.py"


def check() -> bool:
    """Return True if migration already applied (nothing to clean up)."""
    stale_module = _SERVICES_PEOPLE / "db.py"
    stale_vault = _VAULT_PEOPLE_DB
    return not stale_module.exists() and not stale_vault.exists()


def up() -> bool:
    """Remove stale instance copies of the people module."""
    # Safety: only clean up if the framework copy is deployed
    if not _FRAMEWORK_DB_MOD.exists():
        print("  Skipping: framework db.py not yet deployed at", _FRAMEWORK_DB_MOD)
        return True  # Don't block other migrations; will run next cycle

    cleaned = []

    # Remove stale module files at services/people/
    if _SERVICES_PEOPLE.exists():
        for name in ("db.py", "resolver.py", "schema.sql"):
            f = _SERVICES_PEOPLE / name
            if f.exists():
                f.unlink()
                cleaned.append(str(f))
        # Remove __pycache__ if present
        cache = _SERVICES_PEOPLE / "__pycache__"
        if cache.exists():
            shutil.rmtree(cache)
            cleaned.append(str(cache))
        # Remove stale people.db and WAL files if any remain
        for name in ("people.db", "people.db-shm", "people.db-wal"):
            f = _SERVICES_PEOPLE / name
            if f.exists():
                f.unlink()
                cleaned.append(str(f))

    # Remove ghost vault people.db (0-byte file created by accident)
    if _VAULT_PEOPLE_DB.exists() and _VAULT_PEOPLE_DB.stat().st_size == 0:
        _VAULT_PEOPLE_DB.unlink()
        cleaned.append(str(_VAULT_PEOPLE_DB))

    if cleaned:
        print(f"  Cleaned up {len(cleaned)} stale files")
        for f in cleaned:
            print(f"    - {f}")

    return True
