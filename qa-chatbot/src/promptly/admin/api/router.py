from __future__ import annotations

import asyncio
import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

import httpx
import structlog
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel
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
from promptly.models.api_request_log import ApiRequestLog
from promptly.models.message import Message
from promptly.models.session import ChatSession
from promptly.models.usage_event import UsageEvent
from promptly.models.user import User
from promptly.prompt_bridge.data.models import TransferJob, TransferJobStatus
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


# ── Live model pricing cache (10-minute TTL) ──────────────────────────────────
# Maps OpenRouter model slug → blended $/token (70% input + 30% output weight).

_or_live_pricing: dict[str, float] = {}
_or_live_pricing_ts: float = 0.0
_OR_PRICING_TTL = 600.0  # seconds


async def _fetch_or_model_pricing() -> dict[str, float]:
    """Return {model_slug: blended_cost_per_token} fetched from OpenRouter /models.

    Cached in-process for 10 minutes.  Falls back to the hardcoded table when
    the API is unavailable so callers always get a usable value.
    """
    global _or_live_pricing, _or_live_pricing_ts  # noqa: PLW0603

    now = time.monotonic()
    if _or_live_pricing and now - _or_live_pricing_ts < _OR_PRICING_TTL:
        return _or_live_pricing

    try:
        llm = get_llm_settings()
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                "https://openrouter.ai/api/v1/models",
                headers={"Authorization": f"Bearer {llm.OPENROUTER_API_KEY.get_secret_value()}"},
            )
        resp.raise_for_status()
        raw_models: list[dict[str, Any]] = resp.json().get("data", [])
    except Exception:
        return _or_live_pricing  # serve stale cache on error

    result: dict[str, float] = {}
    for m in raw_models:
        if not isinstance(m, dict):
            continue
        model_id = str(m.get("id") or "")
        if not model_id:
            continue
        raw_p = m.get("pricing")
        if not isinstance(raw_p, dict):
            continue
        try:
            inp = float(str(raw_p.get("prompt") or 0))
            out = float(str(raw_p.get("completion") or 0))
            result[model_id] = inp * 0.7 + out * 0.3
        except (ValueError, TypeError):
            continue

    if result:  # only overwrite cache when we got a valid response
        _or_live_pricing = result
        _or_live_pricing_ts = now

    return result


def _live_cost_per_token(model: str, pricing: dict[str, float]) -> float:
    """Look up $/token from the live OpenRouter pricing dict.

    Falls back to the hardcoded ``_or_cost_per_token`` table if the model is
    not present in the API response (e.g. very new or private models).
    """
    if model in pricing:
        return pricing[model]
    return _or_cost_per_token(model)


# ── Sentry error stats cache (5-minute TTL, keyed by days) ───────────────────
_sentry_stats_cache: dict[int, dict[str, Any]] = {}
_sentry_stats_cache_ts: dict[int, float] = {}
_SENTRY_STATS_TTL = 300.0  # seconds


