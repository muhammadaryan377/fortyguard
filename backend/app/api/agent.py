"""Constrained DECIDE endpoint."""

from fastapi import APIRouter, HTTPException

from app.models.operations import AgentDecisionRequest, AgentDecisionResponse
from app.services.agent_decision import decide

router = APIRouter(prefix="/agent", tags=["Agent decision"])


@router.post("/decide", response_model=AgentDecisionResponse)
async def agent_decide(payload: AgentDecisionRequest) -> AgentDecisionResponse:
    result = await decide(payload)
    if result.status == "agent_unavailable":
        raise HTTPException(status_code=503, detail="DeepSeek decision service is unavailable")
    return result
