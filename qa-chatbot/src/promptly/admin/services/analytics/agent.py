from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import Date as SqlDate
from sqlalchemy import case, cast, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from promptly.admin.api.schemas import AnalyticsPoint, AnalyticsResponse, AnalyticsSeries
from promptly.admin.services.analytics.helpers import fill_days
from promptly.admin.services.openrouter import fetch_or_model_pricing, live_cost_per_token
from promptly.models.message import Message
from promptly.models.session import ChatSession
from promptly.models.usage_event import UsageEvent
from promptly.prompt_bridge.data.models import TransferJob
from promptly.skill_opt.data.models import SkillOptProject


async def agent_optimizer(db: AsyncSession, days: int) -> AnalyticsResponse:
    now = datetime.now(UTC)
    cutoff = now - timedelta(days=days)

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

    status_rows = (
        await db.execute(
            select(cast(ChatSession.created_at, SqlDate).label("day"), func.count().label("cnt"))
            .where(ChatSession.created_at >= cutoff)
            .group_by(cast(ChatSession.created_at, SqlDate))
            .order_by(cast(ChatSession.created_at, SqlDate))
        )
    ).fetchall()
    sessions_map = {str(r.day): r.cnt for r in status_rows}

    cred_data = [
        AnalyticsPoint(date=p.date, value=p.value * 10) for p in fill_days(cutoff, days, runs_map)
    ]

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
                data=fill_days(cutoff, days, runs_map),
                chart_type="line",
            ),
            AnalyticsSeries(
                key="optimizer_tokens",
                label="Tokens per Day",
                total=float(total_tokens),
                time_range=f"Last {days} Days",
                data=fill_days(cutoff, days, tok_map),
                chart_type="line",
            ),
            AnalyticsSeries(
                key="optimizer_unique_users",
                label="Unique Users per Day",
                total=float(sum(uq_map.values())),
                time_range=f"Last {days} Days",
                data=fill_days(cutoff, days, uq_map),
                chart_type="line",
            ),
            AnalyticsSeries(
                key="optimizer_sessions",
                label="Sessions Created per Day",
                total=float(sum(sessions_map.values())),
                time_range=f"Last {days} Days",
                data=fill_days(cutoff, days, sessions_map),
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


async def agent_skillopt(db: AsyncSession, days: int) -> AnalyticsResponse:
    now = datetime.now(UTC)
    cutoff = now - timedelta(days=days)

    runs_rows = (
        await db.execute(
            select(
                cast(SkillOptProject.created_at, SqlDate).label("day"),
                func.count().label("cnt"),
            )
            .where(SkillOptProject.status == "completed", SkillOptProject.created_at >= cutoff)
            .group_by(cast(SkillOptProject.created_at, SqlDate))
            .order_by(cast(SkillOptProject.created_at, SqlDate))
        )
    ).fetchall()
    runs_map = {str(r.day): r.cnt for r in runs_rows}

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
                data=fill_days(cutoff, days, runs_map),
                chart_type="line",
            ),
            AnalyticsSeries(
                key="so_improvement",
                label="Avg Score Improvement per Day",
                total=round(overall_improvement, 3),
                time_range=f"Last {days} Days",
                data=fill_days(cutoff, days, score_map),
                chart_type="line",
            ),
            AnalyticsSeries(
                key="so_score_test",
                label="Avg Test Score per Day",
                total=float(sum(st_map.values()) / max(1, len(st_map))),
                time_range=f"Last {days} Days",
                data=fill_days(cutoff, days, st_map),
                chart_type="line",
            ),
            AnalyticsSeries(
                key="so_edits_accepted",
                label="Edits Accepted per Day",
                total=float(sum(edits_map.values())),
                time_range=f"Last {days} Days",
                data=fill_days(cutoff, days, edits_map),
                chart_type="bar",
            ),
            AnalyticsSeries(
                key="so_acceptance_ratio",
                label="Edit Acceptance Ratio",
                total=round(sum(ratio_map.values()) / max(1, len(ratio_map)), 2),
                time_range=f"Last {days} Days",
                data=fill_days(cutoff, days, ratio_map),
                chart_type="line",
            ),
            AnalyticsSeries(
                key="so_unique_users",
                label="Unique Users per Day",
                total=float(sum(uq_map.values())),
                time_range=f"Last {days} Days",
                data=fill_days(cutoff, days, uq_map),
                chart_type="line",
            ),
            *[
                AnalyticsSeries(
                    key=f"so_tier_{tier}",
                    label=f"{tier.title()} Tier",
                    total=float(sum(tier_maps[tier].values())),
                    time_range=f"Last {days} Days",
                    data=fill_days(cutoff, days, tier_maps[tier]),
                    chart_type="bar",
                    color=tier_colors[tier],
                )
                for tier in ("low", "medium", "high")
            ],
        ],
    )


