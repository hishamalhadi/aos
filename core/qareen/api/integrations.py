"""Qareen API — Integrations: providers, connectors, credentials.

AOS owns canonical config at ~/.aos/config/. This API reads/writes those
files and provides the data for the Integrations page.

The connectors endpoint merges two data sources:
  - Connector manifests (core/infra/connectors/*.yaml) — what exists, health checks
  - User config (~/.aos/config/connectors.yaml) — what's configured (command, env, scope)
"""

from __future__ import annotations

import logging
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/integrations", tags=["integrations"])

CONFIG_DIR = Path.home() / ".aos" / "config"
PROVIDERS_FILE = CONFIG_DIR / "providers.yaml"
CONNECTORS_FILE = CONFIG_DIR / "connectors.yaml"
CREDENTIALS_FILE = CONFIG_DIR / "credentials.yaml"
MCP_JSON = Path.home() / ".claude" / "mcp.json"
AOS_HOME = Path.home() / "aos"

# Discovery cache — avoid re-running health checks on every request
_discovery_cache: dict[str, Any] = {"data": None, "ts": 0}
_CACHE_TTL = 60  # seconds


def _load_yaml(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        return yaml.safe_load(path.read_text()) or {}
    except Exception:
        logger.exception("Failed to load %s", path)
        return {}


def _get_discovery() -> list[Any]:
    """Run connector discovery with caching."""
    now = time.monotonic()
    if _discovery_cache["data"] is not None and (now - _discovery_cache["ts"]) < _CACHE_TTL:
        return _discovery_cache["data"]
    try:
        sys.path.insert(0, str(AOS_HOME / "core"))
        from infra.connectors.discover import discover_all
        connectors = discover_all()
        _discovery_cache["data"] = connectors
        _discovery_cache["ts"] = now
        return connectors
    except Exception:
        logger.exception("Connector discovery failed")
        return _discovery_cache["data"] or []


def _save_yaml(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.dump(data, default_flow_style=False, allow_unicode=True, sort_keys=False))


# ---------------------------------------------------------------------------
# Providers
# ---------------------------------------------------------------------------

@router.get("/providers")
async def list_providers() -> dict[str, Any]:
    """List all configured AI providers."""
    data = _load_yaml(PROVIDERS_FILE)
    providers = data.get("providers", {})

    result = []
    for pid, cfg in providers.items():
        # Check credential availability
        cred = cfg.get("credential")
        cred_ok = True
        if cred:
            try:
                r = subprocess.run(
                    [str(Path.home() / "aos" / "core" / "bin" / "cli" / "agent-secret"), "get", cred],
                    capture_output=True, timeout=5,
                )
                cred_ok = r.returncode == 0
            except Exception:
                cred_ok = False

        # Check Ollama if local
        status = cfg.get("status", "active")
        if cfg.get("type") == "local" and cfg.get("endpoint"):
            try:
                import httpx
                resp = httpx.get(cfg["endpoint"], timeout=3)
                status = "active" if resp.status_code == 200 else "not-running"
            except Exception:
                status = "not-running"

        result.append({
            "id": pid,
            "type": cfg.get("type", "api"),
            "display_name": cfg.get("display_name", pid),
            "description": cfg.get("description", ""),
            "endpoint": cfg.get("endpoint"),
            "credential": cred,
            "credential_ok": cred_ok if cred else None,
            "models": cfg.get("models", []),
            "is_default": cfg.get("is_default", False),
            "status": status,
        })

    return {"providers": result, "total": len(result)}


# ---------------------------------------------------------------------------
# Connectors
# ---------------------------------------------------------------------------

@router.get("/connectors")
async def list_connectors() -> dict[str, Any]:
    """List all connectors with health status, merging discovery and config."""
    # Load user config (what's configured)
    data = _load_yaml(CONNECTORS_FILE)
    yaml_connectors = data.get("connectors", {})

    # Run discovery (what exists + health checks)
    discovered = _get_discovery()
    discovery_by_id = {c.id: c for c in discovered}

    result = []
    seen_ids: set[str] = set()

    # Merge: start with YAML config, enrich with discovery
    for cid, cfg in yaml_connectors.items():
        seen_ids.add(cid)
        is_configured = cfg.get("command") is not None
        disc = discovery_by_id.get(cid)

        entry: dict[str, Any] = {
            "id": cid,
            "type": cfg.get("type", disc.type if disc else "mcp-stdio"),
            "display_name": cfg.get("display_name", disc.name if disc else cid),
            "description": cfg.get("description", disc.description if disc else ""),
            "scope": cfg.get("scope", "agent"),
            "credential": cfg.get("credential"),
            "tags": cfg.get("tags", []),
            "is_configured": is_configured,
        }

        # Enrich with discovery data
        if disc:
            entry["status"] = disc.status
            entry["status_detail"] = disc.status_detail
            entry["health"] = disc.health
            entry["capabilities"] = disc.capabilities
            entry["icon"] = disc.icon
            entry["color"] = disc.color
            entry["tier"] = disc.tier
            entry["category"] = disc.category
            entry["automation_ideas"] = disc.automation_ideas
            entry["accounts"] = disc.accounts
        else:
            entry["status"] = "active" if is_configured else "not-configured"
            entry["status_detail"] = ""
            entry["health"] = []
            entry["capabilities"] = []

        result.append(entry)

    # Add discovered connectors not in YAML config (available but not configured)
    for disc in discovered:
        if disc.id not in seen_ids:
            result.append({
                "id": disc.id,
                "type": disc.type,
                "display_name": disc.name,
                "description": disc.description,
                "scope": "agent",
                "credential": None,
                "tags": [],
                "is_configured": False,
                "status": disc.status,
                "status_detail": disc.status_detail,
                "health": disc.health,
                "capabilities": disc.capabilities,
                "icon": disc.icon,
                "color": disc.color,
                "tier": disc.tier,
                "category": disc.category,
                "automation_ideas": disc.automation_ideas,
                "accounts": disc.accounts,
            })

    # Group by scope
    global_c = [c for c in result if c.get("scope") == "global"]
    project_c = [c for c in result if c.get("scope") == "project"]
    agent_c = [c for c in result if c.get("scope") == "agent"]

    return {
        "connectors": result,
        "global": global_c,
        "project": project_c,
        "agent": agent_c,
        "total": len(result),
        "configured": sum(1 for c in result if c.get("is_configured")),
        "connected": sum(1 for c in result if c.get("status") == "connected"),
    }


@router.patch("/connectors/{connector_id}")
async def update_connector(connector_id: str, request) -> JSONResponse:
    """Update a connector's configuration."""
    body = await request.json()
    data = _load_yaml(CONNECTORS_FILE)
    connectors = data.get("connectors", {})

    if connector_id not in connectors:
        return JSONResponse({"error": f"Connector not found: {connector_id}"}, status_code=404)

    for key, value in body.items():
        connectors[connector_id][key] = value

    data["connectors"] = connectors
    _save_yaml(CONNECTORS_FILE, data)

    # Sync to mcp.json
    _sync_to_mcp_json(data)

    return JSONResponse({"ok": True, "id": connector_id})


@router.post("/connectors")
async def add_connector(request) -> JSONResponse:
    """Add a new connector."""
    body = await request.json()
    connector_id = body.get("id")
    if not connector_id:
        return JSONResponse({"error": "Missing connector id"}, status_code=400)

    data = _load_yaml(CONNECTORS_FILE)
    connectors = data.setdefault("connectors", {})

    if connector_id in connectors:
        return JSONResponse({"error": f"Connector '{connector_id}' already exists"}, status_code=409)

    connectors[connector_id] = {
        "type": body.get("type", "mcp-stdio"),
        "display_name": body.get("display_name", connector_id),
        "description": body.get("description", ""),
        "command": body.get("command"),
        "args": body.get("args", []),
        "env": body.get("env", {}),
        "scope": body.get("scope", "agent"),
        "credential": body.get("credential"),
        "tags": body.get("tags", []),
    }

    data["connectors"] = connectors
    _save_yaml(CONNECTORS_FILE, data)
    _sync_to_mcp_json(data)

    return JSONResponse({"ok": True, "id": connector_id}, status_code=201)


def _sync_to_mcp_json(connectors_data: dict[str, Any]) -> None:
    """Sync global-scope connectors to ~/.claude/mcp.json."""
    import json

    connectors = connectors_data.get("connectors", {})
    mcp_servers: dict[str, Any] = {}

    for cid, cfg in connectors.items():
        # Only sync configured global connectors
        if cfg.get("scope") != "global" or not cfg.get("command"):
            continue
        server: dict[str, Any] = {
            "type": "stdio",
            "command": cfg["command"],
            "args": cfg.get("args", []),
        }
        if cfg.get("env"):
            server["env"] = cfg["env"]
        if cfg.get("cwd"):
            server["cwd"] = cfg["cwd"]
        mcp_servers[cid] = server

    MCP_JSON.parent.mkdir(parents=True, exist_ok=True)
    MCP_JSON.write_text(json.dumps({"mcpServers": mcp_servers}, indent=2))
    logger.info("Synced %d connectors to %s", len(mcp_servers), MCP_JSON)


# ---------------------------------------------------------------------------
# Credentials
# ---------------------------------------------------------------------------

@router.get("/credentials")
async def list_credentials() -> dict[str, Any]:
    """List ALL credentials from keychain, enriched with manifest metadata."""
    # 1. Load manifest for descriptions/usage metadata
    data = _load_yaml(CREDENTIALS_FILE)
    manifest = data.get("credentials", {})

    # 2. Discover all entries from keychain
    agent_secret = str(Path.home() / "aos" / "core" / "bin" / "cli" / "agent-secret")
    keychain_names: list[str] = []
    try:
        r = subprocess.run([agent_secret, "list"], capture_output=True, text=True, timeout=10)
        if r.returncode == 0:
            seen: set[str] = set()
            for line in r.stdout.strip().split("\n"):
                name = line.strip()
                if name and name not in seen:
                    seen.add(name)
                    keychain_names.append(name)
    except Exception:
        pass

    # 3. Merge: keychain entries + manifest metadata
    result = []
    for name in sorted(keychain_names):
        meta = manifest.get(name, {})
        result.append({
            "name": name,
            "description": meta.get("description", _infer_description(name)),
            "used_by": meta.get("used_by", _infer_usage(name)),
            "created": meta.get("created"),
            "present": True,
            "category": _infer_category(name),
        })

    # Also add manifest entries that are NOT in keychain (missing credentials)
    for name, meta in manifest.items():
        if name not in {r["name"] for r in result}:
            result.append({
                "name": name,
                "description": meta.get("description", ""),
                "used_by": meta.get("used_by", {}),
                "created": meta.get("created"),
                "present": False,
                "category": _infer_category(name),
            })

    return {"credentials": result, "total": len(result)}


def _infer_category(name: str) -> str:
    """Infer credential category from name."""
    n = name.upper()
    if any(k in n for k in ["API_KEY", "API_TOKEN", "ACCESS_TOKEN", "SECRET"]):
        return "api"
    if any(k in n for k in ["OAUTH", "CLIENT_ID", "CLIENT_SECRET"]):
        return "oauth"
    if any(k in n for k in ["BOT_TOKEN", "CHAT_ID", "WEBHOOK"]):
        return "messaging"
    if any(k in n for k in ["EMAIL", "PASSWORD", "ADMIN"]):
        return "account"
    return "other"


def _infer_description(name: str) -> str:
    """Generate a human-readable description from credential name."""
    parts = name.replace("-", "_").split("_")
    # Common patterns
    service = parts[0].title() if parts else name
    kind = " ".join(p.title() for p in parts[1:]) if len(parts) > 1 else ""
    return f"{service} {kind}".strip()


def _infer_usage(name: str) -> dict[str, list[str]]:
    """Guess which connectors/providers use this credential."""
    n = name.upper()
    connectors: list[str] = []
    providers: list[str] = []

    if "OPENROUTER" in n: providers.append("openrouter")
    if "ANTHROPIC" in n: providers.append("anthropic")
    if "ELEVENLABS" in n or "11LABS" in n: connectors.append("elevenlabs")
    if "SLACK" in n: connectors.append("slack")
    if "TELEGRAM" in n: connectors.append("telegram")
    if "SHOPIFY" in n: connectors.append("shopify")
    if "PAYPAL" in n: connectors.append("paypal")
    if "WAVE" in n: connectors.append("wave-accounting")
    if "GOOGLE" in n: connectors.append("google-workspace")
    if "CHITCHATS" in n: connectors.append("chitchats")
    if "N8N" in n: connectors.append("n8n")

    result: dict[str, list[str]] = {}
    if providers: result["providers"] = providers
    if connectors: result["connectors"] = connectors
    return result


# ---------------------------------------------------------------------------
# Sync endpoint (trigger reconcile manually)
# ---------------------------------------------------------------------------

@router.post("/sync")
async def sync_connectors() -> JSONResponse:
    """Force sync connectors.yaml → mcp.json."""
    data = _load_yaml(CONNECTORS_FILE)
    _sync_to_mcp_json(data)
    return JSONResponse({"ok": True, "message": "Synced to mcp.json"})


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@router.get("/health")
async def integrations_health() -> JSONResponse:
    """Run health checks on all connectors and return results."""
    discovered = _get_discovery()
    return JSONResponse({
        "connectors": [c.to_dict() for c in discovered],
        "summary": {
            "total": len(discovered),
            "connected": sum(1 for c in discovered if c.status == "connected"),
            "partial": sum(1 for c in discovered if c.status == "partial"),
            "available": sum(1 for c in discovered if c.status == "available"),
        },
    })


@router.post("/health/refresh")
async def refresh_health() -> JSONResponse:
    """Force re-run health checks (bypass cache)."""
    _discovery_cache["data"] = None
    _discovery_cache["ts"] = 0
    discovered = _get_discovery()
    return JSONResponse({
        "ok": True,
        "summary": {
            "total": len(discovered),
            "connected": sum(1 for c in discovered if c.status == "connected"),
        },
    })


# ---------------------------------------------------------------------------
# Provider management
# ---------------------------------------------------------------------------

@router.post("/providers")
async def add_provider(request: Request) -> JSONResponse:
    """Add a new AI provider."""
    body = await request.json()
    pid = body.get("id")
    if not pid:
        return JSONResponse({"error": "Missing provider id"}, status_code=400)

    data = _load_yaml(PROVIDERS_FILE)
    providers = data.setdefault("providers", {})

    if pid in providers:
        return JSONResponse({"error": f"Provider '{pid}' already exists"}, status_code=409)

    providers[pid] = {
        "type": body.get("type", "api"),
        "display_name": body.get("display_name", pid),
        "description": body.get("description", ""),
        "endpoint": body.get("endpoint"),
        "credential": body.get("credential"),
        "models": body.get("models", []),
        "is_default": body.get("is_default", False),
        "status": "configured",
    }

    data["providers"] = providers
    _save_yaml(PROVIDERS_FILE, data)
    return JSONResponse({"ok": True, "id": pid}, status_code=201)


@router.post("/providers/{provider_id}/verify")
async def verify_provider(provider_id: str) -> JSONResponse:
    """Verify a provider's credential actually works.

    Makes a minimal API call to check authentication.
    """
    data = _load_yaml(PROVIDERS_FILE)
    providers = data.get("providers", {})
    cfg = providers.get(provider_id)

    if not cfg:
        return JSONResponse({"error": "Provider not found"}, status_code=404)

    cred_name = cfg.get("credential")
    if not cred_name:
        return JSONResponse({"ok": True, "status": "no-credential", "detail": "No credential required"})

    # Check credential exists in keychain
    agent_secret = str(Path.home() / "aos" / "core" / "bin" / "cli" / "agent-secret")
    try:
        r = subprocess.run(
            [agent_secret, "get", cred_name],
            capture_output=True, text=True, timeout=5,
        )
        if r.returncode != 0:
            return JSONResponse({"ok": False, "status": "missing", "detail": f"Credential '{cred_name}' not in keychain"})
        api_key = r.stdout.strip()
    except Exception:
        return JSONResponse({"ok": False, "status": "error", "detail": "Failed to read keychain"})

    # Verify credential by making a minimal API call
    ptype = cfg.get("type", "api")
    try:
        import httpx
        if ptype == "api":
            # Anthropic: list models
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    f"{cfg.get('endpoint', 'https://api.anthropic.com')}/v1/models",
                    headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
                )
                if resp.status_code == 200:
                    return JSONResponse({"ok": True, "status": "verified", "detail": "API key valid"})
                return JSONResponse({"ok": False, "status": "invalid", "detail": f"API returned {resp.status_code}"})
        elif ptype == "gateway":
            # OpenRouter / OpenAI-compatible: list models
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    f"{cfg.get('endpoint', 'https://openrouter.ai/api/v1')}/models",
                    headers={"Authorization": f"Bearer {api_key}"},
                )
                if resp.status_code == 200:
                    return JSONResponse({"ok": True, "status": "verified", "detail": "API key valid"})
                return JSONResponse({"ok": False, "status": "invalid", "detail": f"Gateway returned {resp.status_code}"})
        elif ptype == "local":
            endpoint = cfg.get("endpoint", "http://localhost:11434")
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(endpoint)
                if resp.status_code == 200:
                    return JSONResponse({"ok": True, "status": "verified", "detail": "Service reachable"})
                return JSONResponse({"ok": False, "status": "unreachable", "detail": "Service not responding"})
        else:
            return JSONResponse({"ok": True, "status": "skip", "detail": f"No verification for type '{ptype}'"})
    except Exception as e:
        return JSONResponse({"ok": False, "status": "error", "detail": str(e)[:200]})
