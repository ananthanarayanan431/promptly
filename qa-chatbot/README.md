# qa-chatbot — Prompt Optimization API

FastAPI backend for **Promptly**: a multi-model "council" that optimizes prompts through a
LangGraph pipeline, plus the Domain Prompts and Prompt Bridge features. Async job model —
`POST /api/v1/chat/` returns a `job_id` immediately and a **Celery worker** runs the pipeline
(so the worker must be running for optimize requests to complete).

> Deep guidance for contributors and agents is in **[CLAUDE.md](CLAUDE.md)**; the architecture
> rule is in **[../docs/adr/0001-backend-architecture.md](../docs/adr/0001-backend-architecture.md)**.

## Stack
FastAPI · SQLAlchemy 2.0 (async / asyncpg) · PostgreSQL 16 (pgvector) · Redis · Celery ·
LangGraph · OpenRouter · Supabase (auth) · MinIO (object storage). Python 3.12 + `uv`.

## Quick start
```bash
cp .env.example .env        # fill OPENROUTER_API_KEY + SUPABASE_* + DB/Redis URLs
make install                # uv sync --all-extras
make infra                  # postgres + redis + minio (Docker)
make migrate                # alembic upgrade head
make dev                    # API on :8000   (Swagger UI: /docs)
make worker                 # Celery worker  (separate terminal — required for /chat)
```

## Layout (modular monolith — see the ADR)
- `optimize/` — flagship slice: chat API + `ChatService` + `process_chat_async` worker
- `domain_prompt/`, `prompt_bridge/` — feature slices (`api/core/data/workers`)
- `graph/`, `llm/` — shared optimize engine + LLM client
- `api/v1/`, `services/`, `repositories/`, `models/`, `schemas/` — thin layers for small CRUD
- `core/`, `config/`, `db/`, `workers/celery_app.py` — shared kernel

## Common commands
`make check` (ruff + format + mypy) · `make test` (pytest + coverage) ·
`make migration name="..."` (autogenerate) · `make rollback`.

## Auth & deployment
Requests authenticate with a **Supabase JWT** (ES256 via JWKS, HS256 fallback) or a
`qac_`-prefixed API key; app-level ownership checks are the primary guard (RLS is
defense-in-depth). See [CLAUDE.md](CLAUDE.md) for details and
[../docs/deployment.md](../docs/deployment.md) for production deployment.
