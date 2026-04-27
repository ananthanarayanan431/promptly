"""
LangGraph pipeline — three-round prompt optimization council.

Round 1  council_vote : 4 models independently optimize the prompt (parallel)
Round 2  critic       : each model blind-reviews the other 3 proposals (parallel)
Round 3  synthesize   : chairman synthesizes final answer from proposals + critiques

Intent gate (intent_classifier) sits before the pipeline and handles:
  - OPTIMIZE   → proceed to Round 1
  - IRRELEVANT → END with rejection (covers harmful content, injection,
                 creation requests, and off-topic queries)
"""

from typing import Any

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.graph import END, StateGraph

from app.graph.nodes.council_vote import council_vote_node
from app.graph.nodes.critic import critic_node
from app.graph.nodes.intent_classifier import intent_classifier_node
from app.graph.nodes.quality_gate import quality_gate_node
from app.graph.nodes.synthesize import synthesize_node
from app.graph.state import GraphState


def _route_intent(state: GraphState) -> str:
    """
    After intent_classifier: route IRRELEVANT to END,
    let OPTIMIZE proceed into the council pipeline.
    """
    intent = state.get("intent")
    if intent == "irrelevant":
        return "blocked"
    return "proceed"


def _route_quality_gate(state: GraphState) -> str:
    """
    After quality_gate: loop back to council_vote if the synthesis still has weak
    dimensions and we haven't hit the iteration ceiling; otherwise exit.

    The gate node already enforces the ceiling and convergence checks internally —
    it only omits the 'weak_dimensions' payload when it decided to exit.
    We route on whether quality_gate attached a new quality_gate sentinel entry
    (loop decision) vs. not (exit decision).
    """
    critic_responses = state.get("critic_responses") or []
    for cr in reversed(critic_responses):
        if cr.get("_quality_gate"):
            return "loop"
    return "exit"


async def compile_graph(checkpointer: AsyncPostgresSaver) -> Any:  # noqa: ANN401
    builder = StateGraph(GraphState)

    builder.add_node("intent_classifier", intent_classifier_node)
    builder.add_node("council_vote", council_vote_node)
    builder.add_node("critic", critic_node)
    builder.add_node("synthesize", synthesize_node)
    builder.add_node("quality_gate", quality_gate_node)

    # Entry point
    builder.set_entry_point("intent_classifier")

    # Gate: IRRELEVANT ends here; OPTIMIZE enters the council
    builder.add_conditional_edges(
        "intent_classifier",
        _route_intent,
        {
            "blocked": END,
            "proceed": "council_vote",
        },
    )

    # Round 1 → Round 2 → Round 3 → quality gate
    builder.add_edge("council_vote", "critic")
    builder.add_edge("critic", "synthesize")
    builder.add_edge("synthesize", "quality_gate")

    # Quality gate: loop back to council_vote or exit
    builder.add_conditional_edges(
        "quality_gate",
        _route_quality_gate,
        {
            "loop": "council_vote",
            "exit": END,
        },
    )

    return builder.compile(checkpointer=checkpointer)
