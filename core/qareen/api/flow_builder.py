"""Qareen API — Flow Builder routes.

Thin API layer over the FlowBuilder that converts FlowSystemSpec
into n8n workflows and deploys them.

Endpoints:
  POST /api/flow-builder/build     — Convert spec to n8n workflow JSON(s)
  POST /api/flow-builder/deploy    — Deploy workflow JSON(s) to n8n
"""

from __future__ import annotations

import json
import logging
import sqlite3
import sys
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/flow-builder", tags=["flow-builder"])

AOS_HOME = Path.home() / "aos"
AOS_DATA = Path.home() / ".aos"
QAREEN_DB = AOS_DATA / "data" / "qareen.db"


def _get_builder(request: Request):
    """Get or create a FlowBuilder instance."""
    n8n_client = getattr(request.app.state, "n8n_client", None)
    if not n8n_client:
        return None

    sys.path.insert(0, str(AOS_HOME / "core"))
    from automations.builder import FlowBuilder
    return FlowBuilder(n8n_client)


@router.post("/build")
async def build_workflows(request: Request) -> JSONResponse:
    """Convert a FlowSystemSpec into n8n workflow JSON objects.

    Body: { "spec": { ...FlowSystemSpec... } }
    Returns: { "workflows": [...n8n workflow JSON...] }
    """
    body = await request.json()
    spec = body.get("spec")
    if not spec:
        return JSONResponse({"error": "spec is required"}, status_code=400)

    if not isinstance(spec, dict) or "pipelines" not in spec:
        return JSONResponse({"error": "invalid spec: missing pipelines"}, status_code=400)

    builder = _get_builder(request)
    if not builder:
        return JSONResponse({"error": "n8n service not available"}, status_code=503)

    try:
        workflows = await builder.build(spec)

        # Validate connector availability
        validation = {"valid": True, "nodes": [], "issues": []}
        try:
            sys.path.insert(0, str(AOS_HOME / "core"))
            from automations.connector_bridge import validate_workflow_nodes
            all_nodes = []
            for wf in workflows:
                all_nodes.extend(wf.get("nodes", []))
            validation = validate_workflow_nodes(all_nodes)
        except Exception:
            logger.debug("Connector validation unavailable")

        return JSONResponse({
            "workflows": workflows,
            "count": len(workflows),
            "validation": validation,
        })
    except Exception as e:
        logger.exception("Build failed")
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/deploy")
async def deploy_workflows(request: Request) -> JSONResponse:
    """Deploy n8n workflow JSON objects to n8n.

    Body: { "workflows": [...n8n workflow JSON...], "activate": true }
    Returns: { "workflow_ids": [...] }
    """
    body = await request.json()
    workflows = body.get("workflows", [])
    activate = body.get("activate", False)

    if not workflows:
        return JSONResponse({"error": "workflows list is required"}, status_code=400)

    builder = _get_builder(request)
    if not builder:
        return JSONResponse({"error": "n8n service not available"}, status_code=503)

    try:
        # Pre-flight: validate connectors unless force=True
        force = body.get("force", False)
        if not force:
            try:
                sys.path.insert(0, str(AOS_HOME / "core"))
                from automations.connector_bridge import validate_workflow_nodes
                all_nodes = []
                for wf in workflows:
                    all_nodes.extend(wf.get("nodes", []))
                validation = validate_workflow_nodes(all_nodes)
                if not validation.get("valid", True):
                    return JSONResponse({
                        "error": "Integration check failed",
                        "validation": validation,
                    }, status_code=422)
            except Exception:
                logger.debug("Connector validation unavailable, proceeding")

        workflow_ids = await builder.deploy(workflows)

        # Activate if requested
        if activate:
            n8n_client = getattr(request.app.state, "n8n_client", None)
            for wf_id in workflow_ids:
                try:
                    await n8n_client.activate_workflow(wf_id)
                except Exception as e:
                    logger.warning("Failed to activate workflow %s: %s", wf_id, e)

        # Track in qareen.db automations table
        name = body.get("name", "Automation")
        description = body.get("description", "")
        for wf_id in workflow_ids:
            try:
                automation_id = f"n8n_{uuid.uuid4().hex[:8]}"
                conn = sqlite3.connect(str(QAREEN_DB))
                conn.execute(
                    """INSERT OR IGNORE INTO automations
                       (id, name, description, n8n_workflow_id, status,
                        trigger_type, created_at, activated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        automation_id, name, description, wf_id,
                        "active" if activate else "draft",
                        "schedule", datetime.utcnow().isoformat(),
                        datetime.utcnow().isoformat() if activate else None,
                    ),
                )
                conn.commit()
                conn.close()
            except Exception:
                logger.debug("Failed to track automation %s", wf_id)

        return JSONResponse({
            "workflow_ids": workflow_ids,
            "count": len(workflow_ids),
            "activated": activate,
        }, status_code=201)
    except Exception as e:
        logger.exception("Deploy failed")
        return JSONResponse({"error": str(e)}, status_code=500)
