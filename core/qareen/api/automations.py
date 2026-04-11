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


# ---------------------------------------------------------------------------
# Node executor — modular per-type execution with real API calls
# ---------------------------------------------------------------------------

_AGENT_SECRET = AOS_HOME / "core" / "bin" / "cli" / "agent-secret"


def _secret(key: str) -> str:
    """Read a secret from macOS Keychain."""
    import subprocess as _sp
    r = _sp.run([str(_AGENT_SECRET), "get", key], capture_output=True, text=True, timeout=5)
    val = r.stdout.strip()
    if not val or r.returncode != 0 or val.startswith("Error"):
        return ""
    return val


async def _exec_trigger(node: dict, prev_outputs: dict) -> list:
    """Trigger nodes produce a single empty item."""
    return [{}]


async def _exec_gmail(node: dict, prev_outputs: dict) -> list:
    """Execute Gmail node — real API call."""
    import httpx
    token_dir = Path.home() / ".aos" / "config" / "google" / "credentials"
    token_files = sorted(token_dir.glob("*.json"))
    if not token_files:
        raise RuntimeError("No Google credentials found")

    cred_data = json.loads(token_files[0].read_text())
    client_id = _secret("GOOGLE_OAUTH_CLIENT_ID") or _secret("GOOGLE_CLIENT_ID")
    client_secret = _secret("GOOGLE_OAUTH_CLIENT_SECRET") or _secret("GOOGLE_CLIENT_SECRET")

    async with httpx.AsyncClient() as http:
        tok = await http.post("https://oauth2.googleapis.com/token", data={
            "client_id": client_id, "client_secret": client_secret,
            "refresh_token": cred_data.get("refresh_token", ""),
            "grant_type": "refresh_token",
        })
        access_token = tok.json().get("access_token", "")
        if not access_token:
            raise RuntimeError("Failed to refresh Google token")

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
                hdrs = {h["name"]: h["value"] for h in detail.json().get("payload", {}).get("headers", [])}
                emails.append({
                    "from": hdrs.get("From", "?"),
                    "subject": hdrs.get("Subject", "(no subject)"),
                    "snippet": detail.json().get("snippet", "")[:100],
                })
    return emails


async def _exec_telegram(node: dict, prev_outputs: dict) -> list:
    """Execute Telegram node — real Bot API call."""
    import httpx
    bot_token = _secret("TELEGRAM_BOT_TOKEN")
    chat_id = node.get("parameters", {}).get("chatId", "")

    prev = list(prev_outputs.values())[-1] if prev_outputs else [{}]
    text = prev[0].get("text", "Automation ran successfully") if prev else "No data"

    async with httpx.AsyncClient() as http:
        tg = await http.post(f"https://api.telegram.org/bot{bot_token}/sendMessage", json={
            "chat_id": chat_id, "text": text,
        })
        if tg.status_code != 200:
            raise RuntimeError(f"Telegram API: {tg.status_code} {tg.text[:100]}")
    return [{"sent": True, "chat_id": chat_id}]


async def _exec_http_request(node: dict, prev_outputs: dict) -> list:
    """Execute HTTP Request node — real HTTP call."""
    import httpx
    params = node.get("parameters", {})
    method = params.get("method", "GET")
    url = params.get("url", "")
    if not url:
        raise RuntimeError("No URL specified")

    async with httpx.AsyncClient(timeout=30.0) as http:
        resp = await http.request(method, url)
        try:
            body = resp.json()
        except Exception:
            body = {"text": resp.text[:500]}
    return [{"statusCode": resp.status_code, "body": body}]


