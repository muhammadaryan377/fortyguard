"""Global place discovery for HeatShield product workflows.

OpenStreetMap/Nominatim resolves human-friendly place metadata for any location.
FortyGuard support remains explicit and is currently limited to U.S. worksites.
"""

from __future__ import annotations

from typing import Any

import httpx
from tzfpy import get_tz

NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org"
NOMINATIM_HEADERS = {
    "User-Agent": "HeatShield-AI/0.4 (occupational heat operations product)",
    "Accept-Language": "en",
}
_TIMEOUT = httpx.Timeout(12.0)


class LocationLookupError(RuntimeError):
    """Raised when a location cannot be resolved safely."""


class UnsupportedLocationError(LocationLookupError):
    """Backward-compatible error type retained for callers that may import it."""


def _first(mapping: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = mapping.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _site_id(latitude: float, longitude: float, country_code: str | None = None) -> str:
    code = (country_code or "xx").strip().lower()
    prefix = "US" if code == "us" else f"LOC-{code.upper() or 'XX'}"
    coordinates = f"{latitude:.5f}-{longitude:.5f}".replace(".", "p").replace("-", "m")
    return f"{prefix}-{coordinates}"


def _timezone(latitude: float, longitude: float) -> str:
    # tzfpy expects coordinates in (longitude, latitude) order.
    timezone = get_tz(longitude, latitude)
    if not timezone:
        raise LocationLookupError("Unable to determine the local timezone for this location")
    return timezone


def normalize_nominatim_place(item: dict[str, Any]) -> dict[str, Any]:
    """Convert one Nominatim result into HeatShield's location shape.

    Every resolvable location can be used for general weather context. The
    `fortyguard_supported` flag tells the product whether occupational heat
    intelligence may be requested for the selected point.
    """

    try:
        latitude = float(item["lat"])
        longitude = float(item["lon"])
    except (KeyError, TypeError, ValueError) as exc:
        raise LocationLookupError("Location provider returned invalid coordinates") from exc

    address = item.get("address") if isinstance(item.get("address"), dict) else {}
    country_code = str(address.get("country_code") or "").lower().strip()
    country = _first(address, "country") or ("United States" if country_code == "us" else country_code.upper())
    if not country:
        country = "Unknown country"

    city = _first(
        address,
        "city",
        "town",
        "village",
        "municipality",
        "hamlet",
        "borough",
        "suburb",
        "county",
    )
    state = _first(
        address,
        "state",
        "region",
        "province",
        "state_district",
        "county",
    )

    display_name = str(item.get("display_name") or "").strip()
    name = (
        str(item.get("name") or "").strip()
        or _first(address, "amenity", "building", "road", "neighbourhood", "suburb")
        or city
        or state
        or country
    )
    city = city or name
    state = state or country

    fortyguard_supported = country_code == "us"

    return {
        "site_id": _site_id(latitude, longitude, country_code),
        "name": name,
        "display_name": display_name or ", ".join(part for part in [city, state, country] if part),
        "city": city,
        "state": state,
        "country": "United States" if fortyguard_supported else country,
        "country_code": country_code or None,
        "latitude": latitude,
        "longitude": longitude,
        "timezone": _timezone(latitude, longitude),
        "location_source": "openstreetmap_nominatim",
        "fortyguard_supported": fortyguard_supported,
        "coverage": "fortyguard_us" if fortyguard_supported else "weather_context_only",
    }


async def search_locations(query: str, *, limit: int = 6) -> list[dict[str, Any]]:
    query = query.strip()
    if len(query) < 2:
        raise LocationLookupError("Enter at least two characters to search for a location")

    params = {
        "q": query,
        "format": "jsonv2",
        "addressdetails": 1,
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


async def reverse_location(latitude: float, longitude: float) -> dict[str, Any]:
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        raise LocationLookupError("Coordinates are outside valid latitude/longitude ranges")

    params = {
        "lat": latitude,
        "lon": longitude,
        "format": "jsonv2",
        "addressdetails": 1,
        "zoom": 16,
    }
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT, headers=NOMINATIM_HEADERS) as client:
            response = await client.get(f"{NOMINATIM_BASE_URL}/reverse", params=params)
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise LocationLookupError("Map location lookup is temporarily unavailable") from exc

    if not isinstance(payload, dict) or payload.get("error"):
        raise LocationLookupError("No place could be resolved at this map point")

    # Reverse geocoding provides metadata only. Preserve the exact user-selected
    # coordinates instead of snapping to a road/building/place centroid.
    place = normalize_nominatim_place(payload)
    place.update(
        {
            "site_id": _site_id(latitude, longitude, place.get("country_code")),
            "latitude": float(latitude),
            "longitude": float(longitude),
            "timezone": _timezone(latitude, longitude),
        }
    )
    return place


# Compatibility aliases for older internal imports/tests.
search_us_locations = search_locations
reverse_us_location = reverse_location
