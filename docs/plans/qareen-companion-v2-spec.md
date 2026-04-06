# Qareen Companion v2 — Technical Spec

**Purpose**: Blueprint for parallel implementation. Each section defines interfaces, data shapes, and integration points precisely enough that an agent can build from it without asking questions.

**Existing code context**: See `qareen-companion-v2-vision.md` for the full vision. This spec turns that vision into buildable components.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      VOICE I/O LAYER                        │
│  IN:  Existing pipeline (Mic → WS → VAD → Parakeet STT)    │
│  OUT: NEW — ElevenLabs Streaming TTS (Component 2)          │
└─────────────────────────────┬───────────────────────────────┘
                              │ transcript events (existing EventBus)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 STREAM PROCESSOR (Component 1)               │
│  Segments transcript into thought-units                     │
│  Tracks conversation threads                                │
│  Emits: thread.update, thread.switch, segment.classified    │
└─────────────────────────────┬───────────────────────────────┘
                              │ classified segments + thread state
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              BACKGROUND PIPELINES (Component 5)              │
│  Entity extraction, task detection, research triggers        │
│  Runs in parallel via EventBus subscriptions                │
│  Emits: entity.resolved, card.draft, research.result        │
└─────────────────────────────┬───────────────────────────────┘
                              │ results
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              CONTEXT STORE (Component 3)                     │
│  Backend: persistent across sessions                        │
│  Frontend: Zustand store, all surfaces read                 │
│  Holds: focus, threads, decisions, entities, learning state │
└─────────────────────────────┬───────────────────────────────┘
                              │ shared state
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
         Companion UI    Quick Assist    Other pages
         (Component 4)   (Component 6)   (read context)
```

**Existing files to modify** (not replace):
- `intelligence/engine.py` — Enhance with stream processor
- `events/bus.py` — No changes needed (supports wildcards already)
- `api/companion.py` — Add context endpoints
- `sse.py` — No changes needed
- `voice/manager.py` — Add TTS output path
- Frontend: `store/companion.ts`, `pages/Companion.tsx`, hooks

---

## Component 1: Stream Processor

**What**: Processes continuous transcript segments into threaded, classified thought-units.

**Where**: New file `core/qareen/intelligence/stream_processor.py`

**Integrates with**: Existing `CompanionIntelligenceEngine` — replaces the current `_should_analyze()` + `_ai_process()` pipeline with a streaming version.

### Data Models

```python
@dataclass
class ThoughtUnit:
    """A semantic chunk of speech, one or more sentences about one topic."""
    id: str                     # UUID
    thread_id: str              # Which thread this belongs to
    text: str                   # The actual words
    speaker: str                # "You" or speaker name
    timestamp: str              # ISO8601
    classification: str         # idea|task|decision|question|plan|context|emotion
    confidence: float           # 0.0-1.0 for the classification
    entities: list[str]         # Extracted entity names (raw, pre-resolution)

@dataclass
class Thread:
    """A topic thread tracked across a conversation."""
    id: str                     # UUID
    title: str                  # Auto-generated, updated as thread evolves
    summary: str                # Rolling 2-3 sentence summary
    units: list[str]            # ThoughtUnit IDs in order
    first_seen: str             # ISO8601
    last_seen: str              # ISO8601
    is_active: bool             # Currently being spoken about

@dataclass  
class StreamState:
    """Full state of the stream processor for a session."""
    session_id: str
    threads: dict[str, Thread]  # thread_id -> Thread
    active_thread_id: str | None
    units: list[ThoughtUnit]    # All units in order
    segment_buffer: list[str]   # Accumulates STT segments before chunking