async def _exec_code(node: dict, prev_outputs: dict) -> list:
    """Code node — pass through previous items with a note. Cannot execute JS."""
    prev = list(prev_outputs.values())[-1] if prev_outputs else []
    if isinstance(prev, list) and prev:
        lines = []
        for i, item in enumerate(prev[:10]):
            subj = str(item.get("subject", item.get("summary", ""))).replace("*", "")
            frm = str(item.get("from", "")).replace("*", "")
            if subj or frm:
                lines.append(f"{i+1}. {subj}\n   From: {frm}")
        text = f"Digest — {len(prev)} items\n\n" + "\n\n".join(lines) if lines else str(prev[0])
    else:
        text = "No items to process"
    return [{"text": text}]


async def _exec_passthrough(node: dict, prev_outputs: dict) -> list:
    """Unknown node — pass through previous output."""
    prev = list(prev_outputs.values())[-1] if prev_outputs else [{}]
    return prev if isinstance(prev, list) else [prev]


# Node type → executor mapping
_NODE_EXECUTORS: dict = {
    "scheduleTrigger": _exec_trigger,
    "manualTrigger": _exec_trigger,
    "webhook": _exec_trigger,
    "gmail": _exec_gmail,
    "googleCalendar": _exec_passthrough,
    "telegram": _exec_telegram,
    "httpRequest": _exec_http_request,
    "code": _exec_code,
    "set": _exec_passthrough,
    "if": _exec_passthrough,
    "switch": _exec_passthrough,
}


def _match_executor(node_type: str):
    """Find the executor for a node type by matching against the registry."""
    type_lower = node_type.lower()
    for key, fn in _NODE_EXECUTORS.items():
        if key.lower() in type_lower:
            return fn, key != "code"  # (executor, is_real)
    return _exec_passthrough, False


async def _execute_workflow_nodes(nodes: list[dict]) -> dict:
    """Execute workflow nodes sequentially, returning per-node results."""
    node_results = []
    node_outputs: dict = {}

    for node in nodes:
        node_name = node.get("name", "Unknown")
        node_type = node.get("type", "")
        start_time = datetime.utcnow()
        executor, is_real = _match_executor(node_type)

        try:
            items = await executor(node, node_outputs)
            node_outputs[node_name] = items
            dur = int((datetime.utcnow() - start_time).total_seconds() * 1000)
            node_results.append({
                "node": node_name,
                "status": "success",
                "duration_ms": dur,
                "items": len(items) if isinstance(items, list) else 1,
                "error": None,
                "simulated": not is_real,
            })
        except Exception as e:
            dur = int((datetime.utcnow() - start_time).total_seconds() * 1000)
            node_results.append({
                "node": node_name,
                "status": "error",
                "duration_ms": dur,
                "items": 0,
                "error": str(e)[:200],
                "simulated": False,
            })
            break

    overall = "error" if any(r["status"] == "error" for r in node_results) else "success"
    overall_error = next((r["error"] for r in node_results if r["error"]), None)
    return {"status": overall, "node_results": node_results, "error": overall_error}


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

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

    # n8n-powered automation — execute workflow via custom node executor
    n8n_client = getattr(request.app.state, "n8n_client", None)
    if not n8n_client:
        return JSONResponse({"error": "n8n not available"}, status_code=503)

    auto = _get_n8n_automation(automation_id)
    if not auto or not auto.get("n8n_workflow_id"):
        return JSONResponse({"error": "not found"}, status_code=404)

    wf_id = auto["n8n_workflow_id"]

    try:
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

        result = await _execute_workflow_nodes(nodes)

        # Update tracking
        try:
            conn = _get_db()
            conn.execute(
                """UPDATE automations SET last_run_at = ?, last_run_status = ?,
                   run_count = run_count + 1, error_message = ? WHERE id = ?""",
                (datetime.utcnow().isoformat(), result["status"],
                 result["error"], automation_id),
            )
            conn.commit()
            conn.close()
        except Exception:
            pass

        return JSONResponse(result)

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


