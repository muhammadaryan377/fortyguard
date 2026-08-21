"""Typed contracts for deterministic multi-worker site intelligence."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.config import settings
from app.models.fortyguard import EnvironmentalConditions, PolygonFeatureCollection
from app.models.operations import CyclePlanResponse, HeatShieldCycleRequest
from app.models.optimization import ShiftOptimizationResponse, ShiftTaskPlan, validate_task_dependencies
from app.models.prediction import PredictHeatOutlookResponse
from app.models.risk import RiskAssessment, TaskContext, USSiteLocation, WorkerContext, WorkloadLevel
from app.models.spatial import SpatialHeatResponse


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class OperationalAttentionGroup(StrEnum):
    EVIDENCE_GAP = "evidence_gap"
    EXTREME_HEAT_SCREENING = "extreme_heat_screening"
    DANGER_HEAT_SCREENING = "danger_heat_screening"
    EXTREME_CAUTION_HEAT_SCREENING = "extreme_caution_heat_screening"
    CAUTION_HEAT_SCREENING = "caution_heat_screening"
    BELOW_CAUTION_HEAT_SCREENING = "below_caution_heat_screening"
    SCREENING_UNAVAILABLE = "screening_unavailable"


class SiteZoneType(StrEnum):
    WORK = "work"
    RECOVERY = "recovery"
    RESTRICTED = "restricted"
    TRANSIT = "transit"


class SiteWorkerPosition(StrictModel):
    latitude: float = Field(ge=-90.0, le=90.0)
    longitude: float = Field(ge=-180.0, le=180.0)
    label: str | None = Field(default=None, max_length=120)


def _point_in_ring(longitude: float, latitude: float, ring: list[list[float]]) -> bool:
    inside = False
    j = len(ring) - 1
    for i, position in enumerate(ring):
        previous = ring[j]
        xi, yi = position[:2]
        xj, yj = previous[:2]
        intersects = (yi > latitude) != (yj > latitude) and longitude < (
            (xj - xi) * (latitude - yi) / (yj - yi) + xi
        )
        if intersects:
            inside = not inside
        j = i
    return inside


def _point_in_collection(longitude: float, latitude: float, collection: PolygonFeatureCollection) -> bool:
    return any(
        feature.geometry.coordinates
        and _point_in_ring(longitude, latitude, feature.geometry.coordinates[0])
        for feature in collection.features
    )


class SiteOperationalZone(StrictModel):
    zone_id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=120)
    zone_type: SiteZoneType
    active: bool = True
    relocation_allowed: bool = False
    polygon: PolygonFeatureCollection

    @model_validator(mode="after")
    def valid_zone(self) -> "SiteOperationalZone":
        if len(self.polygon.features) != 1:
            raise ValueError("each operational zone must contain exactly one polygon feature")
        if self.zone_type in {SiteZoneType.RESTRICTED, SiteZoneType.TRANSIT} and self.relocation_allowed:
            raise ValueError("restricted/transit zones cannot be relocation targets")
        return self


class SiteWorkerAssignment(StrictModel):
    worker: WorkerContext
    task: TaskContext
    position: SiteWorkerPosition | None = None
    shift_tasks: list[ShiftTaskPlan] | None = Field(default=None, min_length=1, max_length=6)
    display_label: str | None = Field(default=None, max_length=100)
    spatial_relocation_allowed: bool = True
    allowed_zone_ids: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("allowed_zone_ids")
    @classmethod
    def unique_allowed_zones(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("allowed_zone_ids must be unique")
        return value

    @model_validator(mode="after")
    def valid_shift_tasks(self) -> "SiteWorkerAssignment":
        if self.shift_tasks:
            validate_task_dependencies(self.shift_tasks)
        if not self.spatial_relocation_allowed and self.allowed_zone_ids:
            raise ValueError("allowed_zone_ids require spatial_relocation_allowed=true")
        return self


class SiteOperationsRequest(StrictModel):
    location: USSiteLocation
    timezone_name: str = "America/Phoenix"
    site_polygon: PolygonFeatureCollection | None = None
    operational_zones: list[SiteOperationalZone] = Field(default_factory=list, max_length=20)
    analysis_datetime: datetime | None = None
    assignments: list[SiteWorkerAssignment] = Field(min_length=1, max_length=25)
    forecast_offset_hours: list[int] = Field(default_factory=lambda: [1, 3, 6, 9, 12], min_length=1, max_length=5)
    include_prediction: bool = True
    include_spatial_intelligence: bool = True
    spatial_search_radius_meters: int = Field(default=400, ge=100, le=1500)
    include_shift_optimization: bool = False
    max_spatial_candidates: int = Field(default=3, ge=1, le=5)
    heatmap_granularity: Literal[60, 80, 100] = settings.heatshield_live_granularity_meters

    @field_validator("timezone_name")
    @classmethod
    def valid_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("timezone_name must be a valid IANA timezone") from exc
        return value

    @field_validator("forecast_offset_hours")
    @classmethod
    def valid_offsets(cls, value: list[int]) -> list[int]:
        if len(set(value)) != len(value) or any(offset < 1 or offset > 12 for offset in value):
            raise ValueError("forecast offsets must be unique values between 1 and 12")
        return sorted(value)

    @model_validator(mode="after")
    def valid_site_request(self) -> "SiteOperationsRequest":
        ids = [item.worker.worker_id for item in self.assignments]
        if len(ids) != len(set(ids)):
            raise ValueError("worker_id values must be unique within a site request")
        if self.include_shift_optimization and not self.include_prediction:
            raise ValueError("include_shift_optimization=true requires include_prediction=true")

        zones = {zone.zone_id: zone for zone in self.operational_zones}
        if len(zones) != len(self.operational_zones):
            raise ValueError("operational zone IDs must be unique")
        if self.operational_zones and self.site_polygon is None:
            raise ValueError("operational_zones require site_polygon")

        if self.site_polygon is not None:
            if len(self.site_polygon.features) > 8:
                raise ValueError("site_polygon supports at most 8 polygon features")
            if not _point_in_collection(self.location.longitude, self.location.latitude, self.site_polygon):
                raise ValueError("location must fall inside site_polygon")
            for zone in self.operational_zones:
                ring = zone.polygon.features[0].geometry.coordinates[0]
                for longitude, latitude, *_ in ring[:-1]:
                    if not _point_in_collection(longitude, latitude, self.site_polygon):
                        raise ValueError(f"zone {zone.zone_id} must stay inside site_polygon")
            for item in self.assignments:
                if item.position is None:
                    continue
                if not _point_in_collection(item.position.longitude, item.position.latitude, self.site_polygon):
                    raise ValueError(f"worker {item.worker.worker_id} position must fall inside site_polygon")
                if self.operational_zones:
                    zone_id = item.worker.zone_id
                    zone = zones.get(zone_id or "")
                    if zone is None or not zone.active or zone.zone_type != SiteZoneType.WORK:
                        raise ValueError(f"worker {item.worker.worker_id} requires an active work zone")
                    if not _point_in_collection(item.position.longitude, item.position.latitude, zone.polygon):
                        raise ValueError(f"worker {item.worker.worker_id} position must fall inside assigned work zone")
                    for allowed_id in item.allowed_zone_ids:
                        allowed = zones.get(allowed_id)
                        if (
                            allowed is None
                            or not allowed.active
                            or not allowed.relocation_allowed
                            or allowed.zone_type not in {SiteZoneType.WORK, SiteZoneType.RECOVERY}
                        ):
                            raise ValueError(f"worker {item.worker.worker_id} has invalid allowed zone {allowed_id}")
        return self


class SiteWorkerSnapshot(BaseModel):
    worker_id: str
    display_label: str | None = None
    position: SiteWorkerPosition | None = None
    zone_id: str | None = None
    zone_name: str | None = None
    zone_type: SiteZoneType | None = None
    spatial_relocation_allowed: bool = True
    allowed_zone_ids: list[str] = Field(default_factory=list)
    task_id: str
    task_name: str
    workload_level: WorkloadLevel
    direct_sun: bool
    acclimatized: bool
    exposure_duration_minutes: int
    attention_group: OperationalAttentionGroup
    attention_order: int
    current_assessment: RiskAssessment
    heat_outlook: PredictHeatOutlookResponse | None = None
    spatial_heat: SpatialHeatResponse | None = None
    shift_optimization: ShiftOptimizationResponse | None = None
    contextual_flags: list[str]
    recommended_controls: list[str]
    available_agent_capabilities: list[str]


class SiteOperationsSummary(BaseModel):
    worker_count: int
    workers_with_precise_location_count: int = 0
    site_polygon_feature_count: int = 0
    operational_zone_count: int = 0
    active_work_zone_count: int = 0
    active_recovery_zone_count: int = 0
    evidence_gap_count: int
    screening_band_counts: dict[str, int]
    direct_sun_worker_count: int
    non_acclimatized_worker_count: int
    workers_with_shift_candidate_count: int
    workers_with_lower_index_shift_candidate_count: int
    shared_current_temperature_c: float | None = None
    shared_provider_heat_index_c: float | None = None
    forecast_status: str
    spatial_status: str
    cooler_zone_candidate_count: int


class SiteProviderUsage(BaseModel):
    site_heatmap_requests: int = 0
    current_environment_fetches: int = 0
    worker_environment_fetches: int = 0
    prediction_heatmap_requests: int = 0
    spatial_heatmap_requests: int = 0
    worker_assessment_count: int = 0
    worker_shift_optimization_count: int = 0
    deepseek_calls: Literal[0] = 0


class SiteOperationsResponse(BaseModel):
    snapshot_id: str
    generated_at: datetime
    age_seconds: float | None = None
    status: Literal["available", "partial", "insufficient_data"]
    location: USSiteLocation
    timezone_name: str
    site_polygon: PolygonFeatureCollection | None = None
    operational_zones: list[SiteOperationalZone] = Field(default_factory=list)
    site_heatmap_activity_id: str | None = None
    site_heatmap_granularity: Literal[60, 80, 100] | None = None
    shared_environment: EnvironmentalConditions
    heat_outlook: PredictHeatOutlookResponse | None = None
    spatial_heat: SpatialHeatResponse | None = None
    workers: list[SiteWorkerSnapshot]
    attention_queue: list[str]
    summary: SiteOperationsSummary
    provider_usage: SiteProviderUsage
    limitations: list[str]


class SelectedWorkerCycleRequest(BaseModel):
    snapshot_id: str
    worker_id: str
    cycle_request: HeatShieldCycleRequest
    limitations: list[str]


class SiteAgentPlanRequest(StrictModel):
    worker_ids: list[str] = Field(min_length=1, max_length=10)

    @field_validator("worker_ids")
    @classmethod
    def unique_workers(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("worker_ids must be unique")
        return value


class SiteWorkerAgentResult(BaseModel):
    worker_id: str
    cycle: CyclePlanResponse


class SiteAgentPlanResponse(BaseModel):
    snapshot_id: str
    generated_at: datetime
    worker_count: int
    results: list[SiteWorkerAgentResult]
    limitations: list[str]
