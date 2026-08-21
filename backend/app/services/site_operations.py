"""One-site/many-worker deterministic orchestration without model fan-out."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Callable
from uuid import uuid4
from zoneinfo import ZoneInfo

from app.core.config import settings
from app.models.fortyguard import (
    EnvironmentalConditions,
    EnvironmentalParametersRequest,
    EnvironmentalProvenance,
    HeatmapRequest,
    PolygonFeatureCollection,
)
from app.models.operations import HeatShieldCycleRequest
from app.models.optimization import CurrentShiftPlanSummary, ShiftOptimizationRequest, ShiftOptimizationResponse
from app.models.prediction import PredictHeatOutlookRequest
from app.models.risk import USSiteLocation
from app.models.site import (
    OperationalAttentionGroup,
    SelectedWorkerCycleRequest,
    SiteOperationsRequest,
    SiteOperationsResponse,
    SiteOperationsSummary,
    SiteProviderUsage,
    SiteWorkerAssignment,
    SiteWorkerPosition,
    SiteWorkerSnapshot,
)
from app.models.spatial import SpatialHeatRequest, SpatialHeatResponse, SpatialHeatSummary, SpatialSiteReference
from app.services.agent_decision import available_agent_capabilities
from app.services.cycle_orchestrator import _current_filter
from app.services.fortyguard import (
    FortyGuardClient,
    fortyguard_client,
    normalize_environmental_result,
    normalize_heatmap_result,
)
from app.services.live_environment import (
    build_site_polygon,
    extract_verified_temperature,
    get_live_environment,
    match_single_observation,
    requested_timestamp,
)
from app.services.predictive_heat import create_heat_outlook
from app.services.risk_engine import assess_risk
from app.services.shift_optimizer import optimize_shift
from app.services.spatial_heat import create_spatial_heat
from app.services.state_store import HeatShieldStateStore


ATTENTION_ORDER = {
    OperationalAttentionGroup.EVIDENCE_GAP: 1,
    OperationalAttentionGroup.EXTREME_HEAT_SCREENING: 2,
    OperationalAttentionGroup.DANGER_HEAT_SCREENING: 3,
    OperationalAttentionGroup.EXTREME_CAUTION_HEAT_SCREENING: 4,
    OperationalAttentionGroup.CAUTION_HEAT_SCREENING: 5,
    OperationalAttentionGroup.BELOW_CAUTION_HEAT_SCREENING: 6,
    OperationalAttentionGroup.SCREENING_UNAVAILABLE: 7,
}
BAND_GROUP = {
    "extreme_danger": OperationalAttentionGroup.EXTREME_HEAT_SCREENING,
    "danger": OperationalAttentionGroup.DANGER_HEAT_SCREENING,
    "extreme_caution": OperationalAttentionGroup.EXTREME_CAUTION_HEAT_SCREENING,
    "caution": OperationalAttentionGroup.CAUTION_HEAT_SCREENING,
    "below_caution": OperationalAttentionGroup.BELOW_CAUTION_HEAT_SCREENING,
}


def attention_group(assessment) -> OperationalAttentionGroup:
    screening = assessment.screening
    if assessment.risk_level == "insufficient_data" or (screening and screening.status == "insufficient_data"):
        return OperationalAttentionGroup.EVIDENCE_GAP
    if screening and screening.band in BAND_GROUP:
        return BAND_GROUP[screening.band]
    return OperationalAttentionGroup.SCREENING_UNAVAILABLE


def unavailable_optimization(worker_id: str, now: datetime) -> ShiftOptimizationResponse:
    return ShiftOptimizationResponse(
        status="optimizer_unavailable",
        worker_id=worker_id,
        generated_at=now,
        sample_offsets_considered=[],
        current_plan=CurrentShiftPlanSummary(
            status="unavailable",
            safe_reason="Shift optimization was unavailable.",
        ),
        candidates=[],
        best_candidate=None,
        limitations=["Shift optimization was unavailable; no schedule candidate was fabricated."],
    )


def unavailable_spatial(request: SiteOperationsRequest, now: datetime) -> SpatialHeatResponse:
    return SpatialHeatResponse(
        status="insufficient_data",
        generated_at=now,
        location=request.location,
        timezone_name=request.timezone_name,
        search_radius_meters=request.spatial_search_radius_meters,
        granularity=settings.heatshield_live_granularity_meters,
        site_reference=SpatialSiteReference(),
        tiles=[],
        candidates=[],
        summary=SpatialHeatSummary(valid_tile_count=0, cooler_candidate_count=0),
        limitations=["Spatial provider evidence was unavailable; no cooler zone candidate was created."],
    )


def analysis_anchor(request: SiteOperationsRequest, clock_value: datetime) -> datetime:
    source = request.analysis_datetime if request.analysis_datetime is not None else clock_value
    if source.tzinfo is None:
        source = source.replace(tzinfo=UTC)
    else:
        source = source.astimezone(UTC)
    local = source.astimezone(ZoneInfo(request.timezone_name)).replace(
        minute=0,
        second=0,
        microsecond=0,
    )
    return local.astimezone(UTC)


def location_for_position(
    site: USSiteLocation,
    position: SiteWorkerPosition | None,
    *,
    worker_id: str | None = None,
) -> USSiteLocation:
    if position is None:
        return site
    suffix = position.label or worker_id or "worker"
    return USSiteLocation(
        site_id=site.site_id,
        name=f"{site.name} · {suffix}",
        city=site.city,
        state=site.state,
        country="United States",
        latitude=position.latitude,
        longitude=position.longitude,
    )


def polygon_for_request(request: SiteOperationsRequest) -> PolygonFeatureCollection:
    return request.site_polygon or build_site_polygon(
        request.location.latitude,
        request.location.longitude,
    )


async def fetch_site_heatmap(
    request: SiteOperationsRequest,
    date_time,
    *,
    client: FortyGuardClient,
) -> tuple[str, int, dict, int]:
    """Fetch one TCM map for the submitted site AOI, with the verified 100 m fallback."""

    requested = int(request.heatmap_granularity)
    candidates = [requested] if requested == 100 else [requested, 100]
    attempts = 0
    last_error: Exception | None = None

    for granularity in candidates:
        attempts += 1
        try:
            activity_id = await client.create_heatmap(
                HeatmapRequest(
                    polygon_aoi=polygon_for_request(request),
                    date_time=date_time,
                    granularity=granularity,
                    analytic_type="tcm",
                )
            )
            job = await client.wait_for_result(activity_id)
            normalized = normalize_heatmap_result(job.result or {})
            map_data = normalized.map_data
            features = map_data.get("features") if isinstance(map_data, dict) else None
            if not isinstance(features, list) or not features:
                raise ValueError("FortyGuard heatmap contains no spatial features")
            return activity_id, granularity, map_data, attempts
        except Exception as exc:
            last_error = exc

    if last_error is not None:
        raise last_error
    raise ValueError("FortyGuard heatmap did not provide site spatial evidence")


async def environment_from_site_heatmap(
    *,
    request: SiteOperationsRequest,
    location: USSiteLocation,
    date_time,
    map_data: dict,
    heatmap_activity_id: str,
    granularity: int,
    client: FortyGuardClient,
) -> EnvironmentalConditions:
    requested = requested_timestamp(date_time).isoformat(timespec="minutes")
    verified = extract_verified_temperature(
        map_data,
        latitude=location.latitude,
        longitude=location.longitude,
        timestamp=requested,
        activity_id=heatmap_activity_id,
    )
    verified.raw["granularity_meters"] = granularity

    environment_activity_id = await client.get_environmental_parameters(
        EnvironmentalParametersRequest(
            latitude=location.latitude,
            longitude=location.longitude,
            temperature=verified.temperature_c,
            date_time=date_time,
        )
    )
    job = await client.wait_for_result(environment_activity_id)
    observations = normalize_environmental_result(job.result or {})
    selected = match_single_observation(
        observations,
        location=location,
        date_time=date_time,
    )
    selected.temperature_c = verified.temperature_c
    selected.provenance = EnvironmentalProvenance(
        temperature_source="fortyguard_heatmap",
        environmental_parameters_source="fortyguard_env_params",
        heatmap_activity_id=heatmap_activity_id,
        environment_activity_id=environment_activity_id,
        requested_timestamp=verified.timestamp,
        matched_provider_timestamp=selected.timestamp or "",
        site_timezone_name=request.timezone_name,
        canonical_observation_timestamp=selected.timestamp,
        temperature_extraction_method=verified.extraction_method,
    )
    selected.raw = {
        "selected_heatmap_feature": verified.raw.get("selected_feature"),
        "selected_heatmap_temperature_c": verified.temperature_c,
        "heatmap_granularity_meters": granularity,
        "site_polygon_shared_heatmap": True,
    }
    return selected


class SiteOperationsOrchestrator:
    def __init__(
        self,
        store: HeatShieldStateStore,
        *,
        client: FortyGuardClient = fortyguard_client,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self.store, self.client = store, client
        self.clock = clock or (lambda: datetime.now(UTC))

    async def create(self, request: SiteOperationsRequest) -> SiteOperationsResponse:
        now = analysis_anchor(request, self.clock())
        date_time = _current_filter(now, request.timezone_name)
        snapshot_id = str(uuid4())
        limitations = [
            "Operational attention ordering is not a total occupational heat-risk score.",
            "The site snapshot is deterministic and makes no DeepSeek calls.",
            "Worker environmental evidence is evaluated at the submitted worker coordinates when provided.",
        ]

        site_heatmap_activity_id: str | None = None
        site_heatmap_granularity: int | None = None
        site_heatmap_map_data: dict | None = None
        site_heatmap_requests = 0
        center_environment_fetches = 0
        worker_environment_fetches = 0

        try:
            (
                site_heatmap_activity_id,
                site_heatmap_granularity,
                site_heatmap_map_data,
                site_heatmap_requests,
            ) = await fetch_site_heatmap(request, date_time, client=self.client)
        except Exception:
            limitations.append(
                "The submitted site polygon heatmap was unavailable; point-specific provider fallbacks were used where possible."
            )

        try:
            if site_heatmap_map_data is not None and site_heatmap_activity_id is not None and site_heatmap_granularity is not None:
                environment = await environment_from_site_heatmap(
                    request=request,
                    location=request.location,
                    date_time=date_time,
                    map_data=site_heatmap_map_data,
                    heatmap_activity_id=site_heatmap_activity_id,
                    granularity=site_heatmap_granularity,
                    client=self.client,
                )
                center_environment_fetches += 1
            else:
                environment = await get_live_environment(
                    request.location,
                    date_time,
                    timezone_name=request.timezone_name,
                    client=self.client,
                )
                center_environment_fetches += 1
            environment = environment.model_copy(update={"raw": {}})
        except Exception:
            environment = EnvironmentalConditions(
                location=request.location.model_dump(),
                timestamp=now.isoformat(),
            )
            limitations.append(
                "Shared current provider evidence was unavailable; no environmental value was fabricated."
            )

        outlook = None
        if request.include_prediction:
            outlook = await create_heat_outlook(
                PredictHeatOutlookRequest(
                    location=request.location,
                    timezone_name=request.timezone_name,
                    offset_hours=request.forecast_offset_hours,
                ),
                client=self.client,
                now=now,
            )

        spatial = None
        if request.include_spatial_intelligence:
            try:
                spatial = await create_spatial_heat(
                    SpatialHeatRequest(
                        location=request.location,
                        timezone_name=request.timezone_name,
                        search_radius_meters=request.spatial_search_radius_meters,
                        granularity=settings.heatshield_live_granularity_meters,
                        max_candidates=request.max_spatial_candidates,
                    ),
                    client=self.client,
                    clock=lambda: now,
                )
            except Exception:
                spatial = unavailable_spatial(request, now)

        workers: list[SiteWorkerSnapshot] = []
        optimization_count = 0

        for assignment in request.assignments:
            worker_location = location_for_position(
                request.location,
                assignment.position,
                worker_id=assignment.worker.worker_id,
            )
            worker_environment = environment

            if assignment.position is not None:
                try:
                    if (
                        site_heatmap_map_data is not None
                        and site_heatmap_activity_id is not None
                        and site_heatmap_granularity is not None
                    ):
                        worker_environment = await environment_from_site_heatmap(
                            request=request,
                            location=worker_location,
                            date_time=date_time,
                            map_data=site_heatmap_map_data,
                            heatmap_activity_id=site_heatmap_activity_id,
                            granularity=site_heatmap_granularity,
                            client=self.client,
                        )
                    else:
                        worker_environment = await get_live_environment(
                            worker_location,
                            date_time,
                            timezone_name=request.timezone_name,
                            client=self.client,
                        )
                    worker_environment_fetches += 1
                    worker_environment = worker_environment.model_copy(update={"raw": {}})
                except Exception:
                    worker_environment = EnvironmentalConditions(
                        location=worker_location.model_dump(),
                        timestamp=now.isoformat(),
                    )
                    limitations.append(
                        f"Worker {assignment.worker.worker_id} provider evidence was unavailable at the submitted position."
                    )

            assessment = assess_risk(
                worker_environment,
                assignment.worker,
                assignment.task,
                now=now,
            )
            optimization = None
            if request.include_shift_optimization and assignment.shift_tasks and outlook is not None:
                optimization_count += 1
                try:
                    optimization = optimize_shift(
                        ShiftOptimizationRequest(
                            worker_id=assignment.worker.worker_id,
                            heat_outlook=outlook,
                            tasks=assignment.shift_tasks,
                        ),
                        now=now,
                    )
                except Exception:
                    optimization = unavailable_optimization(assignment.worker.worker_id, now)

            group = attention_group(assessment)
            screen = assessment.screening
            workers.append(
                SiteWorkerSnapshot(
                    worker_id=assignment.worker.worker_id,
                    display_label=assignment.display_label,
                    position=assignment.position,
                    zone_id=assignment.worker.zone_id,
                    task_id=assignment.task.task_id,
                    task_name=assignment.task.task_name,
                    workload_level=assignment.task.workload_level,
                    direct_sun=assignment.task.direct_sun,
                    acclimatized=assignment.worker.acclimatized,
                    exposure_duration_minutes=assignment.task.exposure_duration_minutes,
                    attention_group=group,
                    attention_order=ATTENTION_ORDER[group],
                    current_assessment=assessment,
                    shift_optimization=optimization,
                    contextual_flags=screen.contextual_flags if screen else [],
                    recommended_controls=screen.recommended_controls if screen else [],
                    available_agent_capabilities=available_agent_capabilities(
                        assessment,
                        outlook,
                        spatial,
                        optimization,
                    ),
                )
            )

        queue = sorted(workers, key=lambda worker: (worker.attention_order, worker.worker_id))
        bands = {
            key: 0
            for key in (
                "below_caution",
                "caution",
                "extreme_caution",
                "danger",
                "extreme_danger",
                "unavailable",
            )
        }
        for worker in workers:
            screen = worker.current_assessment.screening
            band = screen.band if screen and screen.band else "unavailable"
            bands[band] += 1

        candidate_workers = [
            worker
            for worker in workers
            if worker.shift_optimization and worker.shift_optimization.best_candidate
        ]
        summary = SiteOperationsSummary(
            worker_count=len(workers),
            workers_with_precise_location_count=sum(item.position is not None for item in request.assignments),
            site_polygon_feature_count=len(request.site_polygon.features) if request.site_polygon else 0,
            evidence_gap_count=sum(
                worker.attention_group == OperationalAttentionGroup.EVIDENCE_GAP
                for worker in workers
            ),
            screening_band_counts=bands,
            direct_sun_worker_count=sum(worker.direct_sun for worker in workers),
            non_acclimatized_worker_count=sum(not worker.acclimatized for worker in workers),
            workers_with_shift_candidate_count=len(candidate_workers),
            workers_with_lower_index_shift_candidate_count=sum(
                worker.shift_optimization.best_candidate.is_strictly_lower_temperature_index_than_current is True
                for worker in candidate_workers
            ),
            shared_current_temperature_c=environment.temperature_c,
            shared_provider_heat_index_c=environment.heat_index_c,
            forecast_status=outlook.status if outlook else "not_requested",
            spatial_status=spatial.status if spatial else "not_requested",
            cooler_zone_candidate_count=len(spatial.candidates) if spatial else 0,
        )
        optional_partial = (
            (outlook is not None and outlook.status != "available")
            or (spatial is not None and spatial.status == "insufficient_data")
            or any(
                worker.shift_optimization
                and worker.shift_optimization.status == "optimizer_unavailable"
                for worker in workers
            )
        )
        current_valid = all(
            worker.current_assessment.risk_level != "insufficient_data"
            for worker in workers
        )
        status = "insufficient_data" if not current_valid else "partial" if optional_partial else "available"
        usage = SiteProviderUsage(
            site_heatmap_requests=site_heatmap_requests,
            current_environment_fetches=center_environment_fetches + worker_environment_fetches,
            worker_environment_fetches=worker_environment_fetches,
            prediction_heatmap_requests=len(request.forecast_offset_hours) if request.include_prediction else 0,
            spatial_heatmap_requests=1 if request.include_spatial_intelligence else 0,
            worker_assessment_count=len(workers),
            worker_shift_optimization_count=optimization_count,
        )
        response = SiteOperationsResponse(
            snapshot_id=snapshot_id,
            generated_at=now,
            status=status,
            location=request.location,
            timezone_name=request.timezone_name,
            site_polygon=request.site_polygon,
            site_heatmap_activity_id=site_heatmap_activity_id,
            site_heatmap_granularity=site_heatmap_granularity,
            shared_environment=environment,
            heat_outlook=outlook,
            spatial_heat=spatial,
            workers=workers,
            attention_queue=[worker.worker_id for worker in queue],
            summary=summary,
            provider_usage=usage,
            limitations=limitations,
        )
        self.store.save_site_snapshot(
            snapshot_id,
            now.isoformat(),
            {
                "request": request.model_dump(mode="json"),
                "response": response.model_dump(mode="json"),
            },
        )
        self.store.add_audit(
            snapshot_id,
            "site_snapshot_created",
            {
                "worker_count": len(workers),
                "provider_usage": usage.model_dump(),
                "status": status,
                "site_heatmap_activity_id": site_heatmap_activity_id,
            },
        )
        return response

    def get(self, snapshot_id: str) -> SiteOperationsResponse:
        stored = self.store.get_site_snapshot(snapshot_id)
        if not stored:
            raise KeyError("Site snapshot not found")
        response = SiteOperationsResponse.model_validate(stored["response"])
        current = self.clock()
        current = current.replace(tzinfo=UTC) if current.tzinfo is None else current.astimezone(UTC)
        response.age_seconds = max(
            0.0,
            (current - response.generated_at.astimezone(UTC)).total_seconds(),
        )
        statement = "Stored site snapshots are historical views and are not refreshed by GET."
        if statement not in response.limitations:
            response.limitations.append(statement)
        return response

    def cycle_request(self, snapshot_id: str, worker_id: str) -> SelectedWorkerCycleRequest:
        stored = self.store.get_site_snapshot(snapshot_id)
        if not stored:
            raise KeyError("Site snapshot not found")
        request = SiteOperationsRequest.model_validate(stored["request"])
        assignment: SiteWorkerAssignment | None = next(
            (
                item
                for item in request.assignments
                if item.worker.worker_id == worker_id
            ),
            None,
        )
        if assignment is None:
            raise KeyError("Worker not found in site snapshot")

        worker_location = location_for_position(
            request.location,
            assignment.position,
            worker_id=assignment.worker.worker_id,
        )
        cycle = HeatShieldCycleRequest(
            location=worker_location,
            timezone_name=request.timezone_name,
            analysis_datetime=request.analysis_datetime,
            worker=assignment.worker,
            task=assignment.task,
            forecast_offset_hours=request.forecast_offset_hours,
            include_spatial_intelligence=request.include_spatial_intelligence,
            spatial_search_radius_meters=request.spatial_search_radius_meters,
            include_shift_optimization=request.include_shift_optimization and bool(assignment.shift_tasks),
            shift_tasks=assignment.shift_tasks,
        )
        return SelectedWorkerCycleRequest(
            snapshot_id=snapshot_id,
            worker_id=worker_id,
            cycle_request=cycle,
            limitations=[
                "This helper does not run a cycle or reuse snapshot environmental evidence.",
                "Submitting this request to /api/cycle/plan performs fresh provider fetches at the worker position.",
            ],
        )
