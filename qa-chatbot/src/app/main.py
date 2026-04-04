from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app.config.app import get_app_settings
from app.api.router import api_router
from app.core.middleware import CorrelationIdMiddleware, RateLimitMiddleware
from app.graph.builder import compile_graph
from app.api.types.response import ErrorResponse

from app.graph.checkpointer import get_checkpointer

app_settings = get_app_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
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
    app.include_router(api_router, prefix=app_settings.API_V1_PREFIX)

    @app.exception_handler(ErrorResponse)
    async def global_error_response_handler(request: Request, exc: ErrorResponse):
        return JSONResponse(
            status_code=exc.error.code,
            content={"success": False, "data": None, "error": {"code": exc.error.code, "description": exc.error.description, "message": exc.error.message}}
        )

    return app


app = create_app()