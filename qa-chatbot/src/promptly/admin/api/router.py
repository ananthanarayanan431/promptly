from __future__ import annotations

import asyncio
import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

import httpx
import structlog
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import Date as SqlDate
from sqlalchemy import case, cast, func, select, text, update
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
    AnalyticsPoint,
    AnalyticsResponse,
    AnalyticsSeries,
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
from promptly.skill_opt.data.models import SkillOptProject

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


# ── Analytics helpers ─────────────────────────────────────────────────────────


def _fill_days(
    cutoff: datetime, days: int, data_map: dict[str, int | float]
) -> list[AnalyticsPoint]:
    """Return one AnalyticsPoint per day from cutoff+1 to cutoff+days, zero-filling gaps."""
    result = []
    for i in range(1, days + 1):
        d = str((cutoff + timedelta(days=i)).date())
        result.append(AnalyticsPoint(date=d, value=float(data_map.get(d, 0))))
    return result


async def _platform_engagement(db: AsyncSession, days: int) -> AnalyticsResponse:
    now = datetime.now(UTC)
    cutoff = now - timedelta(days=days)
    cutoff_90d = now - timedelta(days=90)

    # ── Statics ───────────────────────────────────────────────────────────────
    total_users: int = (await db.execute(select(func.count()).select_from(User))).scalar_one()

    total_opts: int = (
        await db.execute(
            select(func.count()).select_from(UsageEvent).where(UsageEvent.action == "optimize")
        )
    ).scalar_one()

    total_tokens: int = max(
        0,
        int(
            (
                await db.execute(
                    select(func.coalesce(func.sum(3_000_000 - User.token_balance), 0)).select_from(
                        User
                    )
                )
            ).scalar_one()
        ),
    )

    total_budget = total_users * 3_000_000
    budget_pct = round((total_tokens / max(1, total_budget)) * 100, 1)

    total_credits: int = int(
        (
            await db.execute(
                select(func.coalesce(func.sum(UsageEvent.credits_spent), 0)).select_from(UsageEvent)
            )
        ).scalar_one()
    ) + int(
        (
            await db.execute(
                select(func.coalesce(func.sum(SkillOptProject.credits_charged), 0)).select_from(
                    SkillOptProject
                )
            )
        ).scalar_one()
    )

    # ── DAU (daily, last N days) ───────────────────────────────────────────────
    dau_rows = (
        await db.execute(
            select(
                cast(UsageEvent.created_at, SqlDate).label("day"),
                func.count(UsageEvent.user_id.distinct()).label("cnt"),
            )
            .where(UsageEvent.created_at >= cutoff)
            .group_by(cast(UsageEvent.created_at, SqlDate))
            .order_by(cast(UsageEvent.created_at, SqlDate))
        )
    ).fetchall()
    dau_map = {str(r.day): r.cnt for r in dau_rows}
    dau_data = _fill_days(cutoff, days, dau_map)

    # ── WAU (weekly, last 90 days) ─────────────────────────────────────────────
    wau_rows = (
        await db.execute(
            select(
                func.date_trunc("week", UsageEvent.created_at).label("week"),
                func.count(UsageEvent.user_id.distinct()).label("cnt"),
            )
            .where(UsageEvent.created_at >= cutoff_90d)
            .group_by(func.date_trunc("week", UsageEvent.created_at))
            .order_by(func.date_trunc("week", UsageEvent.created_at))
        )
    ).fetchall()
    wau_data = [AnalyticsPoint(date=str(r.week)[:10], value=float(r.cnt)) for r in wau_rows]

    # ── Optimizations per day ─────────────────────────────────────────────────
    opt_rows = (
        await db.execute(
            select(
                cast(UsageEvent.created_at, SqlDate).label("day"),
                func.count().label("cnt"),
            )
            .where(UsageEvent.action == "optimize", UsageEvent.created_at >= cutoff)
            .group_by(cast(UsageEvent.created_at, SqlDate))
            .order_by(cast(UsageEvent.created_at, SqlDate))
        )
    ).fetchall()
    opt_map = {str(r.day): r.cnt for r in opt_rows}

    # ── Total feature calls per day ───────────────────────────────────────────
    calls_rows = (
        await db.execute(
            select(
                cast(UsageEvent.created_at, SqlDate).label("day"),
                func.count().label("cnt"),
            )
            .where(UsageEvent.created_at >= cutoff)
            .group_by(cast(UsageEvent.created_at, SqlDate))
            .order_by(cast(UsageEvent.created_at, SqlDate))
        )
    ).fetchall()
    calls_map = {str(r.day): r.cnt for r in calls_rows}

    # ── Sessions per day ──────────────────────────────────────────────────────
    sess_rows = (
        await db.execute(
            select(
                cast(ChatSession.created_at, SqlDate).label("day"),
                func.count().label("cnt"),
            )
            .where(ChatSession.created_at >= cutoff)
            .group_by(cast(ChatSession.created_at, SqlDate))
            .order_by(cast(ChatSession.created_at, SqlDate))
        )
    ).fetchall()
    sess_map = {str(r.day): r.cnt for r in sess_rows}

    # ── Signups per day ───────────────────────────────────────────────────────
    signup_rows = (
        await db.execute(
            select(
                cast(User.created_at, SqlDate).label("day"),
                func.count().label("cnt"),
            )
            .where(User.created_at >= cutoff)
            .group_by(cast(User.created_at, SqlDate))
            .order_by(cast(User.created_at, SqlDate))
        )
    ).fetchall()
    signup_map = {str(r.day): r.cnt for r in signup_rows}

    # ── Tokens per day (from messages) ───────────────────────────────────────
    tok_rows = (
        await db.execute(
            select(
                cast(Message.created_at, SqlDate).label("day"),
                func.coalesce(func.sum(Message.token_usage["total_tokens"].as_integer()), 0).label(
                    "tokens"
                ),
            )
            .where(Message.created_at >= cutoff, Message.token_usage.isnot(None))
            .group_by(cast(Message.created_at, SqlDate))
            .order_by(cast(Message.created_at, SqlDate))
        )
    ).fetchall()
    tok_map = {str(r.day): r.tokens for r in tok_rows}

    # ── Credits per day ───────────────────────────────────────────────────────
    cred_rows = (
        await db.execute(
            select(
                cast(UsageEvent.created_at, SqlDate).label("day"),
                func.coalesce(func.sum(UsageEvent.credits_spent), 0).label("credits"),
            )
            .where(UsageEvent.created_at >= cutoff)
            .group_by(cast(UsageEvent.created_at, SqlDate))
            .order_by(cast(UsageEvent.created_at, SqlDate))
        )
    ).fetchall()
    cred_map: dict[str, int | float] = {str(r.day): r.credits for r in cred_rows}
    so_cred_rows = (
        await db.execute(
            select(
                cast(SkillOptProject.created_at, SqlDate).label("day"),
                func.coalesce(func.sum(SkillOptProject.credits_charged), 0).label("credits"),
            )
            .where(SkillOptProject.created_at >= cutoff, SkillOptProject.status == "completed")
            .group_by(cast(SkillOptProject.created_at, SqlDate))
        )
    ).fetchall()
    for r in so_cred_rows:
        key = str(r.day)
        cred_map[key] = float(cred_map.get(key, 0)) + float(r.credits)

    # ── Feature adoption (stacked) — 4 series ────────────────────────────────
    adoption_actions: dict[str, str | list[str] | None] = {
        "optimizer": "optimize",
        "domain": ["domain_pdo", "domain_gepa"],
        "bridge": "bridge",
        "skillopt": None,  # from skill_opt_projects
    }
    feat_series: list[AnalyticsSeries] = []
    feat_colors = {
        "optimizer": "var(--primary)",
        "domain": "#06b6d4",
        "bridge": "#f59e0b",
        "skillopt": "#f43f5e",
    }
    for name, action in adoption_actions.items():
        if action is None:
            # SkillOpt — distinct users from skill_opt_projects
            fa_rows = (
                await db.execute(
                    select(
                        cast(SkillOptProject.created_at, SqlDate).label("day"),
                        func.count(SkillOptProject.user_id.distinct()).label("cnt"),
                    )
                    .where(SkillOptProject.created_at >= cutoff)
                    .group_by(cast(SkillOptProject.created_at, SqlDate))
                    .order_by(cast(SkillOptProject.created_at, SqlDate))
                )
            ).fetchall()
        elif isinstance(action, list):
            fa_rows = (
                await db.execute(
                    select(
                        cast(UsageEvent.created_at, SqlDate).label("day"),
                        func.count(UsageEvent.user_id.distinct()).label("cnt"),
                    )
                    .where(UsageEvent.action.in_(action), UsageEvent.created_at >= cutoff)
                    .group_by(cast(UsageEvent.created_at, SqlDate))
                    .order_by(cast(UsageEvent.created_at, SqlDate))
                )
            ).fetchall()
        else:
            fa_rows = (
                await db.execute(
                    select(
                        cast(UsageEvent.created_at, SqlDate).label("day"),
                        func.count(UsageEvent.user_id.distinct()).label("cnt"),
                    )
                    .where(UsageEvent.action == action, UsageEvent.created_at >= cutoff)
                    .group_by(cast(UsageEvent.created_at, SqlDate))
                    .order_by(cast(UsageEvent.created_at, SqlDate))
                )
            ).fetchall()
        fa_map = {str(r.day): r.cnt for r in fa_rows}
        fa_data = _fill_days(cutoff, days, fa_map)
        feat_series.append(
            AnalyticsSeries(
                key=f"adoption_{name}",
                label=name.replace("_", " ").title(),
                total=float(sum(p.value for p in fa_data)),
                time_range=f"Last {days} Days",
                data=fa_data,
                chart_type="bar",
                color=feat_colors[name],
            )
        )

    return AnalyticsResponse(
        view="platform_engagement",
        generated_at=datetime.now(UTC).isoformat(),
        statics={
            "total_users": total_users,
            "total_optimizations": total_opts,
            "total_tokens": total_tokens,
            "total_credits": total_credits,
            "budget_used_pct": budget_pct,
        },
        series=[
            AnalyticsSeries(
                key="dau",
                label="Daily Active Users",
                total=float(max((p.value for p in dau_data), default=0)),
                time_range=f"Last {days} Days",
                data=dau_data,
                chart_type="line",
            ),
            AnalyticsSeries(
                key="wau",
                label="Weekly Active Users",
                total=float(max((p.value for p in wau_data), default=0)),
                time_range="Last 90 Days",
                data=wau_data,
                chart_type="line",
            ),
            AnalyticsSeries(
                key="optimizations_per_day",
                label="Optimizations per Day",
                total=float(total_opts),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, opt_map),
                chart_type="line",
            ),
            AnalyticsSeries(
                key="feature_calls_per_day",
                label="Total Feature Calls per Day",
                total=float(sum(calls_map.values())),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, calls_map),
                chart_type="bar",
            ),
            AnalyticsSeries(
                key="sessions_per_day",
                label="Sessions Created per Day",
                total=float(sum(sess_map.values())),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, sess_map),
                chart_type="bar",
            ),
            AnalyticsSeries(
                key="tokens_per_day",
                label="Tokens Consumed per Day",
                total=float(sum(tok_map.values())),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, tok_map),
                chart_type="line",
            ),
            AnalyticsSeries(
                key="signups_per_day",
                label="New Signups per Day",
                total=float(sum(signup_map.values())),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, signup_map),
                chart_type="bar",
            ),
            AnalyticsSeries(
                key="credits_per_day",
                label="Credits Consumed per Day",
                total=float(total_credits),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, cred_map),
                chart_type="line",
            ),
            *feat_series,
        ],
    )


