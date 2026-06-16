from pydantic import BaseModel, Field

# --- Health Score ---


class MetricScore(BaseModel):
    score: int = Field(..., ge=1, le=10)
    rationale: str


class PromptHealthScoreRequest(BaseModel):
    prompt: str = Field(..., min_length=1)


class HealthMeta(BaseModel):
    overall_score: float
    grade: str
    deploy_ready: bool
    injection_risk: str


class HealthScores(BaseModel):
    clarity: MetricScore
    specificity: MetricScore
    completeness: MetricScore
    conciseness: MetricScore
    tone: MetricScore
    actionability: MetricScore
    context_richness: MetricScore
    goal_alignment: MetricScore
    injection_robustness: MetricScore
    reusability: MetricScore


class PromptHealthScoreResponse(BaseModel):
    prompt: str
    meta: HealthMeta
    scores: HealthScores
    critical_failures: list[str] = Field(default_factory=list)
    top_improvements: list[str] = Field(default_factory=list)
    deploy_verdict: str = ""


# --- Prompt Versioning ---


class PromptVersionCreateRequest(BaseModel):
    name: str = Field(
        ..., min_length=1, max_length=255, description="Human-readable name for this prompt family"
    )
    prompt: str = Field(..., min_length=1, description="The initial prompt text (becomes v1)")


class PromptVersionOut(BaseModel):
    version_id: str
    prompt_id: str
    name: str
    version: int
    content: str
    created_at: str
    is_favorited: bool = False
    favorite_id: str | None = None

    model_config = {"from_attributes": True}


class PromptVersionCreateResponse(BaseModel):
    prompt_id: str
    version: PromptVersionOut


class PromptVersionListResponse(BaseModel):
    prompt_id: str
    name: str
    versions: list[PromptVersionOut]


class PromptFamilyListResponse(BaseModel):
    families: list[PromptVersionListResponse]


class PaginatedPromptFamilyListResponse(BaseModel):
    page: int
    page_size: int
    total: int
    total_pages: int
    families: list[PromptVersionListResponse]


# --- Advisory ---


class PromptAdvisoryRequest(BaseModel):
    prompt: str = Field(..., min_length=1)


class AdvisoryMeta(BaseModel):
    overall_score: str  # LOW | MODERATE | HIGH
    injection_risk: str
    dimensions_evaluated: list[str]


class AdvisoryDimensionScores(BaseModel):
    role_and_persona: str
    task_clarity: str
    output_format: str
    constraints_and_guardrails: str
    context_and_grounding: str
    conciseness_and_signal_density: str
    injection_robustness: str


class PromptAdvisoryResponse(BaseModel):
    prompt: str
    meta: AdvisoryMeta
    strengths: list[str] = Field(default_factory=list)
    weaknesses: list[str] = Field(default_factory=list)
    improvements: list[str] = Field(default_factory=list)
    dimension_scores: AdvisoryDimensionScores | None = None
    overall_assessment: str = ""


# --- Diff ---


class DiffHunk(BaseModel):
    type: str  # "equal" | "insert" | "delete" | "replace"
    text: str | None = None
    from_text: str | None = None
    to_text: str | None = None


class DiffStats(BaseModel):
    added: int
    removed: int
    equal: int


class PromptDiffResponse(BaseModel):
    prompt_id: str
    from_version: int
    to_version: int
    from_content: str
    to_content: str
    hunks: list[DiffHunk]
    stats: DiffStats
