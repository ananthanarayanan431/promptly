from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import Date as SqlDate
from sqlalchemy import cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from promptly.admin.api.schemas import (
    AdminStats,
    DailyActivity,
    FeatureUsage,
    TopUser,
)
from promptly.admin.services.audit import FEATURE_LABELS
from promptly.models.session import ChatSession
from promptly.models.usage_event import UsageEvent
from promptly.models.user import User


async def fetch_platform_stats(db: AsyncSession) -> AdminStats:
    """Aggregate platform-wide statistics with feature breakdown, daily chart, and top consumers."""
    now = datetime.now(UTC)
    cutoff_7d = now - timedelta(days=7)
    cutoff_30d = now - timedelta(days=30)
    cutoff_14d = now - timedelta(days=14)

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

    total_opts: int = (await db.execute(select(func.count()).select_from(ChatSession))).scalar_one()
    total_budget = total_users * 3_000_000
    consumed_result = await db.execute(
        select(func.coalesce(func.sum(3_000_000 - User.token_balance), 0)).select_from(User)
    )
    total_consumed: int = max(0, int(consumed_result.scalar_one()))
    avg_per_user = total_consumed // max(1, total_users)
    budget_pct = round((total_consumed / max(1, total_budget)) * 100, 1)

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
            label=FEATURE_LABELS.get(row.action, row.action.replace("_", " ").title()),
        )
        for row in feature_rows
    ]

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
    daily_map = {str(r.day): r.calls for r in daily_rows}
    daily_activity = [
        DailyActivity(
            date=str((cutoff_14d + timedelta(days=i)).date()),
            calls=daily_map.get(str((cutoff_14d + timedelta(days=i)).date()), 0),
            tokens=0,
        )
        for i in range(14)
    ]

    top_rows = (
        (await db.execute(select(User).order_by((3_000_000 - User.token_balance).desc()).limit(8)))
        .scalars()
        .all()
    )
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

    return AdminStats(
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
