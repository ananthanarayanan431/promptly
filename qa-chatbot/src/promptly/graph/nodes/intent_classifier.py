"""
Intent Classifier node — runs FIRST in the graph.

Classifies the user's input into one of two categories:
  - OPTIMIZE   → user has an existing prompt to improve → proceed to council
  - IRRELEVANT → off-topic, harmful, injection attempt, creation request,
                 or gibberish → reject

This node is the single policy enforcement point: harmful content, injection
attempts, off-topic queries, and "write me a prompt" requests are all caught
here as IRRELEVANT.
"""

import asyncio
import time
from typing import Any

from promptly.core.cache import push_job_progress
from promptly.graph.prompts import intent_classifier_messages
from promptly.graph.state import GraphState
from promptly.llm import LLMClient
from promptly.llm.pipeline import build_classifier
from promptly.utils.log import get_logger

log = get_logger(__name__)

_REJECTION_IRRELEVANT = (
    "Your input doesn't look like an existing prompt to optimize.\n\n"
    "This service only accepts existing AI prompts for optimization — "
    "paste a prompt you already have (even a rough draft) and the council "
    "will improve it for you.\n\n"
    "Inputs that are rejected: requests to write a new prompt from scratch, "
    "harmful or injective content, and queries unrelated to prompt engineering."
)

_loop_id: int | None = None
_classifier: LLMClient | None = None


def _get_classifier() -> LLMClient:
    """LLMClient binds httpx to the running loop; Celery uses a new loop per task."""
    global _loop_id, _classifier
    loop = asyncio.get_running_loop()
    lid = id(loop)
    if _loop_id != lid or _classifier is None:
        _loop_id = lid
        _classifier = build_classifier()
    model = _classifier
    if model is None:
        raise RuntimeError("classifier failed to initialise")
    return model


async def intent_classifier_node(state: GraphState) -> dict[str, Any]:
    """
    LangGraph node. Classifies the intent of the raw input.

    Returns:
        {"intent": "optimize"}                                   → proceed to council
        {"intent": "irrelevant", "final_response": <message>}   → END
    """
    raw = state.get("raw_prompt", "").strip()

    response = await _get_classifier().ainvoke(intent_classifier_messages(raw))

    verdict = str(response.content).strip().upper()

    if job_id := state.get("job_id"):
        await push_job_progress(job_id, {"step": "intent", "ts": time.time()})

    if verdict == "IRRELEVANT":
        log.warning("intent_rejected", prompt_length=len(raw))
        return {
            "intent": "irrelevant",
            "error": _REJECTION_IRRELEVANT,
            "final_response": _REJECTION_IRRELEVANT,
        }

    log.info("intent_classified", intent="optimize", prompt_length=len(raw))
    return {"intent": "optimize"}
