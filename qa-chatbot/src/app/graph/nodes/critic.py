"""
Critic node — Round 2: Every Model Becomes a Critic.

Each council model reviews the OTHER 3 models' proposals — never its own.
Proposals are presented anonymously (Proposal A / B / C) so no model knows
who wrote what. This eliminates brand bias and forces evaluation on quality alone.

All 4 critiques run in parallel. Each returns a ranking + per-proposal critique as JSON.
"""

import asyncio
import json
import time
from typing import Any

from langchain_openai import ChatOpenAI

from app.config.llm import get_llm_settings
from app.core.cache import push_job_progress
from app.graph.prompts import critic_messages
from app.graph.state import GraphState

_critic_loop_id: int | None = None
_critic_models: list[ChatOpenAI] | None = None


def _build_critic_models() -> list[ChatOpenAI]:
    llm_settings = get_llm_settings()
    return [
        ChatOpenAI(
            model=m,
            openai_api_base="https://openrouter.ai/api/v1",
            openai_api_key=llm_settings.OPENROUTER_API_KEY.get_secret_value(),
        )
        for m in llm_settings.COUNCIL_MODELS
    ]


def _get_critic_models() -> list[ChatOpenAI]:
    """Models bind httpx to the running loop; Celery uses a new loop per task."""
    global _critic_loop_id, _critic_models
    loop = asyncio.get_running_loop()
    lid = id(loop)
    if _critic_loop_id != lid or _critic_models is None:
        _critic_loop_id = lid
        _critic_models = _build_critic_models()
    return _critic_models


def _parse_critique(raw: str) -> dict[str, Any]:
    """Strip accidental markdown fences and parse JSON."""
    text = raw.strip()
    if text.startswith("```"):
        inner = text.split("```")[1]
        if inner.startswith("json"):
            inner = inner[4:]
        text = inner.strip()
    result: dict[str, Any] = json.loads(text)
    return result


async def critic_node(state: GraphState) -> dict[str, Any]:
    """
    LangGraph node — Round 2.

    Each model critiques the other 3 proposals in parallel.
    Returns:
        {"critic_responses": [{reviewer_model, ranking, critiques, ranking_rationale}, ...]}
    """
    proposals = state["council_responses"]
    raw_prompt = state["raw_prompt"]

    if len(proposals) < 4:
        if job_id := state.get("job_id"):
            await push_job_progress(job_id, {"step": "critic", "ts": time.time()})
        return {"critic_responses": []}

    async def critique(model: ChatOpenAI, reviewer_idx: int) -> dict[str, Any]:
        others = [p for i, p in enumerate(proposals) if i != reviewer_idx]
        # others always has exactly 3 items: proposals has 4 and we exclude one
        messages = critic_messages(
            raw_prompt=raw_prompt,
            proposal_a=others[0]["optimized_prompt"],
            proposal_b=others[1]["optimized_prompt"],
            proposal_c=others[2]["optimized_prompt"],
        )
        response = await model.ainvoke(messages)
        parsed = _parse_critique(str(response.content))
        return {
            "reviewer_model": model.model_name,
            **parsed,
        }

    results = await asyncio.gather(
        *[critique(m, i) for i, m in enumerate(_get_critic_models()) if i < len(proposals)],
        return_exceptions=True,
    )

    valid = [r for r in results if isinstance(r, dict)]

    if job_id := state.get("job_id"):
        await push_job_progress(job_id, {"step": "critic", "ts": time.time()})

    return {"critic_responses": valid}
