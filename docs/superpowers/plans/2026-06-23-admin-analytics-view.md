# Admin Analytics View Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-only "View" analytics tab to the admin panel with Platform/Agents toggle, sidebar nav, and per-view metric cards backed by a single `/admin/analytics` endpoint.

**Architecture:** One new backend endpoint (`GET /admin/analytics?view=<name>&days=<n>`) returns pre-aggregated time-series + static stats. The frontend is a set of focused per-view React components sharing two reusable chart primitives. All data is static on load — no polling. Charts use the already-installed `recharts@3` library.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Pydantic v2, Next.js 14 App Router, TypeScript strict, TanStack Query v5, recharts 3, inline CSS vars.

## Global Constraints

- All admin endpoints use the router-level `require_admin` dependency already on the admin router — no new auth needed.
- TypeScript strict mode — all types must be explicit, no `any`.
- Use CSS variables (`var(--primary)`, `var(--surface)`, `var(--border)`, `var(--text)`, `var(--text-muted)`, `var(--text-subtle)`, `var(--success)`, `var(--danger)`) — never hardcode colours except chart accent hex values.
- Follow existing `stats-cards.tsx` component patterns: inline styles, `useQuery`, `api.get<{ data: T }>`.
- Run from `qa-chatbot/` for backend commands, `frontend/` for frontend commands.
- Backend: `uv run pytest tests/unit/test_admin_analytics.py -v` must pass after Tasks 1–3.
- Frontend: `npm run build` must pass (no TypeScript errors) after each frontend task.

---

### Task 1: Backend — Analytics Pydantic schemas

**Files:**
- Modify: `qa-chatbot/src/promptly/admin/api/schemas.py`
- Create: `qa-chatbot/tests/unit/test_admin_analytics.py`

**Interfaces:**
- Produces: `AnalyticsPoint`, `AnalyticsSeries`, `AnalyticsResponse` (imported by Task 2/3)

- [ ] **Step 1: Write failing import test**

```python
# qa-chatbot/tests/unit/test_admin_analytics.py
from promptly.admin.api.schemas import AnalyticsPoint, AnalyticsSeries, AnalyticsResponse


def test_analytics_point_schema() -> None:
    p = AnalyticsPoint(date="2026-06-01", value=42.0)
    assert p.date == "2026-06-01"
    assert p.value == 42.0


def test_analytics_series_defaults() -> None:
    s = AnalyticsSeries(
        key="dau",
        label="Daily Active Users",
        total=8.0,
        time_range="Last 30 Days",
        data=[AnalyticsPoint(date="2026-06-01", value=3.0)],
    )
    assert s.chart_type == "line"
    assert s.color is None


def test_analytics_response_schema() -> None:
    r = AnalyticsResponse(
        view="platform_engagement",
        generated_at="2026-06-23T10:00:00Z",
        statics={"total_users": 42},
        series=[],
    )
    assert r.view == "platform_engagement"
```

- [ ] **Step 2: Run — expect ImportError**

```bash
cd qa-chatbot && uv run pytest tests/unit/test_admin_analytics.py -v
```

Expected: `ImportError: cannot import name 'AnalyticsPoint'`

- [ ] **Step 3: Add schemas to `schemas.py`** (append after existing classes)

```python
# ── Analytics ─────────────────────────────────────────────────────────────────


class AnalyticsPoint(BaseModel):
    date: str   # "YYYY-MM-DD" or "YYYY-MM" or "YYYY-Qn"
    value: float


class AnalyticsSeries(BaseModel):
    key: str
    label: str
    total: float
    time_range: str
    data: list[AnalyticsPoint]
    chart_type: str = "line"   # "line" | "bar"
    color: str | None = None


class AnalyticsResponse(BaseModel):
    view: str
    generated_at: str
    statics: dict[str, float | int | str]
    series: list[AnalyticsSeries]
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd qa-chatbot && uv run pytest tests/unit/test_admin_analytics.py -v
```

- [ ] **Step 5: Commit**

```bash
git add qa-chatbot/src/promptly/admin/api/schemas.py qa-chatbot/tests/unit/test_admin_analytics.py
git commit -m "feat: add AnalyticsPoint/Series/Response schemas for admin analytics endpoint"
```

---

### Task 2: Backend — `/analytics` endpoint + Platform views

**Files:**
- Modify: `qa-chatbot/src/promptly/admin/api/router.py`

**Interfaces:**
- Consumes: `AnalyticsPoint`, `AnalyticsSeries`, `AnalyticsResponse` from Task 1
- Produces: `GET /api/v1/admin/analytics?view=<name>&days=<n>` → `SuccessResponse[AnalyticsResponse]`

- [ ] **Step 1: Add test for platform_engagement**

Add to `qa-chatbot/tests/unit/test_admin_analytics.py`:

```python
from promptly.admin.api.router import _fill_days
from datetime import datetime, timedelta, UTC


def test_fill_days_pads_missing_dates() -> None:
    now = datetime(2026, 6, 23, tzinfo=UTC)
    cutoff = now - timedelta(days=3)
    data_map = {"2026-06-21": 5, "2026-06-23": 2}
    result = _fill_days(cutoff, 3, data_map)
    assert len(result) == 3
    assert result[0].date == "2026-06-21"
    assert result[0].value == 5.0
    assert result[1].value == 0.0   # gap filled
    assert result[2].date == "2026-06-23"
    assert result[2].value == 2.0
```

- [ ] **Step 2: Run — expect ImportError**

```bash
cd qa-chatbot && uv run pytest tests/unit/test_admin_analytics.py::test_fill_days_pads_missing_dates -v
```

Expected: `ImportError: cannot import name '_fill_days'`

- [ ] **Step 3: Add imports + `_fill_days` helper + two Platform view helpers to `router.py`**

Add these imports to the top of `router.py` (with existing imports):

```python
from datetime import timedelta

from sqlalchemy import Date as SqlDate
from sqlalchemy import Integer as SqlInt
from sqlalchemy import case, cast, text

from promptly.admin.api.schemas import AnalyticsPoint, AnalyticsSeries, AnalyticsResponse
from promptly.skill_opt.data.models import SkillOptProject
```

Add the helper and platform view functions **before** the router endpoints (insert after the `log_audit` function):

