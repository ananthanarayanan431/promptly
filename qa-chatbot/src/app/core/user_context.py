from dataclasses import dataclass
from uuid import UUID


@dataclass
class UserContext:
    user_id: UUID
    clerk_user_id: str
    email: str
    credits: int
    org_id: str
