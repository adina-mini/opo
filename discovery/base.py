"""
Base adapter pattern for opportunity sources.

Every source (Remotive, Adzuna, Devpost, a curated scraper...) subclasses
BaseAdapter and implements fetch(). The rest of the system never knows
which source a listing came from — it just sees Listing objects.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from core.models import Listing


class BaseAdapter(ABC):
    """All discovery sources implement this interface."""

    #: short identifier, used for logging and dedupe fingerprints
    name: str = "base"

    @abstractmethod
    def fetch(self) -> list[Listing]:
        """Return a list of normalized Listing objects from this source."""
        raise NotImplementedError

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__} name={self.name}>"