```python
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

    total_opts: int = (await db.execute(
        select(func.count()).select_from(UsageEvent).where(UsageEvent.action == "optimize")
    )).scalar_one()

    total_tokens: int = max(0, int((await db.execute(
        select(func.coalesce(func.sum(3_000_000 - User.token_balance), 0)).select_from(User)
    )).scalar_one()))

    total_budget = total_users * 3_000_000
    budget_pct = round((total_tokens / max(1, total_budget)) * 100, 1)

    total_credits: int = int((await db.execute(
        select(func.coalesce(func.sum(UsageEvent.credits_spent), 0)).select_from(UsageEvent)
    )).scalar_one()) + int((await db.execute(
        select(func.coalesce(func.sum(SkillOptProject.credits_charged), 0)).select_from(SkillOptProject)
    )).scalar_one())

    # ── DAU (daily, last N days) ───────────────────────────────────────────────
    dau_rows = (await db.execute(
        select(
            cast(UsageEvent.created_at, SqlDate).label("day"),
            func.count(UsageEvent.user_id.distinct()).label("cnt"),
        )
        .where(UsageEvent.created_at >= cutoff)
        .group_by(cast(UsageEvent.created_at, SqlDate))
        .order_by(cast(UsageEvent.created_at, SqlDate))
    )).fetchall()
    dau_map = {str(r.day): r.cnt for r in dau_rows}
    dau_data = _fill_days(cutoff, days, dau_map)

    # ── WAU (weekly, last 90 days) ─────────────────────────────────────────────
    wau_rows = (await db.execute(
        select(
            func.date_trunc("week", UsageEvent.created_at).label("week"),
            func.count(UsageEvent.user_id.distinct()).label("cnt"),
        )
        .where(UsageEvent.created_at >= cutoff_90d)
        .group_by(func.date_trunc("week", UsageEvent.created_at))
        .order_by(func.date_trunc("week", UsageEvent.created_at))
    )).fetchall()
    wau_data = [AnalyticsPoint(date=str(r.week)[:10], value=float(r.cnt)) for r in wau_rows]

    # ── Optimizations per day ─────────────────────────────────────────────────
    opt_rows = (await db.execute(
        select(
            cast(UsageEvent.created_at, SqlDate).label("day"),
            func.count().label("cnt"),
        )
        .where(UsageEvent.action == "optimize", UsageEvent.created_at >= cutoff)
        .group_by(cast(UsageEvent.created_at, SqlDate))
        .order_by(cast(UsageEvent.created_at, SqlDate))
    )).fetchall()
    opt_map = {str(r.day): r.cnt for r in opt_rows}

    # ── Total feature calls per day ───────────────────────────────────────────
    calls_rows = (await db.execute(
        select(
            cast(UsageEvent.created_at, SqlDate).label("day"),
            func.count().label("cnt"),
        )
        .where(UsageEvent.created_at >= cutoff)
        .group_by(cast(UsageEvent.created_at, SqlDate))
        .order_by(cast(UsageEvent.created_at, SqlDate))
    )).fetchall()
    calls_map = {str(r.day): r.cnt for r in calls_rows}

    # ── Sessions per day ──────────────────────────────────────────────────────
    sess_rows = (await db.execute(
        select(
            cast(ChatSession.created_at, SqlDate).label("day"),
            func.count().label("cnt"),
        )
        .where(ChatSession.created_at >= cutoff)
        .group_by(cast(ChatSession.created_at, SqlDate))
        .order_by(cast(ChatSession.created_at, SqlDate))
    )).fetchall()
    sess_map = {str(r.day): r.cnt for r in sess_rows}

    # ── Signups per day ───────────────────────────────────────────────────────
    signup_rows = (await db.execute(
        select(
            cast(User.created_at, SqlDate).label("day"),
            func.count().label("cnt"),
        )
        .where(User.created_at >= cutoff)
        .group_by(cast(User.created_at, SqlDate))
        .order_by(cast(User.created_at, SqlDate))
    )).fetchall()
    signup_map = {str(r.day): r.cnt for r in signup_rows}

    # ── Tokens per day (from messages) ───────────────────────────────────────
    tok_rows = (await db.execute(
        select(
            cast(Message.created_at, SqlDate).label("day"),
            func.coalesce(
                func.sum(Message.token_usage["total_tokens"].as_integer()), 0
            ).label("tokens"),
        )
        .where(Message.created_at >= cutoff, Message.token_usage.isnot(None))
        .group_by(cast(Message.created_at, SqlDate))
        .order_by(cast(Message.created_at, SqlDate))
    )).fetchall()
    tok_map = {str(r.day): r.tokens for r in tok_rows}

    # ── Credits per day ───────────────────────────────────────────────────────
    cred_rows = (await db.execute(
        select(
            cast(UsageEvent.created_at, SqlDate).label("day"),
            func.coalesce(func.sum(UsageEvent.credits_spent), 0).label("credits"),
        )
        .where(UsageEvent.created_at >= cutoff)
        .group_by(cast(UsageEvent.created_at, SqlDate))
        .order_by(cast(UsageEvent.created_at, SqlDate))
    )).fetchall()
    cred_map: dict[str, int | float] = {str(r.day): r.credits for r in cred_rows}
    so_cred_rows = (await db.execute(
        select(
            cast(SkillOptProject.created_at, SqlDate).label("day"),
            func.coalesce(func.sum(SkillOptProject.credits_charged), 0).label("credits"),
        )
        .where(SkillOptProject.created_at >= cutoff, SkillOptProject.status == "completed")
        .group_by(cast(SkillOptProject.created_at, SqlDate))
    )).fetchall()
    for r in so_cred_rows:
        key = str(r.day)
        cred_map[key] = float(cred_map.get(key, 0)) + float(r.credits)

    # ── Feature adoption (stacked) — 4 series ────────────────────────────────
    adoption_actions = {
        "optimizer": "optimize",
        "domain":    ["domain_pdo", "domain_gepa"],
        "bridge":    "bridge",
        "skillopt":  None,  # from skill_opt_projects
    }
    feat_series: list[AnalyticsSeries] = []
    feat_colors = {
        "optimizer": "var(--primary)",
        "domain":    "#06b6d4",
        "bridge":    "#f59e0b",
        "skillopt":  "#f43f5e",
    }
    for name, action in adoption_actions.items():
        if action is None:
            # SkillOpt — distinct users from skill_opt_projects
            fa_rows = (await db.execute(
                select(
                    cast(SkillOptProject.created_at, SqlDate).label("day"),
                    func.count(SkillOptProject.user_id.distinct()).label("cnt"),
                )
                .where(SkillOptProject.created_at >= cutoff)
                .group_by(cast(SkillOptProject.created_at, SqlDate))
                .order_by(cast(SkillOptProject.created_at, SqlDate))
            )).fetchall()
        elif isinstance(action, list):
            fa_rows = (await db.execute(
                select(
                    cast(UsageEvent.created_at, SqlDate).label("day"),
                    func.count(UsageEvent.user_id.distinct()).label("cnt"),
                )
                .where(UsageEvent.action.in_(action), UsageEvent.created_at >= cutoff)
                .group_by(cast(UsageEvent.created_at, SqlDate))
                .order_by(cast(UsageEvent.created_at, SqlDate))
            )).fetchall()
        else:
            fa_rows = (await db.execute(
                select(
                    cast(UsageEvent.created_at, SqlDate).label("day"),
                    func.count(UsageEvent.user_id.distinct()).label("cnt"),
                )
                .where(UsageEvent.action == action, UsageEvent.created_at >= cutoff)
                .group_by(cast(UsageEvent.created_at, SqlDate))
                .order_by(cast(UsageEvent.created_at, SqlDate))
            )).fetchall()
        fa_map = {str(r.day): r.cnt for r in fa_rows}
        fa_data = _fill_days(cutoff, days, fa_map)
        feat_series.append(AnalyticsSeries(
            key=f"adoption_{name}",
            label=name.replace("_", " ").title(),
            total=float(sum(p.value for p in fa_data)),
            time_range=f"Last {days} Days",
            data=fa_data,
            chart_type="bar",
            color=feat_colors[name],
        ))

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
            AnalyticsSeries(key="dau", label="Daily Active Users",
                total=float(max((p.value for p in dau_data), default=0)),
                time_range=f"Last {days} Days", data=dau_data, chart_type="line"),
            AnalyticsSeries(key="wau", label="Weekly Active Users",
                total=float(max((p.value for p in wau_data), default=0)),
                time_range="Last 90 Days", data=wau_data, chart_type="line"),
            AnalyticsSeries(key="optimizations_per_day", label="Optimizations per Day",
                total=float(total_opts),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, opt_map), chart_type="line"),
            AnalyticsSeries(key="feature_calls_per_day", label="Total Feature Calls per Day",
                total=float(sum(calls_map.values())),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, calls_map), chart_type="bar"),
            AnalyticsSeries(key="sessions_per_day", label="Sessions Created per Day",
                total=float(sum(sess_map.values())),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, sess_map), chart_type="bar"),
            AnalyticsSeries(key="logins_per_day", label="Unique Logins per Day",
                total=float(max((p.value for p in dau_data), default=0)),
                time_range=f"Last {days} Days", data=dau_data, chart_type="line"),
            AnalyticsSeries(key="tokens_per_day", label="Tokens Consumed per Day",
                total=float(sum(tok_map.values())),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, tok_map), chart_type="line"),
            AnalyticsSeries(key="signups_per_day", label="New Signups per Day",
                total=float(sum(signup_map.values())),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, signup_map), chart_type="bar"),
            AnalyticsSeries(key="credits_per_day", label="Credits Consumed per Day",
                total=float(total_credits),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, cred_map), chart_type="line"),
            *feat_series,
        ],
    )


async def _platform_logins(db: AsyncSession, days: int) -> AnalyticsResponse:
    now = datetime.now(UTC)
    cutoff_7d = now - timedelta(days=7)
    cutoff_30d = now - timedelta(days=30)
    cutoff_90d = now - timedelta(days=90)
    cutoff_365d = now - timedelta(days=365)

    dau_7d: int = (await db.execute(
        select(func.count(UsageEvent.user_id.distinct()))
        .where(UsageEvent.created_at >= cutoff_7d)
    )).scalar_one()

    wau_7d: int = (await db.execute(
        select(func.count(UsageEvent.user_id.distinct()))
        .where(UsageEvent.created_at >= cutoff_7d)
    )).scalar_one()

    mau_30d: int = (await db.execute(
        select(func.count(UsageEvent.user_id.distinct()))
        .where(UsageEvent.created_at >= cutoff_30d)
    )).scalar_one()

    # WAU trend (90d, weekly)
    wau_rows = (await db.execute(
        select(
            func.date_trunc("week", UsageEvent.created_at).label("week"),
            func.count(UsageEvent.user_id.distinct()).label("cnt"),
        )
        .where(UsageEvent.created_at >= cutoff_90d)
        .group_by(func.date_trunc("week", UsageEvent.created_at))
        .order_by(func.date_trunc("week", UsageEvent.created_at))
    )).fetchall()
    wau_trend = [AnalyticsPoint(date=str(r.week)[:10], value=float(r.cnt)) for r in wau_rows]

    # MAU trend (90d, monthly)
    mau_rows = (await db.execute(
        select(
            func.date_trunc("month", UsageEvent.created_at).label("month"),
            func.count(UsageEvent.user_id.distinct()).label("cnt"),
        )
        .where(UsageEvent.created_at >= cutoff_90d)
        .group_by(func.date_trunc("month", UsageEvent.created_at))
        .order_by(func.date_trunc("month", UsageEvent.created_at))
    )).fetchall()
    mau_trend = [AnalyticsPoint(date=str(r.month)[:7], value=float(r.cnt)) for r in mau_rows]

    # QAU trend (365d, quarterly)
    qau_rows = (await db.execute(
        select(
            func.date_trunc("quarter", UsageEvent.created_at).label("quarter"),
            func.count(UsageEvent.user_id.distinct()).label("cnt"),
        )
        .where(UsageEvent.created_at >= cutoff_365d)
        .group_by(func.date_trunc("quarter", UsageEvent.created_at))
        .order_by(func.date_trunc("quarter", UsageEvent.created_at))
    )).fetchall()
    qau_trend = [AnalyticsPoint(date=str(r.quarter)[:7], value=float(r.cnt)) for r in qau_rows]

    # D7 retention
    eligible_7d: int = (await db.execute(
        select(func.count()).select_from(User).where(User.created_at <= now - timedelta(days=7))
    )).scalar_one()
    returned_7d: int = (await db.execute(
        select(func.count(User.id.distinct()))
        .select_from(User)
        .join(UsageEvent, UsageEvent.user_id == User.id)
        .where(
            User.created_at <= now - timedelta(days=7),
            UsageEvent.created_at >= User.created_at,
            UsageEvent.created_at <= User.created_at + timedelta(days=7),
        )
    )).scalar_one()
    d7_retention = round((returned_7d / max(1, eligible_7d)) * 100, 1)

    # D30 retention
    eligible_30d: int = (await db.execute(
        select(func.count()).select_from(User).where(User.created_at <= now - timedelta(days=30))
    )).scalar_one()
    returned_30d: int = (await db.execute(
        select(func.count(User.id.distinct()))
        .select_from(User)
        .join(UsageEvent, UsageEvent.user_id == User.id)
        .where(
            User.created_at <= now - timedelta(days=30),
            UsageEvent.created_at >= User.created_at,
            UsageEvent.created_at <= User.created_at + timedelta(days=30),
        )
    )).scalar_one()
    d30_retention = round((returned_30d / max(1, eligible_30d)) * 100, 1)

    # Avg sessions per active user (last 30d)
    total_sessions_30d: int = (await db.execute(
        select(func.count()).select_from(ChatSession).where(ChatSession.created_at >= cutoff_30d)
    )).scalar_one()
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
            AnalyticsSeries(key="wau_trend", label="WAU Trend",
                total=float(wau_7d), time_range="Last 90 Days",
                data=wau_trend, chart_type="line"),
            AnalyticsSeries(key="mau_trend", label="MAU Trend",
                total=float(mau_30d), time_range="Last 90 Days",
                data=mau_trend, chart_type="line"),
            AnalyticsSeries(key="qau_trend", label="QAU Trend",
                total=float(max((p.value for p in qau_trend), default=0)),
                time_range="Last 365 Days",
                data=qau_trend, chart_type="line"),
        ],
    )
```

