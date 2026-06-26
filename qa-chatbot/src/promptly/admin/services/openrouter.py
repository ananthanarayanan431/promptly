from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from promptly.admin.api.schemas import (
    AdminOpenRouterInfo,
    DailySpend,
    ModelSpendItem,
)
from promptly.llm.settings import get_llm_settings
from promptly.models.message import Message

# ── Hardcoded cost table ($/1M tokens, avg of input+output) ──────────────────

_OR_COST_IO: dict[str, tuple[float, float]] = {
    "llama-3.2-3b-instruct": (0.051, 0.34),
    "mistral-7b-instruct": (0.13, 0.13),
    "gemini-2.0-flash": (0.10, 0.40),
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4.1-mini": (0.40, 1.60),
    "claude-3-haiku": (0.25, 1.25),
    "gemini-2.5-flash": (0.30, 2.50),
    "grok-4.3": (1.25, 2.50),
    "gpt-4o": (2.50, 10.00),
    "claude-3.5-sonnet": (3.00, 15.00),
    "gemini-2.5-pro": (1.25, 10.00),
    "grok-3": (3.00, 15.00),
    "grok-2": (2.00, 10.00),
    "gemini-2.0-flash-lite": (0.075, 0.30),
}
_OR_DEFAULT_COST_PER_TOKEN: float = 2.50 / 1_000_000


def cost_per_token(model: str) -> float:
    name = model.split("/")[-1] if "/" in model else model
    pair = _OR_COST_IO.get(name)
    if pair is not None:
        return (pair[0] + pair[1]) / 2 / 1_000_000
    return _OR_DEFAULT_COST_PER_TOKEN


# ── Live pricing cache (10-minute TTL) ───────────────────────────────────────

_or_live_pricing: dict[str, float] = {}
_or_live_pricing_ts: float = 0.0
_OR_PRICING_TTL = 600.0


async def fetch_or_model_pricing() -> dict[str, float]:
    """Return {model_slug: blended_cost_per_token} from OpenRouter /models, cached 10 min."""
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
        return _or_live_pricing

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

    if result:
        _or_live_pricing = result
        _or_live_pricing_ts = now

    return result


def live_cost_per_token(model: str, pricing: dict[str, float]) -> float:
    """$/token from live pricing dict, falling back to hardcoded table."""
    if model in pricing:
        return pricing[model]
    return cost_per_token(model)


async def _fetch_or_key_info() -> dict[str, Any]:
    llm = get_llm_settings()
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(
            "https://openrouter.ai/api/v1/auth/key",
            headers={"Authorization": f"Bearer {llm.OPENROUTER_API_KEY.get_secret_value()}"},
        )
        resp.raise_for_status()
    return dict(resp.json().get("data", {}))


async def fetch_openrouter_info(db: AsyncSession) -> AdminOpenRouterInfo:
    """Combine live OpenRouter key data with local 30-day daily spend history."""
    key_info = await _fetch_or_key_info()

    def _kf(key: str) -> float:
        return float(str(key_info.get(key) or 0))

    limit_val = key_info.get("limit")
    limit_usd: float | None = float(str(limit_val)) if limit_val is not None else None
    all_time_spend = round(_kf("usage"), 6)
    limit_remaining: float | None = (
        round(limit_usd - all_time_spend, 6) if limit_usd is not None else None
    )

    cutoff = datetime.now(UTC) - timedelta(days=30)
    msg_rows = (
        await db.execute(
            select(Message.council_votes, Message.created_at, Message.session_id)
            .where(Message.council_votes.isnot(None), Message.created_at >= cutoff)
            .order_by(Message.created_at.asc())
        )
    ).fetchall()

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
            c = tokens * cost_per_token(model)
            day_tokens[day] = day_tokens[day] + tokens
            day_cost[day] = day_cost[day] + c
            all_model_tokens[model] = all_model_tokens.get(model, 0) + tokens

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
                total_cost_usd=round(t * cost_per_token(m), 6),
            )
            for m, t in all_model_tokens.items()
        ],
        key=lambda x: -x.total_cost_usd,
    )[:10]

    return AdminOpenRouterInfo(
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
