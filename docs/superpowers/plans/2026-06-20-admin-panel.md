# Admin Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production-quality admin panel to Promptly — role-gated by `is_admin` in the DB — with user management, app stats, rate-limit monitoring, and GlitchTip error tracking.

**Architecture:** `is_admin` boolean column on `users` table is the single source of truth. A `require_admin` FastAPI dependency is applied at the router level to protect all `/api/v1/admin/*` endpoints. The frontend admin page (`/admin`) is guarded by a client-side layout component that redirects non-admins; the backend dependency is the real security gate.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 async + Alembic + Redis (aioredis) + httpx · Next.js 14 App Router + TanStack Query v5 + TypeScript strict

## Global Constraints

- Python 3.12, `uv`, ruff line-length=100, mypy strict=true — run `make check` before every commit
- All DB operations must be async (SQLAlchemy async session, `await`)
- All new backend modules must have `__init__.py`
- All test files: `tests/unit/` for pure logic, `@pytest.mark.asyncio` for async tests
- Frontend: `"use client"` only where interactivity is required; never use raw `fetch` — always use the `api` axios instance from `src/lib/api.ts`
- Follow `SuccessResponse[T]` wrapper for all backend response bodies
- New admin email: `ananthanarayanan431@gmail.com`

---

### Task 1: DB Migration + User Model

**Files:**
- Create: `qa-chatbot/src/promptly/migrations/versions/h2i3j4k5l6m7_add_is_admin_to_users.py`
- Modify: `qa-chatbot/src/promptly/models/user.py`

**Interfaces:**
- Produces: `User.is_admin: Mapped[bool]` column — used by Tasks 2, 5

- [ ] **Step 1: Write migration file**

```python
# qa-chatbot/src/promptly/migrations/versions/h2i3j4k5l6m7_add_is_admin_to_users.py
"""add is_admin to users

Revision ID: h2i3j4k5l6m7
Revises: g1h2i3j4k5l6
Create Date: 2026-06-20 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "h2i3j4k5l6m7"
down_revision: str | Sequence[str] | None = "g1h2i3j4k5l6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_admin", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade() -> None:
    op.drop_column("users", "is_admin")
```

- [ ] **Step 2: Add `is_admin` column to the User ORM model**

Open `qa-chatbot/src/promptly/models/user.py`. Add this field after `token_balance`:

```python
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
```

The full updated `User` class body should now read:

```python
class User(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "users"

    supabase_user_id: Mapped[str] = mapped_column(
        String(255), unique=True, index=True, nullable=False
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    credits: Mapped[int] = mapped_column(Integer, default=100, server_default="100", nullable=False)
    token_balance: Mapped[int] = mapped_column(
        BigInteger, default=3_000_000, server_default="3000000", nullable=False
    )
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)

    sessions: Mapped[list[ChatSession]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    prompt_versions: Mapped[list[PromptVersion]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    favorite_prompts: Mapped[list[FavoritePrompt]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    api_keys: Mapped[list[ApiKey]] = relationship(
        back_populates="created_by_user", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<User id={self.id} email={self.email}>"
```

- [ ] **Step 3: Run migration**

```bash
cd qa-chatbot
make migrate
```

Expected output: `Running upgrade g1h2i3j4k5l6 -> h2i3j4k5l6m7, add is_admin to users`

- [ ] **Step 4: Grant yourself admin**

```bash
cd qa-chatbot
uv run python -c "
import asyncio
from sqlalchemy import update
from promptly.models.user import User
from promptly.db.session import AsyncSessionLocal

async def grant():
    async with AsyncSessionLocal() as s:
        await s.execute(update(User).where(User.email == 'ananthanarayanan431@gmail.com').values(is_admin=True))
        await s.commit()
        print('Done')

asyncio.run(grant())
"
```

Expected: `Done`

- [ ] **Step 5: Run linter + type check**

```bash
cd qa-chatbot
make check
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add qa-chatbot/src/promptly/migrations/versions/h2i3j4k5l6m7_add_is_admin_to_users.py \
        qa-chatbot/src/promptly/models/user.py
git commit -m "feat: add is_admin column to users table"
```

---

### Task 2: UserContext + UserResponse + get_current_user updates

**Files:**
- Modify: `qa-chatbot/src/promptly/core/user_context.py`
- Modify: `qa-chatbot/src/promptly/schemas/user.py`
- Modify: `qa-chatbot/src/promptly/dependencies.py`
- Modify: `qa-chatbot/tests/unit/test_dependencies.py`

**Interfaces:**
- Consumes: `User.is_admin` from Task 1
- Produces: `UserContext.is_admin: bool` — used by Task 3; `UserResponse.is_admin: bool` — used by Task 9

- [ ] **Step 1: Write a failing test for `is_admin` in `UserContext`**

Add this test to `qa-chatbot/tests/unit/test_dependencies.py`:

```python
@pytest.mark.asyncio
async def test_get_current_user_returns_is_admin_from_db() -> None:
    """is_admin from the DB row is forwarded into UserContext."""
    user = _make_user()
    user.is_admin = True
    user.token_balance = 3_000_000
    fake_payload = {
        "sub": user.supabase_user_id,
        "email": user.email,
        "user_metadata": {},
    }

    request = _make_request("Bearer valid.jwt.token")
    mock_db = AsyncMock()
    mock_user_repo = AsyncMock()
    mock_user_repo.get_by_supabase_id.return_value = user
    mock_api_key_repo = AsyncMock()

    with (
        patch("promptly.dependencies.verify_supabase_token", return_value=fake_payload),
        patch("promptly.dependencies.UserRepository", return_value=mock_user_repo),
        patch("promptly.dependencies.ApiKeyRepository", return_value=mock_api_key_repo),
        patch("structlog.contextvars.bind_contextvars"),
    ):
        from promptly.dependencies import get_current_user

        result = await get_current_user(request=request, db=mock_db)

    assert result.is_admin is True
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd qa-chatbot
uv run pytest tests/unit/test_dependencies.py::test_get_current_user_returns_is_admin_from_db -v
```

Expected: FAIL — `UserContext` has no `is_admin` attribute.

- [ ] **Step 3: Add `is_admin` to `UserContext`**

Replace the full content of `qa-chatbot/src/promptly/core/user_context.py`:

```python
from dataclasses import dataclass
from uuid import UUID


@dataclass
class UserContext:
    user_id: UUID
    supabase_user_id: str
    email: str
    credits: int
    token_balance: int = 3_000_000
    is_admin: bool = False
```

- [ ] **Step 4: Update `get_current_user` to pass `is_admin` through**

In `qa-chatbot/src/promptly/dependencies.py`, update both `UserContext(...)` construction sites.

The API-key path (around line 101) currently ends with:
```python
        return UserContext(
            user_id=user.id,
            supabase_user_id=user.supabase_user_id,
            email=user.email,
            credits=user.credits,
            token_balance=user.token_balance,
        )
```

