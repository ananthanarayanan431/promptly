"""
Council Vote node — Round 1: Gather Opinions.

Each council model independently optimizes the raw prompt using the same unified
optimization framework. No model sees any other model's output in this round —
responses are fully independent. The diversity of model architectures and training
gives the critic round and the chairman meaningful variation to work with.
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


async def council_vote_node(state: GraphState) -> dict[str, Any]:
    """
    LangGraph node — Round 1.

    Sends the raw prompt to all council models in parallel. Each model independently
    produces its own optimized version using the same unified framework.
    Emits a progress event to Redis after each individual model completes.

    Returns:
        {"council_responses": [{model, optimized_prompt, usage}, ...]}
    """
    raw_prompt = state["raw_prompt"]
    feedback = state.get("feedback")
    job_id = state.get("job_id")
    models = _get_council_models()
    total = len(models)
    done_count = [0]
    lock = asyncio.Lock()

    async def optimize(model: ChatOpenAI) -> dict[str, Any]:
        response = await model.ainvoke(council_optimizer_messages(raw_prompt, feedback))
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
                job_id, {"step": "council", "done": n, "total": total, "ts": time.time()}
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
                "Council model %d failed: %s: %s",
                i,
                type(r).__name__,
                r,
            )

    return {"council_responses": valid}
