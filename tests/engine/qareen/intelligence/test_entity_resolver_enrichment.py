"""Tests for Phase 5 People-Intelligence enrichment in the Qareen
EntityResolverPipeline.

When a name resolves to a person_id at ≥0.6 confidence, the pipeline
must also fetch a classification + profile summary and attach the four
enrichment fields (tier, context_tags, days_since_last, channels_active)
to the entity record written to the context store.

All intel calls are wrapped in try/except — a failure must never break
the companion chat path. The per-instance cache must avoid repeated
intel lookups for the same person within a session.
"""

from __future__ import annotations

import asyncio
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from core.qareen.events.types import Event
from core.qareen.intelligence import pipelines as pipelines_pkg  # noqa: F401
from core.qareen.intelligence.pipelines import entity_resolver as er_module
from core.qareen.intelligence.pipelines.entity_resolver import (
    EntityResolverPipeline,
)


# ── Helpers ──────────────────────────────────────────────────────────

class _FakeTier:
    """Stand-in for intel.taxonomy.Tier with a ``.value`` attribute."""

    def __init__(self, value: str) -> None:
        self.value = value


def _make_classification(
    tier: str = "active",
    tags: list[dict] | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        person_id="p-123",
        tier=_FakeTier(tier),
        context_tags=tags if tags is not None else [
            {"tag": "family_nuclear", "confidence": 0.9},
            {"tag": "colleague", "confidence": 0.7},
        ],
    )


def _make_profile(
    days: int | None = 5,
    channels: list[str] | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        days_since_last=days,
        channels_active=channels if channels is not None else [
            "imessage",
            "whatsapp",
        ],
    )


def _make_people_hit(
    object_id: str = "p-123",
    title: str = "Jane Doe",
    score: float = 0.85,
) -> SimpleNamespace:
    return SimpleNamespace(object_id=object_id, title=title, score=score)


def _make_event(name: str = "Jane") -> Event:
    return Event(
        event_type="stream.unit",
        timestamp=datetime.now(),
        source="test",
        payload={"id": "u1", "thread_id": "t1", "entities": [name]},
    )


# ── Fixtures ─────────────────────────────────────────────────────────

@pytest.fixture
def mock_bus() -> MagicMock:
    bus = MagicMock()
    bus.subscribe = MagicMock()
    bus.emit = AsyncMock()
    return bus


@pytest.fixture
def mock_context_store() -> MagicMock:
    return MagicMock()


@pytest.fixture
def mock_people_adapter() -> MagicMock:
    adapter = MagicMock()
    adapter.search = MagicMock(return_value=[_make_people_hit()])
    return adapter


@pytest.fixture
def pipeline(mock_bus, mock_context_store, mock_people_adapter):
    return EntityResolverPipeline(
        bus=mock_bus,
        context_store=mock_context_store,
        people_adapter=mock_people_adapter,
    )


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


# ── Tests ────────────────────────────────────────────────────────────

def test_enrichment_attaches_tier_tags_and_profile_fields(pipeline, mock_context_store):
    """Happy path — resolved person record contains all 4 enrichment fields."""
    runner = MagicMock()
    runner.get_classification.return_value = _make_classification()
    builder = MagicMock()
    builder.build.return_value = _make_profile()

    with patch.object(er_module, "_intel_available", True), \
         patch.object(er_module, "ClassifierRunner", return_value=runner), \
         patch.object(er_module, "ProfileBuilder", return_value=builder):
        _run(pipeline._on_unit(_make_event()))

    mock_context_store.add_entity.assert_called_once()
    record = mock_context_store.add_entity.call_args[0][0]

    assert record["type"] == "person"
    assert record["entity_id"] == "p-123"
    assert record["tier"] == "active"
    assert record["context_tags"] == ["family_nuclear", "colleague"]
    assert record["days_since_last"] == 5
    assert record["channels_active"] == ["imessage", "whatsapp"]


def test_classifier_runner_raises_is_swallowed(pipeline, mock_context_store):
    """When intel raises, name resolution still succeeds without enrichment."""
    runner = MagicMock()
    runner.get_classification.side_effect = RuntimeError("boom")
    builder = MagicMock()
    builder.build.side_effect = RuntimeError("boom")

    with patch.object(er_module, "_intel_available", True), \
         patch.object(er_module, "ClassifierRunner", return_value=runner), \
         patch.object(er_module, "ProfileBuilder", return_value=builder):
        _run(pipeline._on_unit(_make_event()))

    mock_context_store.add_entity.assert_called_once()
    record = mock_context_store.add_entity.call_args[0][0]

    # Person still resolved — failure to enrich must not block it.
    assert record["type"] == "person"
    assert record["entity_id"] == "p-123"
    # Enrichment keys present but empty/None (partial failure path).
    assert record.get("tier") is None
    assert record.get("context_tags") == []
    assert record.get("days_since_last") is None
    assert record.get("channels_active") == []


def test_profile_builder_returns_none_yields_partial_enrichment(pipeline, mock_context_store):
    """If profile is None but classification exists, tier+tags still flow."""
    runner = MagicMock()
    runner.get_classification.return_value = _make_classification(
        tier="core",
        tags=[{"tag": "family_nuclear", "confidence": 0.95}],
    )
    builder = MagicMock()
    builder.build.return_value = None

    with patch.object(er_module, "_intel_available", True), \
         patch.object(er_module, "ClassifierRunner", return_value=runner), \
         patch.object(er_module, "ProfileBuilder", return_value=builder):
        _run(pipeline._on_unit(_make_event()))

    record = mock_context_store.add_entity.call_args[0][0]
    assert record["tier"] == "core"
    assert record["context_tags"] == ["family_nuclear"]
    assert record["days_since_last"] is None
    assert record["channels_active"] == []


def test_enrichment_cache_hits_intel_once_per_person(pipeline, mock_context_store):
    """Second mention of the same person should not re-query intel."""
    runner = MagicMock()
    runner.get_classification.return_value = _make_classification()
    builder = MagicMock()
    builder.build.return_value = _make_profile()

    with patch.object(er_module, "_intel_available", True), \
         patch.object(er_module, "ClassifierRunner", return_value=runner), \
         patch.object(er_module, "ProfileBuilder", return_value=builder):
        _run(pipeline._on_unit(_make_event("Jane")))
        _run(pipeline._on_unit(_make_event("Jane")))

    # People adapter is called twice (once per event) but intel is
    # called exactly once — the cache must absorb the second hit.
    assert runner.get_classification.call_count == 1
    assert builder.build.call_count == 1
    assert mock_context_store.add_entity.call_count == 2


def test_intel_unavailable_is_graceful(pipeline, mock_context_store):
    """When the intel subsystem cannot be imported, enrichment is skipped."""
    with patch.object(er_module, "_intel_available", False):
        _run(pipeline._on_unit(_make_event()))

    mock_context_store.add_entity.assert_called_once()
    record = mock_context_store.add_entity.call_args[0][0]

    assert record["type"] == "person"
    assert record["entity_id"] == "p-123"
    # None of the Phase 5 fields should be present when intel is down.
    assert "tier" not in record
    assert "context_tags" not in record
    assert "days_since_last" not in record
    assert "channels_active" not in record
