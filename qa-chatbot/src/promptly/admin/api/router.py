from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated, Any

import httpx
import structlog
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from promptly.admin.api.schemas import (
    AdminApiKeyItem,
    AdminApiKeyList,
    AdminOpenRouterInfo,
    AdminStats,
    AdminUserItem,
    AdminUserList,
    AdminUserPatch,
    AdminUserPrompt,
    AdminUserPromptList,
    AnalyticsResponse,
    AuditLogEntry,
    AuditLogList,
    BulkTokenRequest,
    BulkTokenResult,
    GlitchTipIssue,
    GlitchTipIssueList,
    JobsMonitor,
    RateLimitEntry,
    RateLimitList,
    RateLimitResetResult,
    RevokeApiKeyResult,
    SystemHealth,
    UserActivity,
)
from promptly.admin.services.analytics.agent import (
    agent_bridge,
    agent_domain,
    agent_optimizer,
    agent_skillopt,
)
from promptly.admin.services.analytics.developer import developer_metrics
from promptly.admin.services.analytics.platform import platform_engagement, platform_logins
from promptly.admin.services.audit import log_audit
from promptly.admin.services.health import check_system_health
from promptly.admin.services.jobs import fetch_jobs_monitor
from promptly.admin.services.openrouter import fetch_openrouter_info
from promptly.admin.services.sentry import AiFixRequest, fetch_issue_detail, generate_ai_fix
from promptly.admin.services.stats import fetch_platform_stats
from promptly.admin.services.users import fetch_user_activity, list_users_paginated
from promptly.api.types.response import SuccessResponse, error_responses
from promptly.config.app import get_app_settings
from promptly.core.exceptions import NotFoundException
from promptly.core.user_context import UserContext
from promptly.db.redis import get_redis_client
from promptly.dependencies import get_db, require_admin
from promptly.models.admin_audit_log import AdminAuditLog
from promptly.models.api_key import ApiKey
from promptly.models.message import Message
from promptly.models.session import ChatSession
from promptly.models.user import User
from promptly.repositories.user_repo import UserRepository

log = structlog.get_logger()

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_admin)],
)

_ANALYTICS_VIEWS = {
    "platform_engagement",
    "platform_logins",
    "agent_optimizer",
    "agent_skillopt",
    "agent_domain",
    "agent_bridge",
    "developer_metrics",
}


# ── Stats ─────────────────────────────────────────────────────────────────────


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
    return SuccessResponse(data=await fetch_platform_stats(db))


# ── Users ─────────────────────────────────────────────────────────────────────


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
    return SuccessResponse(data=await list_users_paginated(db, page, per_page))


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
    admin: Annotated[UserContext, Depends(require_admin)],
) -> SuccessResponse[AdminUserItem]:
    repo = UserRepository(db)
    updated = await repo.update_admin_fields(
        user_id,
        is_active=body.is_active,
        is_admin=body.is_admin,
        credits_delta=body.credits_delta,
    )
    if updated is None:
        raise NotFoundException(detail="User not found")
    log_audit(
        db,
        admin_id=admin.user_id,
        action="patch_user",
        target_id=user_id,
        details={
            "is_active": body.is_active,
            "is_admin": body.is_admin,
            "credits_delta": body.credits_delta,
        },
    )
    await db.commit()
    s_cnt = (
        await db.execute(
            select(func.count()).select_from(ChatSession).where(ChatSession.user_id == user_id)
        )
    ).scalar_one()
    ak_cnt = (
        await db.execute(
            select(func.count())
            .select_from(ApiKey)
            .where(ApiKey.created_by == user_id, ApiKey.is_active == True)  # noqa: E712
        )
    ).scalar_one()
    return SuccessResponse(
        data=AdminUserItem(
            id=updated.id,
            email=updated.email,
            full_name=updated.full_name,
            avatar_url=updated.avatar_url,
            credits=updated.credits,
            token_balance=updated.token_balance,
            is_active=updated.is_active,
            is_admin=updated.is_admin,
            last_login_at=updated.last_login_at,
            created_at=updated.created_at,
            data_sharing_enabled=updated.data_sharing_enabled,
            session_count=s_cnt,
            last_session_at=None,
            api_key_count=ak_cnt,
            total_tokens_consumed=max(0, 3_000_000 - updated.token_balance),
        )
    )


