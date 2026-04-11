"""
Council Vote node — each model independently optimizes the raw prompt.

Each council member uses a different optimization strategy (loaded from prompts/):
  - Index 0 → analytical: precision, constraints, output format
  - Index 1 → creative: context, persona depth, exemplars, reasoning activation
  - Index N → falls back to analytical for any additional models

The diversity of optimization angles gives the synthesizer meaningful variation to work with,
closer to the spirit of the original llm-council paper (Karpathy).
"""

import asyncio

from langchain_openai import ChatOpenAI

from app.config.llm import get_llm_settings
from app.graph.prompts import load_prompt
from app.graph.state import GraphState

llm_settings = get_llm_settings()

# Load optimization strategy prompts at module startup (file I/O once)
_STRATEGY_PROMPTS = [
    load_prompt("council_optimizer_analytical"),
    load_prompt("council_optimizer_creative"),
]


def _get_strategy(idx: int) -> str:
    """Return the optimization strategy prompt for a given council member index."""
    if idx < len(_STRATEGY_PROMPTS):
        return _STRATEGY_PROMPTS[idx]
    return _STRATEGY_PROMPTS[0]  # analytical as fallback


def _build_models() -> list[ChatOpenAI]:
    return [
        ChatOpenAI(
            model=m,
            openai_api_base="https://openrouter.ai/api/v1",
            openai_api_key=llm_settings.OPENROUTER_API_KEY.get_secret_value(),
        )
        for m in llm_settings.COUNCIL_MODELS
    ]


_council_models = _build_models()


def _build_user_message(raw_prompt: str, feedback: str | None) -> str:
    """Combine the raw prompt with optional user feedback into the council user message."""
    if not feedback:
        return raw_prompt
    return (
        f"{raw_prompt}\n\n"
        f"---\n"
        f"Optimization Feedback "
        f"(high-priority directive — override general heuristics if needed):\n"
        f"{feedback}"
    )


async def council_vote_node(state: GraphState) -> dict:
    """
    LangGraph node. Sends the raw prompt to every council model in parallel.
    Each model independently produces its own optimized version of the prompt.

    Returns:
        {"council_responses": [{model, optimized_prompt, usage}]}
    """
    raw_prompt = state["raw_prompt"]
    feedback = state.get("feedback")

    async def optimize(model: ChatOpenAI, idx: int) -> dict:
        system = _get_strategy(idx)
        response = await model.ainvoke(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": _build_user_message(raw_prompt, feedback)},
            ]
        )
        return {
            "model": llm_settings.COUNCIL_MODELS[idx],
            "optimized_prompt": response.content.strip(),
            "usage": getattr(response, "usage_metadata", {}),
        }

    results = await asyncio.gather(
        *[optimize(m, i) for i, m in enumerate(_council_models)],
        return_exceptions=True,
    )

    valid = [r for r in results if isinstance(r, dict)]
    return {"council_responses": valid}
