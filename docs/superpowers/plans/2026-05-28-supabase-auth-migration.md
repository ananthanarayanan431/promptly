# Supabase Auth & DB Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Clerk authentication with Supabase Auth, point the backend at Supabase-managed PostgreSQL, and add Row-Level Security policies for authorization — with zero changes to Redis, Celery, or LangGraph.

**Architecture:** The FastAPI backend verifies Supabase JWTs using PyJWT + the project's `SUPABASE_JWT_SECRET` (HS256). User data (email, full_name) is read directly from the JWT payload — no external provisioning API call needed. The frontend replaces `@clerk/nextjs` with `@supabase/ssr` for session cookies, middleware protection, and the axios token interceptor. The existing SQLAlchemy/asyncpg connection is unchanged structurally; only the `DATABASE_URL` points at Supabase.

**Tech Stack:** Python/FastAPI (PyJWT≥2.8, SQLAlchemy asyncio, Alembic), Next.js 14 (App Router, `@supabase/ssr`, `@supabase/supabase-js`), Supabase (managed Postgres + Auth)

---

## File Map

**Created:**
- `qa-chatbot/src/app/config/supabase.py` — SupabaseSettings (URL, anon key, service role key, JWT secret)
- `qa-chatbot/src/app/core/supabase_auth.py` — `verify_supabase_token()` using PyJWT
- `qa-chatbot/src/app/migrations/versions/<hash>_supabase_auth.py` — rename `clerk_user_id` → `supabase_user_id`
- `frontend/src/lib/supabase.ts` — browser Supabase client factory
- `frontend/src/lib/supabase-server.ts` — middleware Supabase client factory
- `frontend/src/components/supabase-token-sync.tsx` — registers Supabase JWT with axios
- `frontend/src/app/auth/callback/route.ts` — OAuth code-exchange handler

**Modified:**
- `qa-chatbot/pyproject.toml` — add PyJWT, remove clerk-backend-api + svix
- `qa-chatbot/src/app/models/user.py` — rename column
- `qa-chatbot/src/app/core/user_context.py` — rename field
- `qa-chatbot/src/app/repositories/user_repo.py` — rename method
- `qa-chatbot/src/app/dependencies.py` — swap Clerk → Supabase auth, simplify `_provision_user()`
- `frontend/src/lib/env.ts` — add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `frontend/src/middleware.ts` — replace `clerkMiddleware` with Supabase session check
- `frontend/src/app/layout.tsx` — remove `ClerkProvider`, swap token sync component
- `frontend/src/components/auth/auth-form.tsx` — replace Clerk hooks with Supabase auth calls
- `frontend/src/components/auth/social-buttons.tsx` — replace Clerk OAuth with Supabase OAuth
- `frontend/src/components/layout/user-menu.tsx` — replace `useClerk`/`useUser` with Supabase session
- `frontend/.env.local` — swap env vars

**Deleted:**
- `qa-chatbot/src/app/config/clerk.py`
- `qa-chatbot/src/app/core/clerk.py`
- `frontend/src/components/clerk-token-sync.tsx`
- `frontend/src/app/(auth)/org-select/page.tsx`

---

## Task 1: Backend — Add PyJWT + Supabase config module

**Files:**
- Modify: `qa-chatbot/pyproject.toml`
- Create: `qa-chatbot/src/app/config/supabase.py`

- [ ] **Step 1: Add PyJWT dependency**

In `qa-chatbot/pyproject.toml`, inside `dependencies = [`, add after the existing entries:
```toml
    "PyJWT>=2.8.0",
```

Also remove `"clerk-backend-api>=1.9.0",` and `"svix>=1.62.0",` from the same list.

- [ ] **Step 2: Create Supabase settings module**

Create `qa-chatbot/src/app/config/supabase.py`:
```python
from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class SupabaseSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )
    SUPABASE_URL: str
    SUPABASE_ANON_KEY: str
    SUPABASE_SERVICE_ROLE_KEY: SecretStr
    SUPABASE_JWT_SECRET: SecretStr


@lru_cache
def get_supabase_settings() -> SupabaseSettings:
    return SupabaseSettings()
```

- [ ] **Step 3: Install the new dependency**

```bash
cd qa-chatbot && uv sync --all-extras
```
Expected: resolves without error, `PyJWT` appears in the lock file.

- [ ] **Step 4: Commit**

```bash
git add qa-chatbot/pyproject.toml qa-chatbot/src/app/config/supabase.py
git commit -m "feat: add PyJWT + Supabase settings config"
```

---

## Task 2: Backend — JWT verification module

**Files:**
- Create: `qa-chatbot/src/app/core/supabase_auth.py`

- [ ] **Step 1: Write the test**

