from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from app.config.database import get_database_settings

db_settings = get_database_settings()


@asynccontextmanager
async def get_checkpointer() -> AsyncGenerator[AsyncPostgresSaver, None]:
    """
    Async context manager that yields a LangGraph AsyncPostgresSaver.
    Called once at app startup inside the FastAPI lifespan.
    The checkpointer persists graph state (thread-level) to PostgreSQL,
    enabling stateful multi-turn conversations across stateless API pods.
    """
    # Alembic uses psycopg2; LangGraph checkpointer needs the raw psycopg3 DSN
    conn_string = (
        str(db_settings.DATABASE_URL)
        .replace("postgresql+asyncpg", "postgresql")
        .replace("postgresql+psycopg2", "postgresql")
    )

    async with AsyncPostgresSaver.from_conn_string(conn_string) as checkpointer:
        # Creates langgraph internal checkpoint tables if they don't exist
        await checkpointer.setup()
        yield checkpointer
