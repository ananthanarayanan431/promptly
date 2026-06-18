from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class CreateSkillProjectRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    task_description: str = Field(
        min_length=10,
        max_length=5000,
        description="What task should the skill document optimise for?",
    )
    description: str | None = Field(default=None, max_length=500)


class SkillExample(BaseModel):
    input: str = Field(min_length=1, description="Task input / question")
    expected: str = Field(min_length=1, description="Expected / reference answer")


class SetExamplesRequest(BaseModel):
    examples: list[SkillExample] = Field(min_length=6, max_length=500)


class OptimizeSkillRequest(BaseModel):
    budget_tier: str = Field(default="low", pattern="^(low|medium|high)$")
    llm_effort: str | None = Field(
        default=None,
        pattern="^(low|medium|high)$",
        description=(
            "Model quality tier for the executor model. "
            "'low'=gemini-2.0-flash, 'medium'=claude-3.5-haiku (default), 'high'=gpt-4o."
        ),
    )


class SkillJobResponse(BaseModel):
    job_id: str
    project_id: uuid.UUID


class SkillJobPollResponse(BaseModel):
    job_id: str
    status: str
    result: dict[str, Any] | None = None
    error: str | None = None


class SkillRunResponse(BaseModel):
    id: uuid.UUID
    epoch: int
    score_before: float | None
    score_after: float | None
    edits_proposed: int | None
    edits_accepted: int | None
    edits_rejected: int | None
    rollout_count: int | None
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class SkillProjectResponse(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    task_description: str
    status: str
    seed_skill: str | None
    best_skill: str | None
    score_before: float | None
    score_after: float | None
    epochs_run: int | None
    edits_accepted: int | None
    edits_rejected: int | None
    example_count: int | None
    credits_charged: int
    error_message: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SkillProjectListResponse(BaseModel):
    projects: list[SkillProjectResponse]


class SkillExamplesResponse(BaseModel):
    examples: list[SkillExample]
    count: int


class DeleteSkillProjectResponse(BaseModel):
    project_id: uuid.UUID


# ── Live state ────────────────────────────────────────────────────────────────


class SkillEditItem(BaseModel):
    op: str  # ADD | DELETE | REPLACE
    text: str
    accepted: bool


class SkillOptLiveState(BaseModel):
    phase: str  # seed | rollout | reflect | gate | slow_update | completed | failed
    epoch: int
    total_epochs: int
    epoch_pct: float
    current_score: float | None
    best_score: float | None
    edits_accepted: int
    edits_rejected: int
    rollout_done: int
    rollout_total: int
    recent_edits: list[SkillEditItem]
    current_skill_preview: str  # first ~300 chars of current skill


class SkillOptLiveStateResponse(BaseModel):
    """Wrapper so SuccessResponse generic constraint is satisfied (BaseModel required)."""

    state: SkillOptLiveState | None


class SkillRunListResponse(BaseModel):
    runs: list[SkillRunResponse]
