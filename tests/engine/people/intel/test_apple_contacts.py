"""Tests for the Apple Contacts signal adapter.

Builds a tiny AddressBook-v22.abcddb fixture with a handful of ZABCDRECORD
rows plus the supporting side-tables, then exercises the adapter end-to-end.
Schema mirrors the minimal subset the production adapter reads — this is
schema-guess territory, so tests are the source of truth for field names.
"""
from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pytest

from core.engine.people.intel.sources.apple_contacts import (
    APPLE_EPOCH_OFFSET,
    AppleContactsAdapter,
)


# ── Fixture builder ──────────────────────────────────────────────────

def _core_data_ts(year: int, month: int, day: int) -> float:
    """Return a Core-Data timestamp (seconds since 2001-01-01) for a date."""
    dt = datetime(year, month, day, tzinfo=timezone.utc)
    return dt.timestamp() - APPLE_EPOCH_OFFSET


def _build_db(path: Path, *, include_social: bool = True,
              include_urls: bool = True, include_groups: bool = True) -> None:
    """Create a minimal AddressBook-v22.abcddb fixture at the given path."""
    conn = sqlite3.connect(str(path))
    c = conn.cursor()

    c.execute(
        """CREATE TABLE ZABCDRECORD (
            Z_PK INTEGER PRIMARY KEY,
            ZFIRSTNAME TEXT,
            ZLASTNAME TEXT,
            ZORGANIZATION TEXT,
            ZJOBTITLE TEXT,
            ZNOTE TEXT,
            ZBIRTHDAY REAL,
            ZCREATIONDATE REAL
        )"""
    )
    c.execute(
        """CREATE TABLE ZABCDPHONENUMBER (
            Z_PK INTEGER PRIMARY KEY,
            ZOWNER INTEGER,
            ZFULLNUMBER TEXT,
            ZLABEL TEXT
        )"""
    )
    c.execute(
        """CREATE TABLE ZABCDEMAILADDRESS (
            Z_PK INTEGER PRIMARY KEY,
            ZOWNER INTEGER,
            ZADDRESS TEXT,
            ZLABEL TEXT
        )"""
    )
    c.execute(
        """CREATE TABLE ZABCDPOSTALADDRESS (
            Z_PK INTEGER PRIMARY KEY,
            ZOWNER INTEGER,
            ZCITY TEXT,
            ZCOUNTRY TEXT,
            ZSTREET TEXT,
            ZLABEL TEXT
        )"""
    )
    c.execute(
        """CREATE TABLE ZABCDRELATEDNAME (
            Z_PK INTEGER PRIMARY KEY,
            ZOWNER INTEGER,
            ZLABEL TEXT,
            ZNAME TEXT
        )"""
    )

    if include_urls:
        c.execute(
            """CREATE TABLE ZABCDURLADDRESS (
                Z_PK INTEGER PRIMARY KEY,
                ZOWNER INTEGER,
                ZURL TEXT,
                ZLABEL TEXT
            )"""
        )

    if include_social:
        c.execute(
            """CREATE TABLE ZABCDSOCIALPROFILE (
                Z_PK INTEGER PRIMARY KEY,
                ZOWNER INTEGER,
                ZSERVICE TEXT,
                ZUSERNAME TEXT
            )"""
        )

    if include_groups:
        c.execute(
            """CREATE TABLE ZABCDGROUP (
                Z_PK INTEGER PRIMARY KEY,
                ZNAME TEXT
            )"""
        )
        c.execute(
            """CREATE TABLE Z_22PARENTGROUPS (
                Z_22PARENTGROUPS1 INTEGER,
                Z_22GROUPS INTEGER
            )"""
        )

    # Records
    alice_birthday = _core_data_ts(1990, 5, 15)
    alice_created = _core_data_ts(2020, 1, 10)
    c.executemany(
        "INSERT INTO ZABCDRECORD "
        "(Z_PK, ZFIRSTNAME, ZLASTNAME, ZORGANIZATION, ZJOBTITLE, ZNOTE, "
        "ZBIRTHDAY, ZCREATIONDATE) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (1, "Alice", "Smith", "Acme Corp", "Engineer",
             "Met at conference 2019. Loves hiking.", alice_birthday, alice_created),
            (2, "Bob", "Jones", None, None, None, None, None),
            (3, "Carol", "Anderson", None, None, None, None, None),
            (4, "Carol", "Bennett", None, None, None, None, None),
        ],
    )

    # Phones
    c.executemany(
        "INSERT INTO ZABCDPHONENUMBER (ZOWNER, ZFULLNUMBER, ZLABEL) "
        "VALUES (?, ?, ?)",
        [
            (1, "+1-555-111-2222", "mobile"),
            (1, "555 111 3333", "home"),
            (2, "+1 (555) 444-5555", "mobile"),
            (3, "+1-555-777-8888", "mobile"),
            (4, "+1-555-999-0000", "mobile"),
        ],
    )

    # Emails
    c.execute(
        "INSERT INTO ZABCDEMAILADDRESS (ZOWNER, ZADDRESS, ZLABEL) "
        "VALUES (?, ?, ?)",
        (1, "alice@example.com", "home"),
    )

    # Postal
    c.execute(
        "INSERT INTO ZABCDPOSTALADDRESS "
        "(ZOWNER, ZCITY, ZCOUNTRY, ZSTREET, ZLABEL) VALUES (?, ?, ?, ?, ?)",
        (1, "Brooklyn", "USA", "123 Main St", "home"),
    )

    # Related names
    c.execute(
        "INSERT INTO ZABCDRELATEDNAME (ZOWNER, ZLABEL, ZNAME) VALUES (?, ?, ?)",
        (1, "sister", "Tamia"),
    )

    if include_urls:
        c.execute(
            "INSERT INTO ZABCDURLADDRESS (ZOWNER, ZURL, ZLABEL) VALUES (?, ?, ?)",
            (1, "https://alice.example.com", "homepage"),
        )

    if include_social:
        c.execute(
            "INSERT INTO ZABCDSOCIALPROFILE (ZOWNER, ZSERVICE, ZUSERNAME) "
            "VALUES (?, ?, ?)",
            (1, "twitter", "@alice"),
        )

    if include_groups:
        c.execute(
            "INSERT INTO ZABCDGROUP (Z_PK, ZNAME) VALUES (?, ?)",
            (100, "Family"),
        )
        c.execute(
            "INSERT INTO Z_22PARENTGROUPS (Z_22PARENTGROUPS1, Z_22GROUPS) "
            "VALUES (?, ?)",
            (1, 100),
        )

    conn.commit()
    conn.close()


