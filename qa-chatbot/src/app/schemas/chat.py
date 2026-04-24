import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, model_validator


class ChatRequest(BaseModel):
    prompt: str | None = Field(
        default=None,
        min_length=1,
        description="Raw prompt text to optimize. Required when prompt_id is not supplied.",
    )
    prompt_id: uuid.UUID | None = Field(
        default=None,
        description=(
            "ID of an existing versioned prompt. When supplied the latest saved version "
            "is used as input and the optimized result is automatically saved as the next version."
        ),
    )
    name: str | None = Field(
        default=None,
        max_length=255,
        description=(
            "Assign a name to track this prompt as a versioned family. "
            "When combined with 'prompt', saves the optimized result as v1 of a new family "
            "(or appends to an existing family with the same name)."
        ),
    )
    session_id: uuid.UUID | None = Field(
        default=None,
        description="Existing session UUID to continue a prior conversation.",
    )
    feedback: str | None = Field(
        default=None,
        max_length=2000,
        description=(
            "Optional guidance that shapes how the prompt is optimized "
            "(e.g. 'keep it under 50 words', 'add a JSON output format')."
        ),
    )

    @model_validator(mode="after")
    def require_prompt_or_prompt_id(self) -> "ChatRequest":
        if not self.prompt and not self.prompt_id:
            raise ValueError(
                "Provide either 'prompt' (raw text) or 'prompt_id' (versioned prompt)."
            )
        return self


class CouncilProposal(BaseModel):
    model: str
    optimized_prompt: str
    usage: dict[str, Any]


class ChatResponse(BaseModel):
    session_id: str
    original_prompt: str
    optimized_prompt: str  # final synthesized best prompt
    council_proposals: list[CouncilProposal] | None = None
    token_usage: dict[str, Any]
    # Populated only when the result was saved as a new prompt version
    prompt_id: str | None = None
    version: int | None = None
    prompt_version_id: str | None = None


class MessageOut(BaseModel):
    id: uuid.UUID
    role: str
    raw_prompt: str | None
    response: str | None
    council_votes: list[Any] | None = None
    token_usage: dict[str, Any] | None = None
    prompt_version_id: uuid.UUID | None = None
    prompt_family_id: uuid.UUID | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


# --- Session history schemas ---


class SessionSummary(BaseModel):
    id: uuid.UUID
    title: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SessionsGroupedResponse(BaseModel):
    today: list[SessionSummary]
    last_7_days: list[SessionSummary]
    last_30_days: list[SessionSummary]
    older: list[SessionSummary]


class SessionDetailResponse(BaseModel):
    id: uuid.UUID
    title: str | None
    messages: list[MessageOut]
    created_at: datetime


# --- Prompt name suggestion ---


class SuggestNameRequest(BaseModel):
    prompt: str = Field(min_length=1)


class SuggestNameResponse(BaseModel):
    name: str


# --- Save version from chat response ---


class SaveVersionRequest(BaseModel):
    original_prompt: str = Field(min_length=1)
    optimized_prompt: str = Field(min_length=1)


class SaveVersionResponse(BaseModel):
    prompt_id: str
    name: str
    version: int


# --- Recent sessions widget ---


class RecentSessionWithPrompt(BaseModel):
    id: uuid.UUID
    title: str | None
    last_prompt: str | None  # raw_prompt of the most-recent user message, truncated
    updated_at: datetime


class RecentSessionsResponse(BaseModel):
    sessions: list[RecentSessionWithPrompt]


# --- Async job schemas (Celery queue pattern) ---


class ChatJobAcceptedResponse(BaseModel):
    """Returned immediately from POST /chat/ — the job has been queued."""

    job_id: str
    session_id: str
    status: str = "queued"
    prompt_id: str | None = None  # set when versioning is involved


class JobPollResponse(BaseModel):
    """Returned from GET /chat/jobs/{job_id} — poll until status is completed or failed."""

    job_id: str
    status: str  # queued | started | completed | failed
    result: ChatResponse | None = None  # populated when status == "completed"
    error: str | None = None  # populated when status == "failed"
