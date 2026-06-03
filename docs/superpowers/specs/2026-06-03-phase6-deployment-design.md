# Phase 6 — Deployment Readiness Design

**Date:** 2026-06-03
**Branch:** `changes-implementation` (off `main`)
**Status:** Design approved (self-hosted Docker Compose; font deferred); proceeding to plan + implement
**Roadmap:** Phase 6 of 7. Phases 1-5 complete.

---

## 1. Context (audit)

- **Backend deploy is production-grade:** multi-stage `Dockerfile` (uv, non-root `appuser`, healthcheck, `entrypoint.sh` that waits for Postgres/Redis), and `docker-compose.prod.yml` with nginx + api + worker (healthchecks, resource limits, `.env.production`).
- **Frontend is NOT containerized:** no `frontend/Dockerfile`, `next.config.mjs` lacks `output: 'standalone'`, and `docker-compose.prod.yml` has no frontend service.
- **`.env.production.example` is stale/wrong:** uses `CORS_ORIGINS` (app setting is `CORS_ORIGIN`) and `SECRET_KEY` (unused), and is **missing the required `SUPABASE_*` + `OPENROUTER_API_KEY`** → a prod boot from it fails.
- **No graceful shutdown:** `main.py` `lifespan` logs `app_shutdown` but never disposes the SQLAlchemy engine or Redis pool.
- **Font:** `next/font/google` build-time fetch — **deferred** (tracked in `deferred-work.md`); means the frontend image build needs build-time internet for now.

**Decisions (user-approved):** self-hosted Docker Compose; defer the font self-host.

## 2. Scope

### 2.1 Containerize the frontend
- Add `output: 'standalone'` to `next.config.mjs` (emits a minimal self-contained server in `.next/standalone`).
- Add `frontend/Dockerfile` — multi-stage `node:20-alpine`: deps → build → runner. Runner copies `.next/standalone`, `.next/static`, `public`; runs as a non-root user; `EXPOSE 3000`; `CMD ["node", "server.js"]`; HEALTHCHECK on `/`.
- `NEXT_PUBLIC_*` vars are **baked at build time**, so the Dockerfile declares build `ARG`s (`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) → `ENV` for the build step.
- Add `.dockerignore` for the frontend (node_modules, .next, .env*).

### 2.2 Wire frontend into prod compose + nginx
- Add a `frontend` service to `docker-compose.prod.yml` (build context `../frontend`, the build ARGs, `restart: always`, healthcheck, `depends_on: api`).
- Update the nginx config to route `/api/` → `api:8000` and everything else → `frontend:3000` (frontend currently isn't proxied). Keep existing security/proxy headers.

### 2.3 Fix `.env.production.example`
Rewrite to match the real settings: `CORS_ORIGIN` (singular, real domains), `OPENROUTER_API_KEY`, the four `SUPABASE_*`, `DATABASE_URL`, `REDIS_URL`, `COUNCIL_MODELS`, rate-limit/request-hardening vars, `SENTRY_DSN`, MinIO vars, `APP_VERSION`; remove `SECRET_KEY` and any `ANTHROPIC/OPENAI`/Clerk leftovers. Mirror the dev `.env.example` structure.

### 2.4 Graceful shutdown
In `main.py` `lifespan`, after `yield`: dispose the async engine (`dispose_async_engine()` from `db/session.py`) and close the Redis pool, wrapped so shutdown never raises. Log `app_shutdown` after disposal.

### 2.5 Deploy/migration runbook
Add `docs/deployment.md`: prerequisites, env setup (`.env.production`), build (`docker compose -f docker-compose.prod.yml build`), DB migration (`alembic upgrade head` via entrypoint/one-off), bring-up order, healthcheck verification (`/api/v1/ready`), rollback (image pin + `alembic downgrade`), and the known build-time-internet caveat (font).

### Out of scope
The font self-host (deferred); k8s/helm; CI image publishing; secrets-manager integration (document env-file approach only).

## 3. Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| Frontend image build can't be verified in this sandbox (Google Fonts blocked) | Write the standard Next standalone Dockerfile; verify `next.config` via tsc/lint + compose/Dockerfile structure; document that the image build is confirmed on CI/deploy (internet) and is gated on the deferred font fix for offline builds. |
| `output: 'standalone'` changes local `npm run build` output | Standalone only adds `.next/standalone`; dev/`npm start` unaffected. tsc/lint gate. |
| nginx route change breaks API path | Keep `/api/` → api:8000 exact; test config with `nginx -t` in the plan if reachable. |
| Graceful-shutdown disposal raises and masks exit | Wrap disposal in try/except; log and continue. |

## 4. Success Criteria
- `next.config.mjs` has `output: 'standalone'`; `frontend/Dockerfile` + `.dockerignore` exist (standard standalone pattern, non-root, healthcheck, NEXT_PUBLIC build args).
- `docker-compose.prod.yml` has a `frontend` service; nginx routes `/api/`→api and rest→frontend.
- `.env.production.example` contains the real required vars (CORS_ORIGIN, SUPABASE_*, OPENROUTER_API_KEY, …) and no stale ones; valid to copy → boot.
- `lifespan` disposes engine + Redis on shutdown (best-effort).
- `docs/deployment.md` covers build/env/migrate/healthcheck/rollback + the font caveat.
- Backend ruff/mypy green, app imports, `make test` passes; frontend tsc/lint green; all YAML valid.
- *(Frontend image build verified on CI/deploy, not in this sandbox — documented.)*

## 5. Next Step
writing-plans → implement → verifiable gates + documented build caveat → commit.
