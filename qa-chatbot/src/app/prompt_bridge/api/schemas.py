from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.prompt_bridge.data.models import TransferJobStatus

# ── Request bodies ─────────────────────────────────────────────────────────────


class TransferRequest(BaseModel):
    source_prompt: str = Field(min_length=10, max_length=50_000)
    source_model: str = Field(
        min_length=3,
        max_length=120,
        description="OpenRouter model slug for the source model, e.g. 'openai/gpt-4o'",
    )
    target_model: str = Field(
        min_length=3,
        max_length=120,
        description="OpenRouter model slug for the target model, e.g. 'anthropic/claude-3.5-haiku'",
    )


# ── Job responses ──────────────────────────────────────────────────────────────


class TransferJobCreatedResponse(BaseModel):
    job_id: str
    reused_mapping: bool
    credits_charged: int
    message: str


class TransferJobPollResponse(BaseModel):
    job_id: str
    status: str
    stage: str | None = None
    progress: dict[str, Any] | None = None
    result: TransferResultPayload | None = None
    error: str | None = None


class TransferResultPayload(BaseModel):
    adapted_prompt: str
    source_model: str
    target_model: str
    mapping_id: uuid.UUID
    reused_mapping: bool
    credits_charged: int


# ── Mapping responses ──────────────────────────────────────────────────────────


class PromptPairResponse(BaseModel):
    id: uuid.UUID
    source_optimal_prompt: str
    target_optimal_prompt: str
    source_score: float | None
    target_score: float | None
    created_at: datetime

    model_config = {"from_attributes": True}


class PromptMappingResponse(BaseModel):
    id: uuid.UUID
    source_model: str
    target_model: str
    mapping_text: str
    pair_count: int
    avg_source_score: float | None
    avg_target_score: float | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PromptMappingDetailResponse(PromptMappingResponse):
    pairs: list[PromptPairResponse]

    model_config = {"from_attributes": True}


class MappingListResponse(BaseModel):
    mappings: list[PromptMappingResponse]


class DeleteMappingResponse(BaseModel):
    mapping_id: uuid.UUID
    deleted: bool


# ── Job list ───────────────────────────────────────────────────────────────────


class TransferJobSummary(BaseModel):
    id: uuid.UUID
    source_model: str
    target_model: str
    status: TransferJobStatus
    reused_mapping: bool
    credits_charged: int
    adapted_prompt: str | None
    error_message: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class TransferJobListResponse(BaseModel):
    jobs: list[TransferJobSummary]
