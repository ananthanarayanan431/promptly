import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator


class ApiKeyCreateRequest(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def name_must_be_non_blank_and_short(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name must not be blank")
        if len(v) > 100:
            raise ValueError("name must be 100 characters or fewer")
        return v


class ApiKeyCreatedResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    key: str
    created_at: datetime


class ApiKeyResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    is_active: bool
    created_at: datetime
    revoked_at: datetime | None


class ApiKeyListResponse(BaseModel):
    keys: list[ApiKeyResponse]
