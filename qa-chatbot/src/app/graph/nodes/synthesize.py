from langchain_openai import ChatOpenAI
from app.config.llm import get_llm_settings
from app.graph.state import GraphState

llm_settings = get_llm_settings()

_synthesizer = ChatOpenAI(
    model=llm_settings.DEFAULT_MODEL,
    openai_api_base="https://openrouter.ai/api/v1",
    openai_api_key=llm_settings.OPENROUTER_API_KEY.get_secret_value(),
)

SYNTH_SYSTEM = """You are a synthesis engine. Given multiple AI responses to the same question,
produce a single best, consolidated answer that preserves the most accurate and useful information."""


async def synthesize_node(state: GraphState) -> dict:
    council_text = "\n\n".join(
        f"[{r['model']}]: {r['response']}" for r in state["council_responses"]
    )
    response = await _synthesizer.ainvoke([
        {"role": "system", "content": SYNTH_SYSTEM},
        {"role": "user", "content": f"Question: {state['enhanced_prompt']}\n\nResponses:\n{council_text}"},
    ])
    total_tokens = sum(
        r.get("usage", {}).get("total_tokens", 0) for r in state["council_responses"]
    )
    return {
        "final_response": response.content,
        "token_usage": {"total_tokens": total_tokens},
    }