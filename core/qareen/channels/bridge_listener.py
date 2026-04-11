"""Bridge SSE Listener — captures inbound messages from the bridge service.

The bridge (port 4098) exposes an SSE stream with live conversation events.
This listener connects to that stream and ingests user_message events into
comms.db, then emits message.received events on the Qareen EventBus.

Runs as a background task started during Qareen lifespan. Reconnects
automatically on disconnect with exponential backoff.

Uses httpx (already a Qareen dependency) for HTTP.
"""

from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

import httpx

if TYPE_CHECKING:
    from qareen.events.bus import EventBus

logger = logging.getLogger(__name__)

BRIDGE_URL = "http://127.0.0.1:4098"
COMMS_DB = Path.home() / ".aos" / "data" / "comms.db"

# Track seen message timestamps to avoid duplicates across reconnects
_seen_ts: set[float] = set()
_MAX_SEEN = 500


def _store_message(msg: dict[str, Any]) -> str | None:
    """Store an inbound message in comms.db. Returns message ID or None."""
    try:
        msg_id = str(uuid.uuid4())
        source = msg.get("source", "telegram")
        text = msg.get("text", "")
        ts = msg.get("ts", 0)

        if not text:
            return None

        timestamp = (
            datetime.fromtimestamp(ts).isoformat() if ts else datetime.now().isoformat()
        )

        conn = sqlite3.connect(str(COMMS_DB), timeout=3)
        conn.execute("PRAGMA journal_mode=WAL")

        conn.execute(
            """INSERT OR IGNORE INTO messages
               (id, channel, direction, sender_id, content, timestamp, processed)
               VALUES (?, ?, ?, ?, ?, ?, 0)""",
            (msg_id, source, "inbound", "bridge", text, timestamp),
        )
        conn.commit()
        conn.close()

        return msg_id
    except Exception as e:
        logger.debug("Failed to store bridge message: %s", e)
        return None


async def _listen_bridge_sse(bus: EventBus) -> None:
    """Connect to bridge SSE and process events. Runs until cancelled."""
    backoff = 1

    while True:
        try:
            async with httpx.AsyncClient(timeout=None) as client:
                logger.info("Connecting to bridge SSE at %s/stream", BRIDGE_URL)

                async with client.stream("GET", f"{BRIDGE_URL}/stream") as resp:
                    if resp.status_code != 200:
                        logger.warning("Bridge SSE returned %d", resp.status_code)
                        await asyncio.sleep(backoff)
                        backoff = min(backoff * 2, 60)
                        continue

                    backoff = 1  # Reset on successful connect
                    logger.info("Connected to bridge SSE stream")

                    buffer = ""
                    async for chunk in resp.aiter_text():
                        buffer += chunk

                        # Process complete SSE messages (delimited by \n\n)
                        while "\n\n" in buffer:
                            raw_msg, buffer = buffer.split("\n\n", 1)
                            for line in raw_msg.strip().split("\n"):
                                if line.startswith("data: "):
                                    data_str = line[6:]
                                    try:
                                        data = json.loads(data_str)
                                        await _handle_bridge_event(data, bus)
                                    except json.JSONDecodeError:
                                        pass

        except asyncio.CancelledError:
            logger.info("Bridge listener cancelled")
            return
        except httpx.HTTPError as e:
            logger.debug("Bridge SSE connection error: %s", e)
        except Exception as e:
            logger.debug("Bridge listener error: %s", e)

        # Reconnect with backoff
        logger.info("Bridge SSE reconnecting in %ds", backoff)
        await asyncio.sleep(backoff)
        backoff = min(backoff * 2, 60)


