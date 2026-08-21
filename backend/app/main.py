import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.api.risk import router as risk_router
from app.api.predict import router as predict_router
from app.api.agent import router as agent_router
from app.api.cycle import router as cycle_router
from app.api.spatial import router as spatial_router
from app.api.optimize import router as optimize_router
from app.api.site import router as site_router
from app.api.location import router as location_router
from app.api.weather_context import router as weather_context_router
from app.core.config import settings


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)


app = FastAPI(
    title="HeatShield AI API",
    description=(
        "Agentic hyperlocal heat-risk intelligence "
        "for outdoor worker safety."
    ),
    version="0.3.0",
)


cors_origins = [
    origin.strip()
    for origin in settings.heatshield_cors_origins.split(",")
    if origin.strip()
]

if cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )


app.include_router(router, prefix="/api")
app.include_router(risk_router, prefix="/api")
app.include_router(predict_router, prefix="/api")
app.include_router(agent_router, prefix="/api")
app.include_router(cycle_router, prefix="/api")
app.include_router(spatial_router, prefix="/api")
app.include_router(optimize_router, prefix="/api")
app.include_router(site_router, prefix="/api")
app.include_router(location_router, prefix="/api")
app.include_router(weather_context_router, prefix="/api")


@app.get("/")
async def root():
    return {
        "project": "HeatShield AI",
        "status": "running",
        "stage": "product_v4",
    }
