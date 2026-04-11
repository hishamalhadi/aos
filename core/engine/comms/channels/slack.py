"""Slack channel adapter.

Send-only adapter for DM messaging via the Slack Web API.
Token-type-agnostic: works with user tokens (xoxp-) or bot tokens (xoxb-).

User token → sends as the operator (personal).
Bot token  → sends as the AOS bot (assistant-style).

Resolution order:
  1. SLACK_USER_TOKEN (preferred for DMs — sends as the operator)
  2. SLACK_BOT_TOKEN  (fallback — sends as the bot)

Both token types use the same Slack Web API endpoints:
  - conversations.open  (open a DM channel with a user)
  - chat.postMessage    (send a message to that channel)
  - auth.test           (verify token validity)
  - users.list          (used by intel source, not the adapter)

Scopes required:
  chat:write, im:write  (for DMs)
  users:read            (for intel source member lookup)
"""

from __future__ import annotations

import json
import subprocess
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

from ..channel import ChannelAdapter
from ..models import Conversation, Message

SLACK_API_BASE = "https://slack.com/api"


def _get_secret(name: str) -> str:
    """Fetch a secret from the AOS Keychain via agent-secret."""
    try:
        result = subprocess.run(
            [str(Path.home() / "aos" / "core" / "bin" / "agent-secret"), "get", name],
            capture_output=True, text=True, timeout=5,
        )
        return result.stdout.strip()
    except Exception:
        return ""


def _slack_api(method: str, token: str, payload: dict | None = None) -> dict:
    """Call a Slack Web API method. Returns the JSON response dict."""
    url = f"{SLACK_API_BASE}/{method}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json; charset=utf-8",
    }

    data = json.dumps(payload or {}).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")

    try:
        resp = urllib.request.urlopen(req, timeout=15)
        return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return {"ok": False, "error": f"http_{e.code}", "detail": body}
    except Exception as e:
        return {"ok": False, "error": str(e)}


class SlackAdapter(ChannelAdapter):
    """Slack adapter via Web API — send-only for now."""

    name = "slack"
    display_name = "Slack"
    can_send = True
    can_receive = False  # receive stays in the bridge (Socket Mode)

    def __init__(self):
        self._token: str | None = None
        self._token_type: str | None = None  # "user" or "bot"
        self._team_id: str | None = None
        self._resolved = False

    def _resolve_token(self) -> None:
        """Resolve token lazily on first use."""
        if self._resolved:
            return
        self._resolved = True

        # Prefer user token (sends as the operator)
        user = _get_secret("SLACK_USER_TOKEN")
        if user:
            self._token = user
            self._token_type = "user"
            return

        # Fall back to bot token
        bot = _get_secret("SLACK_BOT_TOKEN")
        if bot:
            self._token = bot
            self._token_type = "bot"

    @property
    def token(self) -> str | None:
        self._resolve_token()
        return self._token

    @property
    def token_type(self) -> str | None:
        self._resolve_token()
        return self._token_type

    # --- Lifecycle ---

    def is_available(self) -> bool:
        """Check if a valid Slack token is available."""
        if not self.token:
            return False
        # Verify the token works
        result = _slack_api("auth.test", self.token)
        return result.get("ok", False)

    def health(self) -> dict:
        if not self.token:
            return {
                "available": False,
                "channel": self.name,
                "error": "No SLACK_USER_TOKEN or SLACK_BOT_TOKEN in Keychain",
            }

        result = _slack_api("auth.test", self.token)
        return {
            "available": result.get("ok", False),
            "channel": self.name,
            "token_type": self.token_type,
            "team": result.get("team", ""),
            "user": result.get("user", ""),
            "team_id": result.get("team_id", ""),
            "error": result.get("error") if not result.get("ok") else None,
        }

    # --- Read interface (stub — receive stays in bridge) ---

    def get_conversations(self, since: datetime | None = None) -> list[Conversation]:
        return []

    def get_messages(
        self,
        conversation_id: str | None = None,
        since: datetime | None = None,
        limit: int | None = None,
    ) -> list[Message]:
        return []

    # --- Handle resolution ---

    def resolve_handle(self, handle: str) -> str | None:
        """Slack user IDs are already normalized (U-prefixed)."""
        if handle and handle.startswith("U"):
            return handle
        return None

    # --- Send ---

    def send_message(self, recipient: str, text: str) -> bool:
        """Send a Slack DM to a user by their Slack user ID.

        Opens a DM channel (conversations.open) and posts the message.

        Args:
            recipient: Slack user ID (e.g., "U0123456789").
            text: Message body (supports Slack mrkdwn formatting).

        Returns:
            True if the message was accepted by Slack.
        """
        if not self.token or not recipient or not text:
            return False

        # Step 1: Open a DM channel with the user
        open_resp = _slack_api("conversations.open", self.token, {
            "users": recipient,
        })
        if not open_resp.get("ok"):
            return False

        channel_id = open_resp.get("channel", {}).get("id")
        if not channel_id:
            return False

        # Step 2: Post the message
        post_resp = _slack_api("chat.postMessage", self.token, {
            "channel": channel_id,
            "text": text,
        })
        return post_resp.get("ok", False)
