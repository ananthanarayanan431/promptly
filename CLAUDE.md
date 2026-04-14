# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo Structure

```
promptly/
  qa-chatbot/   # FastAPI backend — prompt optimization API + LangGraph pipeline
  frontend/     # Next.js 14 frontend — dashboard UI
```

Each subdirectory has its own `CLAUDE.md` with full detail. Always `cd` into the relevant subdirectory before running commands.

---

## Quick Start (full stack)

```bash
# Terminal 1 — infrastructure + backend API
cd qa-chatbot
make infra && make migrate && make dev

# Terminal 2 — Celery worker (required for /chat to function)
cd qa-chatbot && make worker

# Terminal 3 — frontend
cd frontend && npm run dev
```

Swagger UI: `http://localhost:8000/docs`

---

## How the Two Connect

```
Browser → Next.js (:3000)
              ↓ axios (NEXT_PUBLIC_API_URL)
         FastAPI (:8000)  →  202 { job_id }
              ↓ Celery task dispatch
         Redis (broker)
              ↓ Celery Worker → LangGraph → OpenRouter LLMs
              ↓ writes result to Redis
         FastAPI GET /chat/jobs/{id} ← frontend polls every 2 s
```

**Critical:** `POST /api/v1/chat/` returns immediately with a `job_id`; the LangGraph pipeline runs in the Celery worker. Without the worker running, all optimize requests will hang in `queued` state forever.

---

## Cross-Cutting Concerns

### Auth
- Backend: `get_current_user()` in `qa-chatbot/src/app/dependencies.py` accepts JWT Bearer **or** `qac_`-prefixed API key.
- Frontend: token stored in both an httpOnly cookie (for middleware route protection) and Zustand (for the axios interceptor). `AuthInitializer` in the dashboard layout hydrates Zustand from the cookie on page load.
- On 401, the axios interceptor in `frontend/src/lib/api.ts` logs out and redirects to `/login`.

### Credits
Each optimization costs **10 credits**; health-score and advisory cost **5 credits** each. Users start with 100. Returns HTTP 402 when insufficient.

### LLM Calls
All LLM calls route through **OpenRouter** (`OPENROUTER_API_KEY`). The four council models are configurable via `COUNCIL_MODELS` env var — index order maps to the four optimization strategies (analytical/creative/concise/structured).

### Prompts
All system prompts are `.md` files in `qa-chatbot/prompts/`, loaded once at startup. Changing optimization behaviour means editing those files — no code changes required.

---

## Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `OPENROUTER_API_KEY` | `qa-chatbot/.env` | Required for all LLM calls |
| `DATABASE_URL` | `qa-chatbot/.env` | Async postgres (`asyncpg` driver) |
| `REDIS_URL` | `qa-chatbot/.env` | Celery broker/backend + job state cache |
| `COUNCIL_MODELS` | `qa-chatbot/.env` | Override 4 model slugs (comma-separated) |
| `NEXT_PUBLIC_API_URL` | `frontend/.env.local` | Backend base URL for axios |
