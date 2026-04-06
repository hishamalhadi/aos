# Qareen Companion v2 — Complete Vision

**Status**: Design approved, ready for implementation planning
**Date**: 2026-04-06

---

## Core Identity

The qareen is your **external brain**. Always on, thinks with you when you talk, works for you when you don't. One entity, one memory, one personality — regardless of which surface you interact with (Companion, Quick Assist, Chat).

---

## Voice Model: Adaptive

The qareen auto-detects the interaction mode from your speech pattern:

| You're doing... | Qareen does... |
|---|---|
| Rambling (long continuous speech) | Ambient: listens, processes background, occasional "noted" |
| Asking a direct question | Immediate answer, spoken back within a second |
| Giving a command | Confirms and executes. "Done." |
| Pausing after a point | Speaks: summarizes, clarifies, shares findings |
| In a meeting (multiple speakers) | Listens to all, whispers to you via screen only |
| Wanting a conversation ("let's think through...") | Turn-based dialogue, deeper reasoning |

**Override signals:**
- "Qareen" / "Q" — forces direct attention for a command/question
- Double-tap mic — toggle between "just listen" and "talk to me"
- "Think about this" — signals deeper conversation mode

---

## Input: Voice + Text, Seamlessly

The session is input-agnostic. Voice and text are two channels to the same session.

- Start talking → mute and type something precise (URL, email, number) → unmute and keep talking
- Session continues unbroken. Thread tracker doesn't reset.
- Voice for rambling, text for precision. Use whichever fits the moment.

---

## While You Talk: 7 Parallel Processors

All run simultaneously. High intake, HIGH FILTER, low output.

| Processor | Always runs | Surfaces when... |
|---|---|---|
| **Transcribe** | Yes | Always (live transcript) |
| **Thread** | Yes | New thread detected, thread switch |
| **Extract entities** | Yes | First mention, connection to existing work |
| **Classify** (idea/task/decision/question) | Yes | Confidence above threshold |
| **Act** (create task, log decision) | Yes | Classification confidence is high |
| **Research** (vault, web, QMD) | When triggered | Question asked, unknown topic, vault connection |
| **Spawn agents** | When warranted | Explicit request or accumulated context clearly warrants it |

**Intelligence principle:** Process everything, only surface what genuinely matters. Confidence thresholds on every action.

**Learning loop:** Approvals lower thresholds for similar patterns. Dismissals raise them. Persistent across sessions.

---

## Screen Layout: Modes

Three modes (user preference, switchable mid-session):

- **Focus** — Canvas + tray. Minimal. Threads grow quietly. Best for deep rambles.
- **Split** — Transcript left, workspace right. More info visible.
- **Full control** — Tabs in workspace: threads, research, sheets, agents.

Default: Focus. The screen follows your attention, not the other way around.

### Canvas Phases:
1. **Idle** — Orb, greeting, suggestion pills
2. **Listening** — Threads appear and grow. Clean, minimal.
3. **Qareen speaking** — Active thread highlights slightly
4. **Research arrived** — Quiet indicator on relevant thread
5. **Post-session** — Summary view, cards for approval

### Tray (always visible, bottom):
- Pending cards count
- Active agents count  
- Session timer
- Tap to expand any

---

## Meeting Mode

Two views:
- **Your view** — Full intelligence: cards, research, whispers, action suggestions. Private.
- **Shared view** — Clean shareable URL. Live agenda, decisions, action items. No intelligence visible. Everyone can follow along.

Behavior:
- Speaker diarization (who said what)
- Action items attributed to speakers
- Qareen stays silent unless asked to address the room
- Post-meeting: summary shared with all participants

---

## Sessions: Pausable + Resumable

- **Pause** — "I'm done for now." Compile + review. Approve some cards, leave others. Full state saved.
- **Resume** — "Pick up where we left off." All threads reload, pending cards intact, context preserved.
- **End** — Final resolution. Everything persists. Session archived.
- **Multiple paused sessions** — Tray shows active/paused. Switch between them.

---

## Post-Session Resolution

```
COMPILE   → Threads get final summaries, cards finalized
REVIEW    → "Here's what we covered" — approve batch or one-by-one
EXECUTE   → Tasks → work system, decisions → vault, automations → deploy
PERSIST   → Session summary → context store, learning loop updates
```

---

## Connection Model: Qareen Context Store

Companion writes to the context store. Every other surface reads from it.

```
Context Store:
├─ Session state (current/paused sessions, summaries)
├─ Active focus (topics, from Companion conversations)
├─ Recent decisions (logged from sessions)
├─ Recent actions (from Quick Assist + Companion)
├─ Entity mentions (people, projects, from recent sessions)
├─ Automation inventory (what exists, what ran recently)
└─ Learning state (approval/dismissal patterns)
```

When you navigate to /work: Quick Assist knows your focus.
When you navigate to /people: People you discussed are surfaced.
When you come back to Companion: It remembers yesterday.

---

## Voice I/O Stack

**Input:** Mic → WebSocket → VAD → STT (Parakeet MLX, ~200ms)
- Continuous in ambient/ramble mode
- Speaker diarization in meeting mode

**Output:** Model text → ElevenLabs Streaming TTS → Web Audio
- ~400ms to first spoken word
- Barge-in: user starts talking → TTS stops immediately
- Speaking strategy: mostly silent during rambles, interjects only when valuable

---

## Agent Orchestration During Sessions

Companion can spawn background agents mid-session:
- Research agent (searches vault/web, compiles findings)
- Work agent (creates projects, links tasks)
- Sheet agent (creates/updates Google Sheets)
- Automation agent (drafts n8n workflows)

Multiple agents run simultaneously. Results feed back to voice model context and appear in workspace.

---

## Automation Integration

The qareen can:
- **Trigger** existing automations ("run the weekly report")
- **Create** new automations from conversation ("every Monday brief me")
- **Suggest** automations when it detects repeated patterns
- **Monitor** automation results and surface them in sessions
