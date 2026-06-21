from __future__ import annotations

import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

import httpx
import structlog
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

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
    AuditLogEntry,
    AuditLogList,
    BulkTokenRequest,
    BulkTokenResult,
    DailyActivity,
    DailySpend,
    DatabaseHealth,
    FeatureUsage,
    GlitchTipIssue,
    GlitchTipIssueList,
    JobEntry,
    JobsMonitor,
    JobsSummary,
    ModelSpendItem,
    QueueHealth,
    RateLimitEntry,
    RateLimitList,
    RateLimitResetResult,
    RedisHealth,
    RevokeApiKeyResult,
    SystemHealth,
    TopUser,
    UserActivity,
    UserActivitySession,
    WorkerHealth,
)
from promptly.api.types.response import SuccessResponse, error_responses
from promptly.config.app import get_app_settings
from promptly.core.cache import get_job_owner
from promptly.core.exceptions import NotFoundException
from promptly.core.user_context import UserContext
from promptly.db.redis import get_redis_client
from promptly.dependencies import get_db, require_admin
from promptly.domain_prompt.infrastructure.cache import get_dp_job_owner
from promptly.llm.settings import get_llm_settings
from promptly.models.admin_audit_log import AdminAuditLog
from promptly.models.api_key import ApiKey
from promptly.models.message import Message
from promptly.models.session import ChatSession
from promptly.models.usage_event import UsageEvent
from promptly.models.user import User
from promptly.repositories.user_repo import UserRepository

log = structlog.get_logger()

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_admin)],
)

# ── OpenRouter cost table ($/1M tokens, avg of input+output) ─────────────────
_OR_COST_IO: dict[str, tuple[float, float]] = {
    "llama-3.2-3b-instruct": (0.051, 0.34),
    "mistral-7b-instruct": (0.13, 0.13),
    "gemini-2.0-flash": (0.10, 0.40),
    "gpt-4o-mini": (0.15, 0.60),
    "claude-3.5-haiku": (0.80, 4.00),
    "gemini-2.5-flash": (0.30, 2.50),
    "grok-4.3": (1.25, 2.50),
    "gpt-4o": (2.50, 10.00),
    "claude-3.5-sonnet": (3.00, 15.00),
    "gemini-2.5-pro": (1.25, 10.00),
    "grok-3": (3.00, 15.00),
    "grok-2": (2.00, 10.00),
    "gemini-2.0-flash-lite": (0.075, 0.30),
}
_OR_DEFAULT_COST_PER_TOKEN: float = 2.50 / 1_000_000  # $2.50/1M fallback


def _or_cost_per_token(model: str) -> float:
    name = model.split("/")[-1] if "/" in model else model
    pair = _OR_COST_IO.get(name)
    if pair is not None:
        return (pair[0] + pair[1]) / 2 / 1_000_000
    return _OR_DEFAULT_COST_PER_TOKEN


async def _fetch_or_key_info() -> dict[str, Any]:
    """Fetch OpenRouter /api/v1/auth/key and return the data payload."""
    llm = get_llm_settings()
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(
            "https://openrouter.ai/api/v1/auth/key",
            headers={"Authorization": f"Bearer {llm.OPENROUTER_API_KEY.get_secret_value()}"},
        )
        resp.raise_for_status()
    return dict(resp.json().get("data", {}))


_FEATURE_LABELS: dict[str, str] = {
    "optimize": "Council Optimizer",
    "health_score": "Health Score",
    "advisory": "Advisory",
    "domain_pdo": "Domain PDO",
    "domain_gepa": "Domain GEPA",
    "bridge": "Bridge",
    "domain_gepa_augment": "Dataset Augment",
}


