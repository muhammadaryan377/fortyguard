import logging

from fastapi import FastAPI

from app.api.routes import router
from app.api.risk import router as risk_router


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
    version="0.1.0",
)


app.include_router(
    router,
    prefix="/api",
)
app.include_router(risk_router, prefix="/api")


@app.get("/")
async def root():
    return {
        "project": "HeatShield AI",
        "status": "running",
        "stage": "ASSESS",
    }
