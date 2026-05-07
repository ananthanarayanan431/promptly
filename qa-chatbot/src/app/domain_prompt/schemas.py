from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.domain_prompt.models import DomainPromptStatus


class CreateDomainRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)


class OptimizeDomainRequest(BaseModel):
    prompt: str = Field(min_length=10, max_length=10000)


class DatasetInfo(BaseModel):
    row_count: int | None
    pdf_key: str
    dataset_key: str | None

    model_config = {"from_attributes": True}


class DomainPromptResponse(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    last_prompt: str | None
    optimized_prompt: str | None
    status: DomainPromptStatus
    score_before: float | None
    score_after: float | None
    credits_charged: int
    error_message: str | None
    dataset: DatasetInfo | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class DomainListResponse(BaseModel):
    domains: list[DomainPromptResponse]


class CreateDomainJobResponse(BaseModel):
    job_id: str
    domain_id: str


class DomainJobPollResponse(BaseModel):
    job_id: str
    status: str
    domain_id: str | None = None
    result: dict[str, Any] | None = None
    error: str | None = None


class DeleteDomainResponse(BaseModel):
    deleted: str