@router.post("/create")
async def create_automation(request: Request) -> JSONResponse:
    """Create a new empty automation record and return its ID."""
    try:
        body = await request.json()
    except Exception:
        body = {}
    aid = f"n8n_{uuid.uuid4().hex[:8]}"
    try:
        conn = _get_db()
        conn.execute(
            "INSERT INTO automations (id, name, status, created_at) VALUES (?, ?, ?, ?)",
            (aid, body.get("name", "Untitled Automation"), "draft", datetime.utcnow().isoformat()),
        )
        conn.commit()
        conn.close()
        return JSONResponse({"id": aid})
    except Exception as e:
        logger.exception("Failed to create automation")
        return JSONResponse({"error": str(e)}, status_code=500)


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
    google_creds_dir = Path.home() / ".aos" / "config" / "google" / "credentials"
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


@router.get("/{automation_id}/webhook-url")
async def get_webhook_url(automation_id: str, request: Request) -> JSONResponse:
    """Get the webhook URL for a webhook-triggered automation."""
    record = _get_n8n_automation(automation_id)
    if not record:
        return JSONResponse({"error": "Not found"}, status_code=404)

    # Check trigger_config for cached webhook info
    trigger_config = record.get("trigger_config")
    if trigger_config and isinstance(trigger_config, str):
        try:
            trigger_config = json.loads(trigger_config)
        except (json.JSONDecodeError, TypeError):
            trigger_config = {}

    if isinstance(trigger_config, dict) and trigger_config.get("webhook_path"):
        return JSONResponse({
            "webhook_url": f"http://localhost:5678/webhook/{trigger_config['webhook_path']}",
            "method": trigger_config.get("method", "POST"),
        })

    # If no cached info, check n8n directly
    n8n_wf_id = record.get("n8n_workflow_id")
    if not n8n_wf_id:
        return JSONResponse({"error": "No webhook configured", "webhook_url": None})

    n8n_client = getattr(request.app.state, "n8n_client", None)
    if not n8n_client:
        return JSONResponse({"error": "n8n not available", "webhook_url": None})

    try:
        workflow = await n8n_client.get_workflow(n8n_wf_id)
        nodes = workflow.get("nodes", [])
        for node in nodes:
            if node.get("type") == "n8n-nodes-base.webhook":
                path = node.get("parameters", {}).get("path", "")
                method = node.get("parameters", {}).get("httpMethod", "POST")
                # Cache it in trigger_config for next time
                try:
                    conn = _get_db()
                    conn.execute(
                        "UPDATE automations SET trigger_config = ? WHERE id = ?",
                        (json.dumps({"webhook_path": path, "method": method}), automation_id),
                    )
                    conn.commit()
                    conn.close()
                except Exception:
                    pass
                return JSONResponse({
                    "webhook_url": f"http://localhost:5678/webhook/{path}",
                    "method": method,
                })
        return JSONResponse({"error": "No webhook node found", "webhook_url": None})
    except Exception as e:
        logger.exception("Failed to get webhook URL")
        return JSONResponse({"error": str(e), "webhook_url": None})


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


# ---------------------------------------------------------------------------
# Lifecycle state machine — unified status transitions with n8n sync
# ---------------------------------------------------------------------------

# Valid transitions: {current_status: {action: new_status}}
_TRANSITIONS: dict[str, dict[str, str]] = {
    "draft":    {"activate": "active", "archive": "archived", "delete": "_delete"},
    "active":   {"pause": "paused", "deactivate": "paused", "archive": "archived", "delete": "_delete"},
    "paused":   {"resume": "active", "activate": "active", "archive": "archived", "delete": "_delete"},
    "error":    {"activate": "active", "resume": "active", "archive": "archived", "delete": "_delete"},
    "archived": {"activate": "active", "delete": "_delete"},
}


