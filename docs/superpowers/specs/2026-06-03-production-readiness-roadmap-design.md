# Production Readiness — Roadmap & Phase 1 Design

**Date:** 2026-06-03
**Branch:** `supbase-implementation`
**Status:** Approved roadmap (Approach A); Phase 1 design awaiting user review

---

## 1. Context & Current State

The `promptly` monorepo (`qa-chatbot/` FastAPI backend + `frontend/` Next.js 14) is a
prompt-optimization product. It is **well-architected and healthy**, not a rescue job. The
goal is to *finish and harden* it for production, with emphasis (per the user) on:

- Finishing the in-flight **Clerk → Supabase** auth cutover.
- **Unifying** the two coexisting backend architectures into one consistent pattern.
- Comprehensive cleanup of **structure, naming, and file arrangement** across the whole repo.
- **Security hardening** as the #1 priority beyond structure.

### Baseline evidence (measured 2026-06-03)

| Check | Result |
|-------|--------|
| Backend `ruff check src/` | ✅ Clean |
| Backend `mypy src/` (strict) | ⚠️ 3 trivial errors — `utils/log.py:21` (unused `type: ignore` + `no-any-return`), `db/session.py:12` (missing `dict` type args) |
| Frontend `tsc --noEmit` | ✅ Clean |
| Frontend `eslint` | ⚠️ 2 `react-hooks/exhaustive-deps` warnings (`domain-workspace.tsx:1234`, `use-job-stream.ts:173`) |
| Supabase env (real `.env` / `.env.local`) | ✅ Configured (only `.env.example` is stale) |

### Auth migration: actual state

The cutover is **~90% complete**:

- **Backend** auth is mature: `core/supabase_auth.py` verifies both ES256 (JWKS, with the
  macOS certifi fix) and legacy HS256 tokens; `dependencies.py` handles JWT Bearer **and**
  `qac_` API keys with race-safe inline user provisioning. `User` model uses
  `supabase_user_id` (no `hashed_password`). Sentry is already wired in `main.py`.
- **Frontend** is functionally on Supabase: `middleware.ts` (session refresh via `getUser()`),
  `lib/supabase.ts` + `lib/supabase-server.ts`, `auth/callback/route.ts` (OAuth code exchange
  with safe-redirect validation), `auth-form.tsx`, `social-buttons.tsx`. No `@clerk` deps.

**Remaining remnants:**
- `.env.example` still has Clerk vars **and is missing the required `SUPABASE_*` vars** → a
  fresh checkout cannot boot. (🔴 highest-impact bug in Phase 1.)
- `api/v1/webhooks.py` is a dead no-op router still wired into `main.py`.
- 2 tests reference Clerk (`test_orgs.py`, `test_domain_prompt.py`).
- Frontend Clerk-convention route naming: `(auth)/sign-in/[[...sign-in]]/`, `sign-up/[[...sign-up]]/`.
- `sso-callback/page.tsx` legacy compat shim (kept by decision — see §4).
- Stale docs: `frontend/CLAUDE.md` documents a dead custom-JWT flow; `qa-chatbot/CLAUDE.md`
  references `hashed_password`/`api_key_hash` that no longer exist.
- Vestigial `org` concept (org-scoped API keys; `org_id` always empty for JWT users) across
  ~10 files (deferred — see §4).

### Known structural inconsistencies (for later phases, not Phase 1)

- Backend mixes **horizontal layers** (`api/`, `models/`, `repositories/`, `services/`,
  `schemas/`) with **vertical slices** (`domain_prompt/`, `prompt_bridge/`, each with their own
  `api/core/data/infrastructure/workers`). Two valid patterns, inconsistently applied.
- Overlap/spread: `llm/` vs `graph/`; `workers/` exists at three levels; Alembic revisions mix
  real hashes with hand-typed ones (`a1b2c3d4e5f6`).
- ~35 stale git branches; committed/junk artifacts in the tree.

---

## 2. Goals & Non-Goals

**Goals (overall effort):** A production-ready monorepo — coherent auth, one consistent
architecture, clean naming/arrangement, hardened security, observability, green CI, deployable
artifacts, and accurate docs.

**Non-Goals:** New product features; rewriting the LangGraph optimization logic; changing the
LLM/OpenRouter provider strategy; multi-tenant org features (unless chosen in Phase 3);
branch/repo-history cleanup beyond `.gitignore` hygiene.

---

## 3. Roadmap — Approach A (Stabilize → Restructure → Harden)

Each phase is its own design → plan → implement → review cycle. Order chosen so files move
**once** (before lots of new code is added) and security/observability land in their permanent
locations.

