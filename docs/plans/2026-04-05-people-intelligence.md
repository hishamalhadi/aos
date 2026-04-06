# People Intelligence System — Implementation Plan

> **For agentic workers:** REQUIRED: If subagents are available, dispatch a fresh subagent per task with isolated context. Otherwise, use the executing-plans skill to implement this plan sequentially. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a living intelligence layer that continuously builds, classifies, and refines understanding of every person in the operator's life — across all communication channels, photos, calls, email, vault notes, and daily conversations.

**Architecture:** Three-layer system: (1) Signal extractors read every data source on the machine and produce raw per-person signals at zero LLM cost. (2) Profile builder assembles signals into multi-dimensional temporal profiles, then batches them to Claude for relationship classification. (3) Event consumer + companion integration keeps the ontology alive through passive absorption and conversational verification. All writes go through the existing ontology tables (people, relationships, circles, contact_metadata, etc.) — no new schema needed.

**Tech Stack:** Python 3.9+, SQLite, `anthropic` SDK (Claude API for classification), `rapidfuzz` (fuzzy matching), existing AOS system bus (`core.engine.bus`), existing Qareen EventBus, existing people.db schema (migration 028).

**Initiative:** standalone (foundational People Ontology intelligence)

---

## System Design

### Data Sources (read-only, zero LLM cost)

| Source | Location | Signal Type |
|--------|----------|-------------|
| WhatsApp messages | `~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite` | Content, tone, topics, frequency |
| iMessage | `~/Library/Messages/chat.db` | Content, tone, frequency |
| Call history | `~/Library/Application Support/CallHistoryDB/CallHistory.storedata` | Call frequency, duration, direction |
| Apple Mail | `~/Library/Mail/V*/MailData/Envelope Index` | Email frequency, bidirectional patterns |
| Apple Photos | `~/Pictures/Photos Library.photoslibrary/database/Photos.sqlite` | Face co-occurrence, temporal patterns, locations |
| WhatsApp groups | people.db `groups` + `group_members` tables | Circle membership, shared context |
| Apple Contacts | `~/Library/Application Support/AddressBook/Sources/*/AddressBook-v22.abcddb` | Metadata, labels |
| Vault daily logs | `~/vault/log/YYYY-MM-DD.md` | Person mentions in daily notes |
| Session exports | `~/vault/log/sessions/` | Person mentions in Claude sessions |
| Voice transcripts | Qareen voice pipeline output | Person mentions in speech |
| Work system | `~/.aos/data/qareen.db` | People linked to tasks/projects |

### File Structure

```
core/engine/people/
├── __init__.py              (modify — add new exports)
├── normalize.py             (existing — no changes)
├── identity.py              (existing — no changes)
├── hygiene.py               (existing — no changes)
├── graph.py                 (existing — no changes)
├── group_resolve.py         (existing — no changes)
├── org.py                   (existing — no changes)
├── signals.py               (NEW — per-source signal extractors)
├── profile.py               (NEW — multi-dimensional temporal profile builder)
├── digest.py                (NEW — smart message sampler for LLM input)
├── classifier.py            (NEW — LLM batch classifier)
├── intelligence.py          (NEW — orchestrator: full pipeline + incremental)
└── consumer.py              (NEW — system bus event consumer)

core/qareen/
├── companion/
│   └── people_questions.py  (NEW — verification question generator + feedback handler)
├── api/
│   └── people.py            (modify — add /analysis endpoints)
└── ontology/
    └── listeners.py         (modify — wire people intelligence events)
```

### Profile Shape (what the LLM receives)

```
Person: Ahmad Ballan (p_xyz123)
Channels: whatsapp(37 msgs), imessage(80 msgs), phone(10 calls/15min), photos(103)
Channel preference: imessage (55% of messages)
Cross-channel: 4 channels → very high engagement

Communication:
  Total messages: 117 across 2 channels
  Temporal: consistent (active 34 of last 40 months, since Oct 2020)
  Recent trend: stable (avg 12 msgs/month, last 3 months: 11, 14, 10)
  Tone signals: casual ("bro", "hahah"), business ("pitch deck", "grant", "ship")
  Languages: English primary

Calls:
  10 calls, 15 minutes total, avg 1.5 min
  Pattern: short check-ins (not long conversations)
  Direction: mostly inbound (7 in, 3 out)

Photos:
  103 photos together, first: 2020-10, last: 2026-03
  Pattern: consistent (34 months active)
  Locations: [home area, restaurants, events]
  Co-photographed with: [Rafid, Hisham, Ahmed]

Email: 0 messages (not an email communicator)

Groups:
  Shared: "DTG Grant for Social Media", "Nuchay UGC video", "DTG Grant X Bassam Roastery"

Vault mentions:
  Found in 3 daily logs, 1 session export
  Context: "nuchay", "cave sleep", "product"

Message digest (10 representative samples):
  → [2025-06-16] "Super reliable"
  ← [2025-06-16] "Hatbbbbb"
  ← [2026-02-23] "Create a 30-second vertical minimalist 2D motion graphics explainer for Cave Sleep..."
  → [2026-03-13] "Got held up just praying asr at the mosque and coming"
  ...

Existing ontology:
  importance: 2, relationships: none explicit, circles: none
```

### LLM Classification Output

The classifier returns structured JSON per person:

```json
{
  "person_id": "p_xyz123",
  "relationship_type": "close_friend_and_business_partner",
  "categories": ["friend", "business"],
  "closeness": 8,
  "importance_suggestion": 1,
  "circles": [
    {"name": "Nuchay Team", "category": "work", "confidence": 0.95},
    {"name": "Close Friends", "category": "friends", "confidence": 0.90}
  ],
  "family": false,
  "family_role": null,
  "organization": {"name": "Nuchay", "role": "Co-founder"},
  "context": "Co-founder at Nuchay and Cave Sleep. Daily collaborator on business + creative projects. Also a close personal friend — casual tone, mosque references, photo history spanning 5+ years.",
  "confidence": 0.92,
  "questions": []
}
```

When confidence is low, the classifier adds targeted questions:

```json
{
  "person_id": "p_abc456",
  "relationship_type": "unknown_family_or_close",
  "confidence": 0.45,
  "questions": [
    "Talha has 252 photos but zero messages. Is this a child, or someone you see only in person?",
    "Talha's photo pattern is episodic (peaks in Jul 2025, Jan 2025). Does this person visit from elsewhere?"
  ]
}
```

---

## Chunk 1: Signal Extraction

### Task 1: Message Signal Extractor

**Files:**
- Create: `core/engine/people/signals.py`
- Test: `tests/engine/people/test_signals.py`

This module extracts raw signals from each data source. All functions take a person_id and return a typed dict. Every extractor copies external databases to temp files before reading (avoid locking). Every extractor gracefully returns empty results if the database doesn't exist.

- [ ] **Step 1: Write test for WhatsApp message signal extraction**

```python
# tests/engine/people/test_signals.py
import pytest
from unittest.mock import patch, MagicMock
from core.engine.people.signals import extract_message_signals

def test_extract_message_signals_returns_structure():
    """Message signals have required keys even for unknown person."""
    result = extract_message_signals("p_nonexistent")
    assert "whatsapp" in result
    assert "imessage" in result
    for channel in result.values():
        assert "total_messages" in channel
        assert "temporal_buckets" in channel
        assert "first_message_date" in channel
        assert "last_message_date" in channel
        assert "sample_messages" in channel
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Volumes/AOS-X/project/aos && python3 -m pytest tests/engine/people/test_signals.py::test_extract_message_signals_returns_structure -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'core.engine.people.signals'`

- [ ] **Step 3: Implement signals.py — message extraction**

Create `core/engine/people/signals.py` with:

