from typing import Any

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.graph import END, StateGraph

from app.graph.nodes.council_vote import council_vote_node
from app.graph.nodes.guardrails import guardrails_node
from app.graph.nodes.intent_classifier import intent_classifier_node
from app.graph.nodes.synthesize import synthesize_node
from app.graph.state import GraphState


def _route_intent(state: GraphState) -> str:
    """After intent_classifier: block CREATE requests, proceed with OPTIMIZE."""
    if state.get("intent") == "create":
        return "blocked"
    return "proceed"


def _should_continue(state: GraphState) -> str:
    """After guardrails: abort if a safety error was set, otherwise continue."""
    if state.get("error"):
        return "abort"
    return "continue"


async def compile_graph(checkpointer: AsyncPostgresSaver) -> Any:  # noqa: ANN401
    builder = StateGraph(GraphState)

    builder.add_node("intent_classifier", intent_classifier_node)
    builder.add_node("guardrails", guardrails_node)
    builder.add_node("council_vote", council_vote_node)
    builder.add_node("synthesize", synthesize_node)

    # Entry point: classify intent first
    builder.set_entry_point("intent_classifier")

    # Gate 1: CREATE requests end here with a rejection message
    builder.add_conditional_edges(
        "intent_classifier",
        _route_intent,
        {
            "blocked": END,
            "proceed": "guardrails",
        },
    )

    # Gate 2: safety checks — abort on violation, otherwise run the council
    builder.add_conditional_edges(
        "guardrails",
        _should_continue,
        {
            "abort": END,
            "continue": "council_vote",
        },
    )

    builder.add_edge("council_vote", "synthesize")
    builder.add_edge("synthesize", END)

    return builder.compile(checkpointer=checkpointer)
