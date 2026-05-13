"""Proxy endpoint that surfaces OpenRouter account metrics to the frontend."""

from __future__ import annotations

from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.types.response import SuccessResponse
from app.core.rate_limit import RateLimiter
from app.dependencies import get_current_user, get_db
from app.llm.settings import get_llm_settings
from app.models.message import Message
from app.models.session import ChatSession
from app.models.user import User

router = APIRouter(prefix="/openrouter", tags=["openrouter"])
_limiter = RateLimiter(requests=30, window_seconds=60)

_BASE = "https://openrouter.ai/api/v1"
_TIMEOUT = 10.0


# ── Response shapes ──────────────────────────────────────────────────────────


class SpendPeriod(BaseModel):
    daily: float
    weekly: float
    monthly: float
    all_time: float


class KeyData(BaseModel):
    label: str
    spend: SpendPeriod
    limit: float | None
    limit_remaining: float | None
    is_free_tier: bool


class ModelSpend(BaseModel):
    model: str
    total_tokens: int
    total_cost_usd: float


class OpenRouterStats(BaseModel):
    key: KeyData
    top_models: list[ModelSpend]


# ── Cost table (blended $/1M tokens) ────────────────────────────────────────

_COST: dict[str, float] = {
    "gpt-4o-mini": 0.30,
    "claude-3.5-haiku": 2.40,
    "gemini-2.0-flash": 0.25,
    "gemini-2.5-flash": 0.60,
    "grok-2": 6.00,
    "grok-4.1-fast": 3.00,
}
_DEFAULT_COST = 1.00


def _cost_per_token(model: str) -> float:
    for slug, rate in _COST.items():
        if slug in model:
            return rate / 1_000_000
    return _DEFAULT_COST / 1_000_000


# ── Helpers ──────────────────────────────────────────────────────────────────


def _api_key() -> str:
    return get_llm_settings().OPENROUTER_API_KEY.get_secret_value()


async def _fetch_key_info() -> dict[str, object]:
    headers = {"Authorization": f"Bearer {_api_key()}"}
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.get(f"{_BASE}/auth/key", headers=headers)
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"OpenRouter error: {resp.text[:200]}")
    raw: dict[str, object] = resp.json()
    data = raw.get("data", raw)
    return data if isinstance(data, dict) else raw


# ── Routes ───────────────────────────────────────────────────────────────────


@router.get(
    "/stats",
    response_model=SuccessResponse[OpenRouterStats],
    dependencies=[Depends(_limiter)],
)
async def get_openrouter_stats(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[OpenRouterStats]:
    """Return OpenRouter key spend summary + per-model breakdown from local DB."""
    key_info = await _fetch_key_info()

    # ── Build per-model breakdown from DB council_votes ──────────────────────
    stmt = (
        select(Message.council_votes)
        .join(ChatSession, Message.session_id == ChatSession.id)
        .where(ChatSession.user_id == current_user.id, Message.council_votes.isnot(None))
        .order_by(Message.created_at.desc())
        .limit(500)
    )
    rows = (await db.execute(stmt)).scalars().all()

    model_tokens: dict[str, int] = {}
    for council_votes in rows:
        if not isinstance(council_votes, list):
            continue
        for vote in council_votes:
            if not isinstance(vote, dict):
                continue
            model: str = str(vote.get("model") or "unknown")
            usage = vote.get("usage") or {}
            if not isinstance(usage, dict):
                continue
            tokens: int = int(str(usage.get("total_tokens") or 0)) or (
                int(str(usage.get("input_tokens") or 0)) + int(str(usage.get("output_tokens") or 0))
            )
            model_tokens[model] = model_tokens.get(model, 0) + tokens

    top_models = sorted(
        [
            ModelSpend(
                model=m,
                total_tokens=t,
                total_cost_usd=round(t * _cost_per_token(m), 6),
            )
            for m, t in model_tokens.items()
        ],
        key=lambda x: -x.total_cost_usd,
    )[:10]

    # ── Key spend data ────────────────────────────────────────────────────────
    def _f(key: str) -> float:
        return float(str(key_info.get(key) or 0))

    spend = SpendPeriod(
        daily=round(_f("usage_daily"), 6),
        weekly=round(_f("usage_weekly"), 6),
        monthly=round(_f("usage_monthly"), 6),
        all_time=round(_f("usage"), 6),
    )

    limit_val = key_info.get("limit")
    limit_usd: float | None = float(str(limit_val)) if limit_val is not None else None
    remaining: float | None = (
        round(limit_usd - spend.all_time, 6) if limit_usd is not None else None
    )

    key_data = KeyData(
        label=str(key_info.get("label") or "API Key"),
        spend=spend,
        limit=limit_usd,
        limit_remaining=remaining,
        is_free_tier=bool(key_info.get("is_free_tier", False)),
    )

    return SuccessResponse(data=OpenRouterStats(key=key_data, top_models=top_models))
