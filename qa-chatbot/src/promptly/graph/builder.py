"""
LangGraph pipeline — three-round prompt optimization council.

Round 1  council_vote : 4 models independently optimize the prompt (parallel)
Round 2  critic       : each model blind-reviews the other 3 proposals (parallel)
Round 3  synthesize   : chairman synthesizes final answer from proposals + critiques

Intent gate (intent_classifier) sits before the pipeline and handles:
  - OPTIMIZE   → proceed to Round 1 (via performance_gate when enabled)
  - IRRELEVANT → END with rejection (covers harmful content, injection,
                 creation requests, and off-topic queries)

Performance gate (performance_gate) sits between intent_classifier and council_vote:
  - already_optimized → END (returns original prompt, refunds 5 credits)
  - needs_work        → council_vote (normal pipeline)
  - force_optimize=True → skips the gate, goes straight to council_vote
  - PERFORMANCE_GATE_ENABLED=False → gate node not registered; old direct edge used
"""

from typing import Any

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.graph import END, StateGraph

from promptly.graph.nodes.council_vote import council_vote_node
from promptly.graph.nodes.critic import critic_node
from promptly.graph.nodes.intent_classifier import intent_classifier_node
from promptly.graph.nodes.performance_gate import performance_gate_node
from promptly.graph.nodes.quality_gate import quality_gate_node
from promptly.graph.nodes.subject_classifier import subject_classifier_node
from promptly.graph.nodes.synthesize import synthesize_node
from promptly.graph.state import GraphState
from promptly.llm import get_llm_settings
from promptly.utils.log import get_logger

log = get_logger(__name__)


def _route_intent(state: GraphState) -> str:
    """
    After intent_classifier:
      - IRRELEVANT → END
      - force_optimize=True → skip gate, go to council_vote
      - otherwise → performance_gate (if enabled) or council_vote (if disabled)
    The "skip_gate" and "gate" routes are only registered when PERFORMANCE_GATE_ENABLED.
    When disabled, only "blocked" and "proceed" (→ council_vote) are valid targets.
    """
    if state.get("intent") == "irrelevant":
        return "blocked"
    settings = get_llm_settings()
    if settings.PERFORMANCE_GATE_ENABLED:
        return "skip_gate" if state.get("force_optimize") else "gate"
    return "proceed"


def _route_performance_gate(state: GraphState) -> str:
    return "exit" if state.get("already_optimized") else "proceed"


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

    settings = get_llm_settings()
    quality_gate_enabled = settings.QUALITY_GATE_ENABLED
    performance_gate_enabled = settings.PERFORMANCE_GATE_ENABLED
    subject_classifier_enabled = settings.SUBJECT_CLASSIFIER_ENABLED

    builder.add_node("intent_classifier", intent_classifier_node)
    builder.add_node("council_vote", council_vote_node)
    builder.add_node("critic", critic_node)
    builder.add_node("synthesize", synthesize_node)
    if performance_gate_enabled:
        builder.add_node("performance_gate", performance_gate_node)
    if quality_gate_enabled:
        builder.add_node("quality_gate", quality_gate_node)
    if subject_classifier_enabled:
        builder.add_node("subject_classifier", subject_classifier_node)

    council_entry = "subject_classifier" if subject_classifier_enabled else "council_vote"

    # Entry point
    builder.set_entry_point("intent_classifier")

    if performance_gate_enabled:
        # IRRELEVANT → END | force_optimize → council_entry | default → performance_gate
        builder.add_conditional_edges(
            "intent_classifier",
            _route_intent,
            {
                "blocked": END,
                "gate": "performance_gate",
                "skip_gate": council_entry,
            },
        )
        # performance_gate → END (already optimized) | council_entry (needs work)
        builder.add_conditional_edges(
            "performance_gate",
            _route_performance_gate,
            {
                "exit": END,
                "proceed": council_entry,
            },
        )
    else:
        # Gate disabled — IRRELEVANT → END, OPTIMIZE → council_entry (original behaviour)
        builder.add_conditional_edges(
            "intent_classifier",
            _route_intent,
            {
                "blocked": END,
                "proceed": council_entry,
            },
        )

    if subject_classifier_enabled:
        builder.add_edge("subject_classifier", "council_vote")

    # Round 1 → Round 2 → Round 3
    builder.add_edge("council_vote", "critic")
    builder.add_edge("critic", "synthesize")

    if quality_gate_enabled:
        # Synthesize → quality gate → (loop back to council_vote | exit)
        builder.add_edge("synthesize", "quality_gate")
        builder.add_conditional_edges(
            "quality_gate",
            _route_quality_gate,
            {
                "loop": "council_vote",
                "exit": END,
            },
        )
    else:
        builder.add_edge("synthesize", END)

    graph = builder.compile(checkpointer=checkpointer)
    log.info(
        "graph_compiled",
        performance_gate=performance_gate_enabled,
        quality_gate=quality_gate_enabled,
        subject_classifier=subject_classifier_enabled,
    )
    return graph