def log_audit(
    db: AsyncSession,
    admin_id: uuid.UUID,
    action: str,
    target_id: uuid.UUID | None = None,
    details: dict[str, Any] | None = None,
) -> AdminAuditLog:
    """Create an AdminAuditLog record and add it to the session (no flush/commit)."""
    entry = AdminAuditLog(
        admin_id=admin_id,
        action=action,
        target_id=target_id,
        details=details,
    )
    db.add(entry)
    return entry


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
    """Aggregate platform-wide statistics with feature breakdown, daily chart, and top consumers."""
    now = datetime.now(UTC)
    cutoff_7d = now - timedelta(days=7)
    cutoff_30d = now - timedelta(days=30)
    cutoff_14d = now - timedelta(days=14)

    # ── User counters ──────────────────────────────────────────────────────────
    total_users: int = (await db.execute(select(func.count()).select_from(User))).scalar_one()
    new_7d: int = (
        await db.execute(select(func.count()).select_from(User).where(User.created_at >= cutoff_7d))
    ).scalar_one()
    new_30d: int = (
        await db.execute(
            select(func.count()).select_from(User).where(User.created_at >= cutoff_30d)
        )
    ).scalar_one()
    active_7d: int = (
        await db.execute(
            select(func.count()).select_from(User).where(User.last_login_at >= cutoff_7d)
        )
    ).scalar_one()

    # ── Token metrics ──────────────────────────────────────────────────────────
    total_opts: int = (await db.execute(select(func.count()).select_from(ChatSession))).scalar_one()
    total_budget = total_users * 3_000_000
    consumed_result = await db.execute(
        select(func.coalesce(func.sum(3_000_000 - User.token_balance), 0)).select_from(User)
    )
    total_consumed: int = max(0, int(consumed_result.scalar_one()))
    avg_per_user = total_consumed // max(1, total_users)
    budget_pct = round((total_consumed / max(1, total_budget)) * 100, 1)

    # ── Feature usage from usage_events ───────────────────────────────────────
    feature_rows = (
        await db.execute(
            select(UsageEvent.action, func.count().label("cnt"))
            .group_by(UsageEvent.action)
            .order_by(func.count().desc())
        )
    ).fetchall()
    feature_usage = [
        FeatureUsage(
            feature=row.action,
            calls=row.cnt,
            label=_FEATURE_LABELS.get(row.action, row.action.replace("_", " ").title()),
        )
        for row in feature_rows
    ]

    # ── Daily activity (last 14 days) ─────────────────────────────────────────
    from sqlalchemy import Date as SqlDate
    from sqlalchemy import cast

    daily_rows = (
        await db.execute(
            select(
                cast(UsageEvent.created_at, SqlDate).label("day"),
                func.count().label("calls"),
            )
            .where(UsageEvent.created_at >= cutoff_14d)
            .group_by(cast(UsageEvent.created_at, SqlDate))
            .order_by(cast(UsageEvent.created_at, SqlDate))
        )
    ).fetchall()
    # Fill in missing days with zeros
    daily_map = {str(r.day): r.calls for r in daily_rows}
    daily_activity = [
        DailyActivity(
            date=str((cutoff_14d + timedelta(days=i)).date()),
            calls=daily_map.get(str((cutoff_14d + timedelta(days=i)).date()), 0),
            tokens=0,  # token-per-day requires expensive join; calls is actionable
        )
        for i in range(14)
    ]

    # ── Top consumers (top 8 by tokens burned) ────────────────────────────────
    top_rows = (
        (await db.execute(select(User).order_by((3_000_000 - User.token_balance).desc()).limit(8)))
        .scalars()
        .all()
    )

    # Get per-user call count from usage_events
    call_counts_rows = (
        await db.execute(
            select(UsageEvent.user_id, func.count().label("cnt")).group_by(UsageEvent.user_id)
        )
    ).fetchall()
    call_map = {str(r.user_id): r.cnt for r in call_counts_rows}

    top_users = [
        TopUser(
            email=u.email,
            tokens_consumed=max(0, 3_000_000 - u.token_balance),
            token_balance=u.token_balance,
            calls=call_map.get(str(u.id), 0),
        )
        for u in top_rows
    ]

    return SuccessResponse(
        data=AdminStats(
            total_users=total_users,
            new_users_7d=new_7d,
            new_users_30d=new_30d,
            active_users_7d=active_7d,
            total_optimizations=total_opts,
            total_tokens_consumed=total_consumed,
            total_token_budget=total_budget,
            avg_tokens_per_user=avg_per_user,
            token_budget_used_pct=budget_pct,
            feature_usage=feature_usage,
            daily_activity=daily_activity,
            top_users=top_users,
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
    user_ids = [u.id for u in users]

    # Batch session counts + last session date for this page
    session_rows = (
        await db.execute(
            select(
                ChatSession.user_id,
                func.count().label("cnt"),
                func.max(ChatSession.created_at).label("last_session"),
            )
            .where(ChatSession.user_id.in_(user_ids))
            .group_by(ChatSession.user_id)
        )
    ).fetchall()
    session_map = {str(r.user_id): (r.cnt, r.last_session) for r in session_rows}

    # Batch active API key counts for this page
    api_key_rows = (
        await db.execute(
            select(ApiKey.created_by, func.count().label("cnt"))
            .where(ApiKey.created_by.in_(user_ids), ApiKey.is_active == True)  # noqa: E712
            .group_by(ApiKey.created_by)
        )
    ).fetchall()
    api_key_map = {str(r.created_by): r.cnt for r in api_key_rows}

    items = []
    for u in users:
        s_cnt, last_session = session_map.get(str(u.id), (0, None))
        ak_cnt = api_key_map.get(str(u.id), 0)
        items.append(
            AdminUserItem(
                id=u.id,
                email=u.email,
                full_name=u.full_name,
                avatar_url=u.avatar_url,
                credits=u.credits,
                token_balance=u.token_balance,
                is_active=u.is_active,
                is_admin=u.is_admin,
                last_login_at=u.last_login_at,
                created_at=u.created_at,
                data_sharing_enabled=u.data_sharing_enabled,
                session_count=s_cnt,
                last_session_at=last_session,
                api_key_count=ak_cnt,
                total_tokens_consumed=max(0, 3_000_000 - u.token_balance),
            )
        )

    return SuccessResponse(
        data=AdminUserList(page=page, per_page=per_page, total=total, users=items)
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
    """Return user's optimization history. Prompt text is masked if data_sharing_enabled=False."""
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
                .where(Message.session_id == ChatSession.id, Message.role == "user")
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
    """Combine live OpenRouter key data with local 30-day daily spend history."""
    # ── Live key info from OpenRouter ─────────────────────────────────────────
    key_info = await _fetch_or_key_info()

    def _kf(key: str) -> float:
        return float(str(key_info.get(key) or 0))

    limit_val = key_info.get("limit")
    limit_usd: float | None = float(str(limit_val)) if limit_val is not None else None
    all_time_spend = round(_kf("usage"), 6)
    limit_remaining: float | None = (
        round(limit_usd - all_time_spend, 6) if limit_usd is not None else None
    )

    # ── Local 30-day spend from council_votes ──────────────────────────────────
    cutoff = datetime.now(UTC) - timedelta(days=30)
    msg_rows = (
        await db.execute(
            select(Message.council_votes, Message.created_at, Message.session_id)
            .where(Message.council_votes.isnot(None), Message.created_at >= cutoff)
            .order_by(Message.created_at.asc())
        )
    ).fetchall()

    # Aggregate per-day and per-model
    day_sessions: dict[str, set[str]] = {}
    day_tokens: dict[str, int] = {}
    day_cost: dict[str, float] = {}
    all_model_tokens: dict[str, int] = {}

    for row in msg_rows:
        votes = row.council_votes
        if not isinstance(votes, list):
            continue
        day = row.created_at.strftime("%Y-%m-%d")
        sid = str(row.session_id)
        day_sessions.setdefault(day, set()).add(sid)
        day_tokens.setdefault(day, 0)
        day_cost.setdefault(day, 0.0)
        for vote in votes:
            if not isinstance(vote, dict):
                continue
            model = str(vote.get("model") or "unknown")
            usage = vote.get("usage") or {}
            if not isinstance(usage, dict):
                continue
            tokens = int(str(usage.get("total_tokens") or 0)) or (
                int(str(usage.get("input_tokens") or 0)) + int(str(usage.get("output_tokens") or 0))
            )
            cost = tokens * _or_cost_per_token(model)
            day_tokens[day] = day_tokens[day] + tokens
            day_cost[day] = day_cost[day] + cost
            all_model_tokens[model] = all_model_tokens.get(model, 0) + tokens

    # Build ordered 30-day list (oldest → newest)
    today = datetime.now(UTC).date()
    daily_history = []
    for i in range(30):
        ds = (today - timedelta(days=29 - i)).strftime("%Y-%m-%d")
        daily_history.append(
            DailySpend(
                date=ds,
                sessions=len(day_sessions.get(ds, set())),
                total_tokens=day_tokens.get(ds, 0),
                total_cost_usd=round(day_cost.get(ds, 0.0), 6),
            )
        )

    top_models = sorted(
        [
            ModelSpendItem(
                model=m,
                total_tokens=t,
                total_cost_usd=round(t * _or_cost_per_token(m), 6),
            )
            for m, t in all_model_tokens.items()
        ],
        key=lambda x: -x.total_cost_usd,
    )[:10]

    return SuccessResponse(
        data=AdminOpenRouterInfo(
            label=str(key_info.get("label") or "API Key"),
            is_free_tier=bool(key_info.get("is_free_tier", False)),
            all_time_spend=all_time_spend,
            monthly_spend=round(_kf("usage_monthly"), 6),
            weekly_spend=round(_kf("usage_weekly"), 6),
            daily_spend_today=round(_kf("usage_daily"), 6),
            limit=limit_usd,
            limit_remaining=limit_remaining,
            daily_history=daily_history,
            top_models=top_models,
        )
    )


# ── Feature 1: System Health ──────────────────────────────────────────────────


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
    """Live health snapshot of all platform components."""
    from promptly.workers.celery_app import celery_app  # local to avoid circular import

    redis = await get_redis_client()
    try:
        info: dict[str, Any] = await redis.info()
        total_keys: int = await redis.dbsize()
        redis_health = RedisHealth(
            status="ok",
            used_memory_human=str(info.get("used_memory_human", "?")),
            connected_clients=int(info.get("connected_clients", 0)),
            total_keys=total_keys,
        )
    except Exception:
        redis_health = RedisHealth(
            status="error", used_memory_human="?", connected_clients=0, total_keys=0
        )

    try:
        t0 = time.perf_counter()
        await db.execute(text("SELECT 1"))
        elapsed_ms = (time.perf_counter() - t0) * 1000
        db_health = DatabaseHealth(status="ok", response_time_ms=round(elapsed_ms, 2))
    except Exception:
        db_health = DatabaseHealth(status="error", response_time_ms=0.0)

    try:
        inspector = celery_app.control.inspect(timeout=2.0)
        active: dict[str, list[Any]] | None = inspector.active()
        if not active:
            worker_health = WorkerHealth(status="error", active_count=0, worker_names=[])
        else:
            worker_names = list(active.keys())
            active_count = sum(len(tasks) for tasks in active.values())
            worker_health = WorkerHealth(
                status="ok" if worker_names else "degraded",
                active_count=active_count,
                worker_names=worker_names,
            )
    except Exception:
        worker_health = WorkerHealth(status="error", active_count=0, worker_names=[])

    pending_chat = active_chat = pending_domain = active_domain = 0
    try:
        async for key in redis.scan_iter("chat:job:*:status", count=200):
            val: str | None = await redis.get(key)
            if val == "queued":
                pending_chat += 1
            elif val == "started":
                active_chat += 1
        async for key in redis.scan_iter("domain_prompt:job:*:status", count=200):
            val = await redis.get(key)
            if val == "queued":
                pending_domain += 1
            elif val == "started":
                active_domain += 1
    except Exception as exc:
        log.warning("queue_health_scan_failed", error=str(exc))

    return SuccessResponse(
        data=SystemHealth(
            redis=redis_health,
            database=db_health,
            workers=worker_health,
            queue=QueueHealth(
                pending_chat=pending_chat,
                active_chat=active_chat,
                pending_domain=pending_domain,
                active_domain=active_domain,
            ),
            checked_at=datetime.now(UTC).isoformat(),
        )
    )


# ── Feature 2: User Activity drill-down ───────────────────────────────────────


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
    """Activity drill-down for a single user."""
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise NotFoundException(detail="User not found")

    sessions_result = (
        (
            await db.execute(
                select(ChatSession)
                .where(ChatSession.user_id == user_id)
                .order_by(ChatSession.created_at.desc())
                .limit(20)
            )
        )
        .scalars()
        .all()
    )

    session_count: int = (
        await db.execute(
            select(func.count()).select_from(ChatSession).where(ChatSession.user_id == user_id)
        )
    ).scalar_one()

    activity_sessions: list[UserActivitySession] = []
    total_tokens = 0
    for sess in sessions_result:
        msgs = (
            (await db.execute(select(Message).where(Message.session_id == sess.id))).scalars().all()
        )
        sess_tokens = 0
        for msg in msgs:
            if msg.token_usage and isinstance(msg.token_usage, dict):
                sess_tokens += int(msg.token_usage.get("total_tokens", 0))
        total_tokens += sess_tokens
        activity_sessions.append(
            UserActivitySession(
                id=str(sess.id),
                title=sess.title,
                created_at=sess.created_at.isoformat(),
                token_count=sess_tokens,
                message_count=len(msgs),
            )
        )

    feature_rows = (
        await db.execute(
            select(UsageEvent.action, func.count().label("cnt"))
            .where(UsageEvent.user_id == user_id)
            .group_by(UsageEvent.action)
        )
    ).fetchall()

    return SuccessResponse(
        data=UserActivity(
            user_id=str(user.id),
            email=user.email,
            sessions=activity_sessions,
            feature_counts={row.action: row.cnt for row in feature_rows},
            total_tokens_consumed=total_tokens,
            session_count=session_count,
            first_seen=user.created_at.isoformat(),
            last_seen=user.last_login_at.isoformat() if user.last_login_at else None,
        )
    )


# ── Feature 3: Rate Limit Reset ───────────────────────────────────────────────


@router.delete(
    "/rate-limits/{user_id}/{route:path}",
    summary="Admin — reset rate limit",
    description=(
        "Delete a specific Redis rate-limit key for a user/route combination. Admin-only."
    ),
    response_model=SuccessResponse[RateLimitResetResult],
    responses=error_responses(401, 403, 500),
)
async def reset_rate_limit(
    user_id: str,
    route: str,
) -> SuccessResponse[RateLimitResetResult]:
    """Delete a single rate-limit key from Redis."""
    redis = await get_redis_client()
    key = f"rl:user:{user_id}:{route}"
    deleted_count: int = await redis.delete(key)
    return SuccessResponse(data=RateLimitResetResult(deleted=deleted_count > 0, key=key))


# ── Feature 4: API Keys management ────────────────────────────────────────────


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
    """Paginated list of all API keys with owner email."""
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
    """Revoke an API key."""
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


# ── Feature 5: Audit Log ──────────────────────────────────────────────────────


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
    """Paginated audit log with admin and target user emails."""
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


# ── Feature 6: Jobs Monitor ────────────────────────────────────────────────────


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
    """Scan active/recent jobs from Redis."""
    redis = await get_redis_client()
    jobs: list[JobEntry] = []

    async for key in redis.scan_iter("chat:job:*:status", count=200):
        parts = key.split(":")
        if len(parts) < 4:  # noqa: PLR2004
            continue
        job_id = parts[2]
        status: str | None = await redis.get(key)
        if status is None:
            continue
        try:
            user_id = await get_job_owner(job_id)
        except Exception:
            user_id = None
        jobs.append(JobEntry(job_id=job_id, type="chat", status=status, user_id=user_id))

    async for key in redis.scan_iter("domain_prompt:job:*:status", count=200):
        parts = key.split(":")
        if len(parts) < 4:  # noqa: PLR2004
            continue
        job_id = parts[2]
        status = await redis.get(key)
        if status is None:
            continue
        try:
            user_id = await get_dp_job_owner(job_id)
        except Exception:
            user_id = None
        jobs.append(JobEntry(job_id=job_id, type="domain", status=status, user_id=user_id))

    jobs = jobs[:100]
    summary = JobsSummary(
        queued=sum(1 for j in jobs if j.status == "queued"),
        running=sum(1 for j in jobs if j.status == "started"),
        completed=sum(1 for j in jobs if j.status == "completed"),
        failed=sum(1 for j in jobs if j.status == "failed"),
    )
    return SuccessResponse(data=JobsMonitor(jobs=jobs, summary=summary))


# ── Feature 7: Bulk Token Grant ───────────────────────────────────────────────


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
    """Grant tokens to a list of user IDs."""
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
        target_id=None,
        details={"user_ids": body.user_ids, "amount": body.amount},
    )
    await db.commit()
    return SuccessResponse(data=BulkTokenResult(updated=updated, amount=body.amount))