```

### Processing Flow

```python
class StreamProcessor:
    """Processes transcript segments into threaded, classified thought-units."""
    
    def __init__(self, bus: EventBus, session_id: str):
        self._bus = bus
        self._state = StreamState(session_id=session_id, ...)
        self._segment_buffer: list[str] = []
        self._buffer_word_count: int = 0
        
    async def ingest_segment(self, text: str, speaker: str, timestamp: str):
        """Called on every final (non-provisional) transcript segment."""
        self._segment_buffer.append(text)
        self._buffer_word_count += len(text.split())
        
        # Chunk when we have enough content (15+ words or sentence boundary)
        if self._buffer_word_count >= 15 or self._ends_with_boundary(text):
            await self._process_buffer(speaker, timestamp)
    
    async def _process_buffer(self, speaker: str, timestamp: str):
        """Classify the buffered text and assign to a thread."""
        combined = " ".join(self._segment_buffer)
        self._segment_buffer = []
        self._buffer_word_count = 0
        
        # Single Haiku call: classify + thread + extract entities
        result = await self._classify(combined, speaker)
        
        unit = ThoughtUnit(
            id=uuid4().hex[:12],
            thread_id=result["thread_id"],
            text=combined,
            speaker=speaker,
            timestamp=timestamp,
            classification=result["classification"],
            confidence=result["confidence"],
            entities=result["entities"],
        )
        
        self._state.units.append(unit)
        self._update_thread(unit, result)
        
        # Emit events
        await self._bus.emit(Event(
            event_type="stream.unit",
            payload=asdict(unit),
            source="stream_processor",
        ))
        
        if result.get("thread_switched"):
            await self._bus.emit(Event(
                event_type="stream.thread_switch",
                payload={"from": result["prev_thread"], "to": unit.thread_id},
                source="stream_processor",
            ))
    
    async def _classify(self, text: str, speaker: str) -> dict:
        """Single Haiku call for classification + threading + entity extraction.
        
        Returns:
            {
                "thread_id": str,       # existing or new
                "thread_title": str,    # for new threads
                "classification": str,  # idea|task|decision|question|plan|context|emotion
                "confidence": float,
                "entities": ["Ahmad", "API Migration"],
                "thread_switched": bool,
                "prev_thread": str | None,
            }
        """
        # Build compact prompt with thread summaries as context
        thread_ctx = {t.id: t.title for t in self._state.threads.values()}
        prompt = CLASSIFY_PROMPT.format(
            threads=json.dumps(thread_ctx),
            active_thread=self._state.active_thread_id,
            text=text,
            speaker=speaker,
        )
        # claude --print --model haiku (same pattern as assist.py)
        ...
    
    def get_thread_summaries(self) -> dict[str, str]:
        """Returns {thread_id: summary} for voice model context."""
        return {tid: t.summary for tid, t in self._state.threads.items()}
    
    def get_state(self) -> StreamState:
        """Full state for persistence."""
        return self._state

    async def flush(self):
        """Process any remaining buffer (called on session end)."""
        if self._segment_buffer:
            await self._process_buffer("You", datetime.now().isoformat())
```

### Prompt Template (CLASSIFY_PROMPT)

```
Classify this speech segment. Return JSON only.

Active threads: {threads}
Current thread: {active_thread}
Speaker: {speaker}

Text: "{text}"

Return: {"thread_id":"existing-id or NEW","thread_title":"if new",
"classification":"idea|task|decision|question|plan|context|emotion",
"confidence":0.0-1.0,"entities":["names"]}

Rules:
- Reuse an existing thread if the topic matches.
- Create a NEW thread only if this is clearly a different topic.
- "context" = background information, not actionable.
- "task" = something someone needs to DO. High bar.
- "decision" = a conclusion or choice being made.
- Only extract entity names that are specific (people, projects, tools).
```

### Events Emitted

| Event | Payload | When |
|-------|---------|------|
| `stream.unit` | `ThoughtUnit` (full) | Every thought-unit classified |
| `stream.thread_switch` | `{from, to}` | Speaker changed topics |
| `stream.thread_new` | `{thread_id, title}` | New thread detected |
| `stream.thread_update` | `{thread_id, summary}` | Thread summary updated |

### Integration with Existing Code

The `StreamProcessor` replaces the current logic in `CompanionIntelligenceEngine._ai_process()`. Instead of accumulating 3+ blocks and doing a big Claude Sonnet call, it processes incrementally with Haiku.

The existing intelligence engine's `process_input()` method should:
1. Forward the transcript to `StreamProcessor.ingest_segment()`
2. The stream processor emits `stream.unit` events
3. Background pipelines (Component 5) subscribe to those events

---

## Component 2: ElevenLabs TTS

**What**: Streaming text-to-speech output so the qareen can speak back.

**Where**: 
- Backend: New file `core/qareen/voice/tts.py`
- Frontend: New hook `screen/src/hooks/useQareenVoice.ts`

### Backend: TTS Service

```python
# core/qareen/voice/tts.py

