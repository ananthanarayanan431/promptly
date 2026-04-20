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

from langchain_openai import ChatOpenAI

from app.config.llm import get_llm_settings
from app.core.cache import push_job_progress
from app.graph.prompts import load_prompt
from app.graph.state import GraphState

llm_settings = get_llm_settings()

_REJECTION_IRRELEVANT = (
    "Your input doesn't look like an existing prompt to optimize.\n\n"
    "This service only accepts existing AI prompts for optimization — "
    "paste a prompt you already have (even a rough draft) and the council "
    "will improve it for you.\n\n"
    "Inputs that are rejected: requests to write a new prompt from scratch, "
    "harmful or injective content, and queries unrelated to prompt engineering."
)

_loop_id: int | None = None
_classifier: ChatOpenAI | None = None

_SYSTEM_PROMPT = load_prompt("intent_classifier")


def _get_classifier() -> ChatOpenAI:
    """ChatOpenAI binds httpx to the running loop; Celery uses a new loop per task."""
    global _loop_id, _classifier
    loop = asyncio.get_running_loop()
    lid = id(loop)
    if _loop_id != lid or _classifier is None:
        _loop_id = lid
        _classifier = ChatOpenAI(
            model=llm_settings.DEFAULT_MODEL,
            openai_api_base="https://openrouter.ai/api/v1",
            openai_api_key=llm_settings.OPENROUTER_API_KEY.get_secret_value(),
            max_tokens=5,
            temperature=0,  # deterministic — classification, not generation
        )
    return _classifier


async def intent_classifier_node(state: GraphState) -> dict[str, Any]:
    """
    LangGraph node. Classifies the intent of the raw input.

    Returns:
        {"intent": "optimize"}                                   → proceed to council
        {"intent": "irrelevant", "final_response": <message>}   → END
    """
    raw = state.get("raw_prompt", "").strip()

    response = await _get_classifier().ainvoke(
        [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": raw},
        ]
    )

    verdict = str(response.content).strip().upper()

    if verdict == "IRRELEVANT":
        return {
            "intent": "irrelevant",
            "error": _REJECTION_IRRELEVANT,
            "final_response": _REJECTION_IRRELEVANT,
        }

    # Default to optimize (covers OPTIMIZE and any unexpected model output)
    result: dict[str, Any] = {"intent": "optimize"}

    if job_id := state.get("job_id"):
        await push_job_progress(job_id, {"step": "intent", "ts": time.time()})

    return result
