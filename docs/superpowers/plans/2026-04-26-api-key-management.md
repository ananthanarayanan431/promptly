# API Key Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow each user to create, list, and revoke multiple named `qac_`-prefixed API keys stored in a new `api_keys` table, with auth wired through `get_current_user`.

**Architecture:** New `ApiKey` ORM model + `ApiKeyRepository` + 4 REST endpoints under `/users/api-keys`. `get_current_user` in `dependencies.py` checks the new table first (by hash + `is_active=True`), then falls back to the legacy `User.api_key_hash` column so nothing breaks for existing users.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async, Alembic, Pydantic v2, pytest-asyncio, `uv run` for all commands.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/app/models/api_key.py` | Create | `ApiKey` ORM model |
| `src/app/models/__init__.py` | Modify | Export `ApiKey` |
| `src/app/repositories/api_key_repo.py` | Create | `create`, `list_by_user`, `get_by_id_and_user`, `get_active_by_hash`, `revoke` |
| `src/app/schemas/api_key.py` | Create | Pydantic request/response schemas |
| `src/app/api/v1/exceptions/api_keys.py` | Create | `ApiKeyNotFoundException`, `ApiKeyAlreadyRevokedException`, `ApiKeyNameConflictException` |
| `src/app/api/v1/api_keys.py` | Create | Router with 4 endpoints |
| `src/app/api/router.py` | Modify | Include `api_keys` router |
| `src/app/dependencies.py` | Modify | Check `api_keys` table before `User.api_key_hash` |
| `tests/unit/repositories/test_api_key_repo.py` | Create | Unit tests for repo methods |
| `tests/unit/test_api_key_schemas.py` | Create | Unit tests for schemas |

---

## Task 1: `ApiKey` ORM model + migration

**Files:**
- Create: `src/app/models/api_key.py`
- Modify: `src/app/models/__init__.py`

- [ ] **Step 1: Create `src/app/models/api_key.py`**

```python
from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from .user import User


class ApiKey(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "api_keys"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    key_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )

    user: Mapped[User] = relationship(back_populates="api_keys")

    def __repr__(self) -> str:
        return f"<ApiKey id={self.id} name={self.name} active={self.is_active}>"
```

- [ ] **Step 2: Add `api_keys` relationship to `User` model**

In `src/app/models/user.py`, add to the `TYPE_CHECKING` block:
```python
    from .api_key import ApiKey
