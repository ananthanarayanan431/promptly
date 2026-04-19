from datetime import datetime

from pydantic import BaseModel


class DailyActivity(BaseModel):
    date: str  # ISO date string YYYY-MM-DD
    count: int


class ModelStats(BaseModel):
    model: str
    total_tokens: int


class QualityTrendPoint(BaseModel):
    date: str  # ISO date string YYYY-MM-DD
    avg_score: float


class DashboardStats(BaseModel):
    # Core counters
    prompts_optimized: int
    total_sessions: int  # distinct chat sessions started
    total_tokens: int
    avg_tokens_per_run: int  # total_tokens / prompts_optimized
    estimated_cost_usd: float
    versions_saved: int  # distinct prompt families
    total_versions: int  # total individual version rows
    credits_remaining: int

    # Engagement signals
    streak_days: int  # consecutive days with ≥1 optimization
    last_optimized_at: datetime | None  # UTC datetime of most recent run
    top_model: str | None  # council model with highest token consumption

    # Chart data
    daily_activity: list[DailyActivity]  # last 30 days, zero-filled
    model_breakdown: list[ModelStats]  # per-council-model token totals
    quality_trend: list[QualityTrendPoint]  # avg health score per day, last 30 days
