"""
Intent Classifier node — runs FIRST in the graph, before guardrails.

Determines whether the user wants to:
  - OPTIMIZE an existing prompt  → continue pipeline
  - CREATE a new prompt          → reject with explanation, short-circuit to END

This is a binary gate: creation requests are out of scope for this service.
"""

from langchain_openai import ChatOpenAI

from app.config.llm import get_llm_settings
from app.graph.prompts import load_prompt
from app.graph.state import GraphState

llm_settings = get_llm_settings()

_REJECTION_MESSAGE = (
    "This service optimizes existing prompts — it does not write new prompts from scratch.\n\n"
    "To use it: paste a prompt you already have (even a rough draft) and it will be run "
    "through a multi-model optimization pipeline to make it clearer, more specific, and "
    "more effective.\n\n"
    "Example: submit 'Summarize this article' and receive a fully engineered version "
    "with role definition, output format, and precise constraints."
)

_classifier = ChatOpenAI(
    model=llm_settings.DEFAULT_MODEL,
    openai_api_base="https://openrouter.ai/api/v1",
    openai_api_key=llm_settings.OPENROUTER_API_KEY.get_secret_value(),
    max_tokens=5,
    temperature=0,  # deterministic — this is classification, not generation
)

_SYSTEM_PROMPT = load_prompt("intent_classifier")


async def intent_classifier_node(state: GraphState) -> dict:
    """
    LangGraph node. Classifies whether the user wants to OPTIMIZE or CREATE a prompt.

    Returns:
        {"intent": "optimize"} to continue the pipeline, or
        {"intent": "create", "error": <message>, "final_response": <message>} to abort.
    """
    raw = state.get("raw_prompt", "").strip()

    response = await _classifier.ainvoke(
        [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": raw},
        ]
    )

    verdict = response.content.strip().upper()

    if verdict == "CREATE":
        return {
            "intent": "create",
            "error": _REJECTION_MESSAGE,
            "final_response": _REJECTION_MESSAGE,
        }

    # Default to optimize even if the model returns something unexpected
    return {"intent": "optimize"}
