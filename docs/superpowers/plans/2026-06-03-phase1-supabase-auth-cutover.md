# Phase 1 — Baseline & Supabase Auth Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land a fully green build/lint/type baseline, remove the last of the Clerk footprint, and make the auth docs truthful — finishing the Clerk→Supabase cutover.

**Architecture:** Surgical, low-risk changes only. No file moves of app code (that's Phase 2), no new security policies (Phase 3). Each task is independently committable. The backend is FastAPI + SQLAlchemy + mypy(strict)/ruff; the frontend is Next.js 14 App Router + TypeScript + eslint.

**Tech Stack:** Python 3.12 / `uv` / `pytest` / `alembic`; Node 20 / `npm` / `tsc` / `next lint`.

---

## Conventions for every commit in this plan

- We are on branch `supbase-implementation` (a feature branch — pre-commit's "don't commit to main" guard passes).
- Stage **only** the files named in each task (`git add <exact paths>`) — the working tree contains pre-existing Supabase WIP; do not sweep unrelated files into a task's commit.
- Every commit message ends with the repo trailer:
  `-m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`
- Pre-commit runs ruff + mypy on staged `.py` files. **Task 2 (mypy green) is ordered before other backend `.py` commits** so those commits pass the hook.

## Working-tree note (read before starting)

`git status` shows ~38 modified files from the in-flight Supabase migration (e.g. `dependencies.py`, `supabase_auth.py`, several tests). Phase 1 *finishes* that migration, so its commits will legitimately include some of that WIP. **Recommended pre-flight:** review the existing diff with the user and create one checkpoint commit of the current WIP before starting Task 1, so each Phase-1 task commit is a clean delta. If the user declines, proceed but be deliberate with `git add`.

## Spec deviation (approved-spec correction)

Spec §4 B step 7 said "delete `webhooks.py` (dead no-op)". Investigation shows it is an **intentional, contract-tested placeholder** (`tests/unit/test_webhooks.py` asserts the router exists and has zero routes, guarding against shipping an unauthenticated webhook). This plan **keeps** `webhooks.py` and its test, and only rewords the comment/docstring that name "Clerk". If the user prefers full removal, delete `webhooks.py`, `tests/unit/test_webhooks.py`, the import on `main.py:14`, and `main.py:79-81`.

---

## Task 1: Repo hygiene — remove cruft, fix `.gitignore`, drop stub entrypoint

**Files:**
- Delete (tracked): `frontend/build-error.log`, `qa-chatbot/main.py`
- Delete (untracked junk, if present): `qa-chatbot/.coverage`, `qa-chatbot/coverage.xml`, `qa-chatbot/test_output.log`, any `.DS_Store`
- Modify: `.gitignore`

- [ ] **Step 1: Confirm the stub entrypoint is unreferenced**

Run:
```bash
grep -rniE "main:main|qa_chatbot\.main|from main import|import main\b" qa-chatbot/pyproject.toml qa-chatbot/Dockerfile qa-chatbot/Makefile qa-chatbot/run.sh qa-chatbot/docker-compose*.yml
```
Expected: no output (the app entrypoint is `app.main:app`; `qa-chatbot/main.py` is a `uv init` stub).

- [ ] **Step 2: Remove tracked cruft and the stub entrypoint**

Run:
```bash
git rm qa-chatbot/main.py frontend/build-error.log
```
Expected: `rm 'qa-chatbot/main.py'` and `rm 'frontend/build-error.log'`.

- [ ] **Step 3: Delete on-disk untracked junk**

Run:
```bash
rm -f qa-chatbot/.coverage qa-chatbot/coverage.xml qa-chatbot/test_output.log
find . -name .DS_Store -not -path './.git/*' -delete
```
Expected: no error (files may or may not exist).

- [ ] **Step 4: Add `*.log` to `.gitignore`**

`.DS_Store`, `.coverage`, `coverage.xml`, and `*.tsbuildinfo` are already ignored; `*.log` is not (that's how `build-error.log` got tracked). Append under the existing `# Test artefacts` block:

```gitignore
# Test artefacts
.pytest_cache/

# Logs
*.log
```

- [ ] **Step 5: Verify nothing else is newly ignored/broken**

Run:
```bash
git status --short | grep -E "build-error|main\.py|\.gitignore"
```
Expected: shows `D frontend/build-error.log`, `D qa-chatbot/main.py`, `M .gitignore`.

- [ ] **Step 6: Commit**

```bash
git add .gitignore qa-chatbot/main.py frontend/build-error.log
git commit -m "chore: remove build/coverage cruft, stub entrypoint; ignore *.log" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Backend — fix the 3 mypy(strict) errors → green

**Files:**
- Modify: `qa-chatbot/src/app/utils/log.py`
- Modify: `qa-chatbot/src/app/db/session.py`

- [ ] **Step 1: Reproduce the failures**

Run: `cd qa-chatbot && uv run mypy src/`
Expected: 3 errors — `utils/log.py:21` (`unused-ignore` + `no-any-return`), `db/session.py:12` (`type-arg`).

- [ ] **Step 2: Fix `log.py` with an explicit `cast` (removes the stale ignore)**

Replace the whole file body below the docstring so it reads:

```python
from typing import cast

import structlog


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    """Return a structlog logger. Pass __name__ so log records include the module."""
    return cast(structlog.stdlib.BoundLogger, structlog.get_logger(name))
```

(Keep the existing module docstring lines 1-14 unchanged; only the import + function change.)

- [ ] **Step 3: Fix `session.py` generic `dict` type argument**

Change line 12 from:
```python
_connect_args: dict = {"ssl": "require"} if db_settings.is_supabase else {}
```
to:
```python
_connect_args: dict[str, str] = {"ssl": "require"} if db_settings.is_supabase else {}
```

- [ ] **Step 4: Verify mypy is green**

Run: `cd qa-chatbot && uv run mypy src/`
Expected: `Success: no issues found in 200 source files`.

- [ ] **Step 5: Verify ruff still green**

Run: `cd qa-chatbot && uv run ruff check src/`
Expected: `All checks passed!`

- [ ] **Step 6: Commit**

```bash
git add qa-chatbot/src/app/utils/log.py qa-chatbot/src/app/db/session.py
git commit -m "fix(types): resolve 3 strict-mypy errors in log/session" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Frontend — fix the 2 eslint warnings → green

**Files:**
- Modify: `frontend/src/hooks/use-job-stream.ts:173`
- Modify: `frontend/src/app/(dashboard)/domain-prompts/_components/domain-workspace.tsx` (import line 3 + line 1234)

- [ ] **Step 1: Reproduce the warnings**

Run: `cd frontend && npm run lint`
Expected: 2 `react-hooks/exhaustive-deps` warnings (`domain-workspace.tsx:1234`, `use-job-stream.ts:173`).

- [ ] **Step 2: Fix `use-job-stream.ts` (supabase client is genuinely ref-stable)**

The client is held in a ref (`const supabaseRef = useRef(createClient()); const supabase = supabaseRef.current;`), so excluding it is correct. Replace line 173:
```typescript
  }, [jobId]); // supabase is stable via useRef
```
with:
```typescript
    // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase client is ref-stable (useRef)
  }, [jobId]);
```

- [ ] **Step 3: Fix `domain-workspace.tsx` by memoizing `domains`**

Add `useMemo` to the React import on line 3:
```typescript
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
```
Change line 1234 from:
```typescript
  const domains = data?.domains ?? [];
```
to:
```typescript
  const domains = useMemo(() => data?.domains ?? [], [data?.domains]);
```

- [ ] **Step 4: Verify eslint + tsc are clean**

Run: `cd frontend && npm run lint && npx tsc --noEmit`
Expected: lint prints no warnings; tsc prints nothing (exit 0).

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/hooks/use-job-stream.ts" "frontend/src/app/(dashboard)/domain-prompts/_components/domain-workspace.tsx"
git commit -m "fix(lint): resolve exhaustive-deps warnings (ref-stable client, memoized domains)" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Backend — fix `.env.example` (Clerk vars → required Supabase vars)

**Why:** `config/supabase.py` *requires* `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`. They are absent from `.env.example`, and the dead Clerk block is present — a fresh checkout cannot boot.

**Files:**
- Modify: `qa-chatbot/.env.example`

- [ ] **Step 1: Replace the Clerk block**

Replace these lines:
```bash
# Clerk Auth
CLERK_SECRET_KEY=sk_test_your-clerk-secret-key
CLERK_WEBHOOK_SECRET=whsec_your-webhook-secret
CLERK_AUTHORIZED_PARTY=http://localhost:3000
```
with:
```bash
# Supabase Auth (all four required — see src/app/config/supabase.py)
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
SUPABASE_JWT_SECRET=your-supabase-jwt-secret
```

- [ ] **Step 2: Confirm no Clerk references remain in the file**

Run: `grep -in clerk qa-chatbot/.env.example`
Expected: no output.

- [ ] **Step 3: Confirm all four required vars are present**

Run: `grep -cE "^SUPABASE_(URL|ANON_KEY|SERVICE_ROLE_KEY|JWT_SECRET)=" qa-chatbot/.env.example`
Expected: `4`.

- [ ] **Step 4: Commit**

```bash
git add qa-chatbot/.env.example
git commit -m "fix(config): replace Clerk env vars with required SUPABASE_* in .env.example" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Backend — purge "Clerk" from src comments & test fixtures (keep webhooks placeholder)

**Files:**
- Modify: `qa-chatbot/src/app/main.py:79-80` (comment wording only)
- Modify: `qa-chatbot/tests/unit/test_webhooks.py` (docstring wording only)
- Modify: `qa-chatbot/tests/integration/api/test_orgs.py` (fixture strings)
- Modify: `qa-chatbot/tests/integration/api/test_domain_prompt.py` (fixture strings)

- [ ] **Step 1: Reword the `main.py` comment to drop "Clerk"**

Replace lines 79-80:
```python
    # webhooks_router is now a no-op placeholder (Clerk removed; Supabase user
    # provisioning happens on first login in dependencies.py).
```
with:
```python
    # webhooks_router is an intentional empty placeholder for future Supabase
    # webhook handlers; user provisioning happens on first login in dependencies.py.
```

- [ ] **Step 2: Reword the `test_webhooks.py` docstring to drop "Clerk"**

Replace the module docstring (lines 1-9) with:
```python
"""Contract tests for src/app/api/v1/webhooks.py.

The previous auth provider's webhook handler was removed in the Supabase
migration — user provisioning now happens lazily in
``app.dependencies._provision_user`` on the first authenticated request, so
there is no webhook to verify. ``webhooks.py`` is kept as an intentional empty
placeholder (still mounted in ``main.py``) for future Supabase webhook handlers.
These tests pin that contract: importable router, zero routes.
"""
```

- [ ] **Step 3: Rename Clerk-flavored fixture strings in `test_orgs.py`**

Line 31: `supabase_user_id="user_test_clerk",` → `supabase_user_id="user_test_orgs",`
Line 43: `supabase_user_id="user_orgs_test_clerk",` → `supabase_user_id="user_orgs_test",`

- [ ] **Step 4: Rename Clerk-flavored fixture strings in `test_domain_prompt.py`**

Line 63: `supabase_user_id="user_domain_prompt_clerk",` → `supabase_user_id="user_domain_prompt_1",`
Line 76: `supabase_user_id="user_domain_prompt_clerk2",` → `supabase_user_id="user_domain_prompt_2",`

- [ ] **Step 5: Confirm "clerk" is gone from src and tests**

Run: `grep -rin clerk qa-chatbot/src qa-chatbot/tests --include='*.py' | grep -v migrations`
Expected: no output.

- [ ] **Step 6: Verify the webhooks contract tests still pass**

Run: `cd qa-chatbot && uv run pytest tests/unit/test_webhooks.py -v`
Expected: 2 passed.

- [ ] **Step 7: Commit**

```bash
git add qa-chatbot/src/app/main.py qa-chatbot/tests/unit/test_webhooks.py \
  qa-chatbot/tests/integration/api/test_orgs.py qa-chatbot/tests/integration/api/test_domain_prompt.py
git commit -m "chore: remove residual Clerk wording from comments and test fixtures" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Frontend — rename Clerk catch-all auth route dirs → plain pages

**Why:** `[[...sign-in]]` / `[[...sign-up]]` is Clerk's optional-catch-all convention. The pages just render `<AuthForm/>`; routes still resolve to `/sign-in` and `/sign-up`.

**Files:**
- Move: `frontend/src/app/(auth)/sign-in/[[...sign-in]]/page.tsx` → `frontend/src/app/(auth)/sign-in/page.tsx`
- Move: `frontend/src/app/(auth)/sign-up/[[...sign-up]]/page.tsx` → `frontend/src/app/(auth)/sign-up/page.tsx`

- [ ] **Step 1: Move both page files up one level (git-aware)**

Run:
```bash
git mv "frontend/src/app/(auth)/sign-in/[[...sign-in]]/page.tsx" "frontend/src/app/(auth)/sign-in/page.tsx"
git mv "frontend/src/app/(auth)/sign-up/[[...sign-up]]/page.tsx" "frontend/src/app/(auth)/sign-up/page.tsx"
```
Expected: no error.

- [ ] **Step 2: Remove the now-empty catch-all directories**

Run:
```bash
rmdir "frontend/src/app/(auth)/sign-in/[[...sign-in]]" "frontend/src/app/(auth)/sign-up/[[...sign-up]]"
```
Expected: no error (dirs are empty after the moves).

- [ ] **Step 3: Confirm no code references the catch-all paths**

Run: `grep -rn "sign-in\]\]\|sign-up\]\]\|\[\[\.\.\." frontend/src`
Expected: no output.

- [ ] **Step 4: Verify routes still build/type-check**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: build succeeds; `/sign-in` and `/sign-up` appear in the route manifest output.

- [ ] **Step 5: Commit**

```bash
git add -A "frontend/src/app/(auth)"
git commit -m "refactor(auth): replace Clerk catch-all route dirs with plain sign-in/sign-up pages" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Frontend — fix dead production auth links (`/login`→`/sign-in`, `/register`→`/sign-up`)

**Why:** `/login` and `/register` routes no longer exist; these links only "work" via an accidental middleware redirect. Real routes are `/sign-in` and `/sign-up`.

**Files:**
- Modify: `frontend/src/components/landing/nav.tsx` (lines 32, 38, 90, 96)
- Modify: `frontend/src/app/(auth)/error.tsx` (line 39)
- Modify: `frontend/src/app/docs/page.tsx` (lines 234, 329, 969)

- [ ] **Step 1: Enumerate every dead-route reference**

Run: `grep -rn "\"/login\"\|'/login'\|\"/register\"\|'/register'\|/register<\|promptly.dev/register" frontend/src`
Expected: matches in `nav.tsx`, `error.tsx`, `docs/page.tsx` (use this list to verify completeness after editing).

- [ ] **Step 2: Fix `nav.tsx` (desktop + mobile menus)**

Change all four `href` values: each `href="/login"` → `href="/sign-in"` (lines ~32, ~90) and each `href="/register"` → `href="/sign-up"` (lines ~38, ~96). Leave the visible link text ("Sign in" / the CTA) unchanged.

- [ ] **Step 3: Fix `error.tsx`**

Line 39 `href="/login"` → `href="/sign-in"`. Change the visible text on line 42 `Back to login` → `Back to sign in`.

- [ ] **Step 4: Fix `docs/page.tsx`**

Line 234 `<Link href="/register"` → `<Link href="/sign-up"`.
Line 969 `<Link href="/register"` → `<Link href="/sign-up"`.
Line 329 display copy `promptly.dev/register` → `promptly.dev/sign-up`.

- [ ] **Step 5: Verify no dead route references remain in src**

Run: `grep -rn "/login\b\|/register\b" frontend/src`
Expected: no output.

- [ ] **Step 6: Verify type-check + lint**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: tsc clean; lint shows no new warnings.

- [ ] **Step 7: Commit**

```bash
git add "frontend/src/components/landing/nav.tsx" "frontend/src/app/(auth)/error.tsx" "frontend/src/app/docs/page.tsx"
git commit -m "fix(auth): point landing/docs/error links at /sign-in and /sign-up" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Frontend — review e2e auth route references; document the Phase 5 fixture gap

**Why (scope):** Spec §4 step 16 is review-and-update *route references only*; full e2e green is Phase 5. The e2e suite cannot currently authenticate — `e2e/fixtures.ts` POSTs to `/api/v1/auth/login`, which does not exist (there is no backend auth router). That repair belongs to Phase 5.

**Files:**
- Modify: `frontend/e2e/auth.spec.ts` (lines 5, 17, 38)
- Modify: `frontend/e2e/fixtures.ts` (add a documenting note)

- [ ] **Step 1: Update the dead `/login` navigations in `auth.spec.ts`**

Change each `await page.goto('/login');` (lines 5, 17, 38) to `await page.goto('/sign-in');`. Leave selectors/assertions unchanged.

- [ ] **Step 2: Document the Phase 5 fixture gap**

At the top of `e2e/fixtures.ts`, immediately after the imports, add:
```typescript
// NOTE (Phase 5 — Testing & CI): this fixture authenticates via POST
// /api/v1/auth/login, which no longer exists after the Supabase migration.
// E2E auth must be reworked to mint a Supabase session before these specs pass.
```

- [ ] **Step 3: Verify the specs still type-check/parse**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean (these are `.ts` files included by the project).

- [ ] **Step 4: Commit**

```bash
git add frontend/e2e/auth.spec.ts frontend/e2e/fixtures.ts
git commit -m "test(e2e): update auth spec routes to /sign-in; note Phase 5 fixture rework" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Docs — truth-up the auth sections of both CLAUDE.md files

**Why:** `frontend/CLAUDE.md` documents a removed custom-JWT flow (`api/auth/route.ts`, `lib/auth.ts`, `auth-store.ts`, `AuthInitializer`, `use-job-poller.ts`); `qa-chatbot/CLAUDE.md` lists `hashed_password`/`api_key_hash` columns that no longer exist. Scope = correct auth falsehoods only (full overhaul is Phase 7).

**Files:**
- Modify: `frontend/CLAUDE.md`
- Modify: `qa-chatbot/CLAUDE.md`

- [ ] **Step 1: Replace the `### Route Groups` block in `frontend/CLAUDE.md`**

Replace the stale route list with:
```markdown
### Route Groups

```
src/app/
  (auth)/sign-in       → /sign-in   (email/password + OAuth via AuthForm)
  (auth)/sign-up       → /sign-up
  auth/callback        → OAuth code-exchange route handler (sets the session cookie)
  sso-callback         → legacy compat shim; forwards to /auth/callback
  (dashboard)/         → authenticated app (sidebar + header layout)
  (dashboard)/optimize → main prompt optimization page
```

The `(dashboard)` group is gated by `middleware.ts`; unauthenticated users are redirected to `/sign-in`.
```

- [ ] **Step 2: Replace the `### Auth Token Flow` section in `frontend/CLAUDE.md`**

Replace the entire custom-JWT description with:
```markdown
### Auth (Supabase)

Auth uses **Supabase** via `@supabase/ssr`:

- `lib/supabase.ts` — browser client (`createClient`) for client components.
- `lib/supabase-server.ts` — `createMiddlewareClient` used by `middleware.ts` to refresh
  the session cookie on every request (`supabase.auth.getUser()`).
- `app/auth/callback/route.ts` — exchanges the OAuth `?code` for a session
  (`exchangeCodeForSession`) with safe-redirect validation, then redirects to `next` (default `/optimize`).
- `components/auth/auth-form.tsx` + `social-buttons.tsx` — email/password and OAuth UI.

The axios instance in `lib/api.ts` attaches the Supabase access token as `Authorization: Bearer`
and handles 401 globally. There is **no** custom `auth_token` cookie, `auth-store`, or
`AuthInitializer` — those were removed in the Supabase migration.
```

- [ ] **Step 3: Fix the data-fetching reference in `frontend/CLAUDE.md`**

Replace any mention of `src/hooks/use-job-poller.ts` with:
```markdown
- `src/hooks/use-job-stream.ts` — streams job progress (SSE) with a polling fallback; stops on a terminal `completed`/`failed` status.
```

- [ ] **Step 4: Fix the `### Auth` section in `qa-chatbot/CLAUDE.md`**

Replace it with:
```markdown
### Auth

`get_current_user()` in `src/app/dependencies.py` accepts either a **Supabase JWT** Bearer token
or a `qac_`-prefixed API key. Supabase JWTs are verified in `core/supabase_auth.py` (ES256 via
JWKS, with HS256 fallback for legacy tokens). On first login the user row is provisioned lazily
from the verified JWT claims (`supabase_user_id`, `email`, `full_name`) — no webhook required.
Each optimization costs 10 credits (402 if insufficient); health-score and advisory cost 5 each.
```

- [ ] **Step 5: Fix the `User` row in the `### Data Models` section of `qa-chatbot/CLAUDE.md`**

Replace the `User:` bullet with:
```markdown
- **User:** `id`, `supabase_user_id`, `email`, `full_name`, `is_active`, `last_login_at`, `credits` (default 100)
```
Also remove `auth` from the API-routes table row (there is no `auth` router; routers are health, chat, prompts, templates, stats, users, favorites, api_keys, categories, openrouter, orgs, domain-prompts, prompt-bridge).

- [ ] **Step 6: Confirm no stale auth identifiers remain**

Run: `grep -rin "hashed_password\|api_key_hash\|auth-store\|AuthInitializer\|use-job-poller\|api/auth/route" frontend/CLAUDE.md qa-chatbot/CLAUDE.md`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add frontend/CLAUDE.md qa-chatbot/CLAUDE.md
git commit -m "docs: correct auth sections to reflect Supabase (remove dead custom-JWT/columns)" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Verification gate — green checks, migrations, test suite, auth smoke

**Files:** none (verification only).

- [ ] **Step 1: All four static checks green**

Run:
```bash
cd qa-chatbot && uv run ruff check src/ && uv run mypy src/
cd ../frontend && npm run lint && npx tsc --noEmit
```
Expected: ruff "All checks passed!", mypy "Success: no issues found", lint no warnings, tsc clean.

- [ ] **Step 2: Bring infra up and apply migrations**

Run: `cd qa-chatbot && make infra && make migrate`
Expected: Postgres + Redis containers healthy; `alembic upgrade head` ends at the latest revision with no errors.

- [ ] **Step 3: Run the backend test suite**

Run: `cd qa-chatbot && make test`
Expected: all tests pass (coverage report prints). If any test fails, STOP and fix before proceeding — do not weaken assertions.

- [ ] **Step 4: Frontend production build**

Run: `cd frontend && npm run build`
Expected: build succeeds; route manifest lists `/sign-in`, `/sign-up`, `/auth/callback`, `/sso-callback`.

- [ ] **Step 5: Manual auth smoke (human-run checklist)**

With backend (`make dev` + `make worker`) and frontend (`npm run dev`) running:
- [ ] Visit `/` → click "Sign in" → lands on `/sign-in` (not `/login`).
- [ ] Email sign-up creates an account and redirects to `/optimize`.
- [ ] Email sign-in for an existing user redirects to `/optimize`.
- [ ] OAuth round-trip (one provider) returns via `/auth/callback` and lands authenticated.
- [ ] Visiting `/optimize` while logged out redirects to `/sign-in`.
- [ ] Log out, then `/optimize` redirects away.

- [ ] **Step 6: Final confirmation against success criteria**

Run: `grep -rin clerk qa-chatbot/src qa-chatbot/tests frontend/src frontend/e2e qa-chatbot/.env.example | grep -v migrations`
Expected: no output. Phase 1 success criteria (spec §6) are met.

---

## Self-Review (completed by plan author)

- **Spec coverage:** §4 A (Tasks 1-3), §4 B (Tasks 4-5), §4 C (Task 6) + dead-link bonus (Task 7), §4 D (Task 9), §4 E (Task 10 incl. e2e review Task 8). ✅
- **Deviation logged:** webhooks.py kept (not deleted) with rationale + override path. ✅
- **Placeholder scan:** no TBD/TODO-as-work; the only `NOTE`/comment additions are real file content documenting a Phase-5 boundary. ✅
- **Consistency:** route names (`/sign-in`, `/sign-up`), var names (`SUPABASE_*` from `config/supabase.py`), and file paths verified against the live tree. ✅