async def _platform_logins(db: AsyncSession, days: int) -> AnalyticsResponse:
    # days is intentionally unused — login activity uses fixed time horizons
    now = datetime.now(UTC)
    cutoff_7d = now - timedelta(days=7)
    cutoff_7w = now - timedelta(weeks=7)
    cutoff_30d = now - timedelta(days=30)
    cutoff_90d = now - timedelta(days=90)
    cutoff_365d = now - timedelta(days=365)

    dau_7d: int = (
        await db.execute(
            select(func.count(UsageEvent.user_id.distinct())).where(
                UsageEvent.created_at >= cutoff_7d
            )
        )
    ).scalar_one()

    wau_7d: int = (
        await db.execute(
            select(func.count(UsageEvent.user_id.distinct())).where(
                UsageEvent.created_at >= cutoff_7w
            )
        )
    ).scalar_one()

    mau_30d: int = (
        await db.execute(
            select(func.count(UsageEvent.user_id.distinct())).where(
                UsageEvent.created_at >= cutoff_30d
            )
        )
    ).scalar_one()

    # WAU trend (90d, weekly)
    wau_rows = (
        await db.execute(
            select(
                func.date_trunc("week", UsageEvent.created_at).label("week"),
                func.count(UsageEvent.user_id.distinct()).label("cnt"),
            )
            .where(UsageEvent.created_at >= cutoff_90d)
            .group_by(func.date_trunc("week", UsageEvent.created_at))
            .order_by(func.date_trunc("week", UsageEvent.created_at))
        )
    ).fetchall()
    wau_trend = [AnalyticsPoint(date=str(r.week)[:10], value=float(r.cnt)) for r in wau_rows]

    # MAU trend (90d, monthly)
    mau_rows = (
        await db.execute(
            select(
                func.date_trunc("month", UsageEvent.created_at).label("month"),
                func.count(UsageEvent.user_id.distinct()).label("cnt"),
            )
            .where(UsageEvent.created_at >= cutoff_90d)
            .group_by(func.date_trunc("month", UsageEvent.created_at))
            .order_by(func.date_trunc("month", UsageEvent.created_at))
        )
    ).fetchall()
    mau_trend = [AnalyticsPoint(date=str(r.month)[:7], value=float(r.cnt)) for r in mau_rows]

    # QAU trend (365d, quarterly)
    qau_rows = (
        await db.execute(
            select(
                func.date_trunc("quarter", UsageEvent.created_at).label("quarter"),
                func.count(UsageEvent.user_id.distinct()).label("cnt"),
            )
            .where(UsageEvent.created_at >= cutoff_365d)
            .group_by(func.date_trunc("quarter", UsageEvent.created_at))
            .order_by(func.date_trunc("quarter", UsageEvent.created_at))
        )
    ).fetchall()
    qau_trend = [AnalyticsPoint(date=str(r.quarter)[:7], value=float(r.cnt)) for r in qau_rows]

    # D7 retention
    eligible_7d: int = (
        await db.execute(
            select(func.count()).select_from(User).where(User.created_at <= now - timedelta(days=7))
        )
    ).scalar_one()
    returned_7d: int = (
        await db.execute(
            select(func.count(User.id.distinct()))
            .select_from(User)
            .join(UsageEvent, UsageEvent.user_id == User.id)
            .where(
                User.created_at <= now - timedelta(days=7),
                UsageEvent.created_at >= User.created_at,
                UsageEvent.created_at <= User.created_at + timedelta(days=7),
            )
        )
    ).scalar_one()
    d7_retention = round((returned_7d / max(1, eligible_7d)) * 100, 1)

    # D30 retention
    eligible_30d: int = (
        await db.execute(
            select(func.count())
            .select_from(User)
            .where(User.created_at <= now - timedelta(days=30))
        )
    ).scalar_one()
    returned_30d: int = (
        await db.execute(
            select(func.count(User.id.distinct()))
            .select_from(User)
            .join(UsageEvent, UsageEvent.user_id == User.id)
            .where(
                User.created_at <= now - timedelta(days=30),
                UsageEvent.created_at >= User.created_at,
                UsageEvent.created_at <= User.created_at + timedelta(days=30),
            )
        )
    ).scalar_one()
    d30_retention = round((returned_30d / max(1, eligible_30d)) * 100, 1)

    # Avg sessions per active user (last 30d)
    total_sessions_30d: int = (
        await db.execute(
            select(func.count())
            .select_from(ChatSession)
            .where(ChatSession.created_at >= cutoff_30d)
        )
    ).scalar_one()
    avg_sessions = round(total_sessions_30d / max(1, mau_30d), 1)

    return AnalyticsResponse(
        view="platform_logins",
        generated_at=datetime.now(UTC).isoformat(),
        statics={
            "dau_7d": dau_7d,
            "wau_7d": wau_7d,
            "mau_30d": mau_30d,
            "d7_retention": d7_retention,
            "d30_retention": d30_retention,
            "avg_sessions_per_user": avg_sessions,
        },
        series=[
            AnalyticsSeries(
                key="wau_trend",
                label="WAU Trend",
                total=float(wau_7d),
                time_range="Last 90 Days",
                data=wau_trend,
                chart_type="line",
            ),
            AnalyticsSeries(
                key="mau_trend",
                label="MAU Trend",
                total=float(mau_30d),
                time_range="Last 90 Days",
                data=mau_trend,
                chart_type="line",
            ),
            AnalyticsSeries(
                key="qau_trend",
                label="QAU Trend",
                total=float(max((p.value for p in qau_trend), default=0)),
                time_range="Last 365 Days",
                data=qau_trend,
                chart_type="line",
            ),
        ],
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
    admin: Annotated[UserContext, Depends(require_admin)],
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
    log_audit(
        db,
        admin_id=admin.user_id,
        action="patch_user",
        target_id=user_id,
        details={
            k: v
            for k, v in {
                "is_active": body.is_active,
                "is_admin": body.is_admin,
                "credits_delta": body.credits_delta,
            }.items()
            if v is not None
        },
    )
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

        def _inspect_workers() -> dict[str, list[Any]] | None:
            raw = celery_app.control.inspect(timeout=2.0).active()
            if raw is None:
                return None
            return {k: list(v) for k, v in raw.items()}

        active: dict[str, list[Any]] | None = await asyncio.to_thread(_inspect_workers)
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
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[UserContext, Depends(require_admin)],
) -> SuccessResponse[RateLimitResetResult]:
    """Delete a single rate-limit key from Redis."""
    redis = await get_redis_client()
    key = f"rl:user:{user_id}:{route}"
    deleted_count: int = await redis.delete(key)
    log_audit(
        db,
        admin_id=admin.user_id,
        action="reset_rate_limit",
        target_id=None,
        details={"user_id": user_id, "route": route, "key": key, "deleted": deleted_count > 0},
    )
    await db.commit()
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


