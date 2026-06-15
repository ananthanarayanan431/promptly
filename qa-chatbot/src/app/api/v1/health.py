from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.types.response import SuccessResponse
from app.config.app import get_app_settings
from app.config.supabase import get_supabase_settings
from app.db.redis import get_redis_client
from app.dependencies import get_db
from app.schemas.health import HealthResponse, ReadinessResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=SuccessResponse[HealthResponse])
async def health() -> SuccessResponse[HealthResponse]:
    return SuccessResponse(data=HealthResponse(status="ok", version=get_app_settings().APP_VERSION))


async def _check_supabase() -> str:
    """Best-effort reachability check of the Supabase Auth service (GoTrue /auth/v1/health)."""
    settings = get_supabase_settings()
    async with httpx.AsyncClient(timeout=3.0) as http:
        resp = await http.get(
            f"{settings.SUPABASE_URL}/auth/v1/health",
            headers={"apikey": settings.SUPABASE_ANON_KEY},
        )
    return "ok" if resp.status_code == 200 else f"error: HTTP {resp.status_code}"


@router.get("/ready", response_model=SuccessResponse[ReadinessResponse])
async def readiness(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SuccessResponse[ReadinessResponse]:
    """Checks DB and Redis connectivity — used by container orchestrators."""
    checks: dict[str, Any] = {}

    # Postgres
    try:
        await db.execute(text("SELECT 1"))
        checks["postgres"] = "ok"
    except Exception as e:
        checks["postgres"] = f"error: {e}"

    # Redis
    try:
        redis = await get_redis_client()
        await redis.ping()  # type: ignore[misc]
        checks["redis"] = "ok"
    except Exception as e:
        checks["redis"] = f"error: {e}"

    # Supabase Auth service (non-gating — contributes to "degraded" only)
    try:
        checks["supabase"] = await _check_supabase()
    except Exception as e:
        checks["supabase"] = f"error: {e}"

    all_ok = all(v == "ok" for v in checks.values())
    return SuccessResponse(
        data=ReadinessResponse(status="ready" if all_ok else "degraded", checks=checks)
    )
