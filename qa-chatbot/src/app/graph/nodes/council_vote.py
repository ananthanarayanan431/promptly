import asyncio
from typing import Any

from langchain_openai import ChatOpenAI

from app.config.llm import get_llm_settings
from app.graph.state import GraphState

llm_settings = get_llm_settings()


def _build_models() -> list:
    models = []
    for m in llm_settings.COUNCIL_MODELS:
        models.append(
            ChatOpenAI(
                model=m,
                openai_api_base="https://openrouter.ai/api/v1",
                openai_api_key=llm_settings.OPENROUTER_API_KEY.get_secret_value(),
            )
        )
    return models


_council_models = _build_models()


async def council_vote_node(state: GraphState) -> dict:
    prompt = state["enhanced_prompt"]

    async def query_model(model: Any, idx: int) -> dict:
        response = await model.ainvoke([{"role": "user", "content": prompt}])
        return {
            "model": llm_settings.COUNCIL_MODELS[idx],
            "response": response.content,
            "usage": getattr(response, "usage_metadata", {}),
        }

    responses = await asyncio.gather(
        *[query_model(m, i) for i, m in enumerate(_council_models)],
        return_exceptions=True,
    )

    valid = [r for r in responses if isinstance(r, dict)]
    return {"council_responses": valid}