# ── Analytics endpoint ────────────────────────────────────────────────────────

_ANALYTICS_VIEWS = {
    "platform_engagement",
    "platform_logins",
    "agent_optimizer",
    "agent_skillopt",
    "agent_domain",
    "agent_bridge",
}


async def _agent_optimizer(db: AsyncSession, days: int) -> AnalyticsResponse:
    now = datetime.now(UTC)
    cutoff = now - timedelta(days=days)

    # Runs per day
    runs_rows = (
        await db.execute(
            select(cast(UsageEvent.created_at, SqlDate).label("day"), func.count().label("cnt"))
            .where(UsageEvent.action == "optimize", UsageEvent.created_at >= cutoff)
            .group_by(cast(UsageEvent.created_at, SqlDate))
            .order_by(cast(UsageEvent.created_at, SqlDate))
        )
    ).fetchall()
    runs_map = {str(r.day): r.cnt for r in runs_rows}
    total_runs = sum(runs_map.values())

    # Tokens per day
    tok_rows = (
        await db.execute(
            select(
                cast(Message.created_at, SqlDate).label("day"),
                func.coalesce(func.sum(Message.token_usage["total_tokens"].as_integer()), 0).label(
                    "t"
                ),
            )
            .where(Message.created_at >= cutoff, Message.token_usage.isnot(None))
            .group_by(cast(Message.created_at, SqlDate))
            .order_by(cast(Message.created_at, SqlDate))
        )
    ).fetchall()
    tok_map: dict[str, int | float] = {str(r.day): r.t for r in tok_rows}
    total_tokens = sum(tok_map.values())

    # Unique users per day
    uq_rows = (
        await db.execute(
            select(
                cast(UsageEvent.created_at, SqlDate).label("day"),
                func.count(UsageEvent.user_id.distinct()).label("cnt"),
            )
            .where(UsageEvent.action == "optimize", UsageEvent.created_at >= cutoff)
            .group_by(cast(UsageEvent.created_at, SqlDate))
            .order_by(cast(UsageEvent.created_at, SqlDate))
        )
    ).fetchall()
    uq_map = {str(r.day): r.cnt for r in uq_rows}

    # Completed vs failed sessions per day (stacked)
    status_rows = (
        await db.execute(
            select(
                cast(ChatSession.created_at, SqlDate).label("day"),
                func.count().label("cnt"),
            )
            .where(ChatSession.created_at >= cutoff)
            .group_by(cast(ChatSession.created_at, SqlDate))
            .order_by(cast(ChatSession.created_at, SqlDate))
        )
    ).fetchall()
    sessions_map = {str(r.day): r.cnt for r in status_rows}

    # Credits per day (optimize = 10 credits each)
    cred_data = [
        AnalyticsPoint(date=p.date, value=p.value * 10) for p in _fill_days(cutoff, days, runs_map)
    ]

    # Council model distribution (all time, top 10)
    model_rows = (
        await db.execute(
            text("""
        SELECT vote ->> 'model' AS model, COUNT(*) AS cnt
        FROM messages, jsonb_array_elements(council_votes::jsonb) AS vote
        WHERE council_votes IS NOT NULL
        GROUP BY model
        ORDER BY cnt DESC
        LIMIT 10
    """)
        )
    ).fetchall()
    model_total = sum(r.cnt for r in model_rows)
    model_data = [
        AnalyticsPoint(date=str(r.model or "unknown"), value=float(r.cnt)) for r in model_rows
    ]

    # Static: avg tokens per optimization
    avg_tokens = round(total_tokens / max(1, total_runs), 0)
    total_dau_sum = sum(uq_map.values())
    calls_per_user = round(total_runs / max(1, total_dau_sum / max(1, days)), 1)

    return AnalyticsResponse(
        view="agent_optimizer",
        generated_at=datetime.now(UTC).isoformat(),
        statics={
            "avg_tokens_per_opt": avg_tokens,
            "calls_per_active_user": calls_per_user,
            "total_runs": total_runs,
            "total_tokens": total_tokens,
        },
        series=[
            AnalyticsSeries(
                key="optimizer_runs",
                label="Runs per Day",
                total=float(total_runs),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, runs_map),
                chart_type="line",
            ),
            AnalyticsSeries(
                key="optimizer_tokens",
                label="Tokens per Day",
                total=float(total_tokens),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, tok_map),
                chart_type="line",
            ),
            AnalyticsSeries(
                key="optimizer_unique_users",
                label="Unique Users per Day",
                total=float(sum(uq_map.values())),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, uq_map),
                chart_type="line",
            ),
            AnalyticsSeries(
                key="optimizer_sessions",
                label="Sessions Created per Day",
                total=float(sum(sessions_map.values())),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, sessions_map),
                chart_type="bar",
            ),
            AnalyticsSeries(
                key="optimizer_credits",
                label="Credits Charged per Day",
                total=float(total_runs * 10),
                time_range=f"Last {days} Days",
                data=cred_data,
                chart_type="bar",
            ),
            AnalyticsSeries(
                key="council_models",
                label="Council Model Distribution",
                total=float(model_total),
                time_range="All Time",
                data=model_data,
                chart_type="bar",
            ),
        ],
    )


