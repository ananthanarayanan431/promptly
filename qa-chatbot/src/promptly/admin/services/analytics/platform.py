from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import Date as SqlDate
from sqlalchemy import cast, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from promptly.admin.api.schemas import AnalyticsPoint, AnalyticsResponse, AnalyticsSeries
from promptly.admin.services.analytics.helpers import fill_days
from promptly.models.message import Message
from promptly.models.session import ChatSession
from promptly.models.usage_event import UsageEvent
from promptly.models.user import User
from promptly.skill_opt.data.models import SkillOptProject


async def platform_engagement(db: AsyncSession, days: int) -> AnalyticsResponse:
    now = datetime.now(UTC)
    cutoff = now - timedelta(days=days)
    cutoff_90d = now - timedelta(days=90)

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
    dau_data = fill_days(cutoff, days, dau_map)

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

    adoption_actions: dict[str, str | list[str] | None] = {
        "optimizer": "optimize",
        "domain": ["domain_pdo", "domain_gepa"],
        "bridge": "bridge",
        "skillopt": None,
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
        fa_data = fill_days(cutoff, days, fa_map)
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
                data=fill_days(cutoff, days, opt_map),
                chart_type="line",
            ),
            AnalyticsSeries(
                key="feature_calls_per_day",
                label="Total Feature Calls per Day",
                total=float(sum(calls_map.values())),
                time_range=f"Last {days} Days",
                data=fill_days(cutoff, days, calls_map),
                chart_type="bar",
            ),
            AnalyticsSeries(
                key="sessions_per_day",
                label="Sessions Created per Day",
                total=float(sum(sess_map.values())),
                time_range=f"Last {days} Days",
                data=fill_days(cutoff, days, sess_map),
                chart_type="bar",
            ),
            AnalyticsSeries(
                key="tokens_per_day",
                label="Tokens Consumed per Day",
                total=float(sum(tok_map.values())),
                time_range=f"Last {days} Days",
                data=fill_days(cutoff, days, tok_map),
                chart_type="line",
            ),
            AnalyticsSeries(
                key="signups_per_day",
                label="New Signups per Day",
                total=float(sum(signup_map.values())),
                time_range=f"Last {days} Days",
                data=fill_days(cutoff, days, signup_map),
                chart_type="bar",
            ),
            AnalyticsSeries(
                key="credits_per_day",
                label="Credits Consumed per Day",
                total=float(total_credits),
                time_range=f"Last {days} Days",
                data=fill_days(cutoff, days, cred_map),
                chart_type="line",
            ),
            *feat_series,
        ],
    )


async def platform_logins(db: AsyncSession, days: int) -> AnalyticsResponse:
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
