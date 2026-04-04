import uuid
import datetime
from pydantic import BaseModel
from pydantic import ConfigDict

class CreditResponse(BaseModel):
    credits: int

class AddCreditRequest(BaseModel):
    amount: int

class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str | None = None
    is_active: bool
    credits: int
    last_login_at: datetime.datetime | None = None
    
    model_config = ConfigDict(from_attributes=True)