async def _agent_skillopt(db: AsyncSession, days: int) -> AnalyticsResponse:
    now = datetime.now(UTC)
    cutoff = now - timedelta(days=days)

    # Runs per day (completed only)
    runs_rows = (
        await db.execute(
            select(
                cast(SkillOptProject.created_at, SqlDate).label("day"), func.count().label("cnt")
            )
            .where(SkillOptProject.status == "completed", SkillOptProject.created_at >= cutoff)
            .group_by(cast(SkillOptProject.created_at, SqlDate))
            .order_by(cast(SkillOptProject.created_at, SqlDate))
        )
    ).fetchall()
    runs_map = {str(r.day): r.cnt for r in runs_rows}

    # Avg score improvement per day
    score_rows = (
        await db.execute(
            select(
                cast(SkillOptProject.created_at, SqlDate).label("day"),
                func.avg(SkillOptProject.score_after - SkillOptProject.score_before).label("imp"),
            )
            .where(
                SkillOptProject.status == "completed",
                SkillOptProject.created_at >= cutoff,
                SkillOptProject.score_before.isnot(None),
                SkillOptProject.score_after.isnot(None),
            )
            .group_by(cast(SkillOptProject.created_at, SqlDate))
            .order_by(cast(SkillOptProject.created_at, SqlDate))
        )
    ).fetchall()
    score_map: dict[str, int | float] = {
        str(r.day): round(float(r.imp or 0), 3) for r in score_rows
    }

    # Avg score_test per day
    st_rows = (
        await db.execute(
            select(
                cast(SkillOptProject.created_at, SqlDate).label("day"),
                func.avg(SkillOptProject.score_test).label("st"),
            )
            .where(
                SkillOptProject.status == "completed",
                SkillOptProject.created_at >= cutoff,
                SkillOptProject.score_test.isnot(None),
            )
            .group_by(cast(SkillOptProject.created_at, SqlDate))
            .order_by(cast(SkillOptProject.created_at, SqlDate))
        )
    ).fetchall()
    st_map: dict[str, int | float] = {str(r.day): round(float(r.st or 0), 3) for r in st_rows}

    # Edits accepted per day
    edits_rows = (
        await db.execute(
            select(
                cast(SkillOptProject.created_at, SqlDate).label("day"),
                func.coalesce(func.sum(SkillOptProject.edits_accepted), 0).label("ea"),
            )
            .where(SkillOptProject.status == "completed", SkillOptProject.created_at >= cutoff)
            .group_by(cast(SkillOptProject.created_at, SqlDate))
            .order_by(cast(SkillOptProject.created_at, SqlDate))
        )
    ).fetchall()
    edits_map: dict[str, int | float] = {str(r.day): r.ea for r in edits_rows}

    # Acceptance ratio per day
    ratio_rows = (
        await db.execute(
            select(
                cast(SkillOptProject.created_at, SqlDate).label("day"),
                func.coalesce(func.sum(SkillOptProject.edits_accepted), 0).label("ea"),
                func.coalesce(
                    func.sum(SkillOptProject.edits_accepted + SkillOptProject.edits_rejected), 0
                ).label("total"),
            )
            .where(SkillOptProject.status == "completed", SkillOptProject.created_at >= cutoff)
            .group_by(cast(SkillOptProject.created_at, SqlDate))
            .order_by(cast(SkillOptProject.created_at, SqlDate))
        )
    ).fetchall()
    ratio_map: dict[str, int | float] = {
        str(r.day): round(r.ea / max(1, r.total), 2) for r in ratio_rows
    }

    # Tier breakdown (stacked)
    tier_expr = case(
        (SkillOptProject.credits_charged == 5, "low"),
        (SkillOptProject.credits_charged == 16, "high"),
        else_="medium",
    )
    tier_rows = (
        await db.execute(
            select(
                cast(SkillOptProject.created_at, SqlDate).label("day"),
                tier_expr.label("tier"),
                func.count().label("cnt"),
            )
            .where(SkillOptProject.status == "completed", SkillOptProject.created_at >= cutoff)
            .group_by(cast(SkillOptProject.created_at, SqlDate), tier_expr)
            .order_by(cast(SkillOptProject.created_at, SqlDate))
        )
    ).fetchall()
    tier_maps: dict[str, dict[str, int | float]] = {"low": {}, "medium": {}, "high": {}}
    for r in tier_rows:
        tier_maps[r.tier][str(r.day)] = r.cnt

    # Unique users per day
    uq_rows = (
        await db.execute(
            select(
                cast(SkillOptProject.created_at, SqlDate).label("day"),
                func.count(SkillOptProject.user_id.distinct()).label("cnt"),
            )
            .where(SkillOptProject.status == "completed", SkillOptProject.created_at >= cutoff)
            .group_by(cast(SkillOptProject.created_at, SqlDate))
            .order_by(cast(SkillOptProject.created_at, SqlDate))
        )
    ).fetchall()
    uq_map = {str(r.day): r.cnt for r in uq_rows}

    # Statics
    avg_epochs = float(
        (
            await db.execute(
                select(func.coalesce(func.avg(SkillOptProject.epochs_run), 0)).where(
                    SkillOptProject.status == "completed"
                )
            )
        ).scalar_one()
        or 0
    )
    total_examples = int(
        (
            await db.execute(
                select(func.coalesce(func.sum(SkillOptProject.example_count), 0)).where(
                    SkillOptProject.status == "completed"
                )
            )
        ).scalar_one()
        or 0
    )
    overall_improvement = float(
        (
            await db.execute(
                select(
                    func.coalesce(
                        func.avg(SkillOptProject.score_after - SkillOptProject.score_before), 0
                    )
                ).where(
                    SkillOptProject.status == "completed",
                    SkillOptProject.score_before.isnot(None),
                    SkillOptProject.score_after.isnot(None),
                )
            )
        ).scalar_one()
        or 0
    )

    tier_colors = {"low": "#06b6d4", "medium": "var(--primary)", "high": "#f43f5e"}

    return AnalyticsResponse(
        view="agent_skillopt",
        generated_at=datetime.now(UTC).isoformat(),
        statics={
            "avg_epochs": round(avg_epochs, 1),
            "total_examples": total_examples,
            "overall_avg_improvement": round(overall_improvement, 3),
        },
        series=[
            AnalyticsSeries(
                key="so_runs",
                label="Runs per Day",
                total=float(sum(runs_map.values())),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, runs_map),
                chart_type="line",
            ),
            AnalyticsSeries(
                key="so_improvement",
                label="Avg Score Improvement per Day",
                total=round(overall_improvement, 3),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, score_map),
                chart_type="line",
            ),
            AnalyticsSeries(
                key="so_score_test",
                label="Avg Test Score per Day",
                total=float(sum(st_map.values()) / max(1, len(st_map))),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, st_map),
                chart_type="line",
            ),
            AnalyticsSeries(
                key="so_edits_accepted",
                label="Edits Accepted per Day",
                total=float(sum(edits_map.values())),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, edits_map),
                chart_type="bar",
            ),
            AnalyticsSeries(
                key="so_acceptance_ratio",
                label="Edit Acceptance Ratio",
                total=round(sum(ratio_map.values()) / max(1, len(ratio_map)), 2),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, ratio_map),
                chart_type="line",
            ),
            AnalyticsSeries(
                key="so_unique_users",
                label="Unique Users per Day",
                total=float(sum(uq_map.values())),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, uq_map),
                chart_type="line",
            ),
            *[
                AnalyticsSeries(
                    key=f"so_tier_{tier}",
                    label=f"{tier.title()} Tier",
                    total=float(sum(tier_maps[tier].values())),
                    time_range=f"Last {days} Days",
                    data=_fill_days(cutoff, days, tier_maps[tier]),
                    chart_type="bar",
                    color=tier_colors[tier],
                )
                for tier in ("low", "medium", "high")
            ],
        ],
    )


