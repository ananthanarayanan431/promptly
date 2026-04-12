# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo Structure

```
promptly/
  qa-chatbot/   # FastAPI backend — prompt optimization API + LangGraph pipeline
  frontend/     # Next.js 14 frontend — dashboard UI
```

Each subdirectory has its own dependencies, tooling, and CLAUDE.md. Always `cd` into the relevant subdirectory before running commands.

---

## Backend (`qa-chatbot/`)

See `qa-chatbot/CLAUDE.md` for full detail. Quick reference:

```bash
cd qa-chatbot
make infra      # start postgres + redis (Docker)
make migrate    # run alembic migrations
make dev        # FastAPI on :8000
make worker     # Celery worker (must run alongside dev for chat to work)
```

The FastAPI server and Celery worker are **two separate processes** — both must be running for the optimize endpoint to function. The API dispatches jobs; the worker executes them.

---

## Frontend (`frontend/`)

```bash
cd frontend
npm install
npm run dev     # Next.js on :3000
npm run build   # production build
npm run lint    # ESLint
```

**Environment:** copy `.env.local` and set:
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## How the Two Connect

```
Browser → Next.js (frontend/:3000)
              ↓ axios (NEXT_PUBLIC_API_URL)
         FastAPI (qa-chatbot/:8000)
              ↓ Celery task dispatch
         Redis (broker)
              ↓ worker picks up task
         Celery Worker → LangGraph → OpenRouter LLMs
              ↓ writes result back to Redis
         FastAPI poll endpoint → Browser
```

Auth token is stored in an **httpOnly cookie** (set by `frontend/src/app/api/auth/route.ts`, a Next.js API route) and simultaneously hydrated into Zustand for use by the axios interceptor. The middleware at `frontend/src/middleware.ts` reads the cookie to protect dashboard routes server-side.