async def _handle_bridge_event(data: dict[str, Any], bus: EventBus) -> None:
    """Process a single event from the bridge SSE stream.

    Three responsibilities:
      1. Capture user_message events into comms.db + EventBus (legacy)
      2. Rebroadcast ALL events as `chat.<type>` on the companion SSE stream
         (Phase 1 — unified frontend SSE)
      3. Persist conversational events (user_message, result) to the
         current Conversation in ConversationStore (Phase 2 — unified
         storage)
    """
    event_type = data.get("type", "")

    # ── Rebroadcast to companion SSE as chat.* ────────────────────────────
    # Every bridge event is forwarded with a `chat.` prefix so the frontend
    # can distinguish chat events from companion events on the same stream.
    if event_type:
        try:
            from qareen.api.companion import _push_companion_event

            await _push_companion_event(f"chat.{event_type}", data)
        except Exception:
            logger.debug("Failed to rebroadcast chat event", exc_info=True)

    # ── Persist conversational turns to the current Conversation ─────────
    # We store user messages + final assistant results (the complete turn).
    # text_delta / tool_start / tool_result are transient and don't need
    # persistence — the final `result` event carries the full assistant text.
    if event_type in ("user_message", "result", "tool_start"):
        try:
            _persist_chat_event(data, event_type)
        except Exception:
            logger.debug("Failed to persist chat event", exc_info=True)

    # ── Legacy: capture user_message for inbound Telegram pipeline ────────
    if event_type != "user_message":
        return

    # WhatsApp is handled by the canonical whatsapp_desktop watcher which
    # reads ChatStorage.sqlite directly. Skip WA events forwarded by the
    # whatsmeow bridge to avoid double-inserting the same message with
    # different (UUID vs wa_<Z_PK>) IDs.
    if data.get("source") == "whatsapp":
        return

    ts = data.get("ts", 0)

    # Deduplicate
    if ts in _seen_ts:
        return
    _seen_ts.add(ts)
    if len(_seen_ts) > _MAX_SEEN:
        # Trim oldest entries (approximate -- sets are unordered, but
        # this prevents unbounded growth)
        to_remove = list(_seen_ts)[: _MAX_SEEN // 2]
        for t in to_remove:
            _seen_ts.discard(t)

    text = data.get("text", "")
    source = data.get("source", "telegram")

    if not text:
        return

    logger.info("Bridge inbound [%s]: %s", source, text[:60])

    # Store in comms.db
    msg_id = _store_message(data)

    # Emit on the EventBus so pipelines and intelligence engine can react
    if bus and msg_id:
        from qareen.events.types import Event

        await bus.emit(Event(
            event_type="message.received",
            source=f"bridge:{source}",
            payload={
                "message_id": msg_id,
                "channel": source,
                "text": text,
                "sender": "bridge",
                "timestamp": (
                    datetime.fromtimestamp(ts).isoformat()
                    if ts
                    else datetime.now().isoformat()
                ),
            },
        ))


def _persist_chat_event(data: dict[str, Any], event_type: str) -> None:
    """Persist a bridge chat event to the current Conversation.

    Appends to the ConversationStore's "current" conversation, creating
    one on demand if none exists. This is the Phase 2 bridge from
    Bridge's ring buffer → durable per-conversation storage.
    """
    from qareen.api.conversations import get_store

    store = get_store()
    convo = store.get_or_create_current()

    text = (data.get("text") or "").strip()
    if not text and event_type != "tool_start":
        return

    ts = data.get("ts")
    source = data.get("source", "centcom")

    if event_type == "user_message":
        store.append_message(
            convo.id,
            role="user",
            text=text,
            speaker="You",
            source=source,
            ts=ts,
        )
    elif event_type == "result":
        if data.get("is_error"):
            return
        store.append_message(
            convo.id,
            role="assistant",
            text=text,
            speaker="Claude",
            source=source,
            ts=ts,
            duration_ms=data.get("duration_ms"),
            cost_usd=data.get("cost_usd"),
        )
    elif event_type == "tool_start":
        name = data.get("name") or "tool"
        preview = data.get("preview") or f"Using {name}..."
        store.append_message(
            convo.id,
            role="tool",
            text=preview,
            source=source,
            ts=ts,
            tool_name=name,
            tool_preview=preview,
        )


async def start_bridge_listener(bus: EventBus) -> asyncio.Task | None:
    """Start the bridge listener as a background task.

    Returns the task handle so it can be cancelled on shutdown.
    """
    # Seed with recent history so we don't re-process old messages
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(5.0)) as client:
            resp = await client.get(f"{BRIDGE_URL}/history")
            if resp.status_code == 200:
                history = resp.json()
                for evt in history:
                    ts = evt.get("ts", 0)
                    if ts:
                        _seen_ts.add(ts)
                logger.info("Bridge history seeded: %d events", len(history))
    except Exception:
        logger.debug("Could not seed bridge history (bridge may not be running)")

    task = asyncio.create_task(_listen_bridge_sse(bus))
    logger.info("Bridge listener started")
    return task
