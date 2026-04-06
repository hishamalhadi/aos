"""WhatsApp source connector.

Extracts contact data from the WhatsApp desktop app's local SQLite
database. Pulls JIDs, pushnames, and phone numbers from chat sessions
and group memberships.

Database location:
    ~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite

This is DIFFERENT from the WhatsApp ChannelAdapter (which reads messages).
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

WA_DB_PATH = (
    Path.home()
    / "Library"
    / "Group Containers"
    / "group.net.whatsapp.WhatsApp.shared"
    / "ChatStorage.sqlite"
)


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
        log.warning("Failed to copy WhatsApp DB: %s", e)
        return None


_SKIP_JIDS = {
    "status@broadcast",
    "0@s.whatsapp.net",
}


def _phone_from_jid(jid: str) -> str | None:
    """Extract and normalize phone number from a WhatsApp JID.

    JID format: <phone>@s.whatsapp.net (individual) or <id>@g.us (group).
    Returns normalized phone for individuals, None for groups.
    """
    if not jid or "@g.us" in jid:
        return None
    phone_part = jid.split("@")[0]
    digits = re.sub(r"[^\d]", "", phone_part)
    if len(digits) < 7:
        return None
    return f"+{digits}"


class WhatsAppConnector(SourceConnector):
    """Source connector for WhatsApp contact data.

    Priority 60: pushnames are self-reported by users (medium trust).
    Phone numbers derived from JIDs are reliable.
    """

    name = "whatsapp"
    display_name = "WhatsApp"
    priority = 60

    def __init__(self, db_path: Path = WA_DB_PATH):
        self.db_path = db_path

    def is_available(self) -> bool:
        return self.db_path.exists()

    def scan(self) -> list[RawClaim]:
        tmp_path = _copy_db(self.db_path)
        if not tmp_path:
            log.info("WhatsApp database not available")
            return []

        claims: list[RawClaim] = []
        seen_jids: set[str] = set()

        try:
            conn = sqlite3.connect(tmp_path)
            conn.row_factory = sqlite3.Row

            # Strategy 1: Extract contacts from chat sessions.
            # ZWACHATSESSION has one row per conversation partner.
            # ZCONTACTJID is the JID, ZPARTNERNAME is the pushname.
            try:
                sessions = conn.execute("""
                    SELECT
                        Z_PK,
                        ZCONTACTJID,
                        ZPARTNERNAME,
                        ZSESSIONTYPE
                    FROM ZWACHATSESSION
                    WHERE ZCONTACTJID IS NOT NULL
                """).fetchall()

                for row in sessions:
                    jid = row["ZCONTACTJID"]
                    if not jid or jid in seen_jids:
                        continue
                    # Skip groups, broadcasts, and known non-contact JIDs
                    if "@g.us" in jid or "@broadcast" in jid or jid in _SKIP_JIDS:
                        continue

                    seen_jids.add(jid)
                    pushname = (row["ZPARTNERNAME"] or "").strip()
                    phone = _phone_from_jid(jid)

                    claim = RawClaim(
                        source="whatsapp",
                        source_id=jid,
                        name=pushname or None,
                        phones=[phone] if phone else [],
                        wa_jids=[jid],
                        metadata={
                            "session_type": row["ZSESSIONTYPE"],
                            "pushname": pushname,
                        },
                        raw={"z_pk": row["Z_PK"], "jid": jid},
                    )
                    claims.append(claim)
            except sqlite3.OperationalError as e:
                log.warning("Failed to read ZWACHATSESSION: %s", e)

            # Strategy 2: Extract contacts from group memberships.
            # ZWAGROUPMEMBER lists members of group chats, which may include
            # contacts not in direct chat sessions.
            try:
                members = conn.execute("""
                    SELECT
                        ZMEMBERJID,
                        ZCONTACTNAME,
                        ZCHATSESSION
                    FROM ZWAGROUPMEMBER
                    WHERE ZMEMBERJID IS NOT NULL
                """).fetchall()

                for row in members:
                    jid = row["ZMEMBERJID"]
                    if not jid or jid in seen_jids:
                        continue
                    if "@g.us" in jid or "@broadcast" in jid or jid in _SKIP_JIDS:
                        continue

                    seen_jids.add(jid)
                    contact_name = (row["ZCONTACTNAME"] or "").strip()
                    phone = _phone_from_jid(jid)

                    claim = RawClaim(
                        source="whatsapp",
                        source_id=jid,
                        name=contact_name or None,
                        phones=[phone] if phone else [],
                        wa_jids=[jid],
                        metadata={"from_group": True},
                        raw={"jid": jid, "group_session": row["ZCHATSESSION"]},
                    )
                    claims.append(claim)
            except sqlite3.OperationalError:
                # Table may not exist if user has no group chats
                pass

            # Strategy 3: Extract senders from messages who aren't in
            # sessions or groups (rare, but covers edge cases).
            try:
                senders = conn.execute("""
                    SELECT DISTINCT ZFROMJID
                    FROM ZWAMESSAGE
                    WHERE ZFROMJID IS NOT NULL
                      AND ZFROMJID NOT LIKE '%@g.us'
                """).fetchall()

                for row in senders:
                    jid = row["ZFROMJID"]
                    if not jid or jid in seen_jids:
                        continue
                    if "@g.us" in jid or "@broadcast" in jid or jid in _SKIP_JIDS:
                        continue

                    seen_jids.add(jid)
                    phone = _phone_from_jid(jid)

                    claim = RawClaim(
                        source="whatsapp",
                        source_id=jid,
                        name=None,  # No pushname from message table
                        phones=[phone] if phone else [],
                        wa_jids=[jid],
                        metadata={"from_messages": True},
                        raw={"jid": jid},
                    )
                    claims.append(claim)
            except sqlite3.OperationalError:
                pass

            conn.close()
        except sqlite3.Error as e:
            log.error("Failed to read WhatsApp database: %s", e)
        finally:
            Path(tmp_path).unlink(missing_ok=True)
            for ext in ["-wal", "-shm"]:
                Path(tmp_path + ext).unlink(missing_ok=True)

        log.info("WhatsApp: scanned %d contacts", len(claims))
        return claims
