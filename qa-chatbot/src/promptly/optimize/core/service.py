import uuid
from collections.abc import AsyncGenerator
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from promptly.graph.state import make_graph_state
from promptly.repositories.message_repo import MessageRepository
from promptly.repositories.session_repo import SessionRepository
from promptly.utils.log import get_logger

log = get_logger(__name__)


class ChatService:
    def __init__(self, db: AsyncSession, graph: Any) -> None:  # noqa: ANN401
        self.db = db
        self.graph = graph
        self.msg_repo = MessageRepository(db)
        self.session_repo = SessionRepository(db)

    async def process(
        self,
        user_id: str,
        raw_prompt: str,
        session_id: str,
        feedback: str | None = None,
        title: str | None = None,
        job_id: str | None = None,
        version_history_diff: str | None = None,
        max_iterations: int = 1,
        category_slug: str | None = None,
        category_name: str | None = None,
        category_description: str | None = None,
        category_is_predefined: bool = False,
        force_optimize: bool = False,
        skip_quality_gate: bool = False,
        skip_subject_classifier: bool = False,
        llm_effort: str | None = None,
        council_models: list[str] | None = None,
        synthesizer_model: str | None = None,
    ) -> dict[str, Any]:
        await self.session_repo.get_or_create(
            session_id=session_id,
            user_id=user_id,
            graph_thread_id=session_id,
            title=title,
        )

        from promptly.llm.tiers import get_council_models, get_synthesizer

        config = {"configurable": {"thread_id": session_id}}
        initial_state = make_graph_state(
            raw_prompt=raw_prompt,
            session_id=session_id,
            user_id=user_id,
            feedback=feedback,
            category_slug=category_slug,
            category_name=category_name,
            category_description=category_description,
            category_is_predefined=category_is_predefined,
            job_id=job_id,
            version_history_diff=version_history_diff,
            max_iterations=max_iterations,
            force_optimize=force_optimize,
            skip_quality_gate=skip_quality_gate,
            skip_subject_classifier=skip_subject_classifier,
            # Direct overrides take precedence over tier-based effort
            council_models=council_models or get_council_models(llm_effort),
            synthesizer_model=synthesizer_model or get_synthesizer(llm_effort),
        )

        result = await self.graph.ainvoke(initial_state, config=config)

        already_optimized = result.get("already_optimized", False)
        if already_optimized:
            log.info("pipeline_short_circuited", reason="performance_gate", session_id=session_id)
        else:
            log.info(
                "pipeline_complete",
                session_id=session_id,
                iterations=result.get("iteration_count", 0),
            )

        # Build token_usage dict — piggyback gate fields so they survive session reload
        # without a schema migration. On reload: read _already_optimized, _gate_* keys back.
        token_usage: dict[str, Any] = dict(result.get("token_usage") or {})
        if result.get("already_optimized"):
            token_usage["_already_optimized"] = True
            if result.get("gate_dimension_scores"):
                token_usage["_gate_dimension_scores"] = result["gate_dimension_scores"]
            if result.get("gate_rationale"):
                token_usage["_gate_rationale"] = result["gate_rationale"]
        if result.get("reasoning"):
            token_usage["_reasoning"] = result["reasoning"]

        # Persist the exchange (response = final optimized prompt)
        await self.msg_repo.create(
            session_id=uuid.UUID(session_id),
            role="assistant",
            raw_prompt=raw_prompt,
            feedback=feedback,
            enhanced_prompt=None,
            response=result["final_response"],
            council_votes=result["council_responses"],
            token_usage=token_usage,
            category_slug=category_slug,
        )

        return {
            "session_id": session_id,
            "original_prompt": raw_prompt,
            "optimized_prompt": result["final_response"],
            "council_proposals": result["council_responses"],
            "token_usage": result.get("token_usage", {}),
            "already_optimized": result.get("already_optimized", False),
            "gate_dimension_scores": result.get("gate_dimension_scores"),
            "gate_rationale": result.get("gate_rationale"),
            "reasoning": result.get("reasoning"),
        }

    async def stream(
        self, user_id: str, raw_prompt: str, session_id: str
    ) -> AsyncGenerator[str, None]:
        config = {"configurable": {"thread_id": session_id}}
        initial_state = make_graph_state(
            raw_prompt=raw_prompt,
            session_id=session_id,
            user_id=user_id,
        )
        async for event in self.graph.astream_events(initial_state, config=config, version="v2"):
            if event["event"] == "on_chat_model_stream":
                chunk = event["data"]["chunk"].content
                if chunk:
                    yield chunk