class TTSService:
    """Streaming TTS via ElevenLabs WebSocket API."""
    
    def __init__(self, voice_id: str = None, model_id: str = "eleven_turbo_v2_5"):
        self._voice_id = voice_id  # From keychain or config
        self._model_id = model_id
        self._api_key: str | None = None  # Loaded from keychain
        self._ws: websockets.WebSocketClientProtocol | None = None
    
    async def initialize(self):
        """Load API key from keychain, validate voice exists."""
        self._api_key = await self._get_api_key()
        if not self._voice_id:
            self._voice_id = await self._get_default_voice()
    
    async def speak(self, text: str) -> AsyncIterator[bytes]:
        """Stream TTS audio chunks for a text string.
        
        Yields MP3 audio chunks as they arrive from ElevenLabs.
        First chunk arrives in ~200-300ms.
        """
        url = (
            f"wss://api.elevenlabs.io/v1/text-to-speech/"
            f"{self._voice_id}/stream-input"
            f"?model_id={self._model_id}"
        )
        
        async with websockets.connect(url, extra_headers={
            "xi-api-key": self._api_key
        }) as ws:
            # Send generation config
            await ws.send(json.dumps({
                "text": " ",  # Prime the connection
                "voice_settings": {
                    "stability": 0.5,
                    "similarity_boost": 0.75,
                },
                "generation_config": {
                    "chunk_length_schedule": [120, 160, 250, 290],
                }
            }))
            
            # Send the actual text
            await ws.send(json.dumps({"text": text}))
            
            # Signal end of input
            await ws.send(json.dumps({"text": ""}))
            
            # Yield audio chunks
            async for message in ws:
                data = json.loads(message)
                if data.get("audio"):
                    yield base64.b64decode(data["audio"])
                if data.get("isFinal"):
                    break
    
    async def speak_streaming(self, text_chunks: AsyncIterator[str]) -> AsyncIterator[bytes]:
        """Stream TTS from streaming text input (for model output).
        
        Sends text chunks as they arrive from the model,
        yields audio chunks as they arrive from ElevenLabs.
        Ultra-low latency: model token → TTS → audio in ~300ms.
        """
        ...  # Similar but sends text chunks incrementally
```

### Backend: TTS WebSocket Endpoint

```python
# Add to voice/websocket.py or new file voice/tts_ws.py

@router.websocket("/ws/tts")
async def tts_stream(websocket: WebSocket):
    """Browser connects via WebSocket, sends text, receives audio chunks."""
    await websocket.accept()
    tts = app.state.tts_service
    
    try:
        while True:
            msg = await websocket.receive_json()
            
            if msg["type"] == "speak":
                async for chunk in tts.speak(msg["text"]):
                    await websocket.send_bytes(chunk)
                await websocket.send_json({"type": "done"})
                
            elif msg["type"] == "stop":
                # Barge-in: cancel current speech
                break
    except WebSocketDisconnect:
        pass
```

### Frontend: useQareenVoice Hook

```typescript
// hooks/useQareenVoice.ts

interface QareenVoiceState {
  speaking: boolean
  connect: () => Promise<void>
  speak: (text: string) => Promise<void>
  stop: () => void  // Barge-in
  disconnect: () => void
}

