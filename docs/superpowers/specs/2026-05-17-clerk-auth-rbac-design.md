# Clerk Auth + RBAC Migration Design
**Date:** 2026-05-17
**Status:** Approved for implementation

---

## Overview

Replace the current homegrown JWT + bcrypt auth system with Clerk for authentication and authorization. Add org-level RBAC with three roles (Owner, Admin, Collaborator) and per-tool permissions across four features. Preserve the `qac_` API key system as an org-scoped credential.

---

## Roles & Permissions

### Roles (defined in Clerk dashboard)

| Role | Clerk name | Capabilities |
|---|---|---|
| Owner | `org:owner` | Everything — billing, delete org, manage admins, create API keys |
| Admin | `org:admin` | Manage collaborators, assign tool permissions, create API keys |
| Collaborator | `org:collaborator` | Use only tools granted by admin |

### Permissions (defined in Clerk dashboard)

| Permission | Clerk name | Default assignment |
|---|---|---|
| General Optimization | `org:optimize:general` | Owner + Admin always; Collaborator by admin grant |
| PDO | `org:optimize:pdo` | Owner + Admin always; Collaborator by admin grant |
| Bridge | `org:optimize:bridge` | Owner + Admin always; Collaborator by admin grant |
| Analyse & Health Score | `org:analyze` | All roles — cannot be revoked |

---

## Architecture

```
Next.js Frontend
  Clerk SDK (useOrganization, useUser, useAuth)
  middleware.ts → route protection by role
  Components → show/hide by permissions
        ↓ JWT (httpOnly cookie, 60s lifetime) OR qac_ API key
FastAPI Backend
  get_current_user() → Clerk SDK verifies JWT
  require_role() → checks org_role claim
  require_permission() → checks org_permissions claim
  require_api_key() → hashes key, checks DB, loads org context
        ↓
  PostgreSQL (credits, api_keys, user mirror)
  Clerk API (orgs, roles, permissions, users)
```

### JWT payload (Clerk-issued, RS256)

```json
{
  "iss": "https://your-app.clerk.accounts.dev",
  "sub": "user_abc123",
  "aud": "your-app-id",
  "iat": 1716000000,
  "exp": 1716000060,
  "nbf": 1716000000,
  "jti": "unique-token-id",
  "sid": "sess_xyz",
  "org_id": "org_xyz",
  "org_role": "org:admin",
  "org_permissions": ["org:optimize:general", "org:optimize:pdo", "org:analyze"],
  "azp": "https://your-frontend.com"
}
```

Credits are NOT in the JWT — always read fresh from Postgres.

---

## Database Changes

### Users table

Remove: `hashed_password`, `api_key_hash` (legacy), `is_superuser`
Add: `clerk_user_id VARCHAR UNIQUE`

```sql
users:
  id              UUID PK
  clerk_user_id   VARCHAR UNIQUE  -- "user_abc123"
  email           VARCHAR UNIQUE
  full_name       VARCHAR
  credits         INTEGER DEFAULT 100
  is_active       BOOLEAN DEFAULT TRUE
  last_login_at   TIMESTAMP
  created_at      TIMESTAMP
  updated_at      TIMESTAMP
```

### API Keys table (org-scoped, replaces user-scoped)

```sql
api_keys:
  id              UUID PK
  org_id          VARCHAR        -- Clerk org_id
  key_hash        VARCHAR UNIQUE -- SHA-256 of qac_ key
  name            VARCHAR
  created_by      UUID FK→users
  is_active       BOOLEAN DEFAULT TRUE
  last_used_at    TIMESTAMP
  created_at      TIMESTAMP
  updated_at      TIMESTAMP
```

No Organization table needed — org data lives in Clerk.

---

## Backend Changes

### Removed
- `src/app/core/security.py` — all password hashing + JWT creation/decoding functions
- `src/app/config/auth.py` — SECRET_KEY, ALGORITHM, token expiry settings
- `src/app/api/v1/auth.py` — register, login, refresh endpoints
- `src/app/schemas/auth.py` — UserCreate, Token, RefreshRequest

### Added
- `src/app/core/clerk.py` — Clerk SDK client + `verify_token()`
- `src/app/config/clerk.py` — CLERK_SECRET_KEY, CLERK_WEBHOOK_SECRET, CLERK_AUTHORIZED_PARTY
- `src/app/api/v1/webhooks.py` — `POST /webhooks/clerk` (user sync)
- `src/app/api/v1/orgs.py` — org API key CRUD + member permission management

### Updated
- `src/app/dependencies.py` — `get_current_user()` uses Clerk JWT verification; API key path loads org context
- `src/app/models/user.py` — add `clerk_user_id`, remove `hashed_password`, `api_key_hash`, `is_superuser`
- `src/app/models/api_key.py` — replace `user_id` FK with `org_id` VARCHAR
- `src/app/api/v1/chat.py` — add `require_permission("org:optimize:general")`
- `src/app/api/v1/users.py` — remove password-related endpoints
- `src/app/main.py` — remove anonymous user seed, add webhook route, remove AUTH_ENABLED bypass

### New FastAPI dependencies

