"""Task-local operational polygon context for bounded spatial cycle orchestration."""

from contextvars import ContextVar

from app.models.fortyguard import PolygonFeatureCollection


operational_polygon_context: ContextVar[PolygonFeatureCollection | None] = ContextVar(
    "heatshield_operational_polygon",
    default=None,
)
