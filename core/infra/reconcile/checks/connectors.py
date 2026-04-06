"""
Invariant: ~/.claude/mcp.json reflects global connectors from ~/.aos/config/connectors.yaml.

AOS stores the canonical connector registry at ~/.aos/config/connectors.yaml.
Claude Code reads MCP servers from ~/.claude/mcp.json. This check ensures that
every global-scope connector with a non-null command is present in mcp.json.

Only adds/updates — never removes servers that aren't in connectors.yaml,
since users may have added them directly via `claude mcp add`.
"""

import json
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).parent.parent))
from base import CheckResult, ReconcileCheck, Status


class ConnectorSyncCheck(ReconcileCheck):
    """Ensure ~/.claude/mcp.json reflects global connectors from ~/.aos/config/connectors.yaml."""

    name = "connector_sync"
    description = "Connectors config synced to Claude Code"

    CONNECTORS_YAML = Path.home() / ".aos" / "config" / "connectors.yaml"
    MCP_JSON = Path.home() / ".claude" / "mcp.json"

    def _load_connectors(self) -> dict:
        """Load connectors.yaml and return the connectors dict."""
        if not self.CONNECTORS_YAML.exists():
            return {}
        try:
            data = yaml.safe_load(self.CONNECTORS_YAML.read_text())
            return data.get("connectors", {}) if data else {}
        except (yaml.YAMLError, OSError):
            return {}

    def _global_connectors(self) -> dict:
        """Return only global-scope connectors with a non-null command.

        Returns a dict of {name: mcp_server_spec} ready to merge into mcp.json.
        """
        connectors = self._load_connectors()
        result = {}
        for name, cfg in connectors.items():
            if cfg.get("scope") != "global":
                continue
            if not cfg.get("command"):
                continue
            spec = {
                "type": "stdio",
                "command": cfg["command"],
                "args": cfg.get("args", []),
            }
            if cfg.get("env"):
                spec["env"] = cfg["env"]
            if cfg.get("cwd"):
                spec["cwd"] = cfg["cwd"]
            result[name] = spec
        return result

    def _load_mcp_json(self) -> dict:
        """Load mcp.json and return the full data dict."""
        if not self.MCP_JSON.exists():
            return {}
        try:
            return json.loads(self.MCP_JSON.read_text())
        except (json.JSONDecodeError, OSError):
            return {}

    def check(self) -> bool:
        if not self.CONNECTORS_YAML.exists():
            return True  # No source of truth yet — nothing to sync

        desired = self._global_connectors()
        if not desired:
            return True  # No global connectors to sync

        mcp_data = self._load_mcp_json()
        mcp_servers = mcp_data.get("mcpServers", {})

        for name, spec in desired.items():
            if name not in mcp_servers:
                return False
            # Check if the existing entry matches
            existing = mcp_servers[name]
            for key, value in spec.items():
                if existing.get(key) != value:
                    return False
        return True

    def fix(self) -> CheckResult:
        if not self.CONNECTORS_YAML.exists():
            return CheckResult(
                self.name, Status.SKIP,
                "No connectors.yaml found — nothing to sync"
            )

        desired = self._global_connectors()
        if not desired:
            return CheckResult(
                self.name, Status.OK,
                "No global connectors with commands to sync"
            )

        mcp_data = self._load_mcp_json()
        mcp_servers = mcp_data.get("mcpServers", {})

        added = []
        updated = []

        for name, spec in desired.items():
            if name not in mcp_servers:
                mcp_servers[name] = spec
                added.append(name)
            else:
                # Check if update needed
                existing = mcp_servers[name]
                needs_update = False
                for key, value in spec.items():
                    if existing.get(key) != value:
                        needs_update = True
                        break
                if needs_update:
                    mcp_servers[name] = spec
                    updated.append(name)

        if not added and not updated:
            return CheckResult(self.name, Status.OK, "All connectors in sync")

        mcp_data["mcpServers"] = mcp_servers
        self.MCP_JSON.parent.mkdir(parents=True, exist_ok=True)
        self.MCP_JSON.write_text(json.dumps(mcp_data, indent=2) + "\n")

        parts = []
        if added:
            parts.append(f"added {', '.join(added)}")
        if updated:
            parts.append(f"updated {', '.join(updated)}")

        return CheckResult(
            self.name, Status.FIXED,
            f"Synced connectors to mcp.json: {'; '.join(parts)}"
        )
