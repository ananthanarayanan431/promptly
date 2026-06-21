from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from promptly.admin.api.schemas import (
    AdminStats,
    AdminUserItem,
    AdminUserList,
    AdminUserPatch,
    GlitchTipIssue,
    GlitchTipIssueList,
    RateLimitEntry,
    RateLimitList,
)
from promptly.api.types.response import SuccessResponse, error_responses
from promptly.config.app import get_app_settings
from promptly.core.exceptions import NotFoundException
from promptly.db.redis import get_redis_client
from promptly.dependencies import get_db, require_admin
from promptly.models.session import ChatSession
from promptly.models.user import User
from promptly.repositories.user_repo import UserRepository

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_admin)],
)


@router.get(
    "/stats",
    summary="Admin — aggregate stats",
    description=(
        "Return platform-wide counters: total users, total optimizations, tokens consumed,"
        " and active users in the last 7 days. Admin-only."
    ),
    response_model=SuccessResponse[AdminStats],
    responses=error_responses(401, 403, 500),
)
async def get_stats(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SuccessResponse[AdminStats]:
    """Aggregate application statistics."""
    total_users_result = await db.execute(select(func.count()).select_from(User))
    total_users: int = total_users_result.scalar_one()

    total_opts_result = await db.execute(select(func.count()).select_from(ChatSession))
    total_optimizations: int = total_opts_result.scalar_one()

    tokens_result = await db.execute(
        select(func.coalesce(func.sum(3_000_000 - User.token_balance), 0)).select_from(User)
    )
    total_tokens_consumed: int = tokens_result.scalar_one()

    cutoff = datetime.now(UTC) - timedelta(days=7)
    active_result = await db.execute(
        select(func.count()).select_from(User).where(User.last_login_at >= cutoff)
    )
    active_users_7d: int = active_result.scalar_one()

    return SuccessResponse(
        data=AdminStats(
            total_users=total_users,
            total_optimizations=total_optimizations,
            total_tokens_consumed=total_tokens_consumed,
            active_users_7d=active_users_7d,
        )
    )


@router.get(
    "/users",
    summary="Admin — list users",
    description=(
        "Return a paginated list of all registered users with token balance and admin flag."
        " Admin-only."
    ),
    response_model=SuccessResponse[AdminUserList],
    responses=error_responses(401, 403, 429, 500),
)
async def list_users(
    db: Annotated[AsyncSession, Depends(get_db)],
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=200),
) -> SuccessResponse[AdminUserList]:
    """Paginated list of all users."""
    repo = UserRepository(db)
    users, total = await repo.get_all_paginated(page, per_page)
    return SuccessResponse(
        data=AdminUserList(
            page=page,
            per_page=per_page,
            total=total,
            users=[AdminUserItem.model_validate(u) for u in users],
        )
    )


@router.patch(
    "/users/{user_id}",
    summary="Admin — update user",
    description=(
        "Update `is_active`, `is_admin`, or apply a token-balance delta for any user. Admin-only."
    ),
    response_model=SuccessResponse[AdminUserItem],
    responses=error_responses(401, 403, 404, 422, 500),
)
async def patch_user(
    user_id: uuid.UUID,
    body: AdminUserPatch,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SuccessResponse[AdminUserItem]:
    """Update is_active, is_admin, or credits for any user."""
    repo = UserRepository(db)
    updated = await repo.update_admin_fields(
        user_id,
        is_active=body.is_active,
        is_admin=body.is_admin,
        credits_delta=body.credits_delta,
    )
    if updated is None:
        raise NotFoundException(detail="User not found")
    await db.commit()
    return SuccessResponse(data=AdminUserItem.model_validate(updated))


@router.get(
    "/rate-limits",
    summary="Admin — rate-limit hits",
    description=(
        "Return current rate-limit hit counts from Redis (`rl:user:*` keys),"
        " sorted by hit count descending. Admin-only."
    ),
    response_model=SuccessResponse[RateLimitList],
    responses=error_responses(401, 403, 500),
)
async def get_rate_limits() -> SuccessResponse[RateLimitList]:
    """Current rate limit hit counts from Redis (rl:user:* keys)."""
    redis = await get_redis_client()
    entries = []

    cursor = 0
    while True:
        cursor, keys = await redis.scan(cursor, match="rl:user:*", count=200)
        for key in keys:
            raw = await redis.get(key)
            if raw is None:
                continue
            # key format: rl:user:{user_id}:{route_path}
            parts = key.split(":", 3)
            if len(parts) < 4:  # noqa: PLR2004
                continue
            user_id = parts[2]
            route = parts[3]
            entries.append(RateLimitEntry(user_id=user_id, route=route, hit_count=int(raw)))
        if cursor == 0:
            break

    entries.sort(key=lambda e: e.hit_count, reverse=True)
    return SuccessResponse(data=RateLimitList(entries=entries))


@router.get(
    "/errors",
    summary="Admin — recent errors",
    description=(
        "Proxy recent unresolved issues from the GlitchTip error tracker."
        " Returns an empty list when GlitchTip is not configured. Admin-only."
    ),
    response_model=SuccessResponse[GlitchTipIssueList],
    responses=error_responses(401, 403, 500, 502),
)
async def get_errors() -> SuccessResponse[GlitchTipIssueList]:
    """Proxy recent issues from GlitchTip API."""
    settings = get_app_settings()

    if not settings.GLITCHTIP_API_URL or not settings.GLITCHTIP_API_TOKEN:
        return SuccessResponse(data=GlitchTipIssueList(issues=[]))

    headers = {"Authorization": f"Bearer {settings.GLITCHTIP_API_TOKEN.get_secret_value()}"}
    url = f"{settings.GLITCHTIP_API_URL.rstrip('/')}/issues/?limit=50"

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(url, headers=headers)
        resp.raise_for_status()
        raw: list[dict[str, Any]] = resp.json()

    issues = [
        GlitchTipIssue(
            id=str(item.get("id", "")),
            title=str(item.get("title", "")),
            occurrences=int(item.get("count", 0)),
            status=str(item.get("status", "unresolved")),
            first_seen=str(item.get("firstSeen", "")),
            last_seen=str(item.get("lastSeen", "")),
        )
        for item in raw
    ]
    return SuccessResponse(data=GlitchTipIssueList(issues=issues))
