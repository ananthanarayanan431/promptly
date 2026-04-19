from pydantic import BaseModel


class TemplateOut(BaseModel):
    id: str
    category: str
    name: str
    description: str
    content: str

    model_config = {"from_attributes": True}


class TemplateCategoryGroup(BaseModel):
    category: str
    templates: list[TemplateOut]


class TemplateListResponse(BaseModel):
    categories: list[TemplateCategoryGroup]
    total: int
