# Prompt Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users star (like) any optimized `PromptVersion` from the chat UI, surface those likes on the Versions page, and browse/edit them on a new **Prompt Store** page with tags, note, category, pin, and use-count metadata.

**Architecture:** A new `favorite_prompts` table (one row per user × version; its `id` is the `prompt_store_id`). New `/api/v1/favorites` REST endpoints. A synchronous LLM auto-tag call at like-time (free, 2s timeout, graceful fallback). Existing `PromptVersion` list/detail responses are enriched with `is_favorited` + `favorite_id` so the Versions UI needs no extra round-trip. A new `/prompt-store` route on the frontend.

**Tech Stack:** FastAPI · SQLAlchemy 2.0 async · PostgreSQL · Alembic · Pydantic · Celery (unchanged; LLM call is synchronous in the API path) · Next.js 14 · TanStack Query v5 · Zustand · axios.

**Spec reference:** [docs/superpowers/specs/2026-04-23-prompt-store-design.md](../specs/2026-04-23-prompt-store-design.md)

---

## File Structure

### Backend (all under `qa-chatbot/`)

**Create**
- `src/app/models/favorite_prompt.py` — SQLAlchemy ORM for `favorite_prompts`.
- `src/app/migrations/versions/f7b0c1a2d3e4_add_favorite_prompts.py` — Alembic migration.
- `src/app/schemas/favorite.py` — Pydantic request/response models.
- `src/app/repositories/favorite_repo.py` — async repository.
- `src/app/services/favorite_service.py` — like/unlike/list/update orchestration + LLM tag call.
- `src/app/api/v1/favorites.py` — router.
- `src/app/api/v1/exceptions/favorites.py` — `FavoriteNotFoundException`, `FavoriteVersionNotFoundException`.
- `prompts/favorite_auto_tag.md` — system prompt for tag/category suggestion.
- `tests/unit/repositories/test_favorite_repo.py`.
- `tests/unit/services/test_favorite_service.py`.
- `tests/integration/api/test_favorites.py`.

**Modify**
- `src/app/models/__init__.py` — register `FavoritePrompt`.
- `src/app/models/user.py` — add `favorite_prompts` relationship.
- `src/app/api/router.py` — register favorites router.
- `src/app/workers/tasks.py` — include `prompt_version_id` in the chat job result dict.
- `src/app/schemas/chat.py` — add `prompt_version_id: str | None` to `ChatResponse`.
- `src/app/schemas/prompt.py` — add `is_favorited`, `favorite_id` to `PromptVersionOut`.
- `src/app/services/prompt_service.py` — join favorites into version list/detail responses.

### Frontend (all under `frontend/`)

**Create**
- `src/lib/favorites.ts` — axios wrappers + shared query keys.
- `src/hooks/use-favorites.ts` — TanStack Query hooks (list/status/mutations).
- `src/components/optimize/like-button.tsx` — star button used in chat + versions.
- `src/components/versions/version-star.tsx` — thin wrapper sized for the version list.
- `src/app/(dashboard)/prompt-store/page.tsx` — list page.
- `src/app/(dashboard)/prompt-store/[id]/page.tsx` — detail/edit page.
- `src/components/prompt-store/favorite-card.tsx` — one card in the grid.
- `src/components/prompt-store/filter-bar.tsx` — category + tag chip filters.
- `src/components/prompt-store/tag-chip-input.tsx` — editable tag input with autocomplete.
- `src/components/prompt-store/empty-state.tsx`.

**Modify**
- `src/types/api.ts` — add `FavoritePrompt`, `FavoriteStatus`, `FavoriteListItem`, `FavoriteCategory`, extend `PromptVersion`, extend `JobResult` / `ChatResponse`.
- `src/components/layout/sidebar.tsx` — add "Prompt Store" nav entry (keybind `S`) between Versions and Prompt Project.
- `src/components/optimize/result-panel.tsx` (and/or `chat-message.tsx`) — render `<LikeButton>` next to the existing Copy button.
- `src/app/(dashboard)/versions/page.tsx` — show per-family star count.
- `src/app/(dashboard)/versions/[id]/page.tsx` — render `<VersionStar>` in the left list and a larger star in the right toolbar.

---

## Conventions all tasks follow

- **Commits:** after every green test OR after every coherent UI increment, using Conventional Commits (`feat:`, `fix:`, `test:`, `chore:`, `docs:`).
- **TDD (backend):** every repo/service/route change gets a failing test first, then the minimum code to pass.
- **Frontend has no test infra** (per the spec). Tasks end with a manual verification step described in plain English.
- **Working directory:** `cd qa-chatbot` for backend tasks; `cd frontend` for frontend tasks.
- **Pre-commit hooks** run ruff + mypy on backend commits; fix any issues before moving on (do **not** use `--no-verify`).
- **Backend command cheatsheet:**
  - Run one test: `uv run pytest tests/path/test.py::ClassName::test_name -v`
  - Run full backend: `make test` (integration needs the test DB at `localhost:5433`; `make infra` starts it)
  - Generate migration: `make migration name=<slug>`
  - Apply migrations: `make migrate`
  - Lint/format/type: `make check`

---

## Phase 1 — Backend Data Layer

### Task 1: Create the `FavoritePrompt` ORM model

**Files:**
- Create: `qa-chatbot/src/app/models/favorite_prompt.py`
- Modify: `qa-chatbot/src/app/models/__init__.py`
- Modify: `qa-chatbot/src/app/models/user.py`

- [ ] **Step 1: Write the failing test**

Create `qa-chatbot/tests/unit/test_favorite_prompt_model.py`:

```python
import uuid

from app.models.favorite_prompt import FavoritePrompt


def test_favorite_prompt_defaults() -> None:
    fav = FavoritePrompt(
        user_id=uuid.uuid4(),
        prompt_version_id=uuid.uuid4(),
    )
    assert fav.tags == []
    assert fav.category == "Other"
    assert fav.is_pinned is False
    assert fav.use_count == 0
    assert fav.note is None
    assert fav.last_used_at is None


def test_favorite_prompt_tablename() -> None:
    assert FavoritePrompt.__tablename__ == "favorite_prompts"
```

- [ ] **Step 2: Run the test — expect ImportError / ModuleNotFoundError**

```bash
cd qa-chatbot
uv run pytest tests/unit/test_favorite_prompt_model.py -v
```

Expected: `ModuleNotFoundError: No module named 'app.models.favorite_prompt'`.

- [ ] **Step 3: Create the model file**

`qa-chatbot/src/app/models/favorite_prompt.py`:

```python
from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from .prompt_version import PromptVersion
    from .user import User


class FavoritePrompt(Base, UUIDMixin, TimestampMixin):
    """
    A user's "liked" prompt version — the backing row for a Prompt Store entry.

    The primary key `id` is the `prompt_store_id` exposed to clients.
    """

    __tablename__ = "favorite_prompts"
    __table_args__ = (
        UniqueConstraint("user_id", "prompt_version_id", name="uq_favorite_user_version"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    prompt_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("prompt_versions.id", ondelete="CASCADE"), index=True
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    tags: Mapped[list[Any]] = mapped_column(JSON, default=list, server_default="[]")
    category: Mapped[str] = mapped_column(String(20), default="Other", server_default="Other")
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    use_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    liked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    user: Mapped[User] = relationship(back_populates="favorite_prompts")
    prompt_version: Mapped[PromptVersion] = relationship()
```

- [ ] **Step 4: Register the model**

Edit `qa-chatbot/src/app/models/__init__.py` — add import and export:

```python
from app.models.favorite_prompt import FavoritePrompt
from app.models.health_score import HealthScore
from app.models.message import Message
from app.models.prompt_version import PromptVersion
from app.models.session import ChatSession
from app.models.template import Template
from app.models.user import User

__all__ = [
    "User",
    "ChatSession",
    "Message",
    "PromptVersion",
    "Template",
    "HealthScore",
    "FavoritePrompt",
]
```

- [ ] **Step 5: Add the back-reference on User**

Edit `qa-chatbot/src/app/models/user.py`:

```python
if TYPE_CHECKING:
    from .favorite_prompt import FavoritePrompt
    from .prompt_version import PromptVersion
    from .session import ChatSession
```

And add the relationship inside the `User` class (after `prompt_versions`):

```python
    favorite_prompts: Mapped[list[FavoritePrompt]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
```

- [ ] **Step 6: Run the test — expect PASS**

```bash
cd qa-chatbot
uv run pytest tests/unit/test_favorite_prompt_model.py -v
```

Expected: 2 passed.

- [ ] **Step 7: Commit**

```bash
cd qa-chatbot
git add src/app/models/favorite_prompt.py src/app/models/__init__.py src/app/models/user.py tests/unit/test_favorite_prompt_model.py
git commit -m "feat(backend): add FavoritePrompt ORM model"
```

---

### Task 2: Alembic migration for `favorite_prompts`

**Files:**
- Create: `qa-chatbot/src/app/migrations/versions/f7b0c1a2d3e4_add_favorite_prompts.py`

- [ ] **Step 1: Generate a migration file skeleton**

Use a fixed revision id so the plan is reproducible:

```bash
cd qa-chatbot
uv run alembic revision -m "add favorite_prompts table" --rev-id=f7b0c1a2d3e4
```

This creates a file at `src/app/migrations/versions/f7b0c1a2d3e4_add_favorite_prompts_table.py`. Delete it — we're writing the authoritative version below.

```bash
rm src/app/migrations/versions/f7b0c1a2d3e4_add_favorite_prompts_table.py
```

- [ ] **Step 2: Write the migration**

Create `qa-chatbot/src/app/migrations/versions/f7b0c1a2d3e4_add_favorite_prompts.py`:

```python
"""add favorite_prompts table

Revision ID: f7b0c1a2d3e4
Revises: e6f7a8b9c0d1
Create Date: 2026-04-23 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f7b0c1a2d3e4"
down_revision: str | Sequence[str] | None = "e6f7a8b9c0d1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "favorite_prompts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("prompt_version_id", sa.Uuid(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("tags", sa.JSON(), server_default=sa.text("'[]'::json"), nullable=False),
        sa.Column(
            "category",
            sa.String(length=20),
            server_default=sa.text("'Other'"),
            nullable=False,
        ),
        sa.Column("is_pinned", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("use_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "liked_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["prompt_version_id"], ["prompt_versions.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id", "prompt_version_id", name="uq_favorite_user_version"
        ),
    )
    op.create_index(
        op.f("ix_favorite_prompts_user_id"),
        "favorite_prompts",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_favorite_prompts_prompt_version_id"),
        "favorite_prompts",
        ["prompt_version_id"],
        unique=False,
    )
    op.create_index(
        "ix_favorite_prompts_user_pinned_liked",
        "favorite_prompts",
        ["user_id", "is_pinned", sa.text("liked_at DESC")],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_favorite_prompts_user_pinned_liked", table_name="favorite_prompts")
    op.drop_index(
        op.f("ix_favorite_prompts_prompt_version_id"), table_name="favorite_prompts"
    )
    op.drop_index(op.f("ix_favorite_prompts_user_id"), table_name="favorite_prompts")
    op.drop_table("favorite_prompts")
```

- [ ] **Step 3: Apply the migration**

```bash
cd qa-chatbot
make migrate
```

Expected: `Running upgrade e6f7a8b9c0d1 -> f7b0c1a2d3e4, add favorite_prompts table`.

- [ ] **Step 4: Verify the schema**

```bash
cd qa-chatbot
docker compose exec postgres psql -U postgres -d qa_chatbot -c "\d favorite_prompts"
```

Expected: shows all columns, PK, 2 FKs, unique constraint, and 3 indexes.

- [ ] **Step 5: Test rollback and re-apply**

```bash
cd qa-chatbot
make rollback && make migrate
```

Expected: clean down + up with no errors.

- [ ] **Step 6: Commit**

```bash
cd qa-chatbot
git add src/app/migrations/versions/f7b0c1a2d3e4_add_favorite_prompts.py
git commit -m "feat(backend): migration for favorite_prompts table"
```

---

### Task 3: `FavoriteRepository` — create / idempotent get-or-create / unique constraint

**Files:**
- Create: `qa-chatbot/src/app/repositories/favorite_repo.py`
- Create: `qa-chatbot/tests/unit/repositories/__init__.py` (empty, if missing)
- Create: `qa-chatbot/tests/unit/repositories/test_favorite_repo.py`

- [ ] **Step 1: Create the test file with the first test**

`qa-chatbot/tests/unit/repositories/test_favorite_repo.py`:

```python
import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.favorite_prompt import FavoritePrompt
from app.models.prompt_version import PromptVersion
from app.models.user import User
from app.repositories.favorite_repo import FavoriteRepository


async def _make_user(db: AsyncSession, email: str = "alice@test.com") -> User:
    u = User(email=email)
    db.add(u)
    await db.flush()
    return u


async def _make_version(db: AsyncSession, user: User, *, name: str = "fam", version: int = 1) -> PromptVersion:
    pv = PromptVersion(
        prompt_id=uuid.uuid4(),
        user_id=user.id,
        name=name,
        version=version,
        content="hello world",
    )
    db.add(pv)
    await db.flush()
    return pv


@pytest.mark.asyncio
async def test_create_favorite(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    version = await _make_version(db_session, user)
    repo = FavoriteRepository(db_session)

    fav = await repo.create(
        user_id=user.id,
        prompt_version_id=version.id,
    )

    assert isinstance(fav, FavoritePrompt)
    assert fav.user_id == user.id
    assert fav.prompt_version_id == version.id
    assert fav.tags == []
    assert fav.category == "Other"


@pytest.mark.asyncio
async def test_get_by_version_returns_none_when_missing(db_session: AsyncSession) -> None:
    user = await _make_user(db_session, email="a1@test.com")
    version = await _make_version(db_session, user)
    repo = FavoriteRepository(db_session)

    fav = await repo.get_by_version(user_id=user.id, prompt_version_id=version.id)
    assert fav is None


@pytest.mark.asyncio
async def test_get_by_version_returns_existing(db_session: AsyncSession) -> None:
    user = await _make_user(db_session, email="a2@test.com")
    version = await _make_version(db_session, user)
    repo = FavoriteRepository(db_session)
    created = await repo.create(user_id=user.id, prompt_version_id=version.id)

    fetched = await repo.get_by_version(user_id=user.id, prompt_version_id=version.id)
    assert fetched is not None
    assert fetched.id == created.id


@pytest.mark.asyncio
async def test_get_by_version_is_user_scoped(db_session: AsyncSession) -> None:
    owner = await _make_user(db_session, email="o@test.com")
    other = await _make_user(db_session, email="x@test.com")
    version = await _make_version(db_session, owner)
    repo = FavoriteRepository(db_session)
    await repo.create(user_id=owner.id, prompt_version_id=version.id)

    # Other user must not see owner's favorite
    assert await repo.get_by_version(user_id=other.id, prompt_version_id=version.id) is None
```

