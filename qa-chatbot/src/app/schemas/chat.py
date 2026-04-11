import uuid

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=8000, description="Prompt to optimize")
    session_id: uuid.UUID | None = Field(
        default=None, description="Existing session UUID to continue"
    )
    feedback: str | None = Field(
        default=None,
        max_length=2000,
        description=(
            "Optional guidance that shapes how the prompt is optimized"
            " (e.g. 'keep it under 50 words', 'focus on tone')"
        ),
    )


class CouncilProposal(BaseModel):
    model: str
    optimized_prompt: str
    usage: dict


class ChatResponse(BaseModel):
    session_id: str
    original_prompt: str
    optimized_prompt: str  # final synthesized best prompt
    council_proposals: list[CouncilProposal] | None = None
    token_usage: dict


class MessageOut(BaseModel):
    id: uuid.UUID
    role: str
    raw_prompt: str | None
    response: str | None
    created_at: str

    model_config = {"from_attributes": True}
