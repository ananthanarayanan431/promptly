import uuid

from pydantic import BaseModel, ConfigDict

TOKEN_START: int = 3_000_000


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    credits: int
    token_balance: int = TOKEN_START
    is_admin: bool = False

    model_config = ConfigDict(from_attributes=True)
