from datetime import UTC, datetime, timedelta
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
from app.schemas.stats import DailyActivity, DashboardStats, ModelStats

router = APIRouter(prefix="/stats", tags=["stats"])

# Blended cost per 1M tokens (input+output average) by council model
_MODEL_COST_PER_M: dict[str, float] = {
    "gpt-4o-mini": 0.30,
    "claude-3.5-haiku": 2.40,
    "gemini-2.0-flash": 0.25,
    "grok-2": 6.00,
}
_DEFAULT_COST_PER_M = 1.00


@router.get("", response_model=SuccessResponse[DashboardStats])
async def get_dashboard_stats(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[DashboardStats]:
    """
    Return aggregated dashboard statistics for the current user:
    - Total prompts optimized
    - Total tokens consumed and estimated cost
    - Prompt families saved
    - Daily optimization activity for the last 30 days
    - Per-model token breakdown from council votes
    """
    user_id = current_user.id

    # --- 1. Total prompts optimized ------------------------------------------
    count_stmt = (
        select(func.count())
        .select_from(Message)
        .join(ChatSession, Message.session_id == ChatSession.id)
        .where(ChatSession.user_id == user_id, Message.role == "assistant")
    )
    prompts_optimized: int = (await db.execute(count_stmt)).scalar_one() or 0

    # --- 2. Daily activity for the last 30 days --------------------------------
    thirty_days_ago = datetime.now(UTC) - timedelta(days=30)
    daily_stmt = (
        select(
            cast(Message.created_at, Date).label("day"),
            func.count().label("cnt"),
        )
        .join(ChatSession, Message.session_id == ChatSession.id)
        .where(
            ChatSession.user_id == user_id,
            Message.role == "assistant",
            Message.created_at >= thirty_days_ago,
        )
        .group_by(cast(Message.created_at, Date))
        .order_by(cast(Message.created_at, Date))
    )
    daily_rows = (await db.execute(daily_stmt)).all()
    activity_map: dict[str, int] = {str(row.day): row.cnt for row in daily_rows}

    # Zero-fill all 30 days so the chart has a continuous x-axis
    daily_activity: list[DailyActivity] = []
    for offset in range(30):
        d = (datetime.now(UTC) - timedelta(days=29 - offset)).date()
        daily_activity.append(DailyActivity(date=str(d), count=activity_map.get(str(d), 0)))

    # --- 3. Distinct prompt families saved ------------------------------------
    families_stmt = select(func.count(func.distinct(PromptVersion.prompt_id))).where(
        PromptVersion.user_id == user_id
    )
    versions_saved: int = (await db.execute(families_stmt)).scalar_one() or 0

    # --- 4. Load recent messages for token / model breakdown ------------------
    messages_stmt = (
        select(Message.token_usage, Message.council_votes)
        .join(ChatSession, Message.session_id == ChatSession.id)
        .where(ChatSession.user_id == user_id, Message.role == "assistant")
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
                # Prefer total_tokens; fall back to input + output
                tokens: int = int(usage.get("total_tokens") or 0) or (
                    int(usage.get("input_tokens") or 0) + int(usage.get("output_tokens") or 0)
                )
                model_tokens[model] = model_tokens.get(model, 0) + tokens

    # --- 5. Estimated cost and model breakdown --------------------------------
    estimated_cost = 0.0
    model_breakdown: list[ModelStats] = []

    for model, tokens in sorted(model_tokens.items(), key=lambda kv: -kv[1]):
        rate = _MODEL_COST_PER_M.get(model, _DEFAULT_COST_PER_M)
        estimated_cost += (tokens / 1_000_000) * rate
        model_breakdown.append(ModelStats(model=model, total_tokens=tokens))

    # Fallback when council_votes had no usage data but token_usage exists
    if not model_breakdown and total_tokens > 0:
        estimated_cost = (total_tokens / 1_000_000) * _DEFAULT_COST_PER_M

    return SuccessResponse(
        data=DashboardStats(
            prompts_optimized=prompts_optimized,
            total_tokens=total_tokens,
            estimated_cost_usd=round(estimated_cost, 4),
            versions_saved=versions_saved,
            credits_remaining=current_user.credits,
            daily_activity=daily_activity,
            model_breakdown=model_breakdown,
        )
    )