export function useQareenVoice(): QareenVoiceState {
  // WebSocket to /ws/tts
  // Receives MP3 chunks → decodes via AudioContext → plays via Web Audio API
  // Manages AudioBufferSourceNode queue for gapless playback
  // stop() cancels current playback + sends "stop" to WS
  
  // Audio playback chain:
  // MP3 chunk → AudioContext.decodeAudioData() → BufferSource → play
  // Queue chunks, crossfade between them for smooth playback
}
```

### Integration

- TTS service initialized in `main.py` alongside VoiceManager
- API key stored in macOS Keychain: `agent-secret get elevenlabs-api-key`
- Voice ID configurable in `~/.aos/config/operator.yaml` under `qareen.voice_id`
- If no API key, TTS silently disabled (text-only fallback)

---

## Component 3: Qareen Context Store

**What**: Persistent shared state that bridges all qareen surfaces.

**Where**:
- Backend: New file `core/qareen/intelligence/context_store.py` + API in `api/context.py`
- Frontend: New file `screen/src/store/qareenContext.ts`

### Backend Data Model

```python
# intelligence/context_store.py

@dataclass
class QareenContext:
    """Persistent context shared across all qareen surfaces."""
    
    # From Companion sessions
    active_session_id: str | None = None
    paused_session_ids: list[str] = field(default_factory=list)
    focus: str | None = None            # Current work focus (from conversation)
    active_topics: list[str] = field(default_factory=list)  # Max 5
    recent_decisions: list[dict] = field(default_factory=list)  # Max 10
    # Each decision: {"text": str, "thread": str, "timestamp": str, "session_id": str}
    
    # From Quick Assist + all surfaces
    recent_actions: list[dict] = field(default_factory=list)  # Max 20
    # Each action: {"input": str, "action_id": str, "spoken": str, "page": str, "timestamp": str}
    
    # Entity mentions (from recent sessions)
    recent_entities: list[dict] = field(default_factory=list)  # Max 20
    # Each: {"name": str, "type": "person"|"project"|"topic", "last_mentioned": str}
    
    # Navigation
    page_history: list[str] = field(default_factory=list)  # Max 10
    
    # Learning state (approval patterns)
    learning: dict = field(default_factory=dict)
    # {"task_threshold": 0.7, "decision_threshold": 0.8, ...}
    # Adjusted by approval/dismissal patterns
    
    # Metadata
    last_updated: str = ""  # ISO8601


class QareenContextStore:
    """Manages persistent qareen context. SQLite-backed."""
    
    def __init__(self, db_path: str = "~/.aos/qareen_context.db"):
        ...
    
    def get(self) -> QareenContext:
        """Load current context."""
        
    def update(self, **fields) -> QareenContext:
        """Update specific fields. Auto-trims lists to max lengths."""
        
    def add_action(self, action: dict):
        """Append to recent_actions, trim to 20."""
        
    def add_entity(self, entity: dict):
        """Add or update entity in recent_entities."""
        
    def add_decision(self, decision: dict):
        """Append to recent_decisions, trim to 10."""
    
    def set_focus(self, focus: str | None):
        """Update current focus."""
        
    def record_approval(self, classification: str):
        """Lower threshold for this classification type."""
        
    def record_dismissal(self, classification: str):
        """Raise threshold for this classification type."""
    
    def get_threshold(self, classification: str) -> float:
        """Get current confidence threshold for a classification."""
        # Default: 0.7 for tasks, 0.8 for decisions, 0.5 for ideas
```

### Backend API

```python
# api/context.py

router = APIRouter(tags=["context"])

@router.get("/api/context")
async def get_context() -> QareenContext:
    """Returns current qareen context for any surface to read."""

@router.patch("/api/context")
async def update_context(body: ContextUpdate) -> QareenContext:
    """Update specific context fields."""
    
@router.post("/api/context/action")
async def log_action(body: ActionEntry):
    """Log a quick-assist action to context."""
    
@router.post("/api/context/page")
async def log_page(body: PageVisit):
    """Log a page navigation to context."""
```

Register: Add `("qareen.api.context", "context")` to `_api_routers` in `main.py`.

### Frontend Store

```typescript
// store/qareenContext.ts

interface QareenContextState {
  // Mirror of backend context
  focus: string | null
  activeTopics: string[]
  recentDecisions: Decision[]
  recentActions: ActionEntry[]
  recentEntities: Entity[]
  pageHistory: string[]
  activeSessionId: string | null
  
