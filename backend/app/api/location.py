"""Product-facing global location discovery endpoints."""

from fastapi import APIRouter, HTTPException, Query

from app.services.location_service import (
    LocationLookupError,
    UnsupportedLocationError,
    reverse_location,
    search_locations,
)

router = APIRouter(prefix="/location", tags=["Location"])


def _error(exc: Exception) -> HTTPException:
    if isinstance(exc, UnsupportedLocationError):
        return HTTPException(status_code=422, detail=str(exc))
    if isinstance(exc, LocationLookupError):
        return HTTPException(status_code=502, detail=str(exc))
    return HTTPException(status_code=500, detail="Unexpected location lookup failure")


@router.get("/search")
async def search_location(q: str = Query(min_length=2, max_length=160)) -> dict[str, object]:
    try:
        results = await search_locations(q)
        return {"query": q, "results": results}
    except Exception as exc:
        raise _error(exc) from exc


@router.get("/reverse")
async def reverse_location_endpoint(
    latitude: float = Query(ge=-90, le=90),
    longitude: float = Query(ge=-180, le=180),
) -> dict[str, object]:
    try:
        return await reverse_location(latitude, longitude)
    except Exception as exc:
        raise _error(exc) from exc
