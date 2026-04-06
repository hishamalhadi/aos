"""Connector Bridge — Link connector discovery to the automation system.

Bridges the connector discovery engine (core.infra.connectors.discover) with
the n8n automation builder. Provides dynamic node-type resolution, workflow
validation against live connector state, and structured context for prompt
injection so the architect agent knows exactly which services are available.

Replaces the hardcoded credential map in builder.py with live lookups.
"""

from __future__ import annotations

import logging
import sys
import time
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Import the discovery engine from the AOS core tree
# ---------------------------------------------------------------------------

AOS_HOME = Path.home() / "aos"

_discover_all = None


def _load_discover():
    """Lazy-load discover_all to avoid import-time side effects."""
    global _discover_all
    if _discover_all is not None:
        return _discover_all

    try:
        sys.path.insert(0, str(AOS_HOME / "core"))
        from infra.connectors.discover import discover_all
        _discover_all = discover_all
    except Exception:
        logger.warning("Could not import connector discovery engine; bridge will return empty results")
        _discover_all = lambda: []  # noqa: E731

    return _discover_all


# ---------------------------------------------------------------------------
# Module-level cache (avoids re-running health checks on rapid calls)
# ---------------------------------------------------------------------------

_cache: dict[str, Any] = {"connectors": None, "ts": 0.0}
_CACHE_TTL = 30  # seconds


def _get_connectors():
    """Return cached connector list, refreshing if stale."""
    now = time.time()
    if _cache["connectors"] is not None and (now - _cache["ts"]) < _CACHE_TTL:
        return _cache["connectors"]

    discover_all = _load_discover()
    try:
        connectors = discover_all()
    except Exception:
        logger.exception("Connector discovery failed")
        connectors = []

    _cache["connectors"] = connectors
    _cache["ts"] = now
    return connectors


# ---------------------------------------------------------------------------
# Always-available n8n node types (no connector required)
# ---------------------------------------------------------------------------

ALWAYS_AVAILABLE: set[str] = {
    "n8n-nodes-base.scheduleTrigger",
    "n8n-nodes-base.webhook",
    "n8n-nodes-base.httpRequest",
    "n8n-nodes-base.code",
    "n8n-nodes-base.set",
    "n8n-nodes-base.if",
    "n8n-nodes-base.switch",
    "n8n-nodes-base.wait",
    "n8n-nodes-base.executeWorkflow",
    "n8n-nodes-base.noOp",
}


# ---------------------------------------------------------------------------
# 1. get_available_node_types
# ---------------------------------------------------------------------------

def get_available_node_types() -> dict[str, dict]:
    """Map every known n8n node type to its connector info.

    Returns a dict keyed by n8n node type string. Each value contains
    the connector's identity, status, and credential types for that node.
    Always-available utility nodes are included with connector_id "builtin".
    """
    result: dict[str, dict] = {}

    # Add always-available nodes first
    for node_type in ALWAYS_AVAILABLE:
        short_name = node_type.rsplit(".", 1)[-1]
        result[node_type] = {
            "connector_id": "builtin",
            "connector_name": "Built-in",
            "status": "always",
            "icon": "cpu",
            "color": "#6B6560",
            "credential_types": [],
            "short_name": short_name,
        }

    # Walk connectors and extract n8n node types
    for connector in _get_connectors():
        n8n_info = connector.n8n or {}
        node_types = n8n_info.get("node_types", [])
        credential_types = n8n_info.get("credential_types", [])

        for node_type in node_types:
            result[node_type] = {
                "connector_id": connector.id,
                "connector_name": connector.name,
                "status": connector.status,
                "icon": connector.icon,
                "color": connector.color,
                "credential_types": credential_types,
                "short_name": node_type.rsplit(".", 1)[-1],
            }

    return result


# ---------------------------------------------------------------------------
# 2. validate_workflow_nodes
# ---------------------------------------------------------------------------

def validate_workflow_nodes(nodes: list[dict]) -> dict:
    """Validate that every node in a workflow has a usable connector.

    Args:
        nodes: List of n8n node dicts (each must have "type" and "name").

    Returns:
        A dict with "valid" (bool), "nodes" (per-node status), and
        top-level "issues" (list of strings).
    """
    available = get_available_node_types()
    node_results: list[dict] = []
    top_issues: list[str] = []
    all_valid = True

    for node in nodes:
        n8n_type = node.get("type", "")
        node_name = node.get("name", n8n_type)
        issues: list[str] = []

        if n8n_type in ALWAYS_AVAILABLE:
            node_results.append({
                "name": node_name,
                "n8n_type": n8n_type,
                "connector_id": "builtin",
                "connector_name": "Built-in",
                "status": "connected",
                "issues": [],
            })
            continue

        info = available.get(n8n_type)

        if info is None:
            issues.append(f"Unknown node type: {n8n_type} — no connector provides this")
            all_valid = False
            node_results.append({
                "name": node_name,
                "n8n_type": n8n_type,
                "connector_id": None,
                "connector_name": None,
                "status": "unavailable",
                "issues": issues,
            })
            top_issues.append(f"Node '{node_name}' uses unknown type '{n8n_type}'")
            continue

        status = info["status"]
        connector_id = info["connector_id"]
        connector_name = info["connector_name"]

        if status in ("available",):
            issues.append(f"Connector '{connector_name}' is not configured — set it up first")
            all_valid = False
            top_issues.append(
                f"Node '{node_name}' requires '{connector_name}' which is not configured"
            )
        elif status == "broken":
            issues.append(f"Connector '{connector_name}' is broken — check health")
            all_valid = False
            top_issues.append(
                f"Node '{node_name}' requires '{connector_name}' which is broken"
            )
        elif status == "unavailable":
            issues.append(f"Connector '{connector_name}' is unavailable on this system")
            all_valid = False
            top_issues.append(
                f"Node '{node_name}' requires '{connector_name}' which is unavailable"
            )
        elif status == "partial":
            issues.append(f"Connector '{connector_name}' is partially configured — may work")
            # Partial is still considered valid (usable)

        node_results.append({
            "name": node_name,
            "n8n_type": n8n_type,
            "connector_id": connector_id,
            "connector_name": connector_name,
            "status": status,
            "issues": issues,
        })

    return {
        "valid": all_valid,
        "nodes": node_results,
        "issues": top_issues,
    }


