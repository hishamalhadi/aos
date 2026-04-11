"""Slack signal adapter — workspace member identity discovery.

Fetches workspace members via the Slack Web API (users.list) and links
them to existing People DB records by email match. Populates
person_identifiers with slack_user_id so the messaging CLI can route
Slack DMs.

Token resolution: SLACK_USER_TOKEN → SLACK_BOT_TOKEN (same as the adapter).
Requires scope: users:read, users.profile:read.

Usage as CLI:
    python3 slack.py                          # dry-run
    python3 slack.py --apply                  # write to people.db
    python3 slack.py --apply --verbose        # verbose output
"""

from __future__ import annotations

import argparse
import json
import logging
import sqlite3
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from typing import ClassVar

from ..types import PersonSignals, SignalType
from .base import SignalAdapter

log = logging.getLogger(__name__)

SLACK_API_BASE = "https://slack.com/api"
PEOPLE_DB = Path.home() / ".aos" / "data" / "people.db"


def _get_secret(name: str) -> str:
    try:
        result = subprocess.run(
            [str(Path.home() / "aos" / "core" / "bin" / "agent-secret"), "get", name],
            capture_output=True, text=True, timeout=5,
        )
        return result.stdout.strip()
    except Exception:
        return ""


def _get_token() -> str:
    """Resolve Slack token (user preferred, bot fallback)."""
    return _get_secret("SLACK_USER_TOKEN") or _get_secret("SLACK_BOT_TOKEN")


def _slack_api(method: str, token: str, params: dict | None = None) -> dict:
    """Call a Slack Web API method via GET with URL params."""
    url = f"{SLACK_API_BASE}/{method}"
    if params:
        from urllib.parse import urlencode
        url += "?" + urlencode(params)
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        return json.loads(resp.read())
    except Exception as e:
        return {"ok": False, "error": str(e)}


def fetch_workspace_members(token: str) -> list[dict]:
    """Fetch all non-bot, non-deleted members from the workspace.

    Returns a list of dicts: {id, name, real_name, email, team_id}.
    Handles pagination (cursor-based).
    """
    members = []
    cursor = None

    while True:
        params = {"limit": "200"}
        if cursor:
            params["cursor"] = cursor

        resp = _slack_api("users.list", token, params)
        if not resp.get("ok"):
            log.error("users.list failed: %s", resp.get("error"))
            break

        for member in resp.get("members", []):
            # Skip bots, deleted users, and Slackbot
            if member.get("is_bot") or member.get("deleted") or member.get("id") == "USLACKBOT":
                continue

            profile = member.get("profile", {})
            email = profile.get("email", "")
            real_name = profile.get("real_name") or member.get("real_name", "")

            members.append({
                "id": member["id"],
                "name": member.get("name", ""),
                "real_name": real_name,
                "email": email.lower() if email else "",
                "team_id": member.get("team_id", ""),
            })

        # Pagination
        cursor = resp.get("response_metadata", {}).get("next_cursor", "")
        if not cursor:
            break

    return members


def match_and_populate(members: list[dict], apply: bool = False, verbose: bool = False) -> dict:
    """Match Slack members to People DB by email, populate slack_user_id.

    Returns stats: {total_members, matched, new_identifiers, already_linked}.
    """
    if not PEOPLE_DB.exists():
        return {"error": "people.db not found"}

    conn = sqlite3.connect(str(PEOPLE_DB))
    conn.row_factory = sqlite3.Row

    # Build email → person_id index from existing identifiers
    email_to_pid = {}
    for row in conn.execute(
        "SELECT person_id, LOWER(value) as email FROM person_identifiers WHERE type='email'"
    ):
        email_to_pid[row["email"]] = row["person_id"]

    # Also try matching by normalized email in value field
    for row in conn.execute(
        "SELECT person_id, LOWER(normalized) as email FROM person_identifiers "
        "WHERE type='email' AND normalized IS NOT NULL"
    ):
        email_to_pid.setdefault(row["email"], row["person_id"])

    # Check which slack_user_ids already exist
    existing_slack_ids = set()
    for row in conn.execute(
        "SELECT value FROM person_identifiers WHERE type='slack_user_id'"
    ):
        existing_slack_ids.add(row["value"])

    stats = {
        "total_members": len(members),
        "matched": 0,
        "new_identifiers": 0,
        "already_linked": 0,
        "unmatched": 0,
    }

    inserts = []

    for member in members:
        email = member["email"]
        slack_id = member["id"]
        team_id = member["team_id"]

        if slack_id in existing_slack_ids:
            stats["already_linked"] += 1
            continue

        pid = email_to_pid.get(email) if email else None
        if not pid:
            stats["unmatched"] += 1
            if verbose:
                log.info("  No match: %s (%s) — %s", member["real_name"], email or "no email", slack_id)
            continue

        stats["matched"] += 1

        # Queue slack_user_id + slack_team_id inserts
        now_ts = int(time.time())
        inserts.append((pid, "slack_user_id", slack_id, slack_id, "slack_workspace", now_ts))
        if team_id:
            inserts.append((pid, "slack_team_id", team_id, team_id, "slack_workspace", now_ts))

        if verbose:
            log.info("  Matched: %s → %s (%s)", member["real_name"], pid, slack_id)

    if apply and inserts:
        conn.executemany(
            "INSERT OR IGNORE INTO person_identifiers "
            "(person_id, type, value, normalized, source, added_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            inserts,
        )
        conn.commit()
        stats["new_identifiers"] = len([i for i in inserts if i[1] == "slack_user_id"])
    elif not apply:
        stats["new_identifiers"] = len([i for i in inserts if i[1] == "slack_user_id"])
        stats["note"] = "dry-run — pass --apply to write"

    conn.close()
    return stats


class SlackSignalAdapter(SignalAdapter):
    """Signal adapter for Slack workspace member discovery."""

    name: ClassVar[str] = "slack"
    display_name: ClassVar[str] = "Slack Workspace"
    platform: ClassVar[str] = "any"
    signal_types: ClassVar[list[SignalType]] = []  # identity only, no comm signals yet
    description: ClassVar[str] = "Discovers workspace members and links by email"
    requires: ClassVar[list[str]] = ["secret:SLACK_BOT_TOKEN"]

    def is_available(self) -> bool:
        return bool(_get_token())

    def extract_all(self, person_index: dict[str, dict]) -> dict[str, PersonSignals]:
        # Identity-only adapter — signals come from the identifier population,
        # not from the signal pipeline. Returns empty for now.
        return {}


# ── CLI ──────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Discover Slack workspace members and link to People DB.",
    )
    parser.add_argument("--apply", action="store_true", help="Write to people.db (default: dry-run).")
    parser.add_argument("--verbose", action="store_true", help="Show per-member matching details.")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING)

    token = _get_token()
    if not token:
        print("✗ No SLACK_USER_TOKEN or SLACK_BOT_TOKEN in Keychain.")
        return 1

    print("Fetching workspace members...")
    members = fetch_workspace_members(token)
    print(f"  Found {len(members)} non-bot members.")

    print("Matching to People DB...")
    stats = match_and_populate(members, apply=args.apply, verbose=args.verbose)

    print(f"\nResults:")
    print(f"  Total members:    {stats.get('total_members', 0)}")
    print(f"  Already linked:   {stats.get('already_linked', 0)}")
    print(f"  New matches:      {stats.get('matched', 0)}")
    print(f"  New identifiers:  {stats.get('new_identifiers', 0)}")
    print(f"  Unmatched:        {stats.get('unmatched', 0)}")

    if stats.get("note"):
        print(f"\n  {stats['note']}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
