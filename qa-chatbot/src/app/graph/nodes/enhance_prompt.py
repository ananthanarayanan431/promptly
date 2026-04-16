import asyncio

from langchain_openai import ChatOpenAI

from app.config.llm import get_llm_settings
from app.graph.state import GraphState

llm_settings = get_llm_settings()

_loop_id: int | None = None
_enhancer: ChatOpenAI | None = None

ENHANCE_SYSTEM = (
    "You are an expert prompt engineer.\n"
    "Rewrite the user's raw question into the absolute best possible version of that prompt.\n"
    "Ensure the new prompt is clear, specific, well-structured, incorporates edge cases, "
    "formatting constraints, and necessary context to elicit the most accurate and "
    "comprehensive response from an AI model.\n"
    "Return ONLY the enhanced prompt, nothing else."
)


def _get_enhancer() -> ChatOpenAI:
    """ChatOpenAI binds httpx to the running loop; Celery uses a new loop per task."""
    global _loop_id, _enhancer
    loop = asyncio.get_running_loop()
    lid = id(loop)
    if _loop_id != lid or _enhancer is None:
        _loop_id = lid
        _enhancer = ChatOpenAI(
            model=llm_settings.DEFAULT_MODEL,
            openai_api_base="https://openrouter.ai/api/v1",
            openai_api_key=llm_settings.OPENROUTER_API_KEY.get_secret_value(),
            max_tokens=1000,
        )
    return _enhancer


async def enhance_prompt_node(state: GraphState) -> dict:
    response = await _get_enhancer().ainvoke(
        [
            {"role": "system", "content": ENHANCE_SYSTEM},
            {"role": "user", "content": state["raw_prompt"]},
        ]
    )
    return {"enhanced_prompt": response.content}
