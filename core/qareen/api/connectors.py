"""Qareen API — Connectors routes.

Unified view of all external service connections.
Discovers what's connected on this machine by reading connector
definitions and running health checks.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/connectors", tags=["connectors"])

AOS_HOME = Path.home() / "aos"


def _get_discoverer():
    """Import the connector discovery engine."""
    sys.path.insert(0, str(AOS_HOME / "core"))
    from infra.connectors.discover import discover_all
    return discover_all


@router.get("")
async def list_connectors() -> JSONResponse:
    """List all connectors with their current status.

    Returns connectors sorted by: connected first, then by tier, then alphabetical.
    Each connector includes: status, capabilities, health check results, automation ideas.
    """
    try:
        discover_all = _get_discoverer()
        connectors = discover_all()

        connected = sum(1 for c in connectors if c.status == "connected")
        partial = sum(1 for c in connectors if c.status == "partial")
        available = sum(1 for c in connectors if c.status == "available")

        return JSONResponse({
            "connectors": [c.to_dict() for c in connectors],
            "summary": {
                "total": len(connectors),
                "connected": connected,
                "partial": partial,
                "available": available,
            },
        })
    except Exception as e:
        logger.exception("Failed to discover connectors")
        return JSONResponse({"error": str(e)}, status_code=500)


@router.get("/{connector_id}")
async def get_connector(connector_id: str) -> JSONResponse:
    """Get a single connector's status and details."""
    try:
        discover_all = _get_discoverer()
        connectors = discover_all()

        for c in connectors:
            if c.id == connector_id:
                return JSONResponse(c.to_dict())

        return JSONResponse({"error": "Connector not found"}, status_code=404)
    except Exception as e:
        logger.exception("Failed to get connector")
        return JSONResponse({"error": str(e)}, status_code=500)


@router.get("/{connector_id}/health")
async def check_connector_health(connector_id: str) -> JSONResponse:
    """Run health checks for a specific connector (on-demand)."""
    try:
        discover_all = _get_discoverer()
        connectors = discover_all()

        for c in connectors:
            if c.id == connector_id:
                return JSONResponse({
                    "id": c.id,
                    "status": c.status,
                    "status_detail": c.status_detail,
                    "health": c.health,
                })

        return JSONResponse({"error": "Connector not found"}, status_code=404)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
