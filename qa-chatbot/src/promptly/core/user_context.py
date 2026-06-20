from dataclasses import dataclass
from uuid import UUID


@dataclass
class UserContext:
    user_id: UUID
    supabase_user_id: str
    email: str
    credits: int
    token_balance: int = 3_000_000
