# People Intelligence System v2 — Implementation Plan

> **For agentic workers:** REQUIRED: If subagents are available, dispatch a fresh subagent per task with isolated context. Otherwise, use the executing-plans skill to implement this plan sequentially. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pluggable, source-adaptive intelligence system that extracts signals from every available data source on the operator's machine, compiles operator-specific classification prompts from the extracted data, classifies relationships via batched LLM calls, and continuously refines through operator corrections — working with whatever sources are available, not just a fixed set.

**Architecture:** Three-subsystem design. Subsystem A (this plan): Source Registry + Adaptive Extraction — a pluggable adapter framework where each data source is a self-describing adapter that declares its capabilities, detects availability, and extracts typed signals in a single source-first pass. Subsystem B (separate plan): Profile Compiler + Classifier — builds multi-dimensional temporal profiles from extracted signals, compiles operator-specific prompts, runs batched LLM classification. Subsystem C (separate plan): Living Intelligence Loop — event-driven continuous updates, companion-integrated verification, cascading inference, correction feedback loop.

**Tech Stack:** Python 3.9+, SQLite, `rapidfuzz`, `phonenumbers`, existing AOS system bus (`core.engine.bus`), existing people.db schema (migration 028+).

**Initiative:** standalone (People Intelligence foundation)

**Prior art in this codebase:**
- `core/engine/comms/connectors/` — existing SourceConnector ABC for CONTACT extraction. We are building a parallel but different framework for SIGNAL extraction.
- `core/engine/comms/channels/` — existing ChannelAdapter ABC for MESSAGE reading. Our signal adapters read the same databases but extract different data (response latency, time-of-day, media counts — not message bodies).
- `core/engine/people/` — existing identity resolution, hygiene, graph modules. Our signal extraction feeds INTO these.
- `core/engine/bus/` — Event/EventConsumer for system events. Used in Subsystem C.

---

## Scope

This plan covers ONLY Subsystem A: the source registry, signal type system, and adaptive extractors. It produces:
1. A registry of self-describing source adapters
2. Signal extractors for all 13 sources identified in the discovery phase
3. Source-first batch extraction (open each DB once, extract all persons)
4. A `SignalStore` that persists extracted signals for downstream use
5. A coverage report showing what data is available and what's missing

It does NOT cover: profile building, LLM classification, prompt compilation, event consumers, companion integration, or UI. Those are Subsystems B and C.

---

## Key Design Decisions

### 1. Source-first, not person-first
The extraction loop opens each database ONCE and extracts signals for ALL persons in a single pass. This avoids the O(N × sources) temp-copy problem identified in the critique.

### 2. Signal types, not source types
The profile builder (Subsystem B) never sees "iMessage data" or "WhatsApp data." It sees typed signals: `communication`, `voice`, `physical_presence`, `group_membership`, etc. Any adapter can provide any signal type. This makes the system source-agnostic at the profile layer.

### 3. Adapters are self-describing
Each adapter declares: what platform it runs on, what signal types it provides, how to detect availability, and what capabilities it has. The registry discovers adapters at runtime — no hardcoded lists.

### 4. Graceful degradation
Missing sources produce null signals, not errors. The system works with 1 source or 13. Coverage is tracked and reported so the operator (and the classifier) know what data exists.

### 5. Signals are persisted, not recomputed
Extracted signals are written to a `signal_store` table so they can be re-read without re-extracting. Signals have timestamps and can be invalidated when source data changes.

---

## File Structure

```
core/engine/people/
├── __init__.py                    (modify — add new exports)
├── normalize.py                   (existing — no changes)
├── identity.py                    (existing — no changes)
├── hygiene.py                     (existing — no changes)
├── graph.py                       (existing — no changes)
├── group_resolve.py               (existing — no changes)
├── org.py                         (existing — no changes)
│
├── intel/                         (NEW — intelligence subsystem)
│   ├── __init__.py                (package init, public API)
│   ├── registry.py                (source adapter registry + discovery)
│   ├── types.py                   (signal type definitions, PersonSignals container)
│   ├── store.py                   (signal persistence to SQLite)
│   ├── extractor.py               (orchestrator: discovers sources, runs extraction, stores results)
│   │
│   └── sources/                   (one adapter per source)
│       ├── __init__.py            (auto-discovery of adapters)
│       ├── base.py                (SignalAdapter ABC)
│       ├── apple_messages.py      (iMessage + SMS + RCS)
│       ├── whatsapp.py            (WhatsApp messages + voice notes + media + groups)
│       ├── calls.py               (Call History + FaceTime)
│       ├── apple_mail.py          (Apple Mail — headers, subjects, threads)
│       ├── apple_photos.py        (Photos — faces, co-occurrence, locations, camera source)
│       ├── apple_contacts.py      (AddressBook — metadata, related names, groups, addresses)
│       ├── telegram.py            (Telegram bridge JSONL)
│       ├── vault.py               (Vault daily logs + session exports)
│       └── work.py                (Work system — task/project person mentions)
│
core/infra/migrations/
│   └── 029_signal_store.py        (NEW — signal_store table for persistence)
```

### Why `intel/` as a subdirectory?
The existing `core/engine/people/` files (normalize, identity, hygiene, graph, org) are the ontology manipulation layer — they write to people.db tables. The `intel/` subdirectory is the intelligence layer — it reads from external sources and feeds INTO the ontology layer. Separate concerns, separate directory.

---

## Chunk 1: Foundation — Types, Registry, Base Adapter

