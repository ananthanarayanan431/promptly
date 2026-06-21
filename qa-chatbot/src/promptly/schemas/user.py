import uuid

from pydantic import BaseModel, ConfigDict

TOKEN_START: int = 3_000_000


class TokenResponse(BaseModel):
    token_balance: int


class AddTokenRequest(BaseModel):
    amount: int


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    credits: int
    token_balance: int = TOKEN_START
    is_admin: bool = False
    data_sharing_enabled: bool = False

    model_config = ConfigDict(from_attributes=True)


class UserSettingsPatch(BaseModel):
    data_sharing_enabled: bool | None = None
