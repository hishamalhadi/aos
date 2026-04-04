"""Qareen API — Automation suggestions.

Personalized, data-enriched automation suggestions based on:
- Connected services (connector discovery)
- Operator schedule and profile (operator.yaml)
- Communication patterns (people.db)
- Work state (qareen.db tasks/projects)
- Real-time data (unread emails, today's calendar)
"""

from __future__ import annotations

import logging
import sqlite3
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/automations", tags=["suggestions"])

AOS_HOME = Path.home() / "aos"
AOS_DATA = Path.home() / ".aos"
PEOPLE_DB = AOS_DATA / "data" / "people.db"
QAREEN_DB = AOS_DATA / "data" / "qareen.db"
OPERATOR_YAML = AOS_DATA / "config" / "operator.yaml"


# ---------------------------------------------------------------------------
# Data enrichment helpers
# ---------------------------------------------------------------------------

def _get_operator() -> dict:
    """Read operator profile."""
    try:
        if OPERATOR_YAML.exists():
            return yaml.safe_load(OPERATOR_YAML.read_text()) or {}
    except Exception:
        pass
    return {}


def _get_unread_email_count() -> int | None:
    """Get unread email count from Apple Mail via AppleScript."""
    try:
        result = subprocess.run(
            ["osascript", "-e", 'tell application "Mail" to get unread count of inbox'],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            return int(result.stdout.strip())
    except Exception:
        pass
    return None


def _get_today_event_count() -> int | None:
    """Get today's calendar event count via AppleScript."""
    try:
        script = '''
        tell application "Calendar"
            set todayStart to current date
            set time of todayStart to 0
            set todayEnd to todayStart + (1 * days)
            set eventCount to 0
            repeat with cal in calendars
                set eventCount to eventCount + (count of (every event of cal whose start date >= todayStart and start date < todayEnd))
            end repeat
            return eventCount
        end tell
        '''
        result = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0:
            return int(result.stdout.strip())
    except Exception:
        pass
    return None


def _get_top_contacts(limit: int = 5) -> list[dict]:
    """Get most-contacted people from people.db."""
    if not PEOPLE_DB.exists():
        return []
    try:
        conn = sqlite3.connect(str(PEOPLE_DB))
        conn.row_factory = sqlite3.Row
        rows = conn.execute("""
            SELECT p.canonical_name, p.importance, COUNT(i.id) as interaction_count,
                   MAX(i.occurred_at) as last_contact
            FROM people p
            JOIN interactions i ON i.person_id = p.id
            WHERE i.occurred_at > unixepoch('now', '-90 days')
            GROUP BY p.id
            ORDER BY interaction_count DESC
            LIMIT ?
        """, (limit,)).fetchall()
        conn.close()
        return [dict(r) for r in rows]
    except Exception:
        return []


def _get_work_stats() -> dict:
    """Get work system stats from qareen.db."""
    if not QAREEN_DB.exists():
        return {}
    try:
        conn = sqlite3.connect(str(QAREEN_DB))
        tasks = conn.execute(
            "SELECT COUNT(*) FROM tasks WHERE status IN ('todo', 'active')"
        ).fetchone()[0]
        projects = conn.execute(
            "SELECT COUNT(*) FROM projects"
        ).fetchone()[0]
        overdue = conn.execute(
            "SELECT COUNT(*) FROM tasks WHERE due_at < datetime('now') AND due_at IS NOT NULL AND status NOT IN ('done', 'cancelled')"
        ).fetchone()[0]
        conn.close()
        return {"active_tasks": tasks, "projects": projects, "overdue": overdue}
    except Exception:
        return {}


def _get_deployed_recipe_ids() -> set[str]:
    """Get recipe IDs already deployed as n8n automations."""
    if not QAREEN_DB.exists():
        return set()
    try:
        conn = sqlite3.connect(str(QAREEN_DB))
        rows = conn.execute(
            "SELECT recipe_id FROM automations WHERE status != 'archived' AND recipe_id IS NOT NULL"
        ).fetchall()
        conn.close()
        return {r[0] for r in rows}
    except Exception:
        return set()


def _get_google_account_count() -> int:
    """Count Google accounts with tokens."""
    creds_dir = Path.home() / ".google_workspace_mcp" / "credentials"
    if not creds_dir.is_dir():
        return 0
    return len(list(creds_dir.glob("*.json")))


# ---------------------------------------------------------------------------
# Suggestion builders
# ---------------------------------------------------------------------------

def _connector_suggestions(connectors: list[dict], deployed: set[str]) -> list[dict]:
    """Build suggestions from connector automation_ideas."""
    suggestions = []
    connected_ids = {c["id"] for c in connectors if c["status"] in ("connected", "partial")}

    for connector in connectors:
        if connector["status"] not in ("connected", "partial"):
            continue

        for idea in connector.get("automation_ideas", []):
            # Skip if already deployed
            recipe_hint = idea.get("recipe_hint", "")
            if recipe_hint and recipe_hint in deployed:
                continue

            # Check if required co-connectors are available
            required_also = idea.get("required_also", [])
            if required_also and not all(r in connected_ids for r in required_also):
                continue

            suggestions.append({
                "id": f"{connector['id']}:{idea['id']}",
                "name": idea["name"],
                "description": idea["description"],
                "source_connector": connector["id"],
                "source_connector_name": connector["name"],
                "source_icon": connector["icon"],
                "source_color": connector["color"],
                "recipe_hint": recipe_hint,
                "required_connectors": [connector["id"]] + required_also,
                "category": connector["category"],
                "score": 50,  # Base score, will be adjusted by enrichment
            })

    return suggestions


def _enrich_suggestions(
    suggestions: list[dict],
    operator: dict,
    unread_emails: int | None,
    today_events: int | None,
    top_contacts: list[dict],
    work_stats: dict,
    google_accounts: int,
) -> list[dict]:
    """Enrich suggestions with real data and adjust scores."""
    now = datetime.now()
    hour = now.hour
    weekday = now.strftime("%a").lower()[:3]

    # Operator schedule blocks
    schedule_blocks = operator.get("schedule", {}).get("blocks", [])
    is_teaching_day = any(
        weekday in block.get("days", [])
        for block in schedule_blocks
        if block.get("name") == "Teaching"
    )

    for s in suggestions:
        # -- Enrich descriptions with real data --

        if "email" in s["id"].lower() or "gmail" in s["id"].lower():
            if unread_emails is not None and unread_emails > 0:
                s["description"] = f"You have {unread_emails} unread emails across {google_accounts} account{'s' if google_accounts != 1 else ''} — get a daily summary instead of checking manually"
                s["score"] += min(unread_emails // 10, 30)  # More unread = higher priority

        if "calendar" in s["id"].lower() or "schedule" in s["id"].lower():
            if today_events is not None:
                if today_events > 0:
                    s["description"] = f"You have {today_events} event{'s' if today_events != 1 else ''} today — get your schedule sent to Telegram each morning"
                else:
                    s["description"] = "No events today, but get tomorrow's schedule sent to Telegram each morning"
                if is_teaching_day:
                    s["score"] += 20  # Higher priority on teaching days

        if "task" in s["id"].lower() or "project" in s["id"].lower():
            active = work_stats.get("active_tasks", 0)
            projects = work_stats.get("projects", 0)
            overdue = work_stats.get("overdue", 0)
            if active > 0:
                s["description"] = f"You have {active} active tasks across {projects} project{'s' if projects != 1 else ''}"
                if overdue > 0:
                    s["description"] += f" — {overdue} overdue"
                    s["score"] += 25

        if "contact" in s["id"].lower() or "birthday" in s["id"].lower():
            if top_contacts:
                # Clean emoji from name, take first word
                raw_name = top_contacts[0]["canonical_name"]
                clean_name = "".join(c for c in raw_name if c.isalpha() or c == " ").strip().split()[0]
                count = top_contacts[0]["interaction_count"]
                s["description"] = f"You talk to {clean_name} {count}+ times recently — track follow-ups and birthdays automatically"
                s["score"] += 15

        if "briefing" in s["id"].lower() or "morning" in s["id"].lower():
            # Morning suggestions are more relevant in the morning
            if 5 <= hour <= 10:
                s["score"] += 25
            s["description"] = f"Morning brief combining your calendar, email, and tasks — personalized for your {operator.get('timezone', 'timezone')}"

        # -- Time-based scoring --
        if hour < 12:
            # Morning: boost schedule/email/briefing suggestions
            if any(k in s["id"].lower() for k in ["morning", "calendar", "email", "briefing", "schedule"]):
                s["score"] += 10
        else:
            # Afternoon/evening: boost review/summary suggestions
            if any(k in s["id"].lower() for k in ["review", "summary", "digest", "report"]):
                s["score"] += 10

    return suggestions


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.get("/suggestions")
async def get_suggestions() -> JSONResponse:
    """Get personalized automation suggestions.

    Reads from connector discovery + enriches with real data from
    ontology, people, work, and system state.
    """
    try:
        # 1. Discover connectors
        sys.path.insert(0, str(AOS_HOME / "core"))
        from infra.connectors.discover import discover_all
        connectors = [c.to_dict() for c in discover_all()]
    except Exception:
        logger.exception("Connector discovery failed")
        connectors = []

    # 2. Get deployed automations (to exclude)
    deployed = _get_deployed_recipe_ids()

    # 3. Build base suggestions from connector ideas
    suggestions = _connector_suggestions(connectors, deployed)

    # 4. Gather enrichment data
    operator = _get_operator()
    unread_emails = _get_unread_email_count()
    today_events = _get_today_event_count()
    top_contacts = _get_top_contacts(5)
    work_stats = _get_work_stats()
    google_accounts = _get_google_account_count()

    # 5. Enrich and score
    suggestions = _enrich_suggestions(
        suggestions, operator, unread_emails, today_events,
        top_contacts, work_stats, google_accounts,
    )

    # 6. Sort by score (highest first) and limit
    suggestions.sort(key=lambda s: s["score"], reverse=True)

    return JSONResponse({
        "suggestions": suggestions[:12],
        "total": len(suggestions),
        "context": {
            "connectors_connected": sum(1 for c in connectors if c["status"] in ("connected", "partial")),
            "unread_emails": unread_emails,
            "today_events": today_events,
            "active_tasks": work_stats.get("active_tasks"),
            "top_contact": top_contacts[0]["canonical_name"] if top_contacts else None,
        },
    })
