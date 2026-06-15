import uuid

from pydantic import BaseModel, ConfigDict


class CreditResponse(BaseModel):
    credits: int


class AddCreditRequest(BaseModel):
    amount: int


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    credits: int

    model_config = ConfigDict(from_attributes=True)
