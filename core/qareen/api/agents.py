"""Qareen API — Agent management routes.

List, inspect, activate, and configure agent trust levels.
Discovers agents from three locations:
  - ~/.claude/agents/        (installed — active on this machine)
  - ~/aos/core/agents/       (system — chief, steward, advisor)
  - ~/aos/templates/agents/  (catalog — available to hire)
"""

from __future__ import annotations

import asyncio
import logging
import re
import shutil
import time
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, Request, status
from fastapi import Path as PathParam
from fastapi.responses import JSONResponse

from .schemas import (
    AgentCatalogResponse,
    AgentListResponse,
    AgentResponse,
    UpdateTrustRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agents", tags=["agents"])

INSTALLED_DIR = Path.home() / ".claude" / "agents"
SYSTEM_DIR = Path.home() / "aos" / "core" / "agents"
CATALOG_DIR = Path.home() / "aos" / "templates" / "agents"
TRUST_FILE = Path.home() / ".aos" / "config" / "agent-trust.json"


def _load_trust() -> dict[str, int]:
    """Load persisted trust levels."""
    if TRUST_FILE.is_file():
        try:
            import json
            return json.loads(TRUST_FILE.read_text())
        except Exception:
            pass
    return {}


def _save_trust(data: dict[str, int]) -> None:
    """Persist trust levels to disk."""
    import json
    TRUST_FILE.parent.mkdir(parents=True, exist_ok=True)
    TRUST_FILE.write_text(json.dumps(data, indent=2))

# System agent defaults (for .md files that lack rich frontmatter)
SYSTEM_DEFAULTS: dict[str, dict[str, Any]] = {
    "chief": {
        "role": "Orchestrator",
        "color": "#BF5AF2",
        "initials": "CH",
        "model": "opus",
        "reports_to": None,
        "scope": "global",
    },
    "advisor": {
        "role": "Strategy & Analysis",
        "color": "#AF52DE",
        "initials": "AD",
        "model": "opus",
        "reports_to": "chief",
        "scope": "global",
    },
    "steward": {
        "role": "System Health",
        "color": "#64D2FF",
        "initials": "ST",
        "reports_to": "chief",
        "scope": "global",
    },
}

# Default hierarchy for catalog agents
CATALOG_HIERARCHY: dict[str, str] = {
    "ops": "steward",
    "technician": "steward",
    "engineer": "chief",
    "developer": "chief",
    "cmo": "chief",
    "onboard": "chief",
    "nuchay": "chief",
}


def _make_initials(name: str) -> str:
    """Generate 2-letter initials from a name."""
    words = name.split()
    if len(words) >= 2:
        return (words[0][0] + words[1][0]).upper()
    if len(name) >= 2:
        return name[:2].upper()
    return name.upper()


def _parse_agent_md(path: Path, *, source: str = "catalog") -> dict[str, Any]:
    """Parse an agent .md file and extract metadata from frontmatter and content."""
    try:
        content = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return {}

    agent_id = path.stem

    # Parse YAML frontmatter if present
    frontmatter: dict[str, Any] = {}
    body = content
    if content.startswith("---"):
        end = content.find("---", 3)
        if end != -1:
            raw_yaml = content[3:end].strip()
            body = content[end + 3:].lstrip("\n")
            try:
                import yaml
                fm = yaml.safe_load(raw_yaml)
                if isinstance(fm, dict):
                    frontmatter = fm
            except Exception:
                pass

    # Extract name from first heading or frontmatter
    name = frontmatter.get("name", "")
    if not name:
        heading_match = re.search(r"^#\s+(.+)$", body, re.MULTILINE)
        if heading_match:
            name = heading_match.group(1).strip()
        else:
            name = agent_id.replace("-", " ").title()

    # Extract description from frontmatter or first paragraph
    description = frontmatter.get("description", "")
    if not description:
        for line in body.split("\n"):
            stripped = line.strip()
            if stripped and not stripped.startswith("#") and not stripped.startswith("---"):
                description = stripped[:200]
                break

    # System agents
    system_agents = {"chief", "steward", "advisor"}
    is_system = agent_id in system_agents

    # Determine source
    if is_system:
        source = "system"
    elif agent_id.startswith("c-"):
        source = "community"

    # Normalize tools and skills to lists
    raw_tools = frontmatter.get("tools", [])
    if isinstance(raw_tools, str):
        raw_tools = [raw_tools] if raw_tools != "*" else ["*"]
    elif not isinstance(raw_tools, list):
        raw_tools = []

    raw_skills = frontmatter.get("skills", [])
    if isinstance(raw_skills, str):
        raw_skills = [raw_skills]
    elif not isinstance(raw_skills, list):
        raw_skills = []

    raw_mcp = frontmatter.get("mcpServers", frontmatter.get("mcp_servers", []))
    if isinstance(raw_mcp, str):
        raw_mcp = [raw_mcp]
    elif not isinstance(raw_mcp, list):
        raw_mcp = []

    # Role, color, initials — from frontmatter, system defaults, or generated
    sys_defaults = SYSTEM_DEFAULTS.get(agent_id, {})

    role = frontmatter.get("role", sys_defaults.get("role", ""))
    color = frontmatter.get("color", sys_defaults.get("color", ""))
    initials = frontmatter.get("initials", sys_defaults.get("initials", ""))
    if not initials:
        initials = _make_initials(name)

    scope = frontmatter.get("scope", sys_defaults.get("scope", "global"))

    # Hierarchy
    reports_to = frontmatter.get("reportsTo", frontmatter.get("reports_to", None))
    if reports_to is None and not is_system:
        reports_to = CATALOG_HIERARCHY.get(agent_id, "chief")
    if reports_to is None and is_system:
        reports_to = sys_defaults.get("reports_to")

    return {
        "id": agent_id,
        "name": name,
        "role": role,
        "domain": frontmatter.get("domain", ""),
        "description": description,
        "model": frontmatter.get("model", sys_defaults.get("model", "sonnet")),
        "color": color,
        "initials": initials,
        "tools": raw_tools,
        "skills": raw_skills,
        "mcp_servers": raw_mcp,
        "scope": scope,
        "reports_to": reports_to,
        "source": source,
        "is_system": is_system,
        "is_active": True,
        "schedule": frontmatter.get("schedule", {}) if isinstance(frontmatter.get("schedule"), dict) else {},
        "source_path": str(path),
    }


def _discover_agents(directory: Path, *, source: str = "catalog") -> list[dict[str, Any]]:
    """Discover agent definitions from a directory."""
    agents = []
    if not directory.is_dir():
        return agents

    for entry in directory.iterdir():
        if entry.suffix == ".md" and entry.is_file():
            # Skip files with invalid agent names
            if entry.stem.startswith("-") or entry.stem.startswith("."):
                continue
            parsed = _parse_agent_md(entry, source=source)
            if parsed:
                agents.append(parsed)
        elif entry.is_dir():
            agent_md = entry / "agent.md"
            if agent_md.is_file():
                parsed = _parse_agent_md(agent_md, source=source)
                if parsed:
                    parsed["id"] = entry.name
                    agents.append(parsed)

    return agents


def _to_response(a: dict[str, Any], trust_map: dict[str, int] | None = None) -> AgentResponse:
    """Convert parsed agent dict to API response."""
    trust = (trust_map or {}).get(a["id"])
    return AgentResponse(
        id=a["id"],
        name=a["name"],
        role=a.get("role", ""),
        domain=a.get("domain", ""),
        description=a.get("description", ""),
        model=a.get("model", "sonnet"),
        color=a.get("color", ""),
        initials=a.get("initials", ""),
        tools=a.get("tools", []),
        skills=a.get("skills", []),
        mcp_servers=a.get("mcp_servers", []),
        default_trust=trust if trust is not None else 1,
        scope=a.get("scope", "global"),
        reports_to=a.get("reports_to"),
        source=a.get("source", "catalog"),
        is_system=a.get("is_system", False),
        is_active=a.get("is_active", True),
        schedule=a.get("schedule", {}),
    )


@router.get("", response_model=AgentListResponse)
async def list_agents(request: Request) -> AgentListResponse:
    """List all installed agents (active on this machine)."""
    agents_data = _discover_agents(INSTALLED_DIR, source="catalog")

    # Also pull system agents from core/agents/ if not already in installed dir
    if SYSTEM_DIR.is_dir():
        existing_ids = {a["id"] for a in agents_data}
        system_agents = _discover_agents(SYSTEM_DIR, source="system")
        for sa in system_agents:
            if sa["id"] not in existing_ids:
                agents_data.append(sa)

    trust_map = _load_trust()
    agents = [_to_response(a, trust_map) for a in agents_data]

    system_count = sum(1 for a in agents if a.is_system)
    active_count = sum(1 for a in agents if a.is_active)

    return AgentListResponse(
        agents=agents,
        total=len(agents),
        active_count=active_count,
        system_count=system_count,
    )


@router.get("/catalog", response_model=AgentCatalogResponse)
async def list_catalog(request: Request) -> AgentCatalogResponse:
    """List catalog agents available to hire (from templates/agents/)."""
    catalog_data = _discover_agents(CATALOG_DIR, source="catalog")

    # Exclude agents already installed
    installed_ids: set[str] = set()
    if INSTALLED_DIR.is_dir():
        for entry in INSTALLED_DIR.iterdir():
            if entry.suffix == ".md":
                installed_ids.add(entry.stem)
            elif entry.is_dir() and (entry / "agent.md").is_file():
                installed_ids.add(entry.name)

    available = [_to_response(a) for a in catalog_data if a["id"] not in installed_ids]

    return AgentCatalogResponse(
        catalog=available,
        total=len(available),
    )


@router.get("/{agent_id}", response_model=AgentResponse)
async def get_agent(
    request: Request,
    agent_id: str = PathParam(..., description="Agent identifier, e.g. 'chief'"),
) -> AgentResponse | JSONResponse:
    """Get detailed info for a single agent."""
    # Search installed → system → catalog
    for directory, source in [
        (INSTALLED_DIR, "catalog"),
        (SYSTEM_DIR, "system"),
        (CATALOG_DIR, "catalog"),
    ]:
        agent_path = directory / f"{agent_id}.md"
        if not agent_path.is_file():
            agent_path = directory / agent_id / "agent.md"
        if agent_path.is_file():
            data = _parse_agent_md(agent_path, source=source)
            if data:
                return _to_response(data)

    return JSONResponse({"error": f"Agent not found: {agent_id}"}, status_code=404)


@router.post("/community/install", status_code=status.HTTP_201_CREATED)
async def install_community_agent(request: Request) -> JSONResponse:
    """Install a community agent by downloading its .md from GitHub."""
    body = await request.json()
    repo = body.get("repo")
    file_path = body.get("file")
    agent_id = body.get("id")

    if not repo or not file_path or not agent_id:
        return JSONResponse({"error": "Missing repo, file, or id"}, status_code=400)

    safe_id = re.sub(r"[^a-zA-Z0-9_-]", "", agent_id)
    if not safe_id:
        return JSONResponse({"error": "Invalid agent ID"}, status_code=400)

    target_path = INSTALLED_DIR / f"{safe_id}.md"
    if target_path.exists():
        return JSONResponse({"error": f"Agent '{safe_id}' is already installed"}, status_code=409)

    url = f"https://raw.githubusercontent.com/{repo}/main/{file_path}"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                return JSONResponse(
                    {"error": f"Failed to fetch from GitHub: {resp.status_code}"},
                    status_code=502,
                )
            content = resp.text
    except httpx.HTTPError as exc:
        return JSONResponse({"error": f"GitHub fetch error: {exc}"}, status_code=502)

    INSTALLED_DIR.mkdir(parents=True, exist_ok=True)
    target_path.write_text(content, encoding="utf-8")
    logger.info("Installed community agent '%s' from %s/%s", safe_id, repo, file_path)

    data = _parse_agent_md(target_path, source="community")
    return JSONResponse(
        {"ok": True, "id": safe_id, "name": data.get("name", safe_id), "installed": True},
        status_code=201,
    )


@router.post("/{agent_id}/activate", response_model=AgentResponse, status_code=status.HTTP_201_CREATED)
async def activate_agent(
    request: Request,
    agent_id: str = PathParam(..., description="Catalog agent ID to activate"),
) -> AgentResponse | JSONResponse:
    """Activate an agent from the catalog by copying it to ~/.claude/agents/."""
    target_path = INSTALLED_DIR / f"{agent_id}.md"
    if target_path.exists():
        return JSONResponse({"error": f"Agent '{agent_id}' is already installed"}, status_code=409)

    catalog_path = CATALOG_DIR / f"{agent_id}.md"
    if not catalog_path.is_file():
        catalog_path = CATALOG_DIR / agent_id / "agent.md"
    if not catalog_path.is_file():
        return JSONResponse({"error": f"Agent not in catalog: {agent_id}"}, status_code=404)

    data = _parse_agent_md(catalog_path, source="catalog")
    if not data:
        return JSONResponse({"error": f"Could not parse agent: {agent_id}"}, status_code=500)

    INSTALLED_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(str(catalog_path), str(target_path))
    logger.info("Activated agent '%s': %s → %s", agent_id, catalog_path, target_path)

    return _to_response(data)


@router.patch("/{agent_id}/trust", response_model=AgentResponse)
async def update_trust(
    body: UpdateTrustRequest,
    request: Request,
    agent_id: str = PathParam(..., description="Agent ID to update trust for"),
) -> AgentResponse | JSONResponse:
    """Update an agent's trust level and persist to disk."""
    agent_resp = await get_agent(request, agent_id)
    if isinstance(agent_resp, JSONResponse):
        return agent_resp

    # Persist
    trust_map = _load_trust()
    trust_map[agent_id] = body.trust_level
    _save_trust(trust_map)

    agent_resp.default_trust = body.trust_level
    logger.info("Updated trust for '%s' to %d", agent_id, body.trust_level)
    return agent_resp


@router.post("/dispatch")
async def dispatch_agent(request: Request) -> JSONResponse:
    """Dispatch an agent to perform a task.

    Body: { "agent_id": "steward", "task": "summarize my tasks", "context": "..." }
    Returns: { "result": "...", "status": "ok", "duration_ms": 1234 }

    Reads the agent .md, uses its content as system prompt, calls
    claude --print --model sonnet with the task as user message.
    """
    body = await request.json()
    agent_id = body.get("agent_id", "").strip()
    task = body.get("task", "").strip()
    context = body.get("context", "")

    if not agent_id:
        return JSONResponse({"error": "agent_id is required"}, status_code=400)
    if not task:
        return JSONResponse({"error": "task is required"}, status_code=400)

    # Find the agent .md file
    agent_path = None
    for directory in [INSTALLED_DIR, SYSTEM_DIR, CATALOG_DIR]:
        candidate = directory / f"{agent_id}.md"
        if candidate.is_file():
            agent_path = candidate
            break
        candidate = directory / agent_id / "agent.md"
        if candidate.is_file():
            agent_path = candidate
            break

    if not agent_path:
        return JSONResponse({"error": f"Agent not found: {agent_id}"}, status_code=404)

    # Read agent definition for system prompt context
    agent_data = _parse_agent_md(agent_path)
    agent_content = agent_path.read_text(encoding="utf-8", errors="replace")
    # Strip frontmatter for the system prompt
    if agent_content.startswith("---"):
        end = agent_content.find("---", 3)
        if end != -1:
            agent_content = agent_content[end + 3:].lstrip("\n")

    model = agent_data.get("model", "sonnet")

    # Build prompt
    prompt_parts = [f"<system>\n{agent_content}\n</system>\n"]
    if context:
        prompt_parts.append(f"Context: {context}\n")
    prompt_parts.append(f"Task: {task}")
    prompt = "\n".join(prompt_parts)

    start = time.monotonic()
    try:
        proc = await asyncio.create_subprocess_exec(
            "claude", "--print", "--model", model,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(prompt.encode()), timeout=120
        )
        duration_ms = int((time.monotonic() - start) * 1000)

        if proc.returncode != 0:
            return JSONResponse({
                "result": "",
                "status": "error",
                "error": stderr.decode()[:500],
                "duration_ms": duration_ms,
            }, status_code=500)

        result = stdout.decode().strip()
        return JSONResponse({
            "result": result,
            "status": "ok",
            "agent_id": agent_id,
            "agent_name": agent_data.get("name", agent_id),
            "duration_ms": duration_ms,
        })

    except FileNotFoundError:
        return JSONResponse({"error": "claude CLI not found"}, status_code=503)
    except asyncio.TimeoutError:
        duration_ms = int((time.monotonic() - start) * 1000)
        return JSONResponse({
            "result": "",
            "status": "timeout",
            "duration_ms": duration_ms,
        }, status_code=504)