async def _transition_status(
    automation_id: str, action: str, n8n_client,
) -> dict:
    """Execute a lifecycle transition with n8n sync.

    Returns {"status": new_status} on success.
    Raises ValueError for invalid transitions.
    """
    auto = _get_n8n_automation(automation_id)
    if not auto:
        raise ValueError("Automation not found")

    current = auto.get("status", "draft")
    allowed = _TRANSITIONS.get(current, {})
    if action not in allowed:
        raise ValueError(
            f"Cannot '{action}' from '{current}'. "
            f"Allowed: {', '.join(allowed.keys()) if allowed else 'none'}"
        )

    new_status = allowed[action]
    wf_id = auto.get("n8n_workflow_id")

    # n8n side effects
    if new_status == "active" and wf_id and n8n_client:
        await n8n_client.activate_workflow(wf_id)
    elif new_status in ("paused", "archived") and wf_id and n8n_client:
        try:
            await n8n_client.deactivate_workflow(wf_id)
        except Exception:
            pass  # OK if already inactive

    # Delete path
    if new_status == "_delete":
        if wf_id and n8n_client:
            try:
                await n8n_client.deactivate_workflow(wf_id)
            except Exception:
                pass
            try:
                await n8n_client.delete_workflow(wf_id)
            except Exception:
                logger.warning(f"Failed to delete n8n workflow {wf_id}")
        conn = _get_db()
        conn.execute("DELETE FROM automations WHERE id = ?", (automation_id,))
        conn.commit()
        conn.close()
        return {"status": "deleted", "id": automation_id}

    # Update DB
    conn = _get_db()
    if new_status == "active":
        conn.execute(
            "UPDATE automations SET status = ?, activated_at = ? WHERE id = ?",
            (new_status, datetime.utcnow().isoformat(), automation_id),
        )
    else:
        conn.execute(
            "UPDATE automations SET status = ? WHERE id = ?",
            (new_status, automation_id),
        )
    conn.commit()
    conn.close()
    return {"status": new_status, "id": automation_id}


@router.patch("/{automation_id}/status")
async def update_automation_status(automation_id: str, request: Request) -> JSONResponse:
    """Unified lifecycle transition: activate, pause, resume, archive, delete."""
    n8n_client = getattr(request.app.state, "n8n_client", None)
    body = await request.json()
    action = body.get("action", "")

    if not action:
        return JSONResponse({"error": "action required"}, status_code=400)

    try:
        result = await _transition_status(automation_id, action, n8n_client)
        return JSONResponse(result)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# Backward-compat endpoints — delegate to lifecycle engine
@router.post("/{automation_id}/activate")
async def activate_automation(automation_id: str, request: Request) -> JSONResponse:
    n8n_client = getattr(request.app.state, "n8n_client", None)
    try:
        return JSONResponse(await _transition_status(automation_id, "activate", n8n_client))
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/{automation_id}/deactivate")
async def deactivate_automation(automation_id: str, request: Request) -> JSONResponse:
    n8n_client = getattr(request.app.state, "n8n_client", None)
    try:
        return JSONResponse(await _transition_status(automation_id, "pause", n8n_client))
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
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

        # Update name + snapshot in qareen.db
        conn = _get_db()
        new_name = body.get("name")
        snapshot = json.dumps(body)
        if new_name:
            conn.execute(
                "UPDATE automations SET name = ?, workflow_snapshot = ? WHERE id = ?",
                (new_name, snapshot, automation_id),
            )
        else:
            conn.execute(
                "UPDATE automations SET workflow_snapshot = ? WHERE id = ?",
                (snapshot, automation_id),
            )
        conn.commit()
        conn.close()

        return JSONResponse(result)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.get("/{automation_id}/snapshot")
async def get_snapshot(automation_id: str, request: Request) -> JSONResponse:
    """Return the last saved workflow snapshot for restore."""
    auto = _get_n8n_automation(automation_id)
    if not auto:
        return JSONResponse({"error": "not found"}, status_code=404)
    raw = auto.get("workflow_snapshot")
    if not raw:
        return JSONResponse({"snapshot": None})
    try:
        return JSONResponse({"snapshot": json.loads(raw)})
    except (json.JSONDecodeError, TypeError):
        return JSONResponse({"snapshot": None})


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