Change it to:
```python
        return UserContext(
            user_id=user.id,
            supabase_user_id=user.supabase_user_id,
            email=user.email,
            credits=user.credits,
            token_balance=user.token_balance,
            is_admin=user.is_admin,
        )
```

The JWT path (around line 125) currently ends with:
```python
    return UserContext(
        user_id=user.id,
        supabase_user_id=user.supabase_user_id,
        email=user.email,
        credits=user.credits,
    )
```

Change it to:
```python
    return UserContext(
        user_id=user.id,
        supabase_user_id=user.supabase_user_id,
        email=user.email,
        credits=user.credits,
        token_balance=user.token_balance,
        is_admin=user.is_admin,
    )
```

- [ ] **Step 5: Add `is_admin` to `UserResponse`**

In `qa-chatbot/src/promptly/schemas/user.py`, update `UserResponse`:

```python
class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    credits: int
    token_balance: int = TOKEN_START
    is_admin: bool = False

    model_config = ConfigDict(from_attributes=True)
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
cd qa-chatbot
uv run pytest tests/unit/test_dependencies.py::test_get_current_user_returns_is_admin_from_db -v
```

Expected: PASS

- [ ] **Step 7: Run the full unit test suite to check no regressions**

```bash
cd qa-chatbot
make test-unit
```

Expected: all tests pass.

- [ ] **Step 8: Run check**

```bash
cd qa-chatbot
make check
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add qa-chatbot/src/promptly/core/user_context.py \
        qa-chatbot/src/promptly/schemas/user.py \
        qa-chatbot/src/promptly/dependencies.py \
        qa-chatbot/tests/unit/test_dependencies.py
git commit -m "feat: propagate is_admin through UserContext and UserResponse"
```

---

### Task 3: `require_admin` dependency + tests

**Files:**
- Modify: `qa-chatbot/src/promptly/dependencies.py`
- Create: `qa-chatbot/tests/unit/test_require_admin.py`

**Interfaces:**
- Consumes: `UserContext.is_admin` from Task 2; `ForbiddenException` from `promptly.core.exceptions`
- Produces: `require_admin(current_user: UserContext) -> UserContext` — used by Task 4

- [ ] **Step 1: Write failing tests**

Create `qa-chatbot/tests/unit/test_require_admin.py`:

```python
"""Unit tests for the require_admin FastAPI dependency."""

import uuid
from unittest.mock import AsyncMock, patch

import pytest

from promptly.core.exceptions import ForbiddenException
from promptly.core.user_context import UserContext


def _make_context(*, is_admin: bool) -> UserContext:
    return UserContext(
        user_id=uuid.uuid4(),
        supabase_user_id="user_abc",
        email="test@example.com",
        credits=100,
        token_balance=3_000_000,
        is_admin=is_admin,
    )


@pytest.mark.asyncio
async def test_require_admin_passes_for_admin_user() -> None:
    """Admin user → returns the UserContext unchanged."""
    ctx = _make_context(is_admin=True)

    with patch("promptly.dependencies.get_current_user", return_value=ctx):
        from promptly.dependencies import require_admin

        result = await require_admin(current_user=ctx)

    assert result is ctx


@pytest.mark.asyncio
async def test_require_admin_raises_forbidden_for_non_admin() -> None:
    """Non-admin user → raises ForbiddenException."""
    ctx = _make_context(is_admin=False)

    with patch("promptly.dependencies.get_current_user", return_value=ctx):
        from promptly.dependencies import require_admin

        with pytest.raises(ForbiddenException) as exc_info:
            await require_admin(current_user=ctx)

    assert exc_info.value.status_code == 403
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd qa-chatbot
uv run pytest tests/unit/test_require_admin.py -v
```

Expected: FAIL — `require_admin` not found in `promptly.dependencies`.

- [ ] **Step 3: Add `require_admin` to `dependencies.py`**

Add the following imports at the top of `qa-chatbot/src/promptly/dependencies.py` (after the existing imports):

```python
from promptly.core.exceptions import ForbiddenException
```

Then add this function after `get_current_user`:

```python
async def require_admin(
    current_user: Annotated[UserContext, Depends(get_current_user)],
) -> UserContext:
    """Dependency that restricts access to admin users only."""
    if not current_user.is_admin:
        raise ForbiddenException(detail="Admin access required")
    return current_user
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd qa-chatbot
uv run pytest tests/unit/test_require_admin.py -v
```

Expected: both tests PASS.

- [ ] **Step 5: Run check**

```bash
cd qa-chatbot
make check
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add qa-chatbot/src/promptly/dependencies.py \
        qa-chatbot/tests/unit/test_require_admin.py
git commit -m "feat: add require_admin dependency, raises 403 for non-admin users"
```

---

### Task 4: Admin slice scaffolding + schemas

**Files:**
- Create: `qa-chatbot/src/promptly/admin/__init__.py`
- Create: `qa-chatbot/src/promptly/admin/api/__init__.py`
- Create: `qa-chatbot/src/promptly/admin/api/schemas.py`

**Interfaces:**
- Produces: Pydantic response schemas for all admin endpoints — used by Task 5, 6, 7

- [ ] **Step 1: Create package files**

Create `qa-chatbot/src/promptly/admin/__init__.py` (empty):
```python
```

Create `qa-chatbot/src/promptly/admin/api/__init__.py` (empty):
```python
```

- [ ] **Step 2: Create admin schemas**

Create `qa-chatbot/src/promptly/admin/api/schemas.py`:

```python
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class AdminUserItem(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str | None
    credits: int
    token_balance: int
    is_active: bool
    is_admin: bool
    last_login_at: datetime | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AdminUserPatch(BaseModel):
    is_active: bool | None = None
    is_admin: bool | None = None
    credits_delta: int | None = None


class AdminUserList(BaseModel):
    page: int
    per_page: int
    total: int
    users: list[AdminUserItem]


class AdminStats(BaseModel):
    total_users: int
    total_optimizations: int
    total_tokens_consumed: int
    active_users_7d: int


class RateLimitEntry(BaseModel):
    user_id: str
    route: str
    hit_count: int


class RateLimitList(BaseModel):
    entries: list[RateLimitEntry]


class GlitchTipIssue(BaseModel):
    id: str
    title: str
    occurrences: int
    status: str
    first_seen: str
    last_seen: str


class GlitchTipIssueList(BaseModel):
    issues: list[GlitchTipIssue]
```

- [ ] **Step 3: Run check**

```bash
cd qa-chatbot
make check
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add qa-chatbot/src/promptly/admin/
git commit -m "feat: scaffold admin slice with response schemas"
```

---

### Task 5: Stats + Users admin endpoints

**Files:**
- Create: `qa-chatbot/src/promptly/admin/api/router.py`
- Modify: `qa-chatbot/src/promptly/repositories/user_repo.py`
- Create: `qa-chatbot/tests/unit/test_admin_schemas.py`

**Interfaces:**
- Consumes: `require_admin` from Task 3; schemas from Task 4; `UserRepository`
- Produces: `GET /api/v1/admin/stats`, `GET /api/v1/admin/users`, `PATCH /api/v1/admin/users/{user_id}` — used by Tasks 7, 9

