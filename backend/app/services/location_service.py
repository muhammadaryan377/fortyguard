"""U.S. location search/reverse lookup for HeatShield product workflows.

OpenStreetMap/Nominatim is used only to resolve human-friendly place metadata.
Thermal evidence still comes exclusively from FortyGuard.
"""

from __future__ import annotations

from typing import Any

import httpx
from timezonefinder import TimezoneFinder

NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org"
NOMINATIM_HEADERS = {
    "User-Agent": "HeatShield-AI/0.3 (occupational heat safety prototype)",
    "Accept-Language": "en",
}
_TIMEOUT = httpx.Timeout(12.0)
_TZ = TimezoneFinder(in_memory=True)


class LocationLookupError(RuntimeError):
    """Raised when a location cannot be resolved safely."""


class UnsupportedLocationError(LocationLookupError):
    """Raised when a point is outside the currently supported U.S. product scope."""


def _first(mapping: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = mapping.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _site_id(latitude: float, longitude: float) -> str:
    return f"US-{latitude:.5f}-{longitude:.5f}".replace(".", "p").replace("-", "m")


def _timezone(latitude: float, longitude: float) -> str:
    timezone = _TZ.timezone_at(lat=latitude, lng=longitude)
    if not timezone:
        raise LocationLookupError("Unable to determine the local timezone for this location")
    return timezone


def normalize_nominatim_place(item: dict[str, Any]) -> dict[str, Any]:
    """Convert one Nominatim result into the strict HeatShield U.S. location shape."""

    try:
        latitude = float(item["lat"])
        longitude = float(item["lon"])
    except (KeyError, TypeError, ValueError) as exc:
        raise LocationLookupError("Location provider returned invalid coordinates") from exc

    address = item.get("address") if isinstance(item.get("address"), dict) else {}
    country_code = str(address.get("country_code") or "").lower()
    if country_code != "us":
        raise UnsupportedLocationError("HeatShield currently supports United States locations only")

    city = _first(
        address,
        "city",
        "town",
        "village",
        "municipality",
        "hamlet",
        "borough",
        "county",
    )
    state = _first(address, "state", "region")
    if not city or not state:
        raise LocationLookupError("Location provider did not return enough city/state metadata")

    display_name = str(item.get("display_name") or "").strip()
    name = (
        str(item.get("name") or "").strip()
        or _first(address, "amenity", "building", "road", "neighbourhood", "suburb")
        or city
    )

    return {
        "site_id": _site_id(latitude, longitude),
        "name": name,
        "display_name": display_name or f"{city}, {state}",
        "city": city,
        "state": state,
        "country": "United States",
        "latitude": latitude,
        "longitude": longitude,
        "timezone": _timezone(latitude, longitude),
        "location_source": "openstreetmap_nominatim",
    }


async def search_us_locations(query: str, *, limit: int = 6) -> list[dict[str, Any]]:
    query = query.strip()
    if len(query) < 2:
        raise LocationLookupError("Enter at least two characters to search for a location")

    params = {
        "q": query,
        "format": "jsonv2",
        "addressdetails": 1,
        "countrycodes": "us",
        "limit": max(1, min(limit, 8)),
    }
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT, headers=NOMINATIM_HEADERS) as client:
            response = await client.get(f"{NOMINATIM_BASE_URL}/search", params=params)
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise LocationLookupError("Location search is temporarily unavailable") from exc

    results: list[dict[str, Any]] = []
    for item in payload if isinstance(payload, list) else []:
        if not isinstance(item, dict):
            continue
        try:
            results.append(normalize_nominatim_place(item))
        except LocationLookupError:
            continue
    return results


async def reverse_us_location(latitude: float, longitude: float) -> dict[str, Any]:
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        raise LocationLookupError("Coordinates are outside valid latitude/longitude ranges")

    params = {
        "lat": latitude,
        "lon": longitude,
        "format": "jsonv2",
        "addressdetails": 1,
        "zoom": 14,
    }
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT, headers=NOMINATIM_HEADERS) as client:
            response = await client.get(f"{NOMINATIM_BASE_URL}/reverse", params=params)
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise LocationLookupError("Map location lookup is temporarily unavailable") from exc

    if not isinstance(payload, dict) or payload.get("error"):
        raise LocationLookupError("No supported place could be resolved at this map point")

    # Reverse geocoding is metadata only. Preserve the exact point the user
    # clicked instead of silently snapping the worksite to the returned road,
    # building, or place centroid. FortyGuard analysis must run at the selected
    # coordinate, not at a geocoder-adjusted coordinate.
    place = normalize_nominatim_place(payload)
    place.update({
        "site_id": _site_id(latitude, longitude),
        "latitude": float(latitude),
        "longitude": float(longitude),
        "timezone": _timezone(latitude, longitude),
    })
    return place