### Task 1: Signal Type Definitions

**Files:**
- Create: `core/engine/people/intel/__init__.py`
- Create: `core/engine/people/intel/types.py`
- Test: `tests/engine/people/intel/test_types.py`

The type system defines what kinds of signals exist, independent of any source.

- [ ] **Step 1: Create test directory and write test**

```bash
mkdir -p tests/engine/people/intel
touch tests/__init__.py tests/engine/__init__.py tests/engine/people/__init__.py tests/engine/people/intel/__init__.py
```

```python
# tests/engine/people/intel/test_types.py
from core.engine.people.intel.types import (
    SignalType, SourceCapability, PersonSignals,
    CommunicationSignal, VoiceSignal, PhysicalPresenceSignal,
    ProfessionalSignal, GroupSignal, MentionSignal, MetadataSignal,
)

def test_signal_type_enum():
    assert SignalType.COMMUNICATION.value == "communication"
    assert SignalType.VOICE.value == "voice"
    assert SignalType.PHYSICAL_PRESENCE.value == "physical_presence"

def test_source_capability():
    cap = SourceCapability(
        name="apple_messages",
        platform="macos",
        signal_types=[SignalType.COMMUNICATION, SignalType.TEMPORAL],
        description="iMessage, SMS, RCS via chat.db",
    )
    assert cap.name == "apple_messages"
    assert SignalType.COMMUNICATION in cap.signal_types

def test_person_signals_merge():
    """PersonSignals from different sources can be merged."""
    s1 = PersonSignals(person_id="p_123")
    s1.communication.append(CommunicationSignal(
        source="apple_messages", channel="imessage",
        total_messages=100, sent=40, received=60,
    ))
    s2 = PersonSignals(person_id="p_123")
    s2.communication.append(CommunicationSignal(
        source="whatsapp", channel="whatsapp",
        total_messages=50, sent=20, received=30,
    ))
    merged = s1.merge(s2)
    assert len(merged.communication) == 2
    assert merged.person_id == "p_123"

def test_communication_signal_defaults():
    sig = CommunicationSignal(source="test", channel="test")
    assert sig.total_messages == 0
    assert sig.temporal_buckets == {}
    assert sig.response_latency_median is None
    assert sig.time_of_day == {}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Volumes/AOS-X/project/aos && python3 -m pytest tests/engine/people/intel/test_types.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement types.py**

```python
# core/engine/people/intel/types.py
"""Signal type definitions for People Intelligence.

Signal types are source-agnostic — they describe WHAT kind of data exists,
not WHERE it came from. Any adapter can produce any signal type.

The PersonSignals container holds all signals for a single person,
organized by type. Multiple sources contribute to the same container.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class SignalType(Enum):
    """Categories of signals about a person."""
    COMMUNICATION = "communication"      # Messages: volume, content, timing
    VOICE = "voice"                      # Calls: frequency, duration, type
    PHYSICAL_PRESENCE = "physical_presence"  # Photos: co-occurrence, locations
    PROFESSIONAL = "professional"        # Email, Slack: work context
    GROUP_MEMBERSHIP = "group_membership"  # Shared groups, channels, circles
    MENTION = "mention"                  # Referenced in notes, tasks, sessions
    METADATA = "metadata"               # Contact info richness, labels, notes


@dataclass
class SourceCapability:
    """Describes what a source adapter provides."""
    name: str                            # "apple_messages", "whatsapp", etc.
    platform: str = "any"                # "macos", "android", "web", "any"
    signal_types: list[SignalType] = field(default_factory=list)
    description: str = ""
    requires: list[str] = field(default_factory=list)  # ["file:path", "oauth:google", etc.]


# ── Signal dataclasses ──────────────────────────────────────────

@dataclass
class CommunicationSignal:
    """Message-based communication signal from any channel."""
    source: str                          # adapter name
    channel: str                         # "imessage", "whatsapp", "slack", "sms"
    total_messages: int = 0
    sent: int = 0
    received: int = 0
    first_message_date: str | None = None  # ISO 8601
    last_message_date: str | None = None
    temporal_buckets: dict[str, int] = field(default_factory=dict)  # YYYY-MM: count
    temporal_pattern: str = "none"       # consistent, episodic, growing, fading, clustered, one_shot
    avg_message_length: float = 0
    # NEW signals from critique
    response_latency_median: float | None = None  # minutes
    response_latency_avg: float | None = None
    time_of_day: dict[int, int] = field(default_factory=dict)  # hour(0-23): count
    late_night_pct: float = 0            # 22:00-05:00
    business_hours_pct: float = 0        # 09:00-17:00
    evening_pct: float = 0              # 17:00-22:00
    # Media signals
    voice_notes_sent: int = 0
    voice_notes_received: int = 0
    media_sent: int = 0                  # photos, videos, docs
    media_received: int = 0
    links_shared: int = 0
    reactions_given: int = 0
    reactions_received: int = 0
    # Service type (iMessage specific)
    service_breakdown: dict[str, int] = field(default_factory=dict)  # {"iMessage": N, "SMS": N}
    # Samples for LLM digest
    sample_messages: list[dict] = field(default_factory=list)  # [{text, date, direction, channel}]


@dataclass
class VoiceSignal:
    """Phone/video call signal."""
    source: str
    total_calls: int = 0
    answered_calls: int = 0
    missed_calls: int = 0
    total_minutes: float = 0
    avg_duration_minutes: float = 0
    max_duration_minutes: float = 0
    outgoing: int = 0
    incoming: int = 0
    first_call_date: str | None = None
    last_call_date: str | None = None
    temporal_buckets: dict[str, int] = field(default_factory=dict)
    temporal_pattern: str = "none"
    time_of_day: dict[int, int] = field(default_factory=dict)
    # Call type breakdown
    phone_calls: int = 0
    facetime_audio: int = 0
    facetime_video: int = 0
    answer_rate: float = 0               # answered / total


@dataclass
class PhysicalPresenceSignal:
    """Photo co-occurrence signal."""
    source: str
    total_photos: int = 0
    verified: bool = False               # user-confirmed in Photos
    first_photo_date: str | None = None
    last_photo_date: str | None = None
    temporal_buckets: dict[str, int] = field(default_factory=dict)
    temporal_pattern: str = "none"
    # Locations
    locations: list[dict] = field(default_factory=list)  # [{lat, lon, count}]
    home_location_photos: int = 0        # photos at operator's home
    # Co-occurrence
    co_photographed_with: list[dict] = field(default_factory=list)  # [{name, shared_photos}]
    # Camera source
    operator_taken_pct: float = 0        # my_camera / total
    received_pct: float = 0             # via messaging/airdrop / total
    # Age/gender from Photos ML
    detected_age_type: int | None = None  # 2=child, 3=young adult, 5=senior
    detected_gender: int | None = None    # 1=male, 2=female


@dataclass
class ProfessionalSignal:
    """Professional/work context signal (email, Slack, etc.)."""
    source: str
    total_emails: int = 0
    sent_to_you: int = 0
    you_sent: int = 0
    first_date: str | None = None
    last_date: str | None = None
    temporal_buckets: dict[str, int] = field(default_factory=dict)
    temporal_pattern: str = "none"
    bidirectional_ratio: float = 0       # 0.5 = balanced, 1.0 = all inbound
    # Subject analysis
    subject_keywords: list[str] = field(default_factory=list)  # top keywords from subjects
    subject_categories: dict[str, int] = field(default_factory=dict)  # {transactional: N, personal: N, professional: N}
    thread_count: int = 0
    avg_thread_depth: float = 0
    max_thread_depth: int = 0


@dataclass
class GroupSignal:
    """Group/channel co-membership signal."""
    source: str
    groups: list[dict] = field(default_factory=list)  # [{name, type, member_count, role}]
    total_groups: int = 0
    # Co-membership with operator
    shared_with_operator: int = 0
    # Group keyword categories
    group_categories: dict[str, int] = field(default_factory=dict)  # {religious: N, family: N, work: N}


@dataclass
class MentionSignal:
    """Person mentioned in notes, tasks, sessions."""
    source: str
    total_mentions: int = 0
    mention_contexts: list[dict] = field(default_factory=list)  # [{file, snippet, date}]
    # By sub-source
    daily_log_mentions: int = 0
    session_mentions: int = 0
    work_task_mentions: int = 0


@dataclass
class MetadataSignal:
    """Contact metadata richness signal."""
    source: str
    has_birthday: bool = False
    birthday: str | None = None          # YYYY-MM-DD
    has_address: bool = False
    addresses: list[dict] = field(default_factory=list)  # [{city, country}]
    has_notes: bool = False
    notes_snippet: str | None = None
    has_social_profiles: bool = False
    social_profiles: list[dict] = field(default_factory=list)  # [{platform, handle}]
    has_related_names: bool = False
    related_names: list[dict] = field(default_factory=list)  # [{label, name}] e.g. [{"label": "sister", "name": "Tamia"}]
    has_urls: bool = False
    urls: list[str] = field(default_factory=list)
    contact_groups: list[str] = field(default_factory=list)  # Apple Contact groups: ["Family", "Islamabad"]
    organization_raw: str | None = None  # raw org field (might be city/tag)
    job_title: str | None = None
    contact_created_at: str | None = None
    richness_score: int = 0              # count of non-empty fields


# ── Container ───────────────────────────────────────────────────

@dataclass
class PersonSignals:
    """All signals for a single person, from all sources."""
    person_id: str
    person_name: str = ""
    extracted_at: str | None = None      # ISO timestamp of last extraction
    source_coverage: list[str] = field(default_factory=list)  # which adapters contributed

    communication: list[CommunicationSignal] = field(default_factory=list)
    voice: list[VoiceSignal] = field(default_factory=list)
    physical_presence: list[PhysicalPresenceSignal] = field(default_factory=list)
    professional: list[ProfessionalSignal] = field(default_factory=list)
    group_membership: list[GroupSignal] = field(default_factory=list)
    mentions: list[MentionSignal] = field(default_factory=list)
    metadata: list[MetadataSignal] = field(default_factory=list)

    def merge(self, other: PersonSignals) -> PersonSignals:
        """Merge signals from another PersonSignals (same person, different sources)."""
        assert self.person_id == other.person_id
        merged = PersonSignals(
            person_id=self.person_id,
            person_name=self.person_name or other.person_name,
            source_coverage=list(set(self.source_coverage + other.source_coverage)),
        )
        merged.communication = self.communication + other.communication
        merged.voice = self.voice + other.voice
        merged.physical_presence = self.physical_presence + other.physical_presence
        merged.professional = self.professional + other.professional
        merged.group_membership = self.group_membership + other.group_membership
        merged.mentions = self.mentions + other.mentions
        merged.metadata = self.metadata + other.metadata
        return merged

    # ── Computed properties for quick access ──

    @property
    def total_messages(self) -> int:
        return sum(c.total_messages for c in self.communication)

    @property
    def total_calls(self) -> int:
        return sum(v.total_calls for v in self.voice)

    @property
    def total_photos(self) -> int:
        return sum(p.total_photos for p in self.physical_presence)

    @property
    def total_emails(self) -> int:
        return sum(p.total_emails for p in self.professional)

    @property
    def channels_active(self) -> list[str]:
        channels = [c.channel for c in self.communication if c.total_messages > 0]
        if self.total_calls > 0:
            channels.append("phone")
        if self.total_photos > 0:
            channels.append("photos")
        if self.total_emails > 0:
            channels.append("email")
        return channels

    @property
    def channel_count(self) -> int:
        return len(self.channels_active)

    @property
    def is_multi_channel(self) -> bool:
        return self.channel_count >= 3
```

- [ ] **Step 4: Create package init**

```python
# core/engine/people/intel/__init__.py
"""People Intelligence — signal extraction, profile building, classification.

