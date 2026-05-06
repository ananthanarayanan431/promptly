# API Key List — Pagination & Status Filter

**Date:** 2026-04-26
**Scope:** `GET /api/v1/users/api-keys`

---

## Goal

Add page-based pagination and status filtering to the API key list endpoint so clients can efficiently browse large key sets without fetching everything at once.

---

## Query Parameters

| Param | Type | Default | Constraints |
|-------|------|---------|-------------|
| `page` | int | `1` | ≥ 1 |
| `page_size` | int | `20` | 1–100 |
| `status` | `"active" \| "revoked" \| "all"` | `"all"` | — |

Invalid values (e.g. `page=0`, `page_size=200`) return HTTP 422 via FastAPI's built-in validation.

---

## Response Shape

Replace `ApiKeyListResponse` with `PaginatedApiKeyListResponse`:

```json
{
  "success": true,
  "data": {
    "page": 1,
    "page_size": 20,
    "total": 47,
    "total_pages": 3,
    "keys": [ ...ApiKeyResponse... ]
  }
}
```

---

## Repository (`api_key_repo.py`)

### `list_by_user` — updated signature

```python
async def list_by_user(
    self,
    user_id: uuid.UUID,
    *,
    status: Literal["active", "revoked", "all"] = "all",
    limit: int = 20,
    offset: int = 0,
) -> list[ApiKey]
```

Applies `WHERE is_active = true/false` when `status` is not `"all"`. Orders by `created_at DESC`.

### `count_by_user` — new method

```python
async def count_by_user(
    self,
    user_id: uuid.UUID,
    *,
    status: Literal["active", "revoked", "all"] = "all",
) -> int
```

Same filter logic as `list_by_user`, runs `SELECT COUNT(*)`.

---

## Route (`api/v1/api_keys.py`)

The handler calls both DB methods concurrently via `asyncio.gather`, then assembles the response:

```python
total, keys = await asyncio.gather(
    repo.count_by_user(current_user.id, status=status),
    repo.list_by_user(current_user.id, status=status, limit=page_size, offset=(page - 1) * page_size),
)
total_pages = math.ceil(total / page_size) if total else 0
```

---

## Schema (`schemas/api_key.py`)

- Keep `ApiKeyListResponse` for backwards compatibility if used elsewhere; add `PaginatedApiKeyListResponse` alongside it.
- The route's `response_model` switches to `SuccessResponse[PaginatedApiKeyListResponse]`.

---

## Files Changed

| File | Change |
|------|--------|
| `src/app/schemas/api_key.py` | Add `PaginatedApiKeyListResponse` |
| `src/app/repositories/api_key_repo.py` | Update `list_by_user`, add `count_by_user` |
| `src/app/api/v1/api_keys.py` | Update `list_api_keys` handler + imports |

No migration needed — no schema changes.
