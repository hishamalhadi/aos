"""Model discovery engine.

Scans local caches (HuggingFace, QMD, Whisper, Ollama) and running
processes to build a live inventory of all AI models on this machine.

Usage:
    from core.infra.models.discover import discover_models, reconcile

    discovered = discover_models()
    diff = reconcile(discovered)

CLI:
    python3 -m core.infra.models.discover
    python3 -m core.infra.models.discover --reconcile
"""

from __future__ import annotations

import logging
import os
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger(__name__)

REGISTRY_PATH = Path.home() / ".aos" / "config" / "models.yaml"

# Known model → purpose mappings (by name patterns)
PURPOSE_PATTERNS: list[tuple[str, str]] = [
    ("whisper", "stt"),
    ("parakeet", "stt"),
    ("canary", "stt"),
    ("distil-whisper", "stt"),
    ("kokoro", "tts"),
    ("orpheus", "tts"),
    ("snac", "codec"),
    ("nomic-embed", "embeddings"),
    ("nomic-bert", "embeddings"),
    ("embeddinggemma", "embeddings"),
    ("reranker", "reranking"),
    ("query-expansion", "expansion"),
    ("wespeaker", "diarization"),
    ("spkrec", "diarization"),
    ("ecapa", "diarization"),
    ("pyannote", "diarization"),
]

# Known runtimes by source
RUNTIME_MAP: dict[str, str] = {
    "huggingface": "mlx",  # default; override if not mlx
    "qmd": "gguf",
    "whisper": "pytorch",
    "ollama": "local",
}


@dataclass
class DiscoveredModel:
    """A model found on the local filesystem or running as a service."""

    id: str
    name: str
    purpose: str  # stt | tts | embeddings | reranking | expansion | codec | diarization | unknown
    runtime: str  # mlx | gguf | pytorch | api | app | local
    source: str  # huggingface | qmd | whisper | ollama | system
    size_gb: float = 0.0
    location: str = ""  # path or repo id
    running: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "purpose": self.purpose,
            "runtime": self.runtime,
            "source": self.source,
            "size_gb": self.size_gb,
            "location": self.location,
            "running": self.running,
        }


def _infer_purpose(name: str) -> str:
    """Infer model purpose from its name."""
    lower = name.lower()
    for pattern, purpose in PURPOSE_PATTERNS:
        if pattern in lower:
            return purpose
    return "unknown"


def _make_id(repo_or_name: str) -> str:
    """Generate a registry-style ID from a repo name."""
    name = repo_or_name.split("/")[-1]
    return name.lower().replace(" ", "-").replace("_", "-")


# Human-readable names for known models
_KNOWN_NAMES: dict[str, str] = {
    "canary-1b-v2-mlx-q8": "Canary 1B v2",
    "kokoro-82m-bf16": "Kokoro 82M",
    "kokoro-82m": "Kokoro 82M (PyTorch)",
    "orpheus-3b-0.1-ft-bf16": "Orpheus 3B",
    "distil-whisper-large-v3": "Distil-Whisper Large v3",
    "parakeet-tdt-0.6b-v3": "Parakeet TDT 0.6B v3",
    "parakeet-tdt-0.6b-v2-mlx": "Parakeet TDT 0.6B v2",
    "parakeet-tdt-1.1b": "Parakeet TDT 1.1B",
    "snac-24khz": "SNAC 24kHz",
    "whisper-base-mlx": "Whisper Base (MLX)",
    "whisper-large-v3-turbo": "Whisper Large v3 Turbo",
    "whisper-medium-mlx": "Whisper Medium (MLX)",
    "nomic-bert-2048": "Nomic BERT 2048",
    "nomic-embed-text-v1.5": "Nomic Embed v1.5",
    "wespeaker-voxceleb-resnet34-lm": "WeSpeaker ResNet34-LM",
    "spkrec-ecapa-voxceleb": "ECAPA-TDNN",
    "hf-ggml-org-embeddinggemma-300m-q8-0": "EmbeddingGemma 300M",
    "hf-ggml-org-qwen3-reranker-0.6b-q8-0": "Qwen3 Reranker 0.6B",
    "hf-tobil-qmd-query-expansion-1.7b-q4-k-m": "QMD Query Expansion 1.7B",
}


def _humanize(name: str) -> str:
    """Make a model name human-readable."""
    mid = _make_id(name)
    if mid in _KNOWN_NAMES:
        return _KNOWN_NAMES[mid]
    return name.replace("-", " ").replace("_", " ").title()


# ---------------------------------------------------------------------------
# Scanners
# ---------------------------------------------------------------------------