```python
"""Signal extractors for People Intelligence.

Each extractor reads a specific data source and returns structured signals
for a given person. All extractors:
- Copy external databases to temp before reading (avoid locking)
- Return empty/default results if database doesn't exist
- Are pure readers — no writes, no side effects
- Take person_id and return a typed dict
"""
from __future__ import annotations

import json
import re
import shutil
import sqlite3
import tempfile
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

# Apple epoch offset: seconds between 1970-01-01 and 2001-01-01
APPLE_EPOCH = 978307200
IMESSAGE_NS = 1_000_000_000  # iMessage dates are in nanoseconds

DB_PEOPLE = Path.home() / ".aos" / "data" / "people.db"

# Noise words to skip when sampling messages
NOISE_PATTERNS = re.compile(
    r'^(ok|okay|k|yes|no|yeah|yep|nah|lol|haha|😂|👍|❤️|🙏|thanks|ty|np|gn|gm|brb|omw|👋|bet|aight|salam|ws|wa|jzk)$',
    re.IGNORECASE,
)


def _copy_db(path: Path) -> str | None:
    """Copy a database + WAL/SHM to a temp file. Returns temp path or None."""
    if not path.exists():
        return None
    tmp = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
    tmp.close()
    shutil.copy2(str(path), tmp.name)
    for ext in ["-wal", "-shm"]:
        wal = path.parent / (path.name + ext)
        if wal.exists():
            shutil.copy2(str(wal), tmp.name + ext)
    return tmp.name


def _get_person_identifiers(person_id: str) -> dict:
    """Get all identifiers for a person from people.db."""
    if not DB_PEOPLE.exists():
        return {"phones": [], "emails": [], "wa_jids": []}
    conn = sqlite3.connect(str(DB_PEOPLE))
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT type, value, normalized FROM person_identifiers WHERE person_id = ?",
        (person_id,),
    ).fetchall()
    conn.close()

    result = {"phones": [], "emails": [], "wa_jids": []}
    for r in rows:
        t = r["type"]
        val = r["value"] or ""
        norm = r["normalized"] or ""
        if t == "phone":
            digits = re.sub(r"\D", "", norm or val)
            if digits:
                result["phones"].append(digits)
        elif t == "email":
            result["emails"].append(val.lower())
        elif t == "wa_jid":
            result["wa_jids"].append(val)
            # Also extract phone from JID
            if "@s.whatsapp.net" in val:
                digits = val.split("@")[0]
                if digits.isdigit():
                    result["phones"].append(digits)
    return result


def _bucket_by_month(timestamps: list[float]) -> dict[str, int]:
    """Group timestamps into YYYY-MM buckets."""
    buckets: dict[str, int] = defaultdict(int)
    for ts in timestamps:
        if ts and ts > 0:
            try:
                month = datetime.fromtimestamp(ts).strftime("%Y-%m")
                buckets[month] += 1
            except (OSError, ValueError):
                pass
    return dict(sorted(buckets.items()))


def _detect_temporal_pattern(buckets: dict[str, int]) -> str:
    """Classify temporal pattern from monthly buckets.
    
    Returns: consistent, episodic, clustered, growing, fading, one_shot
    """
    if not buckets:
        return "none"
    
    months = sorted(buckets.keys())
    if len(months) == 1:
        return "one_shot"
    
    # Calculate span and density
    first = datetime.strptime(months[0], "%Y-%m")
    last = datetime.strptime(months[-1], "%Y-%m")
    span_months = max(1, (last.year - first.year) * 12 + last.month - first.month)
    density = len(months) / span_months
    
    # Recent trend (last 3 months vs previous 3)
    now = datetime.now().strftime("%Y-%m")
    recent_months = [m for m in months if m >= (datetime.now().replace(day=1).__format__("%Y-%m"))]
    
    if density > 0.4:
        # Check for growth/fade
        recent_3 = sum(buckets.get(m, 0) for m in months[-3:])
        early_3 = sum(buckets.get(m, 0) for m in months[:3])
        if recent_3 > early_3 * 2 and len(months) > 6:
            return "growing"
        if early_3 > recent_3 * 2 and len(months) > 6:
            return "fading"
        return "consistent"
    elif density > 0.15:
        return "episodic"
    else:
        return "clustered"


def _sample_messages(messages: list[dict], max_samples: int = 12) -> list[dict]:
    """Smart-sample representative messages from a conversation.
    
    Strategy:
    - 2 earliest messages (how relationship started)
    - 3 most recent (current state)
    - 5 longest/most substantive (skip noise)
    - 2 with relationship signal words
    """
    if not messages:
        return []
    
    samples = []
    seen_ids = set()
    
    def add(msg):
        mid = msg.get("id") or f"{msg.get('date', 0)}-{msg.get('text', '')[:20]}"
        if mid not in seen_ids:
            seen_ids.add(mid)
            samples.append(msg)
    
    # Sort by date
    by_date = sorted(messages, key=lambda m: m.get("date", 0))
    
    # Earliest 2
    for m in by_date[:2]:
        add(m)
    
    # Most recent 3
    for m in by_date[-3:]:
        add(m)
    
    # Longest (most substantive), skip noise
    by_length = sorted(
        [m for m in messages if not NOISE_PATTERNS.match((m.get("text") or "").strip())],
        key=lambda m: len(m.get("text") or ""),
        reverse=True,
    )
    for m in by_length[:5]:
        add(m)
    
    # Signal words (relationship indicators)
    SIGNAL_WORDS = re.compile(
        r'\b(brother|sister|mom|dad|mama|baba|wife|husband|cousin|uncle|aunt|'
        r'boss|colleague|team|project|meeting|invoice|company|'
        r'class|teacher|student|study|'
        r'bro|habibi|habibti|khala|chacha|phupho|mamu)\b',
        re.IGNORECASE,
    )
    for m in messages:
        if len(samples) >= max_samples:
            break
        text = m.get("text") or ""
        if SIGNAL_WORDS.search(text):
            add(m)
    
    return samples[:max_samples]


# ── WhatsApp Message Signals ────────────────────────────────────

WA_DB_PATH = (
    Path.home()
    / "Library"
    / "Group Containers"
    / "group.net.whatsapp.WhatsApp.shared"
    / "ChatStorage.sqlite"
)


def _extract_whatsapp_signals(person_id: str, identifiers: dict) -> dict:
    """Extract WhatsApp message signals for a person."""
    result = {
        "total_messages": 0,
        "sent": 0,
        "received": 0,
        "temporal_buckets": {},
        "temporal_pattern": "none",
        "first_message_date": None,
        "last_message_date": None,
        "sample_messages": [],
        "avg_message_length": 0,
    }
    
    tmp = _copy_db(WA_DB_PATH)
    if not tmp:
        return result
    
    try:
        conn = sqlite3.connect(tmp)
        conn.row_factory = sqlite3.Row
        
        # Find chat session by JID or phone
        session_pk = None
        for jid in identifiers.get("wa_jids", []):
            row = conn.execute(
                "SELECT Z_PK FROM ZWACHATSESSION WHERE ZCONTACTJID = ?", (jid,)
            ).fetchone()
            if row:
                session_pk = row["Z_PK"]
                break
        
        if not session_pk:
            for phone in identifiers.get("phones", []):
                suffix = phone[-10:] if len(phone) > 10 else phone
                row = conn.execute(
                    "SELECT Z_PK FROM ZWACHATSESSION WHERE ZCONTACTJID LIKE ?",
                    (f"%{suffix}%@s.whatsapp.net",),
                ).fetchone()
                if row:
                    session_pk = row["Z_PK"]
                    break
        
        if not session_pk:
            return result
        
        # Get all text messages
        msgs = conn.execute("""
            SELECT ZTEXT, ZMESSAGEDATE, ZISFROMME
            FROM ZWAMESSAGE
            WHERE ZCHATSESSION = ? AND ZTEXT IS NOT NULL AND LENGTH(ZTEXT) > 1
            ORDER BY ZMESSAGEDATE ASC
        """, (session_pk,)).fetchall()
        
        if not msgs:
            return result
        
        timestamps = []
        all_messages = []
        total_length = 0
        sent = 0
        received = 0
        
        for m in msgs:
            text = m["ZTEXT"] or ""
            ts = (m["ZMESSAGEDATE"] or 0) + APPLE_EPOCH
            timestamps.append(ts)
            total_length += len(text)
            if m["ZISFROMME"]:
                sent += 1
            else:
                received += 1
            all_messages.append({
                "text": text[:300],  # cap for digest
                "date": ts,
                "direction": "out" if m["ZISFROMME"] else "in",
                "channel": "whatsapp",
            })
        
        buckets = _bucket_by_month(timestamps)
        
        result["total_messages"] = len(msgs)
        result["sent"] = sent
        result["received"] = received
        result["temporal_buckets"] = buckets
        result["temporal_pattern"] = _detect_temporal_pattern(buckets)
        result["first_message_date"] = datetime.fromtimestamp(timestamps[0]).isoformat() if timestamps else None
        result["last_message_date"] = datetime.fromtimestamp(timestamps[-1]).isoformat() if timestamps else None
        result["sample_messages"] = _sample_messages(all_messages)
        result["avg_message_length"] = total_length // max(1, len(msgs))
        
        conn.close()
    finally:
        Path(tmp).unlink(missing_ok=True)
    
    return result


# ── iMessage Signals ────────────────────────────────────────────

IMESSAGE_DB = Path.home() / "Library" / "Messages" / "chat.db"


def _extract_imessage_signals(person_id: str, identifiers: dict) -> dict:
    """Extract iMessage signals for a person."""
    result = {
        "total_messages": 0,
        "sent": 0,
        "received": 0,
        "temporal_buckets": {},
        "temporal_pattern": "none",
        "first_message_date": None,
        "last_message_date": None,
        "sample_messages": [],
        "services": {},  # iMessage vs SMS vs RCS breakdown
    }
    
    tmp = _copy_db(IMESSAGE_DB)
    if not tmp:
        return result
    
    try:
        conn = sqlite3.connect(tmp)
        conn.row_factory = sqlite3.Row
        
        # Find handles matching this person's identifiers
        handle_ids = []
        for phone in identifiers.get("phones", []):
            suffix = phone[-10:] if len(phone) > 10 else phone
            rows = conn.execute(
                "SELECT ROWID FROM handle WHERE id LIKE ?",
                (f"%{suffix}%",),
            ).fetchall()
            handle_ids.extend(r["ROWID"] for r in rows)
        
        for email in identifiers.get("emails", []):
            rows = conn.execute(
                "SELECT ROWID FROM handle WHERE id = ?",
                (email,),
            ).fetchall()
            handle_ids.extend(r["ROWID"] for r in rows)
        
        if not handle_ids:
            return result
        
        # Get messages via chat_handle_join → chat_message_join
        placeholders = ",".join("?" * len(handle_ids))
        msgs = conn.execute(f"""
            SELECT DISTINCT m.text, m.date, m.is_from_me, m.service
            FROM message m
            JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
            JOIN chat_handle_join chj ON chj.chat_id = cmj.chat_id
            WHERE chj.handle_id IN ({placeholders})
            AND m.text IS NOT NULL AND LENGTH(m.text) > 1
            ORDER BY m.date ASC
        """, handle_ids).fetchall()
        
        if not msgs:
            return result
        
        timestamps = []
        all_messages = []
        services = defaultdict(int)
        sent = 0
        received = 0
        
        for m in msgs:
            text = m["text"] or ""
            ts = (m["date"] or 0) / IMESSAGE_NS + APPLE_EPOCH
            timestamps.append(ts)
            services[m["service"] or "unknown"] += 1
            if m["is_from_me"]:
                sent += 1
            else:
                received += 1
            all_messages.append({
                "text": text[:300],
                "date": ts,
                "direction": "out" if m["is_from_me"] else "in",
                "channel": "imessage",
            })
        
        buckets = _bucket_by_month(timestamps)
        
        result["total_messages"] = len(msgs)
        result["sent"] = sent
        result["received"] = received
        result["temporal_buckets"] = buckets
        result["temporal_pattern"] = _detect_temporal_pattern(buckets)
        result["first_message_date"] = datetime.fromtimestamp(timestamps[0]).isoformat() if timestamps else None
        result["last_message_date"] = datetime.fromtimestamp(timestamps[-1]).isoformat() if timestamps else None
        result["sample_messages"] = _sample_messages(all_messages)
        result["services"] = dict(services)
        
        conn.close()
    finally:
        Path(tmp).unlink(missing_ok=True)
    
    return result


# ── Call History Signals ────────────────────────────────────────

CALL_DB = Path.home() / "Library" / "Application Support" / "CallHistoryDB" / "CallHistory.storedata"


def extract_call_signals(person_id: str) -> dict:
    """Extract phone call signals for a person."""
    result = {
        "total_calls": 0,
        "answered_calls": 0,
        "total_minutes": 0,
        "avg_duration_minutes": 0,
        "outgoing": 0,
        "incoming": 0,
        "temporal_buckets": {},
        "temporal_pattern": "none",
        "first_call_date": None,
        "last_call_date": None,
    }
    
    if not CALL_DB.exists():
        return result
    
    identifiers = _get_person_identifiers(person_id)
    
    conn = sqlite3.connect(str(CALL_DB))
    conn.row_factory = sqlite3.Row
    
    try:
        all_calls = []
        
        for phone in identifiers.get("phones", []):
            suffix = phone[-10:] if len(phone) > 10 else phone
            
            # Find handle
            handles = conn.execute(
                "SELECT Z_PK FROM ZHANDLE WHERE ZNORMALIZEDVALUE LIKE ? OR ZVALUE LIKE ?",
                (f"%{suffix}%", f"%{suffix}%"),
            ).fetchall()
            
            for h in handles:
                calls = conn.execute("""
                    SELECT cr.ZANSWERED, cr.ZDURATION, cr.ZDATE, cr.ZORIGINATED
                    FROM ZCALLRECORD cr
                    JOIN Z_2REMOTEPARTICIPANTHANDLES rph ON rph.Z_2REMOTEPARTICIPANTCALLS = cr.Z_PK
                    WHERE rph.Z_4REMOTEPARTICIPANTHANDLES = ?
                """, (h["Z_PK"],)).fetchall()
                all_calls.extend(calls)
        
        # Also check emails (FaceTime)
        for email in identifiers.get("emails", []):
            handles = conn.execute(
                "SELECT Z_PK FROM ZHANDLE WHERE ZVALUE = ?", (email,)
            ).fetchall()
            for h in handles:
                calls = conn.execute("""
                    SELECT cr.ZANSWERED, cr.ZDURATION, cr.ZDATE, cr.ZORIGINATED
                    FROM ZCALLRECORD cr
                    JOIN Z_2REMOTEPARTICIPANTHANDLES rph ON rph.Z_2REMOTEPARTICIPANTCALLS = cr.Z_PK
                    WHERE rph.Z_4REMOTEPARTICIPANTHANDLES = ?
                """, (h["Z_PK"],)).fetchall()
                all_calls.extend(calls)
        
        if not all_calls:
            return result
        
        timestamps = []
        total_duration = 0
        answered = 0
        outgoing = 0
        incoming = 0
        
        for c in all_calls:
            ts = (c["ZDATE"] or 0) + APPLE_EPOCH
            timestamps.append(ts)
            duration = c["ZDURATION"] or 0
            total_duration += duration
            if c["ZANSWERED"]:
                answered += 1
            if c["ZORIGINATED"]:
                outgoing += 1
            else:
                incoming += 1
        
        buckets = _bucket_by_month(timestamps)
        timestamps.sort()
        
        result["total_calls"] = len(all_calls)
        result["answered_calls"] = answered
        result["total_minutes"] = round(total_duration / 60, 1)
        result["avg_duration_minutes"] = round(total_duration / 60 / max(1, answered), 1)
        result["outgoing"] = outgoing
        result["incoming"] = incoming
        result["temporal_buckets"] = buckets
        result["temporal_pattern"] = _detect_temporal_pattern(buckets)
        result["first_call_date"] = datetime.fromtimestamp(timestamps[0]).isoformat() if timestamps else None
        result["last_call_date"] = datetime.fromtimestamp(timestamps[-1]).isoformat() if timestamps else None
        
    finally:
        conn.close()
    
    return result


# ── Photo Signals ───────────────────────────────────────────────

PHOTOS_DB = Path.home() / "Pictures" / "Photos Library.photoslibrary" / "database" / "Photos.sqlite"


def extract_photo_signals(person_id: str) -> dict:
    """Extract Apple Photos face co-occurrence signals for a person.
    
    Uses photo metadata only — no image analysis, no LLM tokens.
    Matches person to ZPERSON via name similarity.
    """
    result = {
        "total_photos": 0,
        "temporal_buckets": {},
        "temporal_pattern": "none",
        "first_photo_date": None,
        "last_photo_date": None,
        "locations": [],  # list of {lat, lon, count}
        "co_photographed_with": [],  # other ZPERSON names in same photos
        "verified": False,
    }
    
    tmp = _copy_db(PHOTOS_DB)
    if not tmp:
        return result
    
    try:
        conn = sqlite3.connect(tmp)
        conn.row_factory = sqlite3.Row
        
        # Get person's name from people.db
        pdb = sqlite3.connect(str(DB_PEOPLE))
        pdb.row_factory = sqlite3.Row
        person = pdb.execute(
            "SELECT canonical_name, first_name FROM people WHERE id = ?",
            (person_id,),
        ).fetchone()
        pdb.close()
        
        if not person:
            return result
        
        # Match to Photos ZPERSON by name (fuzzy)
        name = person["canonical_name"] or ""
        first = person["first_name"] or ""
        
        # Try display name match first, then full name
        zperson = None
        for search_name in [first, name]:
            if not search_name:
                continue
            zperson = conn.execute(
                "SELECT Z_PK, ZDISPLAYNAME, ZFULLNAME, ZFACECOUNT, ZVERIFIEDTYPE "
                "FROM ZPERSON WHERE ZDISPLAYNAME = ? OR ZFULLNAME = ? LIMIT 1",
                (search_name, search_name),
            ).fetchone()
            if zperson:
                break
        
        if not zperson:
            # Try LIKE match
            for search_name in [first, name.split()[0] if name else ""]:
                if not search_name or len(search_name) < 3:
                    continue
                zperson = conn.execute(
                    "SELECT Z_PK, ZDISPLAYNAME, ZFULLNAME, ZFACECOUNT, ZVERIFIEDTYPE "
                    "FROM ZPERSON WHERE ZDISPLAYNAME LIKE ? OR ZFULLNAME LIKE ? "
                    "ORDER BY ZFACECOUNT DESC LIMIT 1",
                    (f"%{search_name}%", f"%{search_name}%"),
                ).fetchone()
                if zperson:
                    break
        
        if not zperson:
            return result
        
        result["total_photos"] = zperson["ZFACECOUNT"] or 0
        result["verified"] = (zperson["ZVERIFIEDTYPE"] or 0) == 1
        
        # Get photo dates and locations
        photos = conn.execute("""
            SELECT a.ZDATECREATED, a.ZLATITUDE, a.ZLONGITUDE
            FROM ZDETECTEDFACE f
            JOIN ZASSET a ON a.Z_PK = f.ZASSETFORFACE
            WHERE f.ZPERSONFORFACE = ?
            AND a.ZDATECREATED IS NOT NULL
        """, (zperson["Z_PK"],)).fetchall()
        
        timestamps = []
        location_counts = defaultdict(int)
        
        for p in photos:
            ts = (p["ZDATECREATED"] or 0) + APPLE_EPOCH
            timestamps.append(ts)
            lat = p["ZLATITUDE"]
            lon = p["ZLONGITUDE"]
            if lat and lon and abs(lat) <= 90 and abs(lon) <= 180:
                # Round to ~1km precision
                key = (round(lat, 2), round(lon, 2))
                location_counts[key] += 1
        
        buckets = _bucket_by_month(timestamps)
        timestamps.sort()
        
        result["temporal_buckets"] = buckets
        result["temporal_pattern"] = _detect_temporal_pattern(buckets)
        result["first_photo_date"] = datetime.fromtimestamp(timestamps[0]).isoformat() if timestamps else None
        result["last_photo_date"] = datetime.fromtimestamp(timestamps[-1]).isoformat() if timestamps else None
        
        # Top 5 locations
        top_locs = sorted(location_counts.items(), key=lambda x: x[1], reverse=True)[:5]
        result["locations"] = [
            {"lat": lat, "lon": lon, "count": count}
            for (lat, lon), count in top_locs
        ]
        
        # Co-photographed people (who appears in the same photos)
        co_people = conn.execute("""
            SELECT p2.ZDISPLAYNAME, COUNT(DISTINCT f2.ZASSETFORFACE) as shared_photos
            FROM ZDETECTEDFACE f1
            JOIN ZDETECTEDFACE f2 ON f2.ZASSETFORFACE = f1.ZASSETFORFACE AND f2.Z_PK != f1.Z_PK
            JOIN ZPERSON p2 ON p2.Z_PK = f2.ZPERSONFORFACE
            WHERE f1.ZPERSONFORFACE = ?
            AND p2.ZDISPLAYNAME IS NOT NULL
            GROUP BY p2.Z_PK
            ORDER BY shared_photos DESC
            LIMIT 10
        """, (zperson["Z_PK"],)).fetchall()
        
        result["co_photographed_with"] = [
            {"name": c["ZDISPLAYNAME"], "shared_photos": c["shared_photos"]}
            for c in co_people
        ]
        
        conn.close()
    finally:
        Path(tmp).unlink(missing_ok=True)
    
    return result


# ── Email Signals ───────────────────────────────────────────────


def extract_email_signals(person_id: str) -> dict:
    """Extract Apple Mail signals for a person."""
    result = {
        "total_emails": 0,
        "sent_to_you": 0,
        "you_sent": 0,
        "temporal_buckets": {},
        "temporal_pattern": "none",
        "first_email_date": None,
        "last_email_date": None,
    }
    
    identifiers = _get_person_identifiers(person_id)
    emails = identifiers.get("emails", [])
    if not emails:
        return result
    
    # Find Apple Mail envelope index
    mail_dbs = list(Path.home().glob("Library/Mail/V*/MailData/Envelope Index"))
    if not mail_dbs:
        return result
    
    conn = sqlite3.connect(str(mail_dbs[0]))
    conn.row_factory = sqlite3.Row
    
    try:
        for email_addr in emails:
            # Count emails from this address
            row = conn.execute(
                "SELECT COUNT(*) as cnt FROM messages m "
                "JOIN addresses a ON a.ROWID = m.sender "
                "WHERE a.address = ?",
                (email_addr,),
            ).fetchone()
            if row:
                result["sent_to_you"] += row["cnt"]
                result["total_emails"] += row["cnt"]
        
        # Get date range from messages
        for email_addr in emails:
            dates = conn.execute("""
                SELECT m.date_sent
                FROM messages m
                JOIN addresses a ON a.ROWID = m.sender
                WHERE a.address = ?
                ORDER BY m.date_sent ASC
            """, (email_addr,)).fetchall()
            
            if dates:
                timestamps = [d["date_sent"] for d in dates if d["date_sent"]]
                if timestamps:
                    buckets = _bucket_by_month(timestamps)
                    result["temporal_buckets"] = buckets
                    result["temporal_pattern"] = _detect_temporal_pattern(buckets)
                    result["first_email_date"] = datetime.fromtimestamp(timestamps[0]).isoformat()
                    result["last_email_date"] = datetime.fromtimestamp(timestamps[-1]).isoformat()
    except Exception:
        pass  # Mail DB schema varies
    finally:
        conn.close()
    
    return result


# ── Group Membership Signals ────────────────────────────────────


def extract_group_signals(person_id: str) -> dict:
    """Extract WhatsApp group membership signals."""
    result = {
        "groups": [],  # list of {name, type, member_count}
        "total_groups": 0,
    }
    
    if not DB_PEOPLE.exists():
        return result
    
    conn = sqlite3.connect(str(DB_PEOPLE))
    conn.row_factory = sqlite3.Row
    
    groups = conn.execute("""
        SELECT g.name, g.type, g.member_count
        FROM group_members gm
        JOIN groups g ON g.id = gm.group_id
        WHERE gm.person_id = ?
        ORDER BY g.member_count DESC
    """, (person_id,)).fetchall()
    
    result["groups"] = [
        {"name": g["name"], "type": g["type"], "member_count": g["member_count"] or 0}
        for g in groups
    ]
    result["total_groups"] = len(groups)
    
    conn.close()
    return result


# ── Vault Mention Signals ──────────────────────────────────────


def extract_vault_signals(person_id: str) -> dict:
    """Extract mentions of a person from vault daily logs and session exports.
    
    Uses simple text search — no LLM needed. Looks for canonical_name
    and first_name in vault markdown files.
    """
    result = {
        "total_mentions": 0,
        "daily_log_mentions": 0,
        "session_mentions": 0,
        "mention_contexts": [],  # list of {file, line, snippet}
    }
    
    if not DB_PEOPLE.exists():
        return result
    
    conn = sqlite3.connect(str(DB_PEOPLE))
    conn.row_factory = sqlite3.Row
    person = conn.execute(
        "SELECT canonical_name, first_name, last_name FROM people WHERE id = ?",
        (person_id,),
    ).fetchone()
    conn.close()
    
    if not person:
        return result
    
    # Build search terms
    search_terms = set()
    name = person["canonical_name"] or ""
    first = person["first_name"] or ""
    last = person["last_name"] or ""
    if name and len(name) > 3:
        search_terms.add(name.lower())
    if first and len(first) > 3:
        search_terms.add(first.lower())
    
    if not search_terms:
        return result
    
    vault_log = Path.home() / "vault" / "log"
    if not vault_log.exists():
        return result
    
    # Search daily logs (recent 90 days)
    import glob
    log_files = sorted(vault_log.glob("202*.md"), reverse=True)[:90]
    
    for log_file in log_files:
        try:
            content = log_file.read_text(errors="ignore")
            content_lower = content.lower()
            for term in search_terms:
                if term in content_lower:
                    result["daily_log_mentions"] += 1
                    result["total_mentions"] += 1
                    # Extract context snippet
                    idx = content_lower.index(term)
                    start = max(0, idx - 50)
                    end = min(len(content), idx + len(term) + 100)
                    snippet = content[start:end].replace("\n", " ").strip()
                    result["mention_contexts"].append({
                        "file": log_file.name,
                        "snippet": snippet,
                    })
                    break  # one match per file is enough
        except Exception:
            pass
    
    # Search session exports
    sessions_dir = vault_log / "sessions"
    if sessions_dir.exists():
        session_files = sorted(sessions_dir.glob("*.md"), reverse=True)[:50]
        for sf in session_files:
            try:
                content = sf.read_text(errors="ignore")
                content_lower = content.lower()
                for term in search_terms:
                    if term in content_lower:
                        result["session_mentions"] += 1
                        result["total_mentions"] += 1
                        break
            except Exception:
                pass
    
    # Cap contexts to avoid bloat
    result["mention_contexts"] = result["mention_contexts"][:5]
    
    return result


# ── Existing Ontology Signals ──────────────────────────────────


def extract_ontology_signals(person_id: str) -> dict:
    """Extract what we already know from the ontology tables."""
    result = {
        "importance": 3,
        "relationships": [],
        "circles": [],
        "organizations": [],
        "aliases": [],
        "metadata": {},
        "interaction_stats": {},
    }
    
    if not DB_PEOPLE.exists():
        return result
    
    conn = sqlite3.connect(str(DB_PEOPLE))
    conn.row_factory = sqlite3.Row
    
    # Person basics
    person = conn.execute(
        "SELECT importance, is_archived FROM people WHERE id = ?", (person_id,)
    ).fetchone()
    if person:
        result["importance"] = person["importance"]
    
    # Explicit relationships
    rels = conn.execute("""
        SELECT pb.canonical_name as name, r.type, r.subtype, r.context, r.strength
        FROM relationships r
        JOIN people pb ON pb.id = r.person_b_id
        WHERE r.person_a_id = ?
        UNION
        SELECT pa.canonical_name as name, r.type, r.subtype, r.context, r.strength
        FROM relationships r
        JOIN people pa ON pa.id = r.person_a_id
        WHERE r.person_b_id = ?
    """, (person_id, person_id)).fetchall()
    result["relationships"] = [dict(r) for r in rels]
    
    # Circle memberships
    try:
        circles = conn.execute("""
            SELECT c.name, c.category, cm.role_in_circle, cm.confidence
            FROM circle_membership cm
            JOIN circle c ON c.id = cm.circle_id
            WHERE cm.person_id = ?
        """, (person_id,)).fetchall()
        result["circles"] = [dict(c) for c in circles]
    except Exception:
        pass
    
    # Org memberships
    try:
        orgs = conn.execute("""
            SELECT o.name, m.role, m.department
            FROM membership m
            JOIN organization o ON o.id = m.org_id
            WHERE m.person_id = ?
        """, (person_id,)).fetchall()
        result["organizations"] = [dict(o) for o in orgs]
    except Exception:
        pass
    
    # Aliases
    aliases = conn.execute(
        "SELECT alias, type FROM aliases WHERE person_id = ?", (person_id,)
    ).fetchall()
    result["aliases"] = [dict(a) for a in aliases]
    
    # Contact metadata
    meta = conn.execute(
        "SELECT * FROM contact_metadata WHERE person_id = ?", (person_id,)
    ).fetchone()
    if meta:
        result["metadata"] = {k: meta[k] for k in meta.keys() if meta[k]}
    
    # Interaction stats
    state = conn.execute(
        "SELECT * FROM relationship_state WHERE person_id = ?", (person_id,)
    ).fetchone()
    if state:
        result["interaction_stats"] = {k: state[k] for k in state.keys() if state[k]}
    
    conn.close()
    return result


# ── Combined Signal Extraction ──────────────────────────────────


def extract_message_signals(person_id: str) -> dict:
    """Extract message signals from all channels for a person.
    
    Returns dict keyed by channel name with per-channel signal dicts.
    """
    identifiers = _get_person_identifiers(person_id)
    
    return {
        "whatsapp": _extract_whatsapp_signals(person_id, identifiers),
        "imessage": _extract_imessage_signals(person_id, identifiers),
    }


def extract_all_signals(person_id: str) -> dict:
    """Extract ALL signals for a person across every data source.
    
    This is the main entry point. Returns a comprehensive signal dict
    that the profile builder uses to construct the person profile.
    """
    identifiers = _get_person_identifiers(person_id)
    
    return {
        "person_id": person_id,
        "identifiers": identifiers,
        "messages": {
            "whatsapp": _extract_whatsapp_signals(person_id, identifiers),
            "imessage": _extract_imessage_signals(person_id, identifiers),
        },
        "calls": extract_call_signals(person_id),
        "photos": extract_photo_signals(person_id),
        "email": extract_email_signals(person_id),
        "groups": extract_group_signals(person_id),
        "vault": extract_vault_signals(person_id),
        "ontology": extract_ontology_signals(person_id),
        "extracted_at": datetime.now().isoformat(),
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Volumes/AOS-X/project/aos && python3 -m pytest tests/engine/people/test_signals.py -v`
Expected: PASS

