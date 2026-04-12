from pydantic import BaseModel


class DailyActivity(BaseModel):
    date: str  # ISO date string YYYY-MM-DD
    count: int


class ModelStats(BaseModel):
    model: str
    total_tokens: int


class DashboardStats(BaseModel):
    prompts_optimized: int
    total_tokens: int
    estimated_cost_usd: float
    versions_saved: int
    credits_remaining: int
    daily_activity: list[DailyActivity]  # last 30 days, zero-filled
    model_breakdown: list[ModelStats]  # per-council-model token totals