@router.get(
    "/users/{user_id}/prompts",
    summary="Admin — user prompt history",
    description=(
        "Return a paginated list of optimization sessions for a user."
        " Only returns prompt content if the user has enabled data sharing. Admin-only."
    ),
    response_model=SuccessResponse[AdminUserPromptList],
    responses=error_responses(401, 403, 404, 500),
)
async def get_user_prompts(
    user_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
) -> SuccessResponse[AdminUserPromptList]:
    repo = UserRepository(db)
    user = await repo.get_by_id(user_id)
    if user is None:
        raise NotFoundException(detail="User not found")

    total: int = (
        await db.execute(
            select(func.count()).select_from(ChatSession).where(ChatSession.user_id == user_id)
        )
    ).scalar_one()

    session_rows = (
        await db.execute(
            select(
                ChatSession.id.label("session_id"),
                ChatSession.created_at,
                select(Message.raw_prompt)
                .where(Message.session_id == ChatSession.id, Message.role == "assistant")
                .order_by(Message.created_at.asc())
                .limit(1)
                .correlate(ChatSession)
                .scalar_subquery()
                .label("original_prompt"),
                select(Message.response)
                .where(
                    Message.session_id == ChatSession.id,
                    Message.role == "assistant",
                    Message.response.isnot(None),
                )
                .order_by(Message.created_at.asc())
                .limit(1)
                .correlate(ChatSession)
                .scalar_subquery()
                .label("optimized_prompt"),
                select(
                    func.coalesce(
                        Message.token_usage["total_tokens"].as_integer(),
                        0,
                    )
                )
                .where(
                    Message.session_id == ChatSession.id,
                    Message.role == "assistant",
                    Message.response.isnot(None),
                )
                .order_by(Message.created_at.asc())
                .limit(1)
                .correlate(ChatSession)
                .scalar_subquery()
                .label("tokens_used"),
            )
            .where(ChatSession.user_id == user_id)
            .order_by(ChatSession.created_at.desc())
            .offset((page - 1) * per_page)
            .limit(per_page)
        )
    ).fetchall()

    show_content = user.data_sharing_enabled
    prompts = [
        AdminUserPrompt(
            session_id=r.session_id,
            original_prompt=r.original_prompt if show_content else None,
            optimized_prompt=r.optimized_prompt if show_content else None,
            tokens_used=r.tokens_used or 0,
            created_at=r.created_at,
        )
        for r in session_rows
    ]

    return SuccessResponse(
        data=AdminUserPromptList(
            user_id=user_id,
            data_sharing_enabled=user.data_sharing_enabled,
            page=page,
            per_page=per_page,
            total=total,
            prompts=prompts,
        )
    )


