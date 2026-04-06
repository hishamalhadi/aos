"""Connector discovery engine.

Loads connector definitions from YAML, runs health checks against the local
machine, and returns a unified status for each connector.

Usage:
    from core.infra.connectors.discover import discover_all
    connectors = discover_all()

CLI:
    python3 -m core.infra.connectors.discover
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
from dataclasses import dataclass, field
from glob import glob
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger(__name__)

CONNECTORS_DIR = Path(__file__).parent
AGENT_SECRET = Path.home() / "aos" / "core" / "bin" / "cli" / "agent-secret"
MCP_JSON = Path.home() / ".claude" / "mcp.json"


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class HealthResult:
    name: str
    status: str  # ok | fail | skip
    detail: str = ""


@dataclass
class ConnectorStatus:
    id: str
    name: str
    icon: str
    color: str
    type: str  # mcp | service | cli | api | native
    tier: int
    category: str
    description: str
    status: str  # connected | available | partial | broken | unavailable
    status_detail: str = ""
    capabilities: list[dict] = field(default_factory=list)
    health: list[dict] = field(default_factory=list)
    automation_ideas: list[dict] = field(default_factory=list)
    accounts: list[str] = field(default_factory=list)
    n8n: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "icon": self.icon,
            "color": self.color,
            "type": self.type,
            "tier": self.tier,
            "category": self.category,
            "description": self.description,
            "status": self.status,
            "status_detail": self.status_detail,
            "capabilities": self.capabilities,
            "health": self.health,
            "automation_ideas": self.automation_ideas,
            "accounts": self.accounts,
            "n8n": self.n8n,
        }


# ---------------------------------------------------------------------------
# Health check runners
# ---------------------------------------------------------------------------

def _check_keychain(keys: list[str]) -> HealthResult:
    """Check that secrets exist in macOS Keychain."""
    missing = []
    for key in keys:
        try:
            result = subprocess.run(
                [str(AGENT_SECRET), "get", key],
                capture_output=True, text=True, timeout=5,
            )
            val = result.stdout.strip()
            if not val or val.startswith("Error") or result.returncode != 0:
                missing.append(key)
        except Exception:
            missing.append(key)

    if not missing:
        return HealthResult("credentials", "ok", f"All {len(keys)} keys present")
    if len(missing) < len(keys):
        return HealthResult("credentials", "fail", f"Missing: {', '.join(missing)}")
    return HealthResult("credentials", "fail", f"No credentials found")


def _check_file_exists(path_pattern: str) -> HealthResult:
    """Check that files matching a glob pattern exist."""
    expanded = os.path.expanduser(path_pattern)
    matches = glob(expanded)
    if matches:
        return HealthResult("files", "ok", f"{len(matches)} file(s) found")
    return HealthResult("files", "fail", f"No files matching {path_pattern}")


def _check_mcp_registered(server_name: str) -> HealthResult:
    """Check that an MCP server is registered in Claude Code.

    Checks both ~/.claude/mcp.json (legacy) and ~/.claude.json (current).
    `claude mcp add` writes to ~/.claude.json, but older installs use mcp.json.
    """
    # Check all known MCP config locations
    search_paths = [
        MCP_JSON,                           # ~/.claude/mcp.json (legacy)
        Path.home() / ".claude.json",       # ~/.claude.json (current)
    ]
    for config_path in search_paths:
        try:
            if config_path.exists():
                data = json.loads(config_path.read_text())
                servers = data.get("mcpServers", {})
                if server_name in servers:
                    return HealthResult("mcp_registered", "ok", f"Server '{server_name}' registered")
        except Exception:
            continue
    return HealthResult("mcp_registered", "fail", f"Server '{server_name}' not in mcp config")


def _check_command(command: str, name: str = "command") -> HealthResult:
    """Run a shell command and check exit code."""
    try:
        result = subprocess.run(
            command, shell=True, capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0:
            return HealthResult(name, "ok")
        return HealthResult(name, "fail", result.stderr.strip()[:100])
    except subprocess.TimeoutExpired:
        return HealthResult(name, "fail", "Timed out")
    except Exception as e:
        return HealthResult(name, "fail", str(e)[:100])


def _check_launchagent(label: str) -> HealthResult:
    """Check that a LaunchAgent is loaded."""
    try:
        result = subprocess.run(
            ["launchctl", "list"],
            capture_output=True, text=True, timeout=5,
        )
        if label in result.stdout:
            return HealthResult("service", "ok", f"{label} is loaded")
        return HealthResult("service", "fail", f"{label} not loaded")
    except Exception as e:
        return HealthResult("service", "fail", str(e)[:100])


def _check_app_exists(path: str) -> HealthResult:
    """Check that an application exists."""
    expanded = os.path.expanduser(path)
    if Path(expanded).exists():
        return HealthResult("app_exists", "ok")
    return HealthResult("app_exists", "fail", f"{path} not found")


def _check_port(port: int) -> HealthResult:
    """Check that a localhost port is responding."""
    try:
        import socket
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(2)
        result = sock.connect_ex(("127.0.0.1", port))
        sock.close()
        if result == 0:
            return HealthResult("port", "ok", f"Port {port} responding")
        return HealthResult("port", "fail", f"Port {port} not responding")
    except Exception as e:
        return HealthResult("port", "fail", str(e)[:100])


# Map check types to runners
CHECK_RUNNERS = {
    "keychain": lambda check: _check_keychain(check.get("keys", [])),
    "file_exists": lambda check: _check_file_exists(check.get("path", "")),
    "mcp_registered": lambda check: _check_mcp_registered(check.get("server_name", "")),
    "command": lambda check: _check_command(check.get("command", "false"), check.get("name", "command")),
    "launchagent": lambda check: _check_launchagent(check.get("label", "")),
    "app_exists": lambda check: _check_app_exists(check.get("path", "")),
    "port": lambda check: _check_port(check.get("port", 0)),
}


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------

def _run_health_checks(checks: list[dict]) -> tuple[list[dict], str, str]:
    """Run all health checks for a connector.

    Returns: (results_list, overall_status, status_detail)
    """
    results = []
    for check in checks:
        check_type = check.get("type", "")
        runner = CHECK_RUNNERS.get(check_type)
        if not runner:
            results.append({"name": check.get("name", "unknown"), "status": "skip", "detail": f"Unknown check type: {check_type}"})
            continue

        result = runner(check)
        results.append({
            "name": result.name,
            "status": result.status,
            "detail": result.detail,
            "description": check.get("description", ""),
        })

    ok_count = sum(1 for r in results if r["status"] == "ok")
    fail_count = sum(1 for r in results if r["status"] == "fail")
    total = len(results)

    if fail_count == 0 and ok_count > 0:
        return results, "connected", f"All {ok_count} checks passed"
    elif ok_count > 0:
        return results, "partial", f"{ok_count}/{total} checks passed"
    elif total == 0:
        return results, "available", "No health checks defined"
    else:
        return results, "available", f"Not configured"


def _discover_accounts(connector_def: dict) -> list[str]:
    """Discover accounts for a connector (if multi-account)."""
    accounts_config = connector_def.get("accounts", {})
    if not accounts_config:
        return []

    discover_from = accounts_config.get("discover_from", "")
    pattern = accounts_config.get("pattern", "*.json")
    extract = accounts_config.get("extract_identity", "")

    if not discover_from:
        return []

    discover_path = Path(os.path.expanduser(discover_from))
    if not discover_path.is_dir():
        return []

    accounts = []
    for f in sorted(discover_path.glob(pattern)):
        if extract == "filename_stem":
            accounts.append(f.stem)
        else:
            accounts.append(f.name)

    return accounts


def discover_connector(definition_path: Path) -> ConnectorStatus:
    """Discover the status of a single connector from its YAML definition."""
    data = yaml.safe_load(definition_path.read_text())

    # Run health checks
    checks = data.get("health", {}).get("checks", [])
    health_results, status, status_detail = _run_health_checks(checks)

    # Discover accounts
    accounts = _discover_accounts(data)

    return ConnectorStatus(
        id=data["id"],
        name=data["name"],
        icon=data.get("icon", "zap"),
        color=data.get("color", "#6B6560"),
        type=data["type"],
        tier=data.get("tier", 3),
        category=data.get("category", "general"),
        description=data.get("description", ""),
        status=status,
        status_detail=status_detail,
        capabilities=data.get("capabilities", []),
        health=health_results,
        automation_ideas=data.get("automation_ideas", []),
        accounts=accounts,
        n8n=data.get("n8n", {}),
    )


def discover_all(connectors_dir: Path | None = None) -> list[ConnectorStatus]:
    """Discover all connectors from YAML definitions.

    Returns a list of ConnectorStatus objects sorted by:
    1. Connected first, then partial, then available
    2. Lower tier first (native before catalog)
    3. Alphabetical
    """
    cdir = connectors_dir or CONNECTORS_DIR
    connectors = []

    for path in sorted(cdir.glob("*.yaml")):
        if path.name.startswith("_"):
            continue
        try:
            connector = discover_connector(path)
            connectors.append(connector)
        except Exception:
            logger.exception("Failed to discover connector: %s", path.name)

    # Sort: connected first, then by tier, then alphabetical
    status_order = {"connected": 0, "partial": 1, "available": 2, "broken": 3, "unavailable": 4}
    connectors.sort(key=lambda c: (status_order.get(c.status, 9), c.tier, c.name))

    return connectors


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys

    logging.basicConfig(level=logging.WARNING)
    connectors = discover_all()

    status_symbols = {
        "connected": "\033[32m●\033[0m",
        "partial": "\033[33m◐\033[0m",
        "available": "\033[90m○\033[0m",
        "broken": "\033[31m●\033[0m",
        "unavailable": "\033[90m✕\033[0m",
    }

    print(f"\nAOS Connectors — {len(connectors)} discovered\n")
    for c in connectors:
        sym = status_symbols.get(c.status, "?")
        accts = f" ({len(c.accounts)} accounts)" if c.accounts else ""
        ideas = f"  [{len(c.automation_ideas)} ideas]" if c.automation_ideas else ""
        print(f"  {sym} {c.name:22s} {c.type:8s} {c.status:10s}{accts}{ideas}")

        if "--verbose" in sys.argv:
            for h in c.health:
                hs = "✓" if h["status"] == "ok" else "✗"
                print(f"      {hs} {h['name']}: {h.get('detail', h.get('description', ''))}")
    print()
