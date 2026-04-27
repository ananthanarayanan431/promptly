from typing import Annotated, Any

from langgraph.graph.message import add_messages
from typing_extensions import TypedDict


class GraphState(TypedDict):
    # Input
    raw_prompt: str
    session_id: str
    user_id: str

    # Optional user guidance that shapes how the council optimizes the prompt.
    feedback: str | None

    # Version history diff — populated when appending to an existing prompt family.
    # Passed to the council so it understands the optimization trajectory.
    version_history_diff: str | None

    # Celery job id — set by process_chat_async; None for standalone PromptService calls.
    job_id: str | None

    # Intent classification result: "optimize" | "irrelevant"
    intent: str | None

    # Pipeline stages
    # Round 1 — council_responses: [{model, optimized_prompt, usage}]
    council_responses: list[dict[str, Any]]

    # Round 2 — critic_responses: [{reviewer_model, ranking, critiques, ranking_rationale}]
    critic_responses: list[dict[str, Any]]

    final_response: str  # synthesized best optimized prompt (chairman output)

    # Refinement loop state
    iteration_count: int  # current iteration (0-indexed)
    max_iterations: int  # ceiling — never loop past this
    previous_synthesis: str | None  # last iteration's final_response, fed back to council/critic

    # Metadata
    messages: Annotated[list[Any], add_messages]
    token_usage: dict[str, Any]
    error: str | None