def _scan_huggingface() -> list[DiscoveredModel]:
    """Scan ~/.cache/huggingface/hub/ for downloaded models."""
    hf_dir = Path.home() / ".cache" / "huggingface" / "hub"
    if not hf_dir.exists():
        return []

    models = []
    for d in sorted(hf_dir.iterdir()):
        if not d.name.startswith("models--"):
            continue
        parts = d.name[8:].split("--")
        org = parts[0] if len(parts) > 1 else ""
        name = parts[1] if len(parts) > 1 else parts[0]
        repo = f"{org}/{name}" if org else name

        try:
            size = sum(f.stat().st_size for f in d.rglob("*") if f.is_file()) / 1e9
        except OSError:
            size = 0

        mid = _make_id(name)
        purpose = _infer_purpose(repo)
        runtime = "mlx" if "mlx" in repo.lower() else "pytorch"

        models.append(DiscoveredModel(
            id=mid,
            name=_humanize(name),
            purpose=purpose,
            runtime=runtime,
            source="huggingface",
            size_gb=round(size, 2),
            location=repo,
        ))

    return models


def _scan_qmd() -> list[DiscoveredModel]:
    """Scan ~/.cache/qmd/models/ for GGUF models."""
    qmd_dir = Path.home() / ".cache" / "qmd" / "models"
    if not qmd_dir.exists():
        return []

    models = []
    for f in sorted(qmd_dir.iterdir()):
        if not f.is_file():
            continue

        try:
            size = f.stat().st_size / 1e9
        except OSError:
            size = 0

        mid = _make_id(f.stem)
        purpose = _infer_purpose(f.stem)

        models.append(DiscoveredModel(
            id=mid,
            name=_humanize(f.stem.split("_")[-1] if "_" in f.stem else f.stem),
            purpose=purpose,
            runtime="gguf",
            source="qmd",
            size_gb=round(size, 2),
            location=str(f),
        ))

    return models


def _scan_whisper_cache() -> list[DiscoveredModel]:
    """Scan ~/.cache/whisper/ for OpenAI whisper checkpoints."""
    whisper_dir = Path.home() / ".cache" / "whisper"
    if not whisper_dir.exists():
        return []

    models = []
    for f in sorted(whisper_dir.iterdir()):
        if not f.is_file():
            continue

        try:
            size = f.stat().st_size / 1e9
        except OSError:
            size = 0

        mid = f"whisper-{f.stem}-pt"
        models.append(DiscoveredModel(
            id=mid,
            name=f"Whisper {f.stem.title()} (PyTorch)",
            purpose="stt",
            runtime="pytorch",
            source="whisper",
            size_gb=round(size, 2),
            location=str(f),
        ))

    return models


def _scan_ollama() -> list[DiscoveredModel]:
    """Probe Ollama for available models."""
    try:
        import httpx
        resp = httpx.get("http://localhost:11434/api/tags", timeout=3)
        if resp.status_code != 200:
            return []
        data = resp.json()
        models = []
        for m in data.get("models", []):
            name = m["name"]
            size = m.get("size", 0) / 1e9
            models.append(DiscoveredModel(
                id=_make_id(name),
                name=name,
                purpose="execution",
                runtime="local",
                source="ollama",
                size_gb=round(size, 2),
                location="ollama",
                running=True,
            ))
        return models
    except Exception:
        return []


def _scan_running_processes() -> list[DiscoveredModel]:
    """Check for known AI apps running as processes."""
    models = []

    # SuperWhisper
    try:
        result = subprocess.run(
            ["pgrep", "-x", "superwhisper"],
            capture_output=True, timeout=5,
        )
        if result.returncode == 0:
            models.append(DiscoveredModel(
                id="superwhisper",
                name="SuperWhisper",
                purpose="stt",
                runtime="app",
                source="system",
                location="/Applications/superwhisper.app",
                running=True,
            ))
    except Exception:
        pass

    return models


# ---------------------------------------------------------------------------
# Main discovery
# ---------------------------------------------------------------------------

def discover_models() -> list[DiscoveredModel]:
    """Discover all AI models on this machine.

    Scans all known caches, probes local services, and checks running processes.
    Returns a list of DiscoveredModel objects.
    """
    models: list[DiscoveredModel] = []

    models.extend(_scan_huggingface())
    models.extend(_scan_qmd())
    models.extend(_scan_whisper_cache())
    models.extend(_scan_ollama())
    models.extend(_scan_running_processes())

    return models


# ---------------------------------------------------------------------------
# Reconcile
# ---------------------------------------------------------------------------

