# API Key Pagination & Status Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add page-based pagination and status filtering to `GET /api/v1/users/api-keys`.

**Architecture:** Add `PaginatedApiKeyListResponse` schema, update `ApiKeyRepository.list_by_user` with `limit`/`offset`/`status` params, add `count_by_user`, then wire both into the route handler using `asyncio.gather` for concurrent DB calls.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async, Pydantic v2, pytest-asyncio

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/app/schemas/api_key.py` | Modify | Add `PaginatedApiKeyListResponse` |
| `src/app/repositories/api_key_repo.py` | Modify | Add `status` + pagination params to `list_by_user`; add `count_by_user` |
| `src/app/api/v1/api_keys.py` | Modify | Update `list_api_keys` handler with query params + `asyncio.gather` |
| `tests/unit/test_api_key_schemas.py` | Modify | Add tests for `PaginatedApiKeyListResponse` |
| `tests/unit/repositories/test_api_key_repo.py` | Modify | Add tests for updated `list_by_user` and new `count_by_user` |

---

## Task 1: Add `PaginatedApiKeyListResponse` schema

**Files:**
- Modify: `src/app/schemas/api_key.py`
- Test: `tests/unit/test_api_key_schemas.py`

- [ ] **Step 1: Write failing tests**

Open `tests/unit/test_api_key_schemas.py` and add these tests at the bottom:

```python
from app.schemas.api_key import PaginatedApiKeyListResponse


def test_paginated_response_computes_fields() -> None:
    resp = PaginatedApiKeyListResponse(
        page=1,
        page_size=20,
        total=47,
        total_pages=3,
        keys=[],
    )
    assert resp.page == 1
    assert resp.page_size == 20
    assert resp.total == 47
    assert resp.total_pages == 3
    assert resp.keys == []