async def _fetch_sentry_stats(days: int) -> dict[str, Any]:  # noqa: PLR0912, PLR0915
    """Return Sentry error stats for the last `days` days, cached for 5 minutes.

    Returns an empty dict when Sentry API credentials are not configured.
    Fires 4 concurrent Sentry API calls: stats, issues, stats_v2 outcomes, sessions.
    """
    global _sentry_stats_cache, _sentry_stats_cache_ts  # noqa: PLW0603

    now = time.monotonic()
    cached_at = _sentry_stats_cache_ts.get(days, 0.0)
    if days in _sentry_stats_cache and now - cached_at < _SENTRY_STATS_TTL:
        return _sentry_stats_cache[days]

    app = get_app_settings()
    if not (app.SENTRY_AUTH_TOKEN and app.SENTRY_ORG_SLUG and app.SENTRY_PROJECT_SLUG):
        return {}

    token = app.SENTRY_AUTH_TOKEN.get_secret_value()
    org = app.SENTRY_ORG_SLUG
    project = app.SENTRY_PROJECT_SLUG
    headers = {"Authorization": f"Bearer {token}"}
    stats_period = f"{days}d"
    # Issues API only accepts '' | '24h' | '14d'
    issues_period = "14d"

    try:
        since = int((datetime.now(UTC) - timedelta(days=days)).timestamp())
        until = int(datetime.now(UTC).timestamp())

        async with httpx.AsyncClient(timeout=15.0) as client:
            (
                stats_resp,
                issues_resp,
                outcomes_resp,
                sessions_resp,
                releases_resp,
            ) = await asyncio.gather(
                client.get(
                    f"https://sentry.io/api/0/projects/{org}/{project}/stats/",
                    params={"stat": "received", "resolution": "1d", "since": since, "until": until},
                    headers=headers,
                ),
                client.get(
                    f"https://sentry.io/api/0/projects/{org}/{project}/issues/",
                    params={
                        "query": "is:unresolved",
                        "limit": "100",
                        "sort": "freq",
                        "statsPeriod": issues_period,
                    },
                    headers=headers,
                ),
                client.get(
                    f"https://sentry.io/api/0/organizations/{org}/stats_v2/",
                    params={
                        "project": project,
                        "field": "sum(times_seen)",
                        "groupBy": "outcome",
                        "interval": "1d",
                        "statsPeriod": stats_period,
                        "category": "error",
                    },
                    headers=headers,
                ),
                client.get(
                    f"https://sentry.io/api/0/organizations/{org}/sessions/",
                    params={
                        "project": project,
                        "field": "sum(session)",
                        "groupBy": "session.status",
                        "interval": "1d",
                        "statsPeriod": stats_period,
                    },
                    headers=headers,
                ),
                client.get(
                    f"https://sentry.io/api/0/projects/{org}/{project}/releases/",
                    params={"limit": "20"},
                    headers=headers,
                ),
            )

        result: dict[str, Any] = {}

        # ── Error events per day (legacy /stats/) ─────────────────────────────
        if stats_resp.status_code == 200:
            raw_stats = stats_resp.json()
            if isinstance(raw_stats, list):
                daily: list[dict[str, Any]] = []
                for row in raw_stats:
                    if isinstance(row, list | tuple) and len(row) >= 2:  # noqa: PLR2004
                        daily.append({"ts": int(row[0]), "count": int(row[1])})
                result["error_events_daily"] = daily
                result["total_errors"] = sum(r["count"] for r in daily)

        # ── Unresolved issues + level breakdown + rich issue objects ─────────
        if issues_resp.status_code == 200:
            raw_issues = issues_resp.json()
            if isinstance(raw_issues, list):
                valid_issues = [i for i in raw_issues if isinstance(i, dict)]
                result["unresolved_issue_count"] = len(valid_issues)
                level_breakdown: dict[str, int] = {}
                for issue in valid_issues:
                    lvl = str(issue.get("level", "error"))
                    level_breakdown[lvl] = level_breakdown.get(lvl, 0) + 1
                result["issue_level_breakdown"] = level_breakdown
                # Lightweight summary for series charts
                result["top_issues"] = [
                    {
                        "title": str(issue.get("title", "Unknown"))[:60],
                        "count": int(issue.get("count", 0)),
                        "level": str(issue.get("level", "error")),
                        "user_count": int(issue.get("userCount", 0)),
                    }
                    for issue in valid_issues[:10]
                ]
                # Rich objects for the issues table (all fields needed for the UI)
                result["rich_issues"] = [
                    {
                        "id": str(iss.get("id", "")),
                        "short_id": str(iss.get("shortId", "")),
                        "title": str(iss.get("title", "Unknown")),
                        "level": str(iss.get("level", "error")),
                        "count": int(iss.get("count", 0)),
                        "user_count": int(iss.get("userCount", 0)),
                        "first_seen": str(iss.get("firstSeen", "")),
                        "last_seen": str(iss.get("lastSeen", "")),
                        "permalink": str(iss.get("permalink", "")),
                        "culprit": str(iss.get("culprit", "")),
                        "is_unhandled": bool(iss.get("isUnhandled", False)),
                        "priority": iss.get("priority"),
                        "filename": str((iss.get("metadata") or {}).get("filename", "")),
                    }
                    for iss in valid_issues
                ]

        # ── Error outcomes per day (stats_v2: accepted / discarded / filtered) ─
        if outcomes_resp.status_code == 200:
            od = outcomes_resp.json()
            start_str = od.get("start", "")
            if start_str:
                start_dt = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
                for g in od.get("groups", []):
                    outcome = g["by"].get("outcome", "")
                    series = g["series"].get("sum(times_seen)", [])
                    total_val = g["totals"].get("sum(times_seen)", 0)
                    day_map: dict[str, int] = {}
                    for idx, cnt in enumerate(series):
                        day_str = str((start_dt + timedelta(days=idx)).date())
                        day_map[day_str] = int(cnt)
                    if outcome == "accepted":
                        result["accepted_daily"] = day_map
                        result["accepted_total"] = int(total_val)
                    elif outcome == "client_discard":
                        result["discarded_daily"] = day_map
                        result["discarded_total"] = int(total_val)
                    elif outcome == "filtered":
                        result["filtered_daily"] = day_map
                        result["filtered_total"] = int(total_val)

        # ── Session health (crash-free rate, healthy/crashed/errored) ─────────
        if sessions_resp.status_code == 200:
            sd = sessions_resp.json()
            sess_start = (datetime.now(UTC) - timedelta(days=days)).replace(
                hour=0, minute=0, second=0, microsecond=0
            )
            sess_totals: dict[str, int] = {}
            sess_daily_by_status: dict[str, dict[str, int]] = {}

            for g in sd.get("groups", []):
                status = g["by"].get("session.status", "unknown")
                series = g["series"].get("sum(session)", [])
                sess_totals[status] = int(g["totals"].get("sum(session)", 0))
                day_map2: dict[str, int] = {}
                for idx, cnt in enumerate(series):
                    day_str = str((sess_start + timedelta(days=idx)).date())
                    day_map2[day_str] = int(cnt)
                sess_daily_by_status[status] = day_map2

            healthy = sess_totals.get("healthy", 0)
            crashed = sess_totals.get("crashed", 0)
            errored = sess_totals.get("errored", 0)
            abnormal = sess_totals.get("abnormal", 0)
            total_sessions = healthy + crashed + errored + abnormal

            result["session_totals"] = sess_totals
            result["healthy_sessions"] = healthy
            result["crashed_sessions"] = crashed
            result["errored_sessions"] = errored
            result["total_sessions"] = total_sessions
            result["crash_free_rate"] = round(100.0 * (1 - crashed / max(1, total_sessions)), 2)

            # Crash-free % per day (skip days where total sessions = 0)
            h_daily = sess_daily_by_status.get("healthy", {})
            c_daily = sess_daily_by_status.get("crashed", {})
            crash_free_map: dict[str, float] = {}
            for d_str in sorted(set(list(h_daily.keys()) + list(c_daily.keys()))):
                h = h_daily.get(d_str, 0)
                c = c_daily.get(d_str, 0)
                total_d = h + c
                if total_d > 0:
                    crash_free_map[d_str] = round(100.0 * (1 - c / total_d), 1)
            result["crash_free_daily"] = crash_free_map

        # ── Recent releases ───────────────────────────────────────────────────
        if releases_resp.status_code == 200:
            raw_releases = releases_resp.json()
            if isinstance(raw_releases, list):
                result["releases"] = [
                    {
                        "version": str(r.get("version", ""))[:12],
                        "date_created": str(r.get("dateCreated", "")),
                        "new_groups": int(r.get("newGroups", 0)),
                        "commit_count": int(r.get("commitCount", 0)),
                    }
                    for r in raw_releases
                    if isinstance(r, dict)
                ]

        if result:
            _sentry_stats_cache[days] = result
            _sentry_stats_cache_ts[days] = now

        return result

    except Exception:
        return _sentry_stats_cache.get(days, {})  # serve stale on error


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

    total_tokens: int = int(
        (
            await db.execute(
                select(
                    func.coalesce(func.sum(func.greatest(0, 3_000_000 - User.token_balance)), 0)
                ).select_from(User)
            )
        ).scalar_one()
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
                func.date_trunc(text("'week'"), UsageEvent.created_at).label("week"),
                func.count(UsageEvent.user_id.distinct()).label("cnt"),
            )
            .where(UsageEvent.created_at >= cutoff_90d)
            .group_by(func.date_trunc(text("'week'"), UsageEvent.created_at))
            .order_by(func.date_trunc(text("'week'"), UsageEvent.created_at))
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
                func.date_trunc(text("'week'"), UsageEvent.created_at).label("week"),
                func.count(UsageEvent.user_id.distinct()).label("cnt"),
            )
            .where(UsageEvent.created_at >= cutoff_90d)
            .group_by(func.date_trunc(text("'week'"), UsageEvent.created_at))
            .order_by(func.date_trunc(text("'week'"), UsageEvent.created_at))
        )
    ).fetchall()
    wau_trend = [AnalyticsPoint(date=str(r.week)[:10], value=float(r.cnt)) for r in wau_rows]

    # MAU trend (90d, monthly)
    mau_rows = (
        await db.execute(
            select(
                func.date_trunc(text("'month'"), UsageEvent.created_at).label("month"),
                func.count(UsageEvent.user_id.distinct()).label("cnt"),
            )
            .where(UsageEvent.created_at >= cutoff_90d)
            .group_by(func.date_trunc(text("'month'"), UsageEvent.created_at))
            .order_by(func.date_trunc(text("'month'"), UsageEvent.created_at))
        )
    ).fetchall()
    mau_trend = [AnalyticsPoint(date=str(r.month)[:7], value=float(r.cnt)) for r in mau_rows]

    # QAU trend (365d, quarterly)
    qau_rows = (
        await db.execute(
            select(
                func.date_trunc(text("'quarter'"), UsageEvent.created_at).label("quarter"),
                func.count(UsageEvent.user_id.distinct()).label("cnt"),
            )
            .where(UsageEvent.created_at >= cutoff_365d)
            .group_by(func.date_trunc(text("'quarter'"), UsageEvent.created_at))
            .order_by(func.date_trunc(text("'quarter'"), UsageEvent.created_at))
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


async def _developer_metrics(db: AsyncSession, days: int) -> AnalyticsResponse:  # noqa: PLR0912, PLR0915
    now = datetime.now(UTC)
    cutoff = (now - timedelta(days=days)).replace(hour=0, minute=0, second=0, microsecond=0)

    # ── HTTP request metrics (from api_request_logs, last N days) ────────────

    http_total_30d: int = (
        await db.execute(
            select(func.count())
            .select_from(ApiRequestLog)
            .where(ApiRequestLog.created_at >= cutoff)
        )
    ).scalar_one()

    http_error_30d: int = (
        await db.execute(
            select(func.count())
            .select_from(ApiRequestLog)
            .where(ApiRequestLog.created_at >= cutoff, ApiRequestLog.status_code >= 400)
        )
    ).scalar_one()

    http_5xx_30d: int = (
        await db.execute(
            select(func.count())
            .select_from(ApiRequestLog)
            .where(ApiRequestLog.created_at >= cutoff, ApiRequestLog.status_code >= 500)
        )
    ).scalar_one()

    p95_raw = (
        await db.execute(
            text(
                "SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) "
                "FROM api_request_logs WHERE created_at >= :cutoff"
            ),
            {"cutoff": cutoff},
        )
    ).scalar_one_or_none()
    p95_latency_ms = round(float(p95_raw), 0) if p95_raw is not None else 0.0

    # HTTP requests per day
    http_req_rows = (
        await db.execute(
            select(
                cast(ApiRequestLog.created_at, SqlDate).label("day"),
                func.count().label("cnt"),
            )
            .where(ApiRequestLog.created_at >= cutoff)
            .group_by(cast(ApiRequestLog.created_at, SqlDate))
            .order_by(cast(ApiRequestLog.created_at, SqlDate))
        )
    ).fetchall()
    http_req_map: dict[str, int | float] = {str(r.day): r.cnt for r in http_req_rows}

    # HTTP errors (4xx + 5xx) per day
    http_err_rows = (
        await db.execute(
            select(
                cast(ApiRequestLog.created_at, SqlDate).label("day"),
                func.count().label("cnt"),
            )
            .where(ApiRequestLog.created_at >= cutoff, ApiRequestLog.status_code >= 400)
            .group_by(cast(ApiRequestLog.created_at, SqlDate))
            .order_by(cast(ApiRequestLog.created_at, SqlDate))
        )
    ).fetchall()
    http_err_map: dict[str, int | float] = {str(r.day): r.cnt for r in http_err_rows}

    # HTTP 5xx per day
    http_5xx_rows = (
        await db.execute(
            select(
                cast(ApiRequestLog.created_at, SqlDate).label("day"),
                func.count().label("cnt"),
            )
            .where(ApiRequestLog.created_at >= cutoff, ApiRequestLog.status_code >= 500)
            .group_by(cast(ApiRequestLog.created_at, SqlDate))
            .order_by(cast(ApiRequestLog.created_at, SqlDate))
        )
    ).fetchall()
    http_5xx_map: dict[str, int | float] = {str(r.day): r.cnt for r in http_5xx_rows}

    # Top failing endpoints (top 5, user-facing paths only — exclude admin internals)
    top_fail_rows = (
        await db.execute(
            select(
                ApiRequestLog.path.label("path"),
                func.count().label("cnt"),
            )
            .where(
                ApiRequestLog.created_at >= cutoff,
                ApiRequestLog.status_code >= 400,
                ~ApiRequestLog.path.like("/api/v1/admin/%"),
            )
            .group_by(ApiRequestLog.path)
            .order_by(func.count().desc())
            .limit(5)
        )
    ).fetchall()
    top_fail_data = [AnalyticsPoint(date=str(r.path), value=float(r.cnt)) for r in top_fail_rows]

    # Per-endpoint latency (top 10 by volume, user-facing paths only)
    latency_rows = (
        await db.execute(
            text(
                "SELECT path, COUNT(*) AS cnt,"
                " PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50,"
                " PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95"
                " FROM api_request_logs"
                " WHERE created_at >= :cutoff"
                " AND path NOT LIKE '/api/v1/admin/%'"
                " GROUP BY path ORDER BY cnt DESC LIMIT 10"
            ),
            {"cutoff": cutoff},
        )
    ).fetchall()
    endpoint_latency = [
        {
            "path": str(r.path),
            "count": int(r.cnt),
            "p50_ms": round(float(r.p50), 0) if r.p50 is not None else 0,
            "p95_ms": round(float(r.p95), 0) if r.p95 is not None else 0,
        }
        for r in latency_rows
    ]

    # ── Sentry error stats (concurrent Sentry API calls) ─────────────────────

    sentry = await _fetch_sentry_stats(days)

    # Error events per day (legacy /stats/ — received count)
    sentry_daily_map: dict[str, int | float] = {}
    for row in sentry.get("error_events_daily", []):
        d = str(datetime.fromtimestamp(int(row["ts"]), tz=UTC).date())
        sentry_daily_map[d] = int(row["count"])

    # Top issues (distribution card)
    sentry_issues_data = [
        AnalyticsPoint(date=str(issue["title"])[:60], value=float(issue["count"]))
        for issue in sentry.get("top_issues", [])
    ]

    # Outcomes: accepted / discarded / filtered per day
    sentry_accepted_map: dict[str, int | float] = {
        k: float(v) for k, v in sentry.get("accepted_daily", {}).items()
    }
    sentry_discarded_map: dict[str, int | float] = {
        k: float(v) for k, v in sentry.get("discarded_daily", {}).items()
    }
    sentry_filtered_map: dict[str, int | float] = {
        k: float(v) for k, v in sentry.get("filtered_daily", {}).items()
    }

    # Session health: crash-free % per day
    sentry_crash_free_map: dict[str, int | float] = {
        k: float(v) for k, v in sentry.get("crash_free_daily", {}).items()
    }

    # Session health distribution (healthy / crashed / errored / abnormal)
    sentry_session_health_data = [
        AnalyticsPoint(date=status, value=float(count))
        for status, count in sentry.get("session_totals", {}).items()
        if int(count) > 0
    ]

    # Issue level breakdown (error / warning / info)
    sentry_level_data = [
        AnalyticsPoint(date=lvl, value=float(count))
        for lvl, count in sentry.get("issue_level_breakdown", {}).items()
    ]

    # ── Bridge pipeline statics (all-time) ────────────────────────────────────

    total_bridge_jobs: int = (
        await db.execute(select(func.count()).select_from(TransferJob))
    ).scalar_one()

    completed_bridge: int = (
        await db.execute(
            select(func.count())
            .select_from(TransferJob)
            .where(TransferJob.status == TransferJobStatus.completed)
        )
    ).scalar_one()

    failed_bridge: int = (
        await db.execute(
            select(func.count())
            .select_from(TransferJob)
            .where(TransferJob.status == TransferJobStatus.failed)
        )
    ).scalar_one()

    reused_bridge: int = (
        await db.execute(
            select(func.count()).select_from(TransferJob).where(TransferJob.reused_mapping == True)  # noqa: E712
        )
    ).scalar_one()

    # Current queue depth: jobs in a non-terminal state right now
    queue_depth: int = (
        await db.execute(
            select(func.count())
            .select_from(TransferJob)
            .where(
                TransferJob.status.in_(
                    [
                        TransferJobStatus.queued,
                        TransferJobStatus.calibrating,
                        TransferJobStatus.extracting_mapping,
                        TransferJobStatus.adapting,
                    ]
                )
            )
        )
    ).scalar_one()

    # ── Optimizer pipeline statics (all-time) ─────────────────────────────────

    total_opt_sessions: int = (
        await db.execute(select(func.count()).select_from(ChatSession))
    ).scalar_one()

    # Incomplete sessions: created but never received an assistant reply
    # (Celery worker died or the job was never processed)
    asst_msg = aliased(Message)
    incomplete_sessions: int = (
        await db.execute(
            select(func.count())
            .select_from(ChatSession)
            .outerjoin(
                asst_msg,
                (asst_msg.session_id == ChatSession.id) & (asst_msg.role == "assistant"),
            )
            .where(asst_msg.id.is_(None))
        )
    ).scalar_one()

    # ── Derived rates ─────────────────────────────────────────────────────────

    bridge_success_rate = round(completed_bridge / max(1, total_bridge_jobs) * 100, 1)
    bridge_failure_rate = round(failed_bridge / max(1, total_bridge_jobs) * 100, 1)
    bridge_reuse_rate = round(reused_bridge / max(1, total_bridge_jobs) * 100, 1)
    opt_completion_rate = round(
        (total_opt_sessions - incomplete_sessions) / max(1, total_opt_sessions) * 100, 1
    )

    # ── Time-series (last N days) ─────────────────────────────────────────────

    # Bridge: all jobs per day
    bridge_all_rows = (
        await db.execute(
            select(
                cast(TransferJob.created_at, SqlDate).label("day"),
                func.count().label("cnt"),
            )
            .where(TransferJob.created_at >= cutoff)
            .group_by(cast(TransferJob.created_at, SqlDate))
            .order_by(cast(TransferJob.created_at, SqlDate))
        )
    ).fetchall()
    bridge_all_map: dict[str, int | float] = {str(r.day): r.cnt for r in bridge_all_rows}

    # Bridge: completed per day
    bridge_ok_rows = (
        await db.execute(
            select(
                cast(TransferJob.created_at, SqlDate).label("day"),
                func.count().label("cnt"),
            )
            .where(
                TransferJob.created_at >= cutoff,
                TransferJob.status == TransferJobStatus.completed,
            )
            .group_by(cast(TransferJob.created_at, SqlDate))
            .order_by(cast(TransferJob.created_at, SqlDate))
        )
    ).fetchall()
    bridge_ok_map: dict[str, int | float] = {str(r.day): r.cnt for r in bridge_ok_rows}

    # Bridge: failed per day
    bridge_fail_rows = (
        await db.execute(
            select(
                cast(TransferJob.created_at, SqlDate).label("day"),
                func.count().label("cnt"),
            )
            .where(
                TransferJob.created_at >= cutoff,
                TransferJob.status == TransferJobStatus.failed,
            )
            .group_by(cast(TransferJob.created_at, SqlDate))
            .order_by(cast(TransferJob.created_at, SqlDate))
        )
    ).fetchall()
    bridge_fail_map: dict[str, int | float] = {str(r.day): r.cnt for r in bridge_fail_rows}

    # Optimizer: sessions per day
    opt_sess_rows = (
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
    opt_sess_map: dict[str, int | float] = {str(r.day): r.cnt for r in opt_sess_rows}

    # Optimizer: incomplete sessions per day (no assistant reply)
    asst_msg2 = aliased(Message)
    inc_rows = (
        await db.execute(
            select(
                cast(ChatSession.created_at, SqlDate).label("day"),
                func.count().label("cnt"),
            )
            .outerjoin(
                asst_msg2,
                (asst_msg2.session_id == ChatSession.id) & (asst_msg2.role == "assistant"),
            )
            .where(ChatSession.created_at >= cutoff, asst_msg2.id.is_(None))
            .group_by(cast(ChatSession.created_at, SqlDate))
            .order_by(cast(ChatSession.created_at, SqlDate))
        )
    ).fetchall()
    incomplete_map: dict[str, int | float] = {str(r.day): r.cnt for r in inc_rows}

    # UsageEvent actions per day (optimize / health_score / advisory)
    act_rows = (
        await db.execute(
            select(
                UsageEvent.action.label("act"),
                cast(UsageEvent.created_at, SqlDate).label("day"),
                func.count().label("cnt"),
            )
            .where(UsageEvent.created_at >= cutoff)
            .group_by(UsageEvent.action, cast(UsageEvent.created_at, SqlDate))
            .order_by(cast(UsageEvent.created_at, SqlDate))
        )
    ).fetchall()
    act_maps: dict[str, dict[str, int | float]] = {}
    for r in act_rows:
        act_maps.setdefault(str(r.act), {})[str(r.day)] = r.cnt
    opt_evt_map = act_maps.get("optimize", {})
    hs_evt_map = act_maps.get("health_score", {})
    adv_evt_map = act_maps.get("advisory", {})

    # ── Categorical distributions (all-time) ─────────────────────────────────

    bridge_status_rows = (
        await db.execute(
            select(TransferJob.status.label("status"), func.count().label("cnt"))
            .group_by(TransferJob.status)
            .order_by(func.count().desc())
        )
    ).fetchall()
    bridge_status_data = [
        AnalyticsPoint(date=str(r.status), value=float(r.cnt)) for r in bridge_status_rows
    ]

    bridge_reuse_data = [
        AnalyticsPoint(date="Reused", value=float(reused_bridge)),
        AnalyticsPoint(date="Fresh", value=float(max(0, total_bridge_jobs - reused_bridge))),
    ]

    # ── Build response ────────────────────────────────────────────────────────

    return AnalyticsResponse(
        view="developer_metrics",
        generated_at=now.isoformat(),
        statics={
            # HTTP health
            "http_total_requests_30d": http_total_30d,
            "http_error_count_30d": http_error_30d,
            "http_5xx_count_30d": http_5xx_30d,
            "http_error_rate_pct": round(http_error_30d / max(1, http_total_30d) * 100, 2),
            "http_p95_latency_ms": p95_latency_ms,
            # Sentry (-1 = not configured)
            "sentry_total_errors": sentry.get("total_errors", -1),
            "sentry_unresolved_issues": sentry.get("unresolved_issue_count", -1),
            "sentry_crash_free_rate": sentry.get("crash_free_rate", -1),
            "sentry_total_sessions": sentry.get("total_sessions", -1),
            "sentry_healthy_sessions": sentry.get("healthy_sessions", -1),
            "sentry_crashed_sessions": sentry.get("crashed_sessions", -1),
            "sentry_accepted_total": sentry.get("accepted_total", -1),
            "sentry_discarded_total": sentry.get("discarded_total", -1),
            "sentry_filtered_total": sentry.get("filtered_total", -1),
            # Bridge pipeline
            "total_bridge_jobs": total_bridge_jobs,
            "bridge_failed_all_time": failed_bridge,
            "bridge_success_rate_pct": bridge_success_rate,
            "bridge_failure_rate_pct": bridge_failure_rate,
            "bridge_reuse_rate_pct": bridge_reuse_rate,
            "bridge_queue_depth": queue_depth,
            # Optimizer pipeline
            "total_optimizer_sessions": total_opt_sessions,
            "optimizer_incomplete_sessions": incomplete_sessions,
            "optimizer_completion_rate_pct": opt_completion_rate,
        },
        series=[
            # ── HTTP health ───────────────────────────────────────────────────
            AnalyticsSeries(
                key="dev_http_requests_daily",
                label="HTTP Requests / Day",
                total=float(http_total_30d),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, http_req_map),
                chart_type="line",
                color="#06b6d4",
            ),
            AnalyticsSeries(
                key="dev_http_errors_daily",
                label="HTTP Errors / Day (4xx + 5xx)",
                total=float(http_error_30d),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, http_err_map),
                chart_type="bar",
                color="#f43f5e",
            ),
            AnalyticsSeries(
                key="dev_http_5xx_daily",
                label="Server Errors / Day (5xx)",
                total=float(http_5xx_30d),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, http_5xx_map),
                chart_type="bar",
                color="#dc2626",
            ),
            AnalyticsSeries(
                key="dev_http_top_failing_paths",
                label="Top Failing Endpoints",
                total=float(http_error_30d),
                time_range=f"Last {days} Days",
                data=top_fail_data,
                chart_type="bar",
                color="#f43f5e",
            ),
            # ── Sentry ────────────────────────────────────────────────────────
            AnalyticsSeries(
                key="dev_sentry_errors_daily",
                label="Sentry Error Events / Day",
                total=float(sentry.get("total_errors", 0)),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, sentry_daily_map),
                chart_type="bar",
                color="#f43f5e",
            ),
            AnalyticsSeries(
                key="dev_sentry_top_issues",
                label="Top Sentry Issues",
                total=float(sentry.get("unresolved_issue_count", 0)),
                time_range=f"Last {days} Days",
                data=sentry_issues_data,
                chart_type="bar",
                color="#f59e0b",
            ),
            AnalyticsSeries(
                key="dev_sentry_accepted_daily",
                label="Accepted Error Events / Day",
                total=float(sentry.get("accepted_total", 0)),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, sentry_accepted_map),
                chart_type="line",
                color="#10b981",
            ),
            AnalyticsSeries(
                key="dev_sentry_discarded_daily",
                label="Discarded Events / Day",
                total=float(sentry.get("discarded_total", 0)),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, sentry_discarded_map),
                chart_type="bar",
                color="#f59e0b",
            ),
            AnalyticsSeries(
                key="dev_sentry_filtered_daily",
                label="Filtered Events / Day",
                total=float(sentry.get("filtered_total", 0)),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, sentry_filtered_map),
                chart_type="bar",
                color="#6366f1",
            ),
            AnalyticsSeries(
                key="dev_sentry_crash_free_daily",
                label="Crash-Free Session Rate",
                total=float(sentry.get("crash_free_rate", 0)),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, sentry_crash_free_map),
                chart_type="line",
                color="#10b981",
            ),
            AnalyticsSeries(
                key="dev_sentry_session_health",
                label="Session Health Breakdown",
                total=float(sentry.get("total_sessions", 0)),
                time_range=f"Last {days} Days",
                data=sentry_session_health_data,
                chart_type="bar",
                color="#10b981",
            ),
            AnalyticsSeries(
                key="dev_sentry_issue_levels",
                label="Issues by Level",
                total=float(sentry.get("unresolved_issue_count", 0)),
                time_range=f"Last {days} Days",
                data=sentry_level_data,
                chart_type="bar",
                color="#f43f5e",
            ),
            # ── Bridge pipeline ───────────────────────────────────────────────
            AnalyticsSeries(
                key="dev_bridge_jobs_daily",
                label="Bridge Jobs / Day",
                total=float(sum(bridge_all_map.values())),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, bridge_all_map),
                chart_type="line",
                color="#8b5cf6",
            ),
            AnalyticsSeries(
                key="dev_bridge_completed_daily",
                label="Completed Bridge Jobs / Day",
                total=float(sum(bridge_ok_map.values())),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, bridge_ok_map),
                chart_type="bar",
                color="#10b981",
            ),
            AnalyticsSeries(
                key="dev_bridge_failed_daily",
                label="Failed Bridge Jobs / Day",
                total=float(sum(bridge_fail_map.values())),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, bridge_fail_map),
                chart_type="bar",
                color="#f43f5e",
            ),
            AnalyticsSeries(
                key="dev_optimizer_sessions_daily",
                label="Optimizer Sessions / Day",
                total=float(sum(opt_sess_map.values())),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, opt_sess_map),
                chart_type="line",
                color="var(--primary)",
            ),
            AnalyticsSeries(
                key="dev_incomplete_sessions_daily",
                label="Incomplete Optimizer Sessions / Day",
                total=float(sum(incomplete_map.values())),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, incomplete_map),
                chart_type="bar",
                color="#f43f5e",
            ),
            AnalyticsSeries(
                key="dev_optimize_events_daily",
                label="Optimize API Calls / Day",
                total=float(sum(opt_evt_map.values())),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, opt_evt_map),
                chart_type="bar",
                color="var(--primary)",
            ),
            AnalyticsSeries(
                key="dev_health_score_daily",
                label="Health Score API Calls / Day",
                total=float(sum(hs_evt_map.values())),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, hs_evt_map),
                chart_type="bar",
                color="#06b6d4",
            ),
            AnalyticsSeries(
                key="dev_advisory_daily",
                label="Advisory API Calls / Day",
                total=float(sum(adv_evt_map.values())),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, adv_evt_map),
                chart_type="bar",
                color="#f59e0b",
            ),
            AnalyticsSeries(
                key="dev_bridge_status_dist",
                label="Bridge Job Status Distribution",
                total=float(total_bridge_jobs),
                time_range="All Time",
                data=bridge_status_data,
                chart_type="bar",
                color="#8b5cf6",
            ),
            AnalyticsSeries(
                key="dev_bridge_reuse_dist",
                label="Bridge Mapping Reuse",
                total=float(total_bridge_jobs),
                time_range="All Time",
                data=bridge_reuse_data,
                chart_type="bar",
                color="#06b6d4",
            ),
        ],
        raw={
            "sentry_issues": sentry.get("rich_issues", []),
            "sentry_releases": sentry.get("releases", []),
            "endpoint_latency": endpoint_latency,
        },
    )