- [ ] **Step 1: Add repository methods for admin queries**

Add these methods to `qa-chatbot/src/promptly/repositories/user_repo.py` (after `add_tokens`):

```python
    async def get_all_paginated(
        self, page: int, per_page: int
    ) -> tuple[list[User], int]:
        """Return a page of users and the total count."""
        total_result = await self.db.execute(select(func.count()).select_from(User))
        total: int = total_result.scalar_one()

        result = await self.db.execute(
            select(User)
            .order_by(User.created_at.desc())
            .offset((page - 1) * per_page)
            .limit(per_page)
        )
        users = list(result.scalars().all())
        return users, total

    async def update_admin_fields(
        self,
        user_id: UUID,
        *,
        is_active: bool | None = None,
        is_admin: bool | None = None,
        credits_delta: int | None = None,
    ) -> User | None:
        """Patch admin-controllable fields. Returns None if user not found."""
        values: dict[str, object] = {}
        if is_active is not None:
            values["is_active"] = is_active
        if is_admin is not None:
            values["is_admin"] = is_admin
        if not values and credits_delta is None:
            return await self.get_by_id(user_id)

        if values:
            await self.db.execute(update(User).where(User.id == user_id).values(**values))

        if credits_delta is not None:
            await self.db.execute(
                update(User)
                .where(User.id == user_id)
                .values(credits=User.credits + credits_delta)
            )

        await self.db.flush()
        return await self.get_by_id(user_id)
```

You will also need to add `from sqlalchemy import func` to the imports at the top of `user_repo.py`. The existing imports already have `select` and `update`, so just add `func` to the `from sqlalchemy import` line:

```python
from sqlalchemy import func, select, update
```

- [ ] **Step 2: Write a unit test for `AdminStats` and `AdminUserList` schemas**

Create `qa-chatbot/tests/unit/test_admin_schemas.py`:

```python
"""Unit tests for admin API schemas."""

import uuid
from datetime import datetime, timezone

from promptly.admin.api.schemas import AdminUserItem, AdminUserPatch, AdminStats


def test_admin_user_item_from_attributes() -> None:
    """AdminUserItem populates correctly from ORM-like attributes."""
    now = datetime.now(timezone.utc)
    item = AdminUserItem(
        id=uuid.uuid4(),
        email="a@b.com",
        full_name="Alice",
        credits=50,
        token_balance=1_000_000,
        is_active=True,
        is_admin=False,
        last_login_at=now,
        created_at=now,
    )
    assert item.email == "a@b.com"
    assert item.is_admin is False


def test_admin_stats_fields() -> None:
    stats = AdminStats(
        total_users=10,
        total_optimizations=200,
        total_tokens_consumed=500_000,
        active_users_7d=5,
    )
    assert stats.total_users == 10


def test_admin_user_patch_all_optional() -> None:
    """AdminUserPatch allows all-None (no-op patch)."""
    patch = AdminUserPatch()
    assert patch.is_active is None
    assert patch.credits_delta is None
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
cd qa-chatbot
uv run pytest tests/unit/test_admin_schemas.py -v
```

Expected: PASS (schemas are pure data — no DB needed).

- [ ] **Step 4: Create the admin router with stats + users endpoints**

Create `qa-chatbot/src/promptly/admin/api/router.py`:

```python
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from promptly.admin.api.schemas import (
    AdminStats,
    AdminUserItem,
    AdminUserList,
    AdminUserPatch,
    GlitchTipIssueList,
    RateLimitList,
)
from promptly.api.types.response import SuccessResponse
from promptly.core.exceptions import NotFoundException
from promptly.core.user_context import UserContext
from promptly.dependencies import get_db, require_admin
from promptly.models.session import ChatSession
from promptly.models.user import User
from promptly.repositories.user_repo import UserRepository

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_admin)],
)


@router.get("/stats", response_model=SuccessResponse[AdminStats])
async def get_stats(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[UserContext, Depends(require_admin)],
) -> SuccessResponse[AdminStats]:
    """Aggregate application statistics."""
    total_users_result = await db.execute(select(func.count()).select_from(User))
    total_users: int = total_users_result.scalar_one()

    total_opts_result = await db.execute(select(func.count()).select_from(ChatSession))
    total_optimizations: int = total_opts_result.scalar_one()

    tokens_result = await db.execute(
        select(func.coalesce(func.sum(3_000_000 - User.token_balance), 0)).select_from(User)
    )
    total_tokens_consumed: int = tokens_result.scalar_one()

    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    active_result = await db.execute(
        select(func.count()).select_from(User).where(User.last_login_at >= cutoff)
    )
    active_users_7d: int = active_result.scalar_one()

    return SuccessResponse(
        data=AdminStats(
            total_users=total_users,
            total_optimizations=total_optimizations,
            total_tokens_consumed=total_tokens_consumed,
            active_users_7d=active_users_7d,
        )
    )


@router.get("/users", response_model=SuccessResponse[AdminUserList])
async def list_users(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[UserContext, Depends(require_admin)],
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=200),
) -> SuccessResponse[AdminUserList]:
    """Paginated list of all users."""
    repo = UserRepository(db)
    users, total = await repo.get_all_paginated(page, per_page)
    return SuccessResponse(
        data=AdminUserList(
            page=page,
            per_page=per_page,
            total=total,
            users=[AdminUserItem.model_validate(u) for u in users],
        )
    )


@router.patch("/users/{user_id}", response_model=SuccessResponse[AdminUserItem])
async def patch_user(
    user_id: uuid.UUID,
    body: AdminUserPatch,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[UserContext, Depends(require_admin)],
) -> SuccessResponse[AdminUserItem]:
    """Update is_active, is_admin, or credits for any user."""
    repo = UserRepository(db)
    updated = await repo.update_admin_fields(
        user_id,
        is_active=body.is_active,
        is_admin=body.is_admin,
        credits_delta=body.credits_delta,
    )
    if updated is None:
        raise NotFoundException(detail="User not found")
    return SuccessResponse(data=AdminUserItem.model_validate(updated))
```

- [ ] **Step 5: Run check**

```bash
cd qa-chatbot
make check
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add qa-chatbot/src/promptly/admin/api/router.py \
        qa-chatbot/src/promptly/repositories/user_repo.py \
        qa-chatbot/tests/unit/test_admin_schemas.py
git commit -m "feat: add admin stats and user management endpoints"
```

---

### Task 6: Rate limits endpoint

**Files:**
- Modify: `qa-chatbot/src/promptly/admin/api/router.py`

**Interfaces:**
- Consumes: Redis client from `promptly.db.redis`; `RateLimitList`, `RateLimitEntry` schemas from Task 4
- Produces: `GET /api/v1/admin/rate-limits`

The rate limiter writes Redis keys with the pattern `rl:user:{user_id}:{route_path}` (see `src/promptly/core/rate_limit.py`). The endpoint scans those keys and returns the current counts.

