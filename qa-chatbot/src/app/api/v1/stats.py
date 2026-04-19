from datetime import UTC, datetime, timedelta
from datetime import date as date_type
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import Date, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.types.response import SuccessResponse
from app.dependencies import get_current_user, get_db
from app.models.message import Message
from app.models.prompt_version import PromptVersion
from app.models.session import ChatSession
from app.models.user import User
from app.repositories.health_score_repo import HealthScoreRepository
from app.schemas.stats import DailyActivity, DashboardStats, ModelStats, QualityTrendPoint

router = APIRouter(prefix="/stats", tags=["stats"])

# Blended cost per 1M tokens (input+output average) by council model
_MODEL_COST_PER_M: dict[str, float] = {
    "gpt-4o-mini": 0.30,
    "claude-3.5-haiku": 2.40,
    "gemini-2.0-flash": 0.25,
    "grok-2": 6.00,
}
_DEFAULT_COST_PER_M = 1.00

_MODEL_DISPLAY: dict[str, str] = {
    "gpt-4o-mini": "GPT-4o Mini",
    "claude-3.5-haiku": "Claude Haiku",
    "gemini-2.0-flash": "Gemini Flash",
    "grok-2": "Grok-2",
}


@router.get("", response_model=SuccessResponse[DashboardStats])
async def get_dashboard_stats(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[DashboardStats]:
    """Return aggregated dashboard statistics for the current user."""
    user_id = current_user.id
    has_response = Message.response.isnot(None)

    # ── 1. Total prompts optimized ────────────────────────────────────────────
    count_stmt = (
        select(func.count())
        .select_from(Message)
        .join(ChatSession, Message.session_id == ChatSession.id)
        .where(ChatSession.user_id == user_id, has_response)
    )
    prompts_optimized: int = (await db.execute(count_stmt)).scalar_one() or 0

    # ── 2. Total distinct sessions ────────────────────────────────────────────
    sessions_stmt = (
        select(func.count()).select_from(ChatSession).where(ChatSession.user_id == user_id)
    )
    total_sessions: int = (await db.execute(sessions_stmt)).scalar_one() or 0

    # ── 3. Daily activity — last 30 days (zero-filled) ────────────────────────
    thirty_days_ago = datetime.now(UTC) - timedelta(days=30)
    daily_stmt = (
        select(
            cast(Message.created_at, Date).label("day"),
            func.count().label("cnt"),
        )
        .join(ChatSession, Message.session_id == ChatSession.id)
        .where(
            ChatSession.user_id == user_id,
            has_response,
            Message.created_at >= thirty_days_ago,
        )
        .group_by(cast(Message.created_at, Date))
        .order_by(cast(Message.created_at, Date))
    )
    daily_rows = (await db.execute(daily_stmt)).all()
    activity_map: dict[str, int] = {str(row.day): row.cnt for row in daily_rows}

    daily_activity: list[DailyActivity] = []
    for offset in range(30):
        d = (datetime.now(UTC) - timedelta(days=29 - offset)).date()
        daily_activity.append(DailyActivity(date=str(d), count=activity_map.get(str(d), 0)))

    # ── 4. Prompt families + total version rows ───────────────────────────────
    families_stmt = select(func.count(func.distinct(PromptVersion.prompt_id))).where(
        PromptVersion.user_id == user_id
    )
    versions_saved: int = (await db.execute(families_stmt)).scalar_one() or 0

    total_versions_stmt = (
        select(func.count()).select_from(PromptVersion).where(PromptVersion.user_id == user_id)
    )
    total_versions: int = (await db.execute(total_versions_stmt)).scalar_one() or 0

    # ── 5. Last optimized timestamp ───────────────────────────────────────────
    last_opt_stmt = (
        select(func.max(Message.created_at))
        .join(ChatSession, Message.session_id == ChatSession.id)
        .where(ChatSession.user_id == user_id, has_response)
    )
    last_optimized_at: datetime | None = (await db.execute(last_opt_stmt)).scalar_one_or_none()

    # ── 6. Streak (consecutive active days, ending today or yesterday) ────────
    all_dates_stmt = (
        select(cast(Message.created_at, Date).label("active_date"))
        .join(ChatSession, Message.session_id == ChatSession.id)
        .where(ChatSession.user_id == user_id, has_response)
        .group_by(cast(Message.created_at, Date))
    )
    all_date_rows: list[date_type] = list((await db.execute(all_dates_stmt)).scalars().all())
    date_set: set[date_type] = set(all_date_rows)
    today = datetime.now(UTC).date()
    streak_days = 0
    if date_set:
        # Allow streak to start from yesterday (user may not have run today yet)
        start = today if today in date_set else today - timedelta(days=1)
        if start in date_set:
            check = start
            while check in date_set:
                streak_days += 1
                check -= timedelta(days=1)

    # ── 7. Token / model breakdown from recent messages ───────────────────────
    messages_stmt = (
        select(Message.token_usage, Message.council_votes)
        .join(ChatSession, Message.session_id == ChatSession.id)
        .where(ChatSession.user_id == user_id, has_response)
        .order_by(Message.created_at.desc())
        .limit(500)
    )
    rows = (await db.execute(messages_stmt)).all()

    total_tokens = 0
    model_tokens: dict[str, int] = {}

    for token_usage, council_votes in rows:
        if token_usage and isinstance(token_usage, dict):
            total_tokens += int(token_usage.get("total_tokens") or 0)

        if council_votes and isinstance(council_votes, list):
            for vote in council_votes:
                if not isinstance(vote, dict):
                    continue
                model: str = vote.get("model") or "unknown"
                usage = vote.get("usage") or {}
                if not isinstance(usage, dict):
                    continue
                tokens: int = int(usage.get("total_tokens") or 0) or (
                    int(usage.get("input_tokens") or 0) + int(usage.get("output_tokens") or 0)
                )
                model_tokens[model] = model_tokens.get(model, 0) + tokens

    # ── 8. Derived: cost, avg, top model ──────────────────────────────────────
    estimated_cost = 0.0
    model_breakdown: list[ModelStats] = []

    for model, tokens in sorted(model_tokens.items(), key=lambda kv: -kv[1]):
        rate = _MODEL_COST_PER_M.get(model, _DEFAULT_COST_PER_M)
        estimated_cost += (tokens / 1_000_000) * rate
        model_breakdown.append(ModelStats(model=model, total_tokens=tokens))

    if not model_breakdown and total_tokens > 0:
        estimated_cost = (total_tokens / 1_000_000) * _DEFAULT_COST_PER_M

    avg_tokens_per_run: int = (
        round(total_tokens / prompts_optimized) if prompts_optimized > 0 else 0
    )

    top_model: str | None = None
    if model_tokens:
        raw = max(model_tokens, key=lambda k: model_tokens[k])
        top_model = _MODEL_DISPLAY.get(raw, raw)

    # ── 9. Quality trend — 30-day average health scores ─────────────────────
    score_repo = HealthScoreRepository(db)
    raw_trend = await score_repo.get_daily_averages(user_id, days=30)
    trend_map: dict[str, float] = {str(d): s for d, s in raw_trend}
    quality_trend: list[QualityTrendPoint] = [
        QualityTrendPoint(date=str(d), avg_score=round(trend_map[str(d)], 1))
        for d in ((datetime.now(UTC) - timedelta(days=29 - i)).date() for i in range(30))
        if str(d) in trend_map
    ]

    return SuccessResponse(
        data=DashboardStats(
            prompts_optimized=prompts_optimized,
            total_sessions=total_sessions,
            total_tokens=total_tokens,
            avg_tokens_per_run=avg_tokens_per_run,
            estimated_cost_usd=round(estimated_cost, 4),
            versions_saved=versions_saved,
            total_versions=total_versions,
            credits_remaining=current_user.credits,
            streak_days=streak_days,
            last_optimized_at=last_optimized_at,
            top_model=top_model,
            daily_activity=daily_activity,
            model_breakdown=model_breakdown,
            quality_trend=quality_trend,
        )
    )
