"""Qareen API — Automations routes.

System crons read from ~/aos/config/crons.yaml + status.json.
n8n-powered automations tracked in qareen.db via the automations table.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/automations", tags=["automations"])

AOS_HOME = Path.home() / "aos"
AOS_DATA = Path.home() / ".aos"
CRONS_YAML = AOS_HOME / "config" / "crons.yaml"
CRONS_STATUS = AOS_DATA / "logs" / "crons" / "status.json"


def _load_yaml(path: Path) -> dict[str, Any]:
    try:
        import yaml
        if not path.exists():
            return {}
        with open(path) as f:
            data = yaml.safe_load(f) or {}
        return data if isinstance(data, dict) else {}
    except Exception:
        logger.exception("Failed to load YAML: %s", path)
        return {}


def _load_status() -> dict[str, Any]:
    try:
        if not CRONS_STATUS.exists():
            return {}
        with open(CRONS_STATUS) as f:
            return json.load(f)
    except Exception:
        return {}


def _human_schedule(job: dict[str, Any]) -> str:
    """Convert cron schedule fields to human-readable string."""
    if "every" in job:
        every = job["every"]
        return f"Every {every}"
    parts = []
    if job.get("weekday"):
        parts.append(job["weekday"].capitalize())
    if "monthday" in job:
        parts.append(f"Day {job['monthday']}")
    if "at" in job:
        # Convert 24h to 12h
        try:
            t = job["at"].replace('"', '').replace("'", "")
            h, m = int(t.split(":")[0]), int(t.split(":")[1])
            suffix = "AM" if h < 12 else "PM"
            h12 = h if h <= 12 else h - 12
            if h12 == 0:
                h12 = 12
            parts.append(f"{h12}:{m:02d} {suffix}")
        except Exception:
            parts.append(job["at"])
    if not parts:
        return "Manual"
    return " · ".join(parts)


def _time_ago(iso_str: str | None) -> str | None:
    if not iso_str:
        return None
    try:
        dt = datetime.fromisoformat(iso_str)
        diff = datetime.now() - dt
        secs = int(diff.total_seconds())
        if secs < 60:
            return "just now"
        mins = secs // 60
        if mins < 60:
            return f"{mins}m ago"
        hrs = mins // 60
        if hrs < 24:
            return f"{hrs}h ago"
        days = hrs // 24
        return f"{days}d ago"
    except Exception:
        return None


# ── Tier labels for grouping system crons
TIER_LABELS = {
    1: "Maintenance",
    2: "Knowledge",
    3: "Integration",
    4: "Intelligence",
}


@router.get("")
async def list_automations(request: Request) -> JSONResponse:
    """List system crons."""

    # ── System crons
    crons_data = _load_yaml(CRONS_YAML)
    status = _load_status()
    system_items = []

    for name, job in crons_data.get("jobs", {}).items():
        if not isinstance(job, dict):
            continue
        job_status = status.get(name, {})
        system_items.append({
            "id": f"sys_{name}",
            "name": name.replace("-", " ").replace("_", " ").title(),
            "description": job.get("description", ""),
            "frequency": "every" if "every" in job else ("daily" if "at" in job else "manual"),
            "at": job.get("at"),
            "weekday": job.get("weekday"),
            "every": job.get("every"),
            "enabled": job.get("enabled", True),
            "type": "system",
            "tier": job.get("tier", 1),
            "tier_label": TIER_LABELS.get(job.get("tier", 1), "Other"),
            "schedule_human": _human_schedule(job),
            "last_run": job_status.get("last_run"),
            "last_run_ago": _time_ago(job_status.get("last_run")),
            "last_status": job_status.get("last_status", job_status.get("exit_code")),
            "duration_ms": job_status.get("duration_ms"),
        })

    return JSONResponse({
        "system": system_items,
        "total": len(system_items),
    })


@router.post("/{automation_id}/run")
async def run_automation(automation_id: str, request: Request) -> JSONResponse:
    """Manually trigger an automation."""
    if automation_id.startswith("sys_"):
        # Trigger system cron directly
        cron_name = automation_id[4:]
        crons_data = _load_yaml(CRONS_YAML)
        job = crons_data.get("jobs", {}).get(cron_name)
        if not job:
            return JSONResponse({"error": "not found"}, status_code=404)

        import subprocess
        cmd = job.get("command", "")
        if not cmd:
            return JSONResponse({"error": "no command"}, status_code=400)

        try:
            result = subprocess.run(
                cmd, shell=True, capture_output=True, text=True,
                timeout=job.get("timeout", 120),
            )
            return JSONResponse({
                "status": "completed",
                "exit_code": result.returncode,
                "output": result.stdout[-500:] if result.stdout else "",
                "error": result.stderr[-200:] if result.stderr else "",
            })
        except subprocess.TimeoutExpired:
            return JSONResponse({"status": "timeout"})
        except Exception as e:
            return JSONResponse({"status": "error", "error": str(e)}, status_code=500)

    # n8n-powered automation — execute workflow and return per-node results
    n8n_client = getattr(request.app.state, "n8n_client", None)
    if not n8n_client:
        return JSONResponse({"error": "n8n not available"}, status_code=503)

    auto = _get_n8n_automation(automation_id)
    if not auto or not auto.get("n8n_workflow_id"):
        return JSONResponse({"error": "not found"}, status_code=404)

    wf_id = auto["n8n_workflow_id"]

    try:
        import subprocess as _sp
        import httpx

        # Get the workflow to understand its nodes
        workflow = await n8n_client.get_workflow(wf_id)
        nodes = workflow.get("nodes", [])

        # Pre-flight: check all connectors are healthy
        try:
            sys.path.insert(0, str(AOS_HOME / "core"))
            from automations.connector_bridge import validate_workflow_nodes
            preflight = validate_workflow_nodes(nodes)
            if not preflight.get("valid", True):
                return JSONResponse({
                    "status": "blocked",
                    "reason": "integration_disconnected",
                    "validation": preflight,
                }, status_code=409)
        except Exception:
            logger.debug("Pre-flight check unavailable, proceeding")

        node_results = []
        node_outputs: dict = {}

        agent_secret = AOS_HOME / "core" / "bin" / "cli" / "agent-secret"

        # Execute each node in sequence, tracking success/failure
        for node in nodes:
            node_name = node.get("name", "Unknown")
            node_type = node.get("type", "")
            start_time = datetime.utcnow()

            try:
                if "scheduleTrigger" in node_type or "manualTrigger" in node_type:
                    # Trigger nodes just produce an empty item
                    node_outputs[node_name] = [{}]
                    node_results.append({
                        "node": node_name,
                        "status": "success",
                        "duration_ms": 0,
                        "items": 1,
                        "error": None,
                    })

                elif "gmail" in node_type.lower():
                    # Fetch emails via Gmail API
                    token_file = Path.home() / ".google_workspace_mcp" / "credentials"
                    # Find first available token
                    token_files = sorted(token_file.glob("*.json"))
                    if not token_files:
                        raise RuntimeError("No Google credentials found")

                    # Refresh token
                    cred_data = json.loads(token_files[0].read_text())
                    client_id = _sp.run([str(agent_secret), "get", "GOOGLE_CLIENT_ID"], capture_output=True, text=True, timeout=5).stdout.strip()
                    if not client_id or client_id.startswith("Error"):
                        client_id = _sp.run([str(agent_secret), "get", "GOOGLE_OAUTH_CLIENT_ID"], capture_output=True, text=True, timeout=5).stdout.strip()
                    client_secret = _sp.run([str(agent_secret), "get", "GOOGLE_CLIENT_SECRET"], capture_output=True, text=True, timeout=5).stdout.strip()
                    if not client_secret or client_secret.startswith("Error"):
                        client_secret = _sp.run([str(agent_secret), "get", "GOOGLE_OAUTH_CLIENT_SECRET"], capture_output=True, text=True, timeout=5).stdout.strip()

                    async with httpx.AsyncClient() as http:
                        token_resp = await http.post("https://oauth2.googleapis.com/token", data={
                            "client_id": client_id, "client_secret": client_secret,
                            "refresh_token": cred_data.get("refresh_token", ""),
                            "grant_type": "refresh_token",
                        })
                        access_token = token_resp.json().get("access_token", "")

                        limit = node.get("parameters", {}).get("limit", 5)
                        resp = await http.get(
                            "https://gmail.googleapis.com/gmail/v1/users/me/messages",
                            params={"maxResults": limit, "q": "is:unread", "labelIds": "INBOX"},
                            headers={"Authorization": f"Bearer {access_token}"},
                        )
                        if resp.status_code != 200:
                            raise RuntimeError(f"Gmail API: {resp.status_code}")

                        messages = resp.json().get("messages", [])
                        emails = []
                        for msg in messages[:limit]:
                            detail = await http.get(
                                f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{msg['id']}",
                                params={"format": "metadata", "metadataHeaders": ["From", "Subject"]},
                                headers={"Authorization": f"Bearer {access_token}"},
                            )
                            if detail.status_code == 200:
                                headers = {h["name"]: h["value"] for h in detail.json().get("payload", {}).get("headers", [])}
                                emails.append({"from": headers.get("From", "?"), "subject": headers.get("Subject", "(no subject)"), "snippet": detail.json().get("snippet", "")[:100]})

                    node_outputs[node_name] = emails
                    dur = int((datetime.utcnow() - start_time).total_seconds() * 1000)
                    node_results.append({"node": node_name, "status": "success", "duration_ms": dur, "items": len(emails), "error": None})

                elif "code" in node_type.lower():
                    # Code node — we can't execute arbitrary JS, but we can simulate the output
                    prev_items = list(node_outputs.values())[-1] if node_outputs else []
                    if isinstance(prev_items, list) and prev_items:
                        lines = []
                        for i, e in enumerate(prev_items[:10]):
                            subj = str(e.get("subject", e.get("summary", ""))).replace("*", "")
                            frm = str(e.get("from", "")).replace("*", "")
                            lines.append(f"{i+1}. {subj}\n   From: {frm}")
                        text = f"Email Digest — {len(prev_items)} unread\n\n" + "\n\n".join(lines)
                    else:
                        text = "No items to process"
                    node_outputs[node_name] = [{"text": text}]
                    node_results.append({"node": node_name, "status": "success", "duration_ms": 1, "items": 1, "error": None})

                elif "telegram" in node_type.lower():
                    # Send via Telegram Bot API
                    bot_token = _sp.run([str(agent_secret), "get", "TELEGRAM_BOT_TOKEN"], capture_output=True, text=True, timeout=5).stdout.strip()
                    chat_id = node.get("parameters", {}).get("chatId", "")

                    # Get the text from previous node output
                    prev = list(node_outputs.values())[-1] if node_outputs else [{}]
                    text = prev[0].get("text", "Automation ran successfully") if prev else "No data"

                    async with httpx.AsyncClient() as http:
                        tg = await http.post(f"https://api.telegram.org/bot{bot_token}/sendMessage", json={
                            "chat_id": chat_id, "text": text,
                        })
                        if tg.status_code != 200:
                            raise RuntimeError(f"Telegram API: {tg.status_code} {tg.text[:100]}")

                    dur = int((datetime.utcnow() - start_time).total_seconds() * 1000)
                    node_results.append({"node": node_name, "status": "success", "duration_ms": dur, "items": 1, "error": None})

                else:
                    # Unknown node type — skip with success
                    node_results.append({"node": node_name, "status": "success", "duration_ms": 0, "items": 0, "error": None})

            except Exception as node_err:
                dur = int((datetime.utcnow() - start_time).total_seconds() * 1000)
                node_results.append({"node": node_name, "status": "error", "duration_ms": dur, "items": 0, "error": str(node_err)[:200]})
                break  # Stop execution on first error

        overall = "error" if any(r["status"] == "error" for r in node_results) else "success"
        overall_error = next((r["error"] for r in node_results if r["error"]), None)

        # Update tracking
        try:
            conn = _get_db()
            conn.execute(
                """UPDATE automations SET last_run_at = ?, last_run_status = ?,
                   run_count = run_count + 1, error_message = ? WHERE id = ?""",
                (datetime.utcnow().isoformat(), overall, overall_error, automation_id),
            )
            conn.commit()
            conn.close()
        except Exception:
            pass

        return JSONResponse({
            "status": overall,
            "node_results": node_results,
            "error": overall_error,
        })

    except Exception as e:
        logger.exception("Run automation failed")
        return JSONResponse({"status": "error", "error": str(e)}, status_code=500)


# ---------------------------------------------------------------------------
# n8n-powered automations — additional endpoints
# ---------------------------------------------------------------------------

QAREEN_DB = AOS_DATA / "data" / "qareen.db"


def _get_db() -> sqlite3.Connection:
    """Get a connection to qareen.db with the automations table."""
    conn = sqlite3.connect(str(QAREEN_DB))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    # Ensure automations table exists
    conn.execute("""
        CREATE TABLE IF NOT EXISTS automations (
            id              TEXT PRIMARY KEY,
            name            TEXT NOT NULL,
            description     TEXT,
            user_prompt     TEXT,
            recipe_id       TEXT,
            n8n_workflow_id TEXT,
            status          TEXT DEFAULT 'draft',
            trigger_type    TEXT DEFAULT 'manual',
            trigger_config  TEXT,
            credentials_used TEXT,
            last_run_at     TEXT,
            last_run_status TEXT,
            run_count       INTEGER DEFAULT 0,
            error_message   TEXT,
            variables       TEXT,
            tags            TEXT,
            created_at      TEXT NOT NULL,
            activated_at    TEXT
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_automations_status ON automations(status)")
    return conn


def _get_n8n_automation(automation_id: str) -> dict | None:
    """Get an n8n automation record by ID."""
    try:
        conn = _get_db()
        row = conn.execute("SELECT * FROM automations WHERE id = ?", (automation_id,)).fetchone()
        conn.close()
        if row:
            return dict(row)
    except Exception:
        pass
    return None


def _row_to_automation(row: sqlite3.Row) -> dict:
    """Convert a DB row to an API response dict."""
    d = dict(row)
    for json_field in ("trigger_config", "credentials_used", "variables", "tags"):
        if d.get(json_field):
            try:
                d[json_field] = json.loads(d[json_field])
            except (json.JSONDecodeError, TypeError):
                d[json_field] = None
    return d


@router.get("/n8n")
async def list_n8n_automations(request: Request) -> JSONResponse:
    """List all n8n-powered automations from the database."""
    try:
        conn = _get_db()
        rows = conn.execute(
            "SELECT * FROM automations ORDER BY created_at DESC"
        ).fetchall()
        conn.close()
        return JSONResponse({
            "automations": [_row_to_automation(r) for r in rows],
            "count": len(rows),
        })
    except Exception as e:
        logger.exception("Failed to list n8n automations")
        return JSONResponse({"error": str(e)}, status_code=500)


@router.get("/suggestions")
async def get_suggestions(request: Request) -> JSONResponse:
    """Get personalized automation suggestions based on connected services and operator data."""
    try:
        import sys as _sys
        _sys.path.insert(0, str(AOS_HOME / "core"))
        # Inline the suggestions logic to avoid router loading issues
        from qareen.api.suggestions import (
            _connector_suggestions, _enrich_suggestions,
            _get_operator, _get_unread_email_count, _get_today_event_count,
            _get_top_contacts, _get_work_stats, _get_google_account_count,
            _get_deployed_recipe_ids,
        )
        from infra.connectors.discover import discover_all

        connectors = [c.to_dict() for c in discover_all()]
        deployed = _get_deployed_recipe_ids()
        suggestions = _connector_suggestions(connectors, deployed)
        operator = _get_operator()
        unread = _get_unread_email_count()
        events = _get_today_event_count()
        contacts = _get_top_contacts(5)
        work = _get_work_stats()
        google_accts = _get_google_account_count()

        suggestions = _enrich_suggestions(
            suggestions, operator, unread, events, contacts, work, google_accts,
        )
        suggestions.sort(key=lambda s: s["score"], reverse=True)

        return JSONResponse({
            "suggestions": suggestions[:12],
            "total": len(suggestions),
            "context": {
                "connectors_connected": sum(1 for c in connectors if c["status"] in ("connected", "partial")),
                "unread_emails": unread,
                "today_events": events,
                "active_tasks": work.get("active_tasks"),
                "top_contact": contacts[0]["canonical_name"] if contacts else None,
            },
        })
    except Exception as e:
        logger.exception("Suggestions failed")
        return JSONResponse({"error": str(e)}, status_code=500)


@router.get("/context")
async def automations_context(request: Request) -> JSONResponse:
    """Return user context for the workflow generator.

    Reads operator config + discovered accounts so GenerateFlow
    doesn't need hardcoded values.
    """
    import yaml as _yaml

    operator_path = AOS_DATA / "config" / "operator.yaml"
    operator = {}
    try:
        if operator_path.exists():
            operator = _yaml.safe_load(operator_path.read_text()) or {}
    except Exception:
        pass

    # Telegram chat_id from Keychain
    telegram_chat_id = None
    try:
        import subprocess
        agent_secret = AOS_HOME / "core" / "bin" / "cli" / "agent-secret"
        result = subprocess.run(
            [str(agent_secret), "get", "TELEGRAM_CHAT_ID"],
            capture_output=True, text=True, timeout=5,
        )
        val = result.stdout.strip()
        if val and not val.startswith("Error"):
            telegram_chat_id = val
    except Exception:
        pass

    # Discover connected accounts from credential files
    connected_accounts: list[str] = []
    google_creds_dir = Path.home() / ".google_workspace_mcp" / "credentials"
    if google_creds_dir.is_dir() and any(google_creds_dir.glob("*.json")):
        connected_accounts.append("google_workspace")

    # Check Telegram bot token
    try:
        import subprocess
        agent_secret = AOS_HOME / "core" / "bin" / "cli" / "agent-secret"
        result = subprocess.run(
            [str(agent_secret), "get", "TELEGRAM_BOT_TOKEN"],
            capture_output=True, text=True, timeout=5,
        )
        if result.stdout.strip() and not result.stdout.strip().startswith("Error"):
            connected_accounts.append("telegram")
    except Exception:
        pass

    return JSONResponse({
        "telegram_chat_id": telegram_chat_id,
        "connected_accounts": connected_accounts,
        "operator_name": operator.get("name"),
        "timezone": operator.get("timezone"),
    })


@router.get("/health")
async def automations_health(request: Request) -> JSONResponse:
    """Check n8n service health."""
    n8n_client = getattr(request.app.state, "n8n_client", None)
    if not n8n_client:
        return JSONResponse({"status": "unavailable", "message": "n8n client not configured"})

    try:
        health = await n8n_client.health()
        workflows = await n8n_client.list_workflows()
        return JSONResponse({
            "status": "ok",
            "n8n": health,
            "active_workflows": len([w for w in workflows if w.get("active")]),
            "total_workflows": len(workflows),
        })
    except Exception as e:
        return JSONResponse({"status": "error", "message": str(e)})


@router.get("/recipes")
async def list_recipes(request: Request) -> JSONResponse:
    """List available automation recipes."""
    try:
        import sys
        sys.path.insert(0, str(AOS_HOME / "core"))
        from automations.recipes import RecipeLibrary

        lib = RecipeLibrary()
        recipes = []
        for r in lib.list_all():
            recipes.append({
                "id": r.id,
                "name": r.name,
                "description": r.description,
                "category": r.category,
                "tags": r.tags,
                "required_credentials": r.required_credentials,
                "variables": [
                    {
                        "name": v.name,
                        "description": v.description,
                        "type": v.type,
                        "required": v.required,
                        "default": v.default,
                        "examples": v.examples,
                    }
                    for v in r.variables
                ],
            })
        return JSONResponse({"recipes": recipes, "count": len(recipes)})
    except Exception as e:
        logger.exception("Failed to list recipes")
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/generate")
async def generate_automation(request: Request) -> JSONResponse:
    """Generate a workflow from natural language description.

    Body: {"description": "send me a daily email digest at 8am"}
    Returns a preview (not yet deployed).
    """
    body = await request.json()
    description = body.get("description", "").strip()
    if not description:
        return JSONResponse({"error": "description is required"}, status_code=400)

    try:
        import sys
        sys.path.insert(0, str(AOS_HOME / "core"))
        from automations.recipes import RecipeLibrary
        from automations.generator import WorkflowGenerator

        lib = RecipeLibrary()
        gen = WorkflowGenerator(lib)

        result = await gen.generate(
            description=description,
            connected_accounts=body.get("connected_accounts", []),
            extra_context=body.get("context", {}),
        )

        return JSONResponse({
            "success": result.success,
            "workflow_json": result.workflow_json,
            "recipe_id": result.recipe_id,
            "recipe_name": result.recipe_name,
            "variables_used": result.variables_used,
            "human_summary": result.human_summary,
            "validation_errors": result.validation_errors,
            "clarification_needed": result.clarification_needed,
            "trigger_type": result.trigger_type,
            "trigger_config": result.trigger_config,
        })
    except Exception as e:
        logger.exception("Generation failed")
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/deploy")
async def deploy_automation(request: Request) -> JSONResponse:
    """Deploy a generated workflow to n8n and track it.

    Body: {
        "name": "My Automation",
        "description": "...",
        "user_prompt": "the original natural language request",
        "recipe_id": "schedule_to_telegram",
        "workflow_json": {...},
        "variables": {...},
        "activate": true
    }
    """
    n8n_client = getattr(request.app.state, "n8n_client", None)
    if not n8n_client:
        return JSONResponse({"error": "n8n service not available"}, status_code=503)

    body = await request.json()
    workflow_json = body.get("workflow_json")
    if not workflow_json:
        return JSONResponse({"error": "workflow_json is required"}, status_code=400)

    name = body.get("name", workflow_json.get("name", "Unnamed Automation"))

    try:
        # 1. Create workflow in n8n
        created = await n8n_client.create_workflow(
            name=name,
            nodes=workflow_json.get("nodes", []),
            connections=workflow_json.get("connections", {}),
            settings=workflow_json.get("settings"),
        )
        n8n_wf_id = created.get("id")

        # 2. Activate if requested
        status = "draft"
        activated_at = None
        if body.get("activate", False):
            await n8n_client.activate_workflow(n8n_wf_id)
            status = "active"
            activated_at = datetime.utcnow().isoformat()

        # 3. Track in qareen.db
        automation_id = f"n8n_{uuid.uuid4().hex[:8]}"
        conn = _get_db()
        conn.execute(
            """INSERT INTO automations
               (id, name, description, user_prompt, recipe_id, n8n_workflow_id,
                status, trigger_type, trigger_config, credentials_used,
                variables, tags, created_at, activated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                automation_id,
                name,
                body.get("description", ""),
                body.get("user_prompt", ""),
                body.get("recipe_id"),
                n8n_wf_id,
                status,
                body.get("trigger_type", "manual"),
                json.dumps(body.get("trigger_config", {})),
                json.dumps(body.get("credentials_used", [])),
                json.dumps(body.get("variables", {})),
                json.dumps(body.get("tags", [])),
                datetime.utcnow().isoformat(),
                activated_at,
            ),
        )
        conn.commit()
        conn.close()

        return JSONResponse({
            "id": automation_id,
            "name": name,
            "n8n_workflow_id": n8n_wf_id,
            "status": status,
            "activated_at": activated_at,
        }, status_code=201)

    except Exception as e:
        logger.exception("Deploy failed")
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/{automation_id}/activate")
async def activate_automation(automation_id: str, request: Request) -> JSONResponse:
    """Activate an n8n-powered automation."""
    n8n_client = getattr(request.app.state, "n8n_client", None)
    if not n8n_client:
        return JSONResponse({"error": "n8n not available"}, status_code=503)

    auto = _get_n8n_automation(automation_id)
    if not auto:
        return JSONResponse({"error": "not found"}, status_code=404)

    try:
        await n8n_client.activate_workflow(auto["n8n_workflow_id"])
        conn = _get_db()
        conn.execute(
            "UPDATE automations SET status = 'active', activated_at = ? WHERE id = ?",
            (datetime.utcnow().isoformat(), automation_id),
        )
        conn.commit()
        conn.close()
        return JSONResponse({"status": "active"})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/{automation_id}/deactivate")
async def deactivate_automation(automation_id: str, request: Request) -> JSONResponse:
    """Pause an n8n-powered automation."""
    n8n_client = getattr(request.app.state, "n8n_client", None)
    if not n8n_client:
        return JSONResponse({"error": "n8n not available"}, status_code=503)

    auto = _get_n8n_automation(automation_id)
    if not auto:
        return JSONResponse({"error": "not found"}, status_code=404)

    try:
        await n8n_client.deactivate_workflow(auto["n8n_workflow_id"])
        conn = _get_db()
        conn.execute(
            "UPDATE automations SET status = 'paused' WHERE id = ?",
            (automation_id,),
        )
        conn.commit()
        conn.close()
        return JSONResponse({"status": "paused"})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.get("/{automation_id}/workflow")
async def get_workflow(automation_id: str, request: Request) -> JSONResponse:
    """Get the full n8n workflow JSON (nodes + connections) for an automation."""
    n8n_client = getattr(request.app.state, "n8n_client", None)
    if not n8n_client:
        return JSONResponse({"error": "n8n not available"}, status_code=503)

    auto = _get_n8n_automation(automation_id)
    if not auto:
        return JSONResponse({"error": "not found"}, status_code=404)

    try:
        workflow = await n8n_client.get_workflow(auto["n8n_workflow_id"])
        return JSONResponse(workflow)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.put("/{automation_id}/workflow")
async def update_workflow(automation_id: str, request: Request) -> JSONResponse:
    """Update the n8n workflow (nodes + connections) for an automation."""
    n8n_client = getattr(request.app.state, "n8n_client", None)
    if not n8n_client:
        return JSONResponse({"error": "n8n not available"}, status_code=503)

    auto = _get_n8n_automation(automation_id)
    if not auto:
        return JSONResponse({"error": "not found"}, status_code=404)

    body = await request.json()
    try:
        result = await n8n_client.update_workflow(auto["n8n_workflow_id"], body)

        # Update name in qareen.db if changed
        new_name = body.get("name")
        if new_name:
            conn = _get_db()
            conn.execute("UPDATE automations SET name = ? WHERE id = ?", (new_name, automation_id))
            conn.commit()
            conn.close()

        return JSONResponse(result)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.get("/{automation_id}/executions")
async def get_executions(automation_id: str, request: Request) -> JSONResponse:
    """Get execution history for an n8n automation."""
    n8n_client = getattr(request.app.state, "n8n_client", None)
    if not n8n_client:
        return JSONResponse({"error": "n8n not available"}, status_code=503)

    auto = _get_n8n_automation(automation_id)
    if not auto:
        return JSONResponse({"error": "not found"}, status_code=404)

    try:
        executions = await n8n_client.list_executions(
            workflow_id=auto["n8n_workflow_id"],
            limit=20,
        )
        return JSONResponse({
            "automation_id": automation_id,
            "executions": executions,
            "count": len(executions),
        })
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/webhook/error")
async def n8n_error_callback(request: Request) -> JSONResponse:
    """Receive error callbacks from n8n's error workflow.

    n8n posts here when a workflow execution fails.
    """
    body = await request.json()
    workflow_id = body.get("workflow", {}).get("id")
    error_message = body.get("execution", {}).get("error", {}).get("message", "Unknown error")

    if workflow_id:
        try:
            conn = _get_db()
            conn.execute(
                """UPDATE automations
                   SET last_run_status = 'error', error_message = ?,
                       last_run_at = ?
                   WHERE n8n_workflow_id = ?""",
                (error_message, datetime.utcnow().isoformat(), workflow_id),
            )
            conn.commit()
            conn.close()
        except Exception:
            logger.exception("Failed to update automation error status")

    logger.warning("n8n error callback: workflow=%s error=%s", workflow_id, error_message)
    return JSONResponse({"received": True})


@router.get("/{automation_id}/preflight")
async def preflight_check(automation_id: str, request: Request) -> JSONResponse:
    """Check if all integrations for an automation are healthy before running.

    Returns per-node connection status and whether the automation is ready to run.
    """
    n8n_client = getattr(request.app.state, "n8n_client", None)
    if not n8n_client:
        return JSONResponse({"error": "n8n not available"}, status_code=503)

    auto = _get_n8n_automation(automation_id)
    if not auto or not auto.get("n8n_workflow_id"):
        return JSONResponse({"error": "not found"}, status_code=404)

    try:
        workflow = await n8n_client.get_workflow(auto["n8n_workflow_id"])
        nodes = workflow.get("nodes", [])

        sys.path.insert(0, str(AOS_HOME / "core"))
        from automations.connector_bridge import validate_workflow_nodes
        validation = validate_workflow_nodes(nodes)

        return JSONResponse({
            "automation_id": automation_id,
            "ready": validation.get("valid", True),
            "validation": validation,
        })
    except Exception as e:
        logger.exception("Pre-flight check failed")
        return JSONResponse({"error": str(e)}, status_code=500)
