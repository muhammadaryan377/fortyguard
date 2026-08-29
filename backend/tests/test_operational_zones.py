from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.models.fortyguard import FortyGuardJobStatus, PolygonFeatureCollection
from app.models.risk import TaskContext, USSiteLocation, WorkerContext
from app.models.site import SiteOperationsRequest, SiteOperationalZone, SiteWorkerAssignment, SiteWorkerPosition
from app.services.site_operations import candidate_polygon_for_assignment
from app.services.site_shared_evidence import create_worker_outlooks_from_site_maps

NOW = datetime(2026, 8, 21, 18, 0, tzinfo=UTC)


def fc(ring):
    closed = ring if ring[0] == ring[-1] else [*ring, ring[0]]
    return PolygonFeatureCollection.model_validate({
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "properties": {},
            "geometry": {"type": "Polygon", "coordinates": [closed]},
        }],
    })


def master():
    return fc([
        [-112.0800, 33.4400],
        [-112.0680, 33.4400],
        [-112.0680, 33.4540],
        [-112.0800, 33.4540],
    ])


def zone(zone_id, name, kind, ring, *, relocation=True, active=True):
    return SiteOperationalZone(
        zone_id=zone_id,
        name=name,
        zone_type=kind,
        active=active,
        relocation_allowed=relocation,
        polygon=fc(ring),
    )


WORK_A = [
    [-112.0760, 33.4460],
    [-112.0730, 33.4460],
    [-112.0730, 33.4500],
    [-112.0760, 33.4500],
]
WORK_B = [
    [-112.0728, 33.4460],
    [-112.0695, 33.4460],
    [-112.0695, 33.4500],
    [-112.0728, 33.4500],
]
RECOVERY = [
    [-112.0750, 33.4502],
    [-112.0725, 33.4502],
    [-112.0725, 33.4525],
    [-112.0750, 33.4525],
]
RESTRICTED = [
    [-112.0715, 33.4502],
    [-112.0690, 33.4502],
    [-112.0690, 33.4525],
    [-112.0715, 33.4525],
]


def location():
    return USSiteLocation(
        site_id="S1",
        name="Phoenix Yard",
        city="Phoenix",
        state="Arizona",
        latitude=33.4480,
        longitude=-112.0745,
    )


def assignment(worker_id, latitude, longitude, zone_id, *, allowed=None, relocation=True):
    return SiteWorkerAssignment(
        worker=WorkerContext(
            worker_id=worker_id,
            site_id="S1",
            zone_id=zone_id,
            acclimatized=True,
        ),
        task=TaskContext(
            task_id=f"T-{worker_id}",
            task_name="Outdoor task",
            workload_level="moderate",
            exposure_duration_minutes=60,
            outdoor=True,
            direct_sun=True,
        ),
        position=SiteWorkerPosition(latitude=latitude, longitude=longitude, label=zone_id),
        spatial_relocation_allowed=relocation,
        allowed_zone_ids=allowed or [],
    )


def zones():
    return [
        zone("WORK-A", "Roof East", "work", WORK_A),
        zone("WORK-B", "Roof West", "work", WORK_B),
        zone("RECOVERY-A", "Recovery A", "recovery", RECOVERY),
        zone("NO-GO", "Equipment Compound", "restricted", RESTRICTED, relocation=False),
    ]


def zoned_request(assignments, **values):
    data = dict(
        location=location(),
        site_polygon=master(),
        operational_zones=zones(),
        assignments=assignments,
        forecast_offset_hours=[1, 3],
    )
    data.update(values)
    return SiteOperationsRequest(**data)


def test_legacy_zone_equal_to_master_boundary_is_accepted():
    legacy = SiteOperationalZone(
        zone_id="ZONE-PRIMARY",
        name="Primary Work Area",
        zone_type="work",
        relocation_allowed=True,
        polygon=master(),
    )
    request = SiteOperationsRequest(
        location=location(),
        site_polygon=master(),
        operational_zones=[legacy],
        assignments=[assignment("W1", 33.4480, -112.0745, "ZONE-PRIMARY")],
    )
    assert request.operational_zones[0].zone_id == "ZONE-PRIMARY"


def test_worker_must_be_inside_assigned_active_work_zone():
    with pytest.raises(ValidationError, match="position must fall inside assigned work zone"):
        zoned_request([assignment("W1", 33.4480, -112.0705, "WORK-A")])


def test_worker_cannot_be_assigned_to_restricted_zone():
    with pytest.raises(ValidationError, match="requires an active work zone"):
        zoned_request([assignment("W1", 33.4510, -112.0700, "NO-GO")])


def test_restricted_zone_cannot_be_an_allowed_alternative():
    with pytest.raises(ValidationError, match="invalid allowed zone NO-GO"):
        zoned_request([assignment("W1", 33.4480, -112.0745, "WORK-A", allowed=["NO-GO"])])


def test_candidate_geometry_uses_only_current_and_allowed_relocation_zones():
    item = assignment(
        "W1",
        33.4480,
        -112.0745,
        "WORK-A",
        allowed=["RECOVERY-A"],
    )
    request = zoned_request([item])
    polygon = candidate_polygon_for_assignment(request, item)
    assert polygon is not None
    assert len(polygon.features) == 2
    rings = [feature.geometry.coordinates[0] for feature in polygon.features]
    assert WORK_A[0] in rings[0] or WORK_A[0] in rings[1]
    assert RECOVERY[0] in rings[0] or RECOVERY[0] in rings[1]
    assert all(RESTRICTED[0] not in ring for ring in rings)


def test_fixed_worker_has_no_spatial_candidate_geometry():
    item = assignment("W1", 33.4480, -112.0745, "WORK-A", relocation=False)
    request = zoned_request([item])
    assert candidate_polygon_for_assignment(request, item) is None


def heat_tile(lon, lat, temperature, size=0.0010):
    ring = [
        [lon - size, lat - size],
        [lon + size, lat - size],
        [lon + size, lat + size],
        [lon - size, lat + size],
        [lon - size, lat - size],
    ]
    return {
        "type": "Feature",
        "properties": {"average_temperature": temperature},
        "geometry": {"type": "Polygon", "coordinates": [ring]},
    }


class SharedForecastClient:
    def __init__(self):
        self.created = []

    async def create_heatmap(self, request):
        activity_id = f"forecast-{len(self.created) + 1}"
        self.created.append((activity_id, request))
        return activity_id

    async def wait_for_result(self, activity_id):
        return FortyGuardJobStatus(
            activity_id=activity_id,
            status="Completed",
            result={
                "map_data": {
                    "type": "FeatureCollection",
                    "features": [
                        heat_tile(-112.0745, 33.4480, 40.0),
                        heat_tile(-112.0710, 33.4480, 34.0),
                    ],
                }
            },
        )


@pytest.mark.asyncio
async def test_shared_forecast_maps_scale_with_samples_not_workers():
    first = assignment("W1", 33.4480, -112.0745, "WORK-A")
    second = assignment("W2", 33.4480, -112.0710, "WORK-B")
    request = zoned_request([first, second], include_spatial_intelligence=False)
    client = SharedForecastClient()

    outlooks, attempts = await create_worker_outlooks_from_site_maps(
        request,
        client=client,
        now=NOW,
    )

    assert len(client.created) == 2
    assert attempts == 2
    assert outlooks["W1"].summary.available_points == 2
    assert outlooks["W2"].summary.available_points == 2
    assert {point.temperature_c for point in outlooks["W1"].points} == {40.0}
    assert {point.temperature_c for point in outlooks["W2"].points} == {34.0}
