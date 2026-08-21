from datetime import UTC, datetime

import pytest

from app.models.fortyguard import FortyGuardJobStatus, PolygonFeatureCollection
from app.models.risk import USSiteLocation
from app.models.spatial import SpatialHeatRequest
from app.services.spatial_heat import analyze_spatial_features, create_spatial_heat


NOW = datetime(2026, 8, 21, 18, 0, tzinfo=UTC)


def location():
    return USSiteLocation(
        site_id="S1",
        name="Phoenix Site",
        city="Phoenix",
        state="Arizona",
        latitude=33.4484,
        longitude=-112.074,
    )


def square(lon, lat, value, size=0.00025):
    ring = [
        [lon - size, lat - size],
        [lon + size, lat - size],
        [lon + size, lat + size],
        [lon - size, lat + size],
        [lon - size, lat - size],
    ]
    return {
        "type": "Feature",
        "properties": {"average_temperature": value},
        "geometry": {"type": "Polygon", "coordinates": [ring]},
    }


def operational_polygon():
    return PolygonFeatureCollection.model_validate(
        {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[
                            [-112.0750, 33.4474],
                            [-112.0710, 33.4474],
                            [-112.0710, 33.4494],
                            [-112.0750, 33.4494],
                            [-112.0750, 33.4474],
                        ]],
                    },
                }
            ],
        }
    )


def test_cooler_candidates_are_filtered_by_submitted_operational_boundary():
    request = SpatialHeatRequest(
        location=location(),
        search_radius_meters=800,
        max_candidates=5,
        operational_polygon=operational_polygon(),
    )
    result = analyze_spatial_features(
        {
            "type": "FeatureCollection",
            "features": [
                square(-112.0740, 33.4484, 40),
                square(-112.0720, 33.4484, 35),
                square(-112.0705, 33.4484, 30),
            ],
        },
        request,
        generated_at=NOW,
        activity_id="spatial-boundary",
    )

    assert result.status == "available"
    assert [candidate.temperature_c for candidate in result.candidates] == [35]
    assert result.candidates[0].inside_operational_boundary is True

    outside_tile = next(tile for tile in result.tiles if tile.temperature_c == 30)
    assert outside_tile.inside_operational_boundary is False
    assert any("operational site boundary" in item for item in result.limitations)


class RecordingClient:
    def __init__(self):
        self.request = None

    async def create_heatmap(self, request):
        self.request = request
        return "activity-1"

    async def wait_for_result(self, activity_id):
        return FortyGuardJobStatus(
            activity_id=activity_id,
            status="Completed",
            result={
                "map_data": {
                    "type": "FeatureCollection",
                    "features": [square(-112.0740, 33.4484, 40)],
                }
            },
        )


@pytest.mark.asyncio
async def test_spatial_provider_uses_exact_operational_polygon_as_aoi():
    polygon = operational_polygon()
    request = SpatialHeatRequest(
        location=location(),
        search_radius_meters=800,
        operational_polygon=polygon,
    )
    client = RecordingClient()

    await create_spatial_heat(request, client=client, clock=lambda: NOW)

    assert client.request is not None
    assert client.request.polygon_aoi == polygon
    assert client.request.analytic_type == "tcm"