@dataclass
class ReconcileDiff:
    """Difference between discovered models and the registry."""

    new_models: list[DiscoveredModel] = field(default_factory=list)
    missing_models: list[str] = field(default_factory=list)  # registry IDs not found on disk
    size_changes: list[tuple[str, float, float]] = field(default_factory=list)  # id, old, new

    @property
    def is_clean(self) -> bool:
        return not self.new_models and not self.missing_models and not self.size_changes


def reconcile(discovered: list[DiscoveredModel] | None = None) -> ReconcileDiff:
    """Compare discovered models against the registry.

    Returns a diff showing what's new, what's missing, and what changed size.
    Does NOT modify the registry — callers decide what to do with the diff.
    """
    if discovered is None:
        discovered = discover_models()

    # Load registry
    registry: dict[str, Any] = {}
    if REGISTRY_PATH.is_file():
        try:
            data = yaml.safe_load(REGISTRY_PATH.read_text())
            registry = data.get("models", {})
        except Exception:
            pass

    # Registry entries that have a local source (not API/system)
    local_sources = {"huggingface", "qmd", "whisper", "ollama"}
    local_registry = {
        mid: m for mid, m in registry.items()
        if m.get("source") in local_sources
    }

    discovered_by_id = {m.id: m for m in discovered}
    diff = ReconcileDiff()

    # New: discovered but not in registry
    for dm in discovered:
        if dm.id not in registry:
            diff.new_models.append(dm)

    # Missing: in registry (local source) but not discovered
    for mid, m in local_registry.items():
        if mid not in discovered_by_id:
            diff.missing_models.append(mid)

    # Size changes
    for dm in discovered:
        if dm.id in registry:
            old_size = registry[dm.id].get("size_gb", 0)
            if old_size and abs(dm.size_gb - old_size) > 0.01:
                diff.size_changes.append((dm.id, old_size, dm.size_gb))

    return diff


def load_registry() -> dict[str, Any]:
    """Load the model registry from disk."""
    if REGISTRY_PATH.is_file():
        try:
            data = yaml.safe_load(REGISTRY_PATH.read_text())
            return data.get("models", {})
        except Exception:
            pass
    return {}


def get_preferred(purpose: str) -> dict[str, Any] | None:
    """Get the preferred model for a given purpose.

    Falls back to the first available model if no preferred is set.
    """
    registry = load_registry()
    preferred = None
    fallback = None

    for mid, m in registry.items():
        if m.get("purpose") != purpose:
            continue
        if m.get("status") == "disabled":
            continue
        if m.get("status") == "preferred":
            preferred = {**m, "id": mid}
        elif fallback is None:
            fallback = {**m, "id": mid}

    return preferred or fallback


def get_by_purpose(purpose: str) -> list[dict[str, Any]]:
    """Get all models for a given purpose, preferred first."""
    registry = load_registry()
    models = []
    for mid, m in registry.items():
        if m.get("purpose") != purpose and purpose != "all":
            continue
        if m.get("status") == "disabled":
            continue
        models.append({**m, "id": mid})

    # Sort: preferred first, then active, then available
    order = {"preferred": 0, "active": 1, "available": 2}
    models.sort(key=lambda m: order.get(m.get("status", "available"), 9))
    return models


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys

    logging.basicConfig(level=logging.WARNING)
    models = discover_models()

    print(f"\nAOS Model Discovery — {len(models)} models found\n")

    # Group by purpose
    from collections import defaultdict
    by_purpose: dict[str, list[DiscoveredModel]] = defaultdict(list)
    for m in models:
        by_purpose[m.purpose].append(m)

    for purpose in ["stt", "tts", "embeddings", "reranking", "expansion", "codec", "diarization", "execution", "unknown"]:
        items = by_purpose.get(purpose, [])
        if not items:
            continue
        print(f"  {purpose.upper()}")
        for m in items:
            running = " (running)" if m.running else ""
            print(f"    {m.size_gb:5.1f}GB  {m.runtime:8s}  {m.name}{running}")
        print()

    total = sum(m.size_gb for m in models)
    print(f"  Total: {total:.1f}GB\n")

    if "--reconcile" in sys.argv:
        diff = reconcile(models)
        if diff.is_clean:
            print("  Registry is in sync with filesystem.\n")
        else:
            if diff.new_models:
                print(f"  NEW ({len(diff.new_models)}):")
                for m in diff.new_models:
                    print(f"    + {m.id}  ({m.purpose}, {m.source})")
            if diff.missing_models:
                print(f"  MISSING ({len(diff.missing_models)}):")
                for mid in diff.missing_models:
                    print(f"    - {mid}")
            if diff.size_changes:
                print(f"  SIZE CHANGED ({len(diff.size_changes)}):")
                for mid, old, new in diff.size_changes:
                    print(f"    ~ {mid}  {old:.2f}GB → {new:.2f}GB")
            print()