Subsystem A: Source Registry + Adaptive Extraction
Subsystem B: Profile Compiler + Classifier (separate plan)
Subsystem C: Living Intelligence Loop (separate plan)
"""
from .types import (
    SignalType, SourceCapability, PersonSignals,
    CommunicationSignal, VoiceSignal, PhysicalPresenceSignal,
    ProfessionalSignal, GroupSignal, MentionSignal, MetadataSignal,
)

__all__ = [
    "SignalType", "SourceCapability", "PersonSignals",
    "CommunicationSignal", "VoiceSignal", "PhysicalPresenceSignal",
    "ProfessionalSignal", "GroupSignal", "MentionSignal", "MetadataSignal",
]
```

- [ ] **Step 5: Run tests, verify pass**

Run: `cd /Volumes/AOS-X/project/aos && python3 -m pytest tests/engine/people/intel/test_types.py -v`

- [ ] **Step 6: Commit**

```bash
git add core/engine/people/intel/ tests/engine/people/intel/
git commit -m "feat(intel): signal type system — source-agnostic typed signals for people intelligence"
```

---

### Task 2: Signal Adapter Base Class + Registry

**Files:**
- Create: `core/engine/people/intel/sources/__init__.py`
- Create: `core/engine/people/intel/sources/base.py`
- Create: `core/engine/people/intel/registry.py`
- Test: `tests/engine/people/intel/test_registry.py`

The adapter ABC defines the contract. The registry discovers and manages adapters.

- [ ] **Step 1: Write test for adapter and registry**

```python
# tests/engine/people/intel/test_registry.py
from core.engine.people.intel.sources.base import SignalAdapter
from core.engine.people.intel.registry import AdapterRegistry
from core.engine.people.intel.types import SignalType, PersonSignals

class MockAdapter(SignalAdapter):
    name = "mock_source"
    platform = "any"
    signal_types = [SignalType.COMMUNICATION]
    description = "Test adapter"

    def detect(self) -> bool:
        return True

    def extract_all(self, person_index: dict) -> dict[str, PersonSignals]:
        return {}

def test_registry_discovers_adapters():
    reg = AdapterRegistry()
    reg.register(MockAdapter)
    assert "mock_source" in reg.available()

def test_registry_skips_unavailable():
    class UnavailableAdapter(SignalAdapter):
        name = "unavailable"
        platform = "any"
        signal_types = [SignalType.COMMUNICATION]
        def detect(self) -> bool:
            return False
        def extract_all(self, person_index):
            return {}

    reg = AdapterRegistry()
    reg.register(UnavailableAdapter)
    assert "unavailable" not in reg.available()
    assert "unavailable" in reg.all_adapters()

def test_registry_coverage_report():
    reg = AdapterRegistry()
    reg.register(MockAdapter)
    report = reg.coverage_report()
    assert report["available_count"] >= 1
    assert SignalType.COMMUNICATION in report["signal_types_covered"]
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement base.py**

```python
# core/engine/people/intel/sources/base.py
"""Signal Adapter base class.

