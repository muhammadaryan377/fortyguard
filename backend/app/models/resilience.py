"""Typed contracts for site-level historical heat resilience intelligence."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.fortyguard import PolygonFeatureCollection
from app.models.risk import USSiteLocation


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SiteResilienceRequest(StrictModel):
    location: USSiteLocation
    timezone_name: str
    site_polygon: PolygonFeatureCollection
    start_date: date
    end_date: date
    threshold_c: float = Field(default=35.0, ge=-20.0, le=60.0)
    granularity: Literal[60, 80, 100] = 100

    @field_validator("timezone_name")
    @classmethod
    def valid_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("timezone_name must be a valid IANA timezone") from exc
        return value

    @model_validator(mode="after")
    def valid_window(self) -> "SiteResilienceRequest":
        if self.start_date < date(2019, 1, 1):
            raise ValueError("start_date must be on or after 2019-01-01")
        if self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        if (self.end_date - self.start_date).days > 30:
            raise ValueError("historical resilience window cannot exceed 31 days")
        return self


class ResilienceTile(BaseModel):
    tile_id: str
    value: float
    centroid_latitude: float
    centroid_longitude: float
    polygon_coordinates: list[list[list[float]]]


class ResilienceLayer(BaseModel):
    analytic_type: Literal["exceedance", "persistence", "time_of_measure"]
    activity_id: str
    units: Literal["hour"] = "hour"
    threshold_c: float | None = None
    direction: Literal["above", "below"] | None = None
    valid_tile_count: int
    minimum_value: float | None = None
    maximum_value: float | None = None
    mean_value: float | None = None
    tiles: list[ResilienceTile] = Field(default_factory=list)


class SiteResilienceResponse(BaseModel):
    status: Literal["available", "partial", "unavailable"]
    generated_at: datetime
    location: USSiteLocation
    timezone_name: str
    start_date: date
    end_date: date
    threshold_c: float
    granularity: Literal[60, 80, 100]
    exceedance: ResilienceLayer | None = None
    persistence: ResilienceLayer | None = None
    time_of_measure: ResilienceLayer | None = None
    limitations: list[str] = Field(default_factory=list)
