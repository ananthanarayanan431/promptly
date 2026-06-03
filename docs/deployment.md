# Deployment Runbook (self-hosted Docker Compose)

Production runs as Docker Compose: **nginx** (TLS + routing) → **frontend** (Next.js
standalone, :3000) + **api** (FastAPI, :8000) + **worker** (Celery), backed by **postgres**
(pgvector) and **redis**. Compose file: `qa-chatbot/docker-compose.prod.yml`.

## 1. Prerequisites
- Docker + Docker Compose v2 on the host.
- TLS certs at `qa-chatbot/docker/nginx/certs/{fullchain.pem,privkey.pem}`.
- A Supabase project (URL, anon key, service-role key, JWT secret) and an OpenRouter API key.
- **Build-time internet** (the frontend build fetches a Google Font until it's self-hosted —
  see `docs/superpowers/notes/2026-06-03-deferred-work.md`).

## 2. Configure env
```bash
cd qa-chatbot
cp .env.production.example .env.production   # fill in real secrets (NEVER commit this)
```
`.env.production` is the `env_file` for api/worker. The **frontend image build args**
(`NEXT_PUBLIC_*`) are read by compose via `${VAR}` interpolation from the shell or a `.env`
beside the compose file — export them before building:
```bash
export NEXT_PUBLIC_API_URL=https://yourdomain.com
export NEXT_PUBLIC_SUPABASE_URL=https://your-ref.supabase.co
export NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
export POSTGRES_PASSWORD=... REDIS_PASSWORD=...
```

## 3. Build
```bash
docker compose -f docker-compose.prod.yml build
```

## 4. Migrate the database
The api entrypoint waits for Postgres/Redis. Run migrations as a one-off before serving:
```bash
docker compose -f docker-compose.prod.yml run --rm api alembic upgrade head
```

## 5. Bring up
```bash
docker compose -f docker-compose.prod.yml up -d
```
Compose starts postgres/redis (healthchecked) → api/worker/frontend → nginx.

## 6. Verify
```bash
# Liveness + readiness (DB + Redis):
curl -fsS https://yourdomain.com/api/v1/health   # {"status":"ok","version":"..."}
curl -fsS https://yourdomain.com/api/v1/ready    # {"status":"ready","checks":{...}}
docker compose -f docker-compose.prod.yml ps      # all services healthy
```
`/api/v1/health` returns the deployed `APP_VERSION` — confirm the expected build.

## 7. Rollback
- **App:** redeploy the previous image tag/commit (`git checkout <prev> && build && up -d`).
- **Schema:** `docker compose -f docker-compose.prod.yml run --rm api alembic downgrade -1`
  (review the migration's `downgrade()` first; take a DB backup before destructive rollbacks).

## 8. Logs / observability
- Structured JSON logs to stdout: `docker compose -f docker-compose.prod.yml logs -f api worker`.
- Every request carries an `X-Correlation-ID` (also a Sentry tag) — grep logs by it.
- Set `SENTRY_DSN` in `.env.production` to enable error tracking.

## Known caveats
- **Frontend build needs internet** for the Google Font (deferred self-host).
- **5 residual `npm audit` vulns** need the Next 14→16 upgrade (deferred).
- See `docs/superpowers/notes/2026-06-03-deferred-work.md`.