```

And add after the existing relationships:
```python
    api_keys: Mapped[list[ApiKey]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
```

- [ ] **Step 3: Export `ApiKey` from `src/app/models/__init__.py`**

Add `ApiKey` to the import and `__all__` list. The file must have `ApiKey` imported **before** `User` so FK resolution works — add it first:

```python
from app.models.api_key import ApiKey
from app.models.favorite_prompt import FavoritePrompt
from app.models.health_score import HealthScore
from app.models.message import Message
from app.models.prompt_version import PromptVersion
from app.models.session import ChatSession
from app.models.template import Template
from app.models.user import User

__all__ = [
    "ApiKey",
    "User",
    "ChatSession",
    "Message",
    "PromptVersion",
    "Template",
    "HealthScore",
    "FavoritePrompt",
]
```

- [ ] **Step 4: Generate and verify the Alembic migration**

```bash
cd /Volumes/External/promptly/qa-chatbot && uv run alembic revision --autogenerate -m "add api_keys table"
```

Open the generated file in `src/app/migrations/versions/` and verify it contains:
- `op.create_table("api_keys", ...)` with all columns
- `op.create_index` on `key_hash` and `user_id`
- A `downgrade()` that calls `op.drop_table("api_keys")`

- [ ] **Step 5: Run the migration against the test DB**

```bash
cd /Volumes/External/promptly/qa-chatbot && uv run alembic upgrade head
```

Expected: `Running upgrade ... -> ...` with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/models/api_key.py src/app/models/user.py src/app/models/__init__.py src/app/migrations/versions/
git commit -m "feat: add ApiKey ORM model and migration"
```

---

## Task 2: `ApiKeyRepository`

**Files:**
- Create: `src/app/repositories/api_key_repo.py`
- Test: `tests/unit/repositories/test_api_key_repo.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/repositories/test_api_key_repo.py`:

```python
import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.api_key import ApiKey
from app.models.user import User
from app.repositories.api_key_repo import ApiKeyRepository


async def _make_user(db: AsyncSession) -> User:
    user = User(email=f"{uuid.uuid4().hex[:8]}@test.com")
    db.add(user)
    await db.flush()
    return user


@pytest.mark.asyncio
async def test_create_api_key(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    repo = ApiKeyRepository(db_session)
    key = await repo.create(
        user_id=user.id,
        name="production",
        key_hash="abc123def456" + "0" * 52,
    )
    assert key.id is not None
    assert key.name == "production"
    assert key.is_active is True
    assert key.revoked_at is None


@pytest.mark.asyncio
async def test_list_by_user_returns_only_that_users_keys(db_session: AsyncSession) -> None:
    user_a = await _make_user(db_session)
    user_b = await _make_user(db_session)
    repo = ApiKeyRepository(db_session)
    await repo.create(user_id=user_a.id, name="k1", key_hash="a" * 64)
    await repo.create(user_id=user_b.id, name="k2", key_hash="b" * 64)
    await db_session.commit()

    keys = await repo.list_by_user(user_a.id)
    assert len(keys) == 1
    assert keys[0].name == "k1"


@pytest.mark.asyncio
async def test_get_active_by_hash_returns_active_key(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    repo = ApiKeyRepository(db_session)
    await repo.create(user_id=user.id, name="k", key_hash="c" * 64)
    await db_session.commit()

    found = await repo.get_active_by_hash("c" * 64)
    assert found is not None
    assert found.user_id == user.id


@pytest.mark.asyncio
async def test_get_active_by_hash_ignores_revoked(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    repo = ApiKeyRepository(db_session)
    key = await repo.create(user_id=user.id, name="k", key_hash="d" * 64)
    await repo.revoke(key)
    await db_session.commit()

    found = await repo.get_active_by_hash("d" * 64)
    assert found is None


@pytest.mark.asyncio
async def test_revoke_sets_is_active_false_and_revoked_at(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    repo = ApiKeyRepository(db_session)
    key = await repo.create(user_id=user.id, name="k", key_hash="e" * 64)
    await repo.revoke(key)
    await db_session.commit()

    assert key.is_active is False
    assert key.revoked_at is not None


@pytest.mark.asyncio
async def test_get_by_id_and_user_returns_none_for_wrong_user(db_session: AsyncSession) -> None:
    user_a = await _make_user(db_session)
    user_b = await _make_user(db_session)
    repo = ApiKeyRepository(db_session)
    key = await repo.create(user_id=user_a.id, name="k", key_hash="f" * 64)
    await db_session.commit()

    result = await repo.get_by_id_and_user(key.id, user_b.id)
    assert result is None


@pytest.mark.asyncio
async def test_has_active_name_returns_true_for_active_duplicate(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    repo = ApiKeyRepository(db_session)
    await repo.create(user_id=user.id, name="prod", key_hash="g" * 64)
    await db_session.commit()

    assert await repo.has_active_name(user.id, "prod") is True


@pytest.mark.asyncio
async def test_has_active_name_returns_false_after_revoke(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    repo = ApiKeyRepository(db_session)
    key = await repo.create(user_id=user.id, name="prod", key_hash="h" * 64)
    await repo.revoke(key)
    await db_session.commit()

    assert await repo.has_active_name(user.id, "prod") is False
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Volumes/External/promptly/qa-chatbot && uv run pytest tests/unit/repositories/test_api_key_repo.py -v 2>&1 | head -20
```

Expected: `ImportError` — `ApiKeyRepository` does not exist yet.

- [ ] **Step 3: Create `src/app/repositories/api_key_repo.py`**

```python
import uuid
from datetime import UTC, datetime

from sqlalchemy import select

from app.models.api_key import ApiKey
from app.repositories.base import BaseRepository


class ApiKeyRepository(BaseRepository[ApiKey]):
    model = ApiKey

    async def list_by_user(self, user_id: uuid.UUID) -> list[ApiKey]:
        result = await self.db.execute(
            select(ApiKey)
            .where(ApiKey.user_id == user_id)
            .order_by(ApiKey.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_by_id_and_user(
        self, key_id: uuid.UUID, user_id: uuid.UUID
    ) -> ApiKey | None:
        result = await self.db.execute(
            select(ApiKey).where(ApiKey.id == key_id, ApiKey.user_id == user_id)
        )
        return result.scalar_one_or_none()

    async def get_active_by_hash(self, key_hash: str) -> ApiKey | None:
        result = await self.db.execute(
            select(ApiKey).where(ApiKey.key_hash == key_hash, ApiKey.is_active == True)  # noqa: E712
        )
        return result.scalar_one_or_none()

    async def has_active_name(self, user_id: uuid.UUID, name: str) -> bool:
        result = await self.db.execute(
            select(ApiKey).where(
                ApiKey.user_id == user_id,
                ApiKey.name == name,
                ApiKey.is_active == True,  # noqa: E712
            )
        )
        return result.scalar_one_or_none() is not None

    async def revoke(self, key: ApiKey) -> ApiKey:
        key.is_active = False
        key.revoked_at = datetime.now(UTC)
        self.db.add(key)
        await self.db.flush()
        await self.db.refresh(key)
        return key
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Volumes/External/promptly/qa-chatbot && uv run pytest tests/unit/repositories/test_api_key_repo.py -v
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/repositories/api_key_repo.py tests/unit/repositories/test_api_key_repo.py
git commit -m "feat: add ApiKeyRepository with create, list, revoke, and lookup methods"
```

---

## Task 3: Pydantic schemas

**Files:**
- Create: `src/app/schemas/api_key.py`
- Test: `tests/unit/test_api_key_schemas.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/test_api_key_schemas.py`:

```python
import uuid
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.schemas.api_key import ApiKeyCreateRequest, ApiKeyCreatedResponse, ApiKeyListResponse, ApiKeyResponse


def test_create_request_requires_name() -> None:
    with pytest.raises(ValidationError):
        ApiKeyCreateRequest()  # type: ignore[call-arg]


def test_create_request_rejects_blank_name() -> None:
    with pytest.raises(ValidationError):
        ApiKeyCreateRequest(name="   ")


def test_create_request_rejects_name_over_100_chars() -> None:
    with pytest.raises(ValidationError):
        ApiKeyCreateRequest(name="x" * 101)


def test_create_request_accepts_valid_name() -> None:
    req = ApiKeyCreateRequest(name="production")
    assert req.name == "production"


def test_created_response_includes_raw_key() -> None:
    resp = ApiKeyCreatedResponse(
        id=uuid.uuid4(),
        name="production",
        key="qac_abc123",
        created_at=datetime.now(UTC),
    )
    assert resp.key.startswith("qac_")


def test_api_key_response_never_has_key_field() -> None:
    resp = ApiKeyResponse(
        id=uuid.uuid4(),
        name="production",
        is_active=True,
        created_at=datetime.now(UTC),
        revoked_at=None,
    )
    assert not hasattr(resp, "key")


def test_api_key_list_response_wraps_list() -> None:
    resp = ApiKeyListResponse(keys=[])
    assert resp.keys == []
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Volumes/External/promptly/qa-chatbot && uv run pytest tests/unit/test_api_key_schemas.py -v 2>&1 | head -15
```

Expected: `ImportError`.

- [ ] **Step 3: Create `src/app/schemas/api_key.py`**

```python
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator


class ApiKeyCreateRequest(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def name_must_be_non_blank_and_short(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name must not be blank")
        if len(v) > 100:
            raise ValueError("name must be 100 characters or fewer")
        return v


class ApiKeyCreatedResponse(BaseModel):
    """Returned only at creation — includes the raw key."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    key: str
    created_at: datetime


class ApiKeyResponse(BaseModel):
    """Returned for list/get/revoke — raw key is never included."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    is_active: bool
    created_at: datetime
    revoked_at: datetime | None


class ApiKeyListResponse(BaseModel):
    keys: list[ApiKeyResponse]
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Volumes/External/promptly/qa-chatbot && uv run pytest tests/unit/test_api_key_schemas.py -v
```

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/schemas/api_key.py tests/unit/test_api_key_schemas.py
git commit -m "feat: add ApiKey Pydantic schemas"
```

---

## Task 4: Exceptions + router

**Files:**
- Create: `src/app/api/v1/exceptions/api_keys.py`
- Create: `src/app/api/v1/api_keys.py`
- Modify: `src/app/api/router.py`

- [ ] **Step 1: Create `src/app/api/v1/exceptions/api_keys.py`**

```python
from fastapi import HTTPException, status


class ApiKeyNotFoundException(HTTPException):
    def __init__(self, detail: str = "API key not found.") -> None:
        super().__init__(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


class ApiKeyAlreadyRevokedException(HTTPException):
    def __init__(self, detail: str = "API key is already revoked.") -> None:
        super().__init__(status_code=status.HTTP_409_CONFLICT, detail=detail)


class ApiKeyNameConflictException(HTTPException):
    def __init__(self, detail: str = "An active API key with this name already exists.") -> None:
        super().__init__(status_code=status.HTTP_409_CONFLICT, detail=detail)
```

- [ ] **Step 2: Create `src/app/api/v1/api_keys.py`**

```python
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.types.response import SuccessResponse
from app.api.v1.exceptions.api_keys import (
    ApiKeyAlreadyRevokedException,
    ApiKeyNameConflictException,
    ApiKeyNotFoundException,
)
from app.core.rate_limit import RateLimiter
from app.core.security import generate_api_key
from app.dependencies import get_current_user, get_db
from app.models.user import User
from app.repositories.api_key_repo import ApiKeyRepository
from app.schemas.api_key import (
    ApiKeyCreateRequest,
    ApiKeyCreatedResponse,
    ApiKeyListResponse,
    ApiKeyResponse,
)

router = APIRouter(prefix="/users/api-keys", tags=["api-keys"])
_default_limiter = RateLimiter(requests=60, window_seconds=60)


@router.post(
    "",
    response_model=SuccessResponse[ApiKeyCreatedResponse],
    status_code=201,
    dependencies=[Depends(_default_limiter)],
)
async def create_api_key(
    request: ApiKeyCreateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[ApiKeyCreatedResponse]:
    """Create a new API key. The raw key is returned once and never stored."""
    repo = ApiKeyRepository(db)
    if await repo.has_active_name(current_user.id, request.name):
        raise ApiKeyNameConflictException()

    raw_key, key_hash = generate_api_key()
    key = await repo.create(
        user_id=current_user.id,
        name=request.name,
        key_hash=key_hash,
    )
    await db.commit()
    return SuccessResponse(
        data=ApiKeyCreatedResponse(
            id=key.id,
            name=key.name,
            key=raw_key,
            created_at=key.created_at,
        )
    )


@router.get(
    "",
    response_model=SuccessResponse[ApiKeyListResponse],
    dependencies=[Depends(_default_limiter)],
)
async def list_api_keys(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[ApiKeyListResponse]:
    """List all API keys for the current user (active and revoked)."""
    repo = ApiKeyRepository(db)
    keys = await repo.list_by_user(current_user.id)
    return SuccessResponse(
        data=ApiKeyListResponse(
            keys=[ApiKeyResponse.model_validate(k) for k in keys]
        )
    )


@router.get(
    "/{key_id}",
    response_model=SuccessResponse[ApiKeyResponse],
    dependencies=[Depends(_default_limiter)],
)
async def get_api_key(
    key_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[ApiKeyResponse]:
    """Get metadata for a single API key."""
    repo = ApiKeyRepository(db)
    key = await repo.get_by_id_and_user(key_id, current_user.id)
    if not key:
        raise ApiKeyNotFoundException()
    return SuccessResponse(data=ApiKeyResponse.model_validate(key))


@router.delete(
    "/{key_id}",
    response_model=SuccessResponse[ApiKeyResponse],
    dependencies=[Depends(_default_limiter)],
)
async def revoke_api_key(
    key_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[ApiKeyResponse]:
    """Revoke an API key (soft delete)."""
    repo = ApiKeyRepository(db)
    key = await repo.get_by_id_and_user(key_id, current_user.id)
    if not key:
        raise ApiKeyNotFoundException()
    if not key.is_active:
        raise ApiKeyAlreadyRevokedException()
    key = await repo.revoke(key)
    await db.commit()
    return SuccessResponse(data=ApiKeyResponse.model_validate(key))
```

- [ ] **Step 3: Include the router in `src/app/api/router.py`**

Replace the entire file with:

```python
from fastapi import APIRouter

from app.api.v1 import auth, chat, favorites, health, prompts, stats, templates, users
from app.api.v1 import api_keys

api_router = APIRouter()

api_router.include_router(health.router)
api_router.include_router(chat.router)
api_router.include_router(prompts.router)
api_router.include_router(templates.router)
api_router.include_router(stats.router)
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(favorites.router)
api_router.include_router(api_keys.router)
```

- [ ] **Step 4: Run unit tests to verify nothing broke**

```bash
cd /Volumes/External/promptly/qa-chatbot && uv run pytest tests/unit/ -v 2>&1 | tail -15
```

Expected: all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/exceptions/api_keys.py src/app/api/v1/api_keys.py src/app/api/router.py
git commit -m "feat: add API key management endpoints (create, list, get, revoke)"
```

---

## Task 5: Wire `get_current_user` to check `api_keys` table

**Files:**
- Modify: `src/app/dependencies.py`

- [ ] **Step 1: Update the API key auth path in `src/app/dependencies.py`**

Find the `# API key path` block (currently lines 59–63) and replace it with:

```python
    # API key path — check new api_keys table first, fall back to User.api_key_hash
    if token.startswith("qac_"):
        key_hash = hash_api_key(token)

        # New multi-key table
        from app.repositories.api_key_repo import ApiKeyRepository  # noqa: PLC0415

        api_key_repo = ApiKeyRepository(db)
        api_key = await api_key_repo.get_active_by_hash(key_hash)
        if api_key is not None:
            user = await repo.get_by_id(api_key.user_id)
            if user and user.is_active:
                return user

        # Legacy single-key fallback (User.api_key_hash)
        user = await repo.get_by_api_key_hash(key_hash)
        if not user or not user.is_active:
            raise UnauthorizedException(detail="Invalid API key")
        return user
```

- [ ] **Step 2: Run the full unit test suite**

```bash
cd /Volumes/External/promptly/qa-chatbot && uv run pytest tests/unit/ -v 2>&1 | tail -15
```

Expected: all tests pass.

- [ ] **Step 3: Run ruff and mypy**

```bash
cd /Volumes/External/promptly/qa-chatbot && uv run ruff check src/ && uv run mypy src/
```

Expected: no errors. If ruff flags `PLC0415` (import not at top), add `# noqa: PLC0415` to the inline import line (already included above).

- [ ] **Step 4: Commit**

```bash
git add src/app/dependencies.py
git commit -m "feat: check api_keys table in get_current_user before legacy User.api_key_hash fallback"
```

---

## Task 6: Final validation

**Files:** No changes — validation only.

- [ ] **Step 1: Run full unit suite**

```bash
cd /Volumes/External/promptly/qa-chatbot && uv run pytest tests/unit/ -v 2>&1 | tail -20
```

Expected: all tests pass (50 existing + 15 new = 65 total).

- [ ] **Step 2: Run ruff + mypy**

```bash
cd /Volumes/External/promptly/qa-chatbot && uv run ruff check src/ && uv run ruff format --check src/ && uv run mypy src/
```

Expected: all clean.

- [ ] **Step 3: Commit any lint fixes if needed**

```bash
git add -p
git commit -m "chore: fix lint/type issues from api key management implementation"
```

---

## Self-Review Checklist

- [x] **Task 1:** `ApiKey` model with all columns from spec (`id`, `user_id`, `name`, `key_hash`, `is_active`, `created_at`, `revoked_at`), Alembic migration ✓
- [x] **Task 2:** `ApiKeyRepository` with `create`, `list_by_user`, `get_by_id_and_user`, `get_active_by_hash`, `has_active_name`, `revoke` ✓
- [x] **Task 3:** Schemas — `ApiKeyCreateRequest` (validates blank + >100 chars), `ApiKeyCreatedResponse` (has `key`), `ApiKeyResponse` (no `key`), `ApiKeyListResponse` ✓
- [x] **Task 4:** 4 endpoints — `POST ""` 201, `GET ""`, `GET /{key_id}`, `DELETE /{key_id}`; all with `_default_limiter` ✓
- [x] **Task 5:** `get_current_user` checks `api_keys` first, falls back to `User.api_key_hash` ✓
- [x] **409 on duplicate active name** — `has_active_name` check in `POST` handler ✓
- [x] **409 on already-revoked** — `is_active` check in `DELETE` handler ✓
- [x] **Raw key returned once** — only in `ApiKeyCreatedResponse`, not in `ApiKeyResponse` ✓
- [x] **Soft delete** — `revoke` sets `is_active=False` and `revoked_at=now()` ✓
- [x] **Type consistency** — `ApiKeyRepository`, `ApiKeyResponse`, `ApiKeyCreatedResponse`, `ApiKeyListResponse` used identically across tasks ✓