```python
async def get_current_user(request: Request, db: AsyncSession) -> UserContext:
    # Extracts JWT or qac_ key from Authorization header
    # JWT path: clerk.verify_token() → cryptographic check, no DB hit for identity
    # API key path: hash → DB lookup → load org_id, resolve org permissions from Clerk
    # Returns UserContext(user, org_id, role, permissions)

async def require_role(*roles: str):
    # Checks UserContext.role against allowed roles
    # Raises 403 if not matched

async def require_permission(permission: str):
    # Checks permission in UserContext.permissions
    # Raises 403 if not present
```

### New API routes

```
POST   /webhooks/clerk                          # Clerk webhook — user created/deleted sync
GET    /api/v1/orgs/me                          # Current org info + member permissions
POST   /api/v1/orgs/api-keys                    # Owner/Admin create org API key
GET    /api/v1/orgs/api-keys                    # Owner/Admin list org API keys
DELETE /api/v1/orgs/api-keys/{id}              # Owner/Admin revoke API key
PUT    /api/v1/orgs/members/{clerk_user_id}/permissions  # Admin assign tool permissions
```

### Route permission map

```
POST /api/v1/chat/                → org:optimize:general
POST /api/v1/chat/pdo             → org:optimize:pdo
POST /api/v1/chat/bridge          → org:optimize:bridge
GET  /api/v1/prompts/health       → org:analyze (all members)
POST /api/v1/orgs/api-keys        → org:admin OR org:owner
PUT  /api/v1/orgs/members/*/permissions → org:admin OR org:owner
```

---

## Frontend Changes

### Removed
- `src/app/(auth)/login/page.tsx` — replaced by Clerk's `<SignIn />`
- `src/app/(auth)/register/page.tsx` — replaced by Clerk's `<SignUp />`
- `src/app/api/auth/route.ts` — cookie management replaced by Clerk
- `src/lib/auth.ts` — setToken, clearToken, getToken
- `src/stores/auth-store.ts` — Zustand auth store (Clerk SDK replaces this)
- `src/components/auth-initializer.tsx` — hydration replaced by Clerk provider

### Added
- `src/app/(auth)/sign-in/[[...sign-in]]/page.tsx` — Clerk `<SignIn />` component
- `src/app/(auth)/sign-up/[[...sign-up]]/page.tsx` — Clerk `<SignUp />` with Google + GitHub OAuth
- `src/app/(auth)/org-select/page.tsx` — org switcher for users in multiple orgs
- `src/components/permission-gate.tsx` — wrapper component: renders children only if user has permission
- `src/hooks/use-permissions.ts` — `hasPermission(perm)`, `hasRole(role)` helpers

### Updated
- `src/middleware.ts` — replace custom cookie check with `clerkMiddleware()`
- `src/app/layout.tsx` — wrap in `<ClerkProvider>`
- `src/lib/api.ts` — axios interceptor uses `await auth.getToken()` from Clerk instead of Zustand
- `src/types/api.ts` — add org, role, permissions types

### Route protection

```
/                          → public
/sign-in, /sign-up         → public (Clerk hosted)
/dashboard/*               → any authenticated org member
/dashboard/optimize        → org:optimize:general
/dashboard/pdo             → org:optimize:pdo
/dashboard/bridge          → org:optimize:bridge
/dashboard/analyze         → all members
/settings/members          → org:admin or org:owner
/settings/api-keys         → org:admin or org:owner
/admin/*                   → org:owner only
```

### UI adapts by permission

```typescript
const { membership } = useOrganization()
const permissions = membership?.permissions ?? []

{permissions.includes('org:optimize:general') && <GeneralOptimizer />}
{permissions.includes('org:optimize:pdo') && <PDOOptimizer />}
{permissions.includes('org:optimize:bridge') && <BridgeOptimizer />}
<AnalyzeHealth />  {/* always visible */}

{['org:admin', 'org:owner'].includes(membership?.role) && <ManageMembersButton />}
```

---

## Local Development

Clerk provides a free dev instance. No bypass needed — dev instance works fully locally with internet.

```bash
# qa-chatbot/.env
CLERK_SECRET_KEY=sk_test_...
CLERK_WEBHOOK_SECRET=whsec_...
CLERK_AUTHORIZED_PARTY=http://localhost:3000

# frontend/.env.local
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/dashboard
```

Webhooks locally: use Clerk dashboard's built-in tunnel (no ngrok needed).

---

## OAuth Providers

- Google OAuth — enable in Clerk dashboard (one toggle, no credentials needed)
- GitHub OAuth — enable in Clerk dashboard (one toggle, no credentials needed)
- LinkedIn — deferred to later

---

## Migration Strategy (Fresh Start)

1. Drop and recreate users + api_keys tables via new Alembic migration
2. All existing users must re-register via Clerk (pre-production, acceptable)
3. You (the owner) create the first org in Clerk dashboard after deploy
4. Set yourself as Owner in Clerk dashboard

---

## Security Properties

| Property | Mechanism |
|---|---|
| Token forgery prevention | RS256 asymmetric signing — only Clerk can sign |
| Token theft mitigation | 60s expiry, silent refresh by Clerk SDK |
| XSS protection | httpOnly session cookie managed by Clerk |
| Cross-app token misuse | `iss` + `aud` + `azp` verified on every request |
| Session revocation | Kill session in Clerk dashboard → `sid` invalidated |
| Credits accuracy | Never in JWT — fresh Postgres read on every request |
| API key security | SHA-256 hashed in DB, org-scoped, revocable per key |