- [ ] **Step 2: Run and watch the tests fail**

```bash
cd qa-chatbot
uv run pytest tests/unit/repositories/test_favorite_repo.py -v
```

Expected: `ModuleNotFoundError: No module named 'app.repositories.favorite_repo'`.

- [ ] **Step 3: Write the repository**

`qa-chatbot/src/app/repositories/favorite_repo.py`:

```python
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.orm import selectinload

from app.models.favorite_prompt import FavoritePrompt
from app.models.prompt_version import PromptVersion
from app.repositories.base import BaseRepository


class FavoriteRepository(BaseRepository[FavoritePrompt]):
    model = FavoritePrompt

    async def get_by_version(
        self, *, user_id: UUID, prompt_version_id: UUID
    ) -> FavoritePrompt | None:
        result = await self.db.execute(
            select(FavoritePrompt).where(
                FavoritePrompt.user_id == user_id,
                FavoritePrompt.prompt_version_id == prompt_version_id,
            )
        )
        return result.scalar_one_or_none()

    async def get_for_user(
        self, *, favorite_id: UUID, user_id: UUID
    ) -> FavoritePrompt | None:
        """Return the favorite only if it belongs to the given user."""
        result = await self.db.execute(
            select(FavoritePrompt)
            .options(selectinload(FavoritePrompt.prompt_version))
            .where(FavoritePrompt.id == favorite_id, FavoritePrompt.user_id == user_id)
        )
        return result.scalar_one_or_none()

    async def list_for_user(
        self,
        *,
        user_id: UUID,
        q: str | None = None,
        category: str | None = None,
        tags: list[str] | None = None,
        sort: str = "recently_liked",
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[FavoritePrompt], int]:
        """Return (rows, total_count) for the list endpoint."""
        stmt = (
            select(FavoritePrompt)
            .options(selectinload(FavoritePrompt.prompt_version))
            .join(PromptVersion, FavoritePrompt.prompt_version_id == PromptVersion.id)
            .where(FavoritePrompt.user_id == user_id)
        )

        if category:
            stmt = stmt.where(FavoritePrompt.category == category)

        if q:
            like = f"%{q}%"
            stmt = stmt.where(
                (PromptVersion.name.ilike(like))
                | (PromptVersion.content.ilike(like))
                | (FavoritePrompt.note.ilike(like))
                | (func.cast(FavoritePrompt.tags, func.text()).ilike(like))  # type: ignore[arg-type]
            )

        if tags:
            # Each tag must appear in the tags array (AND semantics).
            # Portable filter: match JSON text representation.
            for tag in tags:
                stmt = stmt.where(
                    func.cast(FavoritePrompt.tags, func.text()).ilike(f"%\"{tag}\"%")  # type: ignore[arg-type]
                )

        # Pin first, then requested sort
        pinned_first = FavoritePrompt.is_pinned.desc()
        sort_map = {
            "recently_liked": FavoritePrompt.liked_at.desc(),
            "recently_used": FavoritePrompt.last_used_at.desc().nullslast(),
            "most_used": FavoritePrompt.use_count.desc(),
            "name": PromptVersion.name.asc(),
        }
        order = sort_map.get(sort, FavoritePrompt.liked_at.desc())
        stmt = stmt.order_by(pinned_first, order)

        # Count before pagination
        count_stmt = (
            select(func.count())
            .select_from(FavoritePrompt)
            .where(FavoritePrompt.user_id == user_id)
        )
        total = (await self.db.execute(count_stmt)).scalar_one()

        stmt = stmt.limit(limit).offset(offset)
        rows = (await self.db.execute(stmt)).scalars().all()
        return list(rows), int(total)

    async def distinct_tags(self, *, user_id: UUID) -> list[str]:
        """Return the user's distinct set of tags across all favorites."""
        stmt = select(FavoritePrompt.tags).where(FavoritePrompt.user_id == user_id)
        rows = (await self.db.execute(stmt)).scalars().all()
        seen: set[str] = set()
        for tag_list in rows:
            if isinstance(tag_list, list):
                for t in tag_list:
                    if isinstance(t, str):
                        seen.add(t)
        return sorted(seen)

    async def increment_use(self, *, favorite_id: UUID, user_id: UUID) -> None:
        await self.db.execute(
            update(FavoritePrompt)
            .where(
                FavoritePrompt.id == favorite_id,
                FavoritePrompt.user_id == user_id,
            )
            .values(
                use_count=FavoritePrompt.use_count + 1,
                last_used_at=datetime.now(timezone.utc),
            )
        )
        await self.db.flush()

    async def update_fields(
        self, instance: FavoritePrompt, **fields: Any
    ) -> FavoritePrompt:
        return await self.update(instance, **fields)
```

- [ ] **Step 4: Run the first four tests — expect PASS**

```bash
cd qa-chatbot
uv run pytest tests/unit/repositories/test_favorite_repo.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Add tests for unique constraint, list, tags, increment_use**

Append to `tests/unit/repositories/test_favorite_repo.py`:

```python
import asyncio
from datetime import datetime, timezone


@pytest.mark.asyncio
async def test_unique_constraint_prevents_duplicate(db_session: AsyncSession) -> None:
    from sqlalchemy.exc import IntegrityError

    user = await _make_user(db_session, email="u1@test.com")
    version = await _make_version(db_session, user)
    repo = FavoriteRepository(db_session)

    await repo.create(user_id=user.id, prompt_version_id=version.id)
    with pytest.raises(IntegrityError):
        await repo.create(user_id=user.id, prompt_version_id=version.id)


@pytest.mark.asyncio
async def test_list_for_user_returns_only_own(db_session: AsyncSession) -> None:
    user_a = await _make_user(db_session, email="la@test.com")
    user_b = await _make_user(db_session, email="lb@test.com")
    v_a = await _make_version(db_session, user_a)
    v_b = await _make_version(db_session, user_b)
    repo = FavoriteRepository(db_session)
    await repo.create(user_id=user_a.id, prompt_version_id=v_a.id)
    await repo.create(user_id=user_b.id, prompt_version_id=v_b.id)

    rows, total = await repo.list_for_user(user_id=user_a.id)
    assert total == 1
    assert len(rows) == 1
    assert rows[0].user_id == user_a.id


@pytest.mark.asyncio
async def test_list_filters_by_category_and_tag(db_session: AsyncSession) -> None:
    user = await _make_user(db_session, email="lf@test.com")
    v1 = await _make_version(db_session, user, name="a", version=1)
    v2 = await _make_version(db_session, user, name="b", version=1)
    repo = FavoriteRepository(db_session)
    await repo.create(
        user_id=user.id, prompt_version_id=v1.id,
        category="Writing", tags=["email", "cold"],
    )
    await repo.create(
        user_id=user.id, prompt_version_id=v2.id,
        category="Coding", tags=["python"],
    )

    rows, _ = await repo.list_for_user(user_id=user.id, category="Writing")
    assert len(rows) == 1 and rows[0].category == "Writing"

    rows, _ = await repo.list_for_user(user_id=user.id, tags=["python"])
    assert len(rows) == 1 and "python" in rows[0].tags


@pytest.mark.asyncio
async def test_list_pins_first(db_session: AsyncSession) -> None:
    user = await _make_user(db_session, email="lp@test.com")
    v1 = await _make_version(db_session, user, name="a", version=1)
    v2 = await _make_version(db_session, user, name="b", version=1)
    repo = FavoriteRepository(db_session)
    # Create v1 first (older), but pin v2 — v2 should come first
    f1 = await repo.create(user_id=user.id, prompt_version_id=v1.id)
    await asyncio.sleep(0.01)
    f2 = await repo.create(user_id=user.id, prompt_version_id=v2.id, is_pinned=True)

    rows, _ = await repo.list_for_user(user_id=user.id)
    assert rows[0].id == f2.id
    assert rows[1].id == f1.id


@pytest.mark.asyncio
async def test_distinct_tags_is_user_scoped(db_session: AsyncSession) -> None:
    owner = await _make_user(db_session, email="to@test.com")
    other = await _make_user(db_session, email="tx@test.com")
    v_own = await _make_version(db_session, owner, name="o", version=1)
    v_oth = await _make_version(db_session, other, name="x", version=1)
    repo = FavoriteRepository(db_session)
    await repo.create(user_id=owner.id, prompt_version_id=v_own.id, tags=["email", "b2b"])
    await repo.create(user_id=other.id, prompt_version_id=v_oth.id, tags=["python"])

    tags = await repo.distinct_tags(user_id=owner.id)
    assert tags == ["b2b", "email"]


@pytest.mark.asyncio
async def test_increment_use_updates_counter_and_last_used(db_session: AsyncSession) -> None:
    user = await _make_user(db_session, email="iu@test.com")
    version = await _make_version(db_session, user)
    repo = FavoriteRepository(db_session)
    fav = await repo.create(user_id=user.id, prompt_version_id=version.id)
    before = datetime.now(timezone.utc)

    await repo.increment_use(favorite_id=fav.id, user_id=user.id)

    await db_session.refresh(fav)
    assert fav.use_count == 1
    assert fav.last_used_at is not None and fav.last_used_at >= before
```

- [ ] **Step 6: Run the tests — expect PASS**

```bash
cd qa-chatbot
uv run pytest tests/unit/repositories/test_favorite_repo.py -v
```

Expected: 10 passed.

- [ ] **Step 7: Commit**

```bash
cd qa-chatbot
git add src/app/repositories/favorite_repo.py tests/unit/repositories/
git commit -m "feat(backend): FavoriteRepository with list/filter/sort/tags"
```

---

## Phase 2 — Pydantic Schemas & Exceptions

### Task 4: Pydantic schemas for favorites

**Files:**
- Create: `qa-chatbot/src/app/schemas/favorite.py`

- [ ] **Step 1: Write the failing test**

Create `qa-chatbot/tests/unit/test_favorite_schemas.py`:

```python
import uuid
from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from app.schemas.favorite import (
    FavoriteCategory,
    FavoriteCreateRequest,
    FavoriteResponse,
    FavoriteUpdateRequest,
)


def test_create_request_requires_prompt_version_id() -> None:
    with pytest.raises(ValidationError):
        FavoriteCreateRequest()  # type: ignore[call-arg]


def test_create_request_accepts_uuid() -> None:
    req = FavoriteCreateRequest(prompt_version_id=uuid.uuid4())
    assert isinstance(req.prompt_version_id, uuid.UUID)


def test_update_request_all_fields_optional() -> None:
    req = FavoriteUpdateRequest()
    assert req.note is None
    assert req.tags is None
    assert req.category is None
    assert req.is_pinned is None


def test_update_request_validates_category() -> None:
    FavoriteUpdateRequest(category="Writing")
    with pytest.raises(ValidationError):
        FavoriteUpdateRequest(category="Bogus")  # type: ignore[arg-type]


def test_update_request_max_10_tags() -> None:
    FavoriteUpdateRequest(tags=["a"] * 10)
    with pytest.raises(ValidationError):
        FavoriteUpdateRequest(tags=["a"] * 11)


def test_category_enum_values() -> None:
    assert {c.value for c in FavoriteCategory} == {"Writing", "Coding", "Analysis", "Other"}


def test_response_has_prompt_store_id_alias() -> None:
    # FavoriteResponse.id is the prompt_store_id
    r = FavoriteResponse(
        id=uuid.uuid4(),
        prompt_version_id=uuid.uuid4(),
        prompt_id=str(uuid.uuid4()),
        family_name="fam",
        version=1,
        content="hello",
        note=None,
        tags=[],
        category="Other",
        is_pinned=False,
        use_count=0,
        last_used_at=None,
        liked_at=datetime.now(timezone.utc),
        version_created_at=datetime.now(timezone.utc),
        token_usage=None,
    )
    assert r.id
```

- [ ] **Step 2: Run — expect ImportError**

```bash
cd qa-chatbot
uv run pytest tests/unit/test_favorite_schemas.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Create the schemas**

`qa-chatbot/src/app/schemas/favorite.py`:

