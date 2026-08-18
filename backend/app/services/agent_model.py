"""Small, injectable DeepSeek tool-selection adapter."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any, Protocol

from app.core.config import settings


class AgentModelError(Exception): pass
class AgentModelConfigurationError(AgentModelError): pass
class AgentModelTimeoutError(AgentModelError): pass
class AgentModelAPIError(AgentModelError): pass


@dataclass(frozen=True)
class ModelToolCall:
    name: str
    arguments: str


class AgentModel(Protocol):
    async def select_tools(self, evidence: dict[str, Any], tools: list[dict[str, Any]]) -> list[ModelToolCall]: ...


class DeepSeekAgentModel:
    """Uses DeepSeek non-thinking Chat Completions; text output is discarded."""

    def __init__(self) -> None:
        self.model_name = settings.heatshield_agent_model

    async def select_tools(self, evidence: dict[str, Any], tools: list[dict[str, Any]]) -> list[ModelToolCall]:
        if not settings.deepseek_api_key:
            raise AgentModelConfigurationError("DeepSeek API key is not configured")

        def call() -> Any:
            from openai import OpenAI
            client = OpenAI(
                api_key=settings.deepseek_api_key,
                base_url=settings.deepseek_base_url,
                timeout=settings.heatshield_agent_timeout_seconds,
            )
            return client.chat.completions.create(
                model=self.model_name,
                messages=[
                    {"role": "system", "content": "Select only eligible HeatShield tools. Tools take no arguments. Do not calculate facts."},
                    {"role": "user", "content": __import__("json").dumps(evidence, separators=(",", ":"))},
                ],
                tools=tools,
                tool_choice="auto",
                max_tokens=256,
                extra_body={"thinking": {"type": "disabled"}},
            )
        try:
            response = await asyncio.to_thread(call)
        except TimeoutError as exc:
            raise AgentModelTimeoutError("DeepSeek request timed out") from exc
        except Exception as exc:
            # Avoid reflecting SDK/provider messages, which may contain request data.
            if exc.__class__.__name__.lower().find("timeout") >= 0:
                raise AgentModelTimeoutError("DeepSeek request timed out") from exc
            raise AgentModelAPIError("DeepSeek tool selection failed") from exc
        try:
            calls = getattr(response.choices[0].message, "tool_calls", None) or []
            return [ModelToolCall(name=item.function.name, arguments=item.function.arguments) for item in calls]
        except (AttributeError, IndexError, TypeError) as exc:
            raise AgentModelAPIError("DeepSeek returned an invalid tool-selection response") from exc


AGENT_TOOLS = [
    {"type": "function", "function": {"name": name, "description": description, "parameters": {"type": "object", "properties": {}, "additionalProperties": False}}}
    for name, description in [
        ("propose_cool_recovery", "Propose an allowed cool recovery control."),
        ("propose_reduce_physical_demands", "Propose reducing physical demands."),
        ("propose_cooler_sampled_period", "Propose the server-selected cooler sampled period candidate."),
        ("propose_worker_monitoring", "Propose increased worker monitoring."),
        ("propose_limit_direct_sun", "Propose limiting direct sun exposure."),
        ("request_supervisor_review", "Request supervisor review."),
        ("propose_cooler_zone_candidate", "Propose the server-ranked cooler zone candidate."),
        ("propose_shift_plan_candidate", "Propose the server-ranked sampled-temperature shift plan candidate."),
    ]
]
