from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import sentry_sdk
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sentry_sdk.integrations.celery import CeleryIntegration
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

from app.api.router import api_router
from app.api.types.response import ResponseError
from app.api.v1.webhooks import router as webhooks_router
from app.config.app import AppSettings, get_app_settings
from app.core.logging import RequestLoggingMiddleware, setup_logging
from app.core.middleware import CorrelationIdMiddleware, RateLimitMiddleware, RequestLimitMiddleware
from app.db.redis import get_connection_pool
from app.db.session import AsyncSessionLocal, dispose_async_engine
from app.graph.builder import compile_graph
from app.graph.checkpointer import get_checkpointer
from app.seeds.templates import seed_templates
from app.utils.log import get_logger

app_settings = get_app_settings()


def _init_sentry(settings: AppSettings) -> None:
    if not settings.SENTRY_DSN:
        return
    sentry_sdk.init(
        dsn=settings.SENTRY_DSN.get_secret_value(),
        environment=settings.ENVIRONMENT,
        integrations=[
            FastApiIntegration(transaction_style="endpoint"),
            SqlalchemyIntegration(),
            CeleryIntegration(),
        ],
        traces_sample_rate=0.2 if settings.ENVIRONMENT == "production" else 0.0,
        send_default_pii=False,
    )


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    setup_logging(debug=app_settings.DEBUG)
    log = get_logger(__name__)
    log.info("app_starting", environment=app_settings.ENVIRONMENT, debug=app_settings.DEBUG)
    async with AsyncSessionLocal() as session:
        await seed_templates(session)
    async with get_checkpointer() as checkpointer:
        app.state.graph = await compile_graph(checkpointer)
        log.info("app_started")
        yield
    # Graceful shutdown — release pooled resources (best-effort; never raise on exit).
    try:
        await dispose_async_engine()
        await get_connection_pool().disconnect()
    except Exception as exc:
        log.warning("shutdown_cleanup_failed", error=str(exc))
    log.info("app_shutdown")


def create_app() -> FastAPI:
    settings = get_app_settings()
    _init_sentry(settings)
    app = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        docs_url="/docs" if settings.DEBUG else None,
        redoc_url=None,
        lifespan=lifespan,
    )

    # Middleware added last is outermost. CorrelationIdMiddleware is added last so it
    # binds the correlation_id (and tags Sentry) before all others and sets the
    # X-Correlation-ID header on every response — including 429/413/504 emitted by the
    # rate-limit / request-limit middlewares.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGIN,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(RequestLoggingMiddleware)
    app.add_middleware(RateLimitMiddleware)
    app.add_middleware(RequestLimitMiddleware)
    app.add_middleware(CorrelationIdMiddleware)
    app.include_router(api_router, prefix=settings.API_V1_PREFIX)
    # webhooks_router is an intentional empty placeholder for future Supabase
    # webhook handlers; user provisioning happens on first login in dependencies.py.
    app.include_router(webhooks_router)

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
