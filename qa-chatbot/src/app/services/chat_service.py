import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from app.graph.state import GraphState
from app.repositories.message_repo import MessageRepository
from app.repositories.session_repo import SessionRepository


class ChatService:
    def __init__(self, db: AsyncSession, graph):
        self.db = db
        self.graph = graph
        self.msg_repo = MessageRepository(db)
        self.session_repo = SessionRepository(db)

    async def process(self, user_id: str, raw_prompt: str, session_id: str) -> dict:
        # Ensure session exists
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
            "enhanced_prompt": "",
            "council_responses": [],
            "final_response": "",
            "messages": [],
            "token_usage": {},
            "error": None,
        }

        result = await self.graph.ainvoke(initial_state, config=config)

        # Persist
        await self.msg_repo.create(
            session_id=uuid.UUID(session_id),
            role="user",
            raw_prompt=raw_prompt,
            enhanced_prompt=result["enhanced_prompt"],
            response=result["final_response"],
            council_votes=result["council_responses"],
            token_usage=result["token_usage"],
        )

        return {
            "session_id": session_id,
            "enhanced_prompt": result["enhanced_prompt"],
            "response": result["final_response"],
            "token_usage": result["token_usage"],
        }

    async def stream(self, user_id: str, raw_prompt: str, session_id: str):
        config = {"configurable": {"thread_id": session_id}}
        initial_state: GraphState = {
            "raw_prompt": raw_prompt,
            "session_id": session_id,
            "user_id": user_id,
            "enhanced_prompt": "",
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