async def agent_domain(db: AsyncSession, days: int) -> AnalyticsResponse:
    now = datetime.now(UTC)
    cutoff = now - timedelta(days=days)

    domain_actions = ["domain_pdo", "domain_gepa"]
    augment_action = "domain_gepa_augment"

    runs_rows = (
        await db.execute(
            select(cast(UsageEvent.created_at, SqlDate).label("day"), func.count().label("cnt"))
            .where(UsageEvent.action.in_(domain_actions), UsageEvent.created_at >= cutoff)
            .group_by(cast(UsageEvent.created_at, SqlDate))
            .order_by(cast(UsageEvent.created_at, SqlDate))
        )
    ).fetchall()
    runs_map = {str(r.day): r.cnt for r in runs_rows}

    aug_rows = (
        await db.execute(
            select(cast(UsageEvent.created_at, SqlDate).label("day"), func.count().label("cnt"))
            .where(UsageEvent.action == augment_action, UsageEvent.created_at >= cutoff)
            .group_by(cast(UsageEvent.created_at, SqlDate))
            .order_by(cast(UsageEvent.created_at, SqlDate))
        )
    ).fetchall()
    aug_map = {str(r.day): r.cnt for r in aug_rows}

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
                data=fill_days(cutoff, days, runs_map),
                chart_type="line",
            ),
            AnalyticsSeries(
                key="domain_augment",
                label="Augmentation Runs per Day",
                total=float(sum(aug_map.values())),
                time_range=f"Last {days} Days",
                data=fill_days(cutoff, days, aug_map),
                chart_type="bar",
            ),
            AnalyticsSeries(
                key="domain_pdo",
                label="PDO Runs",
                total=float(sum(pdo_map.values())),
                time_range=f"Last {days} Days",
                data=fill_days(cutoff, days, pdo_map),
                chart_type="bar",
                color="#06b6d4",
            ),
            AnalyticsSeries(
                key="domain_gepa",
                label="GEPA Runs",
                total=float(sum(gepa_map.values())),
                time_range=f"Last {days} Days",
                data=fill_days(cutoff, days, gepa_map),
                chart_type="bar",
                color="#8b5cf6",
            ),
            AnalyticsSeries(
                key="domain_tokens",
                label="Tokens per Day",
                total=float(sum(tok_map.values())),
                time_range=f"Last {days} Days",
                data=fill_days(cutoff, days, tok_map),
                chart_type="line",
            ),
            AnalyticsSeries(
                key="domain_unique_users",
                label="Unique Users per Day",
                total=float(sum(uq_map.values())),
                time_range=f"Last {days} Days",
                data=fill_days(cutoff, days, uq_map),
                chart_type="line",
            ),
        ],
    )


async def agent_bridge(db: AsyncSession, days: int) -> AnalyticsResponse:
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

    live_pricing = await fetch_or_model_pricing()

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
            value=round(float(r.tokens) * live_cost_per_token(r.model, live_pricing), 6),
        )
        for r in src_rows
    ]

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
            value=round(float(r.tokens) * live_cost_per_token(r.model, live_pricing), 6),
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
                data=fill_days(cutoff, days, runs_map),
                chart_type="line",
            ),
            AnalyticsSeries(
                key="bridge_tokens",
                label="Tokens per Day",
                total=float(sum(tok_map.values())),
                time_range=f"Last {days} Days",
                data=fill_days(cutoff, days, tok_map),
                chart_type="line",
            ),
            AnalyticsSeries(
                key="bridge_unique_users",
                label="Unique Users per Day",
                total=float(sum(uq_map.values())),
                time_range=f"Last {days} Days",
                data=fill_days(cutoff, days, uq_map),
                chart_type="line",
            ),
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