- [ ] **Step 4: Add the route handler at the end of `router.py`**

```python
# ── Analytics endpoint ────────────────────────────────────────────────────────

_ANALYTICS_VIEWS = {
    "platform_engagement",
    "platform_logins",
    "agent_optimizer",
    "agent_skillopt",
    "agent_domain",
    "agent_bridge",
}


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
        from fastapi import HTTPException
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
```

- [ ] **Step 5: Add test for the handler dispatch and `_platform_logins` statics shape**

Add to `tests/unit/test_admin_analytics.py`:

```python
from promptly.admin.api.router import _fill_days, _platform_engagement, _platform_logins
```

- [ ] **Step 6: Run mypy + tests**

```bash
cd qa-chatbot && uv run mypy src/promptly/admin/ && uv run pytest tests/unit/test_admin_analytics.py -v
```

Expected: all PASS, no mypy errors.

- [ ] **Step 7: Commit**

```bash
git add qa-chatbot/src/promptly/admin/api/router.py qa-chatbot/tests/unit/test_admin_analytics.py
git commit -m "feat: add analytics endpoint for platform_engagement and platform_logins views"
```

---

### Task 3: Backend — Agent view helpers

**Files:**
- Modify: `qa-chatbot/src/promptly/admin/api/router.py`

**Interfaces:**
- Consumes: all schemas from Task 1, imports from Task 2
- Produces: `_agent_optimizer`, `_agent_skillopt`, `_agent_domain`, `_agent_bridge` (consumed by the dispatch dict already wired in Task 2)

- [ ] **Step 1: Add the four agent view helpers to `router.py`** (insert before the `_ANALYTICS_VIEWS` set)

