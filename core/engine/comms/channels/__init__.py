"""Channel adapter auto-discovery.

Discovers all ChannelAdapter subclasses in this package automatically.
Adding a new channel = add a .py file with a ChannelAdapter subclass.
No hardcoded lists to update.
"""
from __future__ import annotations

import importlib
import logging
import pkgutil
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..channel import ChannelAdapter

log = logging.getLogger(__name__)

_discovered: dict[str, "ChannelAdapter"] | None = None


def discover_channels() -> dict[str, "ChannelAdapter"]:
    """Auto-discover and instantiate all channel adapters in this package.

    Returns {name: adapter_instance} for all adapters found.
    Import errors are logged but don't break discovery.
    """
    global _discovered
    if _discovered is not None:
        return _discovered

    from ..channel import ChannelAdapter as _Base

    _discovered = {}
    for _importer, modname, _ispkg in pkgutil.iter_modules(__path__):
        if modname.startswith("_"):
            continue
        try:
            mod = importlib.import_module(f".{modname}", __name__)
        except Exception as e:
            log.debug("Failed to import channel %s: %s", modname, e)
            continue

        for attr_name in dir(mod):
            attr = getattr(mod, attr_name)
            if (
                isinstance(attr, type)
                and issubclass(attr, _Base)
                and attr is not _Base
                and getattr(attr, "name", "")
            ):
                try:
                    instance = attr()
                    _discovered[instance.name] = instance
                except Exception as e:
                    log.debug("Failed to instantiate %s: %s", attr_name, e)

    return _discovered


def available_channels() -> dict[str, "ChannelAdapter"]:
    """Return only channels that are available on this machine."""
    return {
        name: adapter
        for name, adapter in discover_channels().items()
        if adapter.is_available()
    }


def get_channel(name: str) -> "ChannelAdapter | None":
    """Get a specific channel adapter by name."""
    return discover_channels().get(name)
