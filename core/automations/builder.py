"""FlowBuilder — Convert FlowSystemSpec to deployable n8n workflows.

Takes a FlowSystemSpec (produced by the Automation Architect) and converts
it into one or more n8n workflow JSON objects, then deploys them via the
N8nClient.

Handles three complexity levels:
- simple:  Linear pipeline, direct node mapping
- complex: Switch/If branching with multiple outputs
- super-complex: Sub-workflows via executeWorkflow nodes
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from .client import N8nClient

logger = logging.getLogger(__name__)

# Node type mapping for AOS-specific step types
AOS_NODE_MAP = {
    "agent_dispatch": {
        "type": "n8n-nodes-base.httpRequest",
        "defaults": {
            "method": "POST",
            "url": "http://127.0.0.1:4096/api/agents/dispatch",
            "sendBody": True,
            "specifyBody": "json",
            "options": {},
        },
    },
    "hitl_approval": {
        "type": "n8n-nodes-base.wait",
        "defaults": {
            "resume": "webhook",
            "options": {},
        },
    },
    "sub_workflow": {
        "type": "n8n-nodes-base.executeWorkflow",
        "defaults": {
            "source": "database",
            "options": {},
        },
    },
}


class FlowBuilder:
    """Converts FlowSystemSpec dicts into n8n workflow JSON and deploys them."""

    def __init__(self, n8n_client: N8nClient):
        self._client = n8n_client

    async def build(self, spec: dict) -> list[dict]:
        """Convert a FlowSystemSpec into n8n workflow JSON objects.

        Returns a list of workflow dicts (one per pipeline), ordered so
        child workflows come before parents.
        """
        pipelines = spec.get("pipelines", [])
        if not pipelines:
            raise ValueError("FlowSystemSpec has no pipelines")

        # Build in dependency order: pipelines with no calls_pipelines first
        ordered = self._dependency_order(pipelines)
        workflows = []

        # Track pipeline_id -> built workflow for sub-workflow references
        built: dict[str, dict] = {}

        for pipeline in ordered:
            wf = self._build_pipeline(pipeline, spec.get("name", "Automation"), built)
            workflows.append(wf)
            built[pipeline["id"]] = wf

        return workflows

    async def deploy(self, workflows: list[dict]) -> list[str]:
        """Deploy workflow JSONs to n8n and return their IDs.

        Deploys in order (children first) so parent workflows can
        reference child workflow IDs.
        """
        deployed_ids: list[str] = []
        id_map: dict[str, str] = {}  # local_name -> n8n_id

        for wf in workflows:
            # Replace placeholder sub-workflow IDs with real ones
            for node in wf.get("nodes", []):
                if node.get("type") == "n8n-nodes-base.executeWorkflow":
                    ref_name = node.get("parameters", {}).get("_ref_pipeline_name", "")
                    if ref_name and ref_name in id_map:
                        node["parameters"]["workflowId"] = id_map[ref_name]
                    # Clean up internal reference
                    node["parameters"].pop("_ref_pipeline_name", None)

            created = await self._client.create_workflow(
                name=wf["name"],
                nodes=wf["nodes"],
                connections=wf["connections"],
                settings=wf.get("settings"),
            )
            n8n_id = created.get("id", "")
            deployed_ids.append(n8n_id)
            id_map[wf["name"]] = n8n_id

            logger.info("Deployed workflow '%s' -> %s", wf["name"], n8n_id)

        return deployed_ids

    # -- Internal pipeline builders --

    def _build_pipeline(
        self,
        pipeline: dict,
        system_name: str,
        built: dict[str, dict],
    ) -> dict:
        """Convert a single PipelineSpec to an n8n workflow dict."""
        nodes: list[dict] = []
        connections: dict[str, dict] = {}

        wf_name = f"{system_name} — {pipeline.get('name', pipeline['id'])}"
        steps = pipeline.get("steps", [])
        trigger = pipeline.get("trigger", {})

        # Position tracking
        x, y = 250, 300
        x_step = 250

        # Build trigger node
        trigger_type = trigger.get("type", "n8n-nodes-base.scheduleTrigger")
        trigger_params = trigger.get("parameters", {})
        trigger_node = {
            "id": str(uuid.uuid4()),
            "name": "Trigger",
            "type": trigger_type,
            "typeVersion": 1,
            "position": [x, y],
            "parameters": trigger_params,
        }
        nodes.append(trigger_node)
        x += x_step

        # Build step nodes
        step_nodes: dict[str, dict] = {}  # step_id -> n8n node
        step_ids_ordered: list[str] = []

        for step in steps:
            node = self._build_step_node(step, x, y, built)
            nodes.append(node)
            step_nodes[step["id"]] = node
            step_ids_ordered.append(step["id"])
            x += x_step

        # Build connections
        # Connect trigger to first step
        if steps:
            first_step = step_nodes[steps[0]["id"]]
            connections[trigger_node["name"]] = {
                "main": [[{"node": first_step["name"], "type": "main", "index": 0}]]
            }

        # Connect steps to each other
        for step in steps:
            node = step_nodes[step["id"]]
            next_ids = step.get("next", [])
            branch_conditions = step.get("branch_conditions")

            if branch_conditions:
                # Branching: each condition maps to an output index
                outputs: list[list[dict]] = []
                for bc in branch_conditions:
                    target_id = bc.get("target_step", "")
                    if target_id in step_nodes:
                        target_node = step_nodes[target_id]
                        outputs.append([{"node": target_node["name"], "type": "main", "index": 0}])
                    else:
                        outputs.append([])
                if outputs:
                    connections[node["name"]] = {"main": outputs}

            elif next_ids:
                # Linear: connect to next steps
                targets = []
                for nid in next_ids:
                    if nid in step_nodes:
                        targets.append({"node": step_nodes[nid]["name"], "type": "main", "index": 0})
                if targets:
                    connections[node["name"]] = {"main": [targets]}

            else:
                # Auto-connect to the next step in sequence if no explicit next
                idx = step_ids_ordered.index(step["id"])
                if idx < len(step_ids_ordered) - 1:
                    next_step_id = step_ids_ordered[idx + 1]
                    if next_step_id in step_nodes:
                        next_node = step_nodes[next_step_id]
                        connections[node["name"]] = {
                            "main": [[{"node": next_node["name"], "type": "main", "index": 0}]]
                        }

        return {
            "name": wf_name,
            "nodes": nodes,
            "connections": connections,
            "settings": {"executionOrder": "v1"},
        }

    def _build_step_node(
        self,
        step: dict,
        x: int,
        y: int,
        built: dict[str, dict],
    ) -> dict:
        """Convert a single StepSpec to an n8n node dict."""
        step_type = step.get("type", "n8n_node")
        label = step.get("label", "Step")
        params = dict(step.get("parameters", {}))

        if step_type == "n8n_node":
            n8n_type = step.get("n8n_type", "n8n-nodes-base.set")
            node = {
                "id": str(uuid.uuid4()),
                "name": label,
                "type": n8n_type,
                "typeVersion": 1,
                "position": [x, y],
                "parameters": params,
            }
            # Add credential stubs for known types
            cred_type = self._infer_credential_type(n8n_type)
            if cred_type:
                node["credentials"] = {cred_type: {"id": None, "name": ""}}
            return node

        elif step_type == "agent_dispatch":
            mapping = AOS_NODE_MAP["agent_dispatch"]
            agent_id = step.get("agent_id", "")
            task = params.pop("task", "")
            context = params.pop("context", "")
            body = {"agent_id": agent_id, "task": task}
            if context:
                body["context"] = context
            node_params = {**mapping["defaults"], "jsonBody": json.dumps(body)}
            return {
                "id": str(uuid.uuid4()),
                "name": label,
                "type": mapping["type"],
                "typeVersion": 4,
                "position": [x, y],
                "parameters": node_params,
            }

        elif step_type == "hitl_approval":
            mapping = AOS_NODE_MAP["hitl_approval"]
            return {
                "id": str(uuid.uuid4()),
                "name": label,
                "type": mapping["type"],
                "typeVersion": 1,
                "position": [x, y],
                "parameters": {**mapping["defaults"], **params},
            }

        elif step_type == "sub_workflow":
            mapping = AOS_NODE_MAP["sub_workflow"]
            ref_pipeline = params.pop("pipeline_id", "")
            node_params = {**mapping["defaults"]}
            # If the child workflow is already built, reference it
            if ref_pipeline in built:
                node_params["_ref_pipeline_name"] = built[ref_pipeline].get("name", "")
            return {
                "id": str(uuid.uuid4()),
                "name": label,
                "type": mapping["type"],
                "typeVersion": 1,
                "position": [x, y],
                "parameters": node_params,
            }

        else:
            # Fallback: generic set node
            return {
                "id": str(uuid.uuid4()),
                "name": label,
                "type": "n8n-nodes-base.set",
                "typeVersion": 1,
                "position": [x, y],
                "parameters": params,
            }

    @staticmethod
    def _infer_credential_type(n8n_type: str) -> str | None:
        """Infer the n8n credential type needed for a node type."""
        # Try connector bridge first (dynamic, from connector YAMLs)
        try:
            from .connector_bridge import resolve_credential_type
            cred = resolve_credential_type(n8n_type)
            if cred:
                return cred
        except Exception:
            pass
        # Fallback for when bridge isn't available
        _FALLBACK = {
            "n8n-nodes-base.telegram": "telegramApi",
            "n8n-nodes-base.gmail": "gmailOAuth2",
            "n8n-nodes-base.googleCalendar": "googleCalendarOAuth2Api",
            "n8n-nodes-base.googleSheets": "googleSheetsOAuth2Api",
        }
        return _FALLBACK.get(n8n_type)

    @staticmethod
    def _dependency_order(pipelines: list[dict]) -> list[dict]:
        """Sort pipelines so children come before parents."""
        by_id = {p["id"]: p for p in pipelines}
        visited: set[str] = set()
        ordered: list[dict] = []

        def visit(pid: str) -> None:
            if pid in visited or pid not in by_id:
                return
            visited.add(pid)
            p = by_id[pid]
            for child_id in p.get("calls_pipelines", []):
                visit(child_id)
            ordered.append(p)

        for p in pipelines:
            visit(p["id"])

        return ordered


# Need json for agent_dispatch body serialization
import json  # noqa: E402
