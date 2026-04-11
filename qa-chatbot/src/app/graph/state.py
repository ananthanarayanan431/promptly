from typing import Annotated

from langgraph.graph.message import add_messages
from typing_extensions import TypedDict


class GraphState(TypedDict):
    # Input
    raw_prompt: str
    session_id: str
    user_id: str

    # Optional user guidance that shapes how the council optimizes the prompt.
    # When set, it is injected into the council message as a high-priority directive.
    feedback: str | None

    # Intent classification result: "optimize" | "create"
    intent: str | None

    # Pipeline stages
    # Round 1 — council_responses: each model's independently optimized version of raw_prompt
    #   shape: [{model: str, optimized_prompt: str, usage: dict}]
    council_responses: list[dict]

    # Round 2 — critic_responses: each model's blind peer review of the other 3 proposals
    #   shape: [{reviewer_model: str, ranking: list[str], critiques: dict, ranking_rationale: str}]
    critic_responses: list[dict]

    final_response: str  # synthesized best optimized prompt (chairman output)

    # Metadata
    messages: Annotated[list, add_messages]
    token_usage: dict
    error: str | None
