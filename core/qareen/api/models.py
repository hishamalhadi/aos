"""Qareen API — Model registry.

Exposes the unified model inventory: local models + remote APIs,
grouped by purpose. Merges the static registry (~/.aos/config/models.yaml)
with live discovery (filesystem scan, process checks).
"""

from __future__ import annotations

import logging
import sys
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/models", tags=["models"])

AOS_HOME = Path.home() / "aos"

# Discovery cache
_cache: dict[str, Any] = {"data": None, "ts": 0}
_CACHE_TTL = 120  # seconds


def _get_registry() -> dict[str, Any]:
    """Load the model registry from disk."""
    try:
        sys.path.insert(0, str(AOS_HOME / "core"))
        from infra.models.discover import load_registry
        return load_registry()
    except Exception:
        logger.exception("Failed to load model registry")
        return {}


def _get_discovery_diff() -> dict[str, Any] | None:
    """Run discovery and reconcile, with caching."""
    now = time.monotonic()
    if _cache["data"] is not None and (now - _cache["ts"]) < _CACHE_TTL:
        return _cache["data"]
    try:
        sys.path.insert(0, str(AOS_HOME / "core"))
        from infra.models.discover import discover_models, reconcile
        discovered = discover_models()
        diff = reconcile(discovered)
        result = {
            "discovered": {m.id: m.to_dict() for m in discovered},
            "new": [m.to_dict() for m in diff.new_models],
            "missing": diff.missing_models,
            "running": {m.id for m in discovered if m.running},
        }
        _cache["data"] = result
        _cache["ts"] = now
        return result
    except Exception:
        logger.exception("Discovery failed")
        return _cache.get("data")


@router.get("")
async def list_models() -> dict[str, Any]:
    """Full model inventory from registry, enriched with live discovery."""
    registry = _get_registry()
    discovery = _get_discovery_diff()
    running_ids = discovery["running"] if discovery else set()
    discovered = discovery["discovered"] if discovery else {}

    models = []
    for mid, m in registry.items():
        entry = {
            "id": mid,
            **m,
        }
        # Enrich with live status
        if mid in running_ids:
            entry["running"] = True
        if mid in discovered:
            disc = discovered[mid]
            # Update size if discovered size differs
            if disc.get("size_gb") and disc["size_gb"] > 0:
                entry["discovered_size_gb"] = disc["size_gb"]
            entry["on_disk"] = True
        else:
            # Remote APIs don't need to be on disk
            if m.get("source") not in ("api", "system"):
                entry["on_disk"] = False
        models.append(entry)

    # Add newly discovered models not yet in registry
    if discovery:
        registry_ids = set(registry.keys())
        for new_model in discovery.get("new", []):
            if new_model["id"] not in registry_ids:
                models.append({**new_model, "in_registry": False})

    # Group by purpose
    by_purpose: dict[str, list[dict]] = defaultdict(list)
    for m in models:
        by_purpose[m.get("purpose", "unknown")].append(m)

    # Sort within each group: preferred > active > available > disabled
    order = {"preferred": 0, "active": 1, "available": 2, "disabled": 9}
    for group in by_purpose.values():
        group.sort(key=lambda m: order.get(m.get("status", "available"), 5))

    return {
        "models": models,
        "by_purpose": dict(by_purpose),
        "total": len(models),
        "total_disk_gb": round(sum(m.get("size_gb", 0) for m in models), 1),
    }


@router.get("/summary")
async def model_summary() -> dict[str, Any]:
    """Summary: counts per purpose, total disk, preferred models."""
    registry = _get_registry()

    purposes: dict[str, dict[str, Any]] = defaultdict(lambda: {"count": 0, "preferred": None, "disk_gb": 0})
    for mid, m in registry.items():
        p = m.get("purpose", "unknown")
        purposes[p]["count"] += 1
        purposes[p]["disk_gb"] += m.get("size_gb", 0)
        if m.get("status") == "preferred":
            purposes[p]["preferred"] = mid

    # Sort purposes in a logical order
    purpose_order = ["execution", "stt", "tts", "embeddings", "reranking", "expansion", "codec", "diarization"]
    ordered = {}
    for p in purpose_order:
        if p in purposes:
            ordered[p] = {
                "count": purposes[p]["count"],
                "preferred": purposes[p]["preferred"],
                "disk_gb": round(purposes[p]["disk_gb"], 1),
            }

    total_disk = sum(m.get("size_gb", 0) for m in registry.values())

    return {
        "total": len(registry),
        "total_disk_gb": round(total_disk, 1),
        "by_purpose": ordered,
    }


@router.get("/by-purpose/{purpose}")
async def models_by_purpose(purpose: str) -> dict[str, Any]:
    """Get all models for a specific purpose."""
    registry = _get_registry()

    models = []
    for mid, m in registry.items():
        if m.get("purpose") != purpose:
            continue
        if m.get("status") == "disabled":
            continue
        models.append({"id": mid, **m})

    order = {"preferred": 0, "active": 1, "available": 2}
    models.sort(key=lambda m: order.get(m.get("status", "available"), 5))

    return {
        "purpose": purpose,
        "models": models,
        "total": len(models),
        "preferred": next((m["id"] for m in models if m.get("status") == "preferred"), None),
    }


@router.get("/preferred/{purpose}")
async def preferred_model(purpose: str) -> JSONResponse:
    """Get the preferred model for a purpose."""
    try:
        sys.path.insert(0, str(AOS_HOME / "core"))
        from infra.models.discover import get_preferred
        model = get_preferred(purpose)
        if model:
            return JSONResponse(model)
        return JSONResponse({"error": f"No model found for purpose: {purpose}"}, status_code=404)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
