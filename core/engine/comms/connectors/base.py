"""Source Connector base class and RawClaim dataclass.

Source Connectors extract CONTACT data (names, phones, emails, metadata)
from external sources. They are distinct from ChannelAdapters, which
extract MESSAGES.

Each connector scans a source and returns a list of RawClaim objects.
These claims are fed into the Identity Resolution engine for deduplication
and golden record building. Multiple claims may refer to the same person;
the resolver handles merging.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class RawClaim:
    """A raw contact claim from a source connector.

    Multiple claims may refer to the same person. The Identity Resolution
    engine deduplicates and merges claims into golden records.

    Fields:
        source:       Connector name ("apple_contacts", "whatsapp", etc.)
        source_id:    Unique ID within the source (e.g., AddressBook Z_PK, WA JID)
        name:         Full display name
        first_name:   Given name
        last_name:    Family name
        nickname:     Short name / alias
        phones:       Phone numbers (raw format from source)
        emails:       Email addresses
        wa_jids:      WhatsApp JIDs (user@s.whatsapp.net)
        telegram_ids: Telegram user IDs (numeric strings)
        organization: Company / org name
        job_title:    Role / title
        city:         City from address
        country:      Country from address
        birthday:     Date of birth as YYYY-MM-DD string
        metadata:     Source-specific structured data (labels, types, etc.)
        raw:          Original record for debugging / reprocessing
    """

    source: str
    source_id: str
    name: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    nickname: str | None = None
    phones: list[str] = field(default_factory=list)
    emails: list[str] = field(default_factory=list)
    wa_jids: list[str] = field(default_factory=list)
    telegram_ids: list[str] = field(default_factory=list)
    organization: str | None = None
    job_title: str | None = None
    city: str | None = None
    country: str | None = None
    birthday: str | None = None  # YYYY-MM-DD
    metadata: dict = field(default_factory=dict)
    raw: dict = field(default_factory=dict)


class SourceConnector(ABC):
    """Base class for contact source connectors.

    Each connector knows how to read a specific data source (macOS Contacts,
    WhatsApp, iMessage, Telegram) and return normalized RawClaim objects.

    Attributes:
        name:         Machine identifier ("apple_contacts", "whatsapp", etc.)
        display_name: Human-readable name for UI
        priority:     Trust weight for golden record building (higher = more trusted).
                      Range 0-100. The user's own address book scores highest.
    """

    name: str = ""
    display_name: str = ""
    priority: int = 50

    @abstractmethod
    def is_available(self) -> bool:
        """Check if this source is accessible on this machine.

        Returns True if the underlying database or file exists and is readable.
        Should never raise -- return False on any error.
        """
        ...

    @abstractmethod
    def scan(self) -> list[RawClaim]:
        """Scan the source and return all contact claims.

        Performs a full read of the source. For large sources, prefer
        scan_incremental() when the caller has a last-sync timestamp.

        Returns an empty list if the source is unavailable or empty.
        """
        ...

    def scan_incremental(self, since_ts: int = 0) -> list[RawClaim]:
        """Scan only contacts modified since the given Unix timestamp.

        Falls back to full scan if the source doesn't support incremental
        reads. Subclasses should override this when the source tracks
        modification times.

        Args:
            since_ts: Unix timestamp. 0 means full scan.
        """
        return self.scan()