- [ ] **Step 1: Add the rate-limits endpoint to `router.py`**

Add these imports at the top of `qa-chatbot/src/promptly/admin/api/router.py` (merge with existing imports):

```python
from promptly.db.redis import get_redis_client
```

Add this endpoint after `patch_user`:

```python
@router.get("/rate-limits", response_model=SuccessResponse[RateLimitList])
async def get_rate_limits(
    _: Annotated[UserContext, Depends(require_admin)],
) -> SuccessResponse[RateLimitList]:
    """Current rate limit hit counts from Redis (rl:user:* keys)."""
    redis = await get_redis_client()
    entries = []

    cursor = 0
    while True:
        cursor, keys = await redis.scan(cursor, match="rl:user:*", count=200)
        for key in keys:
            raw = await redis.get(key)
            if raw is None:
                continue
            # key format: rl:user:{user_id}:{route_path}
            parts = key.split(":", 3)
            if len(parts) < 4:  # noqa: PLR2004
                continue
            user_id = parts[2]
            route = parts[3]
            entries.append(
                RateLimitEntry(user_id=user_id, route=route, hit_count=int(raw))
            )
        if cursor == 0:
            break

    entries.sort(key=lambda e: e.hit_count, reverse=True)
    return SuccessResponse(data=RateLimitList(entries=entries))
```

- [ ] **Step 2: Run check**

```bash
cd qa-chatbot
make check
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add qa-chatbot/src/promptly/admin/api/router.py
git commit -m "feat: add admin rate-limits endpoint reading from Redis"
```

---

### Task 7: GlitchTip config + errors proxy endpoint

**Files:**
- Modify: `qa-chatbot/src/promptly/config/app.py`
- Modify: `qa-chatbot/src/promptly/admin/api/router.py`

**Interfaces:**
- Consumes: `GLITCHTIP_API_URL`, `GLITCHTIP_API_TOKEN` from `AppSettings`; `GlitchTipIssueList`, `GlitchTipIssue` schemas from Task 4
- Produces: `GET /api/v1/admin/errors`

- [ ] **Step 1: Add GlitchTip settings to `AppSettings`**

In `qa-chatbot/src/promptly/config/app.py`, add these fields inside `AppSettings` after `SENTRY_DSN`:

```python
    GLITCHTIP_API_URL: str | None = None
    GLITCHTIP_API_TOKEN: SecretStr | None = None
```

Full updated `AppSettings`:

```python
class AppSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )
    APP_NAME: str = "qa-chatbot"
    APP_VERSION: str = "0.1.0"
    ENVIRONMENT: str = "development"
    DEBUG: bool = False
    PRODUCTION_APPLICATION: bool = False
    API_V1_PREFIX: str = "/api/v1"
    CORS_ORIGIN: list[str] = ["http://localhost:3000"]
    MAX_REQUEST_BODY_BYTES: int = 100 * 1024 * 1024
    REQUEST_TIMEOUT_SECONDS: float = 60.0
    SENTRY_DSN: SecretStr | None = None
    GLITCHTIP_API_URL: str | None = None
    GLITCHTIP_API_TOKEN: SecretStr | None = None
```

- [ ] **Step 2: Add the errors proxy endpoint**

Add these imports at the top of `qa-chatbot/src/promptly/admin/api/router.py` (httpx is a transitive dependency via openai):

```python
import httpx
from promptly.config.app import get_app_settings
```

Add this endpoint after `get_rate_limits`:

```python
@router.get("/errors", response_model=SuccessResponse[GlitchTipIssueList])
async def get_errors(
    _: Annotated[UserContext, Depends(require_admin)],
) -> SuccessResponse[GlitchTipIssueList]:
    """Proxy recent issues from GlitchTip API."""
    settings = get_app_settings()

    if not settings.GLITCHTIP_API_URL or not settings.GLITCHTIP_API_TOKEN:
        return SuccessResponse(data=GlitchTipIssueList(issues=[]))

    headers = {"Authorization": f"Bearer {settings.GLITCHTIP_API_TOKEN.get_secret_value()}"}
    url = f"{settings.GLITCHTIP_API_URL.rstrip('/')}/issues/?limit=50"

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(url, headers=headers)
        resp.raise_for_status()
        raw: list[dict[str, object]] = resp.json()

    issues = [
        GlitchTipIssue(
            id=str(item.get("id", "")),
            title=str(item.get("title", "")),
            occurrences=int(item.get("count", 0)),
            status=str(item.get("status", "unresolved")),
            first_seen=str(item.get("firstSeen", "")),
            last_seen=str(item.get("lastSeen", "")),
        )
        for item in raw
    ]
    return SuccessResponse(data=GlitchTipIssueList(issues=issues))
```

- [ ] **Step 3: Run check**

```bash
cd qa-chatbot
make check
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add qa-chatbot/src/promptly/config/app.py \
        qa-chatbot/src/promptly/admin/api/router.py
git commit -m "feat: add GlitchTip config and errors proxy admin endpoint"
```

---

### Task 8: Register admin router + GlitchTip Docker Compose

**Files:**
- Modify: `qa-chatbot/src/promptly/api/router.py`
- Modify: `qa-chatbot/docker-compose.yml`

**Interfaces:**
- Consumes: `router` from `promptly.admin.api.router` (Task 5–7)
- Produces: `/api/v1/admin/*` routes live; GlitchTip running at `http://localhost:8080`

- [ ] **Step 1: Register the admin router**

In `qa-chatbot/src/promptly/api/router.py`, add the import and `include_router` call:

```python
from promptly.admin.api.router import router as admin_router
```

Add at the end of the file (after `api_router.include_router(skill_opt_router)`):

```python
api_router.include_router(admin_router)
```

- [ ] **Step 2: Add GlitchTip services to `docker-compose.yml`**

The existing `docker-compose.yml` is at `qa-chatbot/docker-compose.yml`. Add these services after the `minio` service block, before the `volumes:` section:

```yaml
  glitchtip-migrate:
    image: glitchtip/glitchtip:latest
    depends_on:
      postgres:
        condition: service_healthy
    command: "./manage.py migrate"
    environment:
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/glitchtip
      SECRET_KEY: ${GLITCHTIP_SECRET_KEY:?GLITCHTIP_SECRET_KEY is required}
      PORT: "8080"
    restart: "no"

  glitchtip-web:
    image: glitchtip/glitchtip:latest
    depends_on:
      glitchtip-migrate:
        condition: service_completed_successfully
      redis:
        condition: service_healthy
    ports:
      - "8080:8080"
    environment:
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/glitchtip
      SECRET_KEY: ${GLITCHTIP_SECRET_KEY}
      REDIS_URL: redis://redis:6379/1
      PORT: "8080"
      EMAIL_URL: "consolemail://"
    restart: unless-stopped

  glitchtip-worker:
    image: glitchtip/glitchtip:latest
    depends_on:
      glitchtip-migrate:
        condition: service_completed_successfully
      redis:
        condition: service_healthy
    command: "./manage.py run_huey"
    environment:
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/glitchtip
      SECRET_KEY: ${GLITCHTIP_SECRET_KEY}
      REDIS_URL: redis://redis:6379/1
    restart: unless-stopped
```