  // Hydration
  loaded: boolean
  hydrate: () => Promise<void>  // GET /api/context
  
  // Writers (also POST to backend)
  setFocus: (focus: string | null) => void
  addAction: (action: ActionEntry) => void
  addPageVisit: (page: string) => void
}

// Auto-hydrate on first access
// Page navigation tracked via useEffect in Layout
// Quick Assist writes actions after execution
// Companion writes focus/topics/decisions during sessions
```

### Integration with Assist Endpoint

The `POST /api/assist` endpoint (Component 6) reads from context store to enrich the model prompt:

```python
# In assist.py, add context injection:
context = context_store.get()
context_lines = []
if context.focus:
    context_lines.append(f"User focus: {context.focus}")
if context.active_topics:
    context_lines.append(f"Topics: {', '.join(context.active_topics[:3])}")
if context.recent_actions:
    last = context.recent_actions[-1]
    context_lines.append(f"Last action: {last['spoken']} on {last['page']}")
```

---

## Component 4: Companion UI v2

**What**: Refactored Companion page supporting canvas/tray layout with thread visualization.

**Where**: Modify existing files in `screen/src/pages/` and `screen/src/components/companion/`

### Screen Layout (Focus Mode — default)

```
┌──────────────────────────────────────────────────────────┐
│  Session: [title]                       ⏺ 12:34  [⏸][⏹] │
├──────────────────────────────────────────────────────────┤
│                                                          │
│                    CANVAS                                │
│                                                          │
│   ▶ API Migration                              ← thread │
│     • Phased rollout approach discussed                  │
│     • Ahmad should review spec by Friday     ← action   │
│     • Decision: three phases                 ← decision │
│     📎 Ahmad (person) · API (project)        ← entities │
│                                                          │
│   ▶ Q3 Hiring                                  ← thread │
│     • Need 2 engineers                                   │
│     • Contractor route for speed             ← idea     │
│                                                          │
│   ▶ Active thread pulses gently                          │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  TRAY                                                    │
│  [3 cards pending ▸] [2 agents ▸] [🎤 Listening]         │
└──────────────────────────────────────────────────────────┘

BOTTOM INPUT (same as current UnifiedInput)
[🎤] [Type or speak...]                            [Send ▸]
```

### New Components

**ThreadCanvas** (`components/companion/ThreadCanvas.tsx`):
```typescript
interface ThreadCanvasProps {
  threads: Thread[]
  activeThreadId: string | null
  onThreadClick?: (threadId: string) => void
}
// Renders threads as collapsible note groups
// Active thread has subtle accent border pulse
// Each unit shows classification icon + entity tags
// Smooth animation when new units arrive (fade + slide)
```

**SessionTray** (`components/companion/SessionTray.tsx`):
```typescript
interface SessionTrayProps {
  pendingCards: number
  activeAgents: number
  sessionDuration: number  // seconds
  voiceState: string
  onExpandCards: () => void
  onExpandAgents: () => void
}
// Compact bar at bottom of canvas
// Tappable sections expand to show details
// Cards: shows approval list (slide-up panel)
// Agents: shows running agents with progress
```

**VoiceStateIndicator** (`components/companion/VoiceStateIndicator.tsx`):
```typescript
interface VoiceStateProps {
  state: 'idle' | 'listening' | 'processing' | 'speaking'
  // Compact pill in tray: icon + label
  // listening: mic icon, red pulse
  // processing: spinner
  // speaking: waveform bars
}
```

### State Changes

Add to `store/companion.ts`:

```typescript
// New state fields
threads: Thread[]
activeThreadId: string | null
screenMode: 'focus' | 'split' | 'full'  // User preference

// Thread types (mirror backend)
interface Thread {
  id: string
  title: string
  summary: string
  units: ThoughtUnit[]
  isActive: boolean
  firstSeen: string
  lastSeen: string
}