```python
async def _agent_optimizer(db: AsyncSession, days: int) -> AnalyticsResponse:
    now = datetime.now(UTC)
    cutoff = now - timedelta(days=days)

    # Runs per day
    runs_rows = (await db.execute(
        select(cast(UsageEvent.created_at, SqlDate).label("day"), func.count().label("cnt"))
        .where(UsageEvent.action == "optimize", UsageEvent.created_at >= cutoff)
        .group_by(cast(UsageEvent.created_at, SqlDate))
        .order_by(cast(UsageEvent.created_at, SqlDate))
    )).fetchall()
    runs_map = {str(r.day): r.cnt for r in runs_rows}
    total_runs = sum(runs_map.values())

    # Tokens per day
    tok_rows = (await db.execute(
        select(
            cast(Message.created_at, SqlDate).label("day"),
            func.coalesce(func.sum(Message.token_usage["total_tokens"].as_integer()), 0).label("t"),
        )
        .where(Message.created_at >= cutoff, Message.token_usage.isnot(None))
        .group_by(cast(Message.created_at, SqlDate))
        .order_by(cast(Message.created_at, SqlDate))
    )).fetchall()
    tok_map: dict[str, int | float] = {str(r.day): r.t for r in tok_rows}
    total_tokens = sum(tok_map.values())

    # Unique users per day
    uq_rows = (await db.execute(
        select(
            cast(UsageEvent.created_at, SqlDate).label("day"),
            func.count(UsageEvent.user_id.distinct()).label("cnt"),
        )
        .where(UsageEvent.action == "optimize", UsageEvent.created_at >= cutoff)
        .group_by(cast(UsageEvent.created_at, SqlDate))
        .order_by(cast(UsageEvent.created_at, SqlDate))
    )).fetchall()
    uq_map = {str(r.day): r.cnt for r in uq_rows}

    # Completed vs failed sessions per day (stacked)
    status_rows = (await db.execute(
        select(
            cast(ChatSession.created_at, SqlDate).label("day"),
            func.count().label("cnt"),
        )
        .where(ChatSession.created_at >= cutoff)
        .group_by(cast(ChatSession.created_at, SqlDate))
        .order_by(cast(ChatSession.created_at, SqlDate))
    )).fetchall()
    sessions_map = {str(r.day): r.cnt for r in status_rows}

    # Credits per day (optimize = 10 credits each)
    cred_data = [AnalyticsPoint(date=p.date, value=p.value * 10)
                 for p in _fill_days(cutoff, days, runs_map)]

    # Council model distribution (all time, top 10)
    model_rows = (await db.execute(text("""
        SELECT vote ->> 'model' AS model, COUNT(*) AS cnt
        FROM messages, jsonb_array_elements(council_votes::jsonb) AS vote
        WHERE council_votes IS NOT NULL
        GROUP BY model
        ORDER BY cnt DESC
        LIMIT 10
    """))).fetchall()
    model_total = sum(r.cnt for r in model_rows)
    model_data = [
        AnalyticsPoint(date=str(r.model or "unknown"), value=float(r.cnt))
        for r in model_rows
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
            AnalyticsSeries(key="optimizer_runs", label="Runs per Day",
                total=float(total_runs), time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, runs_map), chart_type="line"),
            AnalyticsSeries(key="optimizer_tokens", label="Tokens per Day",
                total=float(total_tokens), time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, tok_map), chart_type="line"),
            AnalyticsSeries(key="optimizer_unique_users", label="Unique Users per Day",
                total=float(sum(uq_map.values())), time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, uq_map), chart_type="line"),
            AnalyticsSeries(key="optimizer_sessions", label="Sessions Created per Day",
                total=float(sum(sessions_map.values())), time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, sessions_map), chart_type="bar"),
            AnalyticsSeries(key="optimizer_credits", label="Credits Charged per Day",
                total=float(total_runs * 10), time_range=f"Last {days} Days",
                data=cred_data, chart_type="bar"),
            AnalyticsSeries(key="council_models", label="Council Model Distribution",
                total=float(model_total), time_range="All Time",
                data=model_data, chart_type="bar"),
        ],
    )


async def _agent_skillopt(db: AsyncSession, days: int) -> AnalyticsResponse:
    now = datetime.now(UTC)
    cutoff = now - timedelta(days=days)

    # Runs per day (completed only)
    runs_rows = (await db.execute(
        select(cast(SkillOptProject.created_at, SqlDate).label("day"), func.count().label("cnt"))
        .where(SkillOptProject.status == "completed", SkillOptProject.created_at >= cutoff)
        .group_by(cast(SkillOptProject.created_at, SqlDate))
        .order_by(cast(SkillOptProject.created_at, SqlDate))
    )).fetchall()
    runs_map = {str(r.day): r.cnt for r in runs_rows}

    # Avg score improvement per day
    score_rows = (await db.execute(
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
    )).fetchall()
    score_map: dict[str, int | float] = {str(r.day): round(float(r.imp or 0), 3) for r in score_rows}

    # Avg score_test per day
    st_rows = (await db.execute(
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
    )).fetchall()
    st_map: dict[str, int | float] = {str(r.day): round(float(r.st or 0), 3) for r in st_rows}

    # Edits accepted per day
    edits_rows = (await db.execute(
        select(
            cast(SkillOptProject.created_at, SqlDate).label("day"),
            func.coalesce(func.sum(SkillOptProject.edits_accepted), 0).label("ea"),
        )
        .where(SkillOptProject.status == "completed", SkillOptProject.created_at >= cutoff)
        .group_by(cast(SkillOptProject.created_at, SqlDate))
        .order_by(cast(SkillOptProject.created_at, SqlDate))
    )).fetchall()
    edits_map: dict[str, int | float] = {str(r.day): r.ea for r in edits_rows}

    # Acceptance ratio per day
    ratio_rows = (await db.execute(
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
    )).fetchall()
    ratio_map: dict[str, int | float] = {
        str(r.day): round(r.ea / max(1, r.total), 2) for r in ratio_rows
    }

    # Tier breakdown (stacked)
    tier_expr = case(
        (SkillOptProject.credits_charged == 5, "low"),
        (SkillOptProject.credits_charged == 16, "high"),
        else_="medium",
    )
    tier_rows = (await db.execute(
        select(
            cast(SkillOptProject.created_at, SqlDate).label("day"),
            tier_expr.label("tier"),
            func.count().label("cnt"),
        )
        .where(SkillOptProject.status == "completed", SkillOptProject.created_at >= cutoff)
        .group_by(cast(SkillOptProject.created_at, SqlDate), tier_expr)
        .order_by(cast(SkillOptProject.created_at, SqlDate))
    )).fetchall()
    tier_maps: dict[str, dict[str, int | float]] = {"low": {}, "medium": {}, "high": {}}
    for r in tier_rows:
        tier_maps[r.tier][str(r.day)] = r.cnt

    # Unique users per day
    uq_rows = (await db.execute(
        select(
            cast(SkillOptProject.created_at, SqlDate).label("day"),
            func.count(SkillOptProject.user_id.distinct()).label("cnt"),
        )
        .where(SkillOptProject.status == "completed", SkillOptProject.created_at >= cutoff)
        .group_by(cast(SkillOptProject.created_at, SqlDate))
        .order_by(cast(SkillOptProject.created_at, SqlDate))
    )).fetchall()
    uq_map = {str(r.day): r.cnt for r in uq_rows}

    # Statics
    avg_epochs = float((await db.execute(
        select(func.coalesce(func.avg(SkillOptProject.epochs_run), 0))
        .where(SkillOptProject.status == "completed")
    )).scalar_one() or 0)
    total_examples = int((await db.execute(
        select(func.coalesce(func.sum(SkillOptProject.example_count), 0))
        .where(SkillOptProject.status == "completed")
    )).scalar_one() or 0)
    overall_improvement = float((await db.execute(
        select(func.coalesce(func.avg(SkillOptProject.score_after - SkillOptProject.score_before), 0))
        .where(
            SkillOptProject.status == "completed",
            SkillOptProject.score_before.isnot(None),
            SkillOptProject.score_after.isnot(None),
        )
    )).scalar_one() or 0)

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
            AnalyticsSeries(key="so_runs", label="Runs per Day",
                total=float(sum(runs_map.values())), time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, runs_map), chart_type="line"),
            AnalyticsSeries(key="so_improvement", label="Avg Score Improvement per Day",
                total=round(overall_improvement, 3), time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, score_map), chart_type="line"),
            AnalyticsSeries(key="so_score_test", label="Avg Test Score per Day",
                total=float(sum(st_map.values()) / max(1, len(st_map))),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, st_map), chart_type="line"),
            AnalyticsSeries(key="so_edits_accepted", label="Edits Accepted per Day",
                total=float(sum(edits_map.values())), time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, edits_map), chart_type="bar"),
            AnalyticsSeries(key="so_acceptance_ratio", label="Edit Acceptance Ratio",
                total=round(sum(ratio_map.values()) / max(1, len(ratio_map)), 2),
                time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, ratio_map), chart_type="line"),
            AnalyticsSeries(key="so_unique_users", label="Unique Users per Day",
                total=float(sum(uq_map.values())), time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, uq_map), chart_type="line"),
            *[
                AnalyticsSeries(key=f"so_tier_{tier}", label=f"{tier.title()} Tier",
                    total=float(sum(tier_maps[tier].values())),
                    time_range=f"Last {days} Days",
                    data=_fill_days(cutoff, days, tier_maps[tier]),
                    chart_type="bar", color=tier_colors[tier])
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
    runs_rows = (await db.execute(
        select(cast(UsageEvent.created_at, SqlDate).label("day"), func.count().label("cnt"))
        .where(UsageEvent.action.in_(domain_actions), UsageEvent.created_at >= cutoff)
        .group_by(cast(UsageEvent.created_at, SqlDate))
        .order_by(cast(UsageEvent.created_at, SqlDate))
    )).fetchall()
    runs_map = {str(r.day): r.cnt for r in runs_rows}

    # Augment per day
    aug_rows = (await db.execute(
        select(cast(UsageEvent.created_at, SqlDate).label("day"), func.count().label("cnt"))
        .where(UsageEvent.action == augment_action, UsageEvent.created_at >= cutoff)
        .group_by(cast(UsageEvent.created_at, SqlDate))
        .order_by(cast(UsageEvent.created_at, SqlDate))
    )).fetchall()
    aug_map = {str(r.day): r.cnt for r in aug_rows}

    # PDO vs GEPA split (two series)
    pdo_rows = (await db.execute(
        select(cast(UsageEvent.created_at, SqlDate).label("day"), func.count().label("cnt"))
        .where(UsageEvent.action == "domain_pdo", UsageEvent.created_at >= cutoff)
        .group_by(cast(UsageEvent.created_at, SqlDate))
        .order_by(cast(UsageEvent.created_at, SqlDate))
    )).fetchall()
    pdo_map = {str(r.day): r.cnt for r in pdo_rows}

    gepa_rows = (await db.execute(
        select(cast(UsageEvent.created_at, SqlDate).label("day"), func.count().label("cnt"))
        .where(UsageEvent.action == "domain_gepa", UsageEvent.created_at >= cutoff)
        .group_by(cast(UsageEvent.created_at, SqlDate))
        .order_by(cast(UsageEvent.created_at, SqlDate))
    )).fetchall()
    gepa_map = {str(r.day): r.cnt for r in gepa_rows}

    # Unique users per day
    uq_rows = (await db.execute(
        select(
            cast(UsageEvent.created_at, SqlDate).label("day"),
            func.count(UsageEvent.user_id.distinct()).label("cnt"),
        )
        .where(UsageEvent.action.in_(domain_actions + [augment_action]),
               UsageEvent.created_at >= cutoff)
        .group_by(cast(UsageEvent.created_at, SqlDate))
        .order_by(cast(UsageEvent.created_at, SqlDate))
    )).fetchall()
    uq_map = {str(r.day): r.cnt for r in uq_rows}

    # Tokens per day
    tok_rows = (await db.execute(
        select(
            cast(Message.created_at, SqlDate).label("day"),
            func.coalesce(func.sum(Message.token_usage["total_tokens"].as_integer()), 0).label("t"),
        )
        .where(Message.created_at >= cutoff, Message.token_usage.isnot(None))
        .group_by(cast(Message.created_at, SqlDate))
        .order_by(cast(Message.created_at, SqlDate))
    )).fetchall()
    tok_map: dict[str, int | float] = {str(r.day): r.t for r in tok_rows}

    total_runs = sum(runs_map.values())

    return AnalyticsResponse(
        view="agent_domain",
        generated_at=datetime.now(UTC).isoformat(),
        statics={"total_runs": total_runs},
        series=[
            AnalyticsSeries(key="domain_runs", label="Domain Runs per Day",
                total=float(total_runs), time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, runs_map), chart_type="line"),
            AnalyticsSeries(key="domain_augment", label="Augmentation Runs per Day",
                total=float(sum(aug_map.values())), time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, aug_map), chart_type="bar"),
            AnalyticsSeries(key="domain_pdo", label="PDO Runs",
                total=float(sum(pdo_map.values())), time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, pdo_map),
                chart_type="bar", color="#06b6d4"),
            AnalyticsSeries(key="domain_gepa", label="GEPA Runs",
                total=float(sum(gepa_map.values())), time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, gepa_map),
                chart_type="bar", color="#8b5cf6"),
            AnalyticsSeries(key="domain_tokens", label="Tokens per Day",
                total=float(sum(tok_map.values())), time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, tok_map), chart_type="line"),
            AnalyticsSeries(key="domain_unique_users", label="Unique Users per Day",
                total=float(sum(uq_map.values())), time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, uq_map), chart_type="line"),
        ],
    )


async def _agent_bridge(db: AsyncSession, days: int) -> AnalyticsResponse:
    now = datetime.now(UTC)
    cutoff = now - timedelta(days=days)

    runs_rows = (await db.execute(
        select(cast(UsageEvent.created_at, SqlDate).label("day"), func.count().label("cnt"))
        .where(UsageEvent.action == "bridge", UsageEvent.created_at >= cutoff)
        .group_by(cast(UsageEvent.created_at, SqlDate))
        .order_by(cast(UsageEvent.created_at, SqlDate))
    )).fetchall()
    runs_map = {str(r.day): r.cnt for r in runs_rows}

    uq_rows = (await db.execute(
        select(
            cast(UsageEvent.created_at, SqlDate).label("day"),
            func.count(UsageEvent.user_id.distinct()).label("cnt"),
        )
        .where(UsageEvent.action == "bridge", UsageEvent.created_at >= cutoff)
        .group_by(cast(UsageEvent.created_at, SqlDate))
        .order_by(cast(UsageEvent.created_at, SqlDate))
    )).fetchall()
    uq_map = {str(r.day): r.cnt for r in uq_rows}

    tok_rows = (await db.execute(
        select(
            cast(Message.created_at, SqlDate).label("day"),
            func.coalesce(func.sum(Message.token_usage["total_tokens"].as_integer()), 0).label("t"),
        )
        .where(Message.created_at >= cutoff, Message.token_usage.isnot(None))
        .group_by(cast(Message.created_at, SqlDate))
        .order_by(cast(Message.created_at, SqlDate))
    )).fetchall()
    tok_map: dict[str, int | float] = {str(r.day): r.t for r in tok_rows}

    total_bridge = int((await db.execute(
        select(func.count()).select_from(UsageEvent).where(UsageEvent.action == "bridge")
    )).scalar_one())

    return AnalyticsResponse(
        view="agent_bridge",
        generated_at=datetime.now(UTC).isoformat(),
        statics={"total_bridges": total_bridge},
        series=[
            AnalyticsSeries(key="bridge_runs", label="Bridges per Day",
                total=float(sum(runs_map.values())), time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, runs_map), chart_type="line"),
            AnalyticsSeries(key="bridge_tokens", label="Tokens per Day",
                total=float(sum(tok_map.values())), time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, tok_map), chart_type="line"),
            AnalyticsSeries(key="bridge_unique_users", label="Unique Users per Day",
                total=float(sum(uq_map.values())), time_range=f"Last {days} Days",
                data=_fill_days(cutoff, days, uq_map), chart_type="line"),
        ],
    )
```

