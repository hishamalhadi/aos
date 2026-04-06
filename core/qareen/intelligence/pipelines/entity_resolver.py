"""Entity Resolver Pipeline — resolve entity names from thought-units.

Subscribes to stream.unit events. For each entity name in the unit's
entities list, attempts to resolve against the People ontology. Falls
back gracefully when the ontology is unavailable.

Emits: entity.resolved
Writes: context_store.add_entity()
"""

from __future__ import annotations

import logging
from datetime import datetime

from ...events.types import Event
from .base import Pipeline

logger = logging.getLogger(__name__)


class EntityResolverPipeline(Pipeline):
    """Resolve entity names mentioned in thought-units."""

    def __init__(self, bus, context_store=None, people_adapter=None):
        super().__init__(bus, context_store)
        self._people = people_adapter

    def wire(self) -> None:
        self._bus.subscribe("stream.unit", self._on_unit)

    async def _on_unit(self, event: Event) -> None:
        try:
            payload = event.payload
            entities = payload.get("entities", [])
            if not entities:
                return

            unit_id = payload.get("id", "")
            thread_id = payload.get("thread_id", "")

            for name in entities:
                if not isinstance(name, str) or not name.strip():
                    continue
                await self._resolve_one(name.strip(), unit_id, thread_id)
        except Exception:
            logger.exception("EntityResolver: failed processing stream.unit")

    async def _resolve_one(
        self, name: str, unit_id: str, thread_id: str
    ) -> None:
        entity_type = "unknown"
        entity_id = None
        metadata: dict = {}

        # Try People ontology lookup
        if self._people is not None:
            try:
                results = self._people.search(name, limit=1)
                if results and results[0].score >= 0.6:
                    hit = results[0]
                    entity_type = "person"
                    entity_id = hit.object_id
                    metadata = {"name": hit.title, "score": hit.score}
            except Exception:
                logger.debug(
                    "EntityResolver: people lookup failed for %r", name
                )

        # Write to context store
        if self._context is not None:
            try:
                self._context.add_entity({
                    "name": name,
                    "type": entity_type,
                    "entity_id": entity_id,
                })
            except Exception:
                logger.debug(
                    "EntityResolver: context store write failed for %r", name
                )

        # Emit resolved event
        await self._bus.emit(Event(
            event_type="entity.resolved",
            timestamp=datetime.now(),
            source="entity_resolver",
            payload={
                "name": name,
                "type": entity_type,
                "entity_id": entity_id,
                "metadata": metadata,
                "unit_id": unit_id,
                "thread_id": thread_id,
            },
        ))