Also add `miniodata` to the `volumes:` section if not present — it should already be there. Confirm the final `volumes:` section reads:

```yaml
volumes:
  pgdata:
  redisdata:
  miniodata:
```

- [ ] **Step 3: Add GlitchTip env vars to `.env` (and `.env.example`)**

In `qa-chatbot/.env`, add:

```
GLITCHTIP_SECRET_KEY=change-me-to-a-random-64-char-string
GLITCHTIP_API_URL=http://localhost:8080/api/0
GLITCHTIP_API_TOKEN=
```

In `qa-chatbot/.env.example`, add the same lines (with empty/placeholder values).

- [ ] **Step 4: Create the GlitchTip database**

GlitchTip needs its own Postgres database. Create it before running `make infra`:

```bash
cd qa-chatbot
make infra
# Wait for postgres to be healthy, then:
docker exec -it qa-chatbot-postgres-1 psql -U postgres -c "CREATE DATABASE glitchtip;"
```

Then restart to trigger the migration:

```bash
docker compose restart glitchtip-migrate
```

- [ ] **Step 5: Verify admin endpoints are live**

Start the dev server:
```bash
cd qa-chatbot
make dev
```

Open `http://localhost:8000/docs` (requires `DEBUG=true` in `.env`). You should see an **admin** tag with 5 endpoints: `GET /admin/stats`, `GET /admin/users`, `PATCH /admin/users/{user_id}`, `GET /admin/rate-limits`, `GET /admin/errors`.

Try `GET /admin/stats` without auth — expect HTTP 403.

- [ ] **Step 6: GlitchTip one-time setup**

After `make infra` with the new services:
1. Open `http://localhost:8080`
2. Create an admin account (your email + password)
3. Create an organization (e.g. "Promptly") and a project (e.g. "backend")
4. Copy the DSN from the project settings
5. In `qa-chatbot/.env`, set `SENTRY_DSN=<glitchtip dsn>` (replacing any existing value)
6. Create an API token: GlitchTip → User Settings → API Tokens → Create
7. Set `GLITCHTIP_API_TOKEN=<token>` in `qa-chatbot/.env`

- [ ] **Step 7: Run check**

```bash
cd qa-chatbot
make check
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add qa-chatbot/src/promptly/api/router.py \
        qa-chatbot/docker-compose.yml \
        qa-chatbot/.env.example
git commit -m "feat: register admin router and add GlitchTip to Docker Compose"
```

---

### Task 9: Frontend types + admin API client functions

**Files:**
- Modify: `frontend/src/types/api.ts`

**Interfaces:**
- Consumes: backend schemas from Tasks 4–7
- Produces: TypeScript types for all admin API responses — used by Tasks 10–14

- [ ] **Step 1: Add `is_admin` to the existing `User` interface**

In `frontend/src/types/api.ts`, update the `User` interface:

```typescript
export interface User {
  id: string;
  email: string;
  credits: number;
  token_balance: number;
  is_admin: boolean;
  created_at: string;
}
```

- [ ] **Step 2: Add admin types at the bottom of `frontend/src/types/api.ts`**

Append these interfaces:

```typescript
// ── Admin ─────────────────────────────────────────────────────────────────

export interface AdminUserItem {
  id: string;
  email: string;
  full_name: string | null;
  credits: number;
  token_balance: number;
  is_active: boolean;
  is_admin: boolean;
  last_login_at: string | null;
  created_at: string;
}

export interface AdminUserList {
  page: number;
  per_page: number;
  total: number;
  users: AdminUserItem[];
}

export interface AdminUserPatch {
  is_active?: boolean;
  is_admin?: boolean;
  credits_delta?: number;
}

export interface AdminStats {
  total_users: number;
  total_optimizations: number;
  total_tokens_consumed: number;
  active_users_7d: number;
}

export interface RateLimitEntry {
  user_id: string;
  route: string;
  hit_count: number;
}

export interface RateLimitList {
  entries: RateLimitEntry[];
}

export interface GlitchTipIssue {
  id: string;
  title: string;
  occurrences: number;
  status: string;
  first_seen: string;
  last_seen: string;
}

export interface GlitchTipIssueList {
  issues: GlitchTipIssue[];
}
```

- [ ] **Step 3: Run the TypeScript compiler**

```bash
cd frontend
npm run build 2>&1 | head -30
```

Expected: no type errors related to the new types (there may be pre-existing build issues unrelated to this task — focus on new errors only).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/api.ts
git commit -m "feat: add is_admin to User type and add admin API types"
```

---

### Task 10: Sidebar admin link + admin layout guard

**Files:**
- Modify: `frontend/src/components/layout/sidebar.tsx`
- Create: `frontend/src/app/(dashboard)/admin/layout.tsx`

**Interfaces:**
- Consumes: `User.is_admin` from Task 9; `useQuery` + `api` (existing)
- Produces: Conditional "Admin" sidebar link; client-side redirect for non-admins

- [ ] **Step 1: Add admin icon to `NavIcon` and admin link to `NAV_GROUPS`**

In `frontend/src/components/layout/sidebar.tsx`:

Add `shield` to the `paths` map inside `NavIcon` (after the `settings` entry):

```tsx
    shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
```

In the `NAV_GROUPS` array, the Account group currently reads:
```tsx
  {
    group: 'Account',
    items: [
      { href: '/settings',      label: 'Settings',         icon: 'settings' },
      { href: '/billing',       label: 'Billing',          icon: 'creditCard' },
    ],
  },
