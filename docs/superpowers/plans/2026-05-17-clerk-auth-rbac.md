# Clerk Auth + RBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace homegrown JWT/bcrypt auth with Clerk, add org-level RBAC (Owner/Admin/Collaborator) with per-tool permissions (general, PDO, bridge, analyze), and preserve org-scoped `qac_` API keys.

**Architecture:** Clerk issues RS256 JWTs containing `org_id`, `org_role`, and `org_permissions`. FastAPI verifies tokens via Clerk's Python SDK, then enforces role/permission checks through dependency injection. Next.js uses `@clerk/nextjs` middleware + hooks for route protection and UI gating.

**Tech Stack:** `clerk-backend-api` (Python SDK), `@clerk/nextjs` v5, Alembic migration, `svix` (webhook verification), existing FastAPI + Next.js 14 stack.

---

## Prerequisites (manual — do before running any task)

1. Create a Clerk account at clerk.com
2. Create a new Clerk application named "Promptly"
3. In Clerk dashboard → Configure → Social connections: enable **Google** and **GitHub**
4. In Clerk dashboard → Organizations: enable Organizations feature
5. In Clerk dashboard → Organizations → Roles: create roles:
   - `org:owner` (display: "Owner")
   - `org:admin` (display: "Admin")
   - `org:collaborator` (display: "Collaborator")
6. In Clerk dashboard → Organizations → Permissions: create permissions:
   - `org:optimize:general` (display: "General Optimization")
   - `org:optimize:pdo` (display: "PDO")
   - `org:optimize:bridge` (display: "Bridge")
   - `org:analyze` (display: "Analyse & Health Score")
7. Assign permissions to roles in Clerk dashboard:
   - `org:owner` → all 4 permissions
   - `org:admin` → all 4 permissions
   - `org:collaborator` → `org:analyze` only (admins grant the rest per-member)
8. Copy API keys — you'll need:
   - `CLERK_SECRET_KEY` (starts with `sk_test_...`)
   - `CLERK_PUBLISHABLE_KEY` (starts with `pk_test_...`)
   - `CLERK_WEBHOOK_SECRET` (from Clerk dashboard → Webhooks → add endpoint)

---

## File Map

### Backend — Created
- `qa-chatbot/src/app/config/clerk.py` — ClerkSettings (secret key, webhook secret, authorized party)
- `qa-chatbot/src/app/core/clerk.py` — Clerk SDK client, `verify_clerk_token()`, `get_org_permissions()`
- `qa-chatbot/src/app/core/user_context.py` — `UserContext` dataclass (user + org_id + role + permissions)
- `qa-chatbot/src/app/api/v1/webhooks.py` — `POST /webhooks/clerk` user sync endpoint
- `qa-chatbot/src/app/api/v1/orgs.py` — org API key CRUD + member permission management
- `qa-chatbot/src/app/schemas/org.py` — OrgApiKey schemas, MemberPermissionsRequest

### Backend — Modified
- `qa-chatbot/src/app/models/user.py` — add `clerk_user_id`, remove `hashed_password`, `api_key_hash`, `is_superuser`
- `qa-chatbot/src/app/models/api_key.py` — replace `user_id` FK + partial index with `org_id` VARCHAR
- `qa-chatbot/src/app/repositories/user_repo.py` — add `get_by_clerk_id()`, remove `get_by_api_key_hash()`
- `qa-chatbot/src/app/repositories/api_key_repo.py` — replace user-scoped methods with org-scoped methods
- `qa-chatbot/src/app/dependencies.py` — rewrite `get_current_user()` → Clerk JWT + API key paths; add `require_role()`, `require_permission()`
- `qa-chatbot/src/app/api/v1/chat.py` — add `require_permission("org:optimize:general")` on POST
- `qa-chatbot/src/app/api/v1/users.py` — update `UserResponse` to include `clerk_user_id`
- `qa-chatbot/src/app/api/router.py` — add webhooks + orgs routers, remove auth router
- `qa-chatbot/src/app/main.py` — remove anonymous user seed + AUTH_ENABLED bypass
- `qa-chatbot/src/app/config/env.py` — remove `AUTH_ENABLED`
- `qa-chatbot/pyproject.toml` — add `clerk-backend-api`, `svix`; remove `python-jose`, `bcrypt`, `passlib`

### Backend — Deleted
- `qa-chatbot/src/app/core/security.py`
- `qa-chatbot/src/app/config/auth.py`
- `qa-chatbot/src/app/api/v1/auth.py`
- `qa-chatbot/src/app/schemas/auth.py`

### Backend — Migration
- `qa-chatbot/alembic/versions/<hash>_clerk_auth_migration.py`

### Frontend — Created
- `frontend/src/app/(auth)/sign-in/[[...sign-in]]/page.tsx` — Clerk `<SignIn />` page
- `frontend/src/app/(auth)/sign-up/[[...sign-up]]/page.tsx` — Clerk `<SignUp />` page
- `frontend/src/app/(auth)/org-select/page.tsx` — org switcher page
- `frontend/src/components/permission-gate.tsx` — renders children only if user has permission
- `frontend/src/hooks/use-permissions.ts` — `hasPermission()`, `hasRole()` helpers

### Frontend — Modified
- `frontend/src/middleware.ts` — replace cookie check with `clerkMiddleware()`
- `frontend/src/app/layout.tsx` — wrap in `<ClerkProvider>`, remove `AuthInitializer`
- `frontend/src/lib/api.ts` — use `auth.getToken()` from Clerk instead of Zustand
- `frontend/src/types/api.ts` — add org/role/permissions types
- `frontend/package.json` — add `@clerk/nextjs`

### Frontend — Deleted
- `frontend/src/app/(auth)/login/page.tsx`
- `frontend/src/app/(auth)/register/page.tsx`
- `frontend/src/app/api/auth/route.ts`
- `frontend/src/lib/auth.ts`
- `frontend/src/stores/auth-store.ts`
- `frontend/src/components/auth-initializer.tsx`

---

## Task 1: Install backend dependencies

**Files:**
- Modify: `qa-chatbot/pyproject.toml`

- [ ] **Step 1: Add clerk-backend-api and svix, remove old auth deps**

```toml
# In pyproject.toml, replace these lines:
#   "bcrypt<=4.0.1",
#   "passlib[bcrypt]>=1.7.4",
#   "python-jose[cryptography]>=3.5.0",
# With:
#   "clerk-backend-api>=1.9.0",
#   "svix>=1.62.0",
```

Edit `qa-chatbot/pyproject.toml` — the `dependencies` list should contain:
```toml
dependencies = [
    "alembic>=1.18.4",
    "asyncpg>=0.31.0",
    "boto3>=1.34.0",
    "celery[redis]>=5.3.1",
    "clerk-backend-api>=1.9.0",
    "fastapi[standard]>=0.135.3",
    "httpx>=0.28.1",
    "langchain-anthropic>=1.4.0",
    "langchain-openai>=1.1.12",
    "langgraph>=1.1.6",
    "langgraph-checkpoint-postgres>=3.0.5",
    "pgvector>=0.4.2",
    "pypdf>=4.0.0",
    "psycopg-binary>=3.3.3",
    "pydantic-settings>=2.13.1",
    "redis[hiredis]>=7.4.0",
    "sqlalchemy[asyncio]>=2.0.49",
    "structlog>=25.5.0",
    "svix>=1.62.0",
    "tenacity>=9.1.4",
    "sentry-sdk[fastapi]>=2.0.0",
    "uvicorn[standard]>=0.43.0",
]
```

- [ ] **Step 2: Install**

```bash
cd qa-chatbot && uv sync
```

Expected: resolves without errors, `clerk-backend-api` and `svix` appear in the lock file.

- [ ] **Step 3: Commit**

```bash
git add qa-chatbot/pyproject.toml qa-chatbot/uv.lock
git commit -m "chore: swap jwt/bcrypt deps for clerk-backend-api + svix"
```

---

## Task 2: Clerk config and SDK client

**Files:**
- Create: `qa-chatbot/src/app/config/clerk.py`
- Create: `qa-chatbot/src/app/core/clerk.py`
- Create: `qa-chatbot/src/app/core/user_context.py`

- [ ] **Step 1: Write the failing test for verify_clerk_token**

Create `qa-chatbot/tests/unit/test_clerk_core.py`:

