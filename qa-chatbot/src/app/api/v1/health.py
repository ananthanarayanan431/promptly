from fastapi import APIRouter
from fastapi import Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.types.response import SuccessResponse
from app.db.redis import get_redis_client
from app.dependencies import get_db
from app.schemas.health import HealthResponse
from app.schemas.health import ReadinessResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=SuccessResponse[HealthResponse])
async def health():
    return SuccessResponse(data=HealthResponse(status="ok"))


@router.get("/ready", response_model=SuccessResponse[ReadinessResponse])
async def readiness(db: AsyncSession = Depends(get_db)):
    """Checks DB and Redis connectivity — used by container orchestrators."""
    checks: dict = {}

    # Postgres
    try:
        await db.execute(text("SELECT 1"))
        checks["postgres"] = "ok"
    except Exception as e:
        checks["postgres"] = f"error: {e}"

    # Redis
    try:
        redis = await get_redis_client()
        await redis.ping()
        checks["redis"] = "ok"
    except Exception as e:
        checks["redis"] = f"error: {e}"

    all_ok = all(v == "ok" for v in checks.values())
    return SuccessResponse(data=ReadinessResponse(
        status="ready" if all_ok else "degraded",
        checks=checks
    ))