async def _agent_domain(db: AsyncSession, days: int) -> AnalyticsResponse:
    now = datetime.now(UTC)
    cutoff = now - timedelta(days=days)

    domain_actions = ["domain_pdo", "domain_gepa"]
    augment_action = "domain_gepa_augment"

    # Runs per day (PDO + GEPA combined)
    runs_rows = (
        await db.execute(
            select(cast(UsageEvent.created_at, SqlDate).label("day"), func.count().label("cnt"))
            .where(UsageEvent.action.in_(domain_actions), UsageEvent.created_at >= cutoff)
            .group_by(cast(UsageEvent.created_at, SqlDate))
            .order_by(cast(UsageEvent.created_at, SqlDate))
        )
    ).fetchall()
    runs_map = {str(r.day): r.cnt for r in runs_rows}

    # Augment per day
    aug_rows = (
        await db.execute(
            select(cast(UsageEvent.created_at, SqlDate).label("day"), func.count().label("cnt"))
            .where(UsageEvent.action == augment_action, UsageEvent.created_at >= cutoff)
            .group_by(cast(UsageEvent.created_at, SqlDate))
            .order_by(cast(UsageEvent.created_at, SqlDate))
        )
    ).fetchall()
    aug_map = {str(r.day): r.cnt for r in aug_rows}

    # PDO vs GEPA split (two series)
    pdo_rows = (
        await db.execute(
            select(cast(UsageEvent.created_at, SqlDate).label("day"), func.count().label("cnt"))
            .where(UsageEvent.action == "domain_pdo", UsageEvent.created_at >= cutoff)
            .group_by(cast(UsageEvent.created_at, SqlDate))
            .order_by(cast(UsageEvent.created_at, SqlDate))
        )
    ).fetchall()
    pdo_map = {str(r.day): r.cnt for r in pdo_rows}

    gepa_rows = (
        await db.execute(
            select(cast(UsageEvent.created_at, SqlDate).label("day"), func.count().label("cnt"))
            .where(UsageEvent.action == "domain_gepa", UsageEvent.created_at >= cutoff)
            .group_by(cast(UsageEvent.created_at, SqlDate))
            .order_by(cast(UsageEvent.created_at, SqlDate))
        )
    ).fetchall()
    gepa_map = {str(r.day): r.cnt for r in gepa_rows}

    # Unique users per day
    uq_rows = (
        await db.execute(
            select(
                cast(UsageEvent.created_at, SqlDate).label("day"),
                func.count(UsageEvent.user_id.distinct()).label("cnt"),
            )
            .where(
                UsageEvent.action.in_(domain_actions + [augment_action]),
                UsageEvent.created_at >= cutoff,
            )
            .group_by(cast(UsageEvent.created_at, SqlDate))
            .order_by(cast(UsageEvent.created_at, SqlDate))
        )
    ).fetchall()
    uq_map = {str(r.day): r.cnt for r in uq_rows}

    # Tokens per day
    tok_rows = (
        await db.execute(
            select(
                cast(Message.created_at, SqlDate).label("day"),
                func.coalesce(func.sum(Message.token_usage["total_tokens"].as_integer()), 0).label(
                    "t"
                ),
            )
            .where(Message.created_at >= cutoff, Message.token_usage.isnot(None))
            .group_by(cast(Message.created_at, SqlDate))
            .order_by(cast(Message.created_at, SqlDate))
        )
    ).fetchall()
    tok_map: dict[str, int | float] = {str(r.day): r.t for r in tok_rows}

    total_runs = sum(runs_map.values())

    return AnalyticsResponse(
        view="agent_domain",
        generated_at=datetime.now(UTC).isoformat(),
        statics={"total_runs": total_runs},
        series=[
            AnalyticsSeries(
                key="domain_runs",
                label="Domain Runs per Day",
                total=float(total_runs),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, runs_map),
                chart_type="line",
            ),
            AnalyticsSeries(
                key="domain_augment",
                label="Augmentation Runs per Day",
                total=float(sum(aug_map.values())),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, aug_map),
                chart_type="bar",
            ),
            AnalyticsSeries(
                key="domain_pdo",
                label="PDO Runs",
                total=float(sum(pdo_map.values())),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, pdo_map),
                chart_type="bar",
                color="#06b6d4",
            ),
            AnalyticsSeries(
                key="domain_gepa",
                label="GEPA Runs",
                total=float(sum(gepa_map.values())),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, gepa_map),
                chart_type="bar",
                color="#8b5cf6",
            ),
            AnalyticsSeries(
                key="domain_tokens",
                label="Tokens per Day",
                total=float(sum(tok_map.values())),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, tok_map),
                chart_type="line",
            ),
            AnalyticsSeries(
                key="domain_unique_users",
                label="Unique Users per Day",
                total=float(sum(uq_map.values())),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, uq_map),
                chart_type="line",
            ),
        ],
    )


