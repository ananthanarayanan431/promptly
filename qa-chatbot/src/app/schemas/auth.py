from pydantic import BaseModel, EmailStr
from uuid import UUID

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: str | None = None

class UserResponse(BaseModel):
    id: UUID
    email: EmailStr
    full_name: str | None = None
    is_active: bool

    model_config = {"from_attributes": True}

class Token(BaseModel):
    access_token: str
    token_type: str
