from dataclasses import dataclass
from uuid import UUID


@dataclass
class UserContext:
    user_id: UUID
    supabase_user_id: str
    email: str
    credits: int
    org_id: str