- [ ] **Step 5: Write integration test with real data**

```python
# tests/engine/people/test_signals_integration.py
"""Integration tests — run against real databases on this machine."""
import pytest
from pathlib import Path
from core.engine.people.signals import extract_all_signals

DB_PEOPLE = Path.home() / ".aos" / "data" / "people.db"

@pytest.mark.skipif(not DB_PEOPLE.exists(), reason="No people.db")
def test_extract_all_signals_real():
    """Extract signals for a real person and verify structure."""
    import sqlite3
    conn = sqlite3.connect(str(DB_PEOPLE))
    # Get a person with interactions
    row = conn.execute("""
        SELECT p.id FROM people p
        JOIN relationship_state rs ON rs.person_id = p.id
        WHERE rs.msg_count_30d > 10
        LIMIT 1
    """).fetchone()
    conn.close()
    
    if not row:
        pytest.skip("No active contacts")
    
    signals = extract_all_signals(row[0])
    
    assert signals["person_id"] == row[0]
    assert "messages" in signals
    assert "calls" in signals
    assert "photos" in signals
    assert "email" in signals
    assert "groups" in signals
    assert "vault" in signals
    assert "ontology" in signals
    
    # At least one channel should have data
    wa = signals["messages"]["whatsapp"]
    im = signals["messages"]["imessage"]
    assert wa["total_messages"] > 0 or im["total_messages"] > 0
```

