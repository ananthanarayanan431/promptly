"""
Synthesize node — Round 3: The Chairman.

Receives all 4 council proposals AND all 4 peer critiques (rankings + weakness analysis).
Uses the critique consensus to identify the strongest base proposal, patch confirmed
weaknesses, and produce the single definitive optimized prompt.
"""

from langchain_openai import ChatOpenAI

from app.config.llm import get_llm_settings
from app.graph.prompts import load_prompt
from app.graph.state import GraphState

llm_settings = get_llm_settings()

_synthesizer = ChatOpenAI(
    model=llm_settings.DEFAULT_MODEL,
    openai_api_base="https://openrouter.ai/api/v1",
    openai_api_key=llm_settings.OPENROUTER_API_KEY.get_secret_value(),
)

_SYSTEM_PROMPT = load_prompt("synthesize_best")


def _build_user_message(state: GraphState) -> str:
    # --- Round 1: council proposals ---
    proposals_block = "\n\n".join(
        f"[Proposal from {r['model']}]:\n{r['optimized_prompt']}"
        for r in state["council_responses"]
    )

    # --- Round 2: critic reviews ---
    critic_responses = state.get("critic_responses") or []
    if critic_responses:
        reviews = []
        for cr in critic_responses:
            ranking = ", ".join(cr.get("ranking", []))
            critiques = cr.get("critiques", {})
            critique_lines = "\n".join(f"  {label}: {text}" for label, text in critiques.items())
            rationale = cr.get("ranking_rationale", "")
            reviews.append(
                f"[Critic: {cr['reviewer_model']}]\n"
                f"Ranking: {ranking}\n"
                f"Critiques:\n{critique_lines}\n"
                f"Rationale: {rationale}"
            )
        critiques_block = "\n\n".join(reviews)
    else:
        critiques_block = "(No critic reviews available — synthesize from proposals only.)"

    return (
        f"Original prompt:\n{state['raw_prompt']}\n\n"
        f"---\n\n"
        f"Round 1 — Council proposals:\n\n{proposals_block}\n\n"
        f"---\n\n"
        f"Round 2 — Peer critiques:\n\n{critiques_block}"
    )


async def synthesize_node(state: GraphState) -> dict:
    """
    LangGraph node — Round 3 (Chairman).

    Synthesizes the final optimized prompt using all council proposals and
    all peer critique data.

    Returns:
        {"final_response": <best_optimized_prompt>, "token_usage": {"total_tokens": N}}
    """
    response = await _synthesizer.ainvoke(
        [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": _build_user_message(state)},
        ]
    )

    total_tokens = sum(
        r.get("usage", {}).get("total_tokens", 0) for r in state["council_responses"]
    )

    return {
        "final_response": response.content.strip(),
        "token_usage": {"total_tokens": total_tokens},
    }
