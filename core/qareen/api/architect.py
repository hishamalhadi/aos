"""Qareen API — Automation Architect routes.

Conversational automation designer that investigates the user's goal,
designs multi-pipeline FlowSystemSpec, and streams responses via SSE.

Endpoints:
  POST /api/architect/session           — Create a new architect session
  POST /api/architect/message           — Send a message, get SSE stream back
  GET  /api/architect/session/{id}      — Get session state
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, AsyncGenerator

import yaml
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/architect", tags=["architect"])

AOS_HOME = Path.home() / "aos"
AOS_DATA = Path.home() / ".aos"
AGENTS_DIR = Path.home() / ".claude" / "agents"
ARCHITECT_MD = AOS_HOME / "core" / "agents" / "automation-architect.md"


# ---------------------------------------------------------------------------
# Session store (SQLite-backed, survives restarts)
# ---------------------------------------------------------------------------

QAREEN_DB = AOS_DATA / "data" / "qareen.db"

# In-memory cache for active sessions (write-through to SQLite)
_sessions: dict[str, dict[str, Any]] = {}


def _get_db():
    """Get a connection to qareen.db with the architect_sessions table."""
    import sqlite3
    conn = sqlite3.connect(str(QAREEN_DB))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS architect_sessions (
            id          TEXT PRIMARY KEY,
            title       TEXT DEFAULT '',
            phase       TEXT DEFAULT 'investigate',
            messages    TEXT DEFAULT '[]',
            spec        TEXT,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        )
    """)
    return conn


def _new_session() -> dict[str, Any]:
    session = {
        "id": uuid.uuid4().hex[:12],
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
        "title": "",
        "messages": [],
        "spec": None,
        "phase": "investigate",
    }
    _save_session(session)
    return session


def _save_session(session: dict[str, Any]) -> None:
    """Write session to both cache and SQLite."""
    _sessions[session["id"]] = session
    session["updated_at"] = datetime.utcnow().isoformat()

    # Derive title from first user message or spec name
    if not session.get("title"):
        for msg in session.get("messages", []):
            if msg["role"] == "user":
                session["title"] = msg["content"][:80]
                break
    if session.get("spec") and session["spec"].get("name"):
        session["title"] = session["spec"]["name"]

    # Sanitize message content before persisting so bad chars never
    # accumulate in SQLite (prevents JSONDecodeError on later reads).
    sanitized_msgs = [_sanitize_message(m) for m in session.get("messages", [])]

    try:
        conn = _get_db()
        conn.execute(
            """INSERT INTO architect_sessions (id, title, phase, messages, spec, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 title=excluded.title, phase=excluded.phase,
                 messages=excluded.messages, spec=excluded.spec,
                 updated_at=excluded.updated_at""",
            (
                session["id"],
                session.get("title", ""),
                session["phase"],
                json.dumps(sanitized_msgs),
                json.dumps(session["spec"]) if session.get("spec") else None,
                session["created_at"],
                session["updated_at"],
            ),
        )
        conn.commit()
        conn.close()
    except Exception:
        logger.exception("Failed to save architect session %s", session["id"])


def _load_session(session_id: str) -> dict[str, Any] | None:
    """Load a session from cache or SQLite."""
    if session_id in _sessions:
        return _sessions[session_id]

    try:
        conn = _get_db()
        row = conn.execute(
            "SELECT * FROM architect_sessions WHERE id = ?", (session_id,)
        ).fetchone()
        conn.close()
        if row:
            session = {
                "id": row["id"],
                "title": row["title"] or "",
                "phase": row["phase"],
                "messages": json.loads(row["messages"]) if row["messages"] else [],
                "spec": json.loads(row["spec"]) if row["spec"] else None,
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }
            _sessions[session_id] = session
            return session
    except Exception:
        logger.exception("Failed to load architect session %s", session_id)

    return None


