"""Email channel adapter.

Sends email via two transports (tried in order):
  1. gws CLI (Google Workspace CLI) — OAuth, structured JSON, multi-account
  2. SMTP fallback — stdlib smtplib, works with any provider

Multi-account: reads ~/.aos/config/accounts.yaml to pick the right
from-address based on the active context. Default context's Google
account is used when no specific context is active.

Keychain secrets (for SMTP fallback):
  EMAIL_SMTP_HOST     (default: smtp.gmail.com)
  EMAIL_SMTP_PORT     (default: 465)
  EMAIL_SMTP_USER     (email address)
  EMAIL_SMTP_PASSWORD (app password)

gws auth is managed via `gws auth setup` / `gws auth login` —
see https://github.com/googleworkspace/cli.
"""

from __future__ import annotations

import email.mime.text
import json
import logging
import os
import shutil
import smtplib
import subprocess
from datetime import datetime
from pathlib import Path

from ..channel import ChannelAdapter
from ..models import Conversation, Message

log = logging.getLogger(__name__)

ACCOUNTS_YAML = Path.home() / ".aos" / "config" / "accounts.yaml"


def _get_secret(name: str) -> str:
    try:
        result = subprocess.run(
            [str(Path.home() / "aos" / "core" / "bin" / "agent-secret"), "get", name],
            capture_output=True, text=True, timeout=5,
        )
        return result.stdout.strip()
    except Exception:
        return ""


def _get_default_from_address() -> str:
    """Read the default from-address from accounts.yaml."""
    try:
        import yaml
    except ImportError:
        return ""

    if not ACCOUNTS_YAML.exists():
        return ""

    try:
        with open(ACCOUNTS_YAML) as f:
            config = yaml.safe_load(f) or {}
    except Exception:
        return ""

    # Find the default context
    contexts = config.get("contexts", {})
    for ctx_name, ctx in contexts.items():
        if not isinstance(ctx, dict):
            continue
        if ctx.get("default"):
            google_account = (ctx.get("accounts") or {}).get("google")
            if google_account:
                return google_account

    # Fallback to operator primary email
    return (config.get("operator") or {}).get("primary_email", "")


GWS_ACCOUNT = Path.home() / "aos" / "core" / "bin" / "internal" / "gws-account"


def _gws_available() -> bool:
    """Check if gws CLI is installed and authenticated."""
    return bool(shutil.which("gws")) and GWS_ACCOUNT.exists()


def _send_via_gws(to: str, subject: str, body: str) -> tuple[bool, str]:
    """Send email via gws CLI. Returns (success, error_msg)."""
    cmd = [
        str(GWS_ACCOUNT), "gmail", "+send",
        "--to", to,
        "--subject", subject,
        "--body", body,
    ]

    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            return True, ""
        # Parse error from JSON output if possible
        try:
            data = json.loads(result.stdout)
            return False, data.get("error", result.stderr.strip())
        except (json.JSONDecodeError, ValueError):
            return False, result.stderr.strip() or f"exit code {result.returncode}"
    except subprocess.TimeoutExpired:
        return False, "gws send timed out (30s)"
    except Exception as e:
        return False, str(e)


def _send_via_smtp(to: str, subject: str, body: str, from_addr: str) -> tuple[bool, str]:
    """Send email via SMTP (stdlib). Returns (success, error_msg)."""
    host = _get_secret("EMAIL_SMTP_HOST") or "smtp.gmail.com"
    port_str = _get_secret("EMAIL_SMTP_PORT") or "465"
    user = _get_secret("EMAIL_SMTP_USER") or from_addr
    password = _get_secret("EMAIL_SMTP_PASSWORD")

    if not password:
        return False, "EMAIL_SMTP_PASSWORD not in Keychain"
    if not user:
        return False, "No SMTP user (set EMAIL_SMTP_USER or configure accounts.yaml)"

    try:
        port = int(port_str)
    except ValueError:
        port = 465

    msg = email.mime.text.MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = from_addr or user
    msg["To"] = to

    try:
        if port == 465:
            with smtplib.SMTP_SSL(host, port, timeout=15) as smtp:
                smtp.login(user, password)
                smtp.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=15) as smtp:
                smtp.ehlo()
                smtp.starttls()
                smtp.ehlo()
                smtp.login(user, password)
                smtp.send_message(msg)
        return True, ""
    except smtplib.SMTPAuthenticationError:
        return False, "SMTP auth failed — check EMAIL_SMTP_USER and EMAIL_SMTP_PASSWORD"
    except Exception as e:
        return False, str(e)


class EmailAdapter(ChannelAdapter):
    """Email adapter — gws CLI primary, SMTP fallback."""

    name = "email"
    display_name = "Email"
    can_send = True
    can_receive = False  # receive via separate apple_mail intel source

    def __init__(self):
        self._from_address: str | None = None

    @property
    def from_address(self) -> str:
        if self._from_address is None:
            self._from_address = _get_default_from_address()
        return self._from_address

    # --- Lifecycle ---

    def is_available(self) -> bool:
        """Available if gws CLI is installed OR SMTP creds exist."""
        if _gws_available():
            return True
        if _get_secret("EMAIL_SMTP_PASSWORD"):
            return True
        return False

    def health(self) -> dict:
        gws = _gws_available()
        smtp = bool(_get_secret("EMAIL_SMTP_PASSWORD"))
        return {
            "available": gws or smtp,
            "channel": self.name,
            "transport": "gws" if gws else ("smtp" if smtp else "none"),
            "from_address": self.from_address,
            "gws_installed": gws,
            "smtp_configured": smtp,
        }

    # --- Read interface (stub) ---

    def get_conversations(self, since: datetime | None = None) -> list[Conversation]:
        return []

    def get_messages(
        self,
        conversation_id: str | None = None,
        since: datetime | None = None,
        limit: int | None = None,
    ) -> list[Message]:
        return []

    def resolve_handle(self, handle: str) -> str | None:
        """Email addresses are already normalized."""
        if handle and "@" in handle:
            return handle.lower().strip()
        return None

    # --- Send ---

    def send_message(self, recipient: str, text: str, subject: str | None = None) -> bool:
        """Send an email.

        Args:
            recipient: Email address.
            text: Message body (plain text).
            subject: Email subject line. If None, uses first line of body
                     truncated to 60 chars.

        Returns:
            True if sent successfully via either transport.
        """
        if not recipient or not text:
            return False

        if not subject:
            first_line = text.split("\n")[0].strip()
            subject = first_line[:60] + ("…" if len(first_line) > 60 else "")
            if not subject:
                subject = "(no subject)"

        # Try gws first
        if _gws_available():
            success, err = _send_via_gws(recipient, subject, text)
            if success:
                return True
            log.warning("gws send failed (%s), trying SMTP fallback", err)

        # SMTP fallback
        success, err = _send_via_smtp(recipient, subject, text, self.from_address)
        if success:
            return True

        log.error("Email send failed: %s", err)
        return False
