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
    win_rate: float | None
    candidates_tried: int | None
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
    domain_id: uuid.UUID


class DomainJobPollResponse(BaseModel):
    job_id: str
    status: str
    domain_id: uuid.UUID | None = None
    result: dict[str, Any] | None = None
    error: str | None = None


class DeleteDomainResponse(BaseModel):
    domain_id: uuid.UUID


class QAPair(BaseModel):
    question: str = Field(min_length=1)
    answer: str = Field(min_length=1)


class DatasetRowsResponse(BaseModel):
    rows: list[QAPair]
    row_count: int


class UpdateDatasetRequest(BaseModel):
    rows: list[QAPair] = Field(min_length=1)


class AugmentDatasetRequest(BaseModel):
    count: int = Field(default=10, ge=1, le=50)
