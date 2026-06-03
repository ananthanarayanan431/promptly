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
    # LangGraph AsyncPostgresSaver uses psycopg3 which expects a plain DSN.
    conn_string = db_settings.effective_url.replace("postgresql+asyncpg", "postgresql").replace(
        "postgresql+psycopg2", "postgresql"
    )

    # psycopg3 reads sslmode from the DSN query string.
    if db_settings.is_supabase and "sslmode" not in conn_string:
        sep = "&" if "?" in conn_string else "?"
        conn_string = f"{conn_string}{sep}sslmode=require"

    async with AsyncPostgresSaver.from_conn_string(conn_string) as checkpointer:
        await checkpointer.setup()
        yield checkpointer