def test_paginated_response_empty_when_no_keys() -> None:
    resp = PaginatedApiKeyListResponse(
        page=1,
        page_size=20,
        total=0,
        total_pages=0,
        keys=[],
    )
    assert resp.total == 0
    assert resp.keys == []
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd qa-chatbot && uv run pytest tests/unit/test_api_key_schemas.py -v -k "paginated"
```

Expected: `ImportError` or `FAILED` — `PaginatedApiKeyListResponse` does not exist yet.

- [ ] **Step 3: Add `PaginatedApiKeyListResponse` to the schema file**

Open `src/app/schemas/api_key.py` and append at the bottom:

```python
class PaginatedApiKeyListResponse(BaseModel):
    page: int
    page_size: int
    total: int
    total_pages: int
    keys: list[ApiKeyResponse]
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd qa-chatbot && uv run pytest tests/unit/test_api_key_schemas.py -v -k "paginated"
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/schemas/api_key.py tests/unit/test_api_key_schemas.py
git commit -m "feat: add PaginatedApiKeyListResponse schema"
```

---

## Task 2: Update `list_by_user` and add `count_by_user` in the repository

**Files:**
- Modify: `src/app/repositories/api_key_repo.py`
- Test: `tests/unit/repositories/test_api_key_repo.py`

- [ ] **Step 1: Write failing tests**

Open `tests/unit/repositories/test_api_key_repo.py` and add these tests at the bottom:

```python
@pytest.mark.asyncio
async def test_list_by_user_filters_active_only(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    repo = ApiKeyRepository(db_session)
    key = await repo.create(user_id=user.id, name="k1", key_hash=uuid.uuid4().hex + uuid.uuid4().hex)
    await repo.create(user_id=user.id, name="k2", key_hash=uuid.uuid4().hex + uuid.uuid4().hex)
    await repo.revoke(key)
    await db_session.commit()

    keys = await repo.list_by_user(user.id, status="active")
    assert len(keys) == 1
    assert keys[0].name == "k2"


@pytest.mark.asyncio
async def test_list_by_user_filters_revoked_only(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    repo = ApiKeyRepository(db_session)
    key = await repo.create(user_id=user.id, name="k1", key_hash=uuid.uuid4().hex + uuid.uuid4().hex)
    await repo.create(user_id=user.id, name="k2", key_hash=uuid.uuid4().hex + uuid.uuid4().hex)
    await repo.revoke(key)
    await db_session.commit()

    keys = await repo.list_by_user(user.id, status="revoked")
    assert len(keys) == 1
    assert keys[0].name == "k1"


@pytest.mark.asyncio
async def test_list_by_user_paginates(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    repo = ApiKeyRepository(db_session)
    for i in range(5):
        await repo.create(user_id=user.id, name=f"k{i}", key_hash=uuid.uuid4().hex + uuid.uuid4().hex)
    await db_session.commit()

    page1 = await repo.list_by_user(user.id, limit=2, offset=0)
    page2 = await repo.list_by_user(user.id, limit=2, offset=2)
    assert len(page1) == 2
    assert len(page2) == 2
    assert {k.name for k in page1}.isdisjoint({k.name for k in page2})


@pytest.mark.asyncio
async def test_count_by_user_all(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    repo = ApiKeyRepository(db_session)
    key = await repo.create(user_id=user.id, name="k1", key_hash=uuid.uuid4().hex + uuid.uuid4().hex)
    await repo.create(user_id=user.id, name="k2", key_hash=uuid.uuid4().hex + uuid.uuid4().hex)
    await repo.revoke(key)
    await db_session.commit()

    assert await repo.count_by_user(user.id, status="all") == 2


@pytest.mark.asyncio
async def test_count_by_user_active(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    repo = ApiKeyRepository(db_session)
    key = await repo.create(user_id=user.id, name="k1", key_hash=uuid.uuid4().hex + uuid.uuid4().hex)
    await repo.create(user_id=user.id, name="k2", key_hash=uuid.uuid4().hex + uuid.uuid4().hex)
    await repo.revoke(key)
    await db_session.commit()

    assert await repo.count_by_user(user.id, status="active") == 1


@pytest.mark.asyncio
async def test_count_by_user_revoked(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    repo = ApiKeyRepository(db_session)
    key = await repo.create(user_id=user.id, name="k1", key_hash=uuid.uuid4().hex + uuid.uuid4().hex)
    await repo.create(user_id=user.id, name="k2", key_hash=uuid.uuid4().hex + uuid.uuid4().hex)
    await repo.revoke(key)
    await db_session.commit()

    assert await repo.count_by_user(user.id, status="revoked") == 1
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd qa-chatbot && uv run pytest tests/unit/repositories/test_api_key_repo.py -v -k "paginate or count or filters"
```

Expected: `TypeError` — `list_by_user` doesn't accept `status`/`limit`/`offset`; `count_by_user` doesn't exist.

- [ ] **Step 3: Update the repository**

Replace the entire content of `src/app/repositories/api_key_repo.py` with:

```python
import uuid
from datetime import UTC
from datetime import datetime
from typing import Literal

from sqlalchemy import exists, func, select

from app.models.api_key import ApiKey
from app.repositories.base import BaseRepository


class ApiKeyRepository(BaseRepository[ApiKey]):
    model = ApiKey

    def _status_filter(
        self, query: object, status: Literal["active", "revoked", "all"]
    ) -> object:
        if status == "active":
            return query.where(ApiKey.is_active == True)  # noqa: E712
        if status == "revoked":
            return query.where(ApiKey.is_active == False)  # noqa: E712
        return query

    async def list_by_user(
        self,
        user_id: uuid.UUID,
        *,
        status: Literal["active", "revoked", "all"] = "all",
        limit: int = 20,
        offset: int = 0,
    ) -> list[ApiKey]:
        q = self._status_filter(
            select(ApiKey).where(ApiKey.user_id == user_id), status
        )
        q = q.order_by(ApiKey.created_at.desc()).limit(limit).offset(offset)
        result = await self.db.execute(q)
        return list(result.scalars().all())

    async def count_by_user(
        self,
        user_id: uuid.UUID,
        *,
        status: Literal["active", "revoked", "all"] = "all",
    ) -> int:
        q = self._status_filter(
            select(func.count()).select_from(ApiKey).where(ApiKey.user_id == user_id),
            status,
        )
        result = await self.db.execute(q)
        return result.scalar_one()

    async def get_by_id_and_user(self, key_id: uuid.UUID, user_id: uuid.UUID) -> ApiKey | None:
        result = await self.db.execute(
            select(ApiKey).where(ApiKey.id == key_id, ApiKey.user_id == user_id)
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

    async def has_active_name(self, user_id: uuid.UUID, name: str) -> bool:
        result = await self.db.execute(
            select(
                exists().where(
                    ApiKey.user_id == user_id,
                    ApiKey.name == name,
                    ApiKey.is_active == True,  # noqa: E712
                )
            )
        )
        return bool(result.scalar())

    async def revoke(self, key: ApiKey) -> ApiKey:
        key.is_active = False
        key.revoked_at = datetime.now(UTC)
        await self.db.flush()
        await self.db.refresh(key)
        return key
```

- [ ] **Step 4: Run all repository tests to verify they pass**

```bash
cd qa-chatbot && uv run pytest tests/unit/repositories/test_api_key_repo.py -v
```

Expected: all tests PASS (old + new).

- [ ] **Step 5: Commit**

```bash
git add src/app/repositories/api_key_repo.py tests/unit/repositories/test_api_key_repo.py
git commit -m "feat: add status filter and pagination to ApiKeyRepository"
```

---

## Task 3: Update the route handler

**Files:**
- Modify: `src/app/api/v1/api_keys.py`

- [ ] **Step 1: Replace the `list_api_keys` handler**

Open `src/app/api/v1/api_keys.py`. Make the following changes:

**Add imports** at the top of the file (after existing imports):

```python
import asyncio
import math
from typing import Literal

from app.schemas.api_key import PaginatedApiKeyListResponse
```

**Replace the `list_api_keys` function** (lines 74–88 in the current file):

```python
@router.get(
    "",
    response_model=SuccessResponse[PaginatedApiKeyListResponse],
    dependencies=[Depends(_default_limiter)],
)
async def list_api_keys(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    status: Literal["active", "revoked", "all"] = "all",
) -> SuccessResponse[PaginatedApiKeyListResponse]:
    """List API keys for the current user with pagination and optional status filter."""
    repo = ApiKeyRepository(db)
    offset = (page - 1) * page_size
    total, keys = await asyncio.gather(
        repo.count_by_user(current_user.id, status=status),
        repo.list_by_user(current_user.id, status=status, limit=page_size, offset=offset),
    )
    total_pages = math.ceil(total / page_size) if total else 0
    return SuccessResponse(
        data=PaginatedApiKeyListResponse(
            page=page,
            page_size=page_size,
            total=total,
            total_pages=total_pages,
            keys=[ApiKeyResponse.model_validate(k) for k in keys],
        )
    )
```

Also add `Query` to the FastAPI imports line:

```python
from fastapi import APIRouter, Depends, Query, status
```

- [ ] **Step 2: Run type-check to catch any issues**

```bash
cd qa-chatbot && uv run mypy src/app/api/v1/api_keys.py
```

Expected: `Success: no issues found`.

- [ ] **Step 3: Run lint**

```bash
cd qa-chatbot && uv run ruff check src/app/api/v1/api_keys.py src/app/repositories/api_key_repo.py src/app/schemas/api_key.py
```

Expected: no errors.

- [ ] **Step 4: Run full test suite**

```bash
cd qa-chatbot && uv run pytest tests/unit/ -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/api_keys.py
git commit -m "feat: paginate GET /users/api-keys with status filter"
```

---

## Task 4: Smoke-test via Swagger

- [ ] **Step 1: Start the server**

```bash
cd qa-chatbot && make dev
```

- [ ] **Step 2: Open Swagger UI**

Navigate to `http://localhost:8000/docs` and find `GET /api/v1/users/api-keys`.

- [ ] **Step 3: Verify query params are present**

The endpoint should now show `page`, `page_size`, and `status` as query parameters.

- [ ] **Step 4: Make a test call**

Authenticate and call `GET /api/v1/users/api-keys?page=1&page_size=5&status=all`.

Expected response shape:
```json
{
  "success": true,
  "data": {
    "page": 1,
    "page_size": 5,
    "total": 0,
    "total_pages": 0,
    "keys": []
  }
}
```