interface ThoughtUnit {
  id: string
  threadId: string
  text: string
  speaker: string
  timestamp: string
  classification: 'idea' | 'task' | 'decision' | 'question' | 'plan' | 'context' | 'emotion'
  confidence: number
  entities: string[]
}
```

### New SSE Events to Handle

```typescript
// In useCompanion.ts, add handlers:
'stream.unit'          → addUnitToThread(unit)
'stream.thread_new'    → addThread(thread)
'stream.thread_switch' → setActiveThread(threadId)
'stream.thread_update' → updateThreadSummary(threadId, summary)
'tts.speaking'         → setVoiceState('speaking')
'tts.done'             → setVoiceState('idle')
```

### Migration from Current UI

The current TranscriptPanel + WorkspacePanel layout becomes the "Split" mode. The new "Focus" mode (ThreadCanvas + Tray) is the default. The user can switch mid-session via a toggle in the session header.

---

## Component 5: Background Pipelines

**What**: Parallel processors that subscribe to stream events and produce actionable output.

**Where**: New directory `core/qareen/intelligence/pipelines/`

### Pipeline Architecture

Each pipeline is a class that subscribes to EventBus events and emits results.

```python
# intelligence/pipelines/base.py

class Pipeline:
    """Base class for background processing pipelines."""
    
    def __init__(self, bus: EventBus, context_store: QareenContextStore):
        self._bus = bus
        self._context = context_store
    
    def wire(self):
        """Subscribe to relevant events."""
        raise NotImplementedError
    
    async def process(self, event: Event):
        """Process an event. Override in subclass."""
        raise NotImplementedError
```

### Pipeline: Entity Resolver

```python
# intelligence/pipelines/entity_resolver.py

class EntityResolverPipeline(Pipeline):
    """Resolves entity names from speech to ontology records."""
    
    def wire(self):
        self._bus.subscribe("stream.unit", self.process)
    
    async def process(self, event: Event):
        unit = event.payload
        for name in unit["entities"]:
            # Lookup in People ontology (existing adapter)
            result = await self._resolve(name)
            if result:
                await self._bus.emit(Event(
                    event_type="entity.resolved",
                    payload={
                        "name": name,
                        "type": result["type"],       # person|project
                        "entity_id": result["id"],
                        "metadata": result["metadata"],  # role, org, etc.
                        "unit_id": unit["id"],
                        "thread_id": unit["thread_id"],
                    },
                    source="entity_resolver",
                ))
                self._context.add_entity({
                    "name": name, "type": result["type"],
                    "last_mentioned": unit["timestamp"],
                })
```

### Pipeline: Action Detector

```python
# intelligence/pipelines/action_detector.py

class ActionDetectorPipeline(Pipeline):
    """Creates draft cards for tasks, decisions, ideas above threshold."""
    
    def wire(self):
        self._bus.subscribe("stream.unit", self.process)
    
    async def process(self, event: Event):
        unit = event.payload
        classification = unit["classification"]
        confidence = unit["confidence"]
        threshold = self._context.get_threshold(classification)
        
        if confidence < threshold:
            return  # Below learned threshold, skip
        
        if classification == "task":
            await self._emit_task_card(unit)
        elif classification == "decision":
            await self._emit_decision_card(unit)
        elif classification == "idea" and confidence >= threshold:
            await self._emit_idea_card(unit)
    
    async def _emit_task_card(self, unit: dict):
        card = {
            "id": uuid4().hex[:12],
            "card_type": "task",
            "title": unit["text"][:80],
            "body": unit["text"],
            "confidence": unit["confidence"],
            "thread_id": unit["thread_id"],
            "created_at": unit["timestamp"],
        }
        await self._bus.emit(Event(
            event_type="card",
            payload=card,
            source="action_detector",
        ))
```

### Pipeline: Research Trigger

```python
# intelligence/pipelines/research_trigger.py