```python
from unittest.mock import AsyncMock, MagicMock, patch
import pytest
from app.core.clerk import verify_clerk_token
from app.core.exceptions import UnauthorizedException


@pytest.mark.asyncio
async def test_verify_clerk_token_returns_payload_on_success() -> None:
    fake_payload = {
        "sub": "user_abc",
        "org_id": "org_xyz",
        "org_role": "org:admin",
        "org_permissions": ["org:optimize:general", "org:analyze"],
    }
    with patch("app.core.clerk._clerk_client") as mock_client:
        mock_client.authenticate_request = MagicMock(
            return_value=MagicMock(is_signed_in=True, token_payload=fake_payload)
        )
        result = verify_clerk_token("Bearer valid.jwt.token")
    assert result["sub"] == "user_abc"
    assert result["org_role"] == "org:admin"


@pytest.mark.asyncio
async def test_verify_clerk_token_raises_on_invalid() -> None:
    with patch("app.core.clerk._clerk_client") as mock_client:
        mock_client.authenticate_request = MagicMock(
            return_value=MagicMock(is_signed_in=False, token_payload=None)
        )
        with pytest.raises(UnauthorizedException):
            verify_clerk_token("Bearer invalid.token")
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd qa-chatbot && uv run pytest tests/unit/test_clerk_core.py -v
```

Expected: `ModuleNotFoundError: No module named 'app.core.clerk'`

- [ ] **Step 3: Create ClerkSettings config**

Create `qa-chatbot/src/app/config/clerk.py`:

```python
from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class ClerkSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )
    CLERK_SECRET_KEY: SecretStr
    CLERK_WEBHOOK_SECRET: SecretStr
    CLERK_AUTHORIZED_PARTY: str = "http://localhost:3000"


@lru_cache
def get_clerk_settings() -> ClerkSettings:
    return ClerkSettings()
```

- [ ] **Step 4: Create UserContext dataclass**

Create `qa-chatbot/src/app/core/user_context.py`:

```python
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
```

- [ ] **Step 5: Create Clerk SDK client**

Create `qa-chatbot/src/app/core/clerk.py`:

```python
from typing import Any

import clerk_backend_api
from clerk_backend_api.models import RequestState

from app.config.clerk import get_clerk_settings
from app.core.exceptions import UnauthorizedException

_clerk_client: clerk_backend_api.Clerk | None = None


def get_clerk_client() -> clerk_backend_api.Clerk:
    global _clerk_client
    if _clerk_client is None:
        settings = get_clerk_settings()
        _clerk_client = clerk_backend_api.Clerk(
            bearer_auth=settings.CLERK_SECRET_KEY.get_secret_value()
        )
    return _clerk_client


def verify_clerk_token(authorization_header: str) -> dict[str, Any]:
    """Verify a Clerk JWT from the Authorization header.

    Raises UnauthorizedException if invalid or not signed in.
    Returns the decoded token payload dict on success.
    """
    client = get_clerk_client()
    request_state: RequestState = client.authenticate_request(
        # authenticate_request accepts the raw Authorization header value
        authorization_header,
        authorized_parties=[get_clerk_settings().CLERK_AUTHORIZED_PARTY],
    )
    if not request_state.is_signed_in or request_state.token_payload is None:
        raise UnauthorizedException(detail="Invalid or expired token")
    payload: dict[str, Any] = request_state.token_payload
    return payload


async def get_org_permissions_for_api_key(org_id: str) -> list[str]:
    """Fetch the permissions for an org from Clerk (used by API key auth path).

    Returns a list of permission strings like ["org:optimize:general", "org:analyze"].
    Falls back to empty list on error — callers should treat missing permissions as denied.
    """
    client = get_clerk_client()
    try:
        org = client.organizations.get(organization_id=org_id)
        # Clerk organizations don't have direct permissions on the org itself;
        # org-level API keys inherit the org:owner role's permissions.
        # We return the full permission set for owner role.
        roles = client.organization_roles.list(organization_id=org_id)
        owner_role = next((r for r in roles.data if r.key == "org:owner"), None)
        if owner_role is None:
            return []
        return [p.key for p in (owner_role.permissions or [])]
    except Exception:
        return []
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd qa-chatbot && uv run pytest tests/unit/test_clerk_core.py -v
```

Expected: both tests PASS.

- [ ] **Step 7: Commit**

```bash
git add qa-chatbot/src/app/config/clerk.py qa-chatbot/src/app/core/clerk.py qa-chatbot/src/app/core/user_context.py qa-chatbot/tests/unit/test_clerk_core.py
git commit -m "feat: add Clerk SDK client, ClerkSettings, and UserContext"
```

---

## Task 3: Update User model and ApiKey model

**Files:**
- Modify: `qa-chatbot/src/app/models/user.py`
- Modify: `qa-chatbot/src/app/models/api_key.py`

- [ ] **Step 1: Update User model**

Replace the full content of `qa-chatbot/src/app/models/user.py`:

```python
from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from .api_key import ApiKey
    from .favorite_prompt import FavoritePrompt
    from .prompt_version import PromptVersion
    from .session import ChatSession


class User(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "users"

    clerk_user_id: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    credits: Mapped[int] = mapped_column(Integer, default=100, server_default="100", nullable=False)

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

- [ ] **Step 2: Update ApiKey model**

Replace the full content of `qa-chatbot/src/app/models/api_key.py`:

```python
from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from .user import User


class ApiKey(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "api_keys"
    __table_args__ = (
        Index(
            "uq_api_keys_org_active_name",
            "org_id",
            "name",
            unique=True,
            postgresql_where=text("is_active = true"),
        ),
    )

    org_id: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(100))
    key_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_by_user: Mapped[User] = relationship(back_populates="api_keys")

    def __repr__(self) -> str:
        return f"<ApiKey id={self.id} name={self.name} active={self.is_active}>"
