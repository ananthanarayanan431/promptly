import asyncio
from app.workers.celery_app import celery_app


@celery_app.task(bind=True, max_retries=3, default_retry_delay=5)
def process_chat_async(self, user_id: str, raw_prompt: str, session_id: str):
    """
    Background task for non-streaming council processing.
    Useful for fire-and-forget jobs or webhook-based flows.
    """
    try:
        from app.services.chat_service import ChatService
        from app.db.session import AsyncSessionLocal
        from app.main import app

        async def _run():
            async with AsyncSessionLocal() as db:
                graph = app.state.graph
                service = ChatService(db=db, graph=graph)
                return await service.process(
                    user_id=user_id,
                    raw_prompt=raw_prompt,
                    session_id=session_id,
                )

        return asyncio.run(_run())
    except Exception as exc:
        raise self.retry(exc=exc)