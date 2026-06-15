# Phase 3b — Authz Audit, Org-Strip & RLS Review Design

**Date:** 2026-06-03
**Branch:** `changes-implementation` (off `main`)
**Status:** Design approved (decisions set in the Phase 3 brainstorm); proceeding to plan + implementation
**Roadmap:** Phase 3 sub-phase **3b** (deeper security). Phase 1, 2, 3a complete.

---

## 1. Audit findings

- **App-level authz is solid.** Every router applies `get_current_user` per route; only `health`/`ready` are intentionally public. No missing-auth gaps. Ownership checks are present where user data is accessed (e.g. chat job/session owner checks; repos filter by user). So authz hardening here is **verification + removing the org indirection**, not adding missing guards.
- **Two API-key surfaces exist.** `api/v1/api_keys.py` (prefix `/users/api-keys`) is **user-scoped** (passes `org_id = current_user.supabase_user_id`) and is the one the **frontend** (`lib/api-keys.ts`) and the integration test call. `api/v1/orgs.py` (`/orgs/api-keys`) is an **org-scoped duplicate** that uses `current_user.org_id`, which is `""` for all JWT users — i.e. **dead/broken** and called by nothing.
- **`api_keys` model has redundant identity.** It has both an `org_id` `String(255)` column (holding the supabase_user_id, or `__no_org__`) and a `created_by` UUID FK to `users`. The unique constraint is `(org_id, name)`.
- **RLS** policies (migration `b2c3d4e5f6a7`) were reviewed and are correct; the backend bypasses RLS (decided: keep as defense-in-depth).
- **Input validation** is handled by Pydantic schemas + `RequestLimitMiddleware` (body-size cap) + per-route rate limiters — adequate.

**Decisions (from Phase 3 brainstorm):** strip org → user-scoped; RLS stays defense-in-depth; audit (not rebuild) app authz.

---

## 2. Scope

### 2.1 Delete the dead org surface
- Delete `src/app/api/v1/orgs.py`, `src/app/schemas/org.py`, `tests/integration/api/test_orgs.py`.
- Remove `orgs_router` import + `include_router(orgs_router, ...)` from `api/router.py`.

### 2.2 Remove `org_id` from the auth/user surface
- `core/user_context.py`: remove the `org_id: str` field.
- `dependencies.py`: remove `org_id=...` from both `UserContext(...)` constructions (API-key path and JWT path).
- `schemas/user.py`: remove `org_id` field; `api/v1/users.py`: remove `org_id=current_user.org_id` from the `/users/me` response build.

### 2.3 Scope API keys by user (`created_by`), drop `org_id` column
- **Migration** (new): drop `ix_api_keys_org_id`; drop the partial unique index/constraint on `(org_id, name)`; drop the `org_id` column; add a partial unique index on `(created_by, name)` for active keys (mirror the existing partial-unique pattern). *Note: a separate migration `2c00a7d1d563` already adds a partial unique index on api_keys — the new migration must drop/replace the org-based one consistently with that.*
- `models/api_key.py`: remove the `org_id` column and the `(org_id, name)` unique args; add the `(created_by, name)` unique constraint.
- `repositories/api_key_repo.py`: replace org-based methods with user-based — `list_by_org(org_id)`→`list_by_user(user_id)`, the count helper, `get_by_id_and_org(key_id, org_id)`→`get_by_id_and_user(key_id, user_id)`, `has_active_org_name(org_id, name)`→`has_active_user_name(user_id, name)` — all filtering on `ApiKey.created_by`.
- `api/v1/api_keys.py`: stop computing `org_id`; pass `created_by=user_id` to create; call the renamed repo methods with `current_user.user_id`.
- `dependencies.py` API-key auth path: stop reading `api_key.org_id` (already covered by 2.2).

### 2.4 Authz verification (light)
- Add an integration test asserting a user **cannot** read/revoke another user's API key (cross-user denial) — locks in the ownership guarantee on the now-user-scoped surface.
- Document in `qa-chatbot/CLAUDE.md` (Auth section) that the backend bypasses RLS and app-level ownership checks are the primary guard (RLS = defense-in-depth).

### Out of scope
RLS per-request enforcement (decided against); input-validation changes (adequate); the Next.js major upgrade / font self-hosting (flagged in 3a for later phases).

---

## 3. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Dropping `org_id` breaks existing api_keys rows / unique constraint | `created_by` is already populated (NOT NULL); migration drops the org index then adds `(created_by, name)`. Existing keys were unique per `(supabase_user_id≈user, name)`, so `(created_by, name)` should not collide; the migration runs against the local DB in the test gate. |
| Removing `org_id` from `UserContext` breaks a consumer | Grep shows consumers are only the org surface (being deleted) + `users.py`/`schemas.user` (being updated). Full test suite gates it. |
| Frontend regression | Frontend uses `/users/api-keys` only (unaffected); `/orgs/api-keys` is dead. |
| Migration ordering vs existing api_keys partial-unique migration | New migration `down_revision` = current head; explicitly drop the org-based index by name and the column, then create the user-based one. `alembic upgrade head` in the gate verifies. |

## 4. Success Criteria
- No `org_id`/`orgs`/`organization` references in `src` or `tests` except the historical `d8ade696985f` migration.
- `/api/v1/users/api-keys` create/list/revoke still work; new cross-user-denial test passes.
- `alembic upgrade head` applies the new migration cleanly; `api_keys` has no `org_id` column and a `(created_by, name)` unique index.
- ruff + mypy green; backend `make test` passes.
- `CLAUDE.md` documents the RLS-defense-in-depth model.
- No frontend or API-path changes for the live `/users/api-keys` surface.

## 5. Next Step
writing-plans → subagent-driven implementation (the migration + model/repo/endpoint change is one atomic, test-gated task).