```

- [ ] **Step 3: Commit**

```bash
git add qa-chatbot/src/app/models/user.py qa-chatbot/src/app/models/api_key.py
git commit -m "feat: update User and ApiKey models for Clerk (org-scoped keys, clerk_user_id)"
```

---

## Task 4: Alembic migration

**Files:**
- Create: `qa-chatbot/alembic/versions/<hash>_clerk_auth_migration.py`

- [ ] **Step 1: Generate the migration**

```bash
cd qa-chatbot && uv run alembic revision --autogenerate -m "clerk_auth_migration"
```

Expected: creates a new file in `alembic/versions/`.

- [ ] **Step 2: Review and fix the generated migration**

Open the generated file. It will likely include drop/add column operations. Verify it contains:

**upgrade()** must:
- Add `clerk_user_id VARCHAR(255) UNIQUE NOT NULL` to `users` — but since existing rows exist, add as nullable first, then set not null:
  ```python
  op.add_column('users', sa.Column('clerk_user_id', sa.String(255), nullable=True))
  op.create_unique_constraint('uq_users_clerk_user_id', 'users', ['clerk_user_id'])
  op.create_index('ix_users_clerk_user_id', 'users', ['clerk_user_id'])
  ```
- Drop `hashed_password`, `api_key_hash`, `is_superuser` from `users`
- Drop `user_id` FK column from `api_keys`; add `org_id VARCHAR(255) NOT NULL` and `last_used_at TIMESTAMP`
- Drop old index `uq_api_keys_user_active_name`; add new `uq_api_keys_org_active_name`
- Rename `api_keys.user_id` FK → `api_keys.created_by`

**downgrade()** must reverse all operations.

If autogenerate missed anything, add it manually. The final migration `upgrade()` should look like:

```python
def upgrade() -> None:
    # users — add clerk_user_id
    op.add_column('users', sa.Column('clerk_user_id', sa.String(255), nullable=True))
    op.create_unique_constraint('uq_users_clerk_user_id', 'users', ['clerk_user_id'])
    op.create_index('ix_users_clerk_user_id', 'users', ['clerk_user_id'])

    # users — remove old auth fields
    op.drop_column('users', 'hashed_password')
    op.drop_index('ix_users_api_key_hash', table_name='users')
    op.drop_column('users', 'api_key_hash')
    op.drop_column('users', 'is_superuser')

    # api_keys — drop old user-scoped index and user_id FK
    op.drop_index('uq_api_keys_user_active_name', table_name='api_keys')
    op.drop_constraint('api_keys_user_id_fkey', 'api_keys', type_='foreignkey')
    op.drop_index('ix_api_keys_user_id', table_name='api_keys')
    op.drop_column('api_keys', 'user_id')

    # api_keys — add org-scoped fields
    op.add_column('api_keys', sa.Column('org_id', sa.String(255), nullable=False, server_default=''))
    op.add_column('api_keys', sa.Column('created_by', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('api_keys', sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True))
    op.create_index('ix_api_keys_org_id', 'api_keys', ['org_id'])
    op.create_foreign_key('api_keys_created_by_fkey', 'api_keys', 'users', ['created_by'], ['id'], ondelete='CASCADE')
    op.create_index(
        'uq_api_keys_org_active_name', 'api_keys', ['org_id', 'name'],
        unique=True,
        postgresql_where=sa.text('is_active = true')
    )
    # remove server_default after adding
    op.alter_column('api_keys', 'org_id', server_default=None)
```

- [ ] **Step 3: Run migration against test DB**

```bash
cd qa-chatbot && DATABASE_URL="postgresql+asyncpg://postgres:postgres@localhost:5433/qa_chatbot_test" uv run alembic upgrade head
```

Expected: completes without errors.

- [ ] **Step 4: Commit**

```bash
git add qa-chatbot/alembic/versions/
git commit -m "feat: add Clerk auth migration (clerk_user_id, org-scoped api_keys)"
```

---

## Task 5: Update repositories

**Files:**
- Modify: `qa-chatbot/src/app/repositories/user_repo.py`
- Modify: `qa-chatbot/src/app/repositories/api_key_repo.py`

- [ ] **Step 1: Write failing tests for updated repos**

Create `qa-chatbot/tests/unit/test_repos_clerk.py`:

```python
from unittest.mock import AsyncMock, MagicMock
import uuid
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.user_repo import UserRepository
from app.repositories.api_key_repo import ApiKeyRepository
from app.models.user import User
from app.models.api_key import ApiKey


@pytest.mark.asyncio
async def test_user_repo_get_by_clerk_id_returns_user() -> None:
    mock_db = AsyncMock(spec=AsyncSession)
    mock_result = MagicMock()
    mock_user = User(
        id=uuid.uuid4(),
        clerk_user_id="user_abc",
        email="test@example.com",
        credits=100,
        is_active=True,
    )
    mock_result.scalar_one_or_none.return_value = mock_user
    mock_db.execute.return_value = mock_result

    repo = UserRepository(mock_db)
    result = await repo.get_by_clerk_id("user_abc")
    assert result is not None
    assert result.clerk_user_id == "user_abc"


@pytest.mark.asyncio
async def test_api_key_repo_has_active_name_for_org() -> None:
    mock_db = AsyncMock(spec=AsyncSession)
    mock_result = MagicMock()
    mock_result.scalar.return_value = True
    mock_db.execute.return_value = mock_result

    repo = ApiKeyRepository(mock_db)
    result = await repo.has_active_name_for_org("org_xyz", "my-key")
    assert result is True
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd qa-chatbot && uv run pytest tests/unit/test_repos_clerk.py -v
```

Expected: `AttributeError: 'UserRepository' object has no attribute 'get_by_clerk_id'`

- [ ] **Step 3: Update UserRepository**

Replace `qa-chatbot/src/app/repositories/user_repo.py`:

```python
from uuid import UUID

from sqlalchemy import select, update

from app.models.user import User
from app.repositories.base import BaseRepository


class UserRepository(BaseRepository[User]):
    model = User

    async def get_by_email(self, email: str) -> User | None:
        result = await self.db.execute(select(User).where(User.email == email))
        return result.scalar_one_or_none()

    async def get_by_clerk_id(self, clerk_user_id: str) -> User | None:
        result = await self.db.execute(
            select(User).where(User.clerk_user_id == clerk_user_id)
        )
        return result.scalar_one_or_none()

    async def get_active_by_email(self, email: str) -> User | None:
        result = await self.db.execute(
            select(User).where(User.email == email, User.is_active == True)  # noqa: E712
        )
        return result.scalar_one_or_none()

    async def deduct_credits(self, user_id: UUID, amount: int) -> bool:
        result = await self.db.execute(
            update(User)
            .where(User.id == user_id, User.credits >= amount)
            .values(credits=User.credits - amount)
            .returning(User.id)
        )
        return result.scalar_one_or_none() is not None

    async def refund_credits(self, user_id: UUID, amount: int) -> None:
        await self.db.execute(
            update(User).where(User.id == user_id).values(credits=User.credits + amount)
        )
```

- [ ] **Step 4: Update ApiKeyRepository**

Replace `qa-chatbot/src/app/repositories/api_key_repo.py`:

```python
import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from sqlalchemy import exists, func, select, update
from sqlalchemy.sql import Select

from app.models.api_key import ApiKey
from app.repositories.base import BaseRepository


class ApiKeyRepository(BaseRepository[ApiKey]):
    model = ApiKey

    def _status_filter(
        self, query: Select[Any], status: Literal["active", "revoked", "all"]
    ) -> Select[Any]:
        if status == "active":
            return query.where(ApiKey.is_active == True)  # noqa: E712
        if status == "revoked":
            return query.where(ApiKey.is_active == False)  # noqa: E712
        return query

    async def list_by_org(
        self,
        org_id: str,
        *,
        status: Literal["active", "revoked", "all"] = "all",
        limit: int = 20,
        offset: int = 0,
    ) -> list[ApiKey]:
        q = self._status_filter(select(ApiKey).where(ApiKey.org_id == org_id), status)
        q = q.order_by(ApiKey.created_at.desc()).limit(limit).offset(offset)
        result = await self.db.execute(q)
        return list(result.scalars().all())

    async def count_by_org(
        self,
        org_id: str,
        *,
        status: Literal["active", "revoked", "all"] = "all",
    ) -> int:
        q = self._status_filter(
            select(func.count()).select_from(ApiKey).where(ApiKey.org_id == org_id),
            status,
        )
        result = await self.db.execute(q)
        return int(result.scalar_one())

    async def get_by_id_and_org(self, key_id: uuid.UUID, org_id: str) -> ApiKey | None:
        result = await self.db.execute(
            select(ApiKey).where(ApiKey.id == key_id, ApiKey.org_id == org_id)
        )
        return result.scalar_one_or_none()

    async def get_active_by_hash(self, key_hash: str) -> ApiKey | None:
        result = await self.db.execute(
            select(ApiKey).where(
                ApiKey.key_hash == key_hash,
                ApiKey.is_active == True,  # noqa: E712
            )
        )
        return result.scalar_one_or_none()

    async def has_active_name_for_org(self, org_id: str, name: str) -> bool:
        result = await self.db.execute(
            select(
                exists().where(
                    ApiKey.org_id == org_id,
                    ApiKey.name == name,
                    ApiKey.is_active == True,  # noqa: E712
                )
            )
        )
        return bool(result.scalar())

    async def touch_last_used(self, key_id: uuid.UUID) -> None:
        await self.db.execute(
            update(ApiKey).where(ApiKey.id == key_id).values(last_used_at=datetime.now(UTC))
        )

    async def revoke(self, key: ApiKey) -> ApiKey:
        key.is_active = False
        key.revoked_at = datetime.now(UTC)
        await self.db.flush()
        await self.db.refresh(key)
        return key
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd qa-chatbot && uv run pytest tests/unit/test_repos_clerk.py -v
```

Expected: both tests PASS.

- [ ] **Step 6: Commit**

```bash
git add qa-chatbot/src/app/repositories/user_repo.py qa-chatbot/src/app/repositories/api_key_repo.py qa-chatbot/tests/unit/test_repos_clerk.py
git commit -m "feat: update user + api key repositories for Clerk (org-scoped, clerk_user_id lookup)"
```

---

## Task 6: Rewrite dependencies.py

**Files:**
- Modify: `qa-chatbot/src/app/dependencies.py`
- Modify: `qa-chatbot/src/app/config/env.py`

- [ ] **Step 1: Write failing tests for new dependencies**

Create `qa-chatbot/tests/unit/test_dependencies.py`:

```python
from unittest.mock import AsyncMock, MagicMock, patch
import uuid
import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.user_context import UserContext
from app.core.exceptions import UnauthorizedException


@pytest.mark.asyncio
async def test_require_permission_raises_403_when_missing() -> None:
    from app.dependencies import require_permission

    context = UserContext(
        user_id=uuid.uuid4(),
        clerk_user_id="user_abc",
        email="test@example.com",
        credits=100,
        org_id="org_xyz",
        org_role="org:collaborator",
        permissions=["org:analyze"],
    )
    checker = require_permission("org:optimize:general")
    with pytest.raises(HTTPException) as exc_info:
        await checker(context)
    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_require_permission_passes_when_present() -> None:
    from app.dependencies import require_permission

    context = UserContext(
        user_id=uuid.uuid4(),
        clerk_user_id="user_abc",
        email="test@example.com",
        credits=100,
        org_id="org_xyz",
        org_role="org:admin",
        permissions=["org:optimize:general", "org:analyze"],
    )
    checker = require_permission("org:optimize:general")
    result = await checker(context)
    assert result == context


@pytest.mark.asyncio
async def test_require_role_raises_403_when_wrong_role() -> None:
    from app.dependencies import require_role

    context = UserContext(
        user_id=uuid.uuid4(),
        clerk_user_id="user_abc",
        email="test@example.com",
        credits=100,
        org_id="org_xyz",
        org_role="org:collaborator",
        permissions=["org:analyze"],
    )
    checker = require_role("org:admin", "org:owner")
    with pytest.raises(HTTPException) as exc_info:
        await checker(context)
    assert exc_info.value.status_code == 403
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd qa-chatbot && uv run pytest tests/unit/test_dependencies.py -v
```

Expected: `ImportError` — `require_permission` not in dependencies.

- [ ] **Step 3: Remove AUTH_ENABLED from env.py**

Replace `qa-chatbot/src/app/config/env.py`:

```python
from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class MinioSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )
    MINIO_ENDPOINT_URL: str = "http://localhost:9000"
    MINIO_ACCESS_KEY: str
    MINIO_SECRET_KEY: SecretStr
    MINIO_BUCKET_NAME: str = "promptly"