```

Do NOT add the admin link here — the admin link is rendered conditionally in the `Sidebar` component below the nav groups. Find the nav rendering section (the `NAV_GROUPS.map(...)` block) and after it, add this conditional block (inside the `<nav>` element, after `<RecentSessions />`):

```tsx
        {/* Admin link — only visible to admins */}
        {fetchedUser?.is_admin && (
          <div>
            <div style={{
              padding: '4px 10px 6px', fontSize: 10.5, letterSpacing: '.08em',
              textTransform: 'uppercase', color: 'var(--text-subtle)', fontWeight: 600,
            }}>
              Admin
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {[{ href: '/admin', label: 'Admin Panel', icon: 'shield' }].map(item => {
                const active = pathname === item.href || pathname.startsWith(item.href + '/');
                return (
                  <Link key={item.href} href={item.href} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '7px 10px', height: 32,
                    borderRadius: 7, border: '1px solid transparent',
                    background: active ? 'var(--surface)' : 'transparent',
                    color: active ? 'var(--text)' : 'var(--text-muted)',
                    fontWeight: active ? 500 : 400,
                    boxShadow: active ? 'var(--shadow-sm)' : 'none',
                    borderColor: active ? 'var(--border)' : 'transparent',
                    fontSize: 13, textDecoration: 'none',
                    transition: 'background .12s, color .12s',
                  }}>
                    <NavIcon name={item.icon} />
                    <span>Admin Panel</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
```

- [ ] **Step 2: Create the admin layout guard**

Create `frontend/src/app/(dashboard)/admin/layout.tsx`:

```tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { User } from '@/types/api';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  const { data: user, isLoading } = useQuery<User>({
    queryKey: ['user', 'me'],
    queryFn: async () => {
      const res = await api.get<{ data: User }>('/api/v1/users/me');
      return res.data.data;
    },
    staleTime: 1000 * 60 * 5,
  });

  useEffect(() => {
    if (!isLoading && user !== undefined && !user.is_admin) {
      router.replace('/optimize');
    }
  }, [user, isLoading, router]);

  if (isLoading || !user) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
        Loading…
      </div>
    );
  }

  if (!user.is_admin) {
    return null;
  }

  return <>{children}</>;
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd frontend
npm run build 2>&1 | head -30
```

Expected: no new type errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/layout/sidebar.tsx \
        frontend/src/app/(dashboard)/admin/layout.tsx
git commit -m "feat: add conditional admin nav link and admin layout guard"
```

---

### Task 11: Admin page shell + Overview tab (Stats Cards)

**Files:**
- Create: `frontend/src/app/(dashboard)/admin/page.tsx`
- Create: `frontend/src/components/admin/stats-cards.tsx`

**Interfaces:**
- Consumes: `AdminStats` type from Task 9; `api` axios instance; TanStack Query
- Produces: `/admin` page with tab shell; Overview tab showing 4 summary cards

- [ ] **Step 1: Create the stats cards component**

Create `frontend/src/components/admin/stats-cards.tsx`:

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AdminStats } from '@/types/api';

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="ply-card" style={{ padding: '20px 24px', flex: 1 }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.06em' }}>
        {label}
      </div>
      <div className="mono" style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)' }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
    </div>
  );
}

export function StatsCards() {
  const { data, isLoading } = useQuery<AdminStats>({
    queryKey: ['admin', 'stats'],
    queryFn: async () => {
      const res = await api.get<{ data: AdminStats }>('/api/v1/admin/stats');
      return res.data.data;
    },
    staleTime: 30_000,
  });

  if (isLoading || !data) {
    return (
      <div style={{ display: 'flex', gap: 16 }}>
        {['Total Users', 'Optimizations', 'Tokens Consumed', 'Active (7d)'].map(label => (
          <div key={label} className="ply-card" style={{ padding: '20px 24px', flex: 1, opacity: 0.4 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{label}</div>
            <div style={{ height: 28, background: 'var(--surface-2)', borderRadius: 4 }} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 16 }}>
      <StatCard label="Total Users" value={data.total_users} />
      <StatCard label="Optimizations" value={data.total_optimizations} />
      <StatCard label="Tokens Consumed" value={data.total_tokens_consumed} />
      <StatCard label="Active (7d)" value={data.active_users_7d} />
    </div>
  );
}
```

- [ ] **Step 2: Create the admin page shell**

Create `frontend/src/app/(dashboard)/admin/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { StatsCards } from '@/components/admin/stats-cards';
import { UsersTable } from '@/components/admin/users-table';
import { RateLimitsTable } from '@/components/admin/rate-limits-table';
import { ErrorsTable } from '@/components/admin/errors-table';

type Tab = 'overview' | 'users' | 'rate-limits' | 'errors';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'users', label: 'Users' },
  { id: 'rate-limits', label: 'Rate Limits' },
  { id: 'errors', label: 'Errors' },
];

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Admin Panel</h1>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '6px 0 0' }}>
          Application management and monitoring
        </p>
      </div>

      {/* Tab bar */}
      <div style={{
        display: 'flex', gap: 2, marginBottom: 28,
        borderBottom: '1px solid var(--border)', paddingBottom: 0,
      }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: activeTab === tab.id ? 600 : 400,
              color: activeTab === tab.id ? 'var(--text)' : 'var(--text-muted)',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid var(--primary)' : '2px solid transparent',
              cursor: 'pointer',
              marginBottom: -1,
              transition: 'color .12s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && <StatsCards />}
      {activeTab === 'users' && <UsersTable />}
      {activeTab === 'rate-limits' && <RateLimitsTable />}
      {activeTab === 'errors' && <ErrorsTable />}
    </div>
  );
}
```

Note: `UsersTable`, `RateLimitsTable`, and `ErrorsTable` are stubbed as empty exports in Tasks 12–14 — they must exist before this page compiles. Create them as empty stubs now to unblock compilation.

- [ ] **Step 3: Create stub components (unblocks compilation)**

Create `frontend/src/components/admin/users-table.tsx`:

```tsx
'use client';
export function UsersTable() { return <div>Loading users…</div>; }
```

Create `frontend/src/components/admin/rate-limits-table.tsx`:

```tsx
'use client';
export function RateLimitsTable() { return <div>Loading rate limits…</div>; }
```

Create `frontend/src/components/admin/errors-table.tsx`:

```tsx
'use client';
export function ErrorsTable() { return <div>Loading errors…</div>; }
```

- [ ] **Step 4: Verify TypeScript**

```bash
cd frontend
npm run build 2>&1 | head -40
```

Expected: no new type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/(dashboard)/admin/page.tsx \
        frontend/src/components/admin/
git commit -m "feat: add admin page shell with tab navigation and stats cards"
```

---

### Task 12: Users tab

**Files:**
- Modify: `frontend/src/components/admin/users-table.tsx`

**Interfaces:**
- Consumes: `AdminUserItem`, `AdminUserList`, `AdminUserPatch` from Task 9; `api` axios instance; TanStack Query `useQuery` + `useMutation`
- Produces: Paginated user table with inline is_active/is_admin toggles and credits adjustment

- [ ] **Step 1: Implement `UsersTable`**

