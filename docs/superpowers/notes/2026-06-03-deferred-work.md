# Deferred Work — Production-Readiness Tracked Follow-ups

Captured 2026-06-03 during the production-readiness effort. These were deliberately
scoped out of their phase and need their own focused efforts.

## 1. E2E suite repair (Phase 5 — quarantined)

**State:** `frontend/e2e/*.spec.ts` are quarantined — each `test.beforeEach` calls
`test.skip(!process.env.RUN_E2E, …)`, and the CI `e2e` job is gated by
`if: ${{ vars.RUN_E2E == 'true' }}` (off by default). The `quality` job (lint/tsc/build)
still runs and gates PRs; the backend suite (580 tests) is the primary safety net.

**Why:** `e2e/fixtures.ts` authenticates via `POST /api/v1/auth/register` + `/login`,
which no longer exist after the Supabase migration. The browser-driven flow needs a real
Supabase session.

**To re-enable:**
1. Provision a Supabase **test project** (or a dedicated test pool in the existing project).
2. Add CI secrets/vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, a test
   user credential, and set the `RUN_E2E` repo variable to `true`.
3. Rework `e2e/fixtures.ts` to mint a real session — either sign in through the UI, or call
   `supabase.auth.signInWithPassword` / the admin API to create a user + obtain an access token,
   then seed it into the browser context (cookie/localStorage) the app expects.
4. Run locally with `RUN_E2E=1 npm run test:e2e` to confirm before flipping CI.

## 2. Next.js 14 → 16 upgrade (Phase 5 — deferred)

**State:** Frontend pinned at `next@14.2.35`. `npm audit` reports **5 residual vulns
(4 high, 1 moderate)** in Next's bundled `postcss`/`glob`, fixable only via
`npm audit fix --force` → `next@16` (a breaking 2-major jump). These are build/dev-chain
issues, not runtime-critical, so the upgrade was deferred to a focused migration.

**To do:** Treat as a dedicated migration — upgrade Next + eslint-config-next, work through
App Router / config breaking changes across 14→15→16, and re-verify `lint`/`tsc`/`build` +
a manual UI pass. Budget real time; it can break layouts/routing.

## 3. Self-host the brand font (Phase 6 — deployment robustness)

`frontend/src/app/layout.tsx` uses `next/font/google` (`Instrument_Serif`), which **fetches
from Google Fonts at build time**. This fails in network-restricted build/CI/Docker
environments (`FetchError: request to https://fonts.googleapis.com/... failed`). GitHub-hosted
runners have internet so CI is fine, but a hardened/offline Docker build will fail.

**Fix (Phase 6):** download the font and switch to `next/font/local` so builds have no
external network dependency.
