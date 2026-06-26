from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import Date as SqlDate
from sqlalchemy import cast, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from promptly.admin.api.schemas import AnalyticsPoint, AnalyticsResponse, AnalyticsSeries
from promptly.admin.services.analytics.helpers import fill_days
from promptly.admin.services.sentry import fetch_sentry_stats
from promptly.models.api_request_log import ApiRequestLog
from promptly.models.message import Message
from promptly.models.session import ChatSession
from promptly.models.usage_event import UsageEvent
from promptly.prompt_bridge.data.models import TransferJob, TransferJobStatus


async def developer_metrics(db: AsyncSession, days: int) -> AnalyticsResponse:  # noqa: PLR0912, PLR0915
    now = datetime.now(UTC)
    cutoff = (now - timedelta(days=days)).replace(hour=0, minute=0, second=0, microsecond=0)

    # ── HTTP request metrics ──────────────────────────────────────────────────

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

    # Top failing endpoints (user-facing only)
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

    # Per-endpoint latency (top 10 by volume, user-facing only)
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

    # ── Sentry error stats ────────────────────────────────────────────────────

    sentry = await fetch_sentry_stats(days)

    sentry_daily_map: dict[str, int | float] = {}
    for row in sentry.get("error_events_daily", []):
        d = str(datetime.fromtimestamp(int(row["ts"]), tz=UTC).date())
        sentry_daily_map[d] = int(row["count"])

    sentry_issues_data = [
        AnalyticsPoint(date=str(issue["title"])[:60], value=float(issue["count"]))
        for issue in sentry.get("top_issues", [])
    ]

    sentry_accepted_map: dict[str, int | float] = {
        k: float(v) for k, v in sentry.get("accepted_daily", {}).items()
    }
    sentry_discarded_map: dict[str, int | float] = {
        k: float(v) for k, v in sentry.get("discarded_daily", {}).items()
    }
    sentry_filtered_map: dict[str, int | float] = {
        k: float(v) for k, v in sentry.get("filtered_daily", {}).items()
    }
    sentry_crash_free_map: dict[str, int | float] = {
        k: float(v) for k, v in sentry.get("crash_free_daily", {}).items()
    }
    sentry_session_health_data = [
        AnalyticsPoint(date=status, value=float(count))
        for status, count in sentry.get("session_totals", {}).items()
        if int(count) > 0
    ]
    sentry_level_data = [
        AnalyticsPoint(date=lvl, value=float(count))
        for lvl, count in sentry.get("issue_level_breakdown", {}).items()
    ]

    # ── Bridge pipeline statics ───────────────────────────────────────────────

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

    # ── Optimizer pipeline statics ────────────────────────────────────────────

    total_opt_sessions: int = (
        await db.execute(select(func.count()).select_from(ChatSession))
    ).scalar_one()

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

    bridge_success_rate = round(completed_bridge / max(1, total_bridge_jobs) * 100, 1)
    bridge_failure_rate = round(failed_bridge / max(1, total_bridge_jobs) * 100, 1)
    bridge_reuse_rate = round(reused_bridge / max(1, total_bridge_jobs) * 100, 1)
    opt_completion_rate = round(
        (total_opt_sessions - incomplete_sessions) / max(1, total_opt_sessions) * 100, 1
    )

    # ── Time-series ───────────────────────────────────────────────────────────

    bridge_all_rows = (
        await db.execute(
            select(cast(TransferJob.created_at, SqlDate).label("day"), func.count().label("cnt"))
            .where(TransferJob.created_at >= cutoff)
            .group_by(cast(TransferJob.created_at, SqlDate))
            .order_by(cast(TransferJob.created_at, SqlDate))
        )
    ).fetchall()
    bridge_all_map: dict[str, int | float] = {str(r.day): r.cnt for r in bridge_all_rows}

    bridge_ok_rows = (
        await db.execute(
            select(cast(TransferJob.created_at, SqlDate).label("day"), func.count().label("cnt"))
            .where(
                TransferJob.created_at >= cutoff,
                TransferJob.status == TransferJobStatus.completed,
            )
            .group_by(cast(TransferJob.created_at, SqlDate))
            .order_by(cast(TransferJob.created_at, SqlDate))
        )
    ).fetchall()
    bridge_ok_map: dict[str, int | float] = {str(r.day): r.cnt for r in bridge_ok_rows}

    bridge_fail_rows = (
        await db.execute(
            select(cast(TransferJob.created_at, SqlDate).label("day"), func.count().label("cnt"))
            .where(TransferJob.created_at >= cutoff, TransferJob.status == TransferJobStatus.failed)
            .group_by(cast(TransferJob.created_at, SqlDate))
            .order_by(cast(TransferJob.created_at, SqlDate))
        )
    ).fetchall()
    bridge_fail_map: dict[str, int | float] = {str(r.day): r.cnt for r in bridge_fail_rows}

    opt_sess_rows = (
        await db.execute(
            select(cast(ChatSession.created_at, SqlDate).label("day"), func.count().label("cnt"))
            .where(ChatSession.created_at >= cutoff)
            .group_by(cast(ChatSession.created_at, SqlDate))
            .order_by(cast(ChatSession.created_at, SqlDate))
        )
    ).fetchall()
    opt_sess_map: dict[str, int | float] = {str(r.day): r.cnt for r in opt_sess_rows}

    asst_msg2 = aliased(Message)
    inc_rows = (
        await db.execute(
            select(cast(ChatSession.created_at, SqlDate).label("day"), func.count().label("cnt"))
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

    # ── Categorical distributions ─────────────────────────────────────────────

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

    return AnalyticsResponse(
        view="developer_metrics",
        generated_at=now.isoformat(),
        statics={
            "http_total_requests_30d": http_total_30d,
            "http_error_count_30d": http_error_30d,
            "http_5xx_count_30d": http_5xx_30d,
            "http_error_rate_pct": round(http_error_30d / max(1, http_total_30d) * 100, 2),
            "http_p95_latency_ms": p95_latency_ms,
            "sentry_total_errors": sentry.get("total_errors", -1),
            "sentry_unresolved_issues": sentry.get("unresolved_issue_count", -1),
            "sentry_crash_free_rate": sentry.get("crash_free_rate", -1),
            "sentry_total_sessions": sentry.get("total_sessions", -1),
            "sentry_healthy_sessions": sentry.get("healthy_sessions", -1),
            "sentry_crashed_sessions": sentry.get("crashed_sessions", -1),
            "sentry_accepted_total": sentry.get("accepted_total", -1),
            "sentry_discarded_total": sentry.get("discarded_total", -1),
            "sentry_filtered_total": sentry.get("filtered_total", -1),
            "total_bridge_jobs": total_bridge_jobs,
            "bridge_failed_all_time": failed_bridge,
            "bridge_success_rate_pct": bridge_success_rate,
            "bridge_failure_rate_pct": bridge_failure_rate,
            "bridge_reuse_rate_pct": bridge_reuse_rate,
            "bridge_queue_depth": queue_depth,
            "total_optimizer_sessions": total_opt_sessions,
            "optimizer_incomplete_sessions": incomplete_sessions,
            "optimizer_completion_rate_pct": opt_completion_rate,
        },
        series=[
            AnalyticsSeries(
                key="dev_http_requests_daily",
                label="HTTP Requests / Day",
                total=float(http_total_30d),
                time_range=f"Last {days} Days",
                data=fill_days(cutoff, days, http_req_map),
                chart_type="line",
                color="#06b6d4",
            ),
            AnalyticsSeries(
                key="dev_http_errors_daily",
                label="HTTP Errors / Day (4xx + 5xx)",
                total=float(http_error_30d),
                time_range=f"Last {days} Days",
                data=fill_days(cutoff, days, http_err_map),
                chart_type="bar",
                color="#f43f5e",
            ),
            AnalyticsSeries(
                key="dev_http_5xx_daily",
                label="Server Errors / Day (5xx)",
                total=float(http_5xx_30d),
                time_range=f"Last {days} Days",
                data=fill_days(cutoff, days, http_5xx_map),
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
            AnalyticsSeries(
                key="dev_sentry_errors_daily",
                label="Sentry Error Events / Day",
                total=float(sentry.get("total_errors", 0)),
                time_range=f"Last {days} Days",
                data=fill_days(cutoff, days, sentry_daily_map),
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
                data=fill_days(cutoff, days, sentry_accepted_map),
                chart_type="line",
                color="#10b981",
            ),
            AnalyticsSeries(
                key="dev_sentry_discarded_daily",
                label="Discarded Events / Day",
                total=float(sentry.get("discarded_total", 0)),
                time_range=f"Last {days} Days",
                data=fill_days(cutoff, days, sentry_discarded_map),
                chart_type="bar",
                color="#f59e0b",
            ),
            AnalyticsSeries(
                key="dev_sentry_filtered_daily",
                label="Filtered Events / Day",
                total=float(sentry.get("filtered_total", 0)),
                time_range=f"Last {days} Days",
                data=fill_days(cutoff, days, sentry_filtered_map),
                chart_type="bar",
                color="#6366f1",
            ),
            AnalyticsSeries(
                key="dev_sentry_crash_free_daily",
                label="Crash-Free Session Rate",
                total=float(sentry.get("crash_free_rate", 0)),
                time_range=f"Last {days} Days",
                data=fill_days(cutoff, days, sentry_crash_free_map),
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
            AnalyticsSeries(
                key="dev_bridge_jobs_daily",
                label="Bridge Jobs / Day",
                total=float(sum(bridge_all_map.values())),
                time_range=f"Last {days} Days",
                data=fill_days(cutoff, days, bridge_all_map),
                chart_type="line",
                color="#8b5cf6",
            ),
            AnalyticsSeries(
                key="dev_bridge_completed_daily",
                label="Completed Bridge Jobs / Day",
                total=float(sum(bridge_ok_map.values())),
                time_range=f"Last {days} Days",
                data=fill_days(cutoff, days, bridge_ok_map),
                chart_type="bar",
                color="#10b981",
            ),
            AnalyticsSeries(
                key="dev_bridge_failed_daily",
                label="Failed Bridge Jobs / Day",
                total=float(sum(bridge_fail_map.values())),
                time_range=f"Last {days} Days",
                data=fill_days(cutoff, days, bridge_fail_map),
                chart_type="bar",
                color="#f43f5e",
            ),
            AnalyticsSeries(
                key="dev_optimizer_sessions_daily",
                label="Optimizer Sessions / Day",
                total=float(sum(opt_sess_map.values())),
                time_range=f"Last {days} Days",
                data=fill_days(cutoff, days, opt_sess_map),
                chart_type="line",
                color="var(--primary)",
            ),
            AnalyticsSeries(
                key="dev_incomplete_sessions_daily",
                label="Incomplete Optimizer Sessions / Day",
                total=float(sum(incomplete_map.values())),
                time_range=f"Last {days} Days",
                data=fill_days(cutoff, days, incomplete_map),
                chart_type="bar",
                color="#f43f5e",
            ),
            AnalyticsSeries(
                key="dev_optimize_events_daily",
                label="Optimize API Calls / Day",
                total=float(sum(opt_evt_map.values())),
                time_range=f"Last {days} Days",
                data=fill_days(cutoff, days, opt_evt_map),
                chart_type="bar",
                color="var(--primary)",
            ),
            AnalyticsSeries(
                key="dev_health_score_daily",
                label="Health Score API Calls / Day",
                total=float(sum(hs_evt_map.values())),
                time_range=f"Last {days} Days",
                data=fill_days(cutoff, days, hs_evt_map),
                chart_type="bar",
                color="#06b6d4",
            ),
            AnalyticsSeries(
                key="dev_advisory_daily",
                label="Advisory API Calls / Day",
                total=float(sum(adv_evt_map.values())),
                time_range=f"Last {days} Days",
                data=fill_days(cutoff, days, adv_evt_map),
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
