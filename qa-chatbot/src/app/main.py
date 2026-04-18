from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.router import api_router
from app.api.types.response import ResponseError
from app.config.app import get_app_settings
from app.config.env import get_env_settings
from app.core.logging import setup_logging
from app.core.middleware import CorrelationIdMiddleware, RateLimitMiddleware, RequestLimitMiddleware
from app.db.session import AsyncSessionLocal
from app.dependencies import _ANONYMOUS_USER
from app.graph.builder import compile_graph
from app.graph.checkpointer import get_checkpointer

app_settings = get_app_settings()


async def _seed_anonymous_user() -> None:
    """
    Ensure the anonymous dev user exists in the DB.
    Called on startup only when AUTH_ENABLED=False so that FK constraints
    (e.g. prompt_versions.user_id → users.id) are satisfied without a real login.
    """
    async with AsyncSessionLocal() as session:
        from sqlalchemy import select

        from app.models.user import User

        existing = await session.execute(select(User).where(User.id == _ANONYMOUS_USER.id))
        if existing.scalar_one_or_none() is None:
            session.add(
                User(
                    id=_ANONYMOUS_USER.id,
                    email=_ANONYMOUS_USER.email,
                    credits=_ANONYMOUS_USER.credits,
                    is_active=True,
                    is_superuser=False,
                )
            )
            await session.commit()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    setup_logging(debug=app_settings.DEBUG)
    if not get_env_settings().AUTH_ENABLED:
        await _seed_anonymous_user()
    async with get_checkpointer() as checkpointer:
        app.state.graph = await compile_graph(checkpointer)
        yield


def create_app() -> FastAPI:
    app = FastAPI(
        title=app_settings.APP_NAME,
        version="0.1.0",
        docs_url="/docs" if app_settings.DEBUG else None,
        redoc_url=None,
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=app_settings.CORS_ORIGIN,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(CorrelationIdMiddleware)
    app.add_middleware(RateLimitMiddleware)
    app.add_middleware(RequestLimitMiddleware)
    app.include_router(api_router, prefix=app_settings.API_V1_PREFIX)

    @app.exception_handler(ResponseError)
    async def global_error_response_handler(request: Request, exc: ResponseError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.error.code,
            content={
                "success": False,
                "data": None,
                "error": {
                    "code": exc.error.code,
                    "description": exc.error.description,
                    "message": exc.error.message,
                },
            },
        )

    return app


app = create_app()