Every data source implements this interface. Adapters are self-describing:
they declare what platform they run on, what signal types they provide,
how to detect availability, and how to extract signals.

Key design: extract_all() receives a person_index (person_id → identifiers)
and returns signals for ALL persons in one pass. This is source-first,
not person-first — each database is opened once.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import ClassVar

from ..types import SignalType, PersonSignals


class SignalAdapter(ABC):
    """Base class for all signal source adapters.

    Subclasses must set class attributes and implement detect() + extract_all().

    Class attributes:
        name:         Unique adapter identifier ("apple_messages", "whatsapp", etc.)
        platform:     Target platform ("macos", "android", "web", "any")
        signal_types: List of SignalType enums this adapter provides
        description:  Human-readable description
        requires:     List of requirements (["file:~/Library/Messages/chat.db", "oauth:google"])
    """

    name: ClassVar[str] = ""
    platform: ClassVar[str] = "any"
    signal_types: ClassVar[list[SignalType]] = []
    description: ClassVar[str] = ""
    requires: ClassVar[list[str]] = []

    @abstractmethod
    def detect(self) -> bool:
        """Check if this source is available on this machine.

        Should be fast — check file existence, not full DB connectivity.
        Returns True if extract_all() is likely to succeed.
        """
        ...

    @abstractmethod
    def extract_all(self, person_index: dict[str, dict]) -> dict[str, PersonSignals]:
        """Extract signals for ALL persons in one pass.

        Args:
            person_index: {person_id: {"name": str, "phones": [str], "emails": [str], "wa_jids": [str]}}
                          Built from people.db by the extractor orchestrator.

        Returns:
            {person_id: PersonSignals} for every person where signals were found.
            Missing persons are simply absent from the dict (not null).

        Implementation notes:
            - Open the source database ONCE at the start
            - Build internal lookup structures (phone → person_id, email → person_id)
            - Iterate source records and match to persons
            - Close/cleanup at the end
            - Copy external databases to temp before reading (avoid locking)
        """
        ...

    def health(self) -> dict:
        """Optional health check with details."""
        return {
            "name": self.name,
            "available": self.detect(),
            "platform": self.platform,
            "signal_types": [s.value for s in self.signal_types],
        }