@lru_cache
def get_minio_settings() -> MinioSettings:
    return MinioSettings()
```

- [ ] **Step 4: Rewrite dependencies.py**

Replace the full content of `qa-chatbot/src/app/dependencies.py`:

```python
import hashlib
from collections.abc import AsyncGenerator
from typing import Any

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clerk import get_org_permissions_for_api_key, verify_clerk_token
from app.core.exceptions import UnauthorizedException
from app.core.user_context import UserContext
from app.db.session import get_async_session
from app.repositories.api_key_repo import ApiKeyRepository
from app.repositories.user_repo import UserRepository


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async for session in get_async_session():
        yield session


async def get_graph(request: Request) -> Any:  # noqa: ANN401
    return request.app.state.graph


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> UserContext:
    """Resolves the current user from a Clerk JWT or a qac_-prefixed org API key."""
    auth_header = request.headers.get("Authorization", "")

    if auth_header.startswith("qac_") or (
        " " in auth_header and auth_header.split(" ", 1)[1].startswith("qac_")
    ):
        return await _resolve_api_key(auth_header, db)

    if not auth_header:
        raise UnauthorizedException()

    return await _resolve_jwt(auth_header, db)


async def _resolve_jwt(authorization_header: str, db: AsyncSession) -> UserContext:
    payload = verify_clerk_token(authorization_header)
    clerk_user_id: str = payload.get("sub", "")
    if not clerk_user_id:
        raise UnauthorizedException(detail="Missing subject in token")

    org_id: str = payload.get("org_id", "")
    org_role: str = payload.get("org_role", "")
    permissions: list[str] = payload.get("org_permissions", [])

    repo = UserRepository(db)
    user = await repo.get_by_clerk_id(clerk_user_id)
    if user is None or not user.is_active:
        raise UnauthorizedException(detail="User not found or inactive")

    return UserContext(
        user_id=user.id,
        clerk_user_id=clerk_user_id,
        email=user.email,
        credits=user.credits,
        org_id=org_id,
        org_role=org_role,
        permissions=permissions,
    )


async def _resolve_api_key(raw_token: str, db: AsyncSession) -> UserContext:
    # Strip "Bearer " prefix if present
    raw_key = raw_token.removeprefix("Bearer ").strip()
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()

    api_key_repo = ApiKeyRepository(db)
    api_key = await api_key_repo.get_active_by_hash(key_hash)
    if api_key is None:
        raise UnauthorizedException(detail="Invalid or revoked API key")

    user_repo = UserRepository(db)
    user = await user_repo.get_by_id(api_key.created_by)
    if user is None or not user.is_active:
        raise UnauthorizedException(detail="User not found or inactive")

    # Touch last_used_at without blocking the request
    await api_key_repo.touch_last_used(api_key.id)

    permissions = await get_org_permissions_for_api_key(api_key.org_id)

    return UserContext(
        user_id=user.id,
        clerk_user_id=user.clerk_user_id,
        email=user.email,
        credits=user.credits,
        org_id=api_key.org_id,
        org_role="org:owner",
        permissions=permissions,
    )


def require_permission(permission: str):  # type: ignore[return]
    """FastAPI dependency factory — raises 403 if UserContext lacks the permission."""

    async def checker(ctx: UserContext = Depends(get_current_user)) -> UserContext:
        if permission not in ctx.permissions:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission required: {permission}",
            )
        return ctx

    return checker


def require_role(*roles: str):  # type: ignore[return]
    """FastAPI dependency factory — raises 403 if UserContext role not in allowed roles."""

    async def checker(ctx: UserContext = Depends(get_current_user)) -> UserContext:
        if ctx.org_role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role required: one of {list(roles)}",
            )
        return ctx

    return checker
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd qa-chatbot && uv run pytest tests/unit/test_dependencies.py -v
```

Expected: all 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add qa-chatbot/src/app/dependencies.py qa-chatbot/src/app/config/env.py qa-chatbot/tests/unit/test_dependencies.py
git commit -m "feat: rewrite dependencies.py for Clerk JWT + org API key auth; add require_role/require_permission"
```

---

## Task 7: Webhook endpoint (user sync)

**Files:**
- Create: `qa-chatbot/src/app/api/v1/webhooks.py`

- [ ] **Step 1: Write failing test**

Create `qa-chatbot/tests/unit/test_webhooks.py`:

```python
import json
from unittest.mock import AsyncMock, MagicMock, patch
import pytest
from httpx import ASGITransport, AsyncClient
from fastapi import FastAPI
from app.api.v1.webhooks import router

app = FastAPI()
app.include_router(router)


@pytest.mark.asyncio
async def test_webhook_user_created_creates_user() -> None:
    payload = {
        "type": "user.created",
        "data": {
            "id": "user_abc",
            "email_addresses": [{"email_address": "new@example.com"}],
            "first_name": "Alice",
            "last_name": "Smith",
        },
    }
    with (
        patch("app.api.v1.webhooks.verify_webhook_signature", return_value=True),
        patch("app.api.v1.webhooks.get_async_session") as mock_session_gen,
    ):
        mock_db = AsyncMock()
        mock_session_gen.return_value.__aenter__ = AsyncMock(return_value=mock_db)
        mock_session_gen.return_value.__aexit__ = AsyncMock(return_value=False)

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post(
                "/webhooks/clerk",
                content=json.dumps(payload),
                headers={
                    "svix-id": "msg_abc",
                    "svix-timestamp": "1234567890",
                    "svix-signature": "v1,fake",
                    "content-type": "application/json",
                },
            )
        assert response.status_code == 200
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd qa-chatbot && uv run pytest tests/unit/test_webhooks.py -v
```

Expected: `ModuleNotFoundError: No module named 'app.api.v1.webhooks'`

- [ ] **Step 3: Create webhooks.py**

Create `qa-chatbot/src/app/api/v1/webhooks.py`:

