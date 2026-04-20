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
from app.graph.prompts import load_prompt
from app.graph.state import GraphState

llm_settings = get_llm_settings()

_CRITIC_PROMPT = load_prompt("critic")

_critic_loop_id: int | None = None
_critic_models: list[ChatOpenAI] | None = None


def _build_critic_models() -> list[ChatOpenAI]:
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


def _build_review_message(
    raw_prompt: str,
    proposals: list[dict[str, Any]],
    reviewer_idx: int,
) -> str:
    """
    Build the user message for one critic.

    The reviewer sees every proposal EXCEPT its own (reviewer_idx is excluded).
    Proposals are re-labelled A / B / C so the reviewer cannot infer authorship.
    """
    others = [p for i, p in enumerate(proposals) if i != reviewer_idx]
    labels = [chr(ord("A") + i) for i in range(len(others))]  # A, B, C

    proposal_block = "\n\n".join(
        f"Proposal {label}:\n{p['optimized_prompt']}"
        for label, p in zip(labels, others, strict=False)
    )

    return f"Original prompt:\n{raw_prompt}\n\n---\n\n{proposal_block}"


def _parse_critique(raw: str) -> dict[str, Any]:
    """Strip accidental markdown fences and parse JSON."""
    text = raw.strip()
    if text.startswith("```"):
        # ```json ... ``` or ``` ... ```
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

    if len(proposals) < 2:
        # Not enough proposals to critique — skip this round
        return {"critic_responses": []}

    async def critique(model: ChatOpenAI, reviewer_idx: int) -> dict[str, Any]:
        user_msg = _build_review_message(raw_prompt, proposals, reviewer_idx)
        response = await model.ainvoke(
            [
                {"role": "system", "content": _CRITIC_PROMPT},
                {"role": "user", "content": user_msg},
            ]
        )
        parsed = _parse_critique(str(response.content))
        return {
            "reviewer_model": llm_settings.COUNCIL_MODELS[reviewer_idx],
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
