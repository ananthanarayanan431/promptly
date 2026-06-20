# Admin Panel Design

**Date:** 2026-06-20
**Status:** Approved

## Overview

Add a production-quality admin panel to Promptly for the application owner. The panel is accessible only to users with `is_admin = true` in the database. It provides four views: aggregate app stats, user management, rate limit monitoring, and GlitchTip error monitoring via API integration.

---

## 1. Data Model

### Migration
Add `is_admin BOOLEAN NOT NULL DEFAULT FALSE` to the `users` table.

```sql
ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE users SET is_admin = TRUE WHERE email = 'ananthanarayanan431@gmail.com';
```

### UserContext update
Add `is_admin: bool = False` to `src/promptly/core/user_context.py`. `get_current_user()` already fetches the full DB row — it just needs to pass `is_admin` through.

### UserResponse schema update
Add `is_admin: bool` to `src/promptly/schemas/user.py` `UserResponse` so the frontend can read it from `GET /api/v1/users/me`.

---

## 2. Backend Authorization

### `require_admin` dependency
New function in `src/promptly/dependencies.py`:

```python
async def require_admin(current_user: Annotated[UserContext, Depends(get_current_user)]) -> UserContext:
    if not current_user.is_admin:
        raise ForbiddenException(detail="Admin access required")
    return current_user
```

### Admin router
New vertical slice at `src/promptly/admin/api/router.py`. The dependency is applied at the router level — not per-endpoint — so every route under `/admin` is protected automatically:

```python
router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_admin)]
)
```

---

## 3. Admin API Endpoints

All endpoints: `GET /api/v1/admin/...` — protected by `require_admin` via router-level dependency.

| Endpoint | Description |
|---|---|
| `GET /admin/stats` | Aggregate counts: total users, total chat sessions (optimizations), total tokens consumed, active users in last 7 days |
| `GET /admin/users?page=1&per_page=50` | Paginated list of all users: id, email, full_name, credits, token_balance, is_active, is_admin, last_login_at, created_at |
| `PATCH /admin/users/{id}` | Update any user: toggle is_active, toggle is_admin, set credits delta |
| `GET /admin/rate-limits` | Current rate limit hit counts per user from Redis |
| `GET /admin/errors` | Proxy to GlitchTip API — returns recent issues list (title, count, first_seen, last_seen, status) |

### GlitchTip proxy
`GET /admin/errors` calls GlitchTip's REST API from the backend using `GLITCHTIP_API_URL` + `GLITCHTIP_API_TOKEN` env vars. The token never reaches the browser — the backend authenticates to GlitchTip and forwards the sanitized response.

---

## 4. Infrastructure — GlitchTip

GlitchTip is added to `docker-compose.yml` alongside existing Postgres and Redis. It reuses the existing Postgres instance (separate `glitchtip` database) and existing Redis.

**Services added:**
- `glitchtip-web` — `glitchtip/glitchtip:latest`, port `8080`
- `glitchtip-worker` — same image, runs GlitchTip's internal Celery worker
- `glitchtip-migrate` — one-shot migration container (runs `./manage.py migrate`)

**New env vars in `qa-chatbot/.env`:**
```
GLITCHTIP_URL=http://localhost:8080
GLITCHTIP_API_URL=http://glitchtip-web:8080/api/0
GLITCHTIP_API_TOKEN=<token from GlitchTip after setup>
```

**One-time setup (after first `make infra`):**
1. Open `http://localhost:8080`, create your GlitchTip admin account
2. Create an organization + project → copy the DSN
3. Replace `SENTRY_DSN` in `qa-chatbot/.env` with the GlitchTip DSN — zero code changes needed, the Sentry SDK is fully compatible

**New env var in `frontend/.env.local`:**
```
NEXT_PUBLIC_GLITCHTIP_URL=http://localhost:8080
```
Used for the "Open in GlitchTip →" external link only.

---

## 5. Frontend

### Route
New page at `frontend/src/app/(dashboard)/admin/page.tsx`. Server component shell with client tab panel inside.

### Middleware guard
`middleware.ts` extended: if `pathname.startsWith('/admin')` and the user's `is_admin` claim is false (checked via `GET /api/v1/users/me`) → redirect to `/optimize`. Runs on the edge before the page renders.

### Sidebar
In `components/layout/sidebar.tsx`, the Account nav group conditionally renders an "Admin" link:

```tsx
{ href: '/admin', label: 'Admin', icon: 'shield' }
// Only rendered when fetchedUser?.is_admin === true
```

### Admin page layout
Single page at `/admin` with four tabs (using existing shadcn `Tabs` component):

**Tab 1 — Overview**
Four summary cards in a row: Total Users | Total Optimizations | Total Tokens Consumed | Active Users (7d). Data from `GET /api/v1/admin/stats`.

**Tab 2 — Users**
Paginated table with columns: Email | Full Name | Credits | Token Balance | Active | Admin | Last Login | Joined.
Inline row actions:
- Toggle switch for `is_active`
- Toggle switch for `is_admin`
- Credits input + "Add" button (calls `PATCH /api/v1/admin/users/{id}`)

**Tab 3 — Rate Limits**
Table: User Email | Endpoint | Hit Count | Window Start. Data from `GET /api/v1/admin/rate-limits`.

**Tab 4 — Errors**
Summary table from GlitchTip API (proxied via backend): Issue Title | Occurrences | Status | First Seen | Last Seen.
"Open in GlitchTip →" button (top right) links to `NEXT_PUBLIC_GLITCHTIP_URL` in a new tab.

---

## 6. Security

- **Backend:** `require_admin` dependency on the entire admin router is the primary security gate. A non-admin JWT cannot call any `/api/v1/admin/*` endpoint regardless of frontend state.
- **Frontend:** Middleware redirect + conditional sidebar link are UX guards only — they prevent non-admins from seeing the page, but are not security controls.
- **GlitchTip token:** Never sent to the browser. Stored only in backend env and used server-side in the proxy endpoint.

---

## 7. Files Changed / Created

### Backend (`qa-chatbot/`)
| File | Change |
|---|---|
| `migrations/versions/<hash>_add_is_admin_to_users.py` | New migration |
| `src/promptly/models/user.py` | Add `is_admin` column |
| `src/promptly/core/user_context.py` | Add `is_admin: bool` field |
| `src/promptly/schemas/user.py` | Add `is_admin` to `UserResponse` |
| `src/promptly/dependencies.py` | Add `require_admin` dependency |
| `src/promptly/admin/api/router.py` | New admin router with all 5 endpoints |
| `src/promptly/admin/__init__.py` | Package init |
| `src/promptly/config/app.py` | Add `GLITCHTIP_API_URL`, `GLITCHTIP_API_TOKEN` settings |
| `src/promptly/main.py` | Register admin router |

### Infrastructure
| File | Change |
|---|---|
| `docker-compose.yml` | Add glitchtip-web, glitchtip-worker, glitchtip-migrate services |

### Frontend (`frontend/`)
| File | Change |
|---|---|
| `src/app/(dashboard)/admin/page.tsx` | New admin page |
| `src/components/admin/stats-cards.tsx` | Overview tab component |
| `src/components/admin/users-table.tsx` | Users tab component |
| `src/components/admin/rate-limits-table.tsx` | Rate limits tab component |
| `src/components/admin/errors-table.tsx` | Errors tab component |
| `src/components/layout/sidebar.tsx` | Conditional admin nav link |
| `src/middleware.ts` | Admin route guard |
| `src/types/api.ts` | Add admin response types |
