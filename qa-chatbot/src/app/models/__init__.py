# Import all ORM models here so SQLAlchemy's mapper registry has every class
# available before any relationship string-reference is resolved.
#
# Ordering matters: Base classes (no FKs pointing to others) first,
# then dependent tables.
from app.models.health_score import HealthScore
from app.models.message import Message
from app.models.prompt_version import PromptVersion
from app.models.session import ChatSession
from app.models.template import Template
from app.models.user import User

__all__ = ["User", "ChatSession", "Message", "PromptVersion", "Template", "HealthScore"]
