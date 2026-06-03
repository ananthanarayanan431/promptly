"""
Critic node — Round 2: Every Model Becomes a Critic.

Each council model reviews the OTHER 3 models' proposals — never its own.
Proposals are presented anonymously (Proposal A / B / C) so no model knows
who wrote what. This eliminates brand bias and forces evaluation on quality alone.

Now also receives:
  - raw_prompt + feedback: so critics judge improvement over original and honour directives
  - previous_synthesis: so critics detect regressions from prior refinement iterations

All 4 critiques run in parallel. Each returns ranking + per-proposal 8-dimension scores +
quality_gaps (dimensions still weak/missing across ALL proposals) as JSON.
"""

import asyncio
import json
import time
from collections import Counter
from typing import Any

from app.core.cache import push_job_progress
from app.graph.prompts import critic_messages, subject_analysis_block
from app.graph.state import GraphState
from app.llm import LLMClient
from app.llm.pipeline import build_critic_models
from app.utils.log import get_logger

log = get_logger(__name__)

_critic_loop_id: int | None = None
_critic_models: list[LLMClient] | None = None


def _get_critic_models() -> list[LLMClient]:
    """Models bind httpx to the running loop; Celery uses a new loop per task."""
    global _critic_loop_id, _critic_models
    loop = asyncio.get_running_loop()
    lid = id(loop)
    if _critic_loop_id != lid or _critic_models is None:
        _critic_loop_id = lid
        _critic_models = build_critic_models()
    models = _critic_models
    if models is None:
        raise RuntimeError("critic models failed to initialise")
    return models


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


def _collect_quality_gaps(valid: list[dict[str, Any]]) -> list[str]:
    """
    Aggregate quality_gaps across all critic responses.
    A gap reaches consensus if flagged by >= half the critics.
    These become directives injected into the next council pass.
    """
    gap_counter: Counter[str] = Counter()
    for cr in valid:
        for gap in cr.get("quality_gaps", []):
            if isinstance(gap, str):
                gap_counter[gap.strip()] += 1
    threshold = max(1, (len(valid) + 1) // 2)
    return [gap for gap, count in gap_counter.items() if count >= threshold]


async def critic_node(state: GraphState) -> dict[str, Any]:
    """
    LangGraph node — Round 2.

    Each model critiques the other 3 proposals in parallel, now with full context:
    original prompt, optional user feedback, optional previous synthesis.

    Returns:
        {
          "critic_responses": [{reviewer_model, ranking, critiques, ranking_rationale,
                                quality_gaps, dimension_scores}, ...],
          "council_responses": proposals with _quality_gaps attached for next council pass
        }
    """
    proposals = state["council_responses"]
    raw_prompt = state["raw_prompt"]
    feedback = state.get("feedback")
    previous_synthesis = state.get("previous_synthesis")
    subject_block = subject_analysis_block(
        state.get("subject_about"),
        state.get("subject_suggestions"),
    )

    if len(proposals) < 4:
        log.warning("critic_skipped_insufficient_proposals", count=len(proposals))
        if job_id := state.get("job_id"):
            await push_job_progress(job_id, {"step": "critic", "ts": time.time()})
        return {"critic_responses": []}

    all_labels = ["A", "B", "C", "D"][: len(proposals)]

    async def critique(model: LLMClient, reviewer_idx: int) -> dict[str, Any]:
        # Build (label, text) pairs for every proposal EXCEPT the reviewer's own.
        # Labels stay consistent with the full set so the synthesizer can cross-reference.
        others = [
            (all_labels[i], p["optimized_prompt"])
            for i, p in enumerate(proposals)
            if i != reviewer_idx
        ]
        messages = critic_messages(
            raw_prompt=raw_prompt,
            proposals=others,
            feedback=feedback,
            previous_synthesis=previous_synthesis,
            subject_block=subject_block,
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
    failed = len(results) - len(valid)
    if failed:
        log.warning("critic_models_failed", failed=failed, total=len(results))
    quality_gaps = _collect_quality_gaps(valid)
    log.info("critic_complete", critics=len(valid), quality_gaps=quality_gaps)

    if job_id := state.get("job_id"):
        await push_job_progress(job_id, {"step": "critic", "ts": time.time()})

    return {
        "critic_responses": valid,
        # Surface consensus gaps on proposals so council_vote picks them up next iteration
        "council_responses": [{**p, "_quality_gaps": quality_gaps} for p in proposals],
    }