```python
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request, status
from svix.webhooks import Webhook, WebhookVerificationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.clerk import get_clerk_settings
from app.db.session import get_async_session
from app.repositories.user_repo import UserRepository

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


def verify_webhook_signature(payload: bytes, svix_id: str, svix_timestamp: str, svix_signature: str) -> bool:
    """Verify the Clerk webhook signature using svix."""
    settings = get_clerk_settings()
    wh = Webhook(settings.CLERK_WEBHOOK_SECRET.get_secret_value())
    try:
        wh.verify(payload, {
            "svix-id": svix_id,
            "svix-timestamp": svix_timestamp,
            "svix-signature": svix_signature,
        })
        return True
    except WebhookVerificationError:
        return False


@router.post("/clerk", status_code=status.HTTP_200_OK)
async def clerk_webhook(
    request: Request,
    svix_id: str = Header(alias="svix-id"),
    svix_timestamp: str = Header(alias="svix-timestamp"),
    svix_signature: str = Header(alias="svix-signature"),
) -> dict[str, str]:
    """Receive Clerk webhook events and sync user data to Postgres."""
    body = await request.body()

    if not verify_webhook_signature(body, svix_id, svix_timestamp, svix_signature):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid webhook signature")

    event: dict[str, Any] = await request.json()
    event_type: str = event.get("type", "")
    data: dict[str, Any] = event.get("data", {})

    async for db in get_async_session():
        await _handle_event(event_type, data, db)

    return {"status": "ok"}


async def _handle_event(event_type: str, data: dict[str, Any], db: AsyncSession) -> None:
    repo = UserRepository(db)

    if event_type == "user.created":
        clerk_user_id: str = data["id"]
        emails: list[dict[str, Any]] = data.get("email_addresses", [])
        email = emails[0]["email_address"] if emails else ""
        first_name: str = data.get("first_name") or ""
        last_name: str = data.get("last_name") or ""
        full_name = f"{first_name} {last_name}".strip() or None

        existing = await repo.get_by_clerk_id(clerk_user_id)
        if existing is None:
            await repo.create(
                clerk_user_id=clerk_user_id,
                email=email,
                full_name=full_name,
            )
            await db.commit()

    elif event_type == "user.deleted":
        clerk_user_id = data.get("id", "")
        user = await repo.get_by_clerk_id(clerk_user_id)
        if user is not None:
            user.is_active = False
            await db.commit()
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd qa-chatbot && uv run pytest tests/unit/test_webhooks.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add qa-chatbot/src/app/api/v1/webhooks.py qa-chatbot/tests/unit/test_webhooks.py
git commit -m "feat: add Clerk webhook endpoint for user sync (created/deleted)"
```

---

## Task 8: Org API keys routes

**Files:**
- Create: `qa-chatbot/src/app/schemas/org.py`
- Create: `qa-chatbot/src/app/api/v1/orgs.py`

- [ ] **Step 1: Create org schemas**

Create `qa-chatbot/src/app/schemas/org.py`:

```python
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator


class OrgApiKeyCreateRequest(BaseModel):
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


class OrgApiKeyCreatedResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    key: str
    created_at: datetime


class OrgApiKeyResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    org_id: str
    is_active: bool
    last_used_at: datetime | None
    created_at: datetime
    revoked_at: datetime | None


class OrgApiKeyListResponse(BaseModel):
    keys: list[OrgApiKeyResponse]
    total: int


class MemberPermissionsRequest(BaseModel):
    permissions: list[str]

    @field_validator("permissions")
    @classmethod
    def validate_permissions(cls, v: list[str]) -> list[str]:
        allowed = {"org:optimize:general", "org:optimize:pdo", "org:optimize:bridge", "org:analyze"}
        invalid = set(v) - allowed
        if invalid:
            raise ValueError(f"Invalid permissions: {invalid}")
        return v
```

- [ ] **Step 2: Create orgs.py router**

Create `qa-chatbot/src/app/api/v1/orgs.py`:

```python
import hashlib
import math
import secrets
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi import status as http_status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.types.response import SuccessResponse
from app.core.clerk import get_clerk_client
from app.core.rate_limit import RateLimiter
from app.core.user_context import UserContext
from app.dependencies import get_current_user, get_db, require_role
from app.repositories.api_key_repo import ApiKeyRepository
from app.schemas.api_key import PaginatedApiKeyListResponse
from app.schemas.org import (
    MemberPermissionsRequest,
    OrgApiKeyCreateRequest,
    OrgApiKeyCreatedResponse,
    OrgApiKeyListResponse,
    OrgApiKeyResponse,
)

router = APIRouter(prefix="/orgs", tags=["orgs"])
_default_limiter = RateLimiter(requests=60, window_seconds=60)
_admin_or_owner = require_role("org:admin", "org:owner")


def _generate_org_api_key() -> tuple[str, str]:
    raw = f"qac_{secrets.token_urlsafe(32)}"
    hashed = hashlib.sha256(raw.encode()).hexdigest()
    return raw, hashed


@router.post(
    "/api-keys",
    response_model=SuccessResponse[OrgApiKeyCreatedResponse],
    status_code=http_status.HTTP_201_CREATED,
    dependencies=[Depends(_default_limiter)],
)
async def create_org_api_key(
    request: OrgApiKeyCreateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    ctx: Annotated[UserContext, Depends(_admin_or_owner)],
) -> SuccessResponse[OrgApiKeyCreatedResponse]:
    """Create an org-scoped API key. Owner or Admin only."""
    repo = ApiKeyRepository(db)
    if await repo.has_active_name_for_org(ctx.org_id, request.name):
        raise HTTPException(status_code=409, detail="An active key with this name already exists")

    raw_key, key_hash = _generate_org_api_key()
    try:
        key = await repo.create(
            org_id=ctx.org_id,
            created_by=ctx.user_id,
            name=request.name,
            key_hash=key_hash,
        )
        await db.flush()
        await db.commit()
    except IntegrityError:
        raise HTTPException(status_code=409, detail="Key name conflict") from None

    return SuccessResponse(
        data=OrgApiKeyCreatedResponse(
            id=key.id,
            name=key.name,
            key=raw_key,
            created_at=key.created_at,
        )
    )


@router.get(
    "/api-keys",
    response_model=SuccessResponse[OrgApiKeyListResponse],
    dependencies=[Depends(_default_limiter)],
)
async def list_org_api_keys(
    db: Annotated[AsyncSession, Depends(get_db)],
    ctx: Annotated[UserContext, Depends(_admin_or_owner)],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> SuccessResponse[OrgApiKeyListResponse]:
    """List all API keys for the current org. Owner or Admin only."""
    repo = ApiKeyRepository(db)
    offset = (page - 1) * page_size
    total = await repo.count_by_org(ctx.org_id)
    keys = await repo.list_by_org(ctx.org_id, limit=page_size, offset=offset)
    return SuccessResponse(
        data=OrgApiKeyListResponse(
            keys=[OrgApiKeyResponse.model_validate(k) for k in keys],
            total=total,
        )
    )


@router.delete(
    "/api-keys/{key_id}",
    response_model=SuccessResponse[OrgApiKeyResponse],
    dependencies=[Depends(_default_limiter)],
)
async def revoke_org_api_key(
    key_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    ctx: Annotated[UserContext, Depends(_admin_or_owner)],
) -> SuccessResponse[OrgApiKeyResponse]:
    """Revoke an org API key. Owner or Admin only."""
    repo = ApiKeyRepository(db)
    key = await repo.get_by_id_and_org(key_id, ctx.org_id)
    if key is None:
        raise HTTPException(status_code=404, detail="API key not found")
    if not key.is_active:
        raise HTTPException(status_code=409, detail="API key already revoked")
    key = await repo.revoke(key)
    await db.commit()
    return SuccessResponse(data=OrgApiKeyResponse.model_validate(key))


@router.put(
    "/members/{clerk_user_id}/permissions",
    response_model=SuccessResponse[dict],
    dependencies=[Depends(_default_limiter)],
)
async def set_member_permissions(
    clerk_user_id: str,
    body: MemberPermissionsRequest,
    ctx: Annotated[UserContext, Depends(_admin_or_owner)],
) -> SuccessResponse[dict]:
    """Set tool permissions for an org member. Admin or Owner only.

    Calls Clerk API to update the member's org permissions.
    """
    clerk = get_clerk_client()
    try:
        clerk.organization_memberships.update(
            organization_id=ctx.org_id,
            user_id=clerk_user_id,
            role="org:collaborator",
        )
        # Update permissions via Clerk's permission assignment
        # First get all permissions for the org, then sync
        all_permissions = [
            "org:optimize:general",
            "org:optimize:pdo",
            "org:optimize:bridge",
            "org:analyze",
        ]
        for perm in all_permissions:
            if perm in body.permissions:
                clerk.organization_memberships.create_permission(
                    organization_id=ctx.org_id,
                    user_id=clerk_user_id,
                    permission=perm,
                )
            else:
                try:
                    clerk.organization_memberships.delete_permission(
                        organization_id=ctx.org_id,
                        user_id=clerk_user_id,
                        permission=perm,
                    )
                except Exception:
                    pass
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update permissions: {e}") from e

    return SuccessResponse(data={"updated": True, "permissions": body.permissions})
```

