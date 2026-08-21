"""Typed contracts for on-demand FortyGuard Premium imagery intelligence."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class PremiumLocationIntelligenceRequest(BaseModel):
    """Request Premium segmentation only when a supervisor inspects a location."""

    model_config = ConfigDict(extra="forbid")

    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    timezone_name: str = "America/Phoenix"
    analysis_datetime: datetime | None = None
    granularity: Literal[60, 80, 100] = 80

    include_satellite: bool = True
    include_street_view: bool = True

    street_vertical_angle: float = Field(default=10.0, ge=-90, le=90)
    street_horizontal_angle: float = Field(default=90.0, ge=0, le=360)
    street_back_view: bool = False

    @field_validator("timezone_name")
    @classmethod
    def valid_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("timezone_name must be a valid IANA timezone") from exc
        return value

    @field_validator("analysis_datetime")
    @classmethod
    def datetime_has_timezone(cls, value: datetime | None) -> datetime | None:
        if value is not None and (value.tzinfo is None or value.utcoffset() is None):
            raise ValueError("analysis_datetime must include a timezone offset")
        return value

    @model_validator(mode="after")
    def at_least_one_provider(self) -> "PremiumLocationIntelligenceRequest":
        if not self.include_satellite and not self.include_street_view:
            raise ValueError("include_satellite or include_street_view must be enabled")
        return self


class SegmentationFrame(BaseModel):
    source: Literal["fortyguard_satellite", "fortyguard_streetview"]
    activity_id: str
    original_image_data_uri: str | None = None
    segmented_image_data_uri: str | None = None
    segments: dict[str, Any] = Field(default_factory=dict)
    image_legend: dict[str, Any] = Field(default_factory=dict)
    image_date: str | None = None
    image_year: int | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class PremiumLocationIntelligenceResponse(BaseModel):
    status: Literal["available", "partial", "unavailable"]
    latitude: float
    longitude: float
    generated_at: datetime
    satellite: SegmentationFrame | None = None
    street_view: SegmentationFrame | None = None
    limitations: list[str] = Field(default_factory=list)
