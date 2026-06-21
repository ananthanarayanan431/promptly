from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import sentry_sdk
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sentry_sdk.integrations.celery import CeleryIntegration
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

from promptly.api.router import api_router
from promptly.api.types.response import ResponseError
from promptly.api.v1.webhooks import router as webhooks_router
from promptly.config.app import AppSettings, get_app_settings
from promptly.core.logging import RequestLoggingMiddleware, setup_logging
from promptly.core.middleware import (
    CorrelationIdMiddleware,
    RateLimitMiddleware,
    RequestLimitMiddleware,
)
from promptly.db.redis import get_connection_pool
from promptly.db.session import AsyncSessionLocal, dispose_async_engine
from promptly.graph.builder import compile_graph
from promptly.graph.checkpointer import get_checkpointer
from promptly.seeds.templates import seed_templates
from promptly.utils.log import get_logger

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
    # Graceful shutdown — release pooled resources best-effort; isolate each step so a
    # failure in one does not skip the other, and never raise on exit.
    try:
        await dispose_async_engine()
    except Exception as exc:
        log.warning("shutdown_cleanup_failed", error=str(exc))
    try:
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

    # ── Exception handlers ─────────────────────────────────────────────────────
    # All error responses use the same envelope so clients can handle them
    # generically: { success: false, data: null, detail: "..." }

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
        """Convert FastAPI / Starlette HTTPException to the standard ErrorResponse shape."""
        return JSONResponse(
            status_code=exc.status_code,
            content={"success": False, "data": None, "detail": exc.detail},
            headers=getattr(exc, "headers", None) or {},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        """Convert Pydantic validation errors (422) to the standard ErrorResponse shape."""
        errors = exc.errors()
        if errors:
            first = errors[0]
            loc = " → ".join(str(p) for p in first.get("loc", []) if p != "body")
            detail = f"Validation error on '{loc}': {first['msg']}" if loc else first["msg"]
        else:
            detail = "Invalid request payload."
        return JSONResponse(
            status_code=422,
            content={"success": False, "data": None, "detail": detail},
        )

    @app.exception_handler(ResponseError)
    async def legacy_response_error_handler(request: Request, exc: ResponseError) -> JSONResponse:
        """Backward-compat handler for the ResponseError exception wrapper."""
        return JSONResponse(
            status_code=exc.error.code,
            content={
                "success": False,
                "data": None,
                "detail": exc.error.message or exc.error.description,
            },
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        """Catch-all for any exception not handled by a more specific handler.

        Logs the full traceback via structlog / Sentry and returns a safe 500 so
        callers always receive the standard ErrorResponse envelope rather than an
        HTML error page.
        """
        log = get_logger(__name__)
        log.exception(
            "unhandled_exception",
            path=str(request.url.path),
            method=request.method,
            error=str(exc),
        )
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "data": None,
                "detail": "An unexpected error occurred. Please try again shortly.",
            },
        )

    return app


app = create_app()