@pytest.fixture
def fixture_db(tmp_path: Path) -> Path:
    """Full-featured fixture with every optional table populated."""
    db = tmp_path / "AddressBook-v22.abcddb"
    _build_db(db)
    return db


@pytest.fixture
def person_index_all() -> dict[str, dict]:
    return {
        "p_alice": {
            "name": "Alice Smith",
            "phones": ["+15551112222"],
            "emails": ["alice@example.com"],
            "wa_jids": [],
        },
        "p_bob": {
            "name": "Bob Jones",
            "phones": [],
            "emails": [],
            "wa_jids": [],
        },
        "p_carol": {
            "name": "Carol",
            "phones": [],
            "emails": [],
            "wa_jids": [],
        },
    }


# ── Tests ─────────────────────────────────────────────────────────

def test_is_available_true_false(tmp_path, fixture_db):
    adapter = AppleContactsAdapter(db_path=str(fixture_db))
    assert adapter.is_available() is True

    missing = tmp_path / "nope.abcddb"
    adapter_missing = AppleContactsAdapter(db_path=str(missing))
    assert adapter_missing.is_available() is False


def test_picks_richest_when_no_path_given(tmp_path, monkeypatch):
    # Build two candidate DBs with different record counts.
    src_a = tmp_path / "SourceA"
    src_a.mkdir()
    db_a = src_a / "AddressBook-v22.abcddb"
    _build_db(db_a)  # 4 records

    src_b = tmp_path / "SourceB"
    src_b.mkdir()
    db_b = src_b / "AddressBook-v22.abcddb"
    conn = sqlite3.connect(str(db_b))
    conn.execute(
        """CREATE TABLE ZABCDRECORD (
            Z_PK INTEGER PRIMARY KEY,
            ZFIRSTNAME TEXT, ZLASTNAME TEXT, ZORGANIZATION TEXT,
            ZJOBTITLE TEXT, ZNOTE TEXT, ZBIRTHDAY REAL, ZCREATIONDATE REAL
        )"""
    )
    for i in range(10):
        conn.execute(
            "INSERT INTO ZABCDRECORD (Z_PK, ZFIRSTNAME) VALUES (?, ?)",
            (i + 1, f"Person{i}"),
        )
    conn.commit()
    conn.close()

    # Monkeypatch the class-level glob pattern to find both.
    pattern = str(tmp_path / "Source*" / "AddressBook-v22.abcddb")
    monkeypatch.setattr(AppleContactsAdapter, "_glob_pattern", pattern)

    adapter = AppleContactsAdapter()
    resolved = adapter._resolve_db_path()
    assert resolved == str(db_b), f"Expected SourceB (10 records), got {resolved}"


