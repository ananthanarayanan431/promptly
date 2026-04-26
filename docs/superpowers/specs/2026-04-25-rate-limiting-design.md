# Rate Limiting — Design Spec
**Date:** 2026-04-25
**Status:** Approved

---

## Problem

The existing `RateLimitMiddleware` applies a single global IP-keyed counter (100 req/60s) to every route. It has two weaknesses:

1. No route differentiation — cheap reads and expensive LLM-backed `/chat/` share the same cap.
2. No user awareness — multiple authenticated users behind the same NAT compete for one IP bucket.

---

## Solution: Layered Rate Limiting

Two layers working in sequence:

### Layer 1 — Global IP middleware (coarse guard)

`RateLimitMiddleware` in `app/core/middleware.py` is upgraded to:

- **Bypass** `/health` and `/ready` entirely (orchestrator probes should never be rate-limited).
- Apply a **tight auth bucket** (10 req/min, IP-keyed) to `POST /auth/register` and `POST /auth/login` to prevent credential stuffing and registration spam. No user identity exists at this point, so IP is the only signal.
- Keep the existing **100 req/min IP bucket** for all other routes as a coarse shield against unauthenticated floods.

### Layer 2 — Per-user per-route dependency (fine-grained)

A `RateLimiter` class lives in `app/core/rate_limit.py`. It is a callable that returns a FastAPI dependency. It keys by `user_id` + route path in Redis.

```python
class RateLimiter:
    def __init__(self, requests: int, window_seconds: int) -> None: ...
    async def __call__(self, request: Request, current_user: User = Depends(get_current_user)) -> None: ...
```

Redis key format: `rl:user:{user_id}:{route_path}`
Algorithm: sliding-window via `INCR` + `EXPIRE nx=True` (same pattern as existing middleware).

Applied as a router-level dependency:
```python
@router.post("/", dependencies=[Depends(RateLimiter(10, 60))])
```

---

## Rate Limit Table

| Endpoint | Layer 1 (IP/min) | Layer 2 (per-user/min) |
|---|---|---|
| `GET /health`, `GET /ready` | bypassed | bypassed |
| `POST /auth/register` | 10 | — |
| `POST /auth/login` | 10 | — |
| `POST /chat/` | 100 (existing) | 10 |
| `POST /prompts/{id}/health-score` | 100 (existing) | 20 |
| `POST /prompts/{id}/advisory` | 100 (existing) | 20 |
| All other routes (reads + writes) | 100 (existing) | 60 |

---

## Data Flow

```
Request
  ↓
RateLimitMiddleware (IP-keyed)
  ├─ /health, /ready → pass through immediately
  ├─ /auth/register, /auth/login → 10/min IP bucket → 429 or pass
  └─ everything else → 100/min IP bucket → 429 or pass
  ↓
Route handler begins
  ↓
get_current_user resolves JWT/API-key → User object
  ↓
RateLimiter dependency (user-keyed, route-scoped)
  └─ checks rl:user:{id}:{path} → 429 or pass
  ↓
Handler logic executes
```

---

## Error Responses

Both layers return HTTP 429 with:
- `Retry-After: <window_seconds>` header
- Layer 2 also adds `X-RateLimit-Limit` and `X-RateLimit-Remaining` headers

Response body (consistent with existing middleware):
```json
{ "detail": "Rate limit exceeded. Please slow down." }
```

---

## Configuration

`app/config/rate_limit.py` gains two new settings (env-overridable):

| Setting | Default | Purpose |
|---|---|---|
| `RATE_LIMIT_AUTH_REQUESTS` | `10` | IP limit for auth endpoints |
| `RATE_LIMIT_AUTH_WINDOW_SECONDS` | `60` | Window for auth IP limit |

Existing `RATE_LIMIT_REQUESTS` / `RATE_LIMIT_WINDOW_SECONDS` remain unchanged.

Per-route user limits (10, 20, 60) are hardcoded at the dependency call site — they are intentional product decisions, not operator configuration.

---

## Files Changed

| File | Change |
|---|---|
| `app/core/middleware.py` | Add health bypass + auth-specific IP bucket to `RateLimitMiddleware` |
| `app/core/rate_limit.py` | New — `RateLimiter` dependency class |
| `app/config/rate_limit.py` | Add `RATE_LIMIT_AUTH_REQUESTS` + `RATE_LIMIT_AUTH_WINDOW_SECONDS` |
| `app/api/v1/chat.py` | `RateLimiter(10, 60)` on `POST /` |
| `app/api/v1/prompts.py` | `RateLimiter(20, 60)` on health-score + advisory endpoints |
| `app/api/v1/users.py` | `RateLimiter(60, 60)` on all routes |
| `app/api/v1/stats.py` | `RateLimiter(60, 60)` on all routes |
| `app/api/v1/favorites.py` | `RateLimiter(60, 60)` on all routes |
| `app/api/v1/templates.py` | `RateLimiter(60, 60)` on all routes |

---

## Out of Scope

- Token-bucket or leaky-bucket algorithms (sliding window is sufficient here)
- Admin override / exemption lists
- Rate limit metrics/dashboards
- Per-tenant or plan-based limits
