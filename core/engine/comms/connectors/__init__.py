"""Source Connectors — extract contact data from external sources.

Each connector scans a source (Apple Contacts, WhatsApp, iMessage,
Telegram) and returns a list of RawClaim objects. These claims are
fed into the Identity Resolution engine for deduplication and golden
record building.

Connectors are DIFFERENT from ChannelAdapters:
  - Connectors extract CONTACT data (names, phones, emails, metadata)
  - ChannelAdapters extract MESSAGES (text, timestamps, conversations)
  - Connectors output RawClaim objects
  - ChannelAdapters output Message objects

Usage:
    from core.engine.comms.connectors import ALL_CONNECTORS

    for ConnectorClass in ALL_CONNECTORS:
        connector = ConnectorClass()
        if connector.is_available():
            claims = connector.scan()
            # feed claims into Identity Resolution engine
"""

from .base import RawClaim, SourceConnector
from .apple import AppleContactsConnector
from .whatsapp import WhatsAppConnector
from .imessage import iMessageConnector
from .telegram import TelegramConnector

ALL_CONNECTORS = [
    AppleContactsConnector,
    WhatsAppConnector,
    iMessageConnector,
    TelegramConnector,
]

__all__ = [
    "SourceConnector",
    "RawClaim",
    "ALL_CONNECTORS",
    "AppleContactsConnector",
    "WhatsAppConnector",
    "iMessageConnector",
    "TelegramConnector",
]
