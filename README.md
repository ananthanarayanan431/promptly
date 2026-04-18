# Promptly — AI Prompt Optimization Platform

Promptly optimises your prompts using a multi-model council: four LLMs independently rewrite your prompt, critique each other's proposals, and a chairman model synthesises the best result.

## Architecture

```
Browser → Next.js (:3000)
              ↓ axios
         FastAPI (:8000)  →  202 { job_id }
              ↓ Celery task
         Redis (broker)
              ↓ Celery Worker → LangGraph → OpenRouter LLMs
              ↓ result written to Redis
         FastAPI GET /chat/jobs/{id} ← frontend polls every 2 s
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 14, TypeScript, Tailwind CSS, shadcn/ui, TanStack Query v5 |
| Backend | FastAPI, Python 3.11, SQLAlchemy 2 (asyncpg), Alembic |
| Queue | Celery + Redis |
| AI Pipeline | LangGraph, OpenRouter (multi-model) |
| Database | PostgreSQL 16 + pgvector |

## Quick Start

See [`qa-chatbot/CLAUDE.md`](qa-chatbot/CLAUDE.md) and [`frontend/CLAUDE.md`](frontend/CLAUDE.md) for full setup instructions.

```bash
# 1. Backend + infra
cd qa-chatbot && make infra && make migrate && make dev

# 2. Celery worker (separate terminal)
cd qa-chatbot && make worker

# 3. Frontend (separate terminal)
cd frontend && npm install && npm run dev
```

Visit `http://localhost:3000` · API docs at `http://localhost:8000/docs`

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

See [SECURITY.md](SECURITY.md) for the vulnerability disclosure policy.

## License

[MIT](LICENSE)