# ── Analytics endpoint ────────────────────────────────────────────────────────

_ANALYTICS_VIEWS = {
    "platform_engagement",
    "platform_logins",
    "agent_optimizer",
    "agent_skillopt",
    "agent_domain",
    "agent_bridge",
    "developer_metrics",
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
                    "tokens"
                ),
            )
            .where(Message.created_at >= cutoff, Message.token_usage.isnot(None))
            .group_by(cast(Message.created_at, SqlDate))
            .order_by(cast(Message.created_at, SqlDate))
        )
    ).fetchall()
    tok_map: dict[str, int | float] = {str(r.day): r.tokens for r in tok_rows}
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
                    "tokens"
                ),
            )
            .where(Message.created_at >= cutoff, Message.token_usage.isnot(None))
            .group_by(cast(Message.created_at, SqlDate))
            .order_by(cast(Message.created_at, SqlDate))
        )
    ).fetchall()
    tok_map: dict[str, int | float] = {str(r.day): r.tokens for r in tok_rows}

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
                    "tokens"
                ),
            )
            .where(Message.created_at >= cutoff, Message.token_usage.isnot(None))
            .group_by(cast(Message.created_at, SqlDate))
            .order_by(cast(Message.created_at, SqlDate))
        )
    ).fetchall()
    tok_map: dict[str, int | float] = {str(r.day): r.tokens for r in tok_rows}

    total_bridge = int(
        (
            await db.execute(
                select(func.count()).select_from(UsageEvent).where(UsageEvent.action == "bridge")
            )
        ).scalar_one()
    )

    # Fetch live per-model pricing from OpenRouter (cached 10 min)
    live_pricing = await _fetch_or_model_pricing()

    # Source model distribution — count + tokens (all time, ordered by usage)
    src_rows = (
        await db.execute(
            select(
                TransferJob.source_model.label("model"),
                func.count().label("cnt"),
                func.coalesce(func.sum(TransferJob.token_count), 0).label("tokens"),
            )
            .where(TransferJob.status == "completed")
            .group_by(TransferJob.source_model)
            .order_by(func.count().desc())
        )
    ).fetchall()
    src_count_data = [AnalyticsPoint(date=str(r.model), value=float(r.cnt)) for r in src_rows]
    src_token_data = [AnalyticsPoint(date=str(r.model), value=float(r.tokens)) for r in src_rows]
    src_cost_data = [
        AnalyticsPoint(
            date=str(r.model),
            value=round(float(r.tokens) * _live_cost_per_token(r.model, live_pricing), 6),
        )
        for r in src_rows
    ]

    # Target model distribution — count + tokens (all time, ordered by usage)
    tgt_rows = (
        await db.execute(
            select(
                TransferJob.target_model.label("model"),
                func.count().label("cnt"),
                func.coalesce(func.sum(TransferJob.token_count), 0).label("tokens"),
            )
            .where(TransferJob.status == "completed")
            .group_by(TransferJob.target_model)
            .order_by(func.count().desc())
        )
    ).fetchall()
    tgt_count_data = [AnalyticsPoint(date=str(r.model), value=float(r.cnt)) for r in tgt_rows]
    tgt_token_data = [AnalyticsPoint(date=str(r.model), value=float(r.tokens)) for r in tgt_rows]
    tgt_cost_data = [
        AnalyticsPoint(
            date=str(r.model),
            value=round(float(r.tokens) * _live_cost_per_token(r.model, live_pricing), 6),
        )
        for r in tgt_rows
    ]

    total_src_cost = round(sum(p.value for p in src_cost_data), 6)
    total_tgt_cost = round(sum(p.value for p in tgt_cost_data), 6)

    return AnalyticsResponse(
        view="agent_bridge",
        generated_at=datetime.now(UTC).isoformat(),
        statics={
            "total_bridges": total_bridge,
            "total_src_cost_usd": total_src_cost,
            "total_tgt_cost_usd": total_tgt_cost,
        },
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
            # Source model breakdown
            AnalyticsSeries(
                key="bridge_source_models",
                label="Source Model — Runs",
                total=float(total_bridge),
                time_range="All Time",
                data=src_count_data,
                chart_type="bar",
            ),
            AnalyticsSeries(
                key="bridge_source_model_tokens",
                label="Source Model — Tokens",
                total=float(sum(p.value for p in src_token_data)),
                time_range="All Time",
                data=src_token_data,
                chart_type="bar",
            ),
            AnalyticsSeries(
                key="bridge_source_model_costs",
                label="Source Model — Cost (USD)",
                total=total_src_cost,
                time_range="All Time",
                data=src_cost_data,
                chart_type="bar",
            ),
            # Target model breakdown
            AnalyticsSeries(
                key="bridge_target_models",
                label="Target Model — Runs",
                total=float(total_bridge),
                time_range="All Time",
                data=tgt_count_data,
                chart_type="bar",
            ),
            AnalyticsSeries(
                key="bridge_target_model_tokens",
                label="Target Model — Tokens",
                total=float(sum(p.value for p in tgt_token_data)),
                time_range="All Time",
                data=tgt_token_data,
                chart_type="bar",
            ),
            AnalyticsSeries(
                key="bridge_target_model_costs",
                label="Target Model — Cost (USD)",
                total=total_tgt_cost,
                time_range="All Time",
                data=tgt_cost_data,
                chart_type="bar",
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
        "developer_metrics": _developer_metrics,
    }
    result = await handlers[view](db, days)
    return SuccessResponse(data=result)


@router.get(
    "/sentry/issues/{issue_id}",
    summary="Admin — Sentry issue detail with latest event",
    response_model=None,
    responses=error_responses(401, 403, 503),
)
async def get_sentry_issue_detail(
    issue_id: str,
    _admin: Annotated[Any, Depends(require_admin)],
) -> JSONResponse:
    app = get_app_settings()
    if not (app.SENTRY_AUTH_TOKEN and app.SENTRY_ORG_SLUG):
        raise HTTPException(status_code=503, detail="Sentry not configured")

    token = app.SENTRY_AUTH_TOKEN.get_secret_value()
    headers = {"Authorization": f"Bearer {token}"}

    async with httpx.AsyncClient(timeout=12.0) as client:
        issue_resp, event_resp = await asyncio.gather(
            client.get(f"https://sentry.io/api/0/issues/{issue_id}/", headers=headers),
            client.get(
                f"https://sentry.io/api/0/issues/{issue_id}/events/latest/",
                headers=headers,
            ),
        )

    if issue_resp.status_code != 200:
        raise HTTPException(status_code=404, detail="Issue not found in Sentry")

    issue = issue_resp.json()
    event_data: dict[str, Any] = {}

    if event_resp.status_code == 200:
        event = event_resp.json()
        exception_info: dict[str, Any] | None = None
        request_info: dict[str, Any] | None = None
        breadcrumbs: list[dict[str, Any]] = []

        for entry in event.get("entries", []):
            etype = entry.get("type", "")

            if etype == "exception":
                values = entry["data"].get("values", [])
                if values:
                    exc = values[-1]
                    raw_frames = (exc.get("stacktrace") or {}).get("frames", [])
                    frames = [
                        {
                            "filename": f.get("filename", ""),
                            "lineno": f.get("lineno"),
                            "function": f.get("function", ""),
                            "context": f.get("context", []),
                            "in_app": bool(f.get("inApp", False)),
                            "vars": {k: str(v)[:120] for k, v in (f.get("vars") or {}).items()},
                        }
                        for f in raw_frames
                    ]
                    exception_info = {
                        "exc_type": exc.get("type", ""),
                        "exc_value": str(exc.get("value", ""))[:500],
                        "mechanism": (exc.get("mechanism") or {}).get("type", ""),
                        "frames": frames[-20:],
                    }

            elif etype == "request":
                req = entry["data"]
                raw_headers = req.get("headers") or []
                exception_info_req_headers = (
                    raw_headers if isinstance(raw_headers, list) else list(raw_headers.items())
                )
                request_info = {
                    "method": req.get("method", ""),
                    "url": req.get("url", ""),
                    "query_string": req.get("query", "") or "",
                    "headers": exception_info_req_headers[:15],
                }

            elif etype == "breadcrumbs":
                crumbs = (entry["data"].get("values") or [])[-12:]
                breadcrumbs = [
                    {
                        "type": c.get("type", ""),
                        "category": c.get("category", ""),
                        "message": str(c.get("message") or "")[:120],
                        "level": c.get("level", ""),
                        "timestamp": c.get("timestamp", ""),
                    }
                    for c in crumbs
                ]

        user = event.get("user") or {}
        geo = user.get("geo") or {}
        tags = event.get("tags") or []

        event_data = {
            "event_id": event.get("eventID", ""),
            "timestamp": event.get("dateCreated", ""),
            "user": {
                "id": user.get("id"),
                "email": user.get("email"),
                "ip": user.get("ip_address"),
                "geo_city": geo.get("city"),
                "geo_country": geo.get("country_code"),
                "geo_region": geo.get("region"),
            },
            "tags": [
                {"key": str(t[0]), "value": str(t[1])}
                if isinstance(t, list | tuple)
                else {"key": str(t.get("key", "")), "value": str(t.get("value", ""))}
                for t in tags
            ],
            "exception": exception_info,
            "request": request_info,
            "breadcrumbs": breadcrumbs,
            "release": (
                event["release"].get("version")
                if isinstance(event.get("release"), dict)
                else str(event["release"])
                if event.get("release") is not None
                else None
            ),
        }

    return JSONResponse(
        content={
            "success": True,
            "data": {
                "issue": {
                    "id": str(issue.get("id", "")),
                    "short_id": issue.get("shortId", ""),
                    "title": issue.get("title", ""),
                    "level": issue.get("level", "error"),
                    "count": int(issue.get("count", 0) or 0),
                    "user_count": int(issue.get("userCount", 0) or 0),
                    "first_seen": issue.get("firstSeen", ""),
                    "last_seen": issue.get("lastSeen", ""),
                    "permalink": issue.get("permalink", ""),
                    "culprit": issue.get("culprit", ""),
                    "status": issue.get("status", ""),
                },
                "latest_event": event_data,
            },
        }
    )


# ── AI Fix suggestion ──────────────────────────────────────────────────────────


class _AiFixFrame(BaseModel):
    filename: str = ""
    lineno: int | None = None
    function: str = ""
    context: list[list[Any]] = []
    in_app: bool = False
    vars: dict[str, str] = {}


class _AiFixException(BaseModel):
    exc_type: str = ""
    exc_value: str = ""
    mechanism: str = ""
    frames: list[_AiFixFrame] = []


class _AiFixRequest(BaseModel):
    title: str
    level: str = "error"
    culprit: str = ""
    exception: _AiFixException | None = None
    request_method: str = ""
    request_url: str = ""
    breadcrumbs: list[dict[str, Any]] = []


def _build_ai_fix_prompt(payload: _AiFixRequest) -> str:
    """Build a focused, token-efficient prompt from compressed issue data."""
    parts: list[str] = []

    if payload.exception:
        exc = payload.exception
        parts.append(f"ERROR: {exc.exc_type}: {exc.exc_value[:400]}")
        if exc.mechanism:
            parts.append(f"Mechanism: {exc.mechanism}")
    else:
        parts.append(f"ERROR: {payload.title}")

    if payload.culprit:
        parts.append(f"Culprit: {payload.culprit}")

    if payload.exception and payload.exception.frames:
        in_app = [f for f in payload.exception.frames if f.in_app]
        frames_to_show = (in_app or payload.exception.frames)[-8:]
        parts.append("\nSTACK TRACE (in-app frames, newest first):")
        for frame in reversed(frames_to_show):
            parts.append(f"\n  File: {frame.filename}:{frame.lineno or '?'} in {frame.function}()")
            for lineno, line_text in (frame.context or [])[-7:]:
                marker = ">>>" if lineno == frame.lineno else "   "
                parts.append(f"    {marker} {lineno:4d} | {line_text}")
            if frame.vars:
                vars_str = ", ".join(f"{k}={v}" for k, v in list(frame.vars.items())[:4])
                parts.append(f"    vars: {vars_str}")

    if payload.request_method and payload.request_url:
        parts.append(f"\nREQUEST: {payload.request_method} {payload.request_url}")

    if payload.breadcrumbs:
        parts.append("\nLAST BREADCRUMBS:")
        for crumb in payload.breadcrumbs[-3:]:
            ts = str(crumb.get("timestamp", ""))[:19]
            cat = crumb.get("category", "")
            msg = str(crumb.get("message", ""))[:100]
            parts.append(f"  [{ts}] {cat}: {msg}")

    return "\n".join(parts)


@router.post(
    "/sentry/issues/ai-fix",
    summary="Admin — AI root-cause analysis and fix suggestion for a Sentry issue",
    response_model=None,
    responses=error_responses(401, 403, 503),
)
async def get_sentry_issue_ai_fix(
    payload: _AiFixRequest,
    _admin: Annotated[Any, Depends(require_admin)],
) -> JSONResponse:
    llm = get_llm_settings()
    if not llm.OPENROUTER_API_KEY:
        raise HTTPException(status_code=503, detail="LLM not configured")

    issue_context = _build_ai_fix_prompt(payload)

    system_prompt = (
        "You are a senior backend engineer performing root-cause analysis on production errors "
        "from a FastAPI / Python application. Be concise, specific, and actionable. "
        "Always reference exact file paths and line numbers from the stack trace.\n\n"
        "Respond in this exact markdown format:\n\n"
        "## Root Cause\n"
        "[2-3 sentences explaining *why* the error occurs]\n\n"
        "## Location\n"
        "`filename.py:line_number` in `function_name()`\n"
        "[One sentence on what this code does and why it fails]\n\n"
        "## Fix\n"
        "```python\n"
        "[Corrected code snippet, 5-15 lines]\n"
        "```\n"
        "[1-2 sentences explaining the change]\n\n"
        "## Prevention\n"
        "[One concrete tip to prevent this class of error recurring]"
    )

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {llm.OPENROUTER_API_KEY.get_secret_value()}",
                "Content-Type": "application/json",
            },
            json={
                "model": "openai/gpt-4.1-mini",
                "max_tokens": 800,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {
                        "role": "user",
                        "content": (
                            "Analyze this production error and provide a fix:\n\n" + issue_context
                        ),
                    },
                ],
            },
        )

    if resp.status_code != 200:
        raise HTTPException(status_code=503, detail="AI service unavailable")

    content = resp.json()["choices"][0]["message"]["content"]
    return JSONResponse(content={"success": True, "data": {"analysis": content}})
