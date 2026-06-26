from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from promptly.domain_prompt.data.models import DomainPromptStatus


class CreateDomainRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)


class OptimizeDomainRequest(BaseModel):
    prompt: str = Field(min_length=10, max_length=50000)
    algorithm: str = Field(default="pdo", pattern="^(pdo|gepa)$")
    budget_tier: str = Field(default="low", pattern="^(low|medium|high)$")


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
    stage: str | None = None
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


class TournamentStateResponse(BaseModel):
    round: int
    total_rounds: int
    candidate_count: int
    names: list[str]
    copeland_scores: list[float]
    avg_win_rates: list[float]
    W: list[list[float]]
    duel_i: int
    duel_j: int
    question: str
    answer_a: str | None = None
    answer_b: str | None = None


class OptimizationRunResponse(BaseModel):
    id: uuid.UUID
    domain_id: uuid.UUID
    domain_name: str
    prompt_input: str
    optimized_prompt: str | None
    score_before: float | None
    score_after: float | None
    win_rate: float | None
    candidates_tried: int | None
    rounds_run: int | None
    dataset_size: int | None
    status: str
    error_message: str | None
    algorithm: str = "pdo"
    total_tokens: int | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class GepaTraceItem(BaseModel):
    input: str
    output: str
    score: float
    feedback: str


class GepaCandidate(BaseModel):
    id: str
    score: float
    desc: str
    delta: str | None = None
    star: bool = False
    cells: list[float] = []


class GepaPending(BaseModel):
    parent: str
    fail: bool = False


class GepaCurrentIter(BaseModel):
    parent: str
    cur_prompt: str
    ancestor: str
    traces: list[GepaTraceItem] = []
    reasoning: list[str] = []
    new_prompt: str = ""
    sigma: float = 0.0
    sigma_p: float | None = None
    accept: bool | None = None


class GepaStateResponse(BaseModel):
    phase: str
    step: str | None
    done_steps: list[str]
    iter_idx: int
    sub: str | None
    pool: list[GepaCandidate]
    pending: GepaPending | None
    budget_used: int
    budget_max: int | None = None
    n_pareto_size: int | None = None
    full_pct: float
    baseline: float | None
    current_iter: GepaCurrentIter | None


class RunListResponse(BaseModel):
    runs: list[OptimizationRunResponse]


class CancelDomainJobResponse(BaseModel):
    job_id: str
    domain_id: str
    cancelled: bool