Replace the full content of `frontend/src/components/admin/users-table.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AdminUserList, AdminUserItem, AdminUserPatch } from '@/types/api';

const TOKEN_START = 3_000_000;

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        width: 36, height: 20, borderRadius: 10,
        background: value ? 'var(--primary)' : 'var(--border)',
        border: 'none', cursor: 'pointer', position: 'relative', transition: 'background .15s',
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: value ? 18 : 2,
        width: 16, height: 16, borderRadius: 8,
        background: 'white', transition: 'left .15s',
        boxShadow: '0 1px 3px rgba(0,0,0,.3)',
      }} />
    </button>
  );
}

function CreditsInput({ userId, current }: { userId: string; current: number }) {
  const [delta, setDelta] = useState('');
  const qc = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: async (d: number) => {
      await api.patch(`/api/v1/admin/users/${userId}`, { credits_delta: d } satisfies AdminUserPatch);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      setDelta('');
    },
  });

  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <span className="mono" style={{ fontSize: 13 }}>{current}</span>
      <input
        type="number"
        value={delta}
        onChange={e => setDelta(e.target.value)}
        placeholder="±"
        style={{
          width: 52, padding: '2px 6px', fontSize: 12,
          border: '1px solid var(--border)', borderRadius: 4,
          background: 'var(--surface)', color: 'var(--text)',
        }}
      />
      <button
        disabled={!delta || isPending}
        onClick={() => mutate(Number(delta))}
        style={{
          padding: '2px 8px', fontSize: 12, borderRadius: 4,
          background: 'var(--primary)', color: 'white', border: 'none',
          cursor: delta && !isPending ? 'pointer' : 'not-allowed', opacity: !delta ? 0.4 : 1,
        }}
      >
        Add
      </button>
    </div>
  );
}

export function UsersTable() {
  const [page, setPage] = useState(1);
  const perPage = 50;
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<AdminUserList>({
    queryKey: ['admin', 'users', page],
    queryFn: async () => {
      const res = await api.get<{ data: AdminUserList }>(`/api/v1/admin/users?page=${page}&per_page=${perPage}`);
      return res.data.data;
    },
    staleTime: 10_000,
  });

  const { mutate: patchUser } = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: AdminUserPatch }) => {
      await api.patch(`/api/v1/admin/users/${id}`, patch);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });

  const thStyle: React.CSSProperties = {
    padding: '8px 12px', textAlign: 'left', fontSize: 11,
    textTransform: 'uppercase', letterSpacing: '.06em',
    color: 'var(--text-muted)', fontWeight: 600,
    borderBottom: '1px solid var(--border)',
  };
  const tdStyle: React.CSSProperties = {
    padding: '10px 12px', fontSize: 13,
    borderBottom: '1px solid var(--border)',
    color: 'var(--text)',
  };

  if (isLoading) {
    return <div style={{ padding: 24, color: 'var(--text-muted)' }}>Loading users…</div>;
  }

  if (!data) return null;

  return (
    <div>
      <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--text-muted)' }}>
        {data.total} users · page {data.page} of {Math.ceil(data.total / perPage)}
      </div>
      <div className="ply-card" style={{ overflow: 'auto', padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>Email</th>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Credits</th>
              <th style={thStyle}>Tokens</th>
              <th style={thStyle}>Active</th>
              <th style={thStyle}>Admin</th>
              <th style={thStyle}>Last Login</th>
              <th style={thStyle}>Joined</th>
            </tr>
          </thead>
          <tbody>
            {data.users.map((u: AdminUserItem) => (
              <tr key={u.id} style={{ background: !u.is_active ? 'rgba(255,0,0,.03)' : undefined }}>
                <td style={tdStyle}>{u.email}</td>
                <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{u.full_name ?? '—'}</td>
                <td style={tdStyle}>
                  <CreditsInput userId={u.id} current={u.credits} />
                </td>
                <td style={{ ...tdStyle, fontFamily: 'monospace' }}>
                  {formatTokens(Math.max(0, u.token_balance))}
                  <span style={{ fontSize: 11, color: 'var(--text-subtle)', marginLeft: 4 }}>
                    / {formatTokens(TOKEN_START)}
                  </span>
                </td>
                <td style={tdStyle}>
                  <Toggle value={u.is_active} onChange={v => patchUser({ id: u.id, patch: { is_active: v } })} />
                </td>
                <td style={tdStyle}>
                  <Toggle value={u.is_admin} onChange={v => patchUser({ id: u.id, patch: { is_admin: v } })} />
                </td>
                <td style={{ ...tdStyle, color: 'var(--text-muted)', fontSize: 12 }}>
                  {u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : '—'}
                </td>
                <td style={{ ...tdStyle, color: 'var(--text-muted)', fontSize: 12 }}>
                  {new Date(u.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.total > perPage && (
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button
            disabled={page === 1}
            onClick={() => setPage(p => p - 1)}
            style={{
              padding: '6px 14px', fontSize: 13, borderRadius: 6,
              border: '1px solid var(--border)', background: 'var(--surface)',
              color: 'var(--text)', cursor: page === 1 ? 'not-allowed' : 'pointer',
              opacity: page === 1 ? 0.4 : 1,
            }}
          >
            ← Prev
          </button>
          <button
            disabled={page >= Math.ceil(data.total / perPage)}
            onClick={() => setPage(p => p + 1)}
            style={{
              padding: '6px 14px', fontSize: 13, borderRadius: 6,
              border: '1px solid var(--border)', background: 'var(--surface)',
              color: 'var(--text)', cursor: page >= Math.ceil(data.total / perPage) ? 'not-allowed' : 'pointer',
              opacity: page >= Math.ceil(data.total / perPage) ? 0.4 : 1,
            }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd frontend
npm run build 2>&1 | head -40
```

Expected: no new type errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/admin/users-table.tsx
git commit -m "feat: implement admin users tab with inline toggles and credits adjustment"
```

---

### Task 13: Rate Limits tab

**Files:**
- Modify: `frontend/src/components/admin/rate-limits-table.tsx`

**Interfaces:**
- Consumes: `RateLimitList`, `RateLimitEntry` from Task 9; `api` axios instance
- Produces: Table of current rate limit hits per user/route, sorted by hit count descending

- [ ] **Step 1: Implement `RateLimitsTable`**

Replace the full content of `frontend/src/components/admin/rate-limits-table.tsx`:

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { RateLimitList, RateLimitEntry } from '@/types/api';

export function RateLimitsTable() {
  const { data, isLoading, refetch } = useQuery<RateLimitList>({
    queryKey: ['admin', 'rate-limits'],
    queryFn: async () => {
      const res = await api.get<{ data: RateLimitList }>('/api/v1/admin/rate-limits');
      return res.data.data;
    },
    staleTime: 15_000,
  });

  const thStyle: React.CSSProperties = {
    padding: '8px 12px', textAlign: 'left', fontSize: 11,
    textTransform: 'uppercase', letterSpacing: '.06em',
    color: 'var(--text-muted)', fontWeight: 600,
    borderBottom: '1px solid var(--border)',
  };
  const tdStyle: React.CSSProperties = {
    padding: '10px 12px', fontSize: 13,
    borderBottom: '1px solid var(--border)',
    color: 'var(--text)',
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
          Current Redis rate limit counters — sorted by hit count. Refreshes every 15s.
        </p>
        <button
          onClick={() => refetch()}
          style={{
            padding: '6px 14px', fontSize: 12, borderRadius: 6,
            border: '1px solid var(--border)', background: 'var(--surface)',
            color: 'var(--text)', cursor: 'pointer',
          }}
        >
          Refresh
        </button>
      </div>

      {isLoading && <div style={{ padding: 24, color: 'var(--text-muted)' }}>Loading…</div>}

      {data && data.entries.length === 0 && (
        <div className="ply-card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          No active rate limit entries.
        </div>
      )}

      {data && data.entries.length > 0 && (
        <div className="ply-card" style={{ overflow: 'auto', padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>User ID</th>
                <th style={thStyle}>Route</th>
                <th style={thStyle}>Hit Count</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e: RateLimitEntry, i: number) => (
                <tr key={`${e.user_id}-${e.route}-${i}`}>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>
                    {e.user_id}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12 }}>{e.route}</td>
                  <td style={tdStyle}>
                    <span className="mono" style={{
                      fontWeight: 600,
                      color: e.hit_count > 50 ? 'var(--danger)' : e.hit_count > 20 ? 'var(--warning)' : 'var(--text)',
                    }}>
                      {e.hit_count}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd frontend
npm run build 2>&1 | head -40
```