```python
from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class FavoriteCategory(str, Enum):
    WRITING = "Writing"
    CODING = "Coding"
    ANALYSIS = "Analysis"
    OTHER = "Other"


class FavoriteCreateRequest(BaseModel):
    prompt_version_id: uuid.UUID


class FavoriteUpdateRequest(BaseModel):
    note: str | None = Field(default=None, max_length=4000)
    tags: list[str] | None = Field(default=None, max_length=10)
    category: FavoriteCategory | None = None
    is_pinned: bool | None = None


class FavoriteResponse(BaseModel):
    """
    Single favorite row, flattened with joined version/family data.
    `id` is the prompt_store_id.
    """

    id: uuid.UUID
    prompt_version_id: uuid.UUID
    prompt_id: str
    family_name: str
    version: int
    content: str

    note: str | None
    tags: list[str]
    category: str
    is_pinned: bool
    use_count: int
    last_used_at: datetime | None
    liked_at: datetime
    version_created_at: datetime
    token_usage: dict[str, Any] | None = None


class FavoriteListResponse(BaseModel):
    items: list[FavoriteResponse]
    total: int
    limit: int
    offset: int


class FavoriteStatusResponse(BaseModel):
    is_favorited: bool
    prompt_store_id: uuid.UUID | None


class FavoriteTagsResponse(BaseModel):
    tags: list[str]
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd qa-chatbot
uv run pytest tests/unit/test_favorite_schemas.py -v
```

Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
cd qa-chatbot
git add src/app/schemas/favorite.py tests/unit/test_favorite_schemas.py
git commit -m "feat(backend): pydantic schemas for favorites"
```

---

### Task 5: Custom exceptions for favorites

**Files:**
- Create: `qa-chatbot/src/app/api/v1/exceptions/favorites.py`

- [ ] **Step 1: Create the exception module**

`qa-chatbot/src/app/api/v1/exceptions/favorites.py`:

```python
from fastapi import HTTPException, status


class FavoriteNotFoundException(HTTPException):
    def __init__(self, detail: str = "Favorite not found.") -> None:
        super().__init__(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


class FavoriteVersionNotFoundException(HTTPException):
    def __init__(self, detail: str = "Prompt version not found.") -> None:
        super().__init__(status_code=status.HTTP_404_NOT_FOUND, detail=detail)
```

- [ ] **Step 2: Commit**

```bash
cd qa-chatbot
git add src/app/api/v1/exceptions/favorites.py
git commit -m "feat(backend): favorites-specific HTTP exceptions"
```

---

## Phase 3 — Service Layer (LLM auto-tag + business logic)

### Task 6: LLM auto-tag prompt file

**Files:**
- Create: `qa-chatbot/prompts/favorite_auto_tag.md`

- [ ] **Step 1: Write the prompt**

`qa-chatbot/prompts/favorite_auto_tag.md`:

```markdown
You generate concise tag/category metadata for prompts that a user has saved as a favorite.

Return a SINGLE JSON object. No prose, no code fences, no commentary.

Schema:
{
  "tags": string[],     // 2–4 short, lowercase, hyphen-separated keywords describing the prompt's subject. No quotes, no emoji.
  "category": string    // Exactly one of: "Writing", "Coding", "Analysis", "Other"
}

Rules:
- Tags should describe the SUBJECT or USE CASE (e.g. "email", "cold-outreach", "summarization"), not the style.
- Prefer specific single words or short compounds. Examples: "email", "python", "research", "marketing".
- Never return more than 4 tags.
- If unsure about the category, return "Other".

Prompt to classify:
---
{prompt}
---

Respond with JSON only.
```

- [ ] **Step 2: Commit**

```bash
cd qa-chatbot
git add prompts/favorite_auto_tag.md
git commit -m "feat(backend): auto-tag system prompt for favorites"
```

---

### Task 7: `FavoriteService` — like with LLM auto-tag

**Files:**
- Create: `qa-chatbot/src/app/services/favorite_service.py`
- Create: `qa-chatbot/tests/unit/services/__init__.py` (empty, if missing)
- Create: `qa-chatbot/tests/unit/services/test_favorite_service.py`

- [ ] **Step 1: Write the failing tests**

`qa-chatbot/tests/unit/services/test_favorite_service.py`:

```python
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.prompt_version import PromptVersion
from app.models.user import User
from app.services.favorite_service import FavoriteService


async def _seed(db: AsyncSession) -> tuple[User, PromptVersion]:
    user = User(email=f"u-{uuid.uuid4().hex[:6]}@test.com")
    db.add(user)
    await db.flush()
    pv = PromptVersion(
        prompt_id=uuid.uuid4(),
        user_id=user.id,
        name="fam",
        version=1,
        content="Write a concise cold outreach email to a B2B prospect",
    )
    db.add(pv)
    await db.flush()
    return user, pv


@pytest.mark.asyncio
async def test_like_creates_row_with_llm_tags(db_session: AsyncSession) -> None:
    user, pv = await _seed(db_session)
    service = FavoriteService(db_session)
    mock_gen = AsyncMock(return_value=({"email", "cold-outreach"}, "Writing"))

    with patch.object(service, "_generate_tags", mock_gen):
        fav, created = await service.like(user_id=user.id, prompt_version_id=pv.id)

    assert created is True
    assert set(fav.tags) == {"email", "cold-outreach"}
    assert fav.category == "Writing"


@pytest.mark.asyncio
async def test_like_is_idempotent(db_session: AsyncSession) -> None:
    user, pv = await _seed(db_session)
    service = FavoriteService(db_session)
    mock_gen = AsyncMock(return_value=({"x"}, "Other"))

    with patch.object(service, "_generate_tags", mock_gen):
        first, first_created = await service.like(user_id=user.id, prompt_version_id=pv.id)
        second, second_created = await service.like(user_id=user.id, prompt_version_id=pv.id)

    assert first_created is True
    assert second_created is False
    assert first.id == second.id
    # LLM should only be called once
    assert mock_gen.await_count == 1


@pytest.mark.asyncio
async def test_like_falls_back_on_llm_failure(db_session: AsyncSession) -> None:
    user, pv = await _seed(db_session)
    service = FavoriteService(db_session)

    async def _boom(_content: str) -> tuple[set[str], str]:
        raise RuntimeError("network down")

    with patch.object(service, "_generate_tags", _boom):
        fav, created = await service.like(user_id=user.id, prompt_version_id=pv.id)

    assert created is True
    assert fav.tags == []
    assert fav.category == "Other"


@pytest.mark.asyncio
async def test_like_rejects_other_users_version(db_session: AsyncSession) -> None:
    owner, pv = await _seed(db_session)
    stranger = User(email="stranger@test.com")
    db_session.add(stranger)
    await db_session.flush()
    service = FavoriteService(db_session)

    with pytest.raises(LookupError):
        await service.like(user_id=stranger.id, prompt_version_id=pv.id)
```

- [ ] **Step 2: Run — expect ImportError**

```bash
cd qa-chatbot
uv run pytest tests/unit/services/test_favorite_service.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Write the service**

`qa-chatbot/src/app/services/favorite_service.py`:

```python
from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from langchain_openai import ChatOpenAI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.llm import get_llm_settings
from app.graph.prompts import load_prompt
from app.models.favorite_prompt import FavoritePrompt
from app.models.prompt_version import PromptVersion
from app.repositories.favorite_repo import FavoriteRepository

logger = logging.getLogger(__name__)
_VALID_CATEGORIES = {"Writing", "Coding", "Analysis", "Other"}
_LLM_TIMEOUT_SECONDS = 2.0
_AUTO_TAG_PROMPT = load_prompt("favorite_auto_tag")


class FavoriteService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.repo = FavoriteRepository(db)

    async def like(
        self, *, user_id: UUID, prompt_version_id: UUID
    ) -> tuple[FavoritePrompt, bool]:
        """
        Create (or return existing) favorite for (user, version).

        Returns: (favorite, created_flag). Caller commits the session.
        """
        existing = await self.repo.get_by_version(
            user_id=user_id, prompt_version_id=prompt_version_id
        )
        if existing is not None:
            return existing, False

        # Ownership check — user must own the version
        pv = await self.db.execute(
            select(PromptVersion).where(
                PromptVersion.id == prompt_version_id,
                PromptVersion.user_id == user_id,
            )
        )
        version = pv.scalar_one_or_none()
        if version is None:
            raise LookupError("prompt version not found for this user")

        tags: list[str] = []
        category = "Other"
        try:
            tag_set, category = await self._generate_tags(version.content)
            tags = sorted(tag_set)
        except Exception as exc:  # noqa: BLE001
            logger.info("favorite auto-tag failed; using defaults: %s", exc)

        fav = await self.repo.create(
            user_id=user_id,
            prompt_version_id=prompt_version_id,
            tags=tags,
            category=category,
        )
        return fav, True

    async def unlike(self, *, user_id: UUID, favorite_id: UUID) -> bool:
        fav = await self.repo.get_for_user(favorite_id=favorite_id, user_id=user_id)
        if fav is None:
            return False
        await self.repo.delete(fav)
        return True

    async def unlike_by_version(
        self, *, user_id: UUID, prompt_version_id: UUID
    ) -> bool:
        fav = await self.repo.get_by_version(
            user_id=user_id, prompt_version_id=prompt_version_id
        )
        if fav is None:
            return False
        await self.repo.delete(fav)
        return True

    async def status(
        self, *, user_id: UUID, prompt_version_id: UUID
    ) -> tuple[bool, UUID | None]:
        fav = await self.repo.get_by_version(
            user_id=user_id, prompt_version_id=prompt_version_id
        )
        return (fav is not None, fav.id if fav else None)

    async def update(
        self,
        *,
        user_id: UUID,
        favorite_id: UUID,
        fields: dict[str, Any],
    ) -> FavoritePrompt | None:
        fav = await self.repo.get_for_user(favorite_id=favorite_id, user_id=user_id)
        if fav is None:
            return None
        return await self.repo.update_fields(fav, **fields)

    async def increment_use(self, *, user_id: UUID, favorite_id: UUID) -> bool:
        fav = await self.repo.get_for_user(favorite_id=favorite_id, user_id=user_id)
        if fav is None:
            return False
        await self.repo.increment_use(favorite_id=favorite_id, user_id=user_id)
        return True

    # -------------------- LLM call --------------------

    async def _generate_tags(self, content: str) -> tuple[set[str], str]:
        """Call OpenRouter to produce tags + category. Returns ({tags}, category)."""
        llm_settings = get_llm_settings()
        council = llm_settings.COUNCIL_MODELS
        model_name = council[0] if council else llm_settings.DEFAULT_MODEL

        model = ChatOpenAI(
            model=model_name,
            openai_api_base="https://openrouter.ai/api/v1",
            openai_api_key=llm_settings.OPENROUTER_API_KEY.get_secret_value(),
            max_tokens=150,
            temperature=0,
        )

        prompt = _AUTO_TAG_PROMPT.replace("{prompt}", content[:4000])
        response = await asyncio.wait_for(
            model.ainvoke([{"role": "user", "content": prompt}]),
            timeout=_LLM_TIMEOUT_SECONDS,
        )
        raw = str(response.content).strip()
        parsed = _extract_json_object(raw)

        tags_raw = parsed.get("tags", []) if isinstance(parsed, dict) else []
        category_raw = parsed.get("category", "Other") if isinstance(parsed, dict) else "Other"

        tags: set[str] = set()
        for t in tags_raw if isinstance(tags_raw, list) else []:
            if isinstance(t, str):
                cleaned = t.strip().lower()
                if cleaned:
                    tags.add(cleaned)
            if len(tags) >= 4:
                break

        category = category_raw if category_raw in _VALID_CATEGORIES else "Other"
        return tags, category


def _extract_json_object(raw: str) -> dict[str, Any]:
    """Pull a JSON object out of a possibly fenced model response."""
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", raw)
    candidate = fence.group(1).strip() if fence else raw
    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError:
        first = candidate.find("{")
        last = candidate.rfind("}")
        if first == -1 or last == -1:
            return {}
        try:
            parsed = json.loads(candidate[first : last + 1])
        except json.JSONDecodeError:
            return {}
    return parsed if isinstance(parsed, dict) else {}
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd qa-chatbot
uv run pytest tests/unit/services/test_favorite_service.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Add `_extract_json_object` edge-case tests**

Append to `tests/unit/services/test_favorite_service.py`:

```python
def test_extract_json_object_plain() -> None:
    from app.services.favorite_service import _extract_json_object
    assert _extract_json_object('{"tags": ["a"], "category": "Writing"}') == {
        "tags": ["a"],
        "category": "Writing",
    }


def test_extract_json_object_fenced() -> None:
    from app.services.favorite_service import _extract_json_object
    raw = '```json\n{"tags": [], "category": "Other"}\n```'
    assert _extract_json_object(raw) == {"tags": [], "category": "Other"}


def test_extract_json_object_garbage_returns_empty() -> None:
    from app.services.favorite_service import _extract_json_object
    assert _extract_json_object("totally not json") == {}
```

- [ ] **Step 6: Run — expect PASS**

```bash
cd qa-chatbot
uv run pytest tests/unit/services/test_favorite_service.py -v
```

Expected: 7 passed.

- [ ] **Step 7: Commit**

```bash
cd qa-chatbot
git add src/app/services/favorite_service.py tests/unit/services/
git commit -m "feat(backend): FavoriteService with LLM auto-tag + graceful fallback"
```

---

## Phase 4 — HTTP API

### Task 8: Favorites router — POST / DELETE / status

**Files:**
- Create: `qa-chatbot/src/app/api/v1/favorites.py`
- Modify: `qa-chatbot/src/app/api/router.py`
- Create: `qa-chatbot/tests/integration/api/test_favorites.py`

- [ ] **Step 1: Write the first integration tests**

`qa-chatbot/tests/integration/api/test_favorites.py`:

```python
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.models.prompt_version import PromptVersion
from app.models.user import User


async def _make_user_and_token(db: AsyncSession, email: str) -> tuple[User, str]:
    user = User(email=email)
    db.add(user)
    await db.flush()
    token = create_access_token(sub=str(user.id))
    return user, token


async def _make_version(db: AsyncSession, user: User, content: str = "demo prompt") -> PromptVersion:
    pv = PromptVersion(
        prompt_id=uuid.uuid4(),
        user_id=user.id,
        name="fam-" + uuid.uuid4().hex[:6],
        version=1,
        content=content,
    )
    db.add(pv)
    await db.flush()
    return pv


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_post_favorites_creates(client: AsyncClient, db_session: AsyncSession) -> None:
    user, token = await _make_user_and_token(db_session, "a@test.com")
    pv = await _make_version(db_session, user)
    await db_session.commit()

    with patch(
        "app.services.favorite_service.FavoriteService._generate_tags",
        AsyncMock(return_value=({"email"}, "Writing")),
    ):
        res = await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv.id)},
            headers=_auth(token),
        )

    assert res.status_code == 201
    body = res.json()["data"]
    assert body["prompt_version_id"] == str(pv.id)
    assert body["category"] == "Writing"
    assert body["tags"] == ["email"]
    assert body["id"]  # prompt_store_id