class ResearchTriggerPipeline(Pipeline):
    """Triggers vault/web research when questions or unknown topics detected."""
    
    def wire(self):
        self._bus.subscribe("stream.unit", self.process)
    
    async def process(self, event: Event):
        unit = event.payload
        
        if unit["classification"] != "question":
            return
        
        # Search vault via QMD
        vault_results = await self._search_vault(unit["text"])
        
        await self._bus.emit(Event(
            event_type="research.result",
            payload={
                "query": unit["text"],
                "thread_id": unit["thread_id"],
                "unit_id": unit["id"],
                "vault_results": vault_results,
                "source": "vault",
            },
            source="research_trigger",
        ))
```

### Pipeline: Voice Responder

```python
# intelligence/pipelines/voice_responder.py

class VoiceResponderPipeline(Pipeline):
    """Decides when and what the qareen should say. Adaptive voice logic."""
    
    def __init__(self, bus, context_store, tts_service):
        super().__init__(bus, context_store)
        self._tts = tts_service
        self._last_spoke: float = 0
        self._user_speaking: bool = True
        self._pending_responses: list[str] = []
    
    def wire(self):
        self._bus.subscribe("stream.unit", self._on_unit)
        self._bus.subscribe("research.result", self._on_research)
        self._bus.subscribe("voice_state", self._on_voice_state)
    
    async def _on_voice_state(self, event: Event):
        state = event.payload.get("state")
        self._user_speaking = state == "listening"
        
        # User paused — check if we should speak
        if state == "idle" and self._pending_responses:
            await self._speak(self._pending_responses.pop(0))
    
    async def _on_unit(self, event: Event):
        unit = event.payload
        # Direct question → queue immediate response
        if unit["classification"] == "question":
            self._pending_responses.append(
                f"Looking into that..."
            )
    
    async def _on_research(self, event: Event):
        results = event.payload.get("vault_results", [])
        if results:
            self._pending_responses.append(
                f"I found {len(results)} relevant notes in your vault."
            )
    
    async def _speak(self, text: str):
        if not self._tts or self._user_speaking:
            return
        self._last_spoke = time.time()
        await self._bus.emit(Event(
            event_type="tts.speak",
            payload={"text": text},
            source="voice_responder",
        ))
```

### Wiring (in main.py)

```python
# After existing wiring:
from qareen.intelligence.stream_processor import StreamProcessor
from qareen.intelligence.pipelines import (
    EntityResolverPipeline,
    ActionDetectorPipeline, 
    ResearchTriggerPipeline,
    VoiceResponderPipeline,
)

stream_processor = StreamProcessor(bus, session_id=None)  # Set per session
entity_pipeline = EntityResolverPipeline(bus, context_store)
action_pipeline = ActionDetectorPipeline(bus, context_store)
research_pipeline = ResearchTriggerPipeline(bus, context_store)
voice_pipeline = VoiceResponderPipeline(bus, context_store, tts_service)

entity_pipeline.wire()
action_pipeline.wire()
research_pipeline.wire()
voice_pipeline.wire()
```

---

## Component 6: Unified Assist v2

**What**: Enhanced assist endpoint with context awareness and automation capabilities.

**Where**: Modify existing `core/qareen/api/assist.py`

### Enhanced Request

```python
class AssistRequestV2(BaseModel):
    input: str
    page: str
    page_detail: str | None = None
    actions: list[ActionSpec]
    # NEW: context injected by frontend from context store
    context: ContextSummary | None = None

class ContextSummary(BaseModel):
    focus: str | None = None
    active_topics: list[str] = []
    recent_actions: list[str] = []  # Last 3, as strings
    session_active: bool = False
```

### Enhanced Response

```python
class AssistResponseV2(BaseModel):
    mode: str  # "immediate" | "automation.run" | "escalate" | "query"
    action_id: str | None = None
    params: dict = {}
    spoken: str = ""
    confidence: float = 0.0
    # NEW for automation mode:
    automation_id: str | None = None
    # NEW for escalate mode:
    escalate_reason: str | None = None
```

### Enhanced System Prompt

Add to the existing prompt:
```
Context about the user:
{context_lines}

Available automations:
{automation_list}