Expected: no new type errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/admin/rate-limits-table.tsx
git commit -m "feat: implement admin rate limits tab reading from Redis via backend"
```

---

### Task 14: Errors tab (GlitchTip)

**Files:**
- Modify: `frontend/src/components/admin/errors-table.tsx`

**Interfaces:**
- Consumes: `GlitchTipIssueList`, `GlitchTipIssue` from Task 9; `NEXT_PUBLIC_GLITCHTIP_URL` env var; `api` axios instance
- Produces: Table of GlitchTip issues with "Open in GlitchTip →" external link

- [ ] **Step 1: Add `NEXT_PUBLIC_GLITCHTIP_URL` to `frontend/.env.local`**

```
NEXT_PUBLIC_GLITCHTIP_URL=http://localhost:8080
```

- [ ] **Step 2: Implement `ErrorsTable`**

Replace the full content of `frontend/src/components/admin/errors-table.tsx`:

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { GlitchTipIssueList, GlitchTipIssue } from '@/types/api';

const GLITCHTIP_URL = process.env.NEXT_PUBLIC_GLITCHTIP_URL ?? 'http://localhost:8080';

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    unresolved: 'var(--danger)',
    resolved: 'var(--success, #22c55e)',
    ignored: 'var(--text-muted)',
  };
  return (
    <span style={{
      fontSize: 11, padding: '2px 8px', borderRadius: 4,
      background: `${colors[status] ?? 'var(--text-muted)'}22`,
      color: colors[status] ?? 'var(--text-muted)',
      fontWeight: 600, textTransform: 'capitalize',
    }}>
      {status}
    </span>
  );
}

export function ErrorsTable() {
  const { data, isLoading, refetch } = useQuery<GlitchTipIssueList>({
    queryKey: ['admin', 'errors'],
    queryFn: async () => {
      const res = await api.get<{ data: GlitchTipIssueList }>('/api/v1/admin/errors');
      return res.data.data;
    },
    staleTime: 30_000,
  });

  const thStyle: React.CSSProperties = {
    padding: '8px 12px', textAlign: 'left', fontSize: 11,
    textTransform: 'uppercase', letterSpacing: '.06em',
    color: 'var(--text-muted)', fontWeight: 600,
    borderBottom: '1px solid var(--border)',
  };
  const tdStyle: React.CSSProperties = {
    padding: '10px 12px', fontSize: 13,
    borderBottom: '1px solid var(--border)',
    color: 'var(--text)',
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
          Recent errors from GlitchTip — top 50 issues.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => refetch()}
            style={{
              padding: '6px 14px', fontSize: 12, borderRadius: 6,
              border: '1px solid var(--border)', background: 'var(--surface)',
              color: 'var(--text)', cursor: 'pointer',
            }}
          >
            Refresh
          </button>
          <a
            href={GLITCHTIP_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '6px 14px', fontSize: 12, borderRadius: 6,
              background: 'var(--primary)', color: 'white', textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}
          >
            Open in GlitchTip →
          </a>
        </div>
      </div>

      {isLoading && <div style={{ padding: 24, color: 'var(--text-muted)' }}>Loading…</div>}

      {data && data.issues.length === 0 && (
        <div className="ply-card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          No issues found. Either GlitchTip is not configured or there are no errors yet.
        </div>
      )}

      {data && data.issues.length > 0 && (
        <div className="ply-card" style={{ overflow: 'auto', padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Issue</th>
                <th style={thStyle}>Occurrences</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>First Seen</th>
                <th style={thStyle}>Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {data.issues.map((issue: GlitchTipIssue) => (
                <tr key={issue.id}>
                  <td style={{ ...tdStyle, maxWidth: 420 }}>
                    <span style={{
                      display: 'block', overflow: 'hidden',
                      textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      fontFamily: 'monospace', fontSize: 12,
                    }}>
                      {issue.title}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <span className="mono" style={{ fontWeight: 600, color: issue.occurrences > 100 ? 'var(--danger)' : 'var(--text)' }}>
                      {issue.occurrences.toLocaleString()}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <StatusBadge status={issue.status} />
                  </td>
                  <td style={{ ...tdStyle, color: 'var(--text-muted)', fontSize: 12 }}>
                    {issue.first_seen ? new Date(issue.first_seen).toLocaleDateString() : '—'}
                  </td>
                  <td style={{ ...tdStyle, color: 'var(--text-muted)', fontSize: 12 }}>
                    {issue.last_seen ? new Date(issue.last_seen).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript and build**

```bash
cd frontend
npm run build 2>&1 | head -40
```

Expected: no new type errors. Full build passes.

- [ ] **Step 4: Final integration smoke test**

Start the full stack:

```bash
# Terminal 1
cd qa-chatbot && make infra && make migrate && make dev

# Terminal 2
cd qa-chatbot && make worker

# Terminal 3
cd frontend && npm run dev
```

1. Open `http://localhost:3000` and sign in as `ananthanarayanan431@gmail.com`
2. Confirm "Admin Panel" link appears at the bottom of the sidebar
3. Navigate to `/admin` — confirm you see the page (not redirected)
4. Overview tab: 4 stat cards load
5. Users tab: your user appears; toggle is_active off and back on; confirm it persists on refresh
6. Rate Limits tab: shows entries (or "No active rate limit entries" if no recent API calls)
7. Errors tab: shows "No issues found" if GlitchTip not yet configured, or issue list if configured

Sign in as a non-admin user (or create one) and confirm navigating to `/admin` redirects to `/optimize`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/admin/errors-table.tsx \
        frontend/.env.local
git commit -m "feat: implement admin errors tab with GlitchTip API integration"
```

---

## Summary

| Task | Deliverable |
|---|---|
| 1 | `is_admin` DB column, migration, grant self admin |
| 2 | `UserContext.is_admin`, `UserResponse.is_admin`, `get_current_user` passthrough |
| 3 | `require_admin` dependency, unit tests |
| 4 | Admin slice scaffolding + Pydantic schemas |
| 5 | `GET /admin/stats`, `GET /admin/users`, `PATCH /admin/users/{id}` |
| 6 | `GET /admin/rate-limits` (Redis SCAN) |
| 7 | GlitchTip config settings + `GET /admin/errors` proxy |
| 8 | Admin router registered, GlitchTip in Docker Compose |
| 9 | Frontend TypeScript types |
| 10 | Conditional sidebar link, admin layout guard |
| 11 | `/admin` page shell, Overview tab (stats cards) |
| 12 | Users tab with toggles + credits adjustment |
| 13 | Rate limits tab |
| 14 | Errors tab + full integration smoke test |
