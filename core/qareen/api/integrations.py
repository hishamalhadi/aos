"""Qareen API — Integrations: providers, connectors, credentials.

AOS owns canonical config at ~/.aos/config/. This API reads/writes those
files and provides the data for the Integrations page.
"""

from __future__ import annotations

import logging
import subprocess
from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/integrations", tags=["integrations"])

CONFIG_DIR = Path.home() / ".aos" / "config"
PROVIDERS_FILE = CONFIG_DIR / "providers.yaml"
CONNECTORS_FILE = CONFIG_DIR / "connectors.yaml"
CREDENTIALS_FILE = CONFIG_DIR / "credentials.yaml"
MCP_JSON = Path.home() / ".claude" / "mcp.json"


def _load_yaml(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        return yaml.safe_load(path.read_text()) or {}
    except Exception:
        logger.exception("Failed to load %s", path)
        return {}


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
    """List all connectors grouped by scope."""
    data = _load_yaml(CONNECTORS_FILE)
    connectors = data.get("connectors", {})

    result = []
    for cid, cfg in connectors.items():
        is_configured = cfg.get("command") is not None
        status = cfg.get("status", "active" if is_configured else "not-configured")

        result.append({
            "id": cid,
            "type": cfg.get("type", "mcp-stdio"),
            "display_name": cfg.get("display_name", cid),
            "description": cfg.get("description", ""),
            "scope": cfg.get("scope", "agent"),
            "credential": cfg.get("credential"),
            "tags": cfg.get("tags", []),
            "is_configured": is_configured,
            "status": status,
        })

    # Group by scope
    global_c = [c for c in result if c["scope"] == "global"]
    project_c = [c for c in result if c["scope"] == "project"]
    agent_c = [c for c in result if c["scope"] == "agent"]

    return {
        "connectors": result,
        "global": global_c,
        "project": project_c,
        "agent": agent_c,
        "total": len(result),
        "configured": sum(1 for c in result if c["is_configured"]),
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