@pytest.mark.asyncio
async def test_post_favorites_idempotent(client: AsyncClient, db_session: AsyncSession) -> None:
    user, token = await _make_user_and_token(db_session, "i@test.com")
    pv = await _make_version(db_session, user)
    await db_session.commit()

    with patch(
        "app.services.favorite_service.FavoriteService._generate_tags",
        AsyncMock(return_value=(set(), "Other")),
    ):
        first = await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv.id)},
            headers=_auth(token),
        )
        second = await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv.id)},
            headers=_auth(token),
        )

    assert first.status_code == 201
    assert second.status_code == 200
    assert first.json()["data"]["id"] == second.json()["data"]["id"]


@pytest.mark.asyncio
async def test_post_favorites_requires_auth(client: AsyncClient) -> None:
    res = await client.post("/api/v1/favorites", json={"prompt_version_id": str(uuid.uuid4())})
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_post_favorites_rejects_other_users_version(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner, _ = await _make_user_and_token(db_session, "owner@test.com")
    _, other_token = await _make_user_and_token(db_session, "other@test.com")
    pv = await _make_version(db_session, owner)
    await db_session.commit()

    res = await client.post(
        "/api/v1/favorites",
        json={"prompt_version_id": str(pv.id)},
        headers=_auth(other_token),
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_delete_favorite_by_id(client: AsyncClient, db_session: AsyncSession) -> None:
    user, token = await _make_user_and_token(db_session, "d@test.com")
    pv = await _make_version(db_session, user)
    await db_session.commit()

    with patch(
        "app.services.favorite_service.FavoriteService._generate_tags",
        AsyncMock(return_value=(set(), "Other")),
    ):
        created = await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv.id)},
            headers=_auth(token),
        )
    fav_id = created.json()["data"]["id"]

    res = await client.delete(f"/api/v1/favorites/{fav_id}", headers=_auth(token))
    assert res.status_code == 204

    # Deleting again → 404
    res2 = await client.delete(f"/api/v1/favorites/{fav_id}", headers=_auth(token))
    assert res2.status_code == 404


@pytest.mark.asyncio
async def test_delete_by_version(client: AsyncClient, db_session: AsyncSession) -> None:
    user, token = await _make_user_and_token(db_session, "dv@test.com")
    pv = await _make_version(db_session, user)
    await db_session.commit()

    with patch(
        "app.services.favorite_service.FavoriteService._generate_tags",
        AsyncMock(return_value=(set(), "Other")),
    ):
        await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv.id)},
            headers=_auth(token),
        )

    res = await client.delete(
        f"/api/v1/favorites/by-version/{pv.id}", headers=_auth(token)
    )
    assert res.status_code == 204


@pytest.mark.asyncio
async def test_status_endpoint(client: AsyncClient, db_session: AsyncSession) -> None:
    user, token = await _make_user_and_token(db_session, "s@test.com")
    pv = await _make_version(db_session, user)
    await db_session.commit()

    # Not favorited
    res = await client.get(
        f"/api/v1/favorites/status?prompt_version_id={pv.id}",
        headers=_auth(token),
    )
    assert res.json()["data"] == {"is_favorited": False, "prompt_store_id": None}

    with patch(
        "app.services.favorite_service.FavoriteService._generate_tags",
        AsyncMock(return_value=(set(), "Other")),
    ):
        created = await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv.id)},
            headers=_auth(token),
        )
    sid = created.json()["data"]["id"]

    res = await client.get(
        f"/api/v1/favorites/status?prompt_version_id={pv.id}",
        headers=_auth(token),
    )
    assert res.json()["data"]["is_favorited"] is True
    assert res.json()["data"]["prompt_store_id"] == sid
```

- [ ] **Step 2: Run — expect 404 on every route (router not registered)**

```bash
cd qa-chatbot
uv run pytest tests/integration/api/test_favorites.py -v
```

- [ ] **Step 3: Create the router**

`qa-chatbot/src/app/api/v1/favorites.py`:

```python
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.types.response import SuccessResponse
from app.api.v1.exceptions.favorites import (
    FavoriteNotFoundException,
    FavoriteVersionNotFoundException,
)
from app.dependencies import get_current_user, get_db
from app.models.favorite_prompt import FavoritePrompt
from app.models.user import User
from app.schemas.favorite import (
    FavoriteCreateRequest,
    FavoriteListResponse,
    FavoriteResponse,
    FavoriteStatusResponse,
    FavoriteTagsResponse,
    FavoriteUpdateRequest,
)
from app.services.favorite_service import FavoriteService

router = APIRouter(prefix="/favorites", tags=["favorites"])


def _to_response(fav: FavoritePrompt) -> FavoriteResponse:
    pv = fav.prompt_version
    return FavoriteResponse(
        id=fav.id,
        prompt_version_id=fav.prompt_version_id,
        prompt_id=str(pv.prompt_id),
        family_name=pv.name,
        version=pv.version,
        content=pv.content,
        note=fav.note,
        tags=list(fav.tags or []),
        category=fav.category,
        is_pinned=fav.is_pinned,
        use_count=fav.use_count,
        last_used_at=fav.last_used_at,
        liked_at=fav.liked_at,
        version_created_at=pv.created_at,
        token_usage=None,  # populated in later task if/when wired to Message.token_usage
    )


@router.post("", response_model=SuccessResponse[FavoriteResponse])
async def like(
    request: FavoriteCreateRequest,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[FavoriteResponse]:
    service = FavoriteService(db)
    try:
        fav, created = await service.like(
            user_id=current_user.id, prompt_version_id=request.prompt_version_id
        )
    except LookupError as exc:
        raise FavoriteVersionNotFoundException() from exc

    # Load joined version for the response
    fav = await service.repo.get_for_user(favorite_id=fav.id, user_id=current_user.id)  # type: ignore[assignment]
    assert fav is not None
    await db.commit()

    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return SuccessResponse(data=_to_response(fav))


@router.delete("/{favorite_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unlike(
    favorite_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> Response:
    service = FavoriteService(db)
    deleted = await service.unlike(user_id=current_user.id, favorite_id=favorite_id)
    if not deleted:
        raise FavoriteNotFoundException()
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/by-version/{prompt_version_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unlike_by_version(
    prompt_version_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> Response:
    service = FavoriteService(db)
    deleted = await service.unlike_by_version(
        user_id=current_user.id, prompt_version_id=prompt_version_id
    )
    if not deleted:
        raise FavoriteNotFoundException()
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/status", response_model=SuccessResponse[FavoriteStatusResponse])
async def status_endpoint(
    prompt_version_id: Annotated[uuid.UUID, Query()],
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[FavoriteStatusResponse]:
    service = FavoriteService(db)
    is_fav, pid = await service.status(
        user_id=current_user.id, prompt_version_id=prompt_version_id
    )
    return SuccessResponse(
        data=FavoriteStatusResponse(is_favorited=is_fav, prompt_store_id=pid)
    )
```

- [ ] **Step 4: Register the router**

Edit `qa-chatbot/src/app/api/router.py`:

```python
from fastapi import APIRouter

from app.api.v1 import auth, chat, favorites, health, prompts, stats, templates, users

api_router = APIRouter()

api_router.include_router(health.router)
api_router.include_router(chat.router)
api_router.include_router(prompts.router)
api_router.include_router(templates.router)
api_router.include_router(stats.router)
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(favorites.router)
```

- [ ] **Step 5: Run — expect PASS**

```bash
cd qa-chatbot
uv run pytest tests/integration/api/test_favorites.py -v
```

Expected: 7 passed.

- [ ] **Step 6: Commit**

```bash
cd qa-chatbot
git add src/app/api/v1/favorites.py src/app/api/router.py tests/integration/api/test_favorites.py
git commit -m "feat(backend): favorites POST/DELETE/status endpoints"
```

---

### Task 9: Favorites router — GET list / GET one / PATCH / POST use / GET tags

**Files:**
- Modify: `qa-chatbot/src/app/api/v1/favorites.py`
- Modify: `qa-chatbot/tests/integration/api/test_favorites.py`

- [ ] **Step 1: Append the failing tests**

Append to `tests/integration/api/test_favorites.py`:

```python
@pytest.mark.asyncio
async def test_list_filter_sort_paginate(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, token = await _make_user_and_token(db_session, "l@test.com")
    pv1 = await _make_version(db_session, user, "apples and oranges")
    pv2 = await _make_version(db_session, user, "python quicksort")
    await db_session.commit()

    with patch(
        "app.services.favorite_service.FavoriteService._generate_tags",
        AsyncMock(side_effect=[({"fruit"}, "Writing"), ({"python"}, "Coding")]),
    ):
        await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv1.id)},
            headers=_auth(token),
        )
        await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv2.id)},
            headers=_auth(token),
        )

    # List all
    res = await client.get("/api/v1/favorites", headers=_auth(token))
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["total"] == 2
    assert len(data["items"]) == 2

    # Filter by category
    res = await client.get(
        "/api/v1/favorites?category=Coding", headers=_auth(token)
    )
    assert res.json()["data"]["total"] == 1
    assert res.json()["data"]["items"][0]["category"] == "Coding"

    # Filter by tag
    res = await client.get("/api/v1/favorites?tag=python", headers=_auth(token))
    assert res.json()["data"]["total"] == 1

    # Search
    res = await client.get("/api/v1/favorites?q=apple", headers=_auth(token))
    assert res.json()["data"]["total"] == 1


@pytest.mark.asyncio
async def test_patch_updates_allowed_fields(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, token = await _make_user_and_token(db_session, "p@test.com")
    pv = await _make_version(db_session, user)
    await db_session.commit()
    with patch(
        "app.services.favorite_service.FavoriteService._generate_tags",
        AsyncMock(return_value=(set(), "Other")),
    ):
        created = await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv.id)},
            headers=_auth(token),
        )
    fid = created.json()["data"]["id"]

    res = await client.patch(
        f"/api/v1/favorites/{fid}",
        json={
            "note": "great for cold outreach",
            "tags": ["email", "sales"],
            "category": "Writing",
            "is_pinned": True,
        },
        headers=_auth(token),
    )
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["note"] == "great for cold outreach"
    assert data["tags"] == ["email", "sales"]
    assert data["category"] == "Writing"
    assert data["is_pinned"] is True


@pytest.mark.asyncio
async def test_patch_validates_category(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, token = await _make_user_and_token(db_session, "pv@test.com")
    pv = await _make_version(db_session, user)
    await db_session.commit()
    with patch(
        "app.services.favorite_service.FavoriteService._generate_tags",
        AsyncMock(return_value=(set(), "Other")),
    ):
        created = await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv.id)},
            headers=_auth(token),
        )
    fid = created.json()["data"]["id"]

    res = await client.patch(
        f"/api/v1/favorites/{fid}",
        json={"category": "NotARealCategory"},
        headers=_auth(token),
    )
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_use_endpoint_increments(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, token = await _make_user_and_token(db_session, "u@test.com")
    pv = await _make_version(db_session, user)
    await db_session.commit()
    with patch(
        "app.services.favorite_service.FavoriteService._generate_tags",
        AsyncMock(return_value=(set(), "Other")),
    ):
        created = await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv.id)},
            headers=_auth(token),
        )
    fid = created.json()["data"]["id"]

    for _ in range(3):
        await client.post(f"/api/v1/favorites/{fid}/use", headers=_auth(token))

    res = await client.get(f"/api/v1/favorites/{fid}", headers=_auth(token))
    assert res.json()["data"]["use_count"] == 3
    assert res.json()["data"]["last_used_at"] is not None


@pytest.mark.asyncio
async def test_tags_endpoint_is_user_scoped(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user_a, tok_a = await _make_user_and_token(db_session, "ta@test.com")
    user_b, tok_b = await _make_user_and_token(db_session, "tb@test.com")
    pv_a = await _make_version(db_session, user_a)
    pv_b = await _make_version(db_session, user_b)
    await db_session.commit()
    with patch(
        "app.services.favorite_service.FavoriteService._generate_tags",
        AsyncMock(side_effect=[({"alpha", "beta"}, "Other"), ({"gamma"}, "Other")]),
    ):
        await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv_a.id)},
            headers=_auth(tok_a),
        )
        await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv_b.id)},
            headers=_auth(tok_b),
        )

    res = await client.get("/api/v1/favorites/tags", headers=_auth(tok_a))
    assert res.json()["data"]["tags"] == ["alpha", "beta"]
