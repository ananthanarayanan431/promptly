"""
Synthesize node — Round 3: The Chairman.

Receives all 4 council proposals AND all 4 peer critiques (rankings + weakness analysis).
Uses the critique consensus to identify the strongest base proposal, patch confirmed
weaknesses, and produce the single definitive optimized prompt.
"""

import asyncio
import time
from typing import Any

from langchain_openai import ChatOpenAI

from app.config.llm import get_llm_settings
from app.core.cache import push_job_progress
from app.graph.prompts import category_guidance_block, synthesize_messages
from app.graph.state import GraphState

_loop_id: int | None = None
_synthesizer: ChatOpenAI | None = None


def _get_synthesizer() -> ChatOpenAI:
    """ChatOpenAI binds httpx to the running loop; Celery uses a new loop per task."""
    global _loop_id, _synthesizer
    loop = asyncio.get_running_loop()
    lid = id(loop)
    if _loop_id != lid or _synthesizer is None:
        llm_settings = get_llm_settings()
        _loop_id = lid
        _synthesizer = ChatOpenAI(
            model=llm_settings.DEFAULT_MODEL,
            openai_api_base="https://openrouter.ai/api/v1",
            openai_api_key=llm_settings.OPENROUTER_API_KEY.get_secret_value(),
        )
    return _synthesizer


_LABELS = ["A", "B", "C", "D"]


def _build_proposals_block(council_responses: list[dict[str, Any]]) -> str:
    capped = council_responses[: len(_LABELS)]
    return "\n\n".join(
        f"[Proposal {_LABELS[i]}]:\n{r['optimized_prompt']}" for i, r in enumerate(capped)
    )


def _build_critiques_block(critic_responses: list[dict[str, Any]]) -> str:
    if not critic_responses:
        return "(No critic reviews available — synthesize from proposals only.)"
    capped = critic_responses[: len(_LABELS)]
    reviews = []
    for i, cr in enumerate(capped):
        ranking = ", ".join(cr.get("ranking", []))
        critiques = cr.get("critiques", {})
        critique_lines = "\n".join(f"  {label}: {text}" for label, text in critiques.items())
        rationale = cr.get("ranking_rationale", "")
        reviews.append(
            f"[Critic {_LABELS[i]}]\n"
            f"Ranking: {ranking}\n"
            f"Critiques:\n{critique_lines}\n"
            f"Rationale: {rationale}"
        )
    return "\n\n".join(reviews)


async def synthesize_node(state: GraphState) -> dict[str, Any]:
    """
    LangGraph node — Round 3 (Chairman).

    Synthesizes the final optimized prompt using all council proposals and
    all peer critique data.

    Returns:
        {"final_response": <best_optimized_prompt>, "token_usage": {"total_tokens": N}}
    """
    critic_responses = state.get("critic_responses") or []
    # Drop sentinel rows (e.g. quality_gate loop markers) and cap at len(_LABELS)
    # so _build_critiques_block's _LABELS[i] indexing is always in range.
    real_critics = [c for c in critic_responses if not c.get("_quality_gate")][: len(_LABELS)]
    proposals_block = _build_proposals_block(state["council_responses"])
    critiques_block = _build_critiques_block(real_critics)

    # Collect quality gaps from critic consensus (skip quality_gate sentinel entries)
    quality_gaps: list[str] = []
    for cr in reversed(critic_responses):
        gaps = cr.get("quality_gaps")
        if isinstance(gaps, list) and gaps and not cr.get("_quality_gate"):
            quality_gaps = gaps
            break

    category_block = category_guidance_block(
        category_slug=state.get("category_slug"),
        category_name=state.get("category_name"),
        category_description=state.get("category_description"),
        is_predefined=state.get("category_is_predefined", False),
    )

    response = await _get_synthesizer().ainvoke(
        synthesize_messages(
            raw_prompt=state["raw_prompt"],
            proposals_block=proposals_block,
            critiques_block=critiques_block,
            feedback=state.get("feedback"),
            previous_synthesis=state.get("previous_synthesis"),
            quality_gaps=quality_gaps if quality_gaps else None,
            category_block=category_block,
        )
    )

    total_tokens = sum(
        r.get("usage", {}).get("total_tokens", 0) for r in state["council_responses"]
    )

    if job_id := state.get("job_id"):
        await push_job_progress(job_id, {"step": "synthesize", "ts": time.time()})

    return {
        "final_response": str(response.content).strip(),
        "token_usage": {"total_tokens": total_tokens},
    }