Response modes:
- "immediate": execute a page action
- "automation.run": trigger an automation by ID
- "escalate": this needs deeper conversation
- "query": answer a question (put answer in "spoken")
```

### Automation Awareness

Fetch active automations and inject into the prompt:

```python
# In the endpoint handler:
try:
    automations = await api.get("/automations/active")  
    auto_specs = [{"id": a["id"], "name": a["name"]} for a in automations[:10]]
except:
    auto_specs = []
```

---

## Event Reference (All New Events)

| Event Type | Source | Payload | Consumed By |
|---|---|---|---|
| `stream.unit` | StreamProcessor | `ThoughtUnit` | All pipelines, Frontend |
| `stream.thread_new` | StreamProcessor | `{thread_id, title}` | Frontend |
| `stream.thread_switch` | StreamProcessor | `{from, to}` | Frontend, VoiceResponder |
| `stream.thread_update` | StreamProcessor | `{thread_id, summary}` | Frontend |
| `entity.resolved` | EntityResolver | `{name, type, entity_id, metadata}` | Frontend, ContextStore |
| `research.result` | ResearchTrigger | `{query, results, source}` | Frontend, VoiceResponder |
| `tts.speak` | VoiceResponder | `{text}` | TTS WebSocket handler |
| `tts.speaking` | TTS handler | `{}` | Frontend (voice state) |
| `tts.done` | TTS handler | `{}` | Frontend (voice state) |

All existing events (`transcript`, `voice_state`, `card`, `card_status`, `note_group`, etc.) continue unchanged.

---

## Implementation Order

Build in this order. Each component is independently testable.

1. **Context Store** (Component 3) — Foundation. Backend + frontend + API. Test: store and retrieve context, verify Quick Assist reads it.

2. **Stream Processor** (Component 1) — The spine. Wire into existing intelligence engine. Test: send transcript segments, verify threads + classifications emitted.

3. **Background Pipelines** (Component 5) — Plug into stream events. Test: verify entity resolution, card drafting, research triggers work from stream events.

4. **ElevenLabs TTS** (Component 2) — Voice output. Test: send text, verify audio plays in browser.

5. **Companion UI v2** (Component 4) — Thread visualization. Test: verify threads render from SSE events, canvas/tray layout works.

6. **Unified Assist v2** (Component 6) — Context-aware commands. Test: verify context enriches assist responses, automation triggering works.

---

## Files Created (New)

| File | Component |
|---|---|
| `core/qareen/intelligence/stream_processor.py` | 1 |
| `core/qareen/voice/tts.py` | 2 |
| `core/qareen/intelligence/context_store.py` | 3 |
| `core/qareen/api/context.py` | 3 |
| `core/qareen/intelligence/pipelines/__init__.py` | 5 |
| `core/qareen/intelligence/pipelines/base.py` | 5 |
| `core/qareen/intelligence/pipelines/entity_resolver.py` | 5 |
| `core/qareen/intelligence/pipelines/action_detector.py` | 5 |
| `core/qareen/intelligence/pipelines/research_trigger.py` | 5 |
| `core/qareen/intelligence/pipelines/voice_responder.py` | 5 |
| `screen/src/hooks/useQareenVoice.ts` | 2 |
| `screen/src/store/qareenContext.ts` | 3 |
| `screen/src/components/companion/ThreadCanvas.tsx` | 4 |
| `screen/src/components/companion/SessionTray.tsx` | 4 |

## Files Modified

| File | Changes | Component |
|---|---|---|
| `intelligence/engine.py` | Wire StreamProcessor into process_input() | 1 |
| `voice/websocket.py` | Add /ws/tts endpoint | 2 |
| `api/companion.py` | Emit stream events to SSE, wire context | 1,3 |
| `api/assist.py` | Add context injection, automation awareness, response modes | 6 |
| `main.py` | Initialize all new services, wire pipelines | All |
| `store/companion.ts` | Add thread state, screen mode | 4 |
| `hooks/useCompanion.ts` | Handle new SSE events | 4 |
| `pages/Companion.tsx` | Support Focus/Split/Full modes | 4 |
| `hooks/useAssist.ts` | Send context with assist requests | 6 |