```

- [ ] **Step 4: Implement registry.py**

```python
# core/engine/people/intel/registry.py
"""Adapter Registry — discovers and manages signal source adapters.

The registry holds all known adapters and can report which are available,
what signal types are covered, and what's missing. It does NOT run extraction —
that's the extractor's job. The registry just manages the catalog.
"""
from __future__ import annotations

import logging
from typing import Type

from .types import SignalType, SourceCapability
from .sources.base import SignalAdapter

log = logging.getLogger(__name__)


class AdapterRegistry:
    """Registry of signal source adapters."""

    def __init__(self):
        self._adapters: dict[str, Type[SignalAdapter]] = {}
        self._availability_cache: dict[str, bool] = {}

    def register(self, adapter_cls: Type[SignalAdapter]) -> None:
        """Register an adapter class."""
        self._adapters[adapter_cls.name] = adapter_cls

    def discover(self) -> None:
        """Auto-discover adapters from the sources package.

        Imports all modules in core.engine.people.intel.sources and
        registers any SignalAdapter subclasses found.
        """
        from . import sources as sources_pkg
        import importlib
        import pkgutil

        for importer, modname, ispkg in pkgutil.iter_modules(sources_pkg.__path__):
            if modname == "base":
                continue
            try:
                mod = importlib.import_module(f".{modname}", sources_pkg.__name__)
                for attr_name in dir(mod):
                    attr = getattr(mod, attr_name)
                    if (isinstance(attr, type)
                            and issubclass(attr, SignalAdapter)
                            and attr is not SignalAdapter
                            and attr.name):
                        self.register(attr)
            except Exception as e:
                log.warning("Failed to load adapter module %s: %s", modname, e)

    def _check_availability(self, name: str) -> bool:
        """Check if an adapter is available (cached)."""
        if name not in self._availability_cache:
            cls = self._adapters.get(name)
            if cls:
                try:
                    self._availability_cache[name] = cls().detect()
                except Exception:
                    self._availability_cache[name] = False
            else:
                self._availability_cache[name] = False
        return self._availability_cache[name]

    def available(self) -> list[str]:
        """Return names of adapters that are available on this machine."""
        return [name for name in self._adapters if self._check_availability(name)]

    def all_adapters(self) -> list[str]:
        """Return names of all registered adapters (available or not)."""
        return list(self._adapters.keys())

    def get(self, name: str) -> SignalAdapter | None:
        """Instantiate and return an adapter by name. Returns None if not found."""
        cls = self._adapters.get(name)
        return cls() if cls else None

    def coverage_report(self) -> dict:
        """Report what signal types are covered by available adapters."""
        available = self.available()
        all_names = self.all_adapters()

        covered_types: set[SignalType] = set()
        missing_types: set[SignalType] = set(SignalType)

        available_details = []
        unavailable_details = []

        for name in all_names:
            cls = self._adapters[name]
            is_avail = name in available
            detail = {
                "name": name,
                "platform": cls.platform,
                "signal_types": [s.value for s in cls.signal_types],
                "description": cls.description,
                "available": is_avail,
            }
            if is_avail:
                available_details.append(detail)
                covered_types.update(cls.signal_types)
            else:
                unavailable_details.append(detail)

        missing_types -= covered_types

        return {
            "available_count": len(available),
            "total_count": len(all_names),
            "coverage_pct": len(available) / max(1, len(all_names)),
            "signal_types_covered": list(covered_types),
            "signal_types_missing": list(missing_types),
            "available": available_details,
            "unavailable": unavailable_details,
        }

    def invalidate_cache(self) -> None:
        """Clear availability cache (e.g., after new source connected)."""
        self._availability_cache.clear()
```

- [ ] **Step 5: Create sources/__init__.py**

```python
# core/engine/people/intel/sources/__init__.py
"""Signal source adapters.

Each module in this package defines one SignalAdapter subclass.
The AdapterRegistry.discover() method auto-imports all modules here.
"""
```

- [ ] **Step 6: Run tests, verify pass**

- [ ] **Step 7: Commit**

```bash
git add core/engine/people/intel/sources/ core/engine/people/intel/registry.py tests/
git commit -m "feat(intel): adapter base class + registry with auto-discovery"
```

---

### Task 3: Signal Store (Persistence)

**Files:**
- Create: `core/engine/people/intel/store.py`
- Create: `core/infra/migrations/029_signal_store.py`
- Test: `tests/engine/people/intel/test_store.py`

Signals are persisted to a `signal_store` table in people.db so they don't need to be re-extracted every time. Each row is one person × one source, containing JSON-serialized signals.

- [ ] **Step 1: Write test**

```python
# tests/engine/people/intel/test_store.py
import sqlite3
import tempfile
from core.engine.people.intel.store import SignalStore
from core.engine.people.intel.types import PersonSignals, CommunicationSignal

