from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class FavoriteCategory(StrEnum):
    WRITING = "Writing"
    CODING = "Coding"
    ANALYSIS = "Analysis"
    OTHER = "Other"


class FavoriteCreateRequest(BaseModel):
    prompt_version_id: uuid.UUID


class FavoriteUpdateRequest(BaseModel):
    note: str | None = Field(default=None, max_length=4000)
    tags: list[str] | None = Field(default=None, max_length=10)
    category: FavoriteCategory | None = None
    is_pinned: bool | None = None


class FavoriteResponse(BaseModel):
    id: uuid.UUID
    prompt_version_id: uuid.UUID
    prompt_id: str
    family_name: str
    version: int
    content: str

    note: str | None
    tags: list[str]
    category: str
    is_pinned: bool
    use_count: int
    last_used_at: datetime | None
    liked_at: datetime
    version_created_at: datetime
    token_usage: dict[str, Any] | None = None


class FavoriteListResponse(BaseModel):
    items: list[FavoriteResponse]
    total: int
    limit: int
    offset: int


class FavoriteStatusResponse(BaseModel):
    is_favorited: bool
    prompt_store_id: uuid.UUID | None


class FavoriteTagsResponse(BaseModel):
    tags: list[str]
