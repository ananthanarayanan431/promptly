# API Key Management — Design Spec
**Date:** 2026-04-26
**Status:** Approved

---

## Problem

The `User` model has a single `api_key_hash` column, supporting only one API key per user at a time. To enable SDK usage where a developer may want separate keys for production, staging, and testing — and be able to revoke them individually — we need multi-key support.

---

## Solution

A new `api_keys` table with dedicated endpoints under `/users/api-keys`. The existing `User.api_key_hash` column is left untouched for backward compatibility; the new auth lookup checks `api_keys` first and falls back to `User.api_key_hash`.

---

## Data Model

New table: `api_keys`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `user_id` | UUID | FK → `users.id` CASCADE DELETE | |
| `name` | VARCHAR(100) | NOT NULL | User-supplied label, e.g. "production" |
| `key_hash` | VARCHAR(64) | NOT NULL, UNIQUE, indexed | SHA-256 of raw `qac_…` key |
| `is_active` | BOOLEAN | NOT NULL, default true | False after revocation |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `revoked_at` | TIMESTAMPTZ | nullable | Set on revoke, NULL while active |

The raw key is **never stored** — only the SHA-256 hash. The raw key is returned exactly once at creation time.

---

## API Endpoints

All endpoints require JWT Bearer auth. Mounted at `/api/v1/users/api-keys`.

### `POST /users/api-keys`
Create a new API key.

**Request body:**
```json
{ "name": "production" }
```

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "production",
    "key": "qac_...",
    "created_at": "2026-04-26T00:00:00Z"
  }
}
```

`key` is only present in this response. It is never returned again.

**Errors:**
- `400` if `name` is blank or exceeds 100 characters
- `409` if the user already has an **active** key with the same name (revoked keys do not block reuse of their name)

---

### `GET /users/api-keys`
List all keys for the current user (active and revoked).

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "keys": [
      {
        "id": "uuid",
        "name": "production",
        "is_active": true,
        "created_at": "2026-04-26T00:00:00Z",
        "revoked_at": null
      }
    ]
  }
}
```

Raw key is never included.

---

### `GET /users/api-keys/{key_id}`
Get metadata for a single key.

**Response `200`:** same shape as one item in the list above.
**Errors:** `404` if key does not exist or belongs to another user.

---

### `DELETE /users/api-keys/{key_id}`
Revoke a key (soft delete).

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "production",
    "is_active": false,
    "created_at": "...",
    "revoked_at": "2026-04-26T00:00:00Z"
  }
}
```

**Errors:**
- `404` if key does not exist or belongs to another user
- `409` if key is already revoked

---

## Auth Wiring

`get_current_user` in `src/app/dependencies.py` is updated to check `api_keys` before the legacy `User.api_key_hash` column:

```
token starts with "qac_"
  → hash = hash_api_key(token)
  → look up api_keys WHERE key_hash = hash AND is_active = true
  → if found: load user from api_key.user_id → return user
  → else: fall back to User.api_key_hash (legacy path)
  → if neither: raise UnauthorizedException
```

This keeps full backward compatibility for any existing single-key users.

---

## Rate Limiting

All four new endpoints inherit the existing `_default_limiter = RateLimiter(60, 60)` pattern from the users router.

---

## Files Changed

| File | Change |
|---|---|
| `src/app/models/api_key.py` | New `ApiKey` ORM model |
| `src/app/models/__init__.py` | Export `ApiKey` |
| `src/app/repositories/api_key_repo.py` | New repo: `create`, `list_by_user`, `get_by_id`, `get_by_hash`, `revoke` |
| `src/app/schemas/api_key.py` | Pydantic schemas: `ApiKeyCreateRequest`, `ApiKeyCreatedResponse`, `ApiKeyResponse`, `ApiKeyListResponse` |
| `src/app/api/v1/api_keys.py` | New router with 4 endpoints |
| `src/app/api/v1/exceptions/api_keys.py` | `ApiKeyNotFoundException`, `ApiKeyAlreadyRevokedException`, `ApiKeyNameConflictException` |
| `src/app/api/router.py` | Include `api_keys.router` |
| `src/app/dependencies.py` | Update `get_current_user` to check `api_keys` table first |
| `alembic migration` | Create `api_keys` table |

---

## Out of Scope

- Key expiry / TTL (no `expires_at` column — keys live until explicitly revoked)
- Last-used tracking
- Per-key rate limits (keys inherit the user's limits)
- Admin endpoints to manage other users' keys
