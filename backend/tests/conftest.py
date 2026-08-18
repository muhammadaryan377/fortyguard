from collections.abc import Callable
from typing import Any

import httpx
import pytest

from app.services.fortyguard import FortyGuardClient


@pytest.fixture
def client_factory() -> Callable[[Callable[[httpx.Request], httpx.Response]], FortyGuardClient]:
    def factory(handler: Callable[[httpx.Request], httpx.Response]) -> FortyGuardClient:
        transport = httpx.MockTransport(handler)
        http_client = httpx.AsyncClient(transport=transport)
        return FortyGuardClient(
            api_key="test-secret-key",
            base_url="https://api.fortyguard.test",
            client=http_client,
        )

    return factory


@pytest.fixture
def heatmap_payload() -> dict[str, Any]:
    return {
        "polygon_aoi": {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]],
                    },
                }
            ],
        },
        "date_time": {
            "start_date": "2024-07-15",
            "start_time": "14:00",
            "filter_type": 1,
        },
        "granularity": 100,
    }
