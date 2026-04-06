"""Telegram source connector.

Extracts contact identity claims from the Telegram bridge's JSONL
message queue. Each unique sender becomes a RawClaim with their
Telegram user ID, username, and display name.

Queue file: ~/.aos/data/telegram-messages.jsonl
Written by: core/services/bridge/telegram_channel.py

This is DIFFERENT from the Telegram ChannelAdapter (which reads messages).
This connector extracts CONTACT identity claims for the People Ontology.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from .base import RawClaim, SourceConnector

log = logging.getLogger(__name__)

QUEUE_PATH = Path.home() / ".aos" / "data" / "telegram-messages.jsonl"


class TelegramConnector(SourceConnector):
    """Source connector for Telegram contact data.

    Priority 40: Telegram display names are user-controlled and may not
    match real names. Usernames are unique but optional. The primary
    value is the stable telegram_id for cross-source linking.
    """

    name = "telegram"
    display_name = "Telegram"
    priority = 40

    def __init__(self, queue_path: Path = QUEUE_PATH):
        self.queue_path = queue_path

    def is_available(self) -> bool:
        return self.queue_path.exists()

    def scan(self) -> list[RawClaim]:
        if not self.queue_path.exists():
            log.info("Telegram queue file not found")
            return []

        # Accumulate unique senders. Use telegram user ID as the
        # dedup key. Keep the most recent name/username per sender.
        senders: dict[str, dict] = {}

        try:
            with open(self.queue_path) as f:
                for line_num, line in enumerate(f, 1):
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        record = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    from_user = record.get("from_user")
                    if not from_user:
                        continue

                    user_id = from_user.get("id")
                    if not user_id:
                        continue

                    user_id_str = str(user_id)

                    # Skip the bot itself (from_me messages)
                    if record.get("from_me", False):
                        continue

                    first_name = (from_user.get("first_name") or "").strip()
                    last_name = (from_user.get("last_name") or "").strip()
                    username = (from_user.get("username") or "").strip()
                    display_name = f"{first_name} {last_name}".strip()

                    # Track last seen timestamp for freshness
                    ts = record.get("timestamp", 0)

                    # Keep or update sender record (latest wins for name)
                    existing = senders.get(user_id_str)
                    if not existing or ts > existing.get("last_seen", 0):
                        senders[user_id_str] = {
                            "user_id": user_id_str,
                            "first_name": first_name,
                            "last_name": last_name,
                            "username": username,
                            "display_name": display_name,
                            "last_seen": ts,
                            "chat_ids": existing["chat_ids"] if existing else set(),
                        }
                    # Always accumulate chat IDs
                    chat_id = record.get("chat_id")
                    if chat_id:
                        senders[user_id_str]["chat_ids"].add(str(chat_id))

        except OSError as e:
            log.error("Failed to read Telegram queue: %s", e)
            return []

        # Convert to RawClaim objects
        claims: list[RawClaim] = []
        for user_id_str, sender in senders.items():
            display_name = sender["display_name"]
            username = sender["username"]
            first_name = sender["first_name"]
            last_name = sender["last_name"]

            claim = RawClaim(
                source="telegram",
                source_id=user_id_str,
                name=display_name or None,
                first_name=first_name or None,
                last_name=last_name or None,
                telegram_ids=[user_id_str],
                metadata={
                    "username": username or None,
                    "last_seen_ts": sender["last_seen"],
                    "chat_ids": sorted(sender["chat_ids"]),
                },
                raw={
                    "user_id": user_id_str,
                    "username": username,
                },
            )
            claims.append(claim)

        log.info("Telegram: scanned %d unique senders", len(claims))
        return claims

    def scan_incremental(self, since_ts: int = 0) -> list[RawClaim]:
        """Scan only senders from messages after since_ts.

        The JSONL file is append-only, so we can filter by timestamp
        during parsing rather than doing a full scan + post-filter.
        """
        if since_ts == 0:
            return self.scan()

        if not self.queue_path.exists():
            return []

        senders: dict[str, dict] = {}

        try:
            with open(self.queue_path) as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        record = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    ts = record.get("timestamp", 0)
                    if ts < since_ts:
                        continue

                    from_user = record.get("from_user")
                    if not from_user:
                        continue

                    user_id = from_user.get("id")
                    if not user_id or record.get("from_me", False):
                        continue

                    user_id_str = str(user_id)
                    first_name = (from_user.get("first_name") or "").strip()
                    last_name = (from_user.get("last_name") or "").strip()
                    username = (from_user.get("username") or "").strip()
                    display_name = f"{first_name} {last_name}".strip()

                    existing = senders.get(user_id_str)
                    if not existing or ts > existing.get("last_seen", 0):
                        senders[user_id_str] = {
                            "user_id": user_id_str,
                            "first_name": first_name,
                            "last_name": last_name,
                            "username": username,
                            "display_name": display_name,
                            "last_seen": ts,
                        }
        except OSError as e:
            log.error("Failed to read Telegram queue: %s", e)
            return []

        claims: list[RawClaim] = []
        for user_id_str, sender in senders.items():
            claim = RawClaim(
                source="telegram",
                source_id=user_id_str,
                name=sender["display_name"] or None,
                first_name=sender["first_name"] or None,
                last_name=sender["last_name"] or None,
                telegram_ids=[user_id_str],
                metadata={
                    "username": sender["username"] or None,
                    "last_seen_ts": sender["last_seen"],
                },
                raw={
                    "user_id": user_id_str,
                    "username": sender["username"],
                },
            )
            claims.append(claim)

        log.info("Telegram: incremental scan found %d senders since %d", len(claims), since_ts)
        return claims
