# Phase 5 — Testing & CI Design

**Date:** 2026-06-03
**Branch:** `changes-implementation` (off `main`)
**Status:** Design approved; proceeding to implement
**Roadmap:** Phase 5 of 7. Phases 1-4 complete.

---

## 1. Context (audit)

- **CI env is stale/incomplete.** `backend-ci.yml` test job sets `SECRET_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (all unused by the current app) and is **missing `OPENROUTER_API_KEY` + the four `SUPABASE_*` vars**. `frontend-ci.yml`'s e2e backend-startup has the same gap.
- **Tests override auth.** `tests/conftest.py` does `app.dependency_overrides[get_current_user] = _test_auth_override` (reads `X-Test-User-Id`). So the suite never calls `verify_supabase_token` → **dummy `SUPABASE_*` values are sufficient for CI**; LLM calls are mocked so a dummy `OPENROUTER_API_KEY` suffices.
- **e2e is broken & needs real infra.** `e2e/fixtures.ts` authenticates via removed `/api/v1/auth/register` + `/login`. Real repair needs a provisioned Supabase test project + browser login — out of reach without that infra.
- **5 residual frontend vulns** require Next 14→16 (a breaking 2-major upgrade).

**Decisions (user-approved):** quarantine e2e with a documented gap; defer the Next 14→16 upgrade as a separate effort.

---

## 2. Scope

### 2.1 Fix backend CI env (`.github/workflows/backend-ci.yml`)
Replace the test-job `env` block: drop `SECRET_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`; keep `DATABASE_URL`, `REDIS_URL`, `ENVIRONMENT: test`; add `OPENROUTER_API_KEY` and the four `SUPABASE_*` as **dummy literals** (tests override auth + mock LLMs, so no real secrets needed — makes CI self-contained):
```yaml
      OPENROUTER_API_KEY: dummy-openrouter-key
      SUPABASE_URL: https://example.supabase.co
      SUPABASE_ANON_KEY: dummy-anon-key
      SUPABASE_SERVICE_ROLE_KEY: dummy-service-role-key
      SUPABASE_JWT_SECRET: dummy-jwt-secret
```

### 2.2 Fix frontend CI backend env + quarantine the e2e job (`.github/workflows/frontend-ci.yml`)
- Keep `OPENROUTER_API_KEY`. **Unlike `backend-ci.yml`, the e2e job must use REAL `SUPABASE_*` secrets** (`SUPABASE_URL`/`ANON_KEY`/`SERVICE_ROLE_KEY`/`JWT_SECRET` via `${{ secrets.* }}`): it runs the real backend with real browser auth (no `get_current_user` override), so token verification actually calls Supabase/JWKS. The Playwright step also needs `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` so the frontend can boot (see `src/lib/env.ts`).
- ⚠️ Do **not** switch this job to dummy `SUPABASE_*` unless/until a dedicated Supabase **test project** exists — dummies would break browser auth/JWKS verification. (Dummies are correct only in `backend-ci.yml`, where pytest overrides auth.)
- **Quarantine the `e2e` job:** add a job-level guard `if: ${{ vars.RUN_E2E == 'true' }}` so it does not run by default (the `quality` job — lint/tsc/build — still gates PRs). Re-enabling is a one-line repo-variable flip once the test project exists (deferred — see `docs/superpowers/notes/2026-06-03-deferred-work.md`).

### 2.3 Quarantine the e2e specs locally
Add a skip guard to the top of each spec (`e2e/auth.spec.ts`, `credits.spec.ts`, `optimize.spec.ts`) so `npm run test:e2e` skips cleanly with a clear reason instead of failing on the removed endpoints:
```typescript
test.skip(!process.env.RUN_E2E, 'E2E requires a provisioned Supabase test project — quarantined; see docs/superpowers/notes/2026-06-03-deferred-work.md');
```
Update the `fixtures.ts` NOTE to point at the same doc.

### 2.4 Document deferred work
Create `docs/superpowers/notes/2026-06-03-deferred-work.md` tracking: (a) e2e repair (needs Supabase test project + `RUN_E2E` + CI secrets; rework fixtures to mint a real session), and (b) the Next.js 14→16 upgrade (clears 5 residual `npm audit` vulns; breaking). Also note the build-time Google-Fonts fetch (self-host font) as a Phase 6 item.

### Out of scope
The Next upgrade itself; real e2e repair; new test coverage beyond keeping the suite green; coverage-threshold changes (the 60% gate stays).

---

## 3. Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| CI still can't boot with dummy env | The local suite proves tests don't need real Supabase/LLM; dummy values satisfy required settings fields. The `quality`/`test` jobs verify on push. |
| `test.skip` guard wrong → e2e still runs broken in CI | The e2e job is also gated off via `if:`, so specs don't even execute in CI; the skip guard only matters for local `npm run test:e2e`. |
| Disabling e2e hides regressions | Backend suite (580 tests) remains the gate; the gap is documented + re-enablement is one variable flip. |

## 4. Success Criteria
- Both workflows reference only env vars the current app uses (no `SECRET_KEY`/`ANTHROPIC`/`OPENAI`); backend test job has `OPENROUTER_API_KEY` + `SUPABASE_*`.
- e2e job gated off by default (`vars.RUN_E2E`); `quality` job still runs.
- `npm run test:e2e` locally **skips** (not fails) without `RUN_E2E`.
- Backend `make test` still passes (580); ruff/mypy/eslint/tsc green.
- `docs/superpowers/notes/2026-06-03-deferred-work.md` lists e2e repair + Next upgrade + font self-host.
- (CI-green is confirmed on push — cannot be run locally.)

## 5. Next Step
writing-plans → implement (controller-side; YAML + skip guards + doc) → local verification → commit.