Create `qa-chatbot/tests/unit/core/test_supabase_auth.py`:
```python
import time
import jwt
import pytest
from unittest.mock import patch
from app.core.supabase_auth import verify_supabase_token
from app.core.exceptions import UnauthorizedException


def _make_token(secret: str, overrides: dict | None = None) -> str:
    payload = {
        "sub": "abc-123",
        "email": "test@example.com",
        "aud": "authenticated",
        "role": "authenticated",
        "exp": int(time.time()) + 3600,
        "user_metadata": {"full_name": "Test User"},
    }
    if overrides:
        payload.update(overrides)
    return jwt.encode(payload, secret, algorithm="HS256")


@patch("app.core.supabase_auth.get_supabase_settings")
def test_valid_token_returns_payload(mock_settings):
    secret = "test-secret-32-chars-long-enough!!"
    mock_settings.return_value.SUPABASE_JWT_SECRET.get_secret_value.return_value = secret
    token = _make_token(secret)
    payload = verify_supabase_token(token)
    assert payload["sub"] == "abc-123"
    assert payload["email"] == "test@example.com"


@patch("app.core.supabase_auth.get_supabase_settings")
def test_expired_token_raises(mock_settings):
    secret = "test-secret-32-chars-long-enough!!"
    mock_settings.return_value.SUPABASE_JWT_SECRET.get_secret_value.return_value = secret
    token = _make_token(secret, {"exp": int(time.time()) - 10})
    with pytest.raises(UnauthorizedException):
        verify_supabase_token(token)


@patch("app.core.supabase_auth.get_supabase_settings")
def test_wrong_secret_raises(mock_settings):
    secret = "test-secret-32-chars-long-enough!!"
    mock_settings.return_value.SUPABASE_JWT_SECRET.get_secret_value.return_value = "wrong-secret!!"
    token = _make_token(secret)
    with pytest.raises(UnauthorizedException):
        verify_supabase_token(token)
```

- [ ] **Step 2: Run the test — expect FAIL (module not found)**

```bash
cd qa-chatbot && uv run pytest tests/unit/core/test_supabase_auth.py -v
```
Expected: `ModuleNotFoundError: No module named 'app.core.supabase_auth'`

- [ ] **Step 3: Create the module**

Create `qa-chatbot/src/app/core/supabase_auth.py`:
```python
from typing import Any

import jwt
from jwt.exceptions import InvalidTokenError

from app.config.supabase import get_supabase_settings
from app.core.exceptions import UnauthorizedException
from app.utils.log import get_logger

log = get_logger(__name__)


def verify_supabase_token(token: str) -> dict[str, Any]:
    """Verify a Supabase JWT and return the decoded payload.

    Raises UnauthorizedException if the token is missing, malformed,
    expired, or signed with the wrong secret.
    """
    settings = get_supabase_settings()
    try:
        payload: dict[str, Any] = jwt.decode(
            token,
            settings.SUPABASE_JWT_SECRET.get_secret_value(),
            algorithms=["HS256"],
            audience="authenticated",
        )
    except InvalidTokenError as exc:
        log.warning("supabase_token_verification_failed", error=str(exc))
        raise UnauthorizedException(detail="Invalid or expired token") from exc
    return payload
```

- [ ] **Step 4: Run the test — expect PASS**

```bash
cd qa-chatbot && uv run pytest tests/unit/core/test_supabase_auth.py -v
```
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add qa-chatbot/src/app/core/supabase_auth.py qa-chatbot/tests/unit/core/test_supabase_auth.py
git commit -m "feat: Supabase JWT verification module"
```

---

## Task 3: Backend — Rename clerk_user_id → supabase_user_id in model + context

**Files:**
- Modify: `qa-chatbot/src/app/models/user.py`
- Modify: `qa-chatbot/src/app/core/user_context.py`

- [ ] **Step 1: Update User model**

In `qa-chatbot/src/app/models/user.py`, replace line 21:
```python
    clerk_user_id: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
```
with:
```python
    supabase_user_id: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
```

- [ ] **Step 2: Update UserContext dataclass**

Replace the full content of `qa-chatbot/src/app/core/user_context.py`:
```python
from dataclasses import dataclass
from uuid import UUID


@dataclass
class UserContext:
    user_id: UUID
    supabase_user_id: str
    email: str
    credits: int
    org_id: str
```

- [ ] **Step 3: Commit**

```bash
git add qa-chatbot/src/app/models/user.py qa-chatbot/src/app/core/user_context.py
git commit -m "refactor: rename clerk_user_id to supabase_user_id in model and context"
```

---

## Task 4: Backend — Alembic migration (rename column)

**Files:**
- Create: `qa-chatbot/src/app/migrations/versions/<hash>_rename_clerk_to_supabase_user_id.py`

- [ ] **Step 1: Generate the migration**

```bash
cd qa-chatbot && uv run alembic revision --autogenerate -m "rename_clerk_to_supabase_user_id"
```
Expected: creates a new file in `src/app/migrations/versions/`.

- [ ] **Step 2: Edit the generated migration**

Open the newly generated file. Replace its `upgrade()` and `downgrade()` with the exact SQL rename (autogenerate may produce a drop+add, which loses data):

```python
from alembic import op


def upgrade() -> None:
    op.alter_column("users", "clerk_user_id", new_column_name="supabase_user_id")
    op.execute(
        "ALTER INDEX IF EXISTS ix_users_clerk_user_id RENAME TO ix_users_supabase_user_id"
    )


def downgrade() -> None:
    op.execute(
        "ALTER INDEX IF EXISTS ix_users_supabase_user_id RENAME TO ix_users_clerk_user_id"
    )
    op.alter_column("users", "supabase_user_id", new_column_name="clerk_user_id")
```

- [ ] **Step 3: Run the migration against the local DB**

```bash
cd qa-chatbot && uv run alembic upgrade head
```
Expected: `Running upgrade ... -> <new_hash>, rename_clerk_to_supabase_user_id`

- [ ] **Step 4: Verify the column exists**

```bash
cd qa-chatbot && uv run python -c "
import asyncio
from app.db.session import get_async_session
from sqlalchemy import text