def test_matches_by_full_name(fixture_db, person_index_all):
    adapter = AppleContactsAdapter(db_path=str(fixture_db))
    results = adapter.extract_all(person_index_all)
    assert "p_alice" in results
    meta = results["p_alice"].metadata[0]
    assert meta.source == "apple_contacts"


def test_matches_by_phone_suffix_when_name_differs(fixture_db):
    adapter = AppleContactsAdapter(db_path=str(fixture_db))
    idx = {
        "p_x": {
            "name": "Totally Different Name",
            "phones": ["+1-555-111-2222"],
            "emails": [],
            "wa_jids": [],
        }
    }
    results = adapter.extract_all(idx)
    assert "p_x" in results
    # Matched the Alice record via phone
    meta = results["p_x"].metadata[0]
    assert meta.has_birthday is True


def test_rejects_ambiguous_first_name_match(fixture_db):
    adapter = AppleContactsAdapter(db_path=str(fixture_db))
    idx = {
        "p_carol": {
            "name": "Carol",
            "phones": [],
            "emails": [],
            "wa_jids": [],
        }
    }
    results = adapter.extract_all(idx)
    # Two Carols exist — should NOT match
    assert "p_carol" not in results


def test_metadata_signal_populated(fixture_db, person_index_all):
    adapter = AppleContactsAdapter(db_path=str(fixture_db))
    results = adapter.extract_all(person_index_all)
    meta = results["p_alice"].metadata[0]
    assert meta.has_birthday is True
    assert meta.birthday == "1990-05-15"
    assert meta.has_address is True
    assert meta.addresses[0]["city"] == "Brooklyn"
    assert meta.has_notes is True
    assert meta.notes_snippet.startswith("Met at conference")
    assert meta.has_social_profiles is True
    assert meta.social_profiles[0]["platform"] == "twitter"
    assert meta.has_related_names is True
    assert meta.has_urls is True
    assert meta.organization_raw == "Acme Corp"
    assert meta.job_title == "Engineer"
    assert meta.contact_created_at is not None
    # Birthday, address, notes, social, related, urls, org, job, groups = 9
    assert meta.richness_score > 5


def test_related_names_captured(fixture_db, person_index_all):
    adapter = AppleContactsAdapter(db_path=str(fixture_db))
    results = adapter.extract_all(person_index_all)
    meta = results["p_alice"].metadata[0]
    assert len(meta.related_names) == 1
    rn = meta.related_names[0]
    assert rn["label"] == "sister"
    assert rn["name"] == "Tamia"


def test_group_signal_emitted_for_family_group(fixture_db, person_index_all):
    adapter = AppleContactsAdapter(db_path=str(fixture_db))
    results = adapter.extract_all(person_index_all)
    signals = results["p_alice"]
    assert len(signals.group_membership) == 1
    gs = signals.group_membership[0]
    assert gs.source == "apple_contacts"
    assert gs.total_groups == 1
    assert gs.shared_with_operator == 1
    assert gs.groups[0]["name"] == "Family"
    assert gs.groups[0]["type"] == "apple_contacts"
    assert gs.group_categories.get("family", 0) >= 1


def test_no_group_signal_when_no_groups(fixture_db, person_index_all):
    adapter = AppleContactsAdapter(db_path=str(fixture_db))
    results = adapter.extract_all(person_index_all)
    # Bob is in the index but belongs to no groups
    assert "p_bob" in results
    assert results["p_bob"].group_membership == []


def test_handles_missing_social_profile_table(tmp_path, person_index_all):
    db = tmp_path / "AddressBook-v22.abcddb"
    _build_db(db, include_social=False)
    adapter = AppleContactsAdapter(db_path=str(db))
    results = adapter.extract_all(person_index_all)
    assert "p_alice" in results
    meta = results["p_alice"].metadata[0]
    assert meta.has_social_profiles is False
    assert meta.social_profiles == []
    # Other fields should still populate
    assert meta.has_birthday is True
    assert meta.has_related_names is True


def test_extract_returns_dict(fixture_db, person_index_all):
    adapter = AppleContactsAdapter(db_path=str(fixture_db))
    results = adapter.extract_all(person_index_all)
    assert isinstance(results, dict)
    for pid, signals in results.items():
        assert isinstance(pid, str)
        assert signals.person_id == pid


def test_unmatched_person_absent(fixture_db):
    adapter = AppleContactsAdapter(db_path=str(fixture_db))
    idx = {
        "p_ghost": {
            "name": "Nobody Here",
            "phones": ["+10000000000"],
            "emails": [],
            "wa_jids": [],
        }
    }
    results = adapter.extract_all(idx)
    assert "p_ghost" not in results
