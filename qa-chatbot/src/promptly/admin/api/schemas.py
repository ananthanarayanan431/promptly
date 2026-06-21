from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class AdminUserItem(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str | None
    credits: int
    token_balance: int
    is_active: bool
    is_admin: bool
    last_login_at: datetime | None
    created_at: datetime

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


class AdminStats(BaseModel):
    total_users: int
    total_optimizations: int
    total_tokens_consumed: int
    active_users_7d: int


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