| Phase | Title | Summary |
|-------|-------|---------|
| **1** | Baseline & Supabase Auth Cutover | Green baseline, hygiene, finish removing Clerk's footprint. *(this doc)* |
| **2** | Structure & Naming Unification | Converge on ONE backend pattern; consolidate `workers`/`llm`/`graph`; frontend conventions; Alembic hygiene. |
| **3** | Security Hardening | RLS policies, secrets handling, per-endpoint authz, input validation, CORS tightening, rate-limit review, dependency audit, **org keep/strip decision**. |
| **4** | Observability | Extend existing Sentry: structured logging coverage, error tracking, health/readiness endpoints, request tracing/correlation IDs. |
| **5** | Testing & CI | Fix stale CI env (`OPENROUTER_API_KEY` vs `ANTHROPIC/OPENAI`), green on clean checkout, coverage gates. |
| **6** | Deployment Readiness | Dockerfiles, env templates, migration runbook, config validation, graceful startup/shutdown. |
| **7** | Docs / DevX | Fill empty `qa-chatbot/README.md`, rewrite stale CLAUDE.md/READMEs, CONTRIBUTING, architecture docs. |

---

## 4. Phase 1 — Detailed Design

**Objective:** A fully green baseline with Clerk's footprint gone and auth documentation truthful.
No structural moves, no broader security work.

### A. Hygiene (Phase 0 prerequisites)
1. `git rm --cached` + delete tracked artifact `frontend/build-error.log`.
2. Delete on-disk junk: `qa-chatbot/.coverage`, `qa-chatbot/coverage.xml`,
   `qa-chatbot/test_output.log`, `.DS_Store` files.
3. Add `*.log` and `.DS_Store` to root `.gitignore` (belt-and-suspenders).
4. Remove duplicate entrypoint `qa-chatbot/main.py` (confirmed `uv init` stub printing
   "Hello from qa-chatbot!"; canonical app is `src/app/main.py`).
5. Fix the 3 mypy errors and 2 eslint warnings → **ruff + mypy + eslint + tsc all green**.

### B. Backend Clerk removal
6. 🔴 `qa-chatbot/.env.example`: remove the `# Clerk Auth` block; add the 4 required vars —
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`.
7. Delete `api/v1/webhooks.py` (dead no-op) and remove its import/registration + comment in
   `main.py` (user provisioning is inline in `dependencies.py`).
8. Fix the 2 tests referencing Clerk (`tests/integration/api/test_orgs.py`,
   `tests/integration/api/test_domain_prompt.py`).

### C. Frontend Clerk-convention removal
9. Rename `(auth)/sign-in/[[...sign-in]]/page.tsx` → `(auth)/sign-in/page.tsx`; same for
   `sign-up`. Routes still resolve to `/sign-in`, `/sign-up`. Update any internal references.
10. Keep `sso-callback/page.tsx` (decision §4) — it forwards to `/auth/callback`.

### D. Docs truth-up (auth only)
11. Rewrite the auth sections of `frontend/CLAUDE.md` (remove the dead custom-JWT flow:
    `api/auth/route.ts`, `lib/auth.ts`, `auth-store.ts`, `AuthInitializer`, `use-job-poller.ts`)
    and `qa-chatbot/CLAUDE.md` (remove `hashed_password`/`api_key_hash`). Full doc overhaul is
    Phase 7; this only deletes falsehoods about auth.

### E. Verification gate
12. `ruff`, `mypy`, `eslint`, `tsc` all green.
13. Backend test suite passes (`make test`).
14. `alembic upgrade head` applies cleanly from scratch.
15. Manual auth smoke: email sign-in, sign-up, OAuth round-trip, and protected-route redirect.
16. Review `frontend/e2e/auth.spec.ts` for Clerk-era assumptions (selectors/routes); update if it
    references removed conventions. Full e2e green is deferred to Phase 5.

### Decisions recorded
- **Org concept:** *Deferred to Phase 3* (security/authz). Phase 1 leaves org plumbing untouched.
- **sso-callback shim:** *Kept* — harmless redirect; safe if any provider redirect still targets
  `/sso-callback`.

### Out of scope for Phase 1
Structural moves (Phase 2); RLS/authz/secrets/CORS hardening (Phase 3); CI env fixes (Phase 5);
the org keep/strip decision; broad doc overhaul (Phase 7).

---

## 5. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Renaming `[[...sign-in]]` dirs breaks an internal link/import | Grep for references before/after; `tsc` + `next build` catch breakage. |
| Removing `webhooks.py` breaks an unseen integration | Confirmed no-op router with no handlers; grep usages first. |
| `.env.example` change misleads if real var names drift | Derive var names directly from `config/supabase.py`. |
| "Green baseline" hides flaky integration tests needing DB/Redis | Run full `make test` with infra up as part of the gate. |

## 6. Success Criteria (Phase 1)

- No `clerk`/`Clerk` references remain in `src`, tests, configs, or `.env.example`
  (migrations may retain historical names).
- A fresh `git clone` + `.env` from `.env.example` can boot the backend.
- `ruff`, `mypy`, `eslint`, `tsc` all green; backend tests pass; migrations apply clean.
- Auth smoke test passes manually.
- Frontend/backend CLAUDE.md auth sections accurately describe the Supabase flow.

## 7. Next Step

On approval, invoke the **writing-plans** skill to produce the Phase 1 implementation plan, then
execute. Phases 2–7 each get their own spec when reached.