# ---------------------------------------------------------------------------
# 3. get_structured_context / to_prompt_text
# ---------------------------------------------------------------------------

def get_structured_context() -> dict:
    """Return all connector info organized for consumption.

    The returned dict has three keys:
    - connectors: full list with n8n types, credential types, capabilities
    - available_n8n_types: node types from connected/partial connectors only
    - all_n8n_types: node types from every connector regardless of status
    """
    connectors_data: list[dict] = []
    available_types: list[str] = []
    all_types: list[str] = []

    for connector in _get_connectors():
        n8n_info = connector.n8n or {}
        node_types = n8n_info.get("node_types", [])
        credential_types = n8n_info.get("credential_types", [])

        # Extract capability names from capability dicts
        cap_names = []
        for cap in connector.capabilities:
            if isinstance(cap, dict):
                cap_names.append(cap.get("label", cap.get("name", cap.get("id", ""))))
            else:
                cap_names.append(str(cap))

        connectors_data.append({
            "id": connector.id,
            "name": connector.name,
            "status": connector.status,
            "n8n_node_types": node_types,
            "credential_types": credential_types,
            "capabilities": cap_names,
            "accounts": connector.accounts,
        })

        all_types.extend(node_types)
        if connector.status in ("connected", "partial"):
            available_types.extend(node_types)

    return {
        "connectors": connectors_data,
        "available_n8n_types": sorted(set(available_types)),
        "all_n8n_types": sorted(set(all_types)),
    }


def to_prompt_text(context: dict) -> str:
    """Format structured context as rich text for a Claude prompt.

    Args:
        context: Dict returned by get_structured_context().

    Returns:
        A markdown-formatted string describing available services and
        node types suitable for injection into a system/user prompt.
    """
    lines: list[str] = []

    # -- Connected services --
    lines.append("## Connected Services\n")

    connectors = context.get("connectors", [])
    if not connectors:
        lines.append("No connectors discovered.\n")
    else:
        for c in connectors:
            status_tag = c["status"].upper()
            lines.append(f"### {c['name']} [{status_tag}]")

            if c.get("n8n_node_types"):
                short_names = [t.rsplit(".", 1)[-1] for t in c["n8n_node_types"]]
                lines.append(f"- n8n nodes: {', '.join(short_names)}")

            if c.get("credential_types"):
                lines.append(f"- Credentials: {', '.join(c['credential_types'])}")

            if c.get("accounts"):
                lines.append(f"- Accounts: {', '.join(c['accounts'])}")

            if c.get("capabilities"):
                lines.append(f"- Capabilities: {', '.join(c['capabilities'])}")

            lines.append("")

    # -- Available node types --
    lines.append("## Available n8n Node Types (use ONLY these in your design)\n")

    # Always-available first
    for node_type in sorted(ALWAYS_AVAILABLE):
        short = node_type.rsplit(".", 1)[-1]
        lines.append(f"- {node_type} (always available)")

    # Then connector-provided types (only connected/partial)
    available_types = context.get("available_n8n_types", [])
    # Build a reverse lookup: node_type -> connector name
    type_to_connector: dict[str, str] = {}
    for c in connectors:
        for nt in c.get("n8n_node_types", []):
            type_to_connector[nt] = c["name"]

    for node_type in sorted(available_types):
        if node_type in ALWAYS_AVAILABLE:
            continue  # already listed
        source = type_to_connector.get(node_type, "unknown")
        lines.append(f"- {node_type} ({source})")

    lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# 4. resolve_credential_type
# ---------------------------------------------------------------------------

def resolve_credential_type(n8n_type: str) -> str | None:
    """Resolve the credential type for an n8n node type.

    Looks up the connector that provides this node type and returns
    the first matching credential type. Returns None if the node type
    is unknown or has no credentials (e.g., built-in utility nodes).

    This replaces the hardcoded cred_map in builder.py with a live
    lookup against the connector discovery system.
    """
    if n8n_type in ALWAYS_AVAILABLE:
        return None

    available = get_available_node_types()
    info = available.get(n8n_type)
    if not info:
        return None

    cred_types = info.get("credential_types", [])
    if not cred_types:
        return None

    # If the connector has multiple credential types, try to match by
    # node short name. For example, gmail -> gmailOAuth2, not googleCalendarOAuth2Api.
    short_name = n8n_type.rsplit(".", 1)[-1].lower()
    for ct in cred_types:
        if short_name in ct.lower():
            return ct

    # Fallback: return the first credential type
    return cred_types[0]