```

- [ ] **Step 2: Append route handlers**

Append to `qa-chatbot/src/app/api/v1/favorites.py`:

```python
@router.get("", response_model=SuccessResponse[FavoriteListResponse])
async def list_favorites(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    q: str | None = Query(default=None),
    category: str | None = Query(default=None),
    tag: list[str] | None = Query(default=None),
    sort: str = Query(default="recently_liked"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> SuccessResponse[FavoriteListResponse]:
    service = FavoriteService(db)
    rows, total = await service.repo.list_for_user(
        user_id=current_user.id,
        q=q,
        category=category,
        tags=tag,
        sort=sort,
        limit=limit,
        offset=offset,
    )
    return SuccessResponse(
        data=FavoriteListResponse(
            items=[_to_response(r) for r in rows],
            total=total,
            limit=limit,
            offset=offset,
        )
    )


@router.get("/tags", response_model=SuccessResponse[FavoriteTagsResponse])
async def list_tags(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[FavoriteTagsResponse]:
    service = FavoriteService(db)
    tags = await service.repo.distinct_tags(user_id=current_user.id)
    return SuccessResponse(data=FavoriteTagsResponse(tags=tags))


@router.get("/{favorite_id}", response_model=SuccessResponse[FavoriteResponse])
async def get_favorite(
    favorite_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[FavoriteResponse]:
    service = FavoriteService(db)
    fav = await service.repo.get_for_user(
        favorite_id=favorite_id, user_id=current_user.id
    )
    if fav is None:
        raise FavoriteNotFoundException()
    return SuccessResponse(data=_to_response(fav))


@router.patch("/{favorite_id}", response_model=SuccessResponse[FavoriteResponse])
async def update_favorite(
    favorite_id: uuid.UUID,
    request: FavoriteUpdateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[FavoriteResponse]:
    update_fields: dict[str, object] = {}
    if request.note is not None:
        update_fields["note"] = request.note
    if request.tags is not None:
        update_fields["tags"] = request.tags
    if request.category is not None:
        update_fields["category"] = request.category.value
    if request.is_pinned is not None:
        update_fields["is_pinned"] = request.is_pinned

    service = FavoriteService(db)
    fav = await service.update(
        user_id=current_user.id, favorite_id=favorite_id, fields=update_fields
    )
    if fav is None:
        raise FavoriteNotFoundException()

    # Re-fetch with joined version so response is complete
    fav = await service.repo.get_for_user(
        favorite_id=favorite_id, user_id=current_user.id
    )
    assert fav is not None
    await db.commit()
    return SuccessResponse(data=_to_response(fav))


@router.post("/{favorite_id}/use", status_code=status.HTTP_204_NO_CONTENT)
async def use_favorite(
    favorite_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> Response:
    service = FavoriteService(db)
    ok = await service.increment_use(user_id=current_user.id, favorite_id=favorite_id)
    if not ok:
        raise FavoriteNotFoundException()
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
```

- [ ] **Step 3: Run — expect PASS**

```bash
cd qa-chatbot
uv run pytest tests/integration/api/test_favorites.py -v
```

Expected: 12 passed.

- [ ] **Step 4: Lint & type check**

```bash
cd qa-chatbot
make check
```

Fix any issues before moving on. Do not use `--no-verify`.

- [ ] **Step 5: Commit**

```bash
cd qa-chatbot
git add src/app/api/v1/favorites.py tests/integration/api/test_favorites.py
git commit -m "feat(backend): favorites list/get/patch/use/tags endpoints"
```

---

## Phase 5 — Wire favorites into existing responses

### Task 10: Add `prompt_version_id` to chat job result

**Files:**
- Modify: `qa-chatbot/src/app/schemas/chat.py`
- Modify: `qa-chatbot/src/app/workers/tasks.py`

- [ ] **Step 1: Extend `ChatResponse`**

Edit `qa-chatbot/src/app/schemas/chat.py` — add one field to `ChatResponse` after `version`:

```python
class ChatResponse(BaseModel):
    session_id: str
    original_prompt: str
    optimized_prompt: str  # final synthesized best prompt
    council_proposals: list[CouncilProposal] | None = None
    token_usage: dict[str, Any]
    # Populated only when the result was saved as a new prompt version
    prompt_id: str | None = None
    version: int | None = None
    prompt_version_id: str | None = None  # UUID of the PromptVersion row (for favorite button)
```

- [ ] **Step 2: Write the value in the Celery task**

Edit `qa-chatbot/src/app/workers/tasks.py`. In `_run()`, after the existing assignments:

```python
                    saved_prompt_id = str(v.prompt_id)
                    saved_version = v.version
```

add:

```python
                    saved_prompt_version_id: str | None = str(v.id)
```

Also declare `saved_prompt_version_id: str | None = None` alongside the other `saved_...` variables earlier (right after `saved_version: int | None = None`), and at the bottom of the versioning block write:

```python
                result["prompt_id"] = saved_prompt_id
                result["version"] = saved_version
                result["prompt_version_id"] = saved_prompt_version_id
```

- [ ] **Step 3: Quick sanity run**

```bash
cd qa-chatbot
uv run pytest tests/integration/api/test_chat.py -v
```

Existing chat tests must still pass. If any test asserts on the result dict shape and fails because of the new field, update the assertion; do not remove the field.

- [ ] **Step 4: Commit**

```bash
cd qa-chatbot
git add src/app/schemas/chat.py src/app/workers/tasks.py
git commit -m "feat(backend): expose prompt_version_id on chat job result"
```

---

### Task 11: Add `is_favorited` + `favorite_id` to `PromptVersionOut`

**Files:**
- Modify: `qa-chatbot/src/app/schemas/prompt.py`
- Modify: `qa-chatbot/src/app/services/prompt_service.py`

- [ ] **Step 1: Extend the schema**

Edit `qa-chatbot/src/app/schemas/prompt.py`:

```python
class PromptVersionOut(BaseModel):
    version_id: str
    prompt_id: str
    name: str
    version: int
    content: str
    created_at: str
    is_favorited: bool = False
    favorite_id: str | None = None

    model_config = {"from_attributes": True}
```

- [ ] **Step 2: Find the versioning service**

```bash
cd qa-chatbot
grep -n "PromptVersioningService" src/app/services/prompt_service.py
```

Note the class location and the methods `list_families`, `list_versions`, `create`.

- [ ] **Step 3: Update the service to join favorites**

In `qa-chatbot/src/app/services/prompt_service.py`, inside `PromptVersioningService`:

- Import at top (alongside existing imports):

```python
from app.models.favorite_prompt import FavoritePrompt
```

- Add a helper method on the class:

```python
    async def _favorites_by_version_id(
        self, user_id: UUID, version_ids: list[UUID]
    ) -> dict[UUID, UUID]:
        """Return {prompt_version_id: favorite_id} for the given versions."""
        if not version_ids:
            return {}
        result = await self.db.execute(
            select(FavoritePrompt.prompt_version_id, FavoritePrompt.id).where(
                FavoritePrompt.user_id == user_id,
                FavoritePrompt.prompt_version_id.in_(version_ids),
            )
        )
        return {row[0]: row[1] for row in result.all()}
```

- In every method that constructs `PromptVersionOut` (`list_families`, `list_versions`, `create`), fetch favorites for the relevant version ids and set `is_favorited` + `favorite_id` accordingly. Example shape for `list_versions`:

```python
    async def list_versions(self, *, prompt_id: UUID, user_id: str) -> dict[str, Any]:
        repo = PromptVersionRepository(self.db)
        versions = await repo.get_all_by_prompt_id(prompt_id, UUID(user_id))
        if not versions:
            raise NotFoundException("prompt family not found")

        fav_map = await self._favorites_by_version_id(
            UUID(user_id), [v.id for v in versions]
        )

        return {
            "prompt_id": str(prompt_id),
            "name": versions[0].name,
            "versions": [
                {
                    "version_id": str(v.id),
                    "prompt_id": str(v.prompt_id),
                    "name": v.name,
                    "version": v.version,
                    "content": v.content,
                    "created_at": v.created_at.isoformat(),
                    "is_favorited": v.id in fav_map,
                    "favorite_id": str(fav_map[v.id]) if v.id in fav_map else None,
                }
                for v in versions
            ],
        }
```

Apply the equivalent pattern to `list_families` (gather all version ids across families first, one query, then mark each) and `create` (single version → single favorite lookup).

- [ ] **Step 4: Add an integration test**

Append to `qa-chatbot/tests/integration/api/test_favorites.py`:

```python
@pytest.mark.asyncio
async def test_prompt_versions_response_includes_favorite_fields(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, token = await _make_user_and_token(db_session, "pf@test.com")
    pv = await _make_version(db_session, user)
    await db_session.commit()

    # Before liking
    res = await client.get(f"/api/v1/prompts/versions/{pv.prompt_id}", headers=_auth(token))
    items = res.json()["data"]["versions"]
    assert any(v["is_favorited"] is False for v in items)

    # Like
    with patch(
        "app.services.favorite_service.FavoriteService._generate_tags",
        AsyncMock(return_value=(set(), "Other")),
    ):
        await client.post(
            "/api/v1/favorites",
            json={"prompt_version_id": str(pv.id)},
            headers=_auth(token),
        )

    # After liking
    res = await client.get(f"/api/v1/prompts/versions/{pv.prompt_id}", headers=_auth(token))
    items = res.json()["data"]["versions"]
    target = [v for v in items if v["version_id"] == str(pv.id)][0]
    assert target["is_favorited"] is True
    assert target["favorite_id"] is not None
```

- [ ] **Step 5: Run — expect PASS**

```bash
cd qa-chatbot
uv run pytest tests/integration/api/test_favorites.py -v
```

Expected: 13 passed.

- [ ] **Step 6: Lint & type check**

```bash
cd qa-chatbot
make check
```

- [ ] **Step 7: Commit**

```bash
cd qa-chatbot
git add src/app/schemas/prompt.py src/app/services/prompt_service.py tests/integration/api/test_favorites.py
git commit -m "feat(backend): surface favorite state on prompt version responses"
```

---

## Phase 6 — Frontend shared infrastructure

### Task 12: Types + API client + TanStack hooks

**Files:**
- Modify: `frontend/src/types/api.ts`
- Create: `frontend/src/lib/favorites.ts`
- Create: `frontend/src/hooks/use-favorites.ts`

- [ ] **Step 1: Find existing type definitions**

```bash
cd frontend
grep -n "PromptVersion\|JobResult\|ChatResponse" src/types/api.ts
```

Note the exact names and shapes to extend.

- [ ] **Step 2: Extend `src/types/api.ts`**

At the bottom of `frontend/src/types/api.ts`, add:

```typescript
// -------------------- Favorites / Prompt Store --------------------

export type FavoriteCategory = 'Writing' | 'Coding' | 'Analysis' | 'Other';

export interface FavoritePrompt {
  id: string;                    // prompt_store_id
  prompt_version_id: string;
  prompt_id: string;
  family_name: string;
  version: number;
  content: string;
  note: string | null;
  tags: string[];
  category: FavoriteCategory;
  is_pinned: boolean;
  use_count: number;
  last_used_at: string | null;
  liked_at: string;
  version_created_at: string;
  token_usage: Record<string, unknown> | null;
}

export interface FavoriteListResponse {
  items: FavoritePrompt[];
  total: number;
  limit: number;
  offset: number;
}

export interface FavoriteStatus {
  is_favorited: boolean;
  prompt_store_id: string | null;
}

export interface FavoriteTagsResponse {
  tags: string[];
}

export type FavoriteSort =
  | 'recently_liked'
  | 'recently_used'
  | 'most_used'
  | 'name';

export interface FavoriteListFilters {
  q?: string;
  category?: FavoriteCategory | null;
  tags?: string[];
  sort?: FavoriteSort;
  limit?: number;
  offset?: number;
}
```

Also extend `PromptVersion` (whatever its existing name is) to add `is_favorited: boolean` and `favorite_id: string | null`. Extend `ChatResponse` / `JobResult` to add `prompt_version_id: string | null`.

- [ ] **Step 3: Create the API helper**

`frontend/src/lib/favorites.ts`:

```typescript
import { api } from '@/lib/api';
import type {
  FavoritePrompt,
  FavoriteListResponse,
  FavoriteListFilters,
  FavoriteStatus,
  FavoriteTagsResponse,
  FavoriteCategory,
} from '@/types/api';

export const favoritesKeys = {
  all: ['favorites'] as const,
  list: (filters: FavoriteListFilters = {}) =>
    ['favorites', 'list', filters] as const,
  detail: (id: string) => ['favorites', 'detail', id] as const,
  status: (versionId: string) => ['favorites', 'status', versionId] as const,
  tags: () => ['favorites', 'tags'] as const,
};

export async function likeVersion(promptVersionId: string): Promise<FavoritePrompt> {
  const res = await api.post<{ data: FavoritePrompt }>('/api/v1/favorites', {
    prompt_version_id: promptVersionId,
  });
  return res.data.data;
}

export async function unlikeByVersion(promptVersionId: string): Promise<void> {
  await api.delete(`/api/v1/favorites/by-version/${promptVersionId}`);
}

export async function unlikeById(favoriteId: string): Promise<void> {
  await api.delete(`/api/v1/favorites/${favoriteId}`);
}

export async function listFavorites(
  filters: FavoriteListFilters = {}
): Promise<FavoriteListResponse> {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.category) params.set('category', filters.category);
  (filters.tags ?? []).forEach(t => params.append('tag', t));
  if (filters.sort) params.set('sort', filters.sort);
  if (filters.limit != null) params.set('limit', String(filters.limit));
  if (filters.offset != null) params.set('offset', String(filters.offset));
  const res = await api.get<{ data: FavoriteListResponse }>(
    `/api/v1/favorites?${params.toString()}`
  );
  return res.data.data;
}

export async function getFavorite(id: string): Promise<FavoritePrompt> {
  const res = await api.get<{ data: FavoritePrompt }>(`/api/v1/favorites/${id}`);
  return res.data.data;
}

export interface FavoritePatchFields {
  note?: string | null;
  tags?: string[];
  category?: FavoriteCategory;
  is_pinned?: boolean;
}

export async function patchFavorite(
  id: string,
  fields: FavoritePatchFields
): Promise<FavoritePrompt> {
  const res = await api.patch<{ data: FavoritePrompt }>(
    `/api/v1/favorites/${id}`,
    fields
  );
  return res.data.data;
}

export async function markUsed(id: string): Promise<void> {
  await api.post(`/api/v1/favorites/${id}/use`);
}

export async function getTags(): Promise<string[]> {
  const res = await api.get<{ data: FavoriteTagsResponse }>('/api/v1/favorites/tags');
  return res.data.data.tags;
}

export async function getStatus(promptVersionId: string): Promise<FavoriteStatus> {
  const res = await api.get<{ data: FavoriteStatus }>(
    `/api/v1/favorites/status?prompt_version_id=${promptVersionId}`
  );
  return res.data.data;
}
```

- [ ] **Step 4: Create the hooks**

`frontend/src/hooks/use-favorites.ts`:

```typescript
'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  favoritesKeys,
  getFavorite,
  getStatus,
  getTags,
  likeVersion,
  listFavorites,
  markUsed,
  patchFavorite,
  unlikeById,
  unlikeByVersion,
  type FavoritePatchFields,
} from '@/lib/favorites';
import type { FavoriteListFilters, FavoriteStatus } from '@/types/api';

export function useFavoriteStatus(promptVersionId: string | null | undefined) {
  return useQuery({
    queryKey: favoritesKeys.status(promptVersionId ?? ''),
    queryFn: () => getStatus(promptVersionId as string),
    enabled: !!promptVersionId,
    staleTime: 30_000,
  });
}

export function useFavoritesList(filters: FavoriteListFilters) {
  return useQuery({
    queryKey: favoritesKeys.list(filters),
    queryFn: () => listFavorites(filters),
    staleTime: 10_000,
  });
}

export function useFavoriteDetail(id: string | undefined) {
  return useQuery({
    queryKey: favoritesKeys.detail(id ?? ''),
    queryFn: () => getFavorite(id as string),
    enabled: !!id,
  });
}

export function useFavoriteTags() {
  return useQuery({
    queryKey: favoritesKeys.tags(),
    queryFn: getTags,
    staleTime: 60_000,
  });
}

export function useLikeMutation(promptVersionId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<FavoriteStatus> => {
      const fav = await likeVersion(promptVersionId as string);
      return { is_favorited: true, prompt_store_id: fav.id };
    },
    onMutate: async () => {
      if (!promptVersionId) return;
      const key = favoritesKeys.status(promptVersionId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<FavoriteStatus>(key);
      qc.setQueryData<FavoriteStatus>(key, {
        is_favorited: true,
        prompt_store_id: null,
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (promptVersionId && ctx?.previous) {
        qc.setQueryData(favoritesKeys.status(promptVersionId), ctx.previous);
      }
      toast.error('Could not save to Prompt Store');
    },
    onSuccess: () => {
      toast.success('Saved to Prompt Store');
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: favoritesKeys.all });
    },
  });
}

export function useUnlikeMutation(promptVersionId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!promptVersionId) return;
      await unlikeByVersion(promptVersionId);
    },
    onMutate: async () => {
      if (!promptVersionId) return;
      const key = favoritesKeys.status(promptVersionId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<FavoriteStatus>(key);
      qc.setQueryData<FavoriteStatus>(key, {
        is_favorited: false,
        prompt_store_id: null,
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (promptVersionId && ctx?.previous) {
        qc.setQueryData(favoritesKeys.status(promptVersionId), ctx.previous);
      }
      toast.error('Could not remove from Prompt Store');
    },
    onSuccess: () => {
      toast.success('Removed from Prompt Store');
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: favoritesKeys.all });
    },
  });
}

export function useUnlikeByIdMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unlikeById(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: favoritesKeys.all });
    },
  });
}