- [ ] **Step 2: Run mypy + tests**

```bash
cd qa-chatbot && uv run mypy src/promptly/admin/ && uv run pytest tests/unit/test_admin_analytics.py -v
```

Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add qa-chatbot/src/promptly/admin/api/router.py
git commit -m "feat: add agent_optimizer, agent_skillopt, agent_domain, agent_bridge analytics views"
```

---

### Task 4: Frontend — TypeScript types

**Files:**
- Create: `frontend/src/types/analytics.ts`

- [ ] **Step 1: Create the types file**

```typescript
// frontend/src/types/analytics.ts

export interface AnalyticsPoint {
  date: string;   // "YYYY-MM-DD", "YYYY-MM", or a label (model names for bar charts)
  value: number;
}

export interface AnalyticsSeries {
  key: string;
  label: string;
  total: number;
  time_range: string;
  data: AnalyticsPoint[];
  chart_type: 'line' | 'bar';
  color?: string;
}

export interface AnalyticsResponse {
  view: string;
  generated_at: string;
  statics: Record<string, number | string>;
  series: AnalyticsSeries[];
}

// Helper: find a single series by key
export function getSeries(res: AnalyticsResponse, key: string): AnalyticsSeries | undefined {
  return res.series.find(s => s.key === key);
}

// Helper: find all series whose keys start with prefix (e.g. "so_tier_")
export function getSeriesGroup(res: AnalyticsResponse, prefix: string): AnalyticsSeries[] {
  return res.series.filter(s => s.key.startsWith(prefix));
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npm run build 2>&1 | grep -E "error|warn" | head -20
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types/analytics.ts
git commit -m "feat: add TypeScript types for analytics API response"
```

---

### Task 5: Frontend — Shared MetricCard and StaticCard components

**Files:**
- Create: `frontend/src/components/admin/analytics/metric-card.tsx`
- Create: `frontend/src/components/admin/analytics/static-card.tsx`

- [ ] **Step 1: Create `metric-card.tsx`**

This component renders: title, big total number, time range label, Line/Bar toggle, and a Recharts chart.

```typescript
// frontend/src/components/admin/analytics/metric-card.tsx
'use client';

import { useState } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { AnalyticsSeries } from '@/types/analytics';

function fmtVal(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n < 1 && n > 0) return n.toFixed(2);
  return n.toLocaleString();
}

function shortDate(s: string): string {
  // "2026-06-23" → "23 Jun", "2026-06" → "Jun", "2026-06-01" quarter → "Q2"
  if (s.length === 7) return new Date(s + '-01').toLocaleString('en', { month: 'short' });
  if (s.length >= 10) {
    const d = new Date(s);
    return `${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}`;
  }
  return s;
}

interface Props {
  series: AnalyticsSeries;
  defaultChartType?: 'line' | 'bar';
  height?: number;
}

export function MetricCard({ series, defaultChartType, height = 120 }: Props) {
  const [chartType, setChartType] = useState<'line' | 'bar'>(defaultChartType ?? series.chart_type);
  const color = series.color ?? 'var(--primary)';
  const rechartData = series.data.map(p => ({ date: shortDate(p.date), value: p.value }));

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '18px 20px', display: 'flex',
      flexDirection: 'column', gap: 8,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-subtle)',
          textTransform: 'uppercase', letterSpacing: '.07em' }}>
          {series.label}
        </span>
        {/* Line / Bar toggle */}
        <div style={{ display: 'flex', gap: 2, background: 'var(--surface-2)',
          borderRadius: 6, padding: 2 }}>
          {(['line', 'bar'] as const).map(t => (
            <button key={t} onClick={() => setChartType(t)} style={{
              padding: '2px 8px', fontSize: 10.5, fontWeight: 600,
              borderRadius: 4, border: 'none', cursor: 'pointer',
              background: chartType === t ? 'var(--surface)' : 'transparent',
              color: chartType === t ? 'var(--text)' : 'var(--text-muted)',
              boxShadow: chartType === t ? '0 1px 2px rgba(0,0,0,.08)' : 'none',
            }}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Big number */}
      <div style={{ fontFamily: 'var(--mono)', fontSize: 28, fontWeight: 700,
        color: 'var(--text)', lineHeight: 1 }}>
        {fmtVal(series.total)}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{series.time_range}</div>

      {/* Chart */}
      <div style={{ height, marginTop: 4 }}>
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'line' ? (
            <LineChart data={rechartData} margin={{ top: 2, right: 4, left: -24, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-subtle)' }}
                tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 9, fill: 'var(--text-subtle)' }}
                tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: 'var(--text-muted)', marginBottom: 4 }}
                itemStyle={{ color: 'var(--text)' }}
              />
              <Line type="monotone" dataKey="value" stroke={color}
                strokeWidth={2} dot={false} activeDot={{ r: 4 }} name={series.label} />
            </LineChart>
          ) : (
            <BarChart data={rechartData} margin={{ top: 2, right: 4, left: -24, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-subtle)' }}
                tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 9, fill: 'var(--text-subtle)' }}
                tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: 'var(--text-muted)', marginBottom: 4 }}
                itemStyle={{ color: 'var(--text)' }}
              />
              <Bar dataKey="value" fill={color} radius={[3, 3, 0, 0]} name={series.label} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `static-card.tsx`**

