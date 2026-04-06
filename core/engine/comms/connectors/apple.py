"""Apple Contacts source connector.

Reads the macOS AddressBook SQLite database directly. Extracts names,
phone numbers, email addresses, organization, and address data.

Database location:
    ~/Library/Application Support/AddressBook/Sources/*/AddressBook-v22.abcddb

Requires Full Disk Access for the running process. The database is copied
to a temp file before reading to avoid locking the live database.
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

AB_DIR = Path.home() / "Library" / "Application Support" / "AddressBook"


def _find_ab_database() -> Path | None:
    """Locate the AddressBook SQLite database.

    macOS stores the database under Sources/<UUID>/AddressBook-v22.abcddb.
    There may be multiple sources; we take the first one found (sorted for
    determinism).
    """
    sources = sorted(AB_DIR.glob("Sources/*/AddressBook-v22.abcddb"))
    return sources[0] if sources else None


def _copy_db(path: Path) -> str | None:
    """Copy a SQLite database (plus WAL/SHM) to a temp file.

    Returns the temp file path, or None if the source doesn't exist or
    the copy fails.
    """
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
        log.warning("Failed to copy AddressBook DB: %s", e)
        return None


def _normalize_phone(phone: str) -> str:
    """Strip a phone string down to digits with a leading +."""
    digits = re.sub(r"[^\d+]", "", phone)
    if not digits.startswith("+"):
        digits = "+" + digits
    return digits


class AppleContactsConnector(SourceConnector):
    """Source connector for macOS Contacts (AddressBook).

    Priority 80: the user's own address book is a high-trust source.
    Names, phones, and emails entered here are explicitly curated by
    the operator.
    """

    name = "apple_contacts"
    display_name = "Apple Contacts"
    priority = 80

    def __init__(self, db_path: Path | None = None):
        self._db_path = db_path

    @property
    def db_path(self) -> Path | None:
        if self._db_path:
            return self._db_path
        return _find_ab_database()

    def is_available(self) -> bool:
        path = self.db_path
        if not path:
            return False
        return path.exists()

    def scan(self) -> list[RawClaim]:
        path = self.db_path
        if not path:
            log.info("No AddressBook database found")
            return []

        tmp_path = _copy_db(path)
        if not tmp_path:
            return []

        claims: list[RawClaim] = []
        try:
            conn = sqlite3.connect(tmp_path)
            conn.row_factory = sqlite3.Row

            # Read all contact records
            rows = conn.execute("""
                SELECT
                    r.Z_PK,
                    r.ZFIRSTNAME,
                    r.ZLASTNAME,
                    r.ZORGANIZATION,
                    r.ZNICKNAME,
                    r.ZJOBTITLE,
                    r.ZBIRTHDAY,
                    r.ZMODIFICATIONDATE
                FROM ZABCDRECORD r
            """).fetchall()

            for row in rows:
                pk = row["Z_PK"]
                first = (row["ZFIRSTNAME"] or "").strip()
                last = (row["ZLASTNAME"] or "").strip()
                org = (row["ZORGANIZATION"] or "").strip()
                nickname = (row["ZNICKNAME"] or "").strip()
                job_title = (row["ZJOBTITLE"] or "").strip() if row["ZJOBTITLE"] else None

                # Build display name
                name = f"{first} {last}".strip()
                if not name:
                    name = org or nickname or None

                # Skip records with no identifying information
                if not name:
                    continue

                # Phones
                phones: list[str] = []
                phone_labels: dict[str, str] = {}
                for ph in conn.execute(
                    "SELECT ZFULLNUMBER, ZLABEL FROM ZABCDPHONENUMBER WHERE ZOWNER = ?",
                    (pk,),
                ).fetchall():
                    raw_number = ph["ZFULLNUMBER"]
                    if raw_number:
                        normalized = _normalize_phone(raw_number)
                        phones.append(normalized)
                        label = ph["ZLABEL"] or ""
                        if label:
                            phone_labels[normalized] = label

                # Emails
                emails: list[str] = []
                email_labels: dict[str, str] = {}
                for em in conn.execute(
                    "SELECT ZADDRESS, ZLABEL FROM ZABCDEMAILADDRESS WHERE ZOWNER = ?",
                    (pk,),
                ).fetchall():
                    addr = em["ZADDRESS"]
                    if addr:
                        addr_lower = addr.lower().strip()
                        emails.append(addr_lower)
                        label = em["ZLABEL"] or ""
                        if label:
                            email_labels[addr_lower] = label

                # Postal addresses (city + country)
                city: str | None = None
                country: str | None = None
                try:
                    addr_row = conn.execute(
                        "SELECT ZCITY, ZCOUNTRYNAME FROM ZABCDPOSTALADDRESS WHERE ZOWNER = ? LIMIT 1",
                        (pk,),
                    ).fetchone()
                    if addr_row:
                        city = (addr_row["ZCITY"] or "").strip() or None
                        country = (addr_row["ZCOUNTRYNAME"] or "").strip() or None
                except sqlite3.OperationalError:
                    # Table may not exist in older databases
                    pass

                # Birthday (Apple stores as float timestamp)
                birthday: str | None = None
                if row["ZBIRTHDAY"] is not None:
                    try:
                        # AddressBook stores birthday as Apple epoch float
                        import datetime
                        apple_epoch = 978307200  # 2001-01-01
                        ts = row["ZBIRTHDAY"] + apple_epoch
                        dt = datetime.datetime.fromtimestamp(ts)
                        birthday = dt.strftime("%Y-%m-%d")
                    except (OSError, OverflowError, ValueError):
                        pass

                claim = RawClaim(
                    source="apple_contacts",
                    source_id=str(pk),
                    name=name,
                    first_name=first or None,
                    last_name=last or None,
                    nickname=nickname or None,
                    phones=phones,
                    emails=emails,
                    organization=org or None,
                    job_title=job_title,
                    city=city,
                    country=country,
                    birthday=birthday,
                    metadata={
                        "phone_labels": phone_labels,
                        "email_labels": email_labels,
                    },
                    raw={
                        "z_pk": pk,
                        "modification_date": row["ZMODIFICATIONDATE"],
                    },
                )
                claims.append(claim)

            conn.close()
        except sqlite3.Error as e:
            log.error("Failed to read AddressBook database: %s", e)
        finally:
            Path(tmp_path).unlink(missing_ok=True)
            # Clean up WAL/SHM copies
            for ext in ["-wal", "-shm"]:
                Path(tmp_path + ext).unlink(missing_ok=True)

        log.info("Apple Contacts: scanned %d contacts", len(claims))
        return claims

    def scan_incremental(self, since_ts: int = 0) -> list[RawClaim]:
        """Scan contacts modified after since_ts.

        Apple stores ZMODIFICATIONDATE as Apple epoch float (seconds since
        2001-01-01). We convert since_ts from Unix epoch for comparison.
        """
        if since_ts == 0:
            return self.scan()

        all_claims = self.scan()
        if not all_claims:
            return []

        # Convert Unix timestamp to Apple epoch for comparison
        apple_epoch_offset = 978307200
        apple_since = since_ts - apple_epoch_offset

        return [
            c for c in all_claims
            if c.raw.get("modification_date") is not None
            and c.raw["modification_date"] >= apple_since
        ]