export function usePatchFavorite(id: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fields: FavoritePatchFields) => patchFavorite(id as string, fields),
    onSuccess: updated => {
      if (!id) return;
      qc.setQueryData(favoritesKeys.detail(id), updated);
      qc.invalidateQueries({ queryKey: favoritesKeys.all });
    },
    onError: () => toast.error('Save failed'),
  });
}

export function useMarkUsed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => markUsed(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: favoritesKeys.all });
    },
  });
}
```

- [ ] **Step 5: Type-check**

```bash
cd frontend
npx tsc --noEmit
```

Expected: no errors related to the new files.

- [ ] **Step 6: Commit**

```bash
cd frontend
git add src/types/api.ts src/lib/favorites.ts src/hooks/use-favorites.ts
git commit -m "feat(frontend): favorites types, API client, TanStack hooks"
```

---

## Phase 7 — Like button in chat + Versions page stars

### Task 13: Reusable `<LikeButton>` component

**Files:**
- Create: `frontend/src/components/optimize/like-button.tsx`

- [ ] **Step 1: Write the component**

`frontend/src/components/optimize/like-button.tsx`:

```tsx
'use client';

import { useFavoriteStatus, useLikeMutation, useUnlikeMutation } from '@/hooks/use-favorites';

interface LikeButtonProps {
  promptVersionId: string | null | undefined;
  size?: number;          // star size in px (default 16)
  title?: string;         // tooltip override
}

export function LikeButton({ promptVersionId, size = 16, title }: LikeButtonProps) {
  const { data: status } = useFavoriteStatus(promptVersionId);
  const likeMutation = useLikeMutation(promptVersionId);
  const unlikeMutation = useUnlikeMutation(promptVersionId);

  if (!promptVersionId) return null;

  const isFavorited = !!status?.is_favorited;
  const busy = likeMutation.isPending || unlikeMutation.isPending;

  const handleClick = () => {
    if (busy) return;
    if (isFavorited) unlikeMutation.mutate();
    else likeMutation.mutate();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={isFavorited}
      title={title ?? (isFavorited ? 'Remove from Prompt Store' : 'Save to Prompt Store')}
      style={{
        width: size + 12,
        height: size + 12,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 6,
        border: '1px solid transparent',
        background: 'transparent',
        cursor: busy ? 'default' : 'pointer',
        color: isFavorited ? '#7c5cff' : '#8a8a90',
        opacity: busy ? 0.6 : 1,
        transition: 'color 120ms, background 120ms',
      }}
      onMouseEnter={e => {
        if (!busy) e.currentTarget.style.background = 'rgba(124,92,255,0.08)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={isFavorited ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      >
        <path d="M12 17.3l-5.4 3.2 1.4-6.1-4.6-4.1 6.2-.5L12 4l2.4 5.8 6.2.5-4.6 4.1 1.4 6.1z" />
      </svg>
    </button>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd frontend
git add src/components/optimize/like-button.tsx
git commit -m "feat(frontend): reusable LikeButton component"
```

---

### Task 14: Wire `<LikeButton>` into the chat result panel

**Files:**
- Modify: `frontend/src/components/optimize/result-panel.tsx`

- [ ] **Step 1: Locate the action row**

```bash
cd frontend
grep -n "Copy\|copy\|onCopy" src/components/optimize/result-panel.tsx
```

Identify the row where the Copy button is rendered.

- [ ] **Step 2: Import and add the button**

At the top of `result-panel.tsx`:

```tsx
import { LikeButton } from './like-button';
```

In the action row next to the existing Copy button, add:

```tsx
<LikeButton promptVersionId={result?.prompt_version_id ?? null} size={16} />
```

Where `result` is the current typed `JobResult` / `ChatResponse` in scope (use whatever local variable name already holds it).

- [ ] **Step 3: Type-check**

```bash
cd frontend
npx tsc --noEmit
```

- [ ] **Step 4: Manual verification**

Run the full stack (infra + API + worker + frontend) and:
1. Optimize a prompt — the result shows a star button.
2. Click star → it fills purple and a success toast appears.
3. Click again → it empties and a removal toast appears.
4. Refresh the page → the button reflects the persisted state.

- [ ] **Step 5: Commit**

```bash
cd frontend
git add src/components/optimize/result-panel.tsx
git commit -m "feat(frontend): add LikeButton to chat result panel"
```

---

### Task 15: Stars on the Versions detail page

**Files:**
- Modify: `frontend/src/app/(dashboard)/versions/[id]/page.tsx`

- [ ] **Step 1: Import the LikeButton**

Add at the top of `versions/[id]/page.tsx`:

```tsx
import { LikeButton } from '@/components/optimize/like-button';
```

- [ ] **Step 2: Add a star to each row in the left-hand list**

Inside the `sortedVersions.map((v) => { ... })` block, replace the existing `<div>` with the version number and "latest" badge so it also renders a star. The star sits to the right of the "latest" badge (or where the badge would be). Pass `promptVersionId={v.version_id}`.

Concretely, the top row of the button becomes:

```tsx
<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
  <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 13,
    fontWeight: 600, color: isActive ? '#7c5cff' : '#ededed' }}>v{v.version}</span>
  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
    {isLatest && (
      <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 9.5,
        color: '#7c5cff', background: 'rgba(124,92,255,0.12)', padding: '1px 5px',
        borderRadius: 3 }}>latest</span>
    )}
    <LikeButton promptVersionId={v.version_id} size={12} />
  </div>
</div>
```

Note: this requires the version list response to expose `version_id`. Confirm `PromptVersionOut.version_id` is present (it is per Task 11).

- [ ] **Step 3: Add a large star in the right-hand toolbar**

In the toolbar (where the Diff selector, Copy, and Optimize buttons live), just before the Copy button insert:

```tsx
<LikeButton promptVersionId={activeVersion.version_id} size={14} />
```

- [ ] **Step 4: Type-check**

```bash
cd frontend
npx tsc --noEmit
```

- [ ] **Step 5: Manual verification**

1. Open `/versions/<some prompt id>` for a prompt that has at least 2 versions.
2. Stars appear next to every version row and in the right-hand toolbar.
3. Click to toggle — visual reflects state and survives a page refresh.
4. Cross-check: the same version is also starred on the `/optimize` result if it's the current chat's output.

- [ ] **Step 6: Commit**

```bash
cd frontend
git add "src/app/(dashboard)/versions/[id]/page.tsx"
git commit -m "feat(frontend): star control on Versions detail page"
```

---

### Task 16: Starred-count badge on Versions list page

**Files:**
- Modify: `frontend/src/app/(dashboard)/versions/page.tsx`

- [ ] **Step 1: Compute starred count per family**

In the `FamilyRow` component, add (just above the stripes div):

```tsx
const starredCount = f.versions.filter(v => v.is_favorited).length;
```

And render it (only when > 0) right after the bullet badge that shows `{f.prompt_id.slice(0, 8)}`:

```tsx
{starredCount > 0 && (
  <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
    padding: '2px 6px', borderRadius: 4, background: 'rgba(124,92,255,0.12)',
    border: '1px solid rgba(124,92,255,0.3)', color: '#7c5cff',
    display: 'inline-flex', alignItems: 'center', gap: 3 }}>
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 17.3l-5.4 3.2 1.4-6.1-4.6-4.1 6.2-.5L12 4l2.4 5.8 6.2.5-4.6 4.1 1.4 6.1z" />
    </svg>
    {starredCount}
  </span>
)}
```

- [ ] **Step 2: Type-check**

```bash
cd frontend
npx tsc --noEmit
```

- [ ] **Step 3: Manual verification**

Like a version, then visit `/versions`. The family containing that version shows a purple `⭐ 1` chip.

- [ ] **Step 4: Commit**

```bash
cd frontend
git add "src/app/(dashboard)/versions/page.tsx"
git commit -m "feat(frontend): starred-count badge on Versions list"
```

---

## Phase 8 — Prompt Store page

### Task 17: Sidebar entry + empty route scaffolding

**Files:**
- Modify: `frontend/src/components/layout/sidebar.tsx`
- Create: `frontend/src/app/(dashboard)/prompt-store/page.tsx`
- Create: `frontend/src/app/(dashboard)/prompt-store/[id]/page.tsx`

- [ ] **Step 1: Add the sidebar entry**

Edit the `NAV` array in `frontend/src/components/layout/sidebar.tsx`:

```tsx
const NAV = [
  { key: 'dashboard',      label: 'Dashboard',      href: '/dashboard',      kbd: 'D' },
  { key: 'optimize',       label: 'Optimize',       href: '/optimize',       kbd: 'O' },
  { key: 'analyze',        label: 'Analyze',        href: '/analyze',        kbd: 'A' },
  { key: 'versions',       label: 'Versions',       href: '/versions',       kbd: 'V' },
  { key: 'prompt-store',   label: 'Prompt Store',   href: '/prompt-store',   kbd: 'S' },
  { key: 'prompt-project', label: 'Prompt Project', href: '/prompt-project' },
  { key: 'history',        label: 'History',        href: '/history' },
  { key: 'billing',        label: 'Billing',        href: '/billing' },
];
```

Add an icon for `prompt-store` inside `NavIcon`:

```tsx
    'prompt-store': (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6">
        <path d="M12 17.3l-5.4 3.2 1.4-6.1-4.6-4.1 6.2-.5L12 4l2.4 5.8 6.2.5-4.6 4.1 1.4 6.1z" />
      </svg>
    ),
```

- [ ] **Step 2: Create a placeholder list page**

`frontend/src/app/(dashboard)/prompt-store/page.tsx`:

```tsx
'use client';

export default function PromptStorePage() {
  return (
    <div style={{ padding: 24, color: '#ededed',
      fontFamily: 'var(--font-geist, ui-sans-serif)' }}>
      Prompt Store — coming right up.
    </div>
  );
}
```

- [ ] **Step 3: Create a placeholder detail page**

`frontend/src/app/(dashboard)/prompt-store/[id]/page.tsx`:

```tsx
'use client';