- [ ] **Step 6: Run integration test**

Run: `cd /Volumes/AOS-X/project/aos && python3 -m pytest tests/engine/people/test_signals_integration.py -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add core/engine/people/signals.py tests/engine/people/
git commit -m "feat(people): signal extractors for all data sources

Reads WhatsApp, iMessage, calls, photos, email, groups, vault mentions,
and existing ontology data. All extractors copy databases to temp before
reading. Zero LLM cost — pure SQL extraction."
```

---

### Task 2: Profile Builder

**Files:**
- Create: `core/engine/people/profile.py`
- Test: `tests/engine/people/test_profile.py`

The profile builder takes raw signals and assembles them into a structured, human-readable profile suitable for LLM classification. It computes cross-channel metrics, detects temporal patterns, and produces the "profile shape" described in the system design.

- [ ] **Step 1: Write test for profile builder**

```python
# tests/engine/people/test_profile.py
from core.engine.people.profile import build_profile, PersonProfile

def test_build_profile_from_signals():
    """Profile builder produces structured output from signals."""
    signals = {
        "person_id": "p_test123",
        "identifiers": {"phones": ["1234567890"], "emails": [], "wa_jids": []},
        "messages": {
            "whatsapp": {
                "total_messages": 100, "sent": 40, "received": 60,
                "temporal_buckets": {"2026-01": 20, "2026-02": 30, "2026-03": 50},
                "temporal_pattern": "growing",
                "first_message_date": "2026-01-01T00:00:00",
                "last_message_date": "2026-03-15T00:00:00",
                "sample_messages": [
                    {"text": "Hey bro how are you", "date": 1710000000, "direction": "out", "channel": "whatsapp"},
                ],
                "avg_message_length": 25,
            },
            "imessage": {
                "total_messages": 0, "sent": 0, "received": 0,
                "temporal_buckets": {}, "temporal_pattern": "none",
                "first_message_date": None, "last_message_date": None,
                "sample_messages": [],
            },
        },
        "calls": {"total_calls": 5, "answered_calls": 4, "total_minutes": 20, "avg_duration_minutes": 5, "outgoing": 3, "incoming": 2, "temporal_buckets": {}, "temporal_pattern": "none", "first_call_date": None, "last_call_date": None},
        "photos": {"total_photos": 0, "temporal_buckets": {}, "temporal_pattern": "none", "first_photo_date": None, "last_photo_date": None, "locations": [], "co_photographed_with": [], "verified": False},
        "email": {"total_emails": 0, "sent_to_you": 0, "you_sent": 0, "temporal_buckets": {}, "temporal_pattern": "none", "first_email_date": None, "last_email_date": None},
        "groups": {"groups": [], "total_groups": 0},
        "vault": {"total_mentions": 0, "daily_log_mentions": 0, "session_mentions": 0, "mention_contexts": []},
        "ontology": {"importance": 3, "relationships": [], "circles": [], "organizations": [], "aliases": [], "metadata": {}, "interaction_stats": {}},
    }
    
    profile = build_profile(signals)
    
    assert isinstance(profile, PersonProfile)
    assert profile.person_id == "p_test123"
    assert profile.total_messages == 100
    assert profile.channels_active == ["whatsapp"]
    assert profile.channel_count >= 1  # whatsapp + calls
    assert profile.overall_temporal_pattern in ["growing", "consistent", "episodic", "clustered", "fading", "one_shot", "none"]
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement profile.py**

```python
"""Person Profile Builder.

Assembles raw signals from all sources into a structured PersonProfile
suitable for LLM classification. Computes cross-channel metrics, detects
temporal patterns, and produces human-readable summaries.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class PersonProfile:
    """Multi-dimensional temporal profile of a person.
    
    This is what gets sent to the LLM for classification.
    """
    person_id: str
    name: str = ""
    
    # Channel summary
    channels_active: list[str] = field(default_factory=list)
    channel_count: int = 0
    channel_preference: str = ""  # which channel has most messages
    
    # Communication
    total_messages: int = 0
    total_calls: int = 0
    total_call_minutes: float = 0
    total_photos: int = 0
    total_emails: int = 0
    total_vault_mentions: int = 0
    
    # Temporal
    relationship_start: str | None = None  # earliest signal across all sources
    relationship_age_months: int = 0
    overall_temporal_pattern: str = "none"
    recent_trend: str = "stable"  # growing, stable, fading, dormant
    
    # Cross-channel flags
    is_multi_channel: bool = False  # 3+ channels
    has_physical_presence: bool = False  # photos
    has_voice_contact: bool = False  # calls
    is_bidirectional: bool = False  # both send and receive
    
    # Message digest (for LLM)
    message_samples: list[dict] = field(default_factory=list)
    tone_signals: list[str] = field(default_factory=list)
    
    # Existing ontology
    importance: int = 3
    existing_relationships: list[dict] = field(default_factory=list)
    existing_circles: list[dict] = field(default_factory=list)
    existing_organizations: list[dict] = field(default_factory=list)
    groups: list[dict] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)
    
    # Photo context
    photo_pattern: str = "none"
    photo_locations: list[dict] = field(default_factory=list)
    co_photographed_with: list[dict] = field(default_factory=list)
    
    def to_prompt_text(self) -> str:
        """Format profile as text for LLM classification prompt."""
        lines = []
        lines.append(f"Person: {self.name} ({self.person_id})")
        
        # Channels
        channels_str = []
        if self.total_messages > 0:
            channels_str.append(f"messages({self.total_messages})")
        if self.total_calls > 0:
            channels_str.append(f"calls({self.total_calls}/{self.total_call_minutes:.0f}min)")
        if self.total_photos > 0:
            channels_str.append(f"photos({self.total_photos})")
        if self.total_emails > 0:
            channels_str.append(f"emails({self.total_emails})")
        lines.append(f"Channels: {', '.join(channels_str)}")
        lines.append(f"Active channels: {', '.join(self.channels_active)} (preference: {self.channel_preference})")
        
        # Temporal
        lines.append(f"Relationship age: {self.relationship_age_months} months (since {self.relationship_start or 'unknown'})")
        lines.append(f"Pattern: {self.overall_temporal_pattern}, recent: {self.recent_trend}")
        
        # Flags
        flags = []
        if self.is_multi_channel:
            flags.append("multi-channel")
        if self.has_physical_presence:
            flags.append("physical-presence")
        if self.has_voice_contact:
            flags.append("voice-contact")
        if self.is_bidirectional:
            flags.append("bidirectional")
        if flags:
            lines.append(f"Signals: {', '.join(flags)}")
        
        # Photos
        if self.total_photos > 0:
            lines.append(f"Photos: {self.total_photos}, pattern: {self.photo_pattern}")
            if self.co_photographed_with:
                names = [c["name"] for c in self.co_photographed_with[:5]]
                lines.append(f"Co-photographed with: {', '.join(names)}")
            if self.photo_locations:
                locs = [f"({l['lat']},{l['lon']})x{l['count']}" for l in self.photo_locations[:3]]
                lines.append(f"Photo locations: {', '.join(locs)}")
        
        # Groups
        if self.groups:
            group_names = [g["name"] for g in self.groups[:5]]
            lines.append(f"Shared groups: {', '.join(group_names)}")
        
        # Existing ontology
        if self.existing_relationships:
            rels = [f"{r.get('name', '?')}({r.get('subtype') or r.get('type', '?')})" for r in self.existing_relationships]
            lines.append(f"Known relationships: {', '.join(rels)}")
        if self.existing_organizations:
            orgs = [f"{o.get('name', '?')}({o.get('role', '?')})" for o in self.existing_organizations]
            lines.append(f"Organizations: {', '.join(orgs)}")
        
        # Metadata
        meta_parts = []
        for key in ["organization", "job_title", "city", "country", "birthday"]:
            val = self.metadata.get(key)
            if val:
                meta_parts.append(f"{key}: {val}")
        if meta_parts:
            lines.append(f"Metadata: {', '.join(meta_parts)}")
        
        # Vault
        if self.total_vault_mentions > 0:
            lines.append(f"Vault mentions: {self.total_vault_mentions}")
        
        # Message samples
        if self.message_samples:
            lines.append("Message samples:")
            for m in self.message_samples[:10]:
                d = "→" if m.get("direction") == "out" else "←"
                ch = m.get("channel", "?")
                ts = ""
                if m.get("date"):
                    try:
                        ts = datetime.fromtimestamp(m["date"]).strftime("%Y-%m-%d")
                    except Exception:
                        pass
                text = (m.get("text") or "")[:200]
                lines.append(f"  {d} [{ch}/{ts}] {text}")
        
        return "\n".join(lines)


def build_profile(signals: dict) -> PersonProfile:
    """Build a PersonProfile from extracted signals."""
    from pathlib import Path
    import sqlite3
    
    person_id = signals["person_id"]
    
    # Get person name
    name = ""
    db_path = Path.home() / ".aos" / "data" / "people.db"
    if db_path.exists():
        conn = sqlite3.connect(str(db_path))
        row = conn.execute(
            "SELECT canonical_name FROM people WHERE id = ?", (person_id,)
        ).fetchone()
        if row:
            name = row[0] or ""
        conn.close()
    
    profile = PersonProfile(person_id=person_id, name=name)
    
    # ── Aggregate messages across channels ──
    all_samples = []
    channels_active = []
    channel_msg_counts = {}
    total_sent = 0
    total_received = 0
    
    for channel_name, ch_signals in signals.get("messages", {}).items():
        count = ch_signals.get("total_messages", 0)
        if count > 0:
            channels_active.append(channel_name)
            channel_msg_counts[channel_name] = count
            total_sent += ch_signals.get("sent", 0)
            total_received += ch_signals.get("received", 0)
            all_samples.extend(ch_signals.get("sample_messages", []))
    
    profile.total_messages = sum(channel_msg_counts.values())
    profile.is_bidirectional = total_sent > 0 and total_received > 0
    
    # ── Calls ──
    calls = signals.get("calls", {})
    profile.total_calls = calls.get("total_calls", 0)
    profile.total_call_minutes = calls.get("total_minutes", 0)
    profile.has_voice_contact = calls.get("answered_calls", 0) > 0
    if profile.has_voice_contact:
        channels_active.append("phone")
    
    # ── Photos ──
    photos = signals.get("photos", {})
    profile.total_photos = photos.get("total_photos", 0)
    profile.has_physical_presence = profile.total_photos > 0
    profile.photo_pattern = photos.get("temporal_pattern", "none")
    profile.photo_locations = photos.get("locations", [])
    profile.co_photographed_with = photos.get("co_photographed_with", [])
    if profile.has_physical_presence:
        channels_active.append("photos")
    
    # ── Email ──
    email = signals.get("email", {})
    profile.total_emails = email.get("total_emails", 0)
    if profile.total_emails > 0:
        channels_active.append("email")
    
    # ── Vault ──
    vault = signals.get("vault", {})
    profile.total_vault_mentions = vault.get("total_mentions", 0)
    
    # ── Channel summary ──
    profile.channels_active = channels_active
    profile.channel_count = len(channels_active)
    profile.is_multi_channel = len(channels_active) >= 3
    
    if channel_msg_counts:
        profile.channel_preference = max(channel_msg_counts, key=channel_msg_counts.get)
    
    # ── Temporal ──
    # Find earliest signal across all sources
    earliest_dates = []
    for ch_signals in signals.get("messages", {}).values():
        d = ch_signals.get("first_message_date")
        if d:
            earliest_dates.append(d)
    for key in ["calls", "photos", "email"]:
        d = signals.get(key, {}).get(f"first_{key.rstrip('s')}_date") or signals.get(key, {}).get("first_call_date") or signals.get(key, {}).get("first_photo_date") or signals.get(key, {}).get("first_email_date")
        if d:
            earliest_dates.append(d)
    
    if earliest_dates:
        earliest_dates.sort()
        profile.relationship_start = earliest_dates[0][:10]  # YYYY-MM-DD
        try:
            start = datetime.fromisoformat(earliest_dates[0])
            profile.relationship_age_months = max(1, (datetime.now() - start).days // 30)
        except Exception:
            pass
    
    # Overall temporal pattern — use the dominant channel's pattern
    patterns = []
    for ch_signals in signals.get("messages", {}).values():
        pat = ch_signals.get("temporal_pattern", "none")
        if pat != "none":
            patterns.append(pat)
    for key in ["calls", "photos", "email"]:
        pat = signals.get(key, {}).get("temporal_pattern", "none")
        if pat != "none":
            patterns.append(pat)
    
    if patterns:
        # Prefer consistent > episodic > others
        for preferred in ["consistent", "growing", "episodic", "fading", "clustered", "one_shot"]:
            if preferred in patterns:
                profile.overall_temporal_pattern = preferred
                break
    
    # ── Message samples (merged, deduplicated, sorted by date) ──
    seen = set()
    unique_samples = []
    for s in all_samples:
        key = (s.get("text", "")[:50], s.get("channel", ""))
        if key not in seen:
            seen.add(key)
            unique_samples.append(s)
    unique_samples.sort(key=lambda m: m.get("date", 0))
    profile.message_samples = unique_samples[:12]
    
    # ── Existing ontology ──
    ontology = signals.get("ontology", {})
    profile.importance = ontology.get("importance", 3)
    profile.existing_relationships = ontology.get("relationships", [])
    profile.existing_circles = ontology.get("circles", [])
    profile.existing_organizations = ontology.get("organizations", [])
    profile.metadata = ontology.get("metadata", {})
    
    # ── Groups ──
    profile.groups = signals.get("groups", {}).get("groups", [])
    
    return profile
```

- [ ] **Step 4: Run tests**
- [ ] **Step 5: Commit**

---

### Task 3: LLM Batch Classifier

**Files:**
- Create: `core/engine/people/classifier.py`
- Test: `tests/engine/people/test_classifier.py`

The classifier takes a batch of PersonProfile objects, formats them into a prompt, calls Claude, and returns structured ClassificationResult objects. It handles rate limiting, retries, and JSON parsing.

- [ ] **Step 1: Write test for classifier prompt formatting**

```python
# tests/engine/people/test_classifier.py
from core.engine.people.classifier import format_classification_prompt, parse_classification_response, ClassificationResult

def test_format_prompt_includes_all_profiles():
    """Prompt includes all profiles with clear separators."""
    from core.engine.people.profile import PersonProfile
    profiles = [
        PersonProfile(person_id="p_1", name="Test Person 1", total_messages=100, channels_active=["whatsapp"]),
        PersonProfile(person_id="p_2", name="Test Person 2", total_messages=50, channels_active=["imessage"]),
    ]
    prompt = format_classification_prompt(profiles, operator_name="Hisham")
    assert "Test Person 1" in prompt
    assert "Test Person 2" in prompt
    assert "Hisham" in prompt

def test_parse_classification_response():
    """Parser extracts structured results from LLM JSON response."""
    raw = '''[
        {
            "person_id": "p_1",
            "relationship_type": "close_friend",
            "categories": ["friend"],
            "closeness": 8,
            "importance_suggestion": 1,
            "circles": [{"name": "Inner Circle", "category": "friends", "confidence": 0.9}],
            "family": false,
            "family_role": null,
            "organization": null,
            "context": "Close friend, daily communication.",
            "confidence": 0.92,
            "questions": []
        }
    ]'''
    results = parse_classification_response(raw)
    assert len(results) == 1
    assert results[0].person_id == "p_1"
    assert results[0].relationship_type == "close_friend"
    assert results[0].confidence == 0.92
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement classifier.py**

The classifier module must:

1. `format_classification_prompt(profiles, operator_name)` — builds the system + user prompt for Claude. System prompt explains the task: "You are classifying relationships for {operator_name}. For each person profile, determine the relationship type, categories, closeness, suggested importance, circles, family status, organization, and confidence. Return JSON array."

2. `classify_batch(profiles, operator_name, api_key) -> list[ClassificationResult]` — calls Claude API with the formatted prompt, parses the response. Uses `anthropic` SDK. Batch size: 10-15 profiles per call. Retries on failure.

3. `parse_classification_response(raw_json) -> list[ClassificationResult]` — parses the JSON response into dataclasses.

4. `write_classifications(results)` — writes results to ontology tables:
   - Update `people.importance` if `importance_suggestion` differs
   - Insert/update `relationships` for family/work connections
   - Insert/update `circle_membership` for detected circles
   - Insert/update `membership` for organizations
   - Queue low-confidence results to `hygiene_queue` with action_type='verify'
   - Store `context` in `contact_metadata.notes`

```python
@dataclass
class ClassificationResult:
    person_id: str
    relationship_type: str = "unknown"
    categories: list[str] = field(default_factory=list)
    closeness: int = 5  # 1-10
    importance_suggestion: int = 3  # 1-4
    circles: list[dict] = field(default_factory=list)
    family: bool = False
    family_role: str | None = None
    organization: dict | None = None
    context: str = ""
    confidence: float = 0.0
    questions: list[str] = field(default_factory=list)
```

- [ ] **Step 4: Run tests**
- [ ] **Step 5: Commit**

---

### Task 4: Intelligence Orchestrator

**Files:**
- Create: `core/engine/people/intelligence.py`
- Test: `tests/engine/people/test_intelligence.py`

The orchestrator ties everything together: extracts signals, builds profiles, runs classification, writes results, and generates verification questions.

- [ ] **Step 1: Write test**

```python
def test_intelligence_pipeline_structure():
    """The pipeline produces results with expected shape."""
    from core.engine.people.intelligence import PeopleIntelligence
    pi = PeopleIntelligence(dry_run=True)
    # In dry_run mode, skips LLM call and returns mock classifications
    result = pi.run(limit=2)
    assert "profiles_built" in result
    assert "classified" in result
    assert "questions" in result
```

- [ ] **Step 2: Implement intelligence.py**

```python
class PeopleIntelligence:
    """Orchestrator for the full People Intelligence pipeline."""
    
    def __init__(self, dry_run=False, api_key=None):
        self.dry_run = dry_run
        self.api_key = api_key  # or load from Keychain
    
    def get_priority_contacts(self, limit=50) -> list[str]:
        """Get person_ids to analyze, ordered by priority.
        
        Priority: importance ASC, then msg_count_30d DESC.
        Skip archived and already-classified (golden_record_at recent).
        """
    
    def run(self, limit=50, person_ids=None) -> dict:
        """Run the full pipeline.
        
        1. Get priority contacts (or use provided IDs)
        2. Extract signals for each
        3. Build profiles
        4. Batch classify (10-15 per LLM call)
        5. Write results to ontology
        6. Collect verification questions
        7. Return summary
        """
    
    def run_incremental(self) -> dict:
        """Run on contacts that changed since last analysis.
        
        Detects: new interactions, new contacts, trajectory changes.
        """
    
    def generate_questions(self, results: list) -> list[dict]:
        """Collect low-confidence classifications into verification questions."""
```

- [ ] **Step 3: Run tests**
- [ ] **Step 4: Commit**

---

## Chunk 2: Event Consumer + Companion Integration

### Task 5: System Bus Consumer

**Files:**
- Create: `core/engine/people/consumer.py`
- Modify: `core/qareen/main.py` (wire consumer into startup)

The consumer subscribes to the system bus and updates people signals in real-time:
- `comms.message_received` → update interaction counts
- `work.task_*` → note person mentions in tasks
- `people.*` → react to ontology changes

```python
from core.engine.bus.consumer import EventConsumer

class PeopleIntelligenceConsumer(EventConsumer):
    name = "people_intelligence"
    handles = ["comms.*", "work.task_*", "people.person_updated"]
    
    def process(self, event):
        # Lightweight: just update counts and flag for re-analysis
        # Don't run LLM in real-time — queue for next batch
```

- [ ] **Step 1: Write consumer**
- [ ] **Step 2: Wire into Qareen startup**
- [ ] **Step 3: Test with mock events**
- [ ] **Step 4: Commit**

### Task 6: Companion Verification Questions

**Files:**
- Create: `core/qareen/companion/people_questions.py`
- Create: API endpoint `POST /api/people/verify` and `GET /api/people/questions`
- Modify: `core/qareen/api/people.py` (add endpoints)

The companion surfaces verification questions naturally:

```python
def get_pending_questions(limit=3) -> list[dict]:
    """Get the top pending verification questions for the operator."""

def submit_answer(question_id: str, answer: str) -> dict:
    """Process an operator's answer and update the ontology.
    
    Answers cascade: "Baba is my father-in-law" implies
    Mama is mother-in-law, and their children are spouse's siblings.
    """
```

- [ ] **Step 1: Write question generator**
- [ ] **Step 2: Add API endpoints**
- [ ] **Step 3: Add frontend component (question card in People page)**
- [ ] **Step 4: Test end-to-end**
- [ ] **Step 5: Commit**

### Task 7: Refresh Pipeline

**Files:**
- Create: `core/engine/people/refresh.py`
- Create: cron entry in `config/crons.yaml`

Schedule the intelligence pipeline to run periodically:

```python
def daily_refresh():
    """Run incremental analysis on changed contacts."""
    
def weekly_deep_analysis():
    """Run full pipeline on all contacts."""
    
def on_demand_analysis(person_ids: list[str]):
    """Analyze specific people (triggered by operator or event)."""
```

Cron schedule:
- Daily 6am: `daily_refresh()` (incremental, ~5 min)
- Weekly Sunday 4am: `weekly_deep_analysis()` (full, ~30 min)

- [ ] **Step 1: Implement refresh module**
- [ ] **Step 2: Add cron config**
- [ ] **Step 3: Add API trigger endpoint `POST /api/people/analyze`**
- [ ] **Step 4: Test**
- [ ] **Step 5: Commit**

---

## Chunk 3: Frontend Integration

### Task 8: Verification UI

**Files:**
- Create: `core/qareen/screen/src/components/people/VerificationCard.tsx`
- Modify: `core/qareen/screen/src/pages/People.tsx` (add verification section)
- Modify: `core/qareen/screen/src/hooks/usePeople.ts` (add hooks)

A conversational verification card in the People page. Shows one question at a time. Operator types an answer. System processes it and moves to the next.

Design: glass pill card, warm dark background, serif text for the question, sans for the input. "I think Ahmad Ballan is your close friend and business partner. Is that right?" with a text input for corrections.

- [ ] **Step 1: Add types + hooks**
- [ ] **Step 2: Build VerificationCard component**
- [ ] **Step 3: Integrate into People.tsx feed view**
- [ ] **Step 4: Test TypeScript compilation**
- [ ] **Step 5: Commit**

### Task 9: Analysis Status Panel

**Files:**
- Create: `core/qareen/screen/src/components/people/AnalysisStatus.tsx`
- Modify: `core/qareen/screen/src/pages/People.tsx`

Shows the state of the intelligence pipeline: last analysis time, contacts analyzed, pending questions, data source coverage.

- [ ] **Step 1: Build component**
- [ ] **Step 2: Integrate**
- [ ] **Step 3: Commit**

---

## Verification

After each chunk:
- `python3 -m pytest tests/engine/people/ -v` — all tests pass
- `cd core/qareen/screen && npx tsc --noEmit` — frontend compiles
- `curl http://127.0.0.1:4096/api/health` — qareen healthy
- `python3 -c "from core.engine.people.intelligence import PeopleIntelligence; pi = PeopleIntelligence(dry_run=True); print(pi.run(limit=2))"` — pipeline runs

After full implementation:
- Run `PeopleIntelligence().run(limit=30)` on real data
- Verify circles, relationships, importance updated in DB
- Verify verification questions generated for low-confidence contacts
- Open http://localhost:5173/people and confirm:
  - Circles view shows meaningful labels (not "Work (tight, 5 members)")
  - Family tree populated from LLM-detected family relationships
  - Hygiene panel shows verification questions
  - Org chart reflects real organizations

---

## Cost Estimate

For 333 contacts with interactions:
- Signal extraction: 0 tokens (pure SQL)
- Profile building: 0 tokens (pure computation)
- Classification: ~25 API calls × ~4K tokens each = ~100K input + ~25K output tokens
- Total: ~$1-2 per full analysis pass
- Incremental daily: ~$0.10 (only changed contacts)

---

## Future Extensions (not in this plan)

- Slack integration (new channel adapter)
- LinkedIn enrichment (API integration)
- Calendar event correlation
- Financial transaction signals (Interac emails)
- Voice memo person extraction
- Cascading inference (fixing one relationship implies others)
- Machine learning on operator corrections (fine-tune classification prompts)
