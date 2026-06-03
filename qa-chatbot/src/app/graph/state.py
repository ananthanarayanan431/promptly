from __future__ import annotations

from typing import Annotated, Any

from langgraph.graph.message import add_messages
from typing_extensions import TypedDict


def make_graph_state(
    *,
    raw_prompt: str,
    session_id: str,
    user_id: str,
    feedback: str | None = None,
    category_slug: str | None = None,
    category_name: str | None = None,
    category_description: str | None = None,
    category_is_predefined: bool = False,
    job_id: str | None = None,
    version_history_diff: str | None = None,
    max_iterations: int = 1,
    force_optimize: bool = False,
) -> GraphState:
    """Return a fully-initialised GraphState with caller-supplied inputs and safe defaults.

    All pipeline outputs (intent, council_responses, reasoning, …) start at their
    zero values so every future field addition only needs to be defaulted here.
    """
    return {
        "raw_prompt": raw_prompt,
        "session_id": session_id,
        "user_id": user_id,
        "feedback": feedback,
        "category_slug": category_slug,
        "category_name": category_name,
        "category_description": category_description,
        "category_is_predefined": category_is_predefined,
        "version_history_diff": version_history_diff,
        "job_id": job_id,
        "intent": None,
        "force_optimize": force_optimize,
        "already_optimized": False,
        "gate_dimension_scores": None,
        "gate_rationale": None,
        "subject_about": None,
        "subject_suggestions": None,
        "council_responses": [],
        "critic_responses": [],
        "final_response": "",
        "reasoning": None,
        "iteration_count": 0,
        "max_iterations": max_iterations,
        "previous_synthesis": None,
        "messages": [],
        "token_usage": {},
        "error": None,
    }


class GraphState(TypedDict):
    # Input
    raw_prompt: str
    session_id: str
    user_id: str

    # Optional user guidance that shapes how the council optimizes the prompt.
    feedback: str | None

    # Category context — drives per-domain dimension emphasis in council + synthesize.
    # category_slug "general" or None = no addendum (baseline behavior).
    category_slug: str | None
    category_name: str | None
    category_description: str | None
    category_is_predefined: bool

    # Version history diff — populated when appending to an existing prompt family.
    # Passed to the council so it understands the optimization trajectory.
    version_history_diff: str | None

    # Celery job id — set by process_chat_async; None for standalone PromptService calls.
    job_id: str | None

    # Intent classification result: "optimize" | "irrelevant"
    intent: str | None

    # Performance gate — set when the raw prompt is already production-grade.
    # When already_optimized=True, final_response == raw_prompt and no council ran.
    force_optimize: bool  # bypass the gate entirely when True
    already_optimized: bool  # True when gate short-circuits the pipeline
    gate_dimension_scores: dict[str, str] | None  # 8-dim scoring labels
    gate_rationale: str | None  # one-sentence explanation from the gate LLM

    # Subject classifier — set before council_vote, reused across refinement loop iterations.
    # None when the classifier is disabled or failed.
    subject_about: list[str] | None
    subject_suggestions: list[str] | None

    # Pipeline stages
    # Round 1 — council_responses: [{model, optimized_prompt, usage}]
    council_responses: list[dict[str, Any]]

    # Round 2 — critic_responses: [{reviewer_model, ranking, critiques, ranking_rationale}]
    critic_responses: list[dict[str, Any]]

    final_response: str  # synthesized best optimized prompt (chairman output)
    reasoning: dict[str, Any] | None  # structured explanation of changes (summary/changes/kept)

    # Refinement loop state
    iteration_count: int  # current iteration (0-indexed)
    max_iterations: int  # ceiling — never loop past this
    previous_synthesis: str | None  # last iteration's final_response, fed back to council/critic

    # Metadata
    messages: Annotated[list[Any], add_messages]
    token_usage: dict[str, Any]
    error: str | None