export default function PromptStoreDetailPage({ params }: { params: { id: string } }) {
  return (
    <div style={{ padding: 24, color: '#ededed',
      fontFamily: 'var(--font-geist, ui-sans-serif)' }}>
      Detail for {params.id}
    </div>
  );
}
```

- [ ] **Step 4: Manual verification**

- Click "Prompt Store" in the sidebar — lands on `/prompt-store` with the placeholder message.
- Visit `/prompt-store/<any-uuid>` — shows the detail placeholder.

- [ ] **Step 5: Commit**

```bash
cd frontend
git add src/components/layout/sidebar.tsx "src/app/(dashboard)/prompt-store"
git commit -m "feat(frontend): Prompt Store route scaffolding + sidebar entry"
```

---

### Task 18: Prompt Store list page — cards, search, sort, filters

**Files:**
- Modify: `frontend/src/app/(dashboard)/prompt-store/page.tsx`
- Create: `frontend/src/components/prompt-store/favorite-card.tsx`
- Create: `frontend/src/components/prompt-store/filter-bar.tsx`
- Create: `frontend/src/components/prompt-store/empty-state.tsx`

- [ ] **Step 1: Create the empty-state component**

`frontend/src/components/prompt-store/empty-state.tsx`:

```tsx
'use client';

import Link from 'next/link';

export function EmptyState() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 14, padding: '64px 24px', color: '#8a8a90',
      fontFamily: 'var(--font-geist, ui-sans-serif)' }}>
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none"
        stroke="#5a5a60" strokeWidth="1.3" strokeLinejoin="round">
        <path d="M12 17.3l-5.4 3.2 1.4-6.1-4.6-4.1 6.2-.5L12 4l2.4 5.8 6.2.5-4.6 4.1 1.4 6.1z" />
      </svg>
      <div style={{ fontSize: 14 }}>No saved prompts yet.</div>
      <div style={{ fontSize: 12.5, color: '#5a5a60', maxWidth: 340, textAlign: 'center' }}>
        Tap the star on any optimized result to keep it here for later.
      </div>
      <Link href="/optimize" style={{ marginTop: 6, padding: '8px 14px', borderRadius: 8,
        background: '#7c5cff', color: '#fff', textDecoration: 'none', fontSize: 12.5 }}>
        Go to Optimize
      </Link>
    </div>
  );
}
```

- [ ] **Step 2: Create the filter bar**

`frontend/src/components/prompt-store/filter-bar.tsx`:

```tsx
'use client';

import { useFavoriteTags } from '@/hooks/use-favorites';
import type { FavoriteCategory } from '@/types/api';

const CATEGORIES: (FavoriteCategory | 'All')[] = ['All', 'Writing', 'Coding', 'Analysis', 'Other'];

interface FilterBarProps {
  category: FavoriteCategory | null;
  onCategoryChange: (c: FavoriteCategory | null) => void;
  selectedTags: string[];
  onTagsChange: (tags: string[]) => void;
}

export function FilterBar({
  category,
  onCategoryChange,
  selectedTags,
  onTagsChange,
}: FilterBarProps) {
  const { data: allTags = [] } = useFavoriteTags();

  const toggleTag = (tag: string) => {
    if (selectedTags.includes(tag)) {
      onTagsChange(selectedTags.filter(t => t !== tag));
    } else {
      onTagsChange([...selectedTags, tag]);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8,
      padding: '12px 24px', borderBottom: '1px solid #1f1f23' }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {CATEGORIES.map(c => {
          const active = c === 'All' ? category === null : category === c;
          return (
            <button key={c} onClick={() => onCategoryChange(c === 'All' ? null : c as FavoriteCategory)}
              style={{ padding: '4px 10px', borderRadius: 999, fontSize: 11.5,
                border: active ? '1px solid rgba(124,92,255,0.35)' : '1px solid #2a2a2e',
                background: active ? 'rgba(124,92,255,0.12)' : 'transparent',
                color: active ? '#7c5cff' : '#b5b5ba', cursor: 'pointer',
                fontFamily: 'var(--font-geist, ui-sans-serif)' }}>
              {c}
            </button>
          );
        })}
      </div>

      {allTags.length > 0 && (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {allTags.map(tag => {
            const active = selectedTags.includes(tag);
            return (
              <button key={tag} onClick={() => toggleTag(tag)}
                style={{ padding: '3px 8px', borderRadius: 4, fontSize: 10.5,
                  border: active ? '1px solid rgba(124,92,255,0.4)' : '1px solid #2a2a2e',
                  background: active ? 'rgba(124,92,255,0.15)' : 'transparent',
                  color: active ? '#7c5cff' : '#8a8a90', cursor: 'pointer',
                  fontFamily: 'var(--font-geist-mono, monospace)' }}>
                #{tag}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create the favorite card**

`frontend/src/components/prompt-store/favorite-card.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import {
  useMarkUsed,
  usePatchFavorite,
  useUnlikeByIdMutation,
} from '@/hooks/use-favorites';
import type { FavoritePrompt } from '@/types/api';
import { useRouter } from 'next/navigation';

function countTokens(tokenUsage: Record<string, unknown> | null): number | null {
  if (!tokenUsage) return null;
  const total = tokenUsage.total_tokens ?? tokenUsage.total;
  return typeof total === 'number' ? total : null;
}

interface FavoriteCardProps {
  fav: FavoritePrompt;
}

export function FavoriteCard({ fav }: FavoriteCardProps) {
  const router = useRouter();
  const patch = usePatchFavorite(fav.id);
  const unlike = useUnlikeByIdMutation();
  const markUsed = useMarkUsed();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fav.content);
      markUsed.mutate(fav.id);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Copy failed');
    }
  };

  const handleUse = () => {
    sessionStorage.setItem('prefill_prompt', fav.content);
    sessionStorage.setItem('prefill_prompt_id', fav.prompt_id);
    sessionStorage.setItem('prefill_name', fav.family_name);
    markUsed.mutate(fav.id);
    router.push('/optimize');
  };

  const tokens = countTokens(fav.token_usage);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 10,
      padding: 14, borderRadius: 10,
      border: '1px solid #1f1f23',
      background: '#131316',
      borderLeft: fav.is_pinned ? '2px solid #7c5cff' : '1px solid #1f1f23',
      transition: 'border-color 120ms, transform 120ms',
    }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = '#2a2a2e';
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = '#1f1f23';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <Link href={`/versions/${fav.prompt_id}`}
          style={{ display: 'flex', alignItems: 'center', gap: 8,
            color: '#ededed', textDecoration: 'none', minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 13.5, fontWeight: 500, overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fav.family_name}</span>
          <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
            color: '#7c5cff', background: 'rgba(124,92,255,0.12)', padding: '1px 6px',
            borderRadius: 3 }}>v{fav.version}</span>
        </Link>
        <button type="button"
          onClick={() => patch.mutate({ is_pinned: !fav.is_pinned })}
          title={fav.is_pinned ? 'Unpin' : 'Pin to top'}
          style={{ width: 24, height: 24, display: 'inline-flex', alignItems: 'center',
            justifyContent: 'center', borderRadius: 6, border: '1px solid transparent',
            background: 'transparent', cursor: 'pointer',
            color: fav.is_pinned ? '#7c5cff' : '#5a5a60' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill={fav.is_pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6">
            <path d="M12 2l2 5h5l-4 3 1.5 6-4.5-3.5L7.5 16 9 10 5 7h5z" />
          </svg>
        </button>
      </div>

      {/* Content preview */}
      <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11.5,
        lineHeight: 1.7, color: '#b5b5ba', maxHeight: 96, overflow: 'hidden',
        maskImage: 'linear-gradient(#000 60%, transparent)',
        WebkitMaskImage: 'linear-gradient(#000 60%, transparent)',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {fav.content}
      </div>

      {/* Tags */}
      {fav.tags.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {fav.tags.slice(0, 4).map(t => (
            <span key={t} style={{ fontSize: 10.5,
              fontFamily: 'var(--font-geist-mono, monospace)',
              padding: '2px 6px', borderRadius: 4, background: '#1f1f23',
              color: '#8a8a90' }}>#{t}</span>
          ))}
          {fav.tags.length > 4 && (
            <span style={{ fontSize: 10.5, color: '#5a5a60' }}>+{fav.tags.length - 4}</span>
          )}
        </div>
      )}

      {/* Meta */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center',
        fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5, color: '#5a5a60' }}>
        <span>{fav.category}</span>
        <span>·</span>
        <span>Liked {formatDistanceToNow(new Date(fav.liked_at), { addSuffix: true })}</span>
        {tokens != null && (<><span>·</span><span>{tokens} tokens</span></>)}
        {fav.use_count > 0 && (<><span>·</span><span>Used {fav.use_count}×</span></>)}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
        <button type="button" onClick={handleCopy}
          style={buttonStyle('#b5b5ba')}>Copy</button>
        <button type="button" onClick={handleUse}
          style={buttonStyle('#7c5cff', true)}>Use in chat</button>
        <Link href={`/prompt-store/${fav.id}`} style={{ ...buttonStyle('#b5b5ba'), textDecoration: 'none' }}>
          Edit
        </Link>
        <button type="button" onClick={() => unlike.mutate(fav.id)}
          style={buttonStyle('#ff6b7a')} title="Remove">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 17.3l-5.4 3.2 1.4-6.1-4.6-4.1 6.2-.5L12 4l2.4 5.8 6.2.5-4.6 4.1 1.4 6.1z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function buttonStyle(color: string, filled = false): React.CSSProperties {
  return {
    height: 26,
    padding: '0 10px',
    borderRadius: 6,
    border: filled ? '1px solid #7c5cff' : '1px solid #2a2a2e',
    background: filled ? '#7c5cff' : 'transparent',
    color: filled ? '#fff' : color,
    fontSize: 11.5,
    fontFamily: 'var(--font-geist, ui-sans-serif)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  };
}
```

- [ ] **Step 4: Write the list page**

Replace `frontend/src/app/(dashboard)/prompt-store/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useFavoritesList } from '@/hooks/use-favorites';
import { FavoriteCard } from '@/components/prompt-store/favorite-card';
import { FilterBar } from '@/components/prompt-store/filter-bar';
import { EmptyState } from '@/components/prompt-store/empty-state';
import type { FavoriteCategory, FavoriteSort } from '@/types/api';

const SORTS: { value: FavoriteSort; label: string }[] = [
  { value: 'recently_liked', label: 'Recently liked' },
  { value: 'recently_used', label: 'Recently used' },
  { value: 'most_used', label: 'Most used' },
  { value: 'name', label: 'Name' },
];

export default function PromptStorePage() {
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [category, setCategory] = useState<FavoriteCategory | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [sort, setSort] = useState<FavoriteSort>('recently_liked');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isLoading } = useFavoritesList({
    q: debouncedQ || undefined,
    category,
    tags: tags.length ? tags : undefined,
    sort,
    limit: 200,
    offset: 0,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%',
      fontFamily: 'var(--font-geist, ui-sans-serif)' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12,
        padding: '0 24px', height: 52, borderBottom: '1px solid #1f1f23', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#7c5cff">
            <path d="M12 17.3l-5.4 3.2 1.4-6.1-4.6-4.1 6.2-.5L12 4l2.4 5.8 6.2.5-4.6 4.1 1.4 6.1z" />
          </svg>
          <span style={{ fontSize: 15, fontWeight: 500, color: '#ededed' }}>Prompt Store</span>
          {data && (
            <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
              padding: '2px 7px', borderRadius: 999, background: '#222226',
              border: '1px solid #2a2a2e', color: '#7c5cff' }}>
              {data.total} saved
            </span>
          )}
        </div>

        <input type="text" value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search name, note, tag, content…"
          style={{ flex: 1, height: 30, padding: '0 10px', borderRadius: 6,
            border: '1px solid #2a2a2e', background: '#1a1a1a', color: '#ededed',
            fontSize: 12.5, marginLeft: 12 }} />

        <select value={sort} onChange={e => setSort(e.target.value as FavoriteSort)}
          style={{ height: 30, padding: '0 8px', borderRadius: 6,
            border: '1px solid #2a2a2e', background: '#1a1a1a', color: '#b5b5ba',
            fontSize: 11.5, cursor: 'pointer' }}>
          {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      {/* Filters */}
      <FilterBar category={category} onCategoryChange={setCategory}
        selectedTags={tags} onTagsChange={setTags} />

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {isLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '100%', color: '#8a8a90', gap: 8 }}>
            <Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 13 }}>Loading…</span>
          </div>
        ) : !data || data.total === 0 ? (
          <EmptyState />
        ) : (
          <div style={{ display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 14 }}>
            {data.items.map(fav => <FavoriteCard key={fav.id} fav={fav} />)}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Type-check**

```bash
cd frontend
npx tsc --noEmit
```

- [ ] **Step 6: Manual verification**

1. Start with zero favorites — empty state renders with CTA to `/optimize`.
2. Like several prompts — they appear as cards in the grid.
3. Search by a substring — grid narrows, total count updates.
4. Click a category pill — only matching cards remain.
5. Click a tag chip — only cards with that tag remain. Click again to unselect.
6. Change sort — grid re-orders.
7. Click "Pin to top" on a card — it moves to the front with a purple left border.
8. Click "Copy" — toast appears, `use_count` ticks up (visible if you reload or re-sort by Most Used).
9. Click "Use in chat" — navigates to `/optimize` with the prompt pre-filled.
10. Click the red remove icon on a card — card disappears from the grid.

- [ ] **Step 7: Commit**

```bash
cd frontend
git add "src/app/(dashboard)/prompt-store/page.tsx" src/components/prompt-store/
git commit -m "feat(frontend): Prompt Store list page with search/filter/sort"
```

---

### Task 19: Tag chip input with autocomplete

**Files:**
- Create: `frontend/src/components/prompt-store/tag-chip-input.tsx`

- [ ] **Step 1: Write the component**

`frontend/src/components/prompt-store/tag-chip-input.tsx`:

```tsx
'use client';

import { KeyboardEvent, useState } from 'react';
import { useFavoriteTags } from '@/hooks/use-favorites';

interface TagChipInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  maxTags?: number;
}

export function TagChipInput({ value, onChange, maxTags = 10 }: TagChipInputProps) {
  const [input, setInput] = useState('');
  const { data: allTags = [] } = useFavoriteTags();

  const suggestions = input.trim()
    ? allTags.filter(t => t.startsWith(input.trim().toLowerCase()) && !value.includes(t)).slice(0, 6)
    : [];

  const addTag = (tag: string) => {
    const cleaned = tag.trim().toLowerCase();
    if (!cleaned) return;
    if (value.includes(cleaned)) return;
    if (value.length >= maxTags) return;
    onChange([...value, cleaned]);
    setInput('');
  };

  const removeTag = (tag: string) => onChange(value.filter(t => t !== tag));

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(input);
    } else if (e.key === 'Backspace' && !input && value.length > 0) {
      removeTag(value[value.length - 1]);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: 6,
        borderRadius: 6, border: '1px solid #2a2a2e', background: '#1a1a1a',
        minHeight: 34 }}>
        {value.map(tag => (
          <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 8px', borderRadius: 4, background: 'rgba(124,92,255,0.12)',
            color: '#7c5cff', fontSize: 11,
            fontFamily: 'var(--font-geist-mono, monospace)' }}>
            #{tag}
            <button onClick={() => removeTag(tag)} type="button"
              style={{ background: 'none', border: 'none', color: '#7c5cff',
                cursor: 'pointer', padding: 0, display: 'inline-flex',
                alignItems: 'center' }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </span>
        ))}
        <input type="text" value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey} placeholder={value.length ? '' : 'Add a tag…'}
          disabled={value.length >= maxTags}
          style={{ flex: 1, minWidth: 80, border: 'none', outline: 'none',
            background: 'transparent', color: '#ededed', fontSize: 12 }} />
      </div>
      {suggestions.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {suggestions.map(s => (
            <button key={s} onClick={() => addTag(s)} type="button"
              style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 4,
                border: '1px solid #2a2a2e', background: 'transparent',
                color: '#8a8a90', cursor: 'pointer',
                fontFamily: 'var(--font-geist-mono, monospace)' }}>
              + #{s}
            </button>
          ))}
        </div>
      )}
      <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10,
        color: '#5a5a60' }}>{value.length}/{maxTags} tags</div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd frontend
