import logging

from fastapi import FastAPI

from app.api.routes import router
from app.api.risk import router as risk_router
from app.api.predict import router as predict_router
from app.api.agent import router as agent_router
from app.api.cycle import router as cycle_router
from app.api.spatial import router as spatial_router
from app.api.optimize import router as optimize_router
from app.api.site import router as site_router
from app.api.location import router as location_router


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
    version="0.2.0",
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


@app.get("/")
async def root():
    return {
        "project": "HeatShield AI",
        "status": "running",
        "stage": "product_v3",
    }
