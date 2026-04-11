"""
Synthesize node — evaluates all council proposals and produces the single best optimized prompt.

The synthesizer acts as a meta-judge: it does not simply pick one proposal, but intelligently
combines the strongest elements from each council member's independently optimized version.
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
    proposals = "\n\n".join(
        f"[Proposal from {r['model']}]:\n{r['optimized_prompt']}"
        for r in state["council_responses"]
    )
    return f"Original prompt:\n{state['raw_prompt']}\n\nCouncil proposals:\n{proposals}"


async def synthesize_node(state: GraphState) -> dict:
    """
    LangGraph node. Synthesizes the best optimized prompt from all council proposals.

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