async def check():
    async for db in get_async_session():
        result = await db.execute(text(\"SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='supabase_user_id'\"))
        print('Column found:', result.scalar_one_or_none())
        break

asyncio.run(check())
"
```
Expected: `Column found: supabase_user_id`

- [ ] **Step 5: Commit**

```bash
git add qa-chatbot/src/app/migrations/versions/
git commit -m "feat: migration — rename clerk_user_id to supabase_user_id"
```

---

## Task 5: Backend — Update UserRepository

**Files:**
- Modify: `qa-chatbot/src/app/repositories/user_repo.py`

- [ ] **Step 1: Update the repository**

Replace the full content of `qa-chatbot/src/app/repositories/user_repo.py`:
```python
from uuid import UUID

from sqlalchemy import select, update

from app.models.user import User
from app.repositories.base import BaseRepository


class UserRepository(BaseRepository[User]):
    model = User

    async def get_by_supabase_id(self, supabase_user_id: str) -> User | None:
        """Fetch a user by their Supabase auth UUID."""
        result = await self.db.execute(
            select(User).where(User.supabase_user_id == supabase_user_id)
        )
        return result.scalar_one_or_none()

    async def get_by_email(self, email: str) -> User | None:
        result = await self.db.execute(select(User).where(User.email == email))
        return result.scalar_one_or_none()

    async def get_active_by_email(self, email: str) -> User | None:
        result = await self.db.execute(
            select(User).where(User.email == email, User.is_active == True)  # noqa: E712
        )
        return result.scalar_one_or_none()

    async def deduct_credits(self, user_id: UUID, amount: int) -> bool:
        """Atomically deduct credits, returning False if balance is insufficient."""
        result = await self.db.execute(
            update(User)
            .where(User.id == user_id, User.credits >= amount)
            .values(credits=User.credits - amount)
            .returning(User.id)
        )
        return result.scalar_one_or_none() is not None

    async def refund_credits(self, user_id: UUID, amount: int) -> None:
        """Add credits back to a user account (used after a failed job)."""
        await self.db.execute(
            update(User).where(User.id == user_id).values(credits=User.credits + amount)
        )
```

- [ ] **Step 2: Commit**

```bash
git add qa-chatbot/src/app/repositories/user_repo.py
git commit -m "refactor: rename get_by_clerk_id to get_by_supabase_id in UserRepository"
```

---

## Task 6: Backend — Replace dependencies.py auth logic

**Files:**
- Modify: `qa-chatbot/src/app/dependencies.py`

- [ ] **Step 1: Replace the full file**

Replace the entire content of `qa-chatbot/src/app/dependencies.py`:
```python
import hashlib
from collections.abc import AsyncGenerator
from typing import Annotated, Any

import structlog
from fastapi import Depends, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import UnauthorizedException
from app.core.supabase_auth import verify_supabase_token
from app.core.user_context import UserContext
from app.db.session import get_async_session
from app.repositories.api_key_repo import ApiKeyRepository
from app.repositories.user_repo import UserRepository


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async for session in get_async_session():
        yield session


async def get_graph(request: Request) -> Any:  # noqa: ANN401
    """Returns the compiled LangGraph instance from app state."""
    return request.app.state.graph


async def _provision_user(
    user_repo: UserRepository,
    supabase_user_id: str,
    email: str,
    full_name: str | None,
) -> Any:  # noqa: ANN401
    """Create the local DB record on first Supabase login.

    Email and full_name come directly from the verified JWT payload —
    no external API call required. Idempotent: if a concurrent request
    already inserted this user, we return the existing row.
    """
    log = structlog.get_logger()
    try:
        user = await user_repo.create(
            supabase_user_id=supabase_user_id,
            email=email,
            full_name=full_name or None,
        )
        log.info("user_auto_provisioned", supabase_user_id=supabase_user_id, email=email)
        return user
    except IntegrityError as exc:
        await user_repo.db.rollback()

        existing = await user_repo.get_by_supabase_id(supabase_user_id)
        if existing is not None:
            return existing

        if email:
            by_email = await user_repo.get_by_email(email)
            if by_email is not None:
                claimed = await user_repo.update(by_email, supabase_user_id=supabase_user_id)
                log.info("user_claimed_existing_by_email", supabase_user_id=supabase_user_id, email=email)
                return claimed

        raise UnauthorizedException(detail="User provisioning failed") from exc


async def get_current_user(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> UserContext:
    """Resolves the current user from a Supabase JWT Bearer token or qac_-prefixed API key."""
    authorization = request.headers.get("Authorization", "")
    log = structlog.get_logger()

    scheme, _, token = authorization.partition(" ")
    if not authorization or scheme.lower() != "bearer" or not token:
        log.warning("auth_header_missing", path=request.url.path, has_auth=bool(authorization))
        raise UnauthorizedException(detail="Missing or invalid Authorization header")

    user_repo = UserRepository(db)
    api_key_repo = ApiKeyRepository(db)

    if token.startswith("qac_"):
        key_hash = hashlib.sha256(token.encode()).hexdigest()
        api_key = await api_key_repo.get_active_by_hash(key_hash)
        if api_key is None:
            raise UnauthorizedException(detail="Invalid API key")

        await api_key_repo.update_last_used(api_key.id)

        user = await user_repo.get_by_id(api_key.created_by)
        if user is None or not user.is_active:
            raise UnauthorizedException(detail="Invalid API key")

        structlog.contextvars.bind_contextvars(user_id=str(user.id))
        return UserContext(
            user_id=user.id,
            supabase_user_id=user.supabase_user_id,
            email=user.email,
            credits=user.credits,
            org_id=api_key.org_id or "",
        )

    payload = verify_supabase_token(token)
    supabase_user_id: str = payload["sub"]
    email: str = payload.get("email", "")
    full_name: str | None = payload.get("user_metadata", {}).get("full_name")

    user = await user_repo.get_by_supabase_id(supabase_user_id)
    if user is None:
        user = await _provision_user(user_repo, supabase_user_id, email, full_name)
    if not user.is_active:
        raise UnauthorizedException(detail="User account is inactive")

    structlog.contextvars.bind_contextvars(user_id=str(user.id))
    return UserContext(
        user_id=user.id,
        supabase_user_id=user.supabase_user_id,
        email=user.email,
        credits=user.credits,
        org_id="",
    )
```

- [ ] **Step 2: Run mypy on the file**

```bash
cd qa-chatbot && uv run mypy src/app/dependencies.py
```
Expected: no errors (or only pre-existing unrelated errors).

- [ ] **Step 3: Run linting**

```bash
cd qa-chatbot && uv run ruff check src/app/dependencies.py src/app/core/supabase_auth.py src/app/config/supabase.py
```
Expected: no issues.

- [ ] **Step 4: Commit**

```bash
git add qa-chatbot/src/app/dependencies.py
git commit -m "feat: replace Clerk auth with Supabase JWT in get_current_user"
```

---

## Task 7: Backend — Remove Clerk files and update .env

**Files:**
- Delete: `qa-chatbot/src/app/config/clerk.py`
- Delete: `qa-chatbot/src/app/core/clerk.py`
- Modify: `qa-chatbot/.env`

- [ ] **Step 1: Delete Clerk files**

```bash
rm qa-chatbot/src/app/config/clerk.py
rm qa-chatbot/src/app/core/clerk.py
```

- [ ] **Step 2: Check for any remaining Clerk imports**

```bash
grep -r "clerk" qa-chatbot/src/ --include="*.py" -l
```
Expected: no output (no remaining Clerk references).

- [ ] **Step 3: Update .env**

Remove these keys from `qa-chatbot/.env`:
```
CLERK_SECRET_KEY=...
CLERK_WEBHOOK_SECRET=...
CLERK_AUTHORIZED_PARTY=...
```

Add these keys (fill in with actual values from Supabase dashboard → Settings → API):
```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_JWT_SECRET=your-jwt-secret
```

Also update `DATABASE_URL` to the Supabase direct connection string (Settings → Database → Connection string → URI, use the "Transaction" mode for asyncpg):
```
DATABASE_URL=postgresql+asyncpg://postgres.xxxx:[password]@aws-0-[region].pooler.supabase.com:5432/postgres
```

- [ ] **Step 4: Verify the backend starts**

```bash
cd qa-chatbot && make dev
```
Expected: server starts on port 8000 with no import errors. Check `http://localhost:8000/docs` loads.

- [ ] **Step 5: Commit**

```bash
git add -u qa-chatbot/src/app/config/ qa-chatbot/src/app/core/
git commit -m "chore: remove Clerk SDK files, update env for Supabase"
```

---

## Task 8: Frontend — Swap npm packages

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Remove Clerk, install Supabase**

```bash
cd frontend && npm uninstall @clerk/nextjs && npm install @supabase/ssr @supabase/supabase-js
```
Expected: `package.json` shows `@supabase/ssr` and `@supabase/supabase-js` in dependencies; `@clerk/nextjs` is gone.

- [ ] **Step 2: Verify no Clerk packages remain**

```bash
cat frontend/package.json | grep clerk
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "chore: replace @clerk/nextjs with @supabase/ssr + supabase-js"
```

---

## Task 9: Frontend — Supabase client utilities

**Files:**
- Create: `frontend/src/lib/supabase.ts`
- Create: `frontend/src/lib/supabase-server.ts`

- [ ] **Step 1: Create browser client**

Create `frontend/src/lib/supabase.ts`:
```typescript
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

- [ ] **Step 2: Create middleware/server client factory**

Create `frontend/src/lib/supabase-server.ts`:
```typescript
import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * Creates a Supabase client that reads/writes session cookies via the request.
 * MUST be called inside middleware — returns the mutated response with refreshed cookies.
 */
export function createMiddlewareClient(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  return { supabase, response };
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/supabase.ts frontend/src/lib/supabase-server.ts
git commit -m "feat: Supabase browser and middleware client factories"
```

---

## Task 10: Frontend — Update env.ts schema

**Files:**
- Modify: `frontend/src/lib/env.ts`

- [ ] **Step 1: Add Supabase vars to the Zod schema**

Replace the full content of `frontend/src/lib/env.ts`:
```typescript
import { z } from 'zod';

const envSchema = z.object({
  NEXT_PUBLIC_API_URL: z
    .string()
    .url('NEXT_PUBLIC_API_URL must be a valid URL')
    .default('http://localhost:8000'),
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url('NEXT_PUBLIC_SUPABASE_URL must be a valid URL'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is required'),
});

const _env = envSchema.safeParse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});

if (!_env.success) {
  console.error('❌ Invalid environment variables:', _env.error.flatten().fieldErrors);
  throw new Error('Invalid environment configuration. Check your .env.local file.');
}

export const env = _env.data;
```

- [ ] **Step 2: Update frontend/.env.local**

Remove Clerk vars, add Supabase vars (fill in from Supabase dashboard):
```
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/env.ts
git commit -m "feat: add Supabase env vars to Zod schema"
```

---

## Task 11: Frontend — Update middleware.ts

**Files:**
- Modify: `frontend/src/middleware.ts`

- [ ] **Step 1: Replace middleware**

Replace the full content of `frontend/src/middleware.ts`:
```typescript
import { type NextRequest, NextResponse } from 'next/server';
import { createMiddlewareClient } from '@/lib/supabase-server';

const PUBLIC_ROUTES = ['/', '/sign-in', '/sign-up', '/sso-callback', '/auth/callback'];
const AUTH_ROUTES = ['/sign-in', '/sign-up'];

export async function middleware(request: NextRequest) {
  const { supabase, response } = createMiddlewareClient(request);

  // getUser() must be called to refresh the session cookie on every request.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + '/'),
  );

  if (!user && !isPublic) {
    return NextResponse.redirect(new URL('/sign-in', request.url));
  }

  if (user && AUTH_ROUTES.some((r) => pathname.startsWith(r))) {
    return NextResponse.redirect(new URL('/optimize', request.url));
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/middleware.ts
git commit -m "feat: replace clerkMiddleware with Supabase session middleware"
```

---

## Task 12: Frontend — Replace ClerkProvider + token sync

**Files:**
- Modify: `frontend/src/app/layout.tsx`
- Create: `frontend/src/components/supabase-token-sync.tsx`
- Delete: `frontend/src/components/clerk-token-sync.tsx`

- [ ] **Step 1: Create SupabaseTokenSync**

Create `frontend/src/components/supabase-token-sync.tsx`:
```typescript
'use client';

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase';
import { registerTokenGetter } from '@/lib/api';

export function SupabaseTokenSync() {
  const supabase = createClient();

  useEffect(() => {
    registerTokenGetter(async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return session?.access_token ?? null;
    });
  }, [supabase]);

  return null;
}
```

- [ ] **Step 2: Update root layout**

Replace the full content of `frontend/src/app/layout.tsx`:
```typescript
import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { Instrument_Serif } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';
import { Toaster } from '@/components/ui/sonner';
import { SupabaseTokenSync } from '@/components/supabase-token-sync';

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
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('ply-theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}else if(window.matchMedia('(prefers-color-scheme: light)').matches){document.documentElement.setAttribute('data-theme','light');}else{document.documentElement.setAttribute('data-theme','dark');}}catch(e){}})();`,
          }}
        />
      </head>
      <body
        className={`${geist.variable} ${geistMono.variable} ${instrumentSerif.variable}`}
        style={{ fontFamily: 'var(--font-geist), ui-sans-serif, system-ui, sans-serif' }}
      >
        <Providers>
          <SupabaseTokenSync />
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Delete old token sync**

```bash
rm frontend/src/components/clerk-token-sync.tsx
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/layout.tsx frontend/src/components/supabase-token-sync.tsx
git rm frontend/src/components/clerk-token-sync.tsx
git commit -m "feat: remove ClerkProvider, add SupabaseTokenSync to root layout"
```

---

## Task 13: Frontend — Replace auth-form.tsx (email/password flows)

**Files:**
- Modify: `frontend/src/components/auth/auth-form.tsx`

- [ ] **Step 1: Replace the file**

Replace the full content of `frontend/src/components/auth/auth-form.tsx`:
```typescript
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { SocialButtons } from './social-buttons';
import styles from './auth.module.css';

const AFTER_AUTH = '/optimize';

function readError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Something went wrong. Please try again.';
}

export function AuthForm({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  return mode === 'sign-in' ? <SignInForm /> : <SignUpForm />;
}

/* ───────────────────────────── Sign in ───────────────────────────── */

function SignInForm() {
  const supabase = createClient();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) {
      setError(readError(err));
      setBusy(false);
    } else {
      router.push(AFTER_AUTH);
    }
  }

  return (
    <div className={styles.shell}>
      <h1 className={styles.heading}>Sign in to promptly</h1>
      <p className={styles.subhead}>Welcome back — let&apos;s optimize.</p>

      <SocialButtons mode="sign-in" />
      <div className={styles.divider}>or</div>

      <form className={styles.form} onSubmit={onSubmit}>
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.field}>
          <label className={styles.label} htmlFor="email">Email</label>
          <input
            id="email"
            className={styles.input}
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            required
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="password">Password</label>
          <input
            id="password"
            className={styles.input}
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            required
          />
        </div>
        <button className={styles.submit} type="submit" disabled={busy}>
          {busy ? <span className={styles.spinner} /> : 'Sign in'}
        </button>
      </form>

      <p className={styles.footer}>
        New to promptly?{' '}
        <Link className={styles.footerLink} href="/sign-up">
          Create account
        </Link>
      </p>
    </div>
  );
}

/* ───────────────────────────── Sign up ───────────────────────────── */

function SignUpForm() {
  const supabase = createClient();
  const router = useRouter();
  const [step, setStep] = useState<'form' | 'verify'>('form');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
      },
    });
    if (err) {
      setError(readError(err));
      setBusy(false);
    } else {
      setStep('verify');
      setBusy(false);
    }
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: 'email',
    });
    if (err) {
      setError(readError(err));
      setBusy(false);
    } else {
      router.push(AFTER_AUTH);
    }
  }

  if (step === 'verify') {
    return (
      <div className={styles.shell}>
        <h1 className={styles.heading}>Check your email</h1>
        <p className={styles.subhead}>We sent a verification code to {email}.</p>

        <form className={styles.form} onSubmit={onVerify}>
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.field}>
            <label className={styles.label} htmlFor="code">
              Verification code
            </label>
            <input
              id="code"
              className={styles.input}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={busy}
              required
            />
          </div>
          <button className={styles.submit} type="submit" disabled={busy}>
            {busy ? <span className={styles.spinner} /> : 'Verify & continue'}
          </button>
        </form>

        <p className={styles.footer}>
          <button
            type="button"
            className={styles.footerLink}
            onClick={() => {
              setStep('form');
              setError(null);
            }}
          >
            Use a different email
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <h1 className={styles.heading}>Create your account</h1>
      <p className={styles.subhead}>Four models. Three rounds. One better prompt.</p>

      <SocialButtons mode="sign-up" />
      <div className={styles.divider}>or</div>

      <form className={styles.form} onSubmit={onCreate}>
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.field}>
          <label className={styles.label} htmlFor="su-email">
            Email
          </label>
          <input
            id="su-email"
            className={styles.input}
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            required
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="su-password">
            Password
          </label>
          <input
            id="su-password"
            className={styles.input}
            type="password"
            autoComplete="new-password"
            placeholder="At least 6 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            required
          />
        </div>
        <button className={styles.submit} type="submit" disabled={busy}>
          {busy ? <span className={styles.spinner} /> : 'Create account'}
        </button>
      </form>

      <p className={styles.footer}>
        Already have an account?{' '}
        <Link className={styles.footerLink} href="/sign-in">
          Sign in
        </Link>
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/auth/auth-form.tsx
git commit -m "feat: replace Clerk auth hooks with Supabase in auth-form"
```

---

## Task 14: Frontend — Replace social-buttons.tsx (OAuth)

**Files:**
- Modify: `frontend/src/components/auth/social-buttons.tsx`

- [ ] **Step 1: Replace the file**

Replace the full content of `frontend/src/components/auth/social-buttons.tsx`:
```typescript
'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase';
import styles from './auth.module.css';

type Provider = 'google' | 'github';

export function SocialButtons({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const [busy, setBusy] = useState<Provider | null>(null);

  async function start(provider: Provider) {
    if (busy) return;
    setBusy(provider);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
      },
    });
    if (error) setBusy(null);
    // On success Supabase redirects — no need to reset busy state.
  }

  return (
    <div className={styles.social}>
      <button
        type="button"
        className={styles.socialBtn}
        disabled={busy !== null}
        onClick={() => start('google')}
      >
        <GoogleIcon />
        {busy === 'google' ? 'Connecting…' : 'Continue with Google'}
      </button>
      <button
        type="button"
        className={styles.socialBtn}
        disabled={busy !== null}
        onClick={() => start('github')}
      >
        <GitHubIcon />
        {busy === 'github' ? 'Connecting…' : 'Continue with GitHub'}
      </button>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className={styles.socialIcon} viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg className={styles.socialIcon} viewBox="0 0 16 16" fill="#141414" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/auth/social-buttons.tsx
git commit -m "feat: replace Clerk OAuth with Supabase OAuth in social-buttons"
```

---

## Task 15: Frontend — Add OAuth callback route

**Files:**
- Create: `frontend/src/app/auth/callback/route.ts`

- [ ] **Step 1: Create the route**

Create `frontend/src/app/auth/callback/route.ts`:
```typescript
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/optimize';

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          },
        },
      },
    );
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(new URL(next, request.url));
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/auth/callback/route.ts
git commit -m "feat: add Supabase OAuth callback route"
```

---

## Task 16: Frontend — Update user-menu.tsx (replace Clerk hooks)

**Files:**
- Modify: `frontend/src/components/layout/user-menu.tsx`

- [ ] **Step 1: Replace the file**

Replace the full content of `frontend/src/components/layout/user-menu.tsx`:
```typescript
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase';
import { api } from '@/lib/api';
import type { User, DashboardStats } from '@/types/api';

function deriveDisplayName(email: string): string {
  return email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
function deriveInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}
function formatMonthYear(iso: string | undefined): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : '—';
}
function formatDateTime(iso: string | undefined): string {
  return iso
    ? new Date(iso).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—';
}

function InfoRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 12 }}>
      <span style={{ color: 'var(--text-subtle)' }}>{label}</span>
      <span style={{ color: 'var(--text)', fontWeight: 500 }}>{value}</span>
    </div>
  );
}

export function UserMenu() {
  const router = useRouter();
  const supabase = createClient();
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setSupabaseUser(user));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_, session) => {
      setSupabaseUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, [supabase]);

  const { data: fetchedUser } = useQuery<User>({
    queryKey: ['user', 'me'],
    queryFn: async () => {
      const res = await api.get<{ data: User }>('/api/v1/users/me');
      return res.data.data;
    },
    staleTime: 1000 * 60 * 5,
  });

  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ['stats'],
    queryFn: async () => {
      const res = await api.get<{ data: DashboardStats }>('/api/v1/stats');
      return res.data.data;
    },
    staleTime: 1000 * 60 * 5,
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!supabaseUser && !fetchedUser) return null;

  const supabaseEmail = supabaseUser?.email ?? '';
  const fullName =
    (supabaseUser?.user_metadata?.full_name as string | undefined) ||
    (fetchedUser ? deriveDisplayName(fetchedUser.email) : supabaseEmail ? deriveDisplayName(supabaseEmail) : '');
  const initials = deriveInitials(fullName);
  const email = fetchedUser?.email ?? supabaseEmail;
  const credits = fetchedUser?.credits ?? 0;
  const optimizations = stats?.prompts_optimized ?? 0;
  const healthChecks = stats?.usage?.all_time?.health_score_calls ?? 0;

  const avatar = (size: number) => (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        background: 'linear-gradient(135deg, oklch(70% 0.18 290), oklch(75% 0.13 215))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'white',
        fontSize: size * 0.4,
        fontWeight: 600,
      }}
    >
      {initials}
    </div>
  );

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push('/sign-in');
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {open && (
        <div
          style={{
            position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, right: 0,
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
            boxShadow: 'var(--shadow-md, 0 8px 28px rgba(0,0,0,.18))',
            padding: 6, display: 'flex', flexDirection: 'column', gap: 2, zIndex: 50,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px 10px' }}>
            {avatar(34)}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {fullName}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {email}
              </div>
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', padding: '8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <InfoRow label="Credits" value={credits} />
            <InfoRow label="Optimizations" value={optimizations} />
            <InfoRow label="Health checks" value={healthChecks} />
          </div>

          <div style={{ borderTop: '1px solid var(--border)', padding: '8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <InfoRow label="Member since" value={formatMonthYear(supabaseUser?.created_at)} />
            <InfoRow label="Last sign-in" value={formatDateTime(supabaseUser?.last_sign_in_at)} />
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 4, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px', borderRadius: 6, color: 'var(--text-muted)', fontSize: 12.5, textDecoration: 'none' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
                <circle cx="8" cy="15" r="4" /><path d="M10.8 12.2L21 2M16 7l3 3M14 9l3 3" />
              </svg>
              API keys
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px', borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12.5, fontFamily: 'inherit', textAlign: 'left' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
              Sign out
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '4px', border: '1px solid transparent', borderRadius: 8, background: open ? 'var(--surface-2)' : 'transparent', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', transition: 'background .12s' }}
        onMouseEnter={(e) => { if (!open) e.currentTarget.style.background = 'var(--surface-2)'; }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = 'transparent'; }}
      >
        {avatar(28)}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {fullName}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {email}
          </div>
        </div>
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--text-subtle)" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .12s', flexShrink: 0 }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Delete the unused org-select page (Clerk-specific)**

```bash
rm -rf frontend/src/app/\(auth\)/org-select
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/layout/user-menu.tsx
git rm -r "frontend/src/app/(auth)/org-select"
git commit -m "feat: replace Clerk user hooks with Supabase session in UserMenu"
```

---

## Task 17: Frontend — TypeScript build check

- [ ] **Step 1: Run TypeScript check**

```bash
cd frontend && npm run build 2>&1 | head -60
```
Expected: build succeeds. If there are type errors, fix them before proceeding — they'll be in files that still import from `@clerk/nextjs`. Find remaining Clerk references:

```bash
grep -r "clerk" frontend/src --include="*.ts" --include="*.tsx" -l
```

Fix any remaining imports by removing the Clerk-specific usage (e.g., `isClerkAPIResponseError` in auth-form was already removed in Task 13).

- [ ] **Step 2: Commit any fixes**

```bash
git add -u frontend/src/
git commit -m "fix: resolve TypeScript errors after Clerk removal"
```

---

## Task 18: Backend — Update api_keys.py + remove Clerk webhook

**Files:**
- Modify: `qa-chatbot/src/app/api/v1/api_keys.py`
- Delete or empty: `qa-chatbot/src/app/api/v1/webhooks.py`

- [ ] **Step 1: Fix all clerk_user_id references in api_keys.py**

In `qa-chatbot/src/app/api/v1/api_keys.py`, replace all three occurrences of `current_user.clerk_user_id` with `current_user.supabase_user_id`:

```bash
sed -i 's/current_user\.clerk_user_id/current_user.supabase_user_id/g' qa-chatbot/src/app/api/v1/api_keys.py
```

Verify:
```bash
grep "clerk" qa-chatbot/src/app/api/v1/api_keys.py
```
Expected: no output.

- [ ] **Step 2: Remove the Clerk webhook handler**

Supabase Auth does not use SVIX webhooks. User provisioning is now handled on first login in `_provision_user()`. The entire Clerk webhook handler can be removed.

Replace the full content of `qa-chatbot/src/app/api/v1/webhooks.py` with an empty router placeholder (keep the file so imports don't break):
```python
from fastapi import APIRouter

router = APIRouter()
```

Check where the webhook router is mounted:
```bash
grep -n "webhook" qa-chatbot/src/app/api/router.py qa-chatbot/src/app/main.py
```

If the router is included in `router.py` or `main.py` via `include_router(webhooks.router, ...)`, that include statement can stay as-is (the router is now empty and harmless).

- [ ] **Step 3: Verify no Clerk references remain in the backend**

```bash
grep -r "clerk" qa-chatbot/src/ --include="*.py" -l
```
Expected: no output.

- [ ] **Step 4: Run the linter**

```bash
cd qa-chatbot && uv run ruff check src/app/api/v1/api_keys.py src/app/api/v1/webhooks.py
```
Expected: no issues.

- [ ] **Step 5: Commit**

```bash
git add qa-chatbot/src/app/api/v1/api_keys.py qa-chatbot/src/app/api/v1/webhooks.py
git commit -m "refactor: replace clerk_user_id with supabase_user_id in api_keys, remove Clerk webhook"
```

---

## Task 19: Authorization — Row-Level Security policies

**Files:**
- Create: `qa-chatbot/src/app/migrations/versions/<hash>_add_rls_policies.py`

- [ ] **Step 1: Generate a new migration**

```bash
cd qa-chatbot && uv run alembic revision -m "add_rls_policies"
```

- [ ] **Step 2: Edit the migration to add RLS**

Open the generated file and replace `upgrade()` and `downgrade()`:
```python
from alembic import op

TABLES_WITH_USER_DATA = [
    "chat_sessions",
    "messages",
    "prompt_versions",
    "favorite_prompts",
    "api_keys",
    "usage_events",
]


def upgrade() -> None:
    # Enable RLS — the service role key used by the backend bypasses these
    # policies automatically; they protect against direct DB access.
    op.execute("ALTER TABLE users ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY users_self ON users FOR ALL "
        "USING (supabase_user_id = auth.uid()::text)"
    )

    for table in TABLES_WITH_USER_DATA:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")

    op.execute(
        "CREATE POLICY sessions_own ON chat_sessions FOR ALL USING ("
        "  user_id = (SELECT id FROM users WHERE supabase_user_id = auth.uid()::text)"
        ")"
    )
    op.execute(
        "CREATE POLICY messages_own ON messages FOR ALL USING ("
        "  session_id IN ("
        "    SELECT cs.id FROM chat_sessions cs"
        "    JOIN users u ON cs.user_id = u.id"
        "    WHERE u.supabase_user_id = auth.uid()::text"
        "  )"
        ")"
    )
    op.execute(
        "CREATE POLICY prompt_versions_own ON prompt_versions FOR ALL USING ("
        "  user_id = (SELECT id FROM users WHERE supabase_user_id = auth.uid()::text)"
        ")"
    )
    op.execute(
        "CREATE POLICY favorites_own ON favorite_prompts FOR ALL USING ("
        "  user_id = (SELECT id FROM users WHERE supabase_user_id = auth.uid()::text)"
        ")"
    )
    op.execute(
        "CREATE POLICY api_keys_own ON api_keys FOR ALL USING ("
        "  created_by = (SELECT id FROM users WHERE supabase_user_id = auth.uid()::text)"
        ")"
    )
    op.execute(
        "CREATE POLICY usage_events_own ON usage_events FOR SELECT USING ("
        "  user_id = (SELECT id FROM users WHERE supabase_user_id = auth.uid()::text)"
        ")"
    )

    # Public read-only tables
    op.execute("ALTER TABLE templates ENABLE ROW LEVEL SECURITY")
    op.execute("CREATE POLICY templates_read ON templates FOR SELECT USING (true)")
    op.execute("ALTER TABLE prompt_categories ENABLE ROW LEVEL SECURITY")
    op.execute("CREATE POLICY categories_read ON prompt_categories FOR SELECT USING (true)")


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS categories_read ON prompt_categories")
    op.execute("ALTER TABLE prompt_categories DISABLE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS templates_read ON templates")
    op.execute("ALTER TABLE templates DISABLE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS usage_events_own ON usage_events")
    op.execute("DROP POLICY IF EXISTS api_keys_own ON api_keys")
    op.execute("DROP POLICY IF EXISTS favorites_own ON favorite_prompts")
    op.execute("DROP POLICY IF EXISTS prompt_versions_own ON prompt_versions")
    op.execute("DROP POLICY IF EXISTS messages_own ON messages")
    op.execute("DROP POLICY IF EXISTS sessions_own ON chat_sessions")
    for table in TABLES_WITH_USER_DATA:
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS users_self ON users")
    op.execute("ALTER TABLE users DISABLE ROW LEVEL SECURITY")
```

- [ ] **Step 3: Run the migration**

```bash
cd qa-chatbot && uv run alembic upgrade head
```
Expected: `Running upgrade ... -> <hash>, add_rls_policies`

- [ ] **Step 4: Commit**

```bash
git add qa-chatbot/src/app/migrations/versions/
git commit -m "feat: add Row-Level Security policies for all user-data tables"
```

---

## Task 20: End-to-end smoke test

- [ ] **Step 1: Start the full stack**

```bash
# Terminal 1
cd qa-chatbot && make infra && make dev

# Terminal 2
cd qa-chatbot && make worker

# Terminal 3
cd frontend && npm run dev
```

- [ ] **Step 2: Sign up via email**

1. Go to `http://localhost:3000/sign-up`
2. Enter an email/password and submit
3. Enter the 6-digit OTP from your email inbox
4. Verify redirect to `/optimize`

- [ ] **Step 3: Verify user was provisioned in DB**

```bash
cd qa-chatbot && uv run python -c "
import asyncio
from app.db.session import get_async_session
from sqlalchemy import text

async def check():
    async for db in get_async_session():
        result = await db.execute(text('SELECT email, supabase_user_id, credits FROM users LIMIT 5'))
        for row in result:
            print(row)
        break

asyncio.run(check())
"
```
Expected: your email appears with `credits=100`.

- [ ] **Step 4: Submit a prompt optimization**

On the `/optimize` page, enter a test prompt and submit. Verify the job completes (status goes from queued → completed).

- [ ] **Step 5: Sign out and verify redirect**

Click sign out in the user menu. Verify redirect to `/sign-in`. Verify accessing `/optimize` redirects back to `/sign-in`.

- [ ] **Step 6: Test Google/GitHub OAuth (if configured in Supabase)**

In Supabase dashboard → Authentication → Providers, enable Google/GitHub. Click "Continue with Google" and verify the OAuth flow completes and lands on `/optimize`.

- [ ] **Step 7: Final commit**

```bash
git add -u
git commit -m "chore: verify Supabase migration end-to-end"
```