async def _agent_bridge(db: AsyncSession, days: int) -> AnalyticsResponse:
    now = datetime.now(UTC)
    cutoff = now - timedelta(days=days)

    runs_rows = (
        await db.execute(
            select(cast(UsageEvent.created_at, SqlDate).label("day"), func.count().label("cnt"))
            .where(UsageEvent.action == "bridge", UsageEvent.created_at >= cutoff)
            .group_by(cast(UsageEvent.created_at, SqlDate))
            .order_by(cast(UsageEvent.created_at, SqlDate))
        )
    ).fetchall()
    runs_map = {str(r.day): r.cnt for r in runs_rows}

    uq_rows = (
        await db.execute(
            select(
                cast(UsageEvent.created_at, SqlDate).label("day"),
                func.count(UsageEvent.user_id.distinct()).label("cnt"),
            )
            .where(UsageEvent.action == "bridge", UsageEvent.created_at >= cutoff)
            .group_by(cast(UsageEvent.created_at, SqlDate))
            .order_by(cast(UsageEvent.created_at, SqlDate))
        )
    ).fetchall()
    uq_map = {str(r.day): r.cnt for r in uq_rows}

    tok_rows = (
        await db.execute(
            select(
                cast(Message.created_at, SqlDate).label("day"),
                func.coalesce(func.sum(Message.token_usage["total_tokens"].as_integer()), 0).label(
                    "t"
                ),
            )
            .where(Message.created_at >= cutoff, Message.token_usage.isnot(None))
            .group_by(cast(Message.created_at, SqlDate))
            .order_by(cast(Message.created_at, SqlDate))
        )
    ).fetchall()
    tok_map: dict[str, int | float] = {str(r.day): r.t for r in tok_rows}

    total_bridge = int(
        (
            await db.execute(
                select(func.count()).select_from(UsageEvent).where(UsageEvent.action == "bridge")
            )
        ).scalar_one()
    )

    return AnalyticsResponse(
        view="agent_bridge",
        generated_at=datetime.now(UTC).isoformat(),
        statics={"total_bridges": total_bridge},
        series=[
            AnalyticsSeries(
                key="bridge_runs",
                label="Bridges per Day",
                total=float(sum(runs_map.values())),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, runs_map),
                chart_type="line",
            ),
            AnalyticsSeries(
                key="bridge_tokens",
                label="Tokens per Day",
                total=float(sum(tok_map.values())),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, tok_map),
                chart_type="line",
            ),
            AnalyticsSeries(
                key="bridge_unique_users",
                label="Unique Users per Day",
                total=float(sum(uq_map.values())),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, uq_map),
                chart_type="line",
            ),
        ],
    )


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
        "platform_engagement": _platform_engagement,
        "platform_logins": _platform_logins,
        "agent_optimizer": _agent_optimizer,
        "agent_skillopt": _agent_skillopt,
        "agent_domain": _agent_domain,
        "agent_bridge": _agent_bridge,
    }
    result = await handlers[view](db, days)
    return SuccessResponse(data=result)
