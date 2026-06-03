"""
Subject Classifier node — runs between performance_gate/intent_classifier and council_vote.

Produces a compact two-section analysis of the input prompt:
  - subject_about:       ≤4 points on what the prompt is about
  - subject_suggestions: equal count of enhancement suggestions

On feedback turns, state["feedback"] is passed to the prompt builder, which folds
the feedback into the first suggestion point (see prompts/subject_classifier.py).

Fail-open: any LLM error or parse failure → both fields None, pipeline continues.
The quality-gate refinement loop re-enters at council_vote, so this node does NOT
re-run on refinement iterations — it runs once per user turn.
"""

import asyncio
import json
import time
from typing import Any

from app.core.cache import push_job_progress
from app.graph.prompts.subject_classifier import subject_classifier_messages
from app.graph.state import GraphState
from app.llm import LLMClient
from app.llm.pipeline import build_subject_classifier
from app.utils.log import get_logger

log = get_logger(__name__)

_loop_id: int | None = None
_model: LLMClient | None = None


def _get_model() -> LLMClient:
    """LLMClient binds httpx to the running loop; Celery uses a new loop per task."""
    global _loop_id, _model
    loop = asyncio.get_running_loop()
    lid = id(loop)
    if _loop_id != lid or _model is None:
        _loop_id = lid
        _model = build_subject_classifier()
    m = _model
    if m is None:
        raise RuntimeError("subject classifier model failed to initialise")
    return m


def _parse_response(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if text.startswith("```"):
        inner = text.split("```")[1]
        if inner.startswith("json"):
            inner = inner[4:]
        text = inner.strip()
    result: dict[str, Any] = json.loads(text)
    return result


def _normalize(
    about_raw: Any,  # noqa: ANN401
    suggestions_raw: Any,  # noqa: ANN401
) -> tuple[list[str] | None, list[str] | None]:
    """Coerce, cap at 4, truncate both to equal length."""

    def coerce(lst: Any) -> list[str]:  # noqa: ANN401
        if not isinstance(lst, list):
            return []
        return [s.strip() for s in lst if isinstance(s, str) and s.strip()][:4]

    about = coerce(about_raw)
    suggestions = coerce(suggestions_raw)
    n = min(len(about), len(suggestions))
    if n == 0:
        return None, None
    return about[:n], suggestions[:n]


async def subject_classifier_node(state: GraphState) -> dict[str, Any]:
    """
    LangGraph node — Subject Classifier.

    Returns partial state with subject_about and subject_suggestions populated,
    or both None on any failure (fail-open: a broken analysis must never block optimization).
    """
    raw = state.get("raw_prompt", "").strip()
    feedback = state.get("feedback")
    job_id = state.get("job_id")

    try:
        response = await _get_model().ainvoke(subject_classifier_messages(raw, feedback))
        parsed = _parse_response(str(response.content))
        about, suggestions = _normalize(parsed.get("about"), parsed.get("suggestions"))
    except Exception:
        log.warning("subject_classifier_failed", prompt_length=len(raw))
        return {"subject_about": None, "subject_suggestions": None}

    if job_id:
        await push_job_progress(job_id, {"step": "subject", "ts": time.time()})

    log.info(
        "subject_classified",
        about_count=len(about) if about else 0,
        suggestions_count=len(suggestions) if suggestions else 0,
    )
    return {"subject_about": about, "subject_suggestions": suggestions}
