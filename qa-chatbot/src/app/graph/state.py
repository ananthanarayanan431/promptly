from typing import Annotated
from langgraph.graph.message import add_messages
from typing_extensions import TypedDict


class GraphState(TypedDict):
    # Input
    raw_prompt: str
    session_id: str
    user_id: str

    # Pipeline stages
    enhanced_prompt: str
    council_responses: list[dict]  # [{model, response, score}]
    final_response: str

    # Metadata
    messages: Annotated[list, add_messages]
    token_usage: dict
    error: str | None