def test_store_and_retrieve():
    db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    db.close()
    store = SignalStore(db.name)
    store.init_schema()

    signals = PersonSignals(person_id="p_test")
    signals.communication.append(CommunicationSignal(
        source="test", channel="test", total_messages=42,
    ))
    signals.source_coverage = ["test"]

    store.save("p_test", "test", signals)
    loaded = store.load("p_test")

    assert loaded is not None
    assert loaded.person_id == "p_test"
    assert len(loaded.communication) == 1
    assert loaded.communication[0].total_messages == 42

def test_store_multiple_sources():
    db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    db.close()
    store = SignalStore(db.name)
    store.init_schema()

    s1 = PersonSignals(person_id="p_test", source_coverage=["src1"])
    s1.communication.append(CommunicationSignal(source="src1", channel="wa", total_messages=10))

    s2 = PersonSignals(person_id="p_test", source_coverage=["src2"])
    s2.communication.append(CommunicationSignal(source="src2", channel="im", total_messages=20))

    store.save("p_test", "src1", s1)
    store.save("p_test", "src2", s2)

    loaded = store.load("p_test")
    assert len(loaded.communication) == 2
    assert loaded.total_messages == 30
```

- [ ] **Step 2: Implement store.py**

SignalStore serializes PersonSignals to JSON and stores in `signal_store(person_id, source_name, signals_json, extracted_at)`. On load, it merges all source rows for a person into one PersonSignals via `.merge()`.

The migration `029_signal_store.py` creates the table using the standard `check()/up()` pattern:
```sql
CREATE TABLE IF NOT EXISTS signal_store (
    person_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    signals_json TEXT NOT NULL,
    extracted_at INTEGER NOT NULL,
    PRIMARY KEY (person_id, source_name)
);
CREATE INDEX IF NOT EXISTS idx_signal_store_person ON signal_store(person_id);
CREATE INDEX IF NOT EXISTS idx_signal_store_source ON signal_store(source_name);
```

- [ ] **Step 3: Run tests, commit**

---

## Chunk 2: Source Adapters (the 10 extractors)

Each task creates one adapter. All adapters follow the same pattern:
1. `detect()` — check if source database/file exists
2. `extract_all(person_index)` — open source once, extract all persons, return dict
3. Copy external DBs to temp before reading
4. Match source records to person_index via phone/email/JID lookup tables built at start

The adapters implement the signals we validated with the 7 extraction agents earlier today. Each adapter produces typed signals (CommunicationSignal, VoiceSignal, etc.) not raw dicts.

### Task 4: Apple Messages Adapter (iMessage + SMS + RCS)

**Files:**
- Create: `core/engine/people/intel/sources/apple_messages.py`
- Test: `tests/engine/people/intel/test_apple_messages.py`

**Signals produced:** CommunicationSignal with:
- Total messages, sent/received, first/last dates, temporal buckets+pattern
- Response latency (median, avg) — computed from direction-change pairs
- Time-of-day distribution (hourly buckets, late_night/business/evening percentages)
- Tapbacks given/received (from associated_message_type)
- Attachments by type (via message_attachment_join + attachment.mime_type)
- Shared links (count messages containing http)
- Service breakdown (iMessage vs SMS vs RCS)

**Source:** `~/Library/Messages/chat.db` (copy to temp)
**Timestamps:** nanoseconds since 2001-01-01 (divide by 1e9, add 978307200)
**Matching:** Build phone_suffix → person_id and email → person_id lookup from person_index. Match against `handle.id`.

Implementation must handle:
- Multiple handles per person (phone + email)
- The chat_handle_join → chat_message_join → message join path
- DISTINCT on messages (same message can appear via multiple handle joins)

- [ ] Steps: write test → implement → run → commit

### Task 5: WhatsApp Adapter

**Files:**
- Create: `core/engine/people/intel/sources/whatsapp.py`
- Test: `tests/engine/people/intel/test_whatsapp.py`

**Signals produced:** CommunicationSignal + GroupSignal
- Messages: total, sent/received, temporal, response latency, time-of-day
- Voice notes: count sent/received (ZMESSAGETYPE = 2)
- Media: count by type (1=image, 2=video, 3=voice, 7=link, 8=doc, 15=sticker)
- Links shared (type 7 or text containing http)
- Groups: list of groups with member counts, co-membership with operator
- Group keyword classification (religious/family/work/social from group name)

**Source:** `~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite`
**Timestamps:** Apple epoch (seconds since 2001, add 978307200)
**Matching:** wa_jid → person_id from person_index. Also extract phone from JID suffix for cross-matching.

Note: Reactions table does not exist in this WhatsApp DB version (confirmed by extraction agent). Skip reaction extraction.

- [ ] Steps: write test → implement → run → commit

### Task 6: Call History Adapter (Phone + FaceTime)

**Files:**
- Create: `core/engine/people/intel/sources/calls.py`
- Test: `tests/engine/people/intel/test_calls.py`

**Signals produced:** VoiceSignal
- Total/answered/missed calls, duration, direction, temporal, time-of-day
- Call type breakdown: phone (ZCALLTYPE=1), FaceTime Audio (8), FaceTime Video (16)
- Answer rate
- Multi-handle merging (phone + email FaceTime for same person)

**Source:** `~/Library/Application Support/CallHistoryDB/CallHistory.storedata` (read directly, small DB)
**Timestamps:** Core Data (seconds since 2001-01-01, add 978307200)
**Matching:** phone_suffix → person_id AND email → person_id (for FaceTime handles)

FaceTime DB at `~/Library/Application Support/FaceTime/FaceTime.sqlite3` is empty — skip it.

- [ ] Steps: write test → implement → run → commit

### Task 7: Apple Mail Adapter

**Files:**
- Create: `core/engine/people/intel/sources/apple_mail.py`
- Test: `tests/engine/people/intel/test_apple_mail.py`

**Signals produced:** ProfessionalSignal
- Total emails, bidirectional split, temporal, thread depth
- Subject line keyword extraction + categorization (transactional/personal/professional/automated)
- Filter automated senders (noreply, notification, etc.) into separate signal
- Bidirectional ratio (balanced = active correspondence, skewed = newsletter)

**Source:** `~/Library/Mail/V*/MailData/Envelope Index` (glob for correct version)
**Matching:** email → person_id from person_index

Note: Email-only ≠ professional. The prompt compiler (Subsystem B) handles interpretation. This adapter just extracts raw signals.

- [ ] Steps: write test → implement → run → commit

### Task 8: Apple Photos Adapter

**Files:**
- Create: `core/engine/people/intel/sources/apple_photos.py`
- Test: `tests/engine/people/intel/test_apple_photos.py`

**Signals produced:** PhysicalPresenceSignal
- Face count, verified status, temporal pattern, first/last dates
- Location clusters (rounded to 0.01° ≈ 1km)
- Home location detection (most common cluster for operator's ZPERSON)
- Co-photographed-with graph (self-join ZDETECTEDFACE on ZASSETFORFACE, LIMIT to ZFACECOUNT >= 10)
- Camera source analysis (ZIMPORTEDBYBUNDLEIDENTIFIER: com.apple.camera = operator-taken, WhatsApp/iMessage = received)
- Detected age type and gender from ZPERSON

**Source:** `~/Pictures/Photos Library.photoslibrary/database/Photos.sqlite` (copy to temp)
**Matching:** Match ZPERSON.ZDISPLAYNAME/ZFULLNAME to person_index names (fuzzy, first name priority)

Performance note: co-occurrence query is O(n²). Limit to persons with ZFACECOUNT >= 10. Add timeout.

- [ ] Steps: write test → implement → run → commit

### Task 9: Apple Contacts Adapter

**Files:**
- Create: `core/engine/people/intel/sources/apple_contacts.py`
- Test: `tests/engine/people/intel/test_apple_contacts.py`

**Signals produced:** MetadataSignal + GroupSignal (for Apple Contact groups)
- Birthday, physical addresses, notes, social profiles, URLs
- Related Names (ZABCDRELATEDNAME — even if sparse, critical when present)
- Contact groups (ZABCDGROUP → Z_22PARENTGROUPS membership)
- Organization field (raw — may be city/tag, not company)
- Contact creation date
- Richness score (count of non-empty fields)

**Source:** `~/Library/Application Support/AddressBook/Sources/*/AddressBook-v22.abcddb` (glob, pick richest)
**Matching:** Match by name to person_index, or by phone number from ZABCDPHONENUMBER

- [ ] Steps: write test → implement → run → commit

### Task 10: Telegram Adapter

**Files:**
- Create: `core/engine/people/intel/sources/telegram.py`
- Test: `tests/engine/people/intel/test_telegram.py`

**Signals produced:** CommunicationSignal (when interpersonal messages exist)

**Source:** `~/.aos/data/telegram-messages.jsonl`
**Note:** Currently contains only operator-to-bridge messages (20 msgs, no interpersonal data). The adapter should still be implemented as the bridge may accumulate third-party messages over time. Returns empty signals if no interpersonal data found.

- [ ] Steps: write test → implement → run → commit

### Task 11: Vault + Sessions Adapter

**Files:**
- Create: `core/engine/people/intel/sources/vault.py`
- Test: `tests/engine/people/intel/test_vault.py`

**Signals produced:** MentionSignal
- Scan daily logs (`~/vault/log/202*.md`) and session exports (`~/vault/log/sessions/*.md`)
- Match person names with word boundaries, case-insensitive
- Filter: skip terms < 4 chars, skip common English words, skip YAML frontmatter
- Capture context snippet (100 chars around match)
- Separate counts: daily_log_mentions, session_mentions

**Performance:** scan last 90 days of daily logs, last 50 session exports. Not full history.

- [ ] Steps: write test → implement → run → commit

### Task 12: Work System Adapter

**Files:**
- Create: `core/engine/people/intel/sources/work.py`
- Test: `tests/engine/people/intel/test_work.py`

**Signals produced:** MentionSignal
- Search task titles and descriptions in `~/.aos/data/qareen.db` for person name mentions
- Search project names, handoff context
- Separate count: work_task_mentions

**Note:** The work system is project-centric, not people-centric. Expect low signal density. Still worth extracting for cross-reference.

- [ ] Steps: write test → implement → run → commit

---

## Chunk 3: Extractor Orchestrator + Coverage Report

### Task 13: Extractor Orchestrator

**Files:**
- Create: `core/engine/people/intel/extractor.py`
- Test: `tests/engine/people/intel/test_extractor.py`

The orchestrator ties everything together:
1. Builds the person_index from people.db (all persons + their identifiers)
2. Discovers available adapters via the registry
3. Runs each adapter's `extract_all()` in sequence
4. Merges per-source PersonSignals into combined signals per person
5. Persists to SignalStore
6. Returns a summary report

```python
# core/engine/people/intel/extractor.py
class SignalExtractor:
    """Orchestrates signal extraction across all available sources."""

    def __init__(self, db_path: str | None = None):
        self.registry = AdapterRegistry()
        self.registry.discover()
        self.store = SignalStore(db_path)

    def build_person_index(self) -> dict[str, dict]:
        """Build {person_id: {name, phones, emails, wa_jids}} from people.db."""
        ...

    def run(self, person_ids: list[str] | None = None) -> dict:
        """Run full extraction across all available sources.

        Args:
            person_ids: Optional subset of persons to extract. None = all.

        Returns:
            {
                "persons_extracted": int,
                "sources_used": list[str],
                "sources_skipped": list[str],
                "coverage": {...},
                "duration_seconds": float,
            }
        """
        index = self.build_person_index()
        if person_ids:
            index = {pid: idx for pid, idx in index.items() if pid in person_ids}

        results: dict[str, PersonSignals] = {}

        for adapter_name in self.registry.available():
            adapter = self.registry.get(adapter_name)
            if not adapter:
                continue
            try:
                source_signals = adapter.extract_all(index)
                for person_id, signals in source_signals.items():
                    if person_id in results:
                        results[person_id] = results[person_id].merge(signals)
                    else:
                        results[person_id] = signals
                    # Persist per-source
                    self.store.save(person_id, adapter_name, signals)
            except Exception as e:
                log.error("Adapter %s failed: %s", adapter_name, e)

        return {
            "persons_extracted": len(results),
            "sources_used": self.registry.available(),
            ...
        }

    def coverage_report(self) -> dict:
        """What data sources are available and what signal types they cover."""
        return self.registry.coverage_report()
```

- [ ] **Step 1: Write integration test**

```python
def test_extractor_runs_on_real_data():
    """Run extraction on real data (skip if no people.db)."""
    from pathlib import Path
    import pytest
    if not (Path.home() / ".aos/data/people.db").exists():
        pytest.skip("No people.db")

    extractor = SignalExtractor()
    report = extractor.coverage_report()
    assert report["available_count"] >= 1

    # Extract for just 2 people
    index = extractor.build_person_index()
    top_2 = list(index.keys())[:2]
    result = extractor.run(person_ids=top_2)
    assert result["persons_extracted"] <= 2
```

- [ ] **Step 2: Implement, run, commit**

### Task 14: CLI Runner + API Endpoint

**Files:**
- Create: `core/engine/people/intel/cli.py` (standalone CLI for running extraction)
- Modify: `core/qareen/api/people.py` (add `POST /api/people/extract` and `GET /api/people/coverage`)

The CLI allows running extraction from the terminal:
```bash
python3 -m core.engine.people.intel.cli extract --limit 50
python3 -m core.engine.people.intel.cli coverage
python3 -m core.engine.people.intel.cli extract --person p_xyz123
```

The API endpoint allows triggering from the UI:
```
POST /api/people/extract          — run extraction (optional: person_ids, limit)
GET  /api/people/coverage         — source coverage report
GET  /api/people/{id}/signals     — retrieved stored signals for a person
```

- [ ] Steps: implement CLI → implement API endpoints → test → commit

---

## Verification

After all tasks complete:

```bash
# 1. Run all tests
cd /Volumes/AOS-X/project/aos
python3 -m pytest tests/engine/people/intel/ -v

# 2. Check adapter discovery
python3 -c "
from core.engine.people.intel.registry import AdapterRegistry
reg = AdapterRegistry()
reg.discover()
report = reg.coverage_report()
print(f'Available: {report[\"available_count\"]}/{report[\"total_count\"]}')
for a in report['available']:
    print(f'  ✓ {a[\"name\"]}: {a[\"signal_types\"]}')
for a in report['unavailable']:
    print(f'  ✗ {a[\"name\"]}: {a[\"description\"]}')
"

# 3. Run extraction on top 10 contacts
python3 -m core.engine.people.intel.cli extract --limit 10

# 4. Verify stored signals
python3 -c "
from core.engine.people.intel.store import SignalStore
store = SignalStore()
# Load signals for a known active person
signals = store.load('p_0osxxwtd')  # operator's own person_id
print(f'Sources: {signals.source_coverage}')
print(f'Messages: {signals.total_messages}')
print(f'Calls: {signals.total_calls}')
print(f'Photos: {signals.total_photos}')
print(f'Channels: {signals.channels_active}')
"

# 5. TypeScript check (API changes)
cd core/qareen/screen && npx tsc --noEmit

# 6. API health
curl -s http://127.0.0.1:4096/api/health | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])"
curl -s http://127.0.0.1:4096/api/people/coverage | python3 -m json.tool | head -20
```

---

## What This Enables (Subsystem B and C)

With Subsystem A complete, downstream systems get:

1. **PersonSignals** objects with typed, source-agnostic signals for every contact
2. **Coverage report** showing what data exists and what's missing
3. **Persisted signals** that don't require re-extraction
4. **Pluggable adapters** — adding Slack, Google Calendar, LinkedIn later is just a new file in `sources/`
5. **Adaptive extraction** — works with 1 source or 13, degrades gracefully

Subsystem B (Profile Compiler + Classifier) reads PersonSignals from the store and:
- Builds the prompt from coverage + operator context
- Batches profiles to Claude for classification
- Writes results to ontology tables

Subsystem C (Living Intelligence Loop) subscribes to the system bus and:
- Flags persons for re-extraction when new data arrives
- Surfaces verification questions through the companion
- Processes operator corrections and cascades inferences