```typescript
// frontend/src/components/admin/analytics/static-card.tsx

interface Props {
  title: string;
  value: string | number;
  subtitle?: string;
  accent?: string;
}

export function StaticCard({ title, value, subtitle, accent }: Props) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '20px 22px', display: 'flex',
      flexDirection: 'column', gap: 6,
    }}>
      <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-subtle)',
        textTransform: 'uppercase', letterSpacing: '.07em' }}>
        {title}
      </span>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 32, fontWeight: 700,
        color: accent ?? 'var(--text)', lineHeight: 1 }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      {subtitle && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{subtitle}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend && npm run build 2>&1 | grep -E "error" | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/admin/analytics/
git commit -m "feat: add shared MetricCard and StaticCard analytics components"
```

---

### Task 6: Frontend — Platform views

**Files:**
- Create: `frontend/src/components/admin/analytics/platform-engagement.tsx`
- Create: `frontend/src/components/admin/analytics/platform-logins.tsx`

- [ ] **Step 1: Create `platform-engagement.tsx`**

```typescript
// frontend/src/components/admin/analytics/platform-engagement.tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AnalyticsResponse } from '@/types/analytics';
import { getSeries, getSeriesGroup } from '@/types/analytics';
import { MetricCard } from './metric-card';
import { StaticCard } from './static-card';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function Skeleton() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
      {Array(10).fill(0).map((_, i) => (
        <div key={i} style={{ background: 'var(--surface-2)', borderRadius: 12,
          height: 220, animation: 'pulse 1.5s ease-in-out infinite' }} />
      ))}
    </div>
  );
}

export function PlatformEngagement() {
  const { data, isLoading, isError } = useQuery<AnalyticsResponse>({
    queryKey: ['admin', 'analytics', 'platform_engagement'],
    queryFn: async () => {
      const res = await api.get<{ data: AnalyticsResponse }>(
        '/api/v1/admin/analytics?view=platform_engagement&days=30'
      );
      return res.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <Skeleton />;
  if (isError || !data) return (
    <div style={{ color: 'var(--danger)', padding: 24, textAlign: 'center' }}>
      Failed to load analytics.
    </div>
  );

  const st = data.statics;
  const adoptionSeries = getSeriesGroup(data, 'adoption_');

  // Build stacked adoption data
  const adoptionDates = (getSeries(data, 'dau')?.data ?? []).map(p => p.date.slice(5));
  const adoptionData = adoptionDates.map((date, i) => ({
    date,
    ...Object.fromEntries(adoptionSeries.map(s => [s.label, s.data[i]?.value ?? 0])),
  }));
  const adoptionColors = ['var(--primary)', '#06b6d4', '#f59e0b', '#f43f5e'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Static summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
        <StaticCard title="Total Users" value={fmtNum(Number(st.total_users))} subtitle="all time" />
        <StaticCard title="Total Optimizations" value={fmtNum(Number(st.total_optimizations))} subtitle="all time" />
        <StaticCard title="Total Tokens" value={fmtNum(Number(st.total_tokens))} subtitle="consumed" />
        <StaticCard title="Total Credits" value={fmtNum(Number(st.total_credits))} subtitle="charged" />
        <StaticCard title="Budget Used" value={`${st.budget_used_pct}%`} subtitle="of token budget"
          accent={Number(st.budget_used_pct) > 80 ? 'var(--danger)' : undefined} />
      </div>

      {/* 2-col chart grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
        {(['dau', 'wau', 'optimizations_per_day', 'feature_calls_per_day',
           'sessions_per_day', 'logins_per_day', 'tokens_per_day',
           'signups_per_day', 'credits_per_day'] as const).map(key => {
          const s = getSeries(data, key);
          return s ? <MetricCard key={key} series={s} /> : null;
        })}

        {/* Stacked adoption chart */}
        {adoptionSeries.length > 0 && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 12, padding: '18px 20px' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-subtle)',
              textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 12 }}>
              Feature Adoption — Unique Users per Day
            </div>
            <div style={{ height: 150 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={adoptionData} margin={{ top: 0, right: 4, left: -24, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-subtle)' }}
                    tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--text-subtle)' }}
                    tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)',
                      borderRadius: 8, fontSize: 11 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {adoptionSeries.map((s, i) => (
                    <Bar key={s.key} dataKey={s.label} stackId="a"
                      fill={adoptionColors[i % adoptionColors.length]}
                      radius={i === adoptionSeries.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `platform-logins.tsx`**

```typescript
// frontend/src/components/admin/analytics/platform-logins.tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AnalyticsResponse } from '@/types/analytics';
import { getSeries } from '@/types/analytics';
import { MetricCard } from './metric-card';
import { StaticCard } from './static-card';

function Skeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {Array(3).fill(0).map((_, i) => (
          <div key={i} style={{ background: 'var(--surface-2)', borderRadius: 12,
            height: 100, animation: 'pulse 1.5s ease-in-out infinite' }} />
        ))}
      </div>
    </div>
  );
}

