"""Typed map-ready contracts for provider-backed spatial heat intelligence."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.config import settings
from app.models.fortyguard import PolygonFeatureCollection
from app.models.risk import USSiteLocation


class SpatialHeatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    location: USSiteLocation
    timezone_name: str = "America/Phoenix"
    search_radius_meters: int = Field(default=400, ge=100, le=1500)
    granularity: Literal[60, 80, 100] = settings.heatshield_live_granularity_meters
    max_candidates: int = Field(default=3, ge=1, le=5)
    operational_polygon: PolygonFeatureCollection | None = None

    @field_validator("timezone_name")
    @classmethod
    def valid_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("timezone_name must be a valid IANA timezone") from exc
        return value


class SpatialHeatTile(BaseModel):
    tile_id: str
    temperature_c: float
    polygon_coordinates: list[list[list[float]]]
    centroid_latitude: float
    centroid_longitude: float
    contains_site: bool
    straight_line_distance_m: float
    inside_operational_boundary: bool | None = None


class CoolerZoneCandidate(BaseModel):
    candidate_id: str
    tile_id: str
    temperature_c: float
    site_temperature_c: float
    cooler_by_c: float
    centroid_latitude: float
    centroid_longitude: float
    straight_line_distance_m: float
    polygon_coordinates: list[list[list[float]]]
    rank: int
    inside_operational_boundary: bool | None = None
    evidence_source: Literal["fortyguard_heatmap"] = "fortyguard_heatmap"
    analytic_type: Literal["tcm"] = "tcm"
    limitations: list[str]


class SpatialSiteReference(BaseModel):
    site_temperature_c: float | None = None
    containing_tile_id: str | None = None


class SpatialHeatSummary(BaseModel):
    valid_tile_count: int
    cooler_candidate_count: int
    coolest_mapped_temperature_c: float | None = None
    coolest_candidate_cooler_by_c: float | None = None
    nearest_cooler_candidate_distance_m: float | None = None


class SpatialHeatResponse(BaseModel):
    status: Literal["available", "no_cooler_candidate", "insufficient_data"]
    source: Literal["fortyguard_heatmap"] = "fortyguard_heatmap"
    generated_at: datetime
    location: USSiteLocation
    timezone_name: str
    search_radius_meters: int
    granularity: Literal[60, 80, 100]
    heatmap_activity_id: str | None = None
    site_reference: SpatialSiteReference
    tiles: list[SpatialHeatTile]
    candidates: list[CoolerZoneCandidate]
    summary: SpatialHeatSummary
    limitations: list[str]
