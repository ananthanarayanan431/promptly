"""Proxy endpoints that surface OpenRouter account metrics and model catalogue."""

from __future__ import annotations

import time
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.types.response import SuccessResponse
from app.core.rate_limit import RateLimiter
from app.core.user_context import UserContext
from app.dependencies import get_current_user, get_db
from app.llm.settings import get_llm_settings
from app.models.message import Message
from app.models.session import ChatSession

router = APIRouter(prefix="/openrouter", tags=["openrouter"])
_limiter = RateLimiter(requests=30, window_seconds=60)

# Models list is identical for every user — cache in-process for 10 minutes
_models_cache: list[ModelInfo] = []
_models_cache_ts: float = 0.0
_MODELS_TTL = 600.0  # seconds

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


class ModelPricing(BaseModel):
    prompt_per_token: float  # USD per input token
    completion_per_token: float  # USD per output token


class ModelInfo(BaseModel):
    id: str  # OpenRouter slug, e.g. "openai/gpt-4o"
    name: str  # Display name, e.g. "OpenAI: GPT-4o"
    context_length: int | None
    modality: str | None  # e.g. "text+image->text"
    pricing: ModelPricing | None


class ModelListResponse(BaseModel):
    models: list[ModelInfo]
    cached: bool


# ── Cost table (blended $/1M tokens) ────────────────────────────────────────

_COST: dict[str, float] = {
    "gpt-4o-mini": 0.30,
    "claude-3.5-haiku": 2.40,
    "gemini-2.0-flash": 0.25,
    "gemini-2.5-flash": 0.60,
    "grok-2": 6.00,
    "grok-4.3": 3.00,
}
_DEFAULT_COST = 1.00


def _cost_per_token(model: str) -> float:
    # Strip provider prefix (e.g. "openai/gpt-4o" → "gpt-4o") before matching
    name = model.split("/", 1)[-1]
    if name in _COST:
        return _COST[name] / 1_000_000
    for slug, rate in _COST.items():
        if name.startswith(slug):
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
    "/models",
    response_model=SuccessResponse[ModelListResponse],
    dependencies=[Depends(_limiter)],
)
async def get_models(
    _: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[ModelListResponse]:
    """
    Return the full OpenRouter model catalogue.

    Response is cached in-process for 10 minutes — OpenRouter's list rarely
    changes and this endpoint is called on every modal open.
    """
    global _models_cache, _models_cache_ts  # noqa: PLW0603

    now = time.monotonic()
    if _models_cache and now - _models_cache_ts < _MODELS_TTL:
        return SuccessResponse(data=ModelListResponse(models=_models_cache, cached=True))

    headers = {"Authorization": f"Bearer {_api_key()}"}
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.get(f"{_BASE}/models", headers=headers)
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"OpenRouter models error: {resp.text[:200]}")

    raw: dict[str, object] = resp.json()
    raw_models: list[dict[str, object]] = raw.get("data", [])  # type: ignore[assignment]

    models: list[ModelInfo] = []
    for m in raw_models:
        if not isinstance(m, dict):
            continue
        model_id = str(m.get("id") or "")
        if not model_id:
            continue

        # Skip non-text-output models (image/audio generation)
        arch = m.get("architecture")
        modality: str | None = None
        if isinstance(arch, dict):
            modality = str(arch.get("modality") or "")
            out_mods = arch.get("output_modalities") or []
            if isinstance(out_mods, list) and "text" not in out_mods:
                continue

        pricing: ModelPricing | None = None
        raw_pricing = m.get("pricing")
        if isinstance(raw_pricing, dict):
            try:
                pricing = ModelPricing(
                    prompt_per_token=float(str(raw_pricing.get("prompt") or 0)),
                    completion_per_token=float(str(raw_pricing.get("completion") or 0)),
                )
            except (ValueError, TypeError):
                pass

        ctx = m.get("context_length")
        models.append(
            ModelInfo(
                id=model_id,
                name=str(m.get("name") or model_id),
                context_length=int(str(ctx)) if ctx is not None else None,
                modality=modality or None,
                pricing=pricing,
            )
        )

    # Sort: known providers first, then alphabetically
    _provider_order = [
        "openai",
        "anthropic",
        "google",
        "meta-llama",
        "mistralai",
        "x-ai",
        "deepseek",
        "qwen",
    ]

    def _sort_key(m: ModelInfo) -> tuple[int, str]:
        provider = m.id.split("/")[0]
        try:
            return (_provider_order.index(provider), m.id)
        except ValueError:
            return (len(_provider_order), m.id)

    models.sort(key=_sort_key)

    _models_cache = models
    _models_cache_ts = now

    return SuccessResponse(data=ModelListResponse(models=models, cached=False))


@router.get(
    "/stats",
    response_model=SuccessResponse[OpenRouterStats],
    dependencies=[Depends(_limiter)],
)
async def get_openrouter_stats(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[OpenRouterStats]:
    """Return OpenRouter key spend summary + per-model breakdown from local DB."""
    key_info = await _fetch_key_info()

    # ── Build per-model breakdown from DB council_votes ──────────────────────
    stmt = (
        select(Message.council_votes)
        .join(ChatSession, Message.session_id == ChatSession.id)
        .where(ChatSession.user_id == current_user.user_id, Message.council_votes.isnot(None))
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