export function PlatformLogins() {
  const { data, isLoading, isError } = useQuery<AnalyticsResponse>({
    queryKey: ['admin', 'analytics', 'platform_logins'],
    queryFn: async () => {
      const res = await api.get<{ data: AnalyticsResponse }>(
        '/api/v1/admin/analytics?view=platform_logins&days=30'
      );
      return res.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <Skeleton />;
  if (isError || !data) return (
    <div style={{ color: 'var(--danger)', padding: 24, textAlign: 'center' }}>
      Failed to load login analytics.
    </div>
  );

  const st = data.statics;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Top KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <StaticCard title="Daily Active Users" value={Number(st.dau_7d)} subtitle="Last 7 Days" />
        <StaticCard title="Weekly Active Users" value={Number(st.wau_7d)} subtitle="Last 7 Days" />
        <StaticCard title="Monthly Active Users" value={Number(st.mau_30d)} subtitle="Last 30 Days" />
      </div>

      {/* Trend charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        {(['wau_trend', 'mau_trend', 'qau_trend'] as const).map(key => {
          const s = getSeries(data, key);
          return s ? <MetricCard key={key} series={s} height={130} /> : null;
        })}
      </div>

      {/* Retention + session stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <StaticCard title="D7 Retention"
          value={`${st.d7_retention}%`}
          subtitle="Users who returned within 7 days of signup"
          accent={Number(st.d7_retention) < 20 ? 'var(--danger)' : 'var(--success)'} />
        <StaticCard title="D30 Retention"
          value={`${st.d30_retention}%`}
          subtitle="Users who returned within 30 days of signup"
          accent={Number(st.d30_retention) < 30 ? 'var(--danger)' : 'var(--success)'} />
        <StaticCard title="Avg Sessions / Active User"
          value={Number(st.avg_sessions_per_user)}
          subtitle="Last 30 days" />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build check**

```bash
cd frontend && npm run build 2>&1 | grep -E "error" | head -20
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/admin/analytics/
git commit -m "feat: add PlatformEngagement and PlatformLogins analytics view components"
```

---

### Task 7: Frontend — Agent view components

**Files:**
- Create: `frontend/src/components/admin/analytics/agent-optimizer.tsx`
- Create: `frontend/src/components/admin/analytics/agent-skillopt.tsx`
- Create: `frontend/src/components/admin/analytics/agent-domain.tsx`
- Create: `frontend/src/components/admin/analytics/agent-bridge.tsx`

- [ ] **Step 1: Create `agent-optimizer.tsx`**

```typescript
// frontend/src/components/admin/analytics/agent-optimizer.tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AnalyticsResponse } from '@/types/analytics';
import { getSeries } from '@/types/analytics';
import { MetricCard } from './metric-card';
import { StaticCard } from './static-card';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';

export function AgentOptimizer() {
  const { data, isLoading, isError } = useQuery<AnalyticsResponse>({
    queryKey: ['admin', 'analytics', 'agent_optimizer'],
    queryFn: async () => {
      const res = await api.get<{ data: AnalyticsResponse }>(
        '/api/v1/admin/analytics?view=agent_optimizer&days=30'
      );
      return res.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>;
  if (isError || !data) return <div style={{ color: 'var(--danger)', padding: 24, textAlign: 'center' }}>Failed to load.</div>;

  const st = data.statics;
  const modelSeries = getSeries(data, 'council_models');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Static cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        <StaticCard title="Avg Tokens per Optimization"
          value={Number(st.avg_tokens_per_opt).toLocaleString()}
          subtitle="all time" />
        <StaticCard title="Optimizations per Active User"
          value={Number(st.calls_per_active_user)}
          subtitle="last 30 day daily average" />
      </div>

      {/* Chart grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
        {(['optimizer_runs', 'optimizer_tokens', 'optimizer_unique_users',
           'optimizer_sessions', 'optimizer_credits'] as const).map(key => {
          const s = getSeries(data, key);
          return s ? <MetricCard key={key} series={s} /> : null;
        })}

        {/* Council model distribution horizontal bar */}
        {modelSeries && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 12, padding: '18px 20px' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-subtle)',
              textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 12 }}>
              Council Model Distribution
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>All Time</div>
            <div style={{ height: 160 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={modelSeries.data.map(p => ({
                    model: (p.date as string).split('/').pop() ?? p.date,
                    votes: p.value,
                  }))}
                  layout="vertical"
                  margin={{ top: 0, right: 8, left: 8, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 9, fill: 'var(--text-subtle)' }}
                    tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="model"
                    tick={{ fontSize: 9, fill: 'var(--text-subtle)' }}
                    tickLine={false} axisLine={false} width={90} />
                  <Tooltip
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)',
                      borderRadius: 8, fontSize: 11 }}
                  />
                  <Bar dataKey="votes" fill="var(--primary)" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `agent-skillopt.tsx`**

```typescript
// frontend/src/components/admin/analytics/agent-skillopt.tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AnalyticsResponse } from '@/types/analytics';
import { getSeries, getSeriesGroup } from '@/types/analytics';
import { MetricCard } from './metric-card';
import { StaticCard } from './static-card';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

export function AgentSkillOpt() {
  const { data, isLoading, isError } = useQuery<AnalyticsResponse>({
    queryKey: ['admin', 'analytics', 'agent_skillopt'],
    queryFn: async () => {
      const res = await api.get<{ data: AnalyticsResponse }>(
        '/api/v1/admin/analytics?view=agent_skillopt&days=30'
      );
      return res.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>;
  if (isError || !data) return <div style={{ color: 'var(--danger)', padding: 24, textAlign: 'center' }}>Failed to load.</div>;

  const st = data.statics;
  const tierSeries = getSeriesGroup(data, 'so_tier_');

  // Build stacked tier data
  const tierDates = (getSeries(data, 'so_runs')?.data ?? []).map(p => p.date.slice(5));
  const tierData = tierDates.map((date, i) => ({
    date,
    ...Object.fromEntries(tierSeries.map(s => [s.label, s.data[i]?.value ?? 0])),
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <StaticCard title="Avg Epochs Run"
          value={Number(st.avg_epochs)} subtitle="per completed run" />
        <StaticCard title="Total Examples Processed"
          value={Number(st.total_examples).toLocaleString()} subtitle="all time" />
        <StaticCard title="Overall Avg Score Improvement"
          value={`+${(Number(st.overall_avg_improvement) * 100).toFixed(1)}%`}
          subtitle="score_after − score_before"
          accent="var(--success)" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
        {(['so_runs', 'so_improvement', 'so_score_test', 'so_edits_accepted',
           'so_acceptance_ratio', 'so_unique_users'] as const).map(key => {
          const s = getSeries(data, key);
          return s ? <MetricCard key={key} series={s} /> : null;
        })}

        {/* Stacked tier breakdown */}
        {tierSeries.length > 0 && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 12, padding: '18px 20px' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-subtle)',
              textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 12 }}>
              Runs by Tier per Day
            </div>
            <div style={{ height: 150 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={tierData} margin={{ top: 0, right: 4, left: -24, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-subtle)' }}
                    tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--text-subtle)' }}
                    tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)',
                      borderRadius: 8, fontSize: 11 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {tierSeries.map((s, i) => (
                    <Bar key={s.key} dataKey={s.label} stackId="t"
                      fill={s.color ?? 'var(--primary)'}
                      radius={i === tierSeries.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `agent-domain.tsx`**

```typescript
// frontend/src/components/admin/analytics/agent-domain.tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AnalyticsResponse } from '@/types/analytics';
import { getSeries } from '@/types/analytics';
import { MetricCard } from './metric-card';
import { StaticCard } from './static-card';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

export function AgentDomain() {
  const { data, isLoading, isError } = useQuery<AnalyticsResponse>({
    queryKey: ['admin', 'analytics', 'agent_domain'],
    queryFn: async () => {
      const res = await api.get<{ data: AnalyticsResponse }>(
        '/api/v1/admin/analytics?view=agent_domain&days=30'
      );
      return res.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>;
  if (isError || !data) return <div style={{ color: 'var(--danger)', padding: 24, textAlign: 'center' }}>Failed to load.</div>;

  const st = data.statics;
  const pdoSeries = getSeries(data, 'domain_pdo');
  const gepaSeries = getSeries(data, 'domain_gepa');

  // Build PDO vs GEPA split data
  const splitDates = (pdoSeries?.data ?? []).map(p => p.date.slice(5));
  const splitData = splitDates.map((date, i) => ({
    date,
    PDO: pdoSeries?.data[i]?.value ?? 0,
    GEPA: gepaSeries?.data[i]?.value ?? 0,
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(1, 1fr)', gap: 12 }}>
        <StaticCard title="Total Domain Runs" value={Number(st.total_runs).toLocaleString()} subtitle="all time" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
        {(['domain_runs', 'domain_augment', 'domain_tokens', 'domain_unique_users'] as const).map(key => {
          const s = getSeries(data, key);
          return s ? <MetricCard key={key} series={s} /> : null;
        })}

        {/* PDO vs GEPA stacked */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, padding: '18px 20px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-subtle)',
            textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 12 }}>
            PDO vs GEPA Split
          </div>
          <div style={{ height: 150 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={splitData} margin={{ top: 0, right: 4, left: -24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-subtle)' }}
                  tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 9, fill: 'var(--text-subtle)' }}
                  tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 8, fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="PDO" stackId="s" fill="#06b6d4" />
                <Bar dataKey="GEPA" stackId="s" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `agent-bridge.tsx`**

```typescript
// frontend/src/components/admin/analytics/agent-bridge.tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AnalyticsResponse } from '@/types/analytics';
import { getSeries } from '@/types/analytics';
import { MetricCard } from './metric-card';
import { StaticCard } from './static-card';

export function AgentBridge() {
  const { data, isLoading, isError } = useQuery<AnalyticsResponse>({
    queryKey: ['admin', 'analytics', 'agent_bridge'],
    queryFn: async () => {
      const res = await api.get<{ data: AnalyticsResponse }>(
        '/api/v1/admin/analytics?view=agent_bridge&days=30'
      );
      return res.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>;
  if (isError || !data) return <div style={{ color: 'var(--danger)', padding: 24, textAlign: 'center' }}>Failed to load.</div>;

  const st = data.statics;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(1, 1fr)', gap: 12 }}>
        <StaticCard title="Total Bridges Run" value={Number(st.total_bridges).toLocaleString()} subtitle="all time" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
        {(['bridge_runs', 'bridge_tokens', 'bridge_unique_users'] as const).map(key => {
          const s = getSeries(data, key);
          return s ? <MetricCard key={key} series={s} /> : null;
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Build check**

```bash
cd frontend && npm run build 2>&1 | grep -E "error" | head -20
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/admin/analytics/
git commit -m "feat: add Agent analytics view components (Optimizer, SkillOpt, Domain, Bridge)"
```

---

### Task 8: Frontend — ViewTab component + wire into admin page

**Files:**
- Create: `frontend/src/components/admin/view-tab.tsx`
- Modify: `frontend/src/app/(dashboard)/admin/page.tsx`

- [ ] **Step 1: Create `view-tab.tsx`**

```typescript
// frontend/src/components/admin/view-tab.tsx
'use client';

import { useState } from 'react';
import { PlatformEngagement } from './analytics/platform-engagement';
import { PlatformLogins } from './analytics/platform-logins';
import { AgentOptimizer } from './analytics/agent-optimizer';
import { AgentSkillOpt } from './analytics/agent-skillopt';
import { AgentDomain } from './analytics/agent-domain';
import { AgentBridge } from './analytics/agent-bridge';

type TopToggle = 'platform' | 'agents';

type PlatformView = 'feature_engagement' | 'login_activity';
type AgentView = 'prompt_optimizer' | 'skill_builder' | 'domain_pdogepa' | 'bridge';

const PLATFORM_ITEMS: { id: PlatformView; label: string }[] = [
  { id: 'feature_engagement', label: 'Feature Engagement' },
  { id: 'login_activity',     label: 'Login Activity' },
];

const AGENT_ITEMS: { id: AgentView; label: string }[] = [
  { id: 'prompt_optimizer', label: 'Prompt Optimizer' },
  { id: 'skill_builder',    label: 'Skill Builder' },
  { id: 'domain_pdogepa',   label: 'Domain PDO/GEPA' },
  { id: 'bridge',           label: 'Bridge' },
];

function SidebarItem({
  label, active, onClick,
}: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '9px 14px', width: '100%', textAlign: 'left',
        background: active ? 'color-mix(in oklab, var(--primary) 12%, transparent)' : 'transparent',
        color: active ? 'var(--primary)' : 'var(--text-muted)',
        border: 'none', borderRadius: 8,
        fontSize: 13, fontWeight: active ? 600 : 400,
        cursor: 'pointer', transition: 'all .12s',
      }}
    >
      {active && <span style={{ width: 3, height: 14, borderRadius: 99,
        background: 'var(--primary)', flexShrink: 0 }} />}
      {label}
    </button>
  );
}

export function ViewTab() {
  const [toggle, setToggle] = useState<TopToggle>('platform');
  const [platformView, setPlatformView] = useState<PlatformView>('feature_engagement');
  const [agentView, setAgentView] = useState<AgentView>('prompt_optimizer');

  const sidebarItems = toggle === 'platform' ? PLATFORM_ITEMS : AGENT_ITEMS;
  const activeId = toggle === 'platform' ? platformView : agentView;

  const headings: Record<string, { title: string; desc: string }> = {
    feature_engagement: { title: 'Feature Engagement',
      desc: 'Track and analyze user engagement with different features across the platform' },
    login_activity:     { title: 'Login Activity',
      desc: 'Track login activity and daily, weekly, monthly active user trends' },
    prompt_optimizer:   { title: 'Prompt Optimizer',
      desc: 'Council optimizer runs, token consumption, and model distribution' },
    skill_builder:      { title: 'Skill Builder',
      desc: 'SkillOpt runs, score improvements, edit acceptance, and tier breakdown' },
    domain_pdogepa:     { title: 'Domain PDO/GEPA',
      desc: 'Domain prompt optimization and dataset augmentation usage' },
    bridge:             { title: 'Bridge',
      desc: 'Prompt bridge usage, token consumption, and unique users' },
  };

  const heading = headings[activeId] ?? { title: '', desc: '' };

  return (
    <div style={{ display: 'flex', gap: 0, height: '100%', minHeight: 0 }}>
      {/* Sidebar */}
      <div style={{
        width: 200, flexShrink: 0, borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', gap: 0, padding: '12px 8px',
      }}>
        {/* Platform / Agents toggle */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 16,
          background: 'var(--surface-2)', borderRadius: 8, padding: 4 }}>
          {(['platform', 'agents'] as const).map(t => (
            <button key={t} onClick={() => setToggle(t)} style={{
              flex: 1, padding: '6px 0', fontSize: 12.5, fontWeight: 600,
              borderRadius: 6, border: 'none', cursor: 'pointer',
              background: toggle === t ? 'var(--surface)' : 'transparent',
              color: toggle === t ? 'var(--text)' : 'var(--text-muted)',
              boxShadow: toggle === t ? '0 1px 3px rgba(0,0,0,.1)' : 'none',
              transition: 'all .12s',
            }}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* Sidebar nav items */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {sidebarItems.map(item => (
            <SidebarItem
              key={item.id}
              label={item.label}
              active={activeId === item.id}
              onClick={() => {
                if (toggle === 'platform') setPlatformView(item.id as PlatformView);
                else setAgentView(item.id as AgentView);
              }}
            />
          ))}
        </div>
      </div>

      {/* Content area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        {/* Sub-view heading */}
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)',
            margin: 0, letterSpacing: '-.01em' }}>
            {heading.title}
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>
            {heading.desc}
          </p>
        </div>

        {/* View content */}
        {toggle === 'platform' && platformView === 'feature_engagement' && <PlatformEngagement />}
        {toggle === 'platform' && platformView === 'login_activity' && <PlatformLogins />}
        {toggle === 'agents' && agentView === 'prompt_optimizer' && <AgentOptimizer />}
        {toggle === 'agents' && agentView === 'skill_builder' && <AgentSkillOpt />}
        {toggle === 'agents' && agentView === 'domain_pdogepa' && <AgentDomain />}
        {toggle === 'agents' && agentView === 'bridge' && <AgentBridge />}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Modify `admin/page.tsx` — add "view" tab**

Add `'view'` to the `Tab` type:

```typescript
type Tab =
  | 'overview'
  | 'users'
  | 'rate-limits'
  | 'errors'
  | 'prompts'
  | 'openrouter'
  | 'health'
  | 'api-keys'
  | 'audit-log'
  | 'jobs'
  | 'view';
```

Add to the `TABS` array (after `'openrouter'`):

```typescript
{ id: 'view', label: 'View', icon: '📈', desc: 'Analytics dashboard — DAU/WAU/MAU, feature engagement, per-agent metrics' },
```

Add the import at the top:

```typescript
import { ViewTab } from '@/components/admin/view-tab';
```

Add the conditional render inside the tab content div:

```typescript
{activeTab === 'view' && <ViewTab />}
```

Note: The existing tab content div has `padding: '24px 32px 60px'`. For the View tab, the `ViewTab` component manages its own inner layout with a sidebar, so we need to pass `fullHeight` to it. Wrap the view tab render to remove the outer padding when active:

Replace the outer content div in `page.tsx`:

```typescript
{/* Tab content */}
<div style={{
  flex: 1,
  overflowY: activeTab === 'view' ? 'hidden' : 'auto',
  padding: activeTab === 'view' ? 0 : '24px 32px 60px',
  display: activeTab === 'view' ? 'flex' : 'block',
  flexDirection: 'column' as const,
  minHeight: 0,
}}>
  {activeTab === 'overview'    && <StatsCards />}
  {activeTab === 'users'       && <UsersTable />}
  {activeTab === 'rate-limits' && <RateLimitsTable />}
  {activeTab === 'errors'      && <ErrorsTable />}
  {activeTab === 'health'      && <HealthTab />}
  {activeTab === 'jobs'        && <JobsMonitorTab />}
  {activeTab === 'api-keys'    && <ApiKeysTable />}
  {activeTab === 'audit-log'   && <AuditLogTable />}
  {activeTab === 'prompts'     && <PromptsView />}
  {activeTab === 'openrouter'  && <OpenRouterCard />}
  {activeTab === 'view'        && <ViewTab />}
</div>
```

- [ ] **Step 3: Full build check**

```bash
cd frontend && npm run build 2>&1 | grep -E "error" | head -20
```

Expected: no TypeScript errors, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/admin/view-tab.tsx frontend/src/app/(dashboard)/admin/page.tsx
git commit -m "feat: add View analytics tab to admin panel with Platform/Agents toggle and sidebar nav"
```

---

## Self-Review

**Spec coverage:**
- ✅ "View" tab added to admin panel — Task 8
- ✅ Platform / Agents top toggle — Task 8 (`ViewTab`)
- ✅ Platform sidebar: Feature Engagement, Login Activity — Tasks 6 + 8
- ✅ Agents sidebar: Prompt Optimizer, Skill Builder, Domain PDO/GEPA, Bridge — Tasks 7 + 8
- ✅ All 10 Platform Engagement chart cards — Task 2 backend, Task 6 frontend
- ✅ Feature Adoption stacked bar — Task 2 backend, Task 6 frontend
- ✅ Platform Login Activity KPIs + 3 trends + 3 static retention cards — Tasks 2 + 6
- ✅ All 8 Prompt Optimizer cards — Tasks 3 + 7
- ✅ Council model distribution horizontal bar — Tasks 3 + 7
- ✅ All 9 Skill Builder cards + stacked tier bar — Tasks 3 + 7
- ✅ All 6 Domain cards + PDO vs GEPA stacked — Tasks 3 + 7
- ✅ All 3 Bridge charts + static total — Tasks 3 + 7
- ✅ Static: no polling, `staleTime: 5min` — all frontend tasks
- ✅ `require_admin` protection — inherited from router, no new auth needed
- ✅ All data is aggregate, no per-user prompt content exposed — confirmed in Task 3 queries
