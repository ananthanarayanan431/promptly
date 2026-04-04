from pydantic import BaseModel
from pydantic import Field


class PromptEnhanceRequest(BaseModel):
    raw_prompt: str = Field(..., min_length=1, max_length=8000)


class PromptEnhanceResponse(BaseModel):
    raw_prompt: str
    enhanced_prompt: str