# Rate Limiting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add layered rate limiting — a tightened global IP middleware plus a per-user per-route Redis dependency — across all FastAPI backend routes.

**Architecture:** The existing `RateLimitMiddleware` is upgraded to bypass health probes and add a tight IP bucket for auth endpoints. A new `RateLimiter` FastAPI dependency class keys by `user_id + route path` in Redis and is attached to every protected router.

**Tech Stack:** FastAPI, Redis (`redis.asyncio`), `pydantic-settings`, pytest-asyncio, httpx (for integration tests)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/app/config/rate_limit.py` | Modify | Add auth-specific IP limit settings |
| `src/app/core/rate_limit.py` | Create | `RateLimiter` dependency class |
| `src/app/core/middleware.py` | Modify | Health bypass + auth IP bucket |
| `src/app/api/v1/chat.py` | Modify | Attach `RateLimiter(10, 60)` to `POST /` |
| `src/app/api/v1/prompts.py` | Modify | Attach `RateLimiter(20, 60)` to health-score + advisory |
| `src/app/api/v1/users.py` | Modify | Attach `RateLimiter(60, 60)` to all routes |
| `src/app/api/v1/stats.py` | Modify | Attach `RateLimiter(60, 60)` to all routes |
| `src/app/api/v1/favorites.py` | Modify | Attach `RateLimiter(60, 60)` to all routes |
| `src/app/api/v1/templates.py` | Modify | Attach `RateLimiter(60, 60)` to all routes |
| `tests/unit/core/test_rate_limiter.py` | Create | Unit tests for `RateLimiter` with mocked Redis |
| `tests/unit/core/test_middleware_rate_limit.py` | Create | Unit tests for middleware upgrade |

---

## Task 1: Extend rate limit config

**Files:**
- Modify: `src/app/config/rate_limit.py`

- [ ] **Step 1: Add auth-specific settings to `RateLimitSettings`**

Replace the entire file with:

```python
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class RateLimitSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )
    RATE_LIMIT_REQUESTS: int = 100
    RATE_LIMIT_WINDOW_SECONDS: int = 60
    RATE_LIMIT_AUTH_REQUESTS: int = 10
    RATE_LIMIT_AUTH_WINDOW_SECONDS: int = 60


@lru_cache
def get_rate_limit_settings() -> RateLimitSettings:
    return RateLimitSettings()
```

- [ ] **Step 2: Commit**

```bash
git add src/app/config/rate_limit.py
git commit -m "feat: add auth-specific rate limit config settings"
```

---

## Task 2: Create `RateLimiter` dependency

**Files:**
- Create: `src/app/core/rate_limit.py`
- Create: `tests/unit/core/__init__.py`
- Create: `tests/unit/core/test_rate_limiter.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/core/__init__.py` (empty).

Create `tests/unit/core/test_rate_limiter.py`:

```python
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import Request

from app.core.rate_limit import RateLimiter
from app.models.user import User


def _make_request(path: str = "/api/v1/chat/") -> Request:
    scope = {
        "type": "http",
        "method": "POST",
        "path": path,
        "query_string": b"",
        "headers": [],
    }
    return Request(scope)


def _make_user() -> User:
    return User(id=uuid4(), email="test@test.com", credits=100, is_active=True)


@pytest.mark.asyncio
async def test_rate_limiter_passes_under_limit() -> None:
    limiter = RateLimiter(requests=10, window_seconds=60)
    request = _make_request("/api/v1/chat/")
    user = _make_user()

    mock_pipe = AsyncMock()
    mock_pipe.execute = AsyncMock(return_value=[5, True])
    mock_redis = AsyncMock()
    mock_redis.pipeline = MagicMock(return_value=mock_pipe)

    with patch.object(limiter, "_redis", mock_redis):
        # Should not raise
        await limiter(request, user)


@pytest.mark.asyncio
async def test_rate_limiter_raises_429_at_limit() -> None:
    from fastapi import HTTPException

    limiter = RateLimiter(requests=10, window_seconds=60)
    request = _make_request("/api/v1/chat/")
    user = _make_user()

    mock_pipe = AsyncMock()
    mock_pipe.execute = AsyncMock(return_value=[11, True])
    mock_redis = AsyncMock()
    mock_redis.pipeline = MagicMock(return_value=mock_pipe)

    with patch.object(limiter, "_redis", mock_redis):
        with pytest.raises(HTTPException) as exc_info:
            await limiter(request, user)

    assert exc_info.value.status_code == 429
    assert "Retry-After" in exc_info.value.headers


@pytest.mark.asyncio
async def test_rate_limiter_uses_user_id_as_key() -> None:
    limiter = RateLimiter(requests=10, window_seconds=60)
    request = _make_request("/api/v1/chat/")
    user = _make_user()

    captured_keys: list[str] = []

    async def fake_incr(key: str) -> None:
        captured_keys.append(key)

    mock_pipe = AsyncMock()
    mock_pipe.execute = AsyncMock(return_value=[1, True])
    mock_redis = AsyncMock()
    mock_redis.pipeline = MagicMock(return_value=mock_pipe)

    with patch.object(limiter, "_redis", mock_redis):
        await limiter(request, user)

    # Verify the pipeline was called (key is set inside pipeline)
    mock_pipe.incr.assert_called_once()
    key_used = mock_pipe.incr.call_args[0][0]
    assert str(user.id) in key_used
    assert "/api/v1/chat/" in key_used


@pytest.mark.asyncio
async def test_rate_limiter_exactly_at_limit_passes() -> None:
    limiter = RateLimiter(requests=10, window_seconds=60)
    request = _make_request("/api/v1/chat/")
    user = _make_user()

    mock_pipe = AsyncMock()
    mock_pipe.execute = AsyncMock(return_value=[10, True])
    mock_redis = AsyncMock()
    mock_redis.pipeline = MagicMock(return_value=mock_pipe)

    with patch.object(limiter, "_redis", mock_redis):
        # Exactly at limit should still pass (> not >=)
        await limiter(request, user)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Volumes/External/promptly/qa-chatbot && uv run pytest tests/unit/core/test_rate_limiter.py -v 2>&1 | head -30
```

Expected: `ImportError` or `ModuleNotFoundError` — `app.core.rate_limit` does not exist yet.

- [ ] **Step 3: Create `src/app/core/rate_limit.py`**

```python
from typing import Annotated, Any

import redis.asyncio as aioredis
from fastapi import Depends, HTTPException, Request

from app.config.redis import get_redis_settings
from app.dependencies import get_current_user
from app.models.user import User


class RateLimiter:
    """Per-user per-route sliding-window rate limiter used as a FastAPI dependency."""

    def __init__(self, requests: int, window_seconds: int) -> None:
        self.requests = requests
        self.window_seconds = window_seconds
        redis_settings = get_redis_settings()
        self._redis: aioredis.Redis = aioredis.from_url(
            str(redis_settings.REDIS_URL),
            encoding="utf-8",
            decode_responses=True,
        )

    async def __call__(
        self,
        request: Request,
        current_user: Annotated[User, Depends(get_current_user)],
    ) -> None:
        key = f"rl:user:{current_user.id}:{request.url.path}"
        pipe = self._redis.pipeline()
        await pipe.incr(key)
        await pipe.expire(key, self.window_seconds, nx=True)
        results: list[Any] = await pipe.execute()
        count: int = results[0]

        if count > self.requests:
            raise HTTPException(
                status_code=429,
                detail="Rate limit exceeded. Please slow down.",
                headers={"Retry-After": str(self.window_seconds)},
            )

        request.state.ratelimit_limit = self.requests
        request.state.ratelimit_remaining = max(0, self.requests - count)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Volumes/External/promptly/qa-chatbot && uv run pytest tests/unit/core/test_rate_limiter.py -v
```

Expected output:
```
tests/unit/core/test_rate_limiter.py::test_rate_limiter_passes_under_limit PASSED
tests/unit/core/test_rate_limiter.py::test_rate_limiter_raises_429_at_limit PASSED
tests/unit/core/test_rate_limiter.py::test_rate_limiter_uses_user_id_as_key PASSED
tests/unit/core/test_rate_limiter.py::test_rate_limiter_exactly_at_limit_passes PASSED
```

- [ ] **Step 5: Commit**

```bash
git add src/app/core/rate_limit.py tests/unit/core/__init__.py tests/unit/core/test_rate_limiter.py
git commit -m "feat: add per-user per-route RateLimiter dependency"
```

---

## Task 3: Upgrade `RateLimitMiddleware`

**Files:**
- Modify: `src/app/core/middleware.py`
- Create: `tests/unit/core/test_middleware_rate_limit.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/core/test_middleware_rate_limit.py`:

```python
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.middleware import RateLimitMiddleware


def _make_app_with_middleware() -> FastAPI:
    app = FastAPI()
    app.add_middleware(RateLimitMiddleware)

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/ready")
    async def ready() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/api/v1/auth/login")
    async def login() -> dict[str, str]:
        return {"token": "abc"}

    @app.post("/api/v1/auth/register")
    async def register() -> dict[str, str]:
        return {"id": "1"}

    @app.get("/api/v1/users/me")
    async def me() -> dict[str, str]:
        return {"id": "1"}

    return app


@pytest.fixture
def mock_redis_under_limit() -> MagicMock:
    mock_pipe = AsyncMock()
    mock_pipe.execute = AsyncMock(return_value=[1, True])
    mock_redis = AsyncMock()
    mock_redis.pipeline = MagicMock(return_value=mock_pipe)
    return mock_redis


@pytest.fixture
def mock_redis_over_limit() -> MagicMock:
    mock_pipe = AsyncMock()
    mock_pipe.execute = AsyncMock(return_value=[200, True])
    mock_redis = AsyncMock()
    mock_redis.pipeline = MagicMock(return_value=mock_pipe)
    return mock_redis


@pytest.fixture
def mock_redis_over_auth_limit() -> MagicMock:
    mock_pipe = AsyncMock()
    mock_pipe.execute = AsyncMock(return_value=[11, True])
    mock_redis = AsyncMock()
    mock_redis.pipeline = MagicMock(return_value=mock_pipe)
    return mock_redis


def test_health_endpoint_bypasses_rate_limit(mock_redis_over_limit: MagicMock) -> None:
    app = _make_app_with_middleware()
    with patch.object(
        RateLimitMiddleware, "_redis", mock_redis_over_limit, create=True
    ):
        client = TestClient(app, raise_server_exceptions=False)
        response = client.get("/health")
    assert response.status_code == 200


def test_ready_endpoint_bypasses_rate_limit(mock_redis_over_limit: MagicMock) -> None:
    app = _make_app_with_middleware()
    with patch.object(
        RateLimitMiddleware, "_redis", mock_redis_over_limit, create=True
    ):
        client = TestClient(app, raise_server_exceptions=False)
        response = client.get("/ready")
    assert response.status_code == 200


def test_auth_login_blocked_at_auth_limit(mock_redis_over_auth_limit: MagicMock) -> None:
    app = _make_app_with_middleware()
    with patch.object(
        RateLimitMiddleware, "_redis", mock_redis_over_auth_limit, create=True
    ):
        client = TestClient(app, raise_server_exceptions=False)
        response = client.post("/api/v1/auth/login")
    assert response.status_code == 429


def test_auth_register_blocked_at_auth_limit(mock_redis_over_auth_limit: MagicMock) -> None:
    app = _make_app_with_middleware()
    with patch.object(
        RateLimitMiddleware, "_redis", mock_redis_over_auth_limit, create=True
    ):
        client = TestClient(app, raise_server_exceptions=False)
        response = client.post("/api/v1/auth/register")
    assert response.status_code == 429


def test_normal_route_passes_under_global_limit(mock_redis_under_limit: MagicMock) -> None:
    app = _make_app_with_middleware()
    with patch.object(
        RateLimitMiddleware, "_redis", mock_redis_under_limit, create=True
    ):
        client = TestClient(app, raise_server_exceptions=False)
        response = client.get("/api/v1/users/me")
    assert response.status_code == 200
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd /Volumes/External/promptly/qa-chatbot && uv run pytest tests/unit/core/test_middleware_rate_limit.py -v 2>&1 | head -40
```

Expected: tests fail because health routes are currently not bypassed and auth routes don't get a separate bucket.

- [ ] **Step 3: Update `RateLimitMiddleware` in `src/app/core/middleware.py`**

Replace the `RateLimitMiddleware` class (lines 22–57, keep `CorrelationIdMiddleware` and `RequestLimitMiddleware` unchanged):

```python
_HEALTH_PATHS = {"/health", "/ready"}
_AUTH_PATHS = {"/api/v1/auth/login", "/api/v1/auth/register"}


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Redis-backed sliding-window rate limiter keyed by client IP.

    - /health and /ready are bypassed entirely.
    - Auth endpoints use a tight per-IP bucket (RATE_LIMIT_AUTH_REQUESTS / window).
    - All other routes share the global per-IP bucket (RATE_LIMIT_REQUESTS / window).
    """

    def __init__(self, app: Any) -> None:
        super().__init__(app)
        redis_settings = get_redis_settings()
        self._redis: aioredis.Redis = aioredis.from_url(
            str(redis_settings.REDIS_URL),
            encoding="utf-8",
            decode_responses=True,
        )

    async def dispatch(self, request: Request, call_next: Any) -> Any:
        path = request.url.path

        if path in _HEALTH_PATHS:
            return await call_next(request)

        settings = get_rate_limit_settings()
        client_ip = request.client.host if request.client else "unknown"

        if path in _AUTH_PATHS:
            limit = settings.RATE_LIMIT_AUTH_REQUESTS
            window = settings.RATE_LIMIT_AUTH_WINDOW_SECONDS
            key = f"rl:auth:{client_ip}"
        else:
            limit = settings.RATE_LIMIT_REQUESTS
            window = settings.RATE_LIMIT_WINDOW_SECONDS
            key = f"rl:{client_ip}"

        pipe = self._redis.pipeline()
        await pipe.incr(key)
        await pipe.expire(key, window, nx=True)
        results: list[int] = await pipe.execute()
        count: int = results[0]

        if count > limit:
            return JSONResponse(
                status_code=429,
                content={"detail": "Rate limit exceeded. Please slow down."},
                headers={"Retry-After": str(window)},
            )

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(limit)
        response.headers["X-RateLimit-Remaining"] = str(max(0, limit - count))
        return response
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Volumes/External/promptly/qa-chatbot && uv run pytest tests/unit/core/test_middleware_rate_limit.py -v
```

Expected:
```
tests/unit/core/test_middleware_rate_limit.py::test_health_endpoint_bypasses_rate_limit PASSED
tests/unit/core/test_middleware_rate_limit.py::test_ready_endpoint_bypasses_rate_limit PASSED
tests/unit/core/test_middleware_rate_limit.py::test_auth_login_blocked_at_auth_limit PASSED
tests/unit/core/test_middleware_rate_limit.py::test_auth_register_blocked_at_auth_limit PASSED
tests/unit/core/test_middleware_rate_limit.py::test_normal_route_passes_under_global_limit PASSED
```

- [ ] **Step 5: Commit**

```bash
git add src/app/core/middleware.py tests/unit/core/test_middleware_rate_limit.py
git commit -m "feat: upgrade RateLimitMiddleware with health bypass and auth IP bucket"
```

---

## Task 4: Apply `RateLimiter` to `/chat/` routes

**Files:**
- Modify: `src/app/api/v1/chat.py`

- [ ] **Step 1: Import `RateLimiter` and attach to `POST /`**

At the top of `src/app/api/v1/chat.py`, add the import after the existing imports:

```python
from app.core.rate_limit import RateLimiter

_chat_limiter = RateLimiter(requests=10, window_seconds=60)
```

Then modify the `POST /` endpoint decorator from:

```python
@router.post(
    "/",
    response_model=SuccessResponse[ChatJobAcceptedResponse],
    status_code=202,
)
async def create_chat(
```

to:

```python
@router.post(
    "/",
    response_model=SuccessResponse[ChatJobAcceptedResponse],
    status_code=202,
    dependencies=[Depends(_chat_limiter)],
)
async def create_chat(
```

Also add `Depends` to the imports from `fastapi` — it's already imported there, so just verify it's present.

- [ ] **Step 2: Run the full unit test suite to verify nothing broke**

```bash
cd /Volumes/External/promptly/qa-chatbot && uv run pytest tests/unit/ -v 2>&1 | tail -20
```

Expected: all existing tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/v1/chat.py
git commit -m "feat: apply per-user rate limit (10/min) to POST /chat/"
```

---

## Task 5: Apply `RateLimiter` to `/prompts/` routes

**Files:**
- Modify: `src/app/api/v1/prompts.py`

- [ ] **Step 1: Import `RateLimiter` and add limiters**

Add after the existing imports in `src/app/api/v1/prompts.py`:

```python
from fastapi import APIRouter, Depends, Query
from app.core.rate_limit import RateLimiter

_expensive_limiter = RateLimiter(requests=20, window_seconds=60)
_default_limiter = RateLimiter(requests=60, window_seconds=60)
```

(`Depends` and `APIRouter` are already imported — just add `RateLimiter`.)

- [ ] **Step 2: Attach `_expensive_limiter` to health-score and advisory**

Change the `@router.post("/health-score", ...)` decorator to:

```python
@router.post(
    "/health-score",
    response_model=SuccessResponse[PromptHealthScoreResponse],
    dependencies=[Depends(_expensive_limiter)],
)
```

Change the `@router.post("/advisory", ...)` decorator to:

```python
@router.post(
    "/advisory",
    response_model=SuccessResponse[PromptAdvisoryResponse],
    dependencies=[Depends(_expensive_limiter)],
)
```

- [ ] **Step 3: Attach `_default_limiter` to all remaining routes**

Change `@router.get("/versions", ...)` to:

```python
@router.get(
    "/versions",
    response_model=SuccessResponse[PromptFamilyListResponse],
    dependencies=[Depends(_default_limiter)],
)
```

Change `@router.post("/versions", ...)` to:

```python
@router.post(
    "/versions",
    response_model=SuccessResponse[PromptVersionCreateResponse],
    dependencies=[Depends(_default_limiter)],
)
```

Change `@router.get("/versions/{prompt_id}", ...)` to:

```python
@router.get(
    "/versions/{prompt_id}",
    response_model=SuccessResponse[PromptVersionListResponse],
    dependencies=[Depends(_default_limiter)],
)
```

Change `@router.get("/versions/{prompt_id}/diff", ...)` to:

```python
@router.get(
    "/versions/{prompt_id}/diff",
    response_model=SuccessResponse[PromptDiffResponse],
    dependencies=[Depends(_default_limiter)],
)
```

- [ ] **Step 4: Run unit tests**

```bash
cd /Volumes/External/promptly/qa-chatbot && uv run pytest tests/unit/ -v 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/prompts.py
git commit -m "feat: apply per-user rate limits to /prompts/ routes (20/min expensive, 60/min reads)"
```

---

## Task 6: Apply `RateLimiter` to remaining routes

**Files:**
- Modify: `src/app/api/v1/users.py`
- Modify: `src/app/api/v1/stats.py`
- Modify: `src/app/api/v1/favorites.py`
- Modify: `src/app/api/v1/templates.py`

- [ ] **Step 1: Update `users.py`**

Add after existing imports:

```python
from app.core.rate_limit import RateLimiter

_default_limiter = RateLimiter(requests=60, window_seconds=60)
```

Add `dependencies=[Depends(_default_limiter)]` to all three route decorators:

```python
@router.get("/me", response_model=SuccessResponse[UserResponse], dependencies=[Depends(_default_limiter)])

@router.get("/credits", response_model=SuccessResponse[CreditResponse], dependencies=[Depends(_default_limiter)])

@router.post("/credits/add", response_model=SuccessResponse[CreditResponse], dependencies=[Depends(_default_limiter)])
```

- [ ] **Step 2: Update `stats.py`**

Add after existing imports:

```python
from app.core.rate_limit import RateLimiter

_default_limiter = RateLimiter(requests=60, window_seconds=60)
```

Add `dependencies=[Depends(_default_limiter)]` to the `@router.get("")` decorator:

```python
@router.get("", response_model=SuccessResponse[DashboardStats], dependencies=[Depends(_default_limiter)])
```

- [ ] **Step 3: Update `favorites.py`**

Add after existing imports:

```python
from app.core.rate_limit import RateLimiter

_default_limiter = RateLimiter(requests=60, window_seconds=60)
```

Find all `@router.get`, `@router.post`, `@router.patch`, `@router.delete` decorators in the file and add `dependencies=[Depends(_default_limiter)]` to each one. The full list of routes in this file is:

- `@router.post("")` — like
- `@router.delete("/{favorite_id}")` — unlike
- `@router.get("")` — list favorites
- `@router.patch("/{favorite_id}")` — update favorite
- `@router.post("/{favorite_id}/use")` — record use
- `@router.get("/tags")` — list tags
- `@router.get("/status")` — check status

For each one, add `dependencies=[Depends(_default_limiter)]` inside the decorator call.

- [ ] **Step 4: Update `templates.py`**

Add after existing imports:

```python
from app.core.rate_limit import RateLimiter

_default_limiter = RateLimiter(requests=60, window_seconds=60)
```

Add `dependencies=[Depends(_default_limiter)]` to the `@router.get("")` decorator:

```python
@router.get("", response_model=SuccessResponse[TemplateListResponse], dependencies=[Depends(_default_limiter)])
```

- [ ] **Step 5: Run unit tests**

```bash
cd /Volumes/External/promptly/qa-chatbot && uv run pytest tests/unit/ -v 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/v1/users.py src/app/api/v1/stats.py src/app/api/v1/favorites.py src/app/api/v1/templates.py
git commit -m "feat: apply per-user rate limit (60/min) to users, stats, favorites, templates routes"
```

---

## Task 7: Type-check and lint

**Files:** No changes — validation only.

- [ ] **Step 1: Run mypy**

```bash
cd /Volumes/External/promptly/qa-chatbot && uv run mypy src/
```

Expected: no new errors. If mypy complains about `pipe.execute` return type, add a `# type: ignore[assignment]` comment on that line only.

- [ ] **Step 2: Run ruff**

```bash
cd /Volumes/External/promptly/qa-chatbot && uv run ruff check src/ && uv run ruff format src/
```

Expected: no errors. Fix any flagged issues.

- [ ] **Step 3: Run full test suite**

```bash
cd /Volumes/External/promptly/qa-chatbot && uv run pytest tests/unit/ -v 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 4: Commit any lint fixes (if needed)**

```bash
git add -p
git commit -m "chore: fix lint/type issues from rate limiting implementation"
```

---

## Self-Review Checklist

- [x] **Config task (Task 1):** adds `RATE_LIMIT_AUTH_REQUESTS` and `RATE_LIMIT_AUTH_WINDOW_SECONDS` ✓
- [x] **`RateLimiter` class (Task 2):** keys by `user_id + path`, INCR+EXPIRE pipeline, raises `HTTPException(429)` ✓
- [x] **Middleware upgrade (Task 3):** health bypass, auth bucket, global bucket; all three have tests ✓
- [x] **`/chat/` (Task 4):** `RateLimiter(10, 60)` on `POST /` ✓
- [x] **`/prompts/` (Task 5):** `RateLimiter(20, 60)` on health-score + advisory; `RateLimiter(60, 60)` on versions ✓
- [x] **`/users/`, `/stats/`, `/favorites/`, `/templates/` (Task 6):** `RateLimiter(60, 60)` on all routes ✓
- [x] **`/health`, `/ready` (Task 3):** bypassed in middleware, no per-user dependency ✓
- [x] **Type names consistent:** `RateLimiter` used in Task 2 and referenced identically in Tasks 4–6 ✓
- [x] **No placeholders or TBDs** ✓
