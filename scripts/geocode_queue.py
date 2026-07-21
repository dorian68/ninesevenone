"""Geocoding queue skeleton for BAN/Nominatim compatible providers."""

from __future__ import annotations

import time
from dataclasses import dataclass


@dataclass(frozen=True)
class GeocodingAttempt:
    query: str
    precision: str
    confidence: float
    source: str


def throttle(last_call_monotonic: float, min_delay_seconds: float) -> float:
    elapsed = time.monotonic() - last_call_monotonic
    if elapsed < min_delay_seconds:
        time.sleep(min_delay_seconds - elapsed)
    return time.monotonic()
