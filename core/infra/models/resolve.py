"""Model resolver — the interface subsystems use to find models.

Instead of hardcoding model repos/paths, subsystems call:

    from infra.models.resolve import resolve_stt, resolve_tts, resolve_model

    repo = resolve_stt()      # → "mlx-community/whisper-large-v3-turbo"
    repo = resolve_tts()      # → "mlx-community/Kokoro-82M-bf16"
    model = resolve_model("stt", runtime="mlx")  # → full model dict

This reads from ~/.aos/config/models.yaml and returns the preferred
model's repo/path. Falls back to hardcoded defaults if the registry
is missing or unreadable.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

# Hardcoded fallbacks — used only if registry is missing/broken
_FALLBACKS = {
    "stt": "mlx-community/whisper-large-v3-turbo",
    "stt-fast": "mlx-community/whisper-base-mlx",
    "stt-parakeet": "mlx-community/parakeet-tdt-0.6b-v3",
    "tts": "mlx-community/Kokoro-82M-bf16",
    "embeddings": "~/.cache/qmd/models/hf_ggml-org_embeddinggemma-300M-Q8_0.gguf",
    "reranking": "~/.cache/qmd/models/hf_ggml-org_qwen3-reranker-0.6b-q8_0.gguf",
    "expansion": "~/.cache/qmd/models/hf_tobil_qmd-query-expansion-1.7B-q4_k_m.gguf",
}


def resolve_model(purpose: str, runtime: str | None = None) -> dict[str, Any] | None:
    """Get the preferred model for a purpose from the registry.

    Args:
        purpose: Model purpose (stt, tts, embeddings, etc.)
        runtime: Optional runtime filter (mlx, gguf, pytorch, api)

    Returns:
        Full model dict from registry, or None if not found.
    """
    try:
        from infra.models.discover import get_by_purpose
        models = get_by_purpose(purpose)
        if runtime:
            models = [m for m in models if m.get("runtime") == runtime]
        return models[0] if models else None
    except Exception:
        logger.debug("Failed to resolve model for %s", purpose, exc_info=True)
        return None


def resolve_repo(purpose: str, runtime: str | None = None) -> str:
    """Get the HuggingFace repo ID for the preferred model.

    Returns the repo string (e.g. "mlx-community/whisper-large-v3-turbo")
    or falls back to a hardcoded default.
    """
    model = resolve_model(purpose, runtime)
    if model:
        return model.get("repo") or model.get("path") or _FALLBACKS.get(purpose, "")
    return _FALLBACKS.get(purpose, "")


def resolve_path(purpose: str) -> str:
    """Get the file path for a GGUF or local model."""
    model = resolve_model(purpose)
    if model:
        return model.get("path") or model.get("repo") or _FALLBACKS.get(purpose, "")
    return _FALLBACKS.get(purpose, "")


# ── Convenience resolvers ──

def resolve_stt(variant: str = "preferred") -> str:
    """Resolve STT model repo.

    variant: "preferred" (best available), "fast" (smallest/fastest), "parakeet"
    """
    if variant == "fast":
        model = resolve_model("stt", runtime="mlx")
        # Find smallest MLX model
        try:
            from infra.models.discover import get_by_purpose
            models = get_by_purpose("stt")
            mlx_models = [m for m in models if m.get("runtime") == "mlx" and m.get("size_gb", 99) < 1]
            if mlx_models:
                return mlx_models[0].get("repo", _FALLBACKS["stt-fast"])
        except Exception:
            pass
        return _FALLBACKS["stt-fast"]

    if variant == "parakeet":
        model = resolve_model("stt", runtime="mlx")
        try:
            from infra.models.discover import get_by_purpose
            models = get_by_purpose("stt")
            parakeet = [m for m in models if "parakeet" in m.get("id", "").lower()]
            if parakeet:
                return parakeet[0].get("repo", _FALLBACKS["stt-parakeet"])
        except Exception:
            pass
        return _FALLBACKS["stt-parakeet"]

    # Default: preferred STT
    return resolve_repo("stt", runtime="mlx")


def resolve_tts() -> str:
    """Resolve TTS model repo."""
    return resolve_repo("tts", runtime="mlx")


def resolve_embeddings() -> str:
    """Resolve embeddings model path."""
    return resolve_path("embeddings")


def resolve_reranker() -> str:
    """Resolve reranker model path."""
    return resolve_path("reranking")


def resolve_expansion() -> str:
    """Resolve query expansion model path."""
    return resolve_path("expansion")