def _list_sessions(limit: int = 20) -> list[dict[str, Any]]:
    """List recent sessions from SQLite."""
    try:
        conn = _get_db()
        rows = conn.execute(
            "SELECT id, title, phase, created_at, updated_at FROM architect_sessions ORDER BY updated_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        conn.close()
        return [
            {
                "id": r["id"],
                "title": r["title"] or "Untitled",
                "phase": r["phase"],
                "created_at": r["created_at"],
                "updated_at": r["updated_at"],
            }
            for r in rows
        ]
    except Exception:
        logger.exception("Failed to list architect sessions")
        return []


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _sanitize_control_chars(text: str) -> str:
    """Remove ASCII control characters (except newline/tab/carriage-return).

    Claude responses can contain raw control chars (e.g. \x00-\x08, \x0b,
    \x0c, \x0e-\x1f) that cause json.dumps / JSONResponse to raise
    ``JSONDecodeError: Invalid control character``.  Replace them with
    spaces so the content stays readable.
    """
    # Keep \t (0x09), \n (0x0a), \r (0x0d) — json.dumps handles those.
    return re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', ' ', text)


def _sanitize_message(msg: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of a message dict with control chars cleaned from content."""
    cleaned = dict(msg)
    if isinstance(cleaned.get("content"), str):
        cleaned["content"] = _sanitize_control_chars(cleaned["content"])
    return cleaned


def _load_architect_system_prompt() -> str:
    """Load the automation-architect.md and extract the body as system prompt."""
    try:
        content = ARCHITECT_MD.read_text(encoding="utf-8")
        # Strip YAML frontmatter
        if content.startswith("---"):
            end = content.find("---", 3)
            if end != -1:
                content = content[end + 3:].lstrip("\n")
        return content
    except Exception:
        logger.exception("Failed to load architect system prompt")
        return "You are an automation architect. Design n8n workflow systems."


def _get_connector_context() -> str:
    """Get connected services summary for the architect prompt."""
    try:
        import sys
        sys.path.insert(0, str(AOS_HOME / "core"))
        from automations.connector_bridge import get_structured_context, to_prompt_text

        ctx = get_structured_context()
        return to_prompt_text(ctx)
    except Exception as e:
        logger.debug("Connector context failed: %s", e)
        return "Connector discovery unavailable."


def _get_available_agents() -> str:
    """Get list of available agents for dispatch."""
    agents = []
    if AGENTS_DIR.is_dir():
        for p in sorted(AGENTS_DIR.glob("*.md")):
            if p.stem.startswith(".") or p.stem.startswith("-"):
                continue
            try:
                text = p.read_text(encoding="utf-8", errors="replace")
                # Extract name from frontmatter
                name = p.stem
                desc = ""
                if text.startswith("---"):
                    end = text.find("---", 3)
                    if end != -1:
                        fm = yaml.safe_load(text[3:end])
                        if isinstance(fm, dict):
                            name = fm.get("name", p.stem)
                            desc = fm.get("description", "")
                agents.append(f"  - {p.stem}: {name} — {desc[:100]}")
            except Exception:
                agents.append(f"  - {p.stem}")
    return "Available agents for dispatch:\n" + "\n".join(agents) if agents else "No agents available."


def _get_operator_context() -> str:
    """Load operator profile context."""
    op_path = AOS_DATA / "config" / "operator.yaml"
    try:
        if op_path.exists():
            data = yaml.safe_load(op_path.read_text()) or {}
            name = data.get("name", "")
            tz = data.get("timezone", "")
            return f"Operator: {name}, timezone: {tz}" if name else ""
    except Exception:
        pass
    return ""


def _build_prompt(session: dict[str, Any], user_message: str) -> str:
    """Build the full prompt for the Claude call."""
    system_prompt = _load_architect_system_prompt()
    connector_ctx = _get_connector_context()
    agents_ctx = _get_available_agents()
    operator_ctx = _get_operator_context()

    # Build conversation history
    history_lines = []
    for msg in session["messages"]:
        role = msg["role"]
        text = msg["content"]
        if role == "user":
            history_lines.append(f"User: {text}")
        else:
            # Trim assistant responses to keep prompt manageable
            trimmed = text[:2000] + "..." if len(text) > 2000 else text
            history_lines.append(f"Assistant: {trimmed}")

    history = "\n\n".join(history_lines) if history_lines else "(No previous messages)"

    phase = session["phase"]
    msg_count = len(session["messages"])

    # Phase-specific instructions
    if phase == "investigate" and msg_count <= 1:
        phase_instruction = (
            "You are in the INVESTIGATE phase. State the objective in ONE line. "
            "Make executive decisions — pick the best defaults based on the connected "
            "services and common sense. Do NOT ask about which service to use, "
            "how to authenticate, or technical details — just use what's connected. "
            "Only ask ONE question if there's a genuine user PREFERENCE you can't "
            "infer (e.g. format, schedule, scope). Provide clickable options on lines "
            "starting with '> '. If everything is clear, skip straight to DESIGN. "
            "Do NOT produce any JSON yet. Keep it to 3-4 lines max."
        )
    elif phase == "investigate":
        phase_instruction = (
            "The user answered. Move to DESIGN now — produce the FlowSystemSpec "
            "JSON with a top-level \"pipelines\" array. Make executive decisions "
            "for any remaining details. Do NOT ask more questions."
        )
    elif phase == "design":
        phase_instruction = (
            "You are in the DESIGN phase. Produce the FlowSystemSpec JSON using "
            "EXACTLY the schema from your instructions. The JSON MUST have a "
            "top-level \"pipelines\" array with \"steps\" inside each pipeline. "
            "Do NOT use nodes/edges format."
        )
    elif phase == "confirm":
        phase_instruction = (
            "The user is providing feedback or requesting changes to the spec. "
            "Update the FlowSystemSpec based on their request and produce the "
            "UPDATED JSON using the same schema. Always include the full updated "
            "spec in a ```json block, not just the changed parts. Briefly explain "
            "what you changed."
        )

    prompt = f"""<system>
{system_prompt}

## Context

{connector_ctx}

{agents_ctx}

{operator_ctx}

## CURRENT PHASE: {phase.upper()}

{phase_instruction}
</system>

## Conversation History

{history}

## New Message

User: {user_message}"""

    return prompt


async def _claude_call_streaming(prompt: str, timeout_s: int = 180) -> AsyncGenerator[str, None]:
    """Call Claude via CLI --print and yield stdout in small chunks for smooth streaming."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "claude", "--print", "--model", "sonnet",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError:
        yield "[Error: claude CLI not found]"
        return

    # Send prompt via stdin and close
    assert proc.stdin is not None
    proc.stdin.write(prompt.encode())
    await proc.stdin.drain()
    proc.stdin.close()

    # Read stdout — claude --print outputs all at once, so we simulate
    # smooth streaming by yielding small slices with tiny delays
    assert proc.stdout is not None
    try:
        stdout, _ = await asyncio.wait_for(
            proc.communicate(), timeout=timeout_s
        )
        text = stdout.decode("utf-8", errors="replace")

        # Yield in word-sized chunks for smooth frontend animation
        i = 0
        chunk_size = 12  # ~2-3 words per chunk
        while i < len(text):
            end = min(i + chunk_size, len(text))
            # Don't split mid-word — extend to next space or newline
            if end < len(text) and text[end] not in (' ', '\n', '\t', '.', ',', ':', ';'):
                space = text.find(' ', end)
                nl = text.find('\n', end)
                if space == -1:
                    space = len(text)
                if nl == -1:
                    nl = len(text)
                end = min(space, nl, end + 20)  # cap extension at 20 chars
            yield text[i:end]
            i = end
            await asyncio.sleep(0.02)  # 20ms between chunks for smooth feel

    except asyncio.TimeoutError:
        proc.kill()
        yield "\n\n[Error: Claude timed out]"
    except Exception as e:
        proc.kill()
        yield f"\n\n[Error: {e}]"


# Map short/informal type names to full n8n types
_TYPE_ALIASES: dict[str, str] = {
    "gmail.getmessages": "n8n-nodes-base.gmail",
    "gmail.send": "n8n-nodes-base.gmail",
    "gmail": "n8n-nodes-base.gmail",
    "telegram.sendmessage": "n8n-nodes-base.telegram",
    "telegram": "n8n-nodes-base.telegram",
    "googlecalendar": "n8n-nodes-base.googleCalendar",
    "googlesheets": "n8n-nodes-base.googleSheets",
    "google_sheets": "n8n-nodes-base.googleSheets",
    "google_calendar": "n8n-nodes-base.googleCalendar",
    "google_calendar.list_events": "n8n-nodes-base.googleCalendar",
    "google_calendar.create_event": "n8n-nodes-base.googleCalendar",
    "googlecalendar.getall": "n8n-nodes-base.googleCalendar",
    "googlesheets.append": "n8n-nodes-base.googleSheets",
    "googlesheets.read": "n8n-nodes-base.googleSheets",
    "dedup": "n8n-nodes-base.code",
    "merge": "n8n-nodes-base.code",
    "transform": "n8n-nodes-base.code",
    "bash": "n8n-nodes-base.code",
    "shell": "n8n-nodes-base.code",
    "script": "n8n-nodes-base.code",
    "run_command": "n8n-nodes-base.code",
    "telegram_send": "n8n-nodes-base.telegram",
    "telegramsendmessage": "n8n-nodes-base.telegram",
    "telegram_bot": "n8n-nodes-base.telegram",
    "gmail.getall": "n8n-nodes-base.gmail",
    "gmail.read": "n8n-nodes-base.gmail",
    "gmail.search": "n8n-nodes-base.gmail",
    "http": "n8n-nodes-base.httpRequest",
    "httprequest": "n8n-nodes-base.httpRequest",
    "webhook": "n8n-nodes-base.webhook",
    "cron": "n8n-nodes-base.scheduleTrigger",
    "schedule": "n8n-nodes-base.scheduleTrigger",
    "scheduletrigger": "n8n-nodes-base.scheduleTrigger",
    "if": "n8n-nodes-base.if",
    "filter": "n8n-nodes-base.if",
    "switch": "n8n-nodes-base.switch",
    "code": "n8n-nodes-base.code",
    "set": "n8n-nodes-base.set",
    "wait": "n8n-nodes-base.wait",
    "executeworkflow": "n8n-nodes-base.executeWorkflow",
}


def _normalize_type(raw_type: str) -> str:
    """Normalize a node type to its full n8n-nodes-base.* form."""
    if raw_type.startswith("n8n-nodes-base.") or raw_type.startswith("aos."):
        return raw_type
    key = raw_type.lower().strip()
    # Try exact match first (preserves dots, underscores)
    if key in _TYPE_ALIASES:
        return _TYPE_ALIASES[key]
    # Try with delimiters stripped
    stripped = key.replace("-", "").replace("_", "").replace(".", "")
    return _TYPE_ALIASES.get(stripped, raw_type)


def _normalize_step(step: dict) -> dict:
    """Normalize a step dict to use canonical keys."""
    normalized: dict[str, Any] = {}
    normalized["id"] = step.get("id", "s0")
    normalized["label"] = step.get("label", step.get("name", "Step"))
    normalized["parameters"] = step.get("parameters", step.get("config", {}))

    # Determine step type
    raw_type = step.get("type", step.get("n8n_type", "n8n-nodes-base.set"))

    # Detect agent_dispatch — Claude uses many variations
    if raw_type in ("agent_dispatch", "agent", "aos.agentDispatch"):
        normalized["type"] = "agent_dispatch"
        normalized["agent_id"] = (
            step.get("agent_id")
            or step.get("agent")
            or step.get("parameters", {}).get("agent_id", "")
            or step.get("config", {}).get("agent_id", "")
            or ""
        )
        # Pull task/prompt into parameters
        task = step.get("prompt", step.get("task", ""))
        if task and "task" not in normalized["parameters"]:
            normalized["parameters"] = {**normalized["parameters"], "task": task}
    elif raw_type in ("hitl_approval", "hitl", "human_approval", "approval"):
        normalized["type"] = "hitl_approval"
    elif raw_type in ("sub_workflow", "execute_workflow"):
        normalized["type"] = "sub_workflow"
    else:
        normalized["type"] = "n8n_node"
        normalized["n8n_type"] = _normalize_type(raw_type)

    # Preserve routing
    if "next" in step:
        normalized["next"] = step["next"]
    if "branch_conditions" in step:
        normalized["branch_conditions"] = step["branch_conditions"]

    return normalized


def _normalize_pipeline(pipeline: dict) -> dict:
    """Normalize a pipeline dict to use canonical keys."""
    trigger = pipeline.get("trigger", {})
    trigger_type = trigger.get("type", "n8n-nodes-base.scheduleTrigger")
    trigger_type = _normalize_type(trigger_type)

    # Normalize trigger parameters — handle schedule/cron shorthand
    trigger_params = trigger.get("parameters", {})
    if not trigger_params:
        # Claude sometimes puts schedule/cron at trigger top level
        schedule = trigger.get("schedule", trigger.get("cron", ""))
        if schedule:
            trigger_params = {
                "rule": {"interval": [{"field": "cronExpression", "expression": schedule}]}
            }

    steps = [_normalize_step(s) for s in pipeline.get("steps", [])]

    return {
        "id": pipeline.get("id", "p1"),
        "name": pipeline.get("name", "Pipeline"),
        "complexity": pipeline.get("complexity", "simple"),
        "trigger": {"type": trigger_type, "parameters": trigger_params},
        "steps": steps,
        "calls_pipelines": pipeline.get("calls_pipelines", []),
    }


def _coerce_to_spec(parsed: dict) -> dict | None:
    """Attempt to coerce various JSON formats into FlowSystemSpec.

    Handles the case where Claude invents its own schema with nodes/edges
    instead of pipelines/steps. Returns None if coercion fails.
    """
    # Has pipelines — normalize steps within them
    if "pipelines" in parsed and isinstance(parsed["pipelines"], list):
        pipelines = [_normalize_pipeline(p) for p in parsed["pipelines"]]
        return {
            "name": parsed.get("name", "Automation"),
            "objective": parsed.get("objective", ""),
            "pipelines": pipelines,
            "enhancements": parsed.get("enhancements", []),
        }

    # Common alternative: flat nodes/edges format (what Claude often produces)
    if "nodes" in parsed and isinstance(parsed["nodes"], list):
        nodes = parsed["nodes"]
        edges = parsed.get("edges", [])

        # Find trigger node(s)
        trigger_node = None
        step_nodes = []
        for node in nodes:
            node_type = node.get("type", "")
            if "trigger" in node_type.lower() or "Trigger" in node_type:
                trigger_node = node
            else:
                step_nodes.append(node)

        if not trigger_node:
            # Use first node as trigger if none explicitly marked
            if nodes:
                trigger_node = nodes[0]
                step_nodes = nodes[1:]
            else:
                return None

        # Build edge lookup: source_id -> [target_ids]
        edge_map: dict[str, list[str]] = {}
        branch_map: dict[str, list[dict]] = {}
        for edge in edges:
            src = edge.get("from", edge.get("source", ""))
            tgt = edge.get("to", edge.get("target", ""))
            branch = edge.get("branch")
            if src and tgt:
                edge_map.setdefault(src, []).append(tgt)
                if branch is not None:
                    branch_map.setdefault(src, []).append({
                        "condition": str(branch),
                        "expression": str(branch),
                        "target_step": tgt,
                    })

        # Convert nodes to steps with normalization
        raw_steps = []
        for node in step_nodes:
            node_id = node.get("id", f"s{len(raw_steps)+1}")
            label = node.get("label", node.get("name", "Step"))
            params = node.get("config", node.get("parameters", {}))
            node_type = node.get("type", "n8n-nodes-base.set")

            raw_step: dict[str, Any] = {
                "id": node_id,
                "type": node_type,
                "label": label,
                "parameters": params,
            }

            # Add connections
            if node_id in branch_map:
                raw_step["branch_conditions"] = branch_map[node_id]
            elif node_id in edge_map:
                raw_step["next"] = edge_map[node_id]

            raw_steps.append(raw_step)

        steps = [_normalize_step(s) for s in raw_steps]

        # Build trigger
        trigger_type = _normalize_type(
            trigger_node.get("type", "n8n-nodes-base.scheduleTrigger")
        )
        trigger_params = trigger_node.get("config", trigger_node.get("parameters", {}))
        if not trigger_params:
            schedule = trigger_node.get("schedule", trigger_node.get("cron", ""))
            if schedule:
                trigger_params = {
                    "rule": {"interval": [{"field": "cronExpression", "expression": schedule}]}
                }

        # Determine complexity
        has_branches = bool(branch_map)
        complexity = "complex" if has_branches else "simple"

        pipeline = {
            "id": "p1",
            "name": parsed.get("name", "Pipeline"),
            "complexity": complexity,
            "trigger": {"type": trigger_type, "parameters": trigger_params},
            "steps": steps,
            "calls_pipelines": [],
        }

        return {
            "name": parsed.get("name", "Automation"),
            "objective": parsed.get("objective", parsed.get("notes", "")),
            "pipelines": [pipeline],
            "enhancements": [],
        }

    return None


def _extract_spec(text: str) -> dict | None:
    """Extract a FlowSystemSpec JSON from fenced code blocks in the response.

    Tries direct match first, then coerces alternative formats.
    """
    pattern = r"```json\s*\n(.*?)```"
    matches = re.findall(pattern, text, re.DOTALL)

    for match in matches:
        try:
            parsed = json.loads(match.strip())
            if not isinstance(parsed, dict):
                continue
            result = _coerce_to_spec(parsed)
            if result:
                return result
        except json.JSONDecodeError:
            continue
    return None


def _detect_phase(text: str, current_phase: str) -> str:
    """Detect the current conversation phase from the response content."""
    has_json = "```json" in text

    if current_phase == "investigate":
        # Move to design if the response contains a spec JSON
        if has_json and ('"pipelines"' in text or '"nodes"' in text):
            return "design"
        # Move to design if the assistant restated the objective
        if any(kw in text.lower() for kw in ["objective:", "here's the", "here is the"]):
            return "design"
    if current_phase == "design":
        if has_json:
            return "confirm"
    if current_phase == "confirm":
        pass  # Terminal — user clicks Build

    return current_phase


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/sessions")
async def list_sessions(request: Request) -> JSONResponse:
    """List recent architect sessions."""
    sessions = _list_sessions()
    return JSONResponse({"sessions": sessions, "count": len(sessions)})


@router.post("/session")
async def create_session(request: Request) -> JSONResponse:
    """Create a new architect session."""
    session = _new_session()
    logger.info("Architect session created: %s", session["id"])
    return JSONResponse({"session_id": session["id"]}, status_code=201)


@router.post("/message")
async def send_message(request: Request) -> StreamingResponse:
    """Send a message to the architect and receive SSE stream back.

    Body: { "session_id": "...", "message": "..." }
    Returns: SSE stream with event: text and event: flow_update
    """
    body = await request.json()
    session_id = body.get("session_id", "")
    message = body.get("message", "").strip()

    if not message:
        return JSONResponse({"error": "message is required"}, status_code=400)

    session = _load_session(session_id)
    if not session:
        # Auto-create if not found
        session = _new_session()
        logger.info("Auto-created session: %s", session["id"])

    # Record user message
    session["messages"].append({
        "role": "user",
        "content": message,
        "timestamp": datetime.utcnow().isoformat(),
    })
    _save_session(session)

    async def generate() -> AsyncGenerator[str, None]:
        # Progress: checking context
        yield f"event: status\ndata: {json.dumps({'status': 'Checking connected services...'})}\n\n"
        await asyncio.sleep(0.05)  # Flush

        prompt = _build_prompt(session, message)

        # Progress: phase-specific status
        phase = session["phase"]
        if phase == "investigate":
            yield f"event: status\ndata: {json.dumps({'status': 'Understanding your request...'})}\n\n"
        elif phase == "design":
            yield f"event: status\ndata: {json.dumps({'status': 'Designing workflow...'})}\n\n"
        elif phase == "confirm":
            yield f"event: status\ndata: {json.dumps({'status': 'Updating design...'})}\n\n"
        else:
            yield f"event: status\ndata: {json.dumps({'status': 'Thinking...'})}\n\n"
        await asyncio.sleep(0.05)

        # Progress: calling Claude
        yield f"event: status\ndata: {json.dumps({'status': 'Generating response...'})}\n\n"

        full_response = []

        async for chunk in _claude_call_streaming(prompt):
            # Sanitize control chars from Claude output before SSE
            clean_chunk = _sanitize_control_chars(chunk)
            full_response.append(clean_chunk)

            # Send text chunk as SSE
            sse_data = json.dumps({"chunk": clean_chunk})
            yield f"event: text\ndata: {sse_data}\n\n"

        # Assemble full response
        response_text = "".join(full_response)

        # Record assistant message
        session["messages"].append({
            "role": "assistant",
            "content": response_text,
            "timestamp": datetime.utcnow().isoformat(),
        })

        # Try to extract FlowSystemSpec
        spec = _extract_spec(response_text)
        if spec:
            session["spec"] = spec
            spec_data = json.dumps({"spec": spec})
            yield f"event: flow_update\ndata: {spec_data}\n\n"

        # Detect phase progression
        new_phase = _detect_phase(response_text, session["phase"])
        if new_phase != session["phase"]:
            session["phase"] = new_phase
            phase_data = json.dumps({"phase": new_phase})
            yield f"event: phase\ndata: {phase_data}\n\n"

        # Persist session state
        _save_session(session)

        # Signal completion
        yield f"event: done\ndata: {{}}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.delete("/session/{session_id}")
async def delete_session(session_id: str, request: Request) -> JSONResponse:
    """Delete an architect session."""
    _sessions.pop(session_id, None)
    try:
        conn = _get_db()
        conn.execute("DELETE FROM architect_sessions WHERE id = ?", (session_id,))
        conn.commit()
        conn.close()
    except Exception:
        pass
    return JSONResponse({"ok": True})


@router.get("/session/{session_id}")
async def get_session(session_id: str, request: Request) -> JSONResponse:
    """Get the current state of an architect session."""
    session = _load_session(session_id)
    if not session:
        return JSONResponse({"error": "session not found"}, status_code=404)

    # Sanitize message content to prevent JSONDecodeError from raw
    # control characters in Claude's responses (e.g. \x00-\x1f).
    safe_messages = [_sanitize_message(m) for m in session["messages"]]

    return JSONResponse({
        "id": session["id"],
        "title": session.get("title", ""),
        "created_at": session["created_at"],
        "updated_at": session.get("updated_at", session["created_at"]),
        "messages": safe_messages,
        "spec": session["spec"],
        "phase": session["phase"],
    })
