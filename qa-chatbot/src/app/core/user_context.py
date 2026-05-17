from dataclasses import dataclass, field
from uuid import UUID


@dataclass
class UserContext:
    user_id: UUID
    clerk_user_id: str
    email: str
    credits: int
    org_id: str
    org_role: str
    permissions: list[str] = field(default_factory=list)
