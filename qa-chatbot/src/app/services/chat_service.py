import uuid
from collections.abc import AsyncGenerator
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.graph.state import GraphState
from app.repositories.message_repo import MessageRepository
from app.repositories.session_repo import SessionRepository


class ChatService:
    def __init__(self, db: AsyncSession, graph: Any) -> None:  # noqa: ANN401
        self.db = db
        self.graph = graph
        self.msg_repo = MessageRepository(db)
        self.session_repo = SessionRepository(db)

    async def process(
        self, user_id: str, raw_prompt: str, session_id: str, feedback: str | None = None
    ) -> dict:
        await self.session_repo.get_or_create(
            session_id=session_id,
            user_id=user_id,
            graph_thread_id=session_id,
        )

        config = {"configurable": {"thread_id": session_id}}
        initial_state: GraphState = {
            "raw_prompt": raw_prompt,
            "session_id": session_id,
            "user_id": user_id,
            "feedback": feedback,
            "intent": None,
            "council_responses": [],
            "final_response": "",
            "messages": [],
            "token_usage": {},
            "error": None,
        }

        result = await self.graph.ainvoke(initial_state, config=config)

        # Persist the exchange (response = final optimized prompt)
        await self.msg_repo.create(
            session_id=uuid.UUID(session_id),
            role="user",
            raw_prompt=raw_prompt,
            enhanced_prompt=None,
            response=result["final_response"],
            council_votes=result["council_responses"],
            token_usage=result.get("token_usage", {}),
        )

        return {
            "session_id": session_id,
            "original_prompt": raw_prompt,
            "optimized_prompt": result["final_response"],
            "council_proposals": result["council_responses"],
            "token_usage": result.get("token_usage", {}),
        }

    async def stream(
        self, user_id: str, raw_prompt: str, session_id: str
    ) -> AsyncGenerator[str, None]:
        config = {"configurable": {"thread_id": session_id}}
        initial_state: GraphState = {
            "raw_prompt": raw_prompt,
            "session_id": session_id,
            "user_id": user_id,
            "intent": None,
            "council_responses": [],
            "final_response": "",
            "messages": [],
            "token_usage": {},
            "error": None,
        }
        async for event in self.graph.astream_events(initial_state, config=config, version="v2"):
            if event["event"] == "on_chat_model_stream":
                chunk = event["data"]["chunk"].content
                if chunk:
                    yield chunk
