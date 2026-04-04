from langgraph.graph import StateGraph
from langgraph.graph import END
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from app.graph.state import GraphState
from app.graph.nodes.guardrails import guardrails_node
from app.graph.nodes.enhance_prompt import enhance_prompt_node
from app.graph.nodes.council_vote import council_vote_node
from app.graph.nodes.synthesize import synthesize_node


def _should_continue(state: GraphState) -> str:
    """Edge condition: abort graph if guardrails set an error."""
    if state.get("error"):
        return "abort"
    return "continue"


async def compile_graph(checkpointer: AsyncPostgresSaver):
    builder = StateGraph(GraphState)

    builder.add_node("guardrails", guardrails_node)
    builder.add_node("enhance_prompt", enhance_prompt_node)
    builder.add_node("council_vote", council_vote_node)
    builder.add_node("synthesize", synthesize_node)

    builder.set_entry_point("guardrails")

    builder.add_conditional_edges(
        "guardrails",
        _should_continue,
        {
            "continue": "enhance_prompt",
            "abort": END,
        },
    )

    builder.add_edge("enhance_prompt", "council_vote")
    builder.add_edge("council_vote", "synthesize")
    builder.add_edge("synthesize", END)

    return builder.compile(checkpointer=checkpointer)