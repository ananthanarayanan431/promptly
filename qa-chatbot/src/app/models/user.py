import uuid
from .base import Base
from .base import TimestampMixin
from .base import UUIDMixin
from sqlalchemy import String
from sqlalchemy import Boolean
from sqlalchemy import DateTime
from sqlalchemy import Integer
from sqlalchemy.orm import Mapped
from sqlalchemy.orm import mapped_column
from sqlalchemy.orm import relationship


class User(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str | None] = mapped_column(String(255), nullable=True)
    api_key_hash: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_superuser: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_login_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    credits: Mapped[int] = mapped_column(Integer, default=100, server_default="100", nullable=False)

    sessions: Mapped[list["ChatSession"]] = relationship(  # noqa: F821
        back_populates="user", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<User id={self.id} email={self.email}>"