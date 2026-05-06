"""
Performance Gate node — runs before council_vote.

Scores the raw prompt on the same 8 dimensions used by quality_gate and short-circuits
the pipeline when the prompt is already production-grade, saving 3–4 LLM calls and
refunding 5 user credits.

Pass condition (all three must hold):
  1. goal_clarity == "strong"  (non-negotiable)
  2. Zero dimensions scored "missing"
  3. At most 1 dimension scored "weak"

Fail-open: any LLM error or JSON parse failure → already_optimized=False,
proceed to council. A flaky gate call must never block legitimate optimization.
"""

import asyncio
import json
import logging
import time
from typing import Any

from langchain_openai import ChatOpenAI

from app.config.llm import get_llm_settings
from app.core.cache import push_job_progress
from app.graph.prompts import performance_gate_messages
from app.graph.state import GraphState

logger = logging.getLogger(__name__)

_DIMENSIONS = (
    "role_persona",
    "goal_clarity",
    "context_grounding",
    "output_format",
    "examples_exemplars",
    "constraints_guardrails",
    "tone_audience",
    "conciseness",
)

_loop_id: int | None = None
_gate_model: ChatOpenAI | None = None


def _get_gate_model() -> ChatOpenAI:
    """ChatOpenAI binds httpx to the running loop; Celery uses a new loop per task."""
    global _loop_id, _gate_model
    loop = asyncio.get_running_loop()
    lid = id(loop)
    if _loop_id != lid or _gate_model is None:
        llm_settings = get_llm_settings()
        _loop_id = lid
        _gate_model = ChatOpenAI(
            model="openai/gpt-4o-mini",
            openai_api_base="https://openrouter.ai/api/v1",
            openai_api_key=llm_settings.OPENROUTER_API_KEY.get_secret_value(),
        )
    return _gate_model


_VALID_LABELS: frozenset[str] = frozenset({"strong", "weak", "missing"})


def _scores_satisfy_bar(scores: dict[str, str]) -> bool:
    """Deterministically apply the pass condition to a scores dict."""
    if set(scores.keys()) != set(_DIMENSIONS):
        return False
    if any(not isinstance(v, str) or v not in _VALID_LABELS for v in scores.values()):
        return False
    if scores.get("goal_clarity") != "strong":
        return False
    missing_count = sum(1 for v in scores.values() if v == "missing")
    weak_count = sum(1 for v in scores.values() if v == "weak")
    return missing_count == 0 and weak_count <= 1


def _parse_response(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if text.startswith("```"):
        inner = text.split("```")[1]
        if inner.startswith("json"):
            inner = inner[4:]
        text = inner.strip()
    result: dict[str, Any] = json.loads(text)
    return result


async def performance_gate_node(state: GraphState) -> dict[str, Any]:
    """
    LangGraph node — Performance Gate.

    Returns a partial state dict. Only sets already_optimized=True (and companion
    fields) when the raw prompt definitively clears the strict pass bar.
    All other paths return already_optimized=False so council_vote proceeds.
    """
    raw = state.get("raw_prompt", "").strip()
    job_id = state.get("job_id")

    try:
        response = await _get_gate_model().ainvoke(performance_gate_messages(raw))
        gate = _parse_response(str(response.content))
    except Exception:
        logger.exception("performance_gate LLM call or parse failed — proceeding to council")
        return {"already_optimized": False}

    scores = gate.get("scores", {})
    rationale = gate.get("rationale", "")
    if not isinstance(scores, dict) or not isinstance(rationale, str):
        logger.warning("performance_gate unexpected types, proceeding to council: %r", gate)
        return {"already_optimized": False}

    # Deterministic pass check — overrides any LLM verdict in the "already_optimized" field
    passes = _scores_satisfy_bar(scores)

    if job_id:
        await push_job_progress(
            job_id,
            {
                "step": "performance_gate",
                "decision": "exit" if passes else "proceed",
                "ts": time.time(),
            },
        )

    if not passes:
        return {"already_optimized": False}

    return {
        "already_optimized": True,
        "gate_dimension_scores": {d: scores.get(d, "missing") for d in _DIMENSIONS},
        "gate_rationale": rationale,
        "final_response": raw,
        "council_responses": [],
        "critic_responses": [],
    }