- [ ] **Step 3: Commit**

```bash
git add qa-chatbot/src/app/schemas/org.py qa-chatbot/src/app/api/v1/orgs.py
git commit -m "feat: add org API key CRUD and member permission management endpoints"
```

---

## Task 9: Update router, main.py, and chat permissions

**Files:**
- Modify: `qa-chatbot/src/app/api/router.py`
- Modify: `qa-chatbot/src/app/main.py`
- Modify: `qa-chatbot/src/app/api/v1/chat.py`
- Modify: `qa-chatbot/src/app/api/v1/users.py`

- [ ] **Step 1: Update router.py**

Replace `qa-chatbot/src/app/api/router.py`:

```python
from fastapi import APIRouter

from app.api.v1 import (
    api_keys,
    categories,
    chat,
    favorites,
    health,
    openrouter,
    orgs,
    prompts,
    stats,
    templates,
    users,
    webhooks,
)
from app.domain_prompt import router as domain_prompt_router
from app.prompt_bridge import router as prompt_bridge_router

api_router = APIRouter()

api_router.include_router(health.router)
api_router.include_router(chat.router)
api_router.include_router(prompts.router)
api_router.include_router(templates.router)
api_router.include_router(stats.router)
api_router.include_router(users.router)
api_router.include_router(favorites.router)
api_router.include_router(api_keys.router)
api_router.include_router(categories.router)
api_router.include_router(openrouter.router)
api_router.include_router(orgs.router)
api_router.include_router(domain_prompt_router)
api_router.include_router(prompt_bridge_router)

# Webhooks registered at root (no /api/v1 prefix — Clerk sends to /webhooks/clerk)
webhooks_router = APIRouter()
webhooks_router.include_router(webhooks.router)
```

- [ ] **Step 2: Update main.py — remove anonymous user seed**

Replace the lifespan and imports in `qa-chatbot/src/app/main.py`. Remove `_ANONYMOUS_USER` import and `_seed_anonymous_user`. The new lifespan:

```python
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import sentry_sdk
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sentry_sdk.integrations.celery import CeleryIntegration
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

from app.api.router import api_router, webhooks_router
from app.api.types.response import ResponseError
from app.config.app import AppSettings, get_app_settings
from app.core.logging import setup_logging
from app.core.middleware import CorrelationIdMiddleware, RateLimitMiddleware, RequestLimitMiddleware
from app.graph.builder import compile_graph
from app.graph.checkpointer import get_checkpointer
from app.seeds.templates import seed_templates
from app.db.session import AsyncSessionLocal

app_settings = get_app_settings()


def _init_sentry(settings: AppSettings) -> None:
    if not settings.SENTRY_DSN:
        return
    sentry_sdk.init(
        dsn=settings.SENTRY_DSN.get_secret_value(),
        environment=settings.ENVIRONMENT,
        integrations=[
            FastApiIntegration(transaction_style="endpoint"),
            SqlalchemyIntegration(),
            CeleryIntegration(),
        ],
        traces_sample_rate=0.2 if settings.ENVIRONMENT == "production" else 0.0,
        send_default_pii=False,
    )


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    setup_logging(debug=app_settings.DEBUG)
    async with AsyncSessionLocal() as session:
        await seed_templates(session)
    async with get_checkpointer() as checkpointer:
        app.state.graph = await compile_graph(checkpointer)
        yield


def create_app() -> FastAPI:
    settings = get_app_settings()
    _init_sentry(settings)
    app = FastAPI(
        title=settings.APP_NAME,
        version="0.1.0",
        docs_url="/docs" if settings.DEBUG else None,
        redoc_url=None,
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGIN,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(CorrelationIdMiddleware)
    app.add_middleware(RateLimitMiddleware)
    app.add_middleware(RequestLimitMiddleware)
    app.include_router(api_router, prefix=settings.API_V1_PREFIX)
    app.include_router(webhooks_router)

    @app.exception_handler(ResponseError)
    async def global_error_response_handler(request: Request, exc: ResponseError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.error.code,
            content={
                "success": False,
                "data": None,
                "error": {
                    "code": exc.error.code,
                    "description": exc.error.description,
                    "message": exc.error.message,
                },
            },
        )

    return app


app = create_app()
```

