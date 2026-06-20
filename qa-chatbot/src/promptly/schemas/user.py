import uuid

from pydantic import BaseModel, ConfigDict


class CreditResponse(BaseModel):
    credits: int


class AddCreditRequest(BaseModel):
    amount: int


TOKEN_START: int = 3_000_000


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    credits: int
    token_balance: int = TOKEN_START

    model_config = ConfigDict(from_attributes=True)