@router.get(
    "/users/{user_id}/activity",
    summary="Admin — user activity",
    description=(
        "Return a detailed activity breakdown for a specific user: recent sessions,"
        " feature usage counts, and token consumption. Admin-only."
    ),
    response_model=SuccessResponse[UserActivity],
    responses=error_responses(401, 403, 404, 500),
)
async def get_user_activity(
    user_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SuccessResponse[UserActivity]:
    return SuccessResponse(data=await fetch_user_activity(db, user_id))


# ── Rate Limits ───────────────────────────────────────────────────────────────


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
    redis = await get_redis_client()
    entries = []

    cursor = 0
    while True:
        cursor, keys = await redis.scan(cursor, match="rl:user:*", count=200)
        for key in keys:
            raw = await redis.get(key)
            if raw is None:
                continue
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


@router.delete(
    "/rate-limits/{user_id}/{route:path}",
    summary="Admin — reset rate limit",
    description="Delete a specific Redis rate-limit key for a user/route combination. Admin-only.",
    response_model=SuccessResponse[RateLimitResetResult],
    responses=error_responses(401, 403, 500),
)
async def reset_rate_limit(
    user_id: str,
    route: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[UserContext, Depends(require_admin)],
) -> SuccessResponse[RateLimitResetResult]:
    redis = await get_redis_client()
    key = f"rl:user:{user_id}:{route}"
    deleted_count: int = await redis.delete(key)
    log_audit(
        db,
        admin_id=admin.user_id,
        action="reset_rate_limit",
        details={"user_id": user_id, "route": route, "key": key, "deleted": deleted_count > 0},
    )
    await db.commit()
    return SuccessResponse(data=RateLimitResetResult(deleted=deleted_count > 0, key=key))


# ── Errors ────────────────────────────────────────────────────────────────────


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


# ── OpenRouter ────────────────────────────────────────────────────────────────


@router.get(
    "/openrouter",
    summary="Admin — OpenRouter billing & usage",
    description=(
        "Return OpenRouter key stats (spend totals, credit balance) plus a 30-day"
        " daily spend timeline built from local council_votes records. Admin-only."
    ),
    response_model=SuccessResponse[AdminOpenRouterInfo],
    responses=error_responses(401, 403, 500, 502),
)
async def get_openrouter_info(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SuccessResponse[AdminOpenRouterInfo]:
    return SuccessResponse(data=await fetch_openrouter_info(db))


# ── System Health ─────────────────────────────────────────────────────────────


@router.get(
    "/health",
    summary="Admin — system health",
    description=(
        "Return a live snapshot of Redis, database, Celery workers, and job-queue health."
        " Admin-only."
    ),
    response_model=SuccessResponse[SystemHealth],
    responses=error_responses(401, 403, 500),
)
async def get_system_health(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SuccessResponse[SystemHealth]:
    return SuccessResponse(data=await check_system_health(db))


# ── API Keys ──────────────────────────────────────────────────────────────────


@router.get(
    "/api-keys",
    summary="Admin — list API keys",
    description="Return a paginated list of all API keys with the owning user's email. Admin-only.",
    response_model=SuccessResponse[AdminApiKeyList],
    responses=error_responses(401, 403, 500),
)
async def list_api_keys(
    db: Annotated[AsyncSession, Depends(get_db)],
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=200),
) -> SuccessResponse[AdminApiKeyList]:
    total: int = (await db.execute(select(func.count()).select_from(ApiKey))).scalar_one()

    rows = (
        await db.execute(
            select(ApiKey, User.email.label("user_email"))
            .join(User, ApiKey.created_by == User.id)
            .order_by(ApiKey.created_at.desc())
            .offset((page - 1) * per_page)
            .limit(per_page)
        )
    ).all()

    keys = [
        AdminApiKeyItem(
            id=str(row.ApiKey.id),
            name=row.ApiKey.name,
            user_id=str(row.ApiKey.created_by),
            user_email=row.user_email,
            is_active=row.ApiKey.is_active,
            created_at=row.ApiKey.created_at.isoformat(),
            revoked_at=row.ApiKey.revoked_at.isoformat() if row.ApiKey.revoked_at else None,
        )
        for row in rows
    ]

    return SuccessResponse(
        data=AdminApiKeyList(page=page, per_page=per_page, total=total, keys=keys)
    )


@router.delete(
    "/api-keys/{key_id}",
    summary="Admin — revoke API key",
    description="Revoke an API key by setting revoked_at and is_active=False. Admin-only.",
    response_model=SuccessResponse[RevokeApiKeyResult],
    responses=error_responses(401, 403, 404, 500),
)
async def revoke_api_key(
    key_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[UserContext, Depends(require_admin)],
) -> SuccessResponse[RevokeApiKeyResult]:
    key = (await db.execute(select(ApiKey).where(ApiKey.id == key_id))).scalar_one_or_none()
    if key is None:
        raise NotFoundException(detail="API key not found")

    await db.execute(
        update(ApiKey)
        .where(ApiKey.id == key_id)
        .values(is_active=False, revoked_at=datetime.now(UTC))
    )
    log_audit(
        db,
        admin_id=admin.user_id,
        action="revoke_api_key",
        target_id=key.created_by,
        details={"key_id": str(key_id)},
    )
    await db.commit()
    return SuccessResponse(data=RevokeApiKeyResult(id=str(key_id), revoked=True))


# ── Audit Log ─────────────────────────────────────────────────────────────────


@router.get(
    "/audit-log",
    summary="Admin — audit log",
    description="Return a paginated audit log of admin actions, newest first. Admin-only.",
    response_model=SuccessResponse[AuditLogList],
    responses=error_responses(401, 403, 500),
)
async def get_audit_log(
    db: Annotated[AsyncSession, Depends(get_db)],
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=200),
) -> SuccessResponse[AuditLogList]:
    from sqlalchemy.orm import aliased

    admin_user = aliased(User, name="admin_user")
    target_user = aliased(User, name="target_user")

    total: int = (await db.execute(select(func.count()).select_from(AdminAuditLog))).scalar_one()

    rows = (
        await db.execute(
            select(
                AdminAuditLog,
                admin_user.email.label("admin_email"),
                target_user.email.label("target_email"),
            )
            .join(admin_user, AdminAuditLog.admin_id == admin_user.id)
            .outerjoin(target_user, AdminAuditLog.target_id == target_user.id)
            .order_by(AdminAuditLog.created_at.desc())
            .offset((page - 1) * per_page)
            .limit(per_page)
        )
    ).all()

    entries = [
        AuditLogEntry(
            id=str(row.AdminAuditLog.id),
            admin_email=row.admin_email,
            action=row.AdminAuditLog.action,
            target_email=row.target_email,
            details=row.AdminAuditLog.details,
            created_at=row.AdminAuditLog.created_at.isoformat(),
        )
        for row in rows
    ]

    return SuccessResponse(
        data=AuditLogList(page=page, per_page=per_page, total=total, entries=entries)
    )


# ── Jobs Monitor ──────────────────────────────────────────────────────────────


@router.get(
    "/jobs",
    summary="Admin — jobs monitor",
    description=(
        "Scan Redis for recent chat and domain-prompt jobs and return their status. Admin-only."
    ),
    response_model=SuccessResponse[JobsMonitor],
    responses=error_responses(401, 403, 500),
)
async def get_jobs_monitor() -> SuccessResponse[JobsMonitor]:
    return SuccessResponse(data=await fetch_jobs_monitor())


# ── Bulk Token Grant ──────────────────────────────────────────────────────────


@router.post(
    "/users/bulk-tokens",
    summary="Admin — bulk token grant",
    description="Grant tokens to multiple users at once. Admin-only.",
    response_model=SuccessResponse[BulkTokenResult],
    responses=error_responses(401, 403, 422, 500),
)
async def bulk_grant_tokens(
    body: BulkTokenRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[UserContext, Depends(require_admin)],
) -> SuccessResponse[BulkTokenResult]:
    repo = UserRepository(db)
    updated = 0
    for uid_str in body.user_ids:
        try:
            uid = uuid.UUID(uid_str)
        except ValueError:
            log.warning("bulk_tokens_invalid_uuid", uid=uid_str)
            continue
        await repo.add_tokens(uid, body.amount)
        updated += 1

    log_audit(
        db,
        admin_id=admin.user_id,
        action="bulk_grant_tokens",
        details={"user_ids": body.user_ids, "amount": body.amount},
    )
    await db.commit()
    return SuccessResponse(data=BulkTokenResult(updated=updated, amount=body.amount))


# ── Analytics ─────────────────────────────────────────────────────────────────


@router.get(
    "/analytics",
    summary="Admin — analytics dashboard data",
    description="Return pre-aggregated time-series and static stats for the View analytics tab.",
    response_model=SuccessResponse[AnalyticsResponse],
    responses=error_responses(401, 403, 422, 500),
)
async def get_analytics(
    db: Annotated[AsyncSession, Depends(get_db)],
    view: str = Query(..., description="Which sub-view to load"),
    days: int = Query(default=30, ge=7, le=365),
) -> SuccessResponse[AnalyticsResponse]:
    if view not in _ANALYTICS_VIEWS:
        raise HTTPException(status_code=422, detail=f"Unknown view: {view!r}")
    handlers = {
        "platform_engagement": platform_engagement,
        "platform_logins": platform_logins,
        "agent_optimizer": agent_optimizer,
        "agent_skillopt": agent_skillopt,
        "agent_domain": agent_domain,
        "agent_bridge": agent_bridge,
        "developer_metrics": developer_metrics,
    }
    result = await handlers[view](db, days)
    return SuccessResponse(data=result)


# ── Sentry ────────────────────────────────────────────────────────────────────


@router.get(
    "/sentry/issues/{issue_id}",
    summary="Admin — Sentry issue detail with latest event",
    response_model=None,
    responses=error_responses(401, 403, 503),
)
async def get_sentry_issue_detail(
    issue_id: str,
    _admin: Annotated[Any, Depends(require_admin)],
) -> Any:
    return await fetch_issue_detail(issue_id)


@router.post(
    "/sentry/issues/ai-fix",
    summary="Admin — AI root-cause analysis and fix suggestion for a Sentry issue",
    response_model=None,
    responses=error_responses(401, 403, 503),
)
async def get_sentry_issue_ai_fix(
    payload: AiFixRequest,
    _admin: Annotated[Any, Depends(require_admin)],
) -> Any:
    return await generate_ai_fix(payload)