git add src/components/prompt-store/tag-chip-input.tsx
git commit -m "feat(frontend): reusable tag chip input with autocomplete"
```

---

### Task 20: Prompt Store detail/edit page

**Files:**
- Modify: `frontend/src/app/(dashboard)/prompt-store/[id]/page.tsx`

- [ ] **Step 1: Write the page**

Replace `frontend/src/app/(dashboard)/prompt-store/[id]/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import {
  useFavoriteDetail,
  usePatchFavorite,
  useUnlikeByIdMutation,
} from '@/hooks/use-favorites';
import { TagChipInput } from '@/components/prompt-store/tag-chip-input';
import type { FavoriteCategory } from '@/types/api';

const CATEGORIES: FavoriteCategory[] = ['Writing', 'Coding', 'Analysis', 'Other'];

export default function PromptStoreDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { data: fav, isLoading } = useFavoriteDetail(params.id);
  const patch = usePatchFavorite(params.id);
  const unlike = useUnlikeByIdMutation();

  const [note, setNote] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [category, setCategory] = useState<FavoriteCategory>('Other');

  useEffect(() => {
    if (fav) {
      setNote(fav.note ?? '');
      setTags(fav.tags);
      setCategory(fav.category);
    }
  }, [fav]);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: '#8a8a90', gap: 8 }}>
        <Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} />
        <span style={{ fontSize: 13 }}>Loading…</span>
      </div>
    );
  }
  if (!fav) {
    return (
      <div style={{ padding: 24, color: '#8a8a90', fontSize: 13 }}>
        Favorite not found.
      </div>
    );
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(fav.content);
    toast.success('Copied to clipboard');
  };

  const saveNote = () => {
    if ((fav.note ?? '') !== note) patch.mutate({ note: note || null });
  };

  const saveTags = (next: string[]) => {
    setTags(next);
    patch.mutate({ tags: next });
  };

  const saveCategory = (c: FavoriteCategory) => {
    setCategory(c);
    patch.mutate({ category: c });
  };

  const handleRemove = async () => {
    if (!confirm('Remove this prompt from the Prompt Store?')) return;
    await unlike.mutateAsync(fav.id);
    router.push('/prompt-store');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%',
      fontFamily: 'var(--font-geist, ui-sans-serif)', color: '#ededed' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12,
        padding: '0 24px', height: 52, borderBottom: '1px solid #1f1f23', flexShrink: 0 }}>
        <Link href="/prompt-store"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28, borderRadius: 6, border: '1px solid #2a2a2e',
            color: '#8a8a90', textDecoration: 'none' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.6"><path d="M15 6l-6 6 6 6"/></svg>
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 500, overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fav.family_name}</span>
          <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10.5,
            padding: '2px 7px', borderRadius: 999, background: 'rgba(124,92,255,0.12)',
            color: '#7c5cff' }}>v{fav.version}</span>
        </div>
        <Link href={`/versions/${fav.prompt_id}`}
          style={{ marginLeft: 'auto', fontSize: 12, color: '#7c5cff', textDecoration: 'none' }}>
          Open in Versions →
        </Link>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex',
        flexDirection: 'column', gap: 24, maxWidth: 820 }}>

        {/* Content */}
        <section>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <h2 style={{ margin: 0, fontSize: 12, fontFamily: 'var(--font-geist-mono, monospace)',
              textTransform: 'uppercase', letterSpacing: '0.1em', color: '#5a5a60' }}>Prompt</h2>
            <button onClick={handleCopy} style={actionButtonStyle()}>Copy</button>
          </div>
          <pre style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 12.5,
            lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            margin: 0, padding: 14, borderRadius: 8, border: '1px solid #1f1f23',
            background: '#131316' }}>{fav.content}</pre>
        </section>

        {/* Note */}
        <section>
          <h2 style={sectionLabelStyle()}>Why I liked it</h2>
          <textarea value={note} onChange={e => setNote(e.target.value)} onBlur={saveNote}
            placeholder="What makes this prompt worth keeping?"
            style={{ width: '100%', minHeight: 80, padding: 10, borderRadius: 8,
              border: '1px solid #2a2a2e', background: '#1a1a1a', color: '#ededed',
              fontSize: 13, fontFamily: 'var(--font-geist, ui-sans-serif)',
              resize: 'vertical' }} />
          <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 10,
            color: '#5a5a60', marginTop: 4 }}>{note.length} chars</div>
        </section>

        {/* Tags */}
        <section>
          <h2 style={sectionLabelStyle()}>Tags</h2>
          <TagChipInput value={tags} onChange={saveTags} />
        </section>

        {/* Category */}
        <section>
          <h2 style={sectionLabelStyle()}>Category</h2>
          <div style={{ display: 'flex', gap: 4 }}>
            {CATEGORIES.map(c => (
              <button key={c} onClick={() => saveCategory(c)}
                style={{ padding: '6px 12px', fontSize: 12,
                  border: category === c ? '1px solid rgba(124,92,255,0.4)' : '1px solid #2a2a2e',
                  background: category === c ? 'rgba(124,92,255,0.12)' : 'transparent',
                  color: category === c ? '#7c5cff' : '#b5b5ba', cursor: 'pointer',
                  borderRadius: 6 }}>
                {c}
              </button>
            ))}
          </div>
        </section>

        {/* Metadata */}
        <section>
          <h2 style={sectionLabelStyle()}>Metadata</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 10, fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11.5,
            color: '#8a8a90' }}>
            <MetaRow label="Liked" value={formatDistanceToNow(new Date(fav.liked_at), { addSuffix: true })} />
            <MetaRow label="Version created" value={formatDistanceToNow(new Date(fav.version_created_at), { addSuffix: true })} />
            <MetaRow label="Use count" value={String(fav.use_count)} />
            <MetaRow label="Last used" value={fav.last_used_at ? formatDistanceToNow(new Date(fav.last_used_at), { addSuffix: true }) : '—'} />
            <MetaRow label="Prompt Store ID" value={fav.id} />
            <MetaRow label="Version ID" value={fav.prompt_version_id} />
          </div>
        </section>

        {/* Danger zone */}
        <section>
          <h2 style={sectionLabelStyle()}>Danger zone</h2>
          <button onClick={handleRemove}
            style={{ padding: '8px 14px', fontSize: 12.5, borderRadius: 6,
              border: '1px solid rgba(255,107,122,0.3)', background: 'transparent',
              color: '#ff6b7a', cursor: 'pointer' }}>
            Remove from Prompt Store
          </button>
        </section>
      </div>
    </div>
  );
}

function sectionLabelStyle(): React.CSSProperties {
  return {
    margin: '0 0 8px',
    fontSize: 12,
    fontFamily: 'var(--font-geist-mono, monospace)',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    color: '#5a5a60',
  };
}

function actionButtonStyle(): React.CSSProperties {
  return {
    height: 24, padding: '0 10px', borderRadius: 6,
    border: '1px solid #2a2a2e', background: 'transparent',
    color: '#b5b5ba', fontSize: 11.5, cursor: 'pointer',
    fontFamily: 'var(--font-geist, ui-sans-serif)',
  };
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <span style={{ color: '#5a5a60', width: 120 }}>{label}</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd frontend
npx tsc --noEmit
```

- [ ] **Step 3: Manual verification**

1. From the list page, click "Edit" on a card → land on `/prompt-store/<id>`.
2. Type in the note textarea and click outside — network request fires; refresh confirms persistence.
3. Add a tag (Enter/comma) → persists. Type partial letter → autocomplete suggests existing tags. Remove a tag with the × → persists.
4. Click a different category → persists.
5. Click "Remove from Prompt Store" → confirm dialog → on confirm, redirected to list and the card is gone.
6. Click "Open in Versions →" → lands on `/versions/<prompt_id>` and the corresponding version shows a filled star.

- [ ] **Step 4: Commit**

```bash
cd frontend
git add "src/app/(dashboard)/prompt-store/[id]/page.tsx"
git commit -m "feat(frontend): Prompt Store detail/edit page"
```

---

## Phase 9 — End-to-end smoke test + docs

### Task 21: Full-loop manual verification

- [ ] **Step 1: Bring up the full stack**

```bash
# terminal 1
cd qa-chatbot
make infra && make migrate && make dev

# terminal 2
cd qa-chatbot && make worker

# terminal 3
cd frontend && npm run dev
```

- [ ] **Step 2: Run the loop**

1. Log in.
2. `/optimize` → submit a new prompt → wait for the optimized result.
3. Click the star on the result → toast says "Saved to Prompt Store"; star is purple.
4. Navigate to `/prompt-store` → card appears with tags + category auto-filled.
5. Click "Edit" → set a note, add a custom tag, change category → reload and confirm persistence.
6. Return to `/prompt-store` → "Copy" increments use count (visible by switching sort to "Most used"); "Use in chat" pre-fills `/optimize` with the prompt and family name.
7. On `/versions/<prompt_id>` → the corresponding version shows a filled star; the version list also reflects it. Unstar from the Versions toolbar → card disappears from the Prompt Store.
8. Star a second, different optimized prompt → verify the Store shows 2 cards and sort/filter/search all work.

- [ ] **Step 3: Resilience spot-check**

Stop Redis or disconnect network briefly and try to like — the UI should show an error toast and the star should roll back to its previous state (no stuck "filled" state).

- [ ] **Step 4: Commit final state if any fixes were needed**

If the smoke test uncovered issues, fix them in dedicated commits referencing the failing behaviour.

---

## Self-Review (performed while writing)

**Spec coverage** — every numbered item in the spec has a task:

- `§3 Data Model` → Tasks 1, 2.
- `§4 Backend API` endpoints → Tasks 8, 9.
- `§4 Schemas / Repository / Service / Exceptions` → Tasks 3, 4, 5, 7.
- `§4 LLM auto-tag` → Tasks 6, 7.
- `§4 Backend changes to existing endpoints` (`JobResult.prompt_version_id`, `PromptVersionOut.is_favorited` + `favorite_id`) → Tasks 10, 11.
- `§5.1 Shared frontend` → Task 12.
- `§5.2 Chat like button` → Tasks 13, 14.
- `§5.3 Versions page stars` → Tasks 15, 16.
- `§5.4 Prompt Store page` (sidebar, list, filters, detail, tag editor) → Tasks 17, 18, 19, 20.
- `§6 Testing` → backend unit + integration tests live alongside their respective tasks (3, 4, 7, 8, 9, 11). Frontend tests intentionally skipped — manual checklist in Task 21.
- `§7 Migration & Rollout` — migration in Task 2; additive; no flag.
- `§8 Risks` — LLM timeout/fallback handled in Task 7; FK cascade in Task 2; 10-tag cap in Task 4 schema.

**Placeholder scan** — no `TBD`, no "add validation later", no "similar to above" references. All code blocks are complete.

**Type / name consistency** — `FavoriteRepository.get_by_version`, `.get_for_user`, `.list_for_user`, `.distinct_tags`, `.increment_use`, `.update_fields` used consistently across Tasks 3, 7, 8, 9. `FavoriteService` methods `like`, `unlike`, `unlike_by_version`, `status`, `update`, `increment_use`, `_generate_tags` used consistently. Frontend hooks `useFavoriteStatus`, `useLikeMutation`, `useUnlikeMutation`, `useFavoritesList`, `useFavoriteDetail`, `useFavoriteTags`, `usePatchFavorite`, `useMarkUsed`, `useUnlikeByIdMutation` all referenced by the components that need them. `FavoriteResponse` fields match what the frontend `FavoritePrompt` type declares (`id`, `prompt_version_id`, `prompt_id`, `family_name`, `version`, `content`, `note`, `tags`, `category`, `is_pinned`, `use_count`, `last_used_at`, `liked_at`, `version_created_at`, `token_usage`).
