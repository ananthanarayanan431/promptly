import uuid

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=8000, description="Raw user prompt")
    session_id: uuid.UUID | None = Field(
        default=None, description="Existing session UUID to continue"
    )


class CouncilVote(BaseModel):
    model: str
    response: str
    usage: dict


class ChatResponse(BaseModel):
    session_id: str
    enhanced_prompt: str
    response: str
    token_usage: dict
    council_votes: list[CouncilVote] | None = None


class MessageOut(BaseModel):
    id: uuid.UUID
    role: str
    raw_prompt: str | None
    enhanced_prompt: str | None
    response: str | None
    created_at: str

    model_config = {"from_attributes": True}