- [ ] **Step 3: Add permission gate to POST /chat/**

In `qa-chatbot/src/app/api/v1/chat.py`, find the `POST /` route handler and add `require_permission`:

```python
# At the top of chat.py, add this import:
from app.dependencies import get_current_user, get_db, require_permission

# Find the POST "/" route and add the dependency:
@router.post(
    "/",
    response_model=SuccessResponse[ChatJobAcceptedResponse],
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(_chat_limiter), Depends(require_permission("org:optimize:general"))],
)
async def submit_chat(
    ...
```

**Important:** The existing `current_user: Annotated[User, Depends(get_current_user)]` in the route handler signature needs to change to use `UserContext`. Find all places in chat.py that use `current_user` and check what fields are accessed — they should all be `current_user.id`, `current_user.credits`, `current_user.email` which exist on `UserContext` as `user_id`, `credits`, `email`. Update accordingly.

Specifically in chat.py, change:
- `current_user: Annotated[User, Depends(get_current_user)]` → `ctx: Annotated[UserContext, Depends(get_current_user)]`
- All `current_user.id` → `ctx.user_id`

- [ ] **Step 4: Update users.py to return clerk_user_id**

In `qa-chatbot/src/app/schemas/user.py`, add `clerk_user_id` to `UserResponse`:

```python
import datetime
import uuid

from pydantic import BaseModel, ConfigDict


class CreditResponse(BaseModel):
    credits: int


class AddCreditRequest(BaseModel):
    amount: int


class UserResponse(BaseModel):
    id: uuid.UUID
    clerk_user_id: str
    email: str
    full_name: str | None = None
    is_active: bool
    credits: int
    last_login_at: datetime.datetime | None = None

    model_config = ConfigDict(from_attributes=True)
```

In `qa-chatbot/src/app/api/v1/users.py`, update to use `UserContext` from `get_current_user`:

```python
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.types.response import SuccessResponse
from app.core.rate_limit import RateLimiter
from app.core.user_context import UserContext
from app.dependencies import get_current_user, get_db
from app.repositories.user_repo import UserRepository
from app.schemas.user import AddCreditRequest, CreditResponse, UserResponse

router = APIRouter(prefix="/users", tags=["users"])
_default_limiter = RateLimiter(requests=60, window_seconds=60)


@router.get(
    "/me", response_model=SuccessResponse[UserResponse], dependencies=[Depends(_default_limiter)]
)
async def get_me(
    ctx: Annotated[UserContext, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SuccessResponse[UserResponse]:
    repo = UserRepository(db)
    user = await repo.get_by_id(ctx.user_id)
    return SuccessResponse(data=UserResponse.model_validate(user))


@router.get(
    "/credits",
    response_model=SuccessResponse[CreditResponse],
    dependencies=[Depends(_default_limiter)],
)
async def get_credits(
    ctx: Annotated[UserContext, Depends(get_current_user)],
) -> SuccessResponse[CreditResponse]:
    return SuccessResponse(data=CreditResponse(credits=ctx.credits))


@router.post(
    "/credits/add",
    response_model=SuccessResponse[CreditResponse],
    dependencies=[Depends(_default_limiter)],
)
async def add_credits(
    request: AddCreditRequest,
    ctx: Annotated[UserContext, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SuccessResponse[CreditResponse]:
    repo = UserRepository(db)
    user = await repo.get_by_id(ctx.user_id)
    user.credits += request.amount
    await db.commit()
    return SuccessResponse(data=CreditResponse(credits=user.credits))
```

- [ ] **Step 5: Delete old files**

```bash
rm qa-chatbot/src/app/core/security.py
rm qa-chatbot/src/app/config/auth.py
rm qa-chatbot/src/app/api/v1/auth.py
rm qa-chatbot/src/app/schemas/auth.py
```

- [ ] **Step 6: Run type check**

```bash
cd qa-chatbot && uv run mypy src/ --ignore-missing-imports
```

Fix any type errors before committing.

- [ ] **Step 7: Run all backend tests**

```bash
cd qa-chatbot && uv run pytest tests/unit/ -v
```

Expected: all unit tests pass.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: wire Clerk auth into router, main, chat permissions; remove old auth files"
```

---

## Task 10: Update .env.example

**Files:**
- Modify: `qa-chatbot/.env.example` (or create if missing)

- [ ] **Step 1: Update env example**

Ensure `qa-chatbot/.env.example` contains:

```bash
# Clerk
CLERK_SECRET_KEY=sk_test_your_key_here
CLERK_WEBHOOK_SECRET=whsec_your_secret_here
CLERK_AUTHORIZED_PARTY=http://localhost:3000

# Database
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/qa_chatbot

# Redis
REDIS_URL=redis://localhost:6379/0

# OpenRouter
OPENROUTER_API_KEY=your_openrouter_key_here

# App
ENVIRONMENT=development
DEBUG=true
```

Remove any `SECRET_KEY`, `ALGORITHM`, `AUTH_ENABLED` entries.

- [ ] **Step 2: Commit**

```bash
git add qa-chatbot/.env.example
git commit -m "chore: update .env.example for Clerk auth"
```

---

## Task 11: Frontend — install Clerk and update layout

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/src/app/layout.tsx`
- Modify: `frontend/src/types/api.ts`

- [ ] **Step 1: Install @clerk/nextjs**

```bash
cd frontend && npm install @clerk/nextjs
```

Expected: `@clerk/nextjs` added to package.json.

- [ ] **Step 2: Add Clerk env vars to frontend**

Add to `frontend/.env.local`:

```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_your_key_here
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/dashboard
```

- [ ] **Step 3: Update layout.tsx to use ClerkProvider**

Replace `frontend/src/app/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { Instrument_Serif } from 'next/font/google';
import './globals.css';
import { ClerkProvider } from '@clerk/nextjs';
import { Providers } from '@/components/providers';
import { Toaster } from '@/components/ui/sonner';

const geist = localFont({
  src: './fonts/GeistVF.woff',
  variable: '--font-geist',
  display: 'swap',
});

const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
  display: 'swap',
});

const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: ['400'],
  style: ['normal', 'italic'],
  variable: '--font-instrument-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Promptly — prompt optimization',
  description: 'Paste your prompt. Let the council improve it.',
  icons: { icon: '/favicon.ico' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <head>
          <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('ply-theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}else if(window.matchMedia('(prefers-color-scheme: light)').matches){document.documentElement.setAttribute('data-theme','light');}else{document.documentElement.setAttribute('data-theme','dark');}}catch(e){}})();` }} />
        </head>
        <body
          className={`${geist.variable} ${geistMono.variable} ${instrumentSerif.variable}`}
          style={{ fontFamily: 'var(--font-geist), ui-sans-serif, system-ui, sans-serif' }}
        >
          <Providers>
            {children}
            <Toaster />
          </Providers>
        </body>
      </html>
    </ClerkProvider>
  );
}
```

- [ ] **Step 4: Update types/api.ts**

Add org/role types to `frontend/src/types/api.ts`:

```typescript
export interface User {
  id: string;
  clerk_user_id: string;
  email: string;
  full_name?: string | null;
  credits: number;
  created_at: string;
}

export type OrgRole = 'org:owner' | 'org:admin' | 'org:collaborator';

export type Permission =
  | 'org:optimize:general'
  | 'org:optimize:pdo'
  | 'org:optimize:bridge'
  | 'org:analyze';

export interface OrgMembership {
  org_id: string;
  role: OrgRole;
  permissions: Permission[];
}

export interface OrgApiKey {
  id: string;
  name: string;
  org_id: string;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
}
```

- [ ] **Step 5: Commit**

```bash
cd frontend && git add package.json package-lock.json src/app/layout.tsx src/types/api.ts .env.local
git commit -m "feat: install @clerk/nextjs, wrap app in ClerkProvider, add org types"
```

---

## Task 12: Frontend middleware — Clerk route protection

**Files:**
- Modify: `frontend/src/middleware.ts`

- [ ] **Step 1: Replace middleware with clerkMiddleware**

Replace `frontend/src/middleware.ts`:

```typescript
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
]);

const isAdminRoute = createRouteMatcher(['/admin(.*)']);
const isSettingsAdminRoute = createRouteMatcher([
  '/settings/members(.*)',
  '/settings/api-keys(.*)',
]);

function buildCsp(req: Request): string {
  const isProd = process.env.NODE_ENV === 'production';
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

  const scriptSrc = isProd
    ? ["script-src 'self'"]
    : ["script-src 'self' 'unsafe-eval' 'unsafe-inline'"];

  const connectSrc = isProd
    ? [`connect-src 'self' ${apiUrl} https://clerk.promptly.dev`]
    : [`connect-src 'self' ${apiUrl} https://*.clerk.accounts.dev ws://localhost:*`];

  return [
    "default-src 'self'",
    ...scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://img.clerk.com",
    "font-src 'self'",
    ...connectSrc,
    "frame-ancestors 'none'",
  ].join('; ');
}

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }

  const { sessionClaims } = await auth();
  const orgRole = (sessionClaims as any)?.org_role as string | undefined;

  if (isAdminRoute(req) && orgRole !== 'org:owner') {
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }

  if (isSettingsAdminRoute(req) && !['org:owner', 'org:admin'].includes(orgRole ?? '')) {
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }

  const response = NextResponse.next();
  response.headers.set('Content-Security-Policy', buildCsp(req));
  return response;
});

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/middleware.ts
git commit -m "feat: replace custom cookie middleware with clerkMiddleware for route protection"
```

---

## Task 13: Frontend auth pages — sign-in and sign-up

**Files:**
- Create: `frontend/src/app/(auth)/sign-in/[[...sign-in]]/page.tsx`
- Create: `frontend/src/app/(auth)/sign-up/[[...sign-up]]/page.tsx`
- Create: `frontend/src/app/(auth)/org-select/page.tsx`

- [ ] **Step 1: Create sign-in page**

Create `frontend/src/app/(auth)/sign-in/[[...sign-in]]/page.tsx`:

```tsx
import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <SignIn
        appearance={{
          variables: {
            colorPrimary: '#7c5cff',
            fontFamily: 'var(--font-geist, ui-sans-serif)',
            borderRadius: '8px',
          },
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Create sign-up page**

Create `frontend/src/app/(auth)/sign-up/[[...sign-up]]/page.tsx`:

```tsx
import { SignUp } from '@clerk/nextjs';

export default function SignUpPage() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <SignUp
        appearance={{
          variables: {
            colorPrimary: '#7c5cff',
            fontFamily: 'var(--font-geist, ui-sans-serif)',
            borderRadius: '8px',
          },
        }}
      />
    </div>
  );
}
```

- [ ] **Step 3: Create org-select page**

Create `frontend/src/app/(auth)/org-select/page.tsx`:

```tsx
'use client';

import { OrganizationList } from '@clerk/nextjs';

export default function OrgSelectPage() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <OrganizationList
        hidePersonal
        afterSelectOrganizationUrl="/dashboard"
        afterCreateOrganizationUrl="/dashboard"
        appearance={{
          variables: {
            colorPrimary: '#7c5cff',
            fontFamily: 'var(--font-geist, ui-sans-serif)',
          },
        }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/\(auth\)/sign-in frontend/src/app/\(auth\)/sign-up frontend/src/app/\(auth\)/org-select
git commit -m "feat: add Clerk sign-in, sign-up, and org-select pages"
```

---

## Task 14: Frontend — update API client and permission helpers

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Create: `frontend/src/hooks/use-permissions.ts`
- Create: `frontend/src/components/permission-gate.tsx`

- [ ] **Step 1: Update api.ts to use Clerk token**

Replace `frontend/src/lib/api.ts`:

```typescript
import axios from 'axios';
import { env } from '@/lib/env';

export const api = axios.create({
  baseURL: env.NEXT_PUBLIC_API_URL,
});

// Request interceptor: attach Clerk JWT
api.interceptors.request.use(async (config) => {
  try {
    // Dynamic import to avoid SSR issues
    const { auth } = await import('@clerk/nextjs/server');
    const { getToken } = await auth();
    const token = await getToken();
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch {
    // Running client-side — use window.Clerk
    if (typeof window !== 'undefined' && (window as any).Clerk) {
      const token = await (window as any).Clerk.session?.getToken();
      if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
  }
  return config;
});

// Response interceptor: redirect to sign-in on 401
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      if (typeof window !== 'undefined') {
        window.location.href = '/sign-in';
      }
    }
    return Promise.reject(error);
  }
);
```

- [ ] **Step 2: Create use-permissions hook**

Create `frontend/src/hooks/use-permissions.ts`:

```typescript
'use client';

import { useOrganization } from '@clerk/nextjs';
import type { OrgRole, Permission } from '@/types/api';

export function usePermissions() {
  const { membership } = useOrganization();

  const permissions = (membership?.permissions ?? []) as string[];
  const role = membership?.role as OrgRole | undefined;

  function hasPermission(permission: Permission): boolean {
    return permissions.includes(permission);
  }

  function hasRole(...roles: OrgRole[]): boolean {
    return role !== undefined && roles.includes(role);
  }

  return { permissions, role, hasPermission, hasRole };
}
```

- [ ] **Step 3: Create PermissionGate component**

Create `frontend/src/components/permission-gate.tsx`:

```tsx
'use client';

import { usePermissions } from '@/hooks/use-permissions';
import type { OrgRole, Permission } from '@/types/api';

interface PermissionGateProps {
  permission?: Permission;
  role?: OrgRole | OrgRole[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function PermissionGate({ permission, role, children, fallback = null }: PermissionGateProps) {
  const { hasPermission, hasRole } = usePermissions();

  if (permission && !hasPermission(permission)) {
    return <>{fallback}</>;
  }

  if (role) {
    const roles = Array.isArray(role) ? role : [role];
    if (!hasRole(...roles)) {
      return <>{fallback}</>;
    }
  }

  return <>{children}</>;
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/hooks/use-permissions.ts frontend/src/components/permission-gate.tsx
git commit -m "feat: update API client to use Clerk token; add usePermissions hook and PermissionGate"
```

---

## Task 15: Delete old frontend auth files

**Files:**
- Delete: `frontend/src/app/(auth)/login/page.tsx`
- Delete: `frontend/src/app/(auth)/register/page.tsx`
- Delete: `frontend/src/app/api/auth/route.ts`
- Delete: `frontend/src/lib/auth.ts`
- Delete: `frontend/src/stores/auth-store.ts`
- Delete: `frontend/src/components/auth-initializer.tsx`

- [ ] **Step 1: Delete old files**

```bash
rm frontend/src/app/\(auth\)/login/page.tsx
rm frontend/src/app/\(auth\)/register/page.tsx
rm frontend/src/app/api/auth/route.ts
rm frontend/src/lib/auth.ts
rm frontend/src/stores/auth-store.ts
rm frontend/src/components/auth-initializer.tsx
```

- [ ] **Step 2: Fix any imports referencing deleted files**

Search for references:

```bash
grep -r "auth-store\|auth-initializer\|lib/auth\|api/auth" frontend/src/ --include="*.tsx" --include="*.ts" -l
```

For each file found, remove the import and usage. The `AuthInitializer` was used in `layout.tsx` (already replaced in Task 11). The `useAuthStore` was used in `api.ts` (already replaced in Task 14) and login/register pages (deleted above).

- [ ] **Step 3: Build check**

```bash
cd frontend && npm run build
```

Expected: successful build with no errors. Fix any remaining import errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: remove legacy auth files (login/register pages, auth-store, cookie route, auth-initializer)"
```

---

## Task 16: Verification

- [ ] **Step 1: Run full backend test suite**

```bash
cd qa-chatbot && uv run pytest tests/ -v --tb=short
```

Expected: all tests pass. Note: integration tests that called `/api/v1/auth/login` will fail — update them to use the Clerk webhook endpoint to create users and mock Clerk JWT verification.

- [ ] **Step 2: Update conftest.py for Clerk auth in tests**

Update `qa-chatbot/tests/conftest.py` — add a fixture that creates a user via the repo and mocks Clerk JWT verification:

```python
import uuid
from collections.abc import AsyncGenerator
from unittest.mock import MagicMock, patch

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db.session import get_async_session
from app.dependencies import get_db, get_current_user
from app.main import create_app
from app.models.base import Base
from app.models.user import User
from app.core.user_context import UserContext

TEST_DB_URL = "postgresql+asyncpg://postgres:postgres@localhost:5433/qa_chatbot_test"

TEST_USER_ID = uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
TEST_CLERK_USER_ID = "user_test_abc"
TEST_ORG_ID = "org_test_xyz"

TEST_USER_CONTEXT = UserContext(
    user_id=TEST_USER_ID,
    clerk_user_id=TEST_CLERK_USER_ID,
    email="test@example.com",
    credits=1000,
    org_id=TEST_ORG_ID,
    org_role="org:admin",
    permissions=[
        "org:optimize:general",
        "org:optimize:pdo",
        "org:optimize:bridge",
        "org:analyze",
    ],
)


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def _db_engine():  # type: ignore[return]  # noqa: ANN201
    engine = create_async_engine(TEST_DB_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture(loop_scope="session")
async def db_session(_db_engine) -> AsyncGenerator[AsyncSession, None]:  # type: ignore[return]  # noqa: ANN001
    session_factory = async_sessionmaker(_db_engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session
        await session.rollback()

    async with _db_engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            await conn.execute(table.delete())


@pytest_asyncio.fixture(loop_scope="session")
async def test_user(db_session: AsyncSession) -> User:
    user = User(
        id=TEST_USER_ID,
        clerk_user_id=TEST_CLERK_USER_ID,
        email="test@example.com",
        full_name="Test User",
        credits=1000,
        is_active=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture(loop_scope="session")
async def client(db_session: AsyncSession, test_user: User) -> AsyncGenerator[AsyncClient, None]:
    app = create_app()

    async def _override_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    async def _override_auth() -> UserContext:
        return TEST_USER_CONTEXT

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_async_session] = _override_db
    app.dependency_overrides[get_current_user] = _override_auth

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
```

- [ ] **Step 3: Run tests again**

```bash
cd qa-chatbot && uv run pytest tests/ -v --tb=short
```

Expected: all tests pass (auth tests that tested login/register will be removed — delete `tests/integration/api/test_auth.py` as it tests the deleted endpoints).

- [ ] **Step 4: Frontend build**

```bash
cd frontend && npm run build
```

Expected: clean build.

- [ ] **Step 5: Start full stack and test manually**

```bash
# Terminal 1
cd qa-chatbot && make infra && make migrate && make dev

# Terminal 2
cd qa-chatbot && make worker

# Terminal 3
cd frontend && npm run dev
```

Open `http://localhost:3000` — should redirect to sign-in. Create an account via Clerk (Google or email). After sign-in, Clerk creates a session. The webhook fires → FastAPI creates the user in Postgres. Navigate to `/dashboard`.

- [ ] **Step 6: Create org and set permissions in Clerk dashboard**

1. In Clerk dashboard → Users → find your user → add to organization
2. Set your role to `org:owner`
3. Test that `/admin` routes are accessible only to owner

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: update conftest for Clerk auth; verified full stack working"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Clerk JWT verification (RS256) | Task 2, 6 |
| Three roles: Owner, Admin, Collaborator | Prerequisites + Task 6 |
| Four permissions, org:analyze default | Prerequisites + Task 9 |
| `require_permission()` dependency | Task 6 |
| `require_role()` dependency | Task 6 |
| User model: add `clerk_user_id`, remove password fields | Task 3, 4 |
| ApiKey model: org-scoped | Task 3, 4 |
| Webhook user sync | Task 7 |
| Org API key CRUD | Task 8 |
| Member permission management | Task 8 |
| Remove old auth routes | Task 9 |
| Remove anonymous user bypass | Task 9 |
| ClerkProvider in layout | Task 11 |
| clerkMiddleware route protection | Task 12 |
| Sign-in/sign-up pages | Task 13 |
| Org select page | Task 13 |
| API client uses Clerk token | Task 14 |
| usePermissions hook | Task 14 |
| PermissionGate component | Task 14 |
| Delete legacy auth files | Task 15 |
| Google + GitHub OAuth | Prerequisites |
| Local dev with Clerk dev instance | Task 10, 11 |

All requirements covered. ✅
