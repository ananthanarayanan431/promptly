"""
Council Vote node — Round 1: Gather Opinions.

Each of the 4 council models independently optimizes the raw prompt using a distinct strategy:
  - Index 0 (GPT-4o-mini)       → analytical: precision, constraints, output format
  - Index 1 (Claude Haiku)      → creative:   context, persona depth, exemplars
  - Index 2 (Gemini Flash)      → concise:    radical conciseness, maximum signal density
  - Index 3 (Grok)              → structured: logical decomposition, output schemas

No model sees any other model's output in this round. Responses are fully independent.
This diversity of angles gives the critic round and the chairman meaningful variation to work with.
"""

import asyncio
import logging
from typing import Any

from langchain_openai import ChatOpenAI

from app.config.llm import get_llm_settings
from app.graph.prompts import load_prompt
from app.graph.state import GraphState

logger = logging.getLogger(__name__)

llm_settings = get_llm_settings()

# Load all 4 strategy prompts at module startup (file I/O once)
_STRATEGY_PROMPTS: list[str] = [
    load_prompt("council_optimizer_analytical"),  # 0 — analytical
    load_prompt("council_optimizer_creative"),  # 1 — creative
    load_prompt("council_optimizer_concise"),  # 2 — concise
    load_prompt("council_optimizer_structured"),  # 3 — structured
]


def _get_strategy(idx: int) -> str:
    """Return the strategy prompt for a given council member index."""
    if idx < len(_STRATEGY_PROMPTS):
        return _STRATEGY_PROMPTS[idx]
    return _STRATEGY_PROMPTS[0]  # analytical as fallback for any extra models


def _build_models() -> list[ChatOpenAI]:
    return [
        ChatOpenAI(
            model=m,
            openai_api_base="https://openrouter.ai/api/v1",
            openai_api_key=llm_settings.OPENROUTER_API_KEY.get_secret_value(),
        )
        for m in llm_settings.COUNCIL_MODELS
    ]


_council_loop_id: int | None = None
_council_models: list[ChatOpenAI] | None = None


def _get_council_models() -> list[ChatOpenAI]:
    """Models bind httpx to the running loop; Celery uses a new loop per task."""
    global _council_loop_id, _council_models
    loop = asyncio.get_running_loop()
    lid = id(loop)
    if _council_loop_id != lid or _council_models is None:
        _council_loop_id = lid
        _council_models = _build_models()
    return _council_models


def _build_user_message(raw_prompt: str, feedback: str | None) -> str:
    """Combine the raw prompt with optional user feedback."""
    if not feedback:
        return raw_prompt
    return (
        f"{raw_prompt}\n\n"
        f"---\n"
        f"Optimization Feedback "
        f"(high-priority directive — override general heuristics if needed):\n"
        f"{feedback}"
    )


async def council_vote_node(state: GraphState) -> dict[str, Any]:
    """
    LangGraph node — Round 1.

    Sends the raw prompt to all 4 council models in parallel. Each model independently
    produces its own optimized version using a different strategy.

    Returns:
        {"council_responses": [{model, optimized_prompt, usage}, ...]}
    """
    raw_prompt = state["raw_prompt"]
    feedback = state.get("feedback")

    async def optimize(model: ChatOpenAI, idx: int) -> dict[str, Any]:
        system = _get_strategy(idx)
        response = await model.ainvoke(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": _build_user_message(raw_prompt, feedback)},
            ]
        )
        return {
            "model": llm_settings.COUNCIL_MODELS[idx],
            "optimized_prompt": str(response.content).strip(),
            "usage": getattr(response, "usage_metadata", {}) or {},
        }

    results = await asyncio.gather(
        *[optimize(m, i) for i, m in enumerate(_get_council_models())],
        return_exceptions=True,
    )

    valid = []
    for i, r in enumerate(results):
        if isinstance(r, dict):
            valid.append(r)
        else:
            logger.error(
                "Council model %s failed: %s: %s",
                llm_settings.COUNCIL_MODELS[i],
                type(r).__name__,
                r,
            )

    return {"council_responses": valid}
