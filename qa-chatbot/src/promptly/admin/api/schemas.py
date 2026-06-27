from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class AdminUserItem(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str | None
    avatar_url: str | None
    credits: int
    token_balance: int
    is_active: bool
    is_admin: bool
    last_login_at: datetime | None
    created_at: datetime
    session_count: int = 0
    last_session_at: datetime | None = None
    api_key_count: int = 0
    data_sharing_enabled: bool = False
    total_tokens_consumed: int = 0

    model_config = ConfigDict(from_attributes=True)


class AdminUserPatch(BaseModel):
    is_active: bool | None = None
    is_admin: bool | None = None
    credits_delta: int | None = Field(default=None, ge=-10_000)


class AdminUserList(BaseModel):
    page: int
    per_page: int
    total: int
    users: list[AdminUserItem]


class DailyActivity(BaseModel):
    date: str  # YYYY-MM-DD
    calls: int
    tokens: int


class FeatureUsage(BaseModel):
    feature: str
    calls: int
    label: str


class TopUser(BaseModel):
    email: str
    tokens_consumed: int
    token_balance: int
    calls: int


class AdminStats(BaseModel):
    # Users
    total_users: int
    new_users_7d: int
    new_users_30d: int
    active_users_7d: int
    # Usage
    total_optimizations: int
    total_tokens_consumed: int
    total_token_budget: int
    avg_tokens_per_user: int
    token_budget_used_pct: float
    # Feature breakdown
    feature_usage: list[FeatureUsage]
    # Chart data (last 14 days)
    daily_activity: list[DailyActivity]
    # Top consumers
    top_users: list[TopUser]


class RateLimitEntry(BaseModel):
    user_id: str
    route: str
    hit_count: int


class RateLimitList(BaseModel):
    entries: list[RateLimitEntry]


class GlitchTipIssue(BaseModel):
    id: str
    title: str
    occurrences: int
    status: str
    first_seen: str
    last_seen: str


class GlitchTipIssueList(BaseModel):
    issues: list[GlitchTipIssue]


class AdminUserPrompt(BaseModel):
    session_id: uuid.UUID
    original_prompt: str | None
    optimized_prompt: str | None
    tokens_used: int
    created_at: datetime


class AdminUserPromptList(BaseModel):
    user_id: uuid.UUID
    data_sharing_enabled: bool
    page: int
    per_page: int
    total: int
    prompts: list[AdminUserPrompt]


class ModelSpendItem(BaseModel):
    model: str
    total_tokens: int
    total_cost_usd: float


class DailySpend(BaseModel):
    date: str  # YYYY-MM-DD
    sessions: int
    total_tokens: int
    total_cost_usd: float


class AdminOpenRouterInfo(BaseModel):
    label: str
    is_free_tier: bool
    all_time_spend: float
    monthly_spend: float
    weekly_spend: float
    daily_spend_today: float
    limit: float | None
    limit_remaining: float | None
    daily_history: list[DailySpend]  # last 30 days oldest-first
    top_models: list[ModelSpendItem]


# ── Feature 1: System Health ──────────────────────────────────────────────────


class RedisHealth(BaseModel):
    status: str
    used_memory_human: str
    connected_clients: int
    total_keys: int


class DatabaseHealth(BaseModel):
    status: str
    response_time_ms: float


class WorkerHealth(BaseModel):
    status: str
    active_count: int
    worker_names: list[str]


class QueueHealth(BaseModel):
    pending_chat: int
    active_chat: int
    pending_domain: int
    active_domain: int


class SystemHealth(BaseModel):
    redis: RedisHealth
    database: DatabaseHealth
    workers: WorkerHealth
    queue: QueueHealth
    checked_at: str


# ── Feature 2: User Activity ──────────────────────────────────────────────────


class UserActivitySession(BaseModel):
    id: str
    title: str | None
    created_at: str
    token_count: int
    message_count: int


class UserActivity(BaseModel):
    user_id: str
    email: str
    sessions: list[UserActivitySession]
    feature_counts: dict[str, int]
    total_tokens_consumed: int
    session_count: int
    first_seen: str
    last_seen: str | None


# ── Feature 3: Rate Limit Reset ───────────────────────────────────────────────


class RateLimitResetResult(BaseModel):
    deleted: bool
    key: str


# ── Feature 4: API Keys ───────────────────────────────────────────────────────


class AdminApiKeyItem(BaseModel):
    id: str
    name: str
    user_id: str
    user_email: str
    is_active: bool
    created_at: str
    revoked_at: str | None

    model_config = ConfigDict(from_attributes=False)


class AdminApiKeyList(BaseModel):
    page: int
    per_page: int
    total: int
    keys: list[AdminApiKeyItem]


class RevokeApiKeyResult(BaseModel):
    id: str
    revoked: bool


# ── Feature 5: Audit Log ──────────────────────────────────────────────────────


class AuditLogEntry(BaseModel):
    id: str
    admin_email: str
    action: str
    target_email: str | None
    details: dict[str, object] | None
    created_at: str


class AuditLogList(BaseModel):
    page: int
    per_page: int
    total: int
    entries: list[AuditLogEntry]


# ── Feature 6: Jobs Monitor ───────────────────────────────────────────────────


class JobEntry(BaseModel):
    job_id: str
    type: str
    status: str
    user_id: str | None


class JobsSummary(BaseModel):
    queued: int
    running: int
    completed: int
    failed: int


class JobsMonitor(BaseModel):
    jobs: list[JobEntry]
    summary: JobsSummary


# ── Feature 7: Bulk Token Grant ───────────────────────────────────────────────


class BulkTokenRequest(BaseModel):
    user_ids: list[str]
    amount: int = Field(ge=1)


class BulkTokenResult(BaseModel):
    updated: int
    amount: int


# ── Feature 8: Domain File Library ───────────────────────────────────────────


class AdminDomainItem(BaseModel):
    domain_id: uuid.UUID
    domain_name: str
    user_id: uuid.UUID
    user_email: str
    status: str
    row_count: int | None
    has_pdf: bool
    has_dataset: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=False)


class AdminDomainList(BaseModel):
    page: int
    per_page: int
    total: int
    domains: list[AdminDomainItem]


class AdminDomainQARow(BaseModel):
    question: str
    answer: str


class AdminDomainQAResponse(BaseModel):
    domain_id: uuid.UUID
    domain_name: str
    user_email: str
    rows: list[AdminDomainQARow]
    row_count: int


# ── Analytics ─────────────────────────────────────────────────────────────────


class AnalyticsPoint(BaseModel):
    date: str  # "YYYY-MM-DD" or "YYYY-MM" or "YYYY-Qn"
    value: float


class AnalyticsSeries(BaseModel):
    key: str
    label: str
    total: float
    time_range: str
    data: list[AnalyticsPoint]
    chart_type: str = "line"  # "line" | "bar"
    color: str | None = None


class AnalyticsResponse(BaseModel):
    view: str
    generated_at: str
    statics: dict[str, float | int | str]
    series: list[AnalyticsSeries]
    raw: dict[str, Any] = {}  # unstructured payloads (issue objects, releases, etc.)
