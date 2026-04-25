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
from app.graph.prompts import synthesize_messages
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
    return "\n\n".join(
        f"[Proposal {_LABELS[i]}]:\n{r['optimized_prompt']}"
        for i, r in enumerate(council_responses)
    )


def _build_critiques_block(critic_responses: list[dict[str, Any]]) -> str:
    if not critic_responses:
        return "(No critic reviews available — synthesize from proposals only.)"
    reviews = []
    for i, cr in enumerate(critic_responses):
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
    proposals_block = _build_proposals_block(state["council_responses"])
    critiques_block = _build_critiques_block(state.get("critic_responses") or [])

    response = await _get_synthesizer().ainvoke(
        synthesize_messages(
            raw_prompt=state["raw_prompt"],
            proposals_block=proposals_block,
            critiques_block=critiques_block,
            feedback=state.get("feedback"),
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
