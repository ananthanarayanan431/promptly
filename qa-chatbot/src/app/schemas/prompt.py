from pydantic import BaseModel, Field


class PromptEnhanceRequest(BaseModel):
    raw_prompt: str = Field(..., min_length=1, max_length=8000)


class PromptEnhanceResponse(BaseModel):
    raw_prompt: str
    enhanced_prompt: str


# --- Health Score ---


class MetricScore(BaseModel):
    score: int = Field(..., ge=1, le=10)
    rationale: str


class PromptHealthScoreRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=8000)


class PromptHealthScoreResponse(BaseModel):
    prompt: str
    clarity: MetricScore
    specificity: MetricScore
    completeness: MetricScore
    conciseness: MetricScore
    tone: MetricScore
    actionability: MetricScore
    context_richness: MetricScore
    goal_alignment: MetricScore
    overall_score: float


# --- Prompt Versioning ---


class PromptVersionCreateRequest(BaseModel):
    name: str = Field(
        ..., min_length=1, max_length=255, description="Human-readable name for this prompt family"
    )
    prompt: str = Field(
        ..., min_length=1, max_length=8000, description="The initial prompt text (becomes v1)"
    )


class PromptVersionOptimizeRequest(BaseModel):
    feedback: str | None = Field(
        default=None,
        max_length=2000,
        description="Optional guidance that shapes how the council optimizes this version",
    )


class PromptVersionOut(BaseModel):
    version_id: str
    prompt_id: str
    name: str
    version: int
    content: str
    created_at: str

    model_config = {"from_attributes": True}


class PromptVersionCreateResponse(BaseModel):
    prompt_id: str
    version: PromptVersionOut


class PromptVersionOptimizeResponse(BaseModel):
    prompt_id: str
    original: PromptVersionOut
    optimized: PromptVersionOut


class PromptVersionListResponse(BaseModel):
    prompt_id: str
    name: str
    versions: list[PromptVersionOut]


class PromptFamilyListResponse(BaseModel):
    families: list[PromptVersionListResponse]


# --- Advisory ---


class PromptAdvisoryRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=8000)


class PromptAdvisoryResponse(BaseModel):
    prompt: str
    strengths: list[str]
    weaknesses: list[str]
    improvements: list[str]
    overall_assessment: str
