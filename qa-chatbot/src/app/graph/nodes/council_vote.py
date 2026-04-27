"""
Council Vote node — Round 1: Gather Opinions.

Each council model independently optimizes the raw prompt using the same unified
optimization framework. No model sees any other model's output in this round —
responses are fully independent.

On refinement iterations (iteration_count > 0) additionally receives:
  - version_history_diff: trajectory of prior versions in the family
  - previous_synthesis: last iteration's output — must be surpassed
  - quality_gaps: dimensions flagged as still weak/missing by critics last pass
"""

import asyncio
import logging
import time
from typing import Any

from langchain_openai import ChatOpenAI

from app.config.llm import get_llm_settings
from app.core.cache import push_job_progress
from app.graph.prompts import council_optimizer_messages
from app.graph.state import GraphState

logger = logging.getLogger(__name__)

_council_loop_id: int | None = None
_council_models: list[ChatOpenAI] | None = None


def _build_models() -> list[ChatOpenAI]:
    llm_settings = get_llm_settings()
    return [
        ChatOpenAI(
            model=m,
            openai_api_base="https://openrouter.ai/api/v1",
            openai_api_key=llm_settings.OPENROUTER_API_KEY.get_secret_value(),
        )
        for m in llm_settings.COUNCIL_MODELS
    ]


def _get_council_models() -> list[ChatOpenAI]:
    """Models bind httpx to the running loop; Celery uses a new loop per task."""
    global _council_loop_id, _council_models
    loop = asyncio.get_running_loop()
    lid = id(loop)
    if _council_loop_id != lid or _council_models is None:
        _council_loop_id = lid
        _council_models = _build_models()
    return _council_models


def _extract_quality_gaps(state: GraphState) -> list[str]:
    """Pull consensus quality gaps for the next council pass.

    Checks two sources in priority order:
    1. critic_responses — gate-triggered weak_dimensions sentinel (_quality_gate: True)
    2. council_responses — consensus _quality_gaps attached by the critic node
    """
    # Gate-triggered feedback takes priority (most recent pass)
    for cr in reversed(state.get("critic_responses", [])):
        if cr.get("_quality_gate"):
            dims = cr.get("weak_dimensions", [])
            if isinstance(dims, list) and dims:
                return dims

    # Critic-consensus gaps from the last council pass
    for p in reversed(state.get("council_responses", [])):
        gaps = p.get("_quality_gaps")
        if isinstance(gaps, list) and gaps:
            return gaps

    return []


async def council_vote_node(state: GraphState) -> dict[str, Any]:
    """
    LangGraph node — Round 1 (and refinement re-runs).

    On iteration 0: optimize raw_prompt with feedback + version history.
    On iteration N>0: additionally pass the previous synthesis and quality gaps
    so each model knows exactly what to surpass and what gaps to fix.
    """
    raw_prompt = state["raw_prompt"]
    feedback = state.get("feedback")
    version_history_diff = state.get("version_history_diff")
    previous_synthesis = state.get("previous_synthesis")
    iteration = state.get("iteration_count", 0)
    job_id = state.get("job_id")

    # Quality gaps are only meaningful on refinement passes
    quality_gaps = _extract_quality_gaps(state) if iteration > 0 else []

    models = _get_council_models()
    total = len(models)
    done_count = [0]
    lock = asyncio.Lock()

    async def optimize(model: ChatOpenAI) -> dict[str, Any]:
        messages = council_optimizer_messages(
            raw_prompt=raw_prompt,
            feedback=feedback,
            version_history_diff=version_history_diff,
            previous_synthesis=previous_synthesis if iteration > 0 else None,
            quality_gaps=quality_gaps if quality_gaps else None,
        )
        response = await model.ainvoke(messages)
        result: dict[str, Any] = {
            "model": model.model_name,
            "optimized_prompt": str(response.content).strip(),
            "usage": getattr(response, "usage_metadata", {}) or {},
        }
        if job_id:
            async with lock:
                done_count[0] += 1
                n = done_count[0]
            await push_job_progress(
                job_id,
                {
                    "step": "council",
                    "iteration": iteration,
                    "done": n,
                    "total": total,
                    "ts": time.time(),
                },
            )
        return result

    results = await asyncio.gather(
        *[optimize(m) for m in models],
        return_exceptions=True,
    )

    valid = []
    for i, r in enumerate(results):
        if isinstance(r, dict):
            valid.append(r)
        else:
            logger.error(
                "Council model %d failed (iteration %d): %s: %s",
                i,
                iteration,
                type(r).__name__,
                r,
            )

    return {"council_responses": valid}
