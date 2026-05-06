from datetime import datetime

from pydantic import BaseModel, Field


class CategoryResponse(BaseModel):
    slug: str
    name: str
    description: str
    is_predefined: bool
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class CategoryListResponse(BaseModel):
    categories: list[CategoryResponse]


class CategoryCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    description: str = Field(min_length=1, max_length=500)


class CategoryCreateResponse(BaseModel):
    category: CategoryResponse
