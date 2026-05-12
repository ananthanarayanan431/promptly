"""
Synthesize node — Round 3: The Chairman.

Receives all 4 council proposals AND all 4 peer critiques (rankings + weakness analysis).
Uses the critique consensus to identify the strongest base proposal, patch confirmed
weaknesses, and produce the single definitive optimized prompt.
"""

import asyncio
import time
from typing import Any

from app.core.cache import push_job_progress
from app.graph.prompts import category_guidance_block, synthesize_messages
from app.graph.state import GraphState
from app.llm import LLMClient
from app.llm.pipeline import build_synthesizer

_loop_id: int | None = None
_synthesizer: LLMClient | None = None


def _get_synthesizer() -> LLMClient:
    """LLMClient binds httpx to the running loop; Celery uses a new loop per task."""
    global _loop_id, _synthesizer
    loop = asyncio.get_running_loop()
    lid = id(loop)
    if _loop_id != lid or _synthesizer is None:
        _loop_id = lid
        _synthesizer = build_synthesizer()
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
        rationale = cr.get("ranking_rationale", "")
        critiques: dict[str, Any] = cr.get("critiques", {})

        proposal_lines = []
        for label, detail in critiques.items():
            if not isinstance(detail, dict):
                proposal_lines.append(f"  {label}: {detail}")
                continue
            dims = detail.get("dimension_scores", {})
            weak_dims = [d for d, s in dims.items() if s in ("weak", "missing")]
            dim_summary = (
                f"weak/missing: {', '.join(weak_dims)}" if weak_dims else "all dimensions strong"
            )
            primary = detail.get("primary_weakness", "")
            failure = detail.get("failure_mode", "")
            proposal_lines.append(
                f"  {label}: [{dim_summary}]\n"
                f"    Primary weakness: {primary}\n"
                f"    Failure mode: {failure}"
            )

        reviews.append(
            f"[Critic {_LABELS[i]}]\n"
            f"Ranking: {ranking}\n"
            f"Rationale: {rationale}\n" + "\n".join(proposal_lines)
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

    # Collect quality gaps. The quality_gate node attaches refinement gaps under
    # "weak_dimensions" on a sentinel entry; the critic node attaches them under
    # "quality_gaps" on regular entries. Prefer whichever is most recent.
    quality_gaps: list[str] = []
    for cr in reversed(critic_responses):
        if cr.get("_quality_gate"):
            weak = cr.get("weak_dimensions")
            if isinstance(weak, list) and weak:
                quality_gaps = weak
                break
            continue
        gaps = cr.get("quality_gaps")
        if isinstance(gaps, list) and gaps:
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
