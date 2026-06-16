# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands use `uv` (Astral's package manager) and are available via `make`:

```bash
# Setup
make install          # uv sync --all-extras

# Infrastructure (requires Docker)
make infra            # Start postgres + redis containers
make migrate          # uv run alembic upgrade head
make migration name=X # uv run alembic revision --autogenerate -m "X"
make rollback         # uv run alembic downgrade -1

# Run (both processes required for chat to work)
make dev              # uvicorn promptly.main:app --reload (port 8000)
make worker           # celery worker (concurrency=4)

# Code quality
make lint             # uv run ruff check src/
make format           # uv run ruff format src/
make typecheck        # uv run mypy src/
make check            # lint + format + typecheck

# Testing
make test             # pytest tests/ with coverage
make test-unit        # pytest tests/unit/ only
make test-api         # pytest tests/integration/ only
```

One-liner dev setup: `./run.sh dev` (handles infra, migrations, and server start).

Swagger UI: `http://localhost:8000/docs`

---

## Architecture

**Stack:** FastAPI + SQLAlchemy 2.0 (async) + PostgreSQL + Redis + Celery + LangGraph

**Purpose:** Prompt optimizer — a user submits an existing prompt through a three-round multi-model council that independently optimizes it, peer-reviews each other's proposals, and synthesizes the best result.

### Async Job Pattern

`POST /api/v1/chat/` never blocks — it returns HTTP 202 immediately with a `job_id`. The actual LangGraph pipeline runs in a **Celery worker process**. The client polls `GET /api/v1/chat/jobs/{job_id}` until `status` is `completed` or `failed`. Job state is tracked in Redis.

```
POST /chat/  →  enqueue Celery task  →  202 { job_id }
                      ↓
              Celery worker process
                      ↓
              compile_graph() + ChatService.process()
                      ↓
              write result to Redis
                      ↓
GET /chat/jobs/{id}  →  read from Redis  →  { status, result }
```

The worker builds its own LangGraph instance via `compile_graph(checkpointer)` — it never accesses `app.state.graph` because the FastAPI lifespan does not run in worker processes.

### LangGraph Pipeline (3 rounds)

```
intent_classifier → IRRELEVANT → END (rejection)
                  → OPTIMIZE   → council_vote → critic → synthesize → END
```

**Round 1 — council_vote:** 4 models optimize the prompt in parallel.
All models receive the same unified `council_optimizer.md` prompt — model architecture diversity provides variation.

**Round 2 — critic:** Each model blind-reviews the other 3 proposals (not its own). Proposals are anonymised as A/B/C. Returns JSON: `{ranking, critiques, ranking_rationale}`.

**Round 3 — synthesize:** A chairman model receives all 4 proposals + all 4 critique reviews and produces the single best optimized prompt.

**intent_classifier** is the single policy gate — it rejects harmful content, injection attempts, off-topic queries, and "write me a prompt from scratch" requests as `IRRELEVANT`. Only inputs that are existing prompts to be improved pass through as `OPTIMIZE`.

Graph state is persisted to PostgreSQL via `AsyncPostgresSaver` (`src/promptly/graph/checkpointer.py`), keyed by `graph_thread_id`.

### Prompts Directory

All LLM system prompts live in `prompts/` as `.md` files and are loaded once at module startup via `src/promptly/graph/prompts.py`. Edit prompts here to change optimization behaviour — no code changes needed.

| File | Used by | Purpose |
|------|---------|---------|
| `intent_classifier.md` | `intent_classifier` node | OPTIMIZE vs IRRELEVANT classification |
| `council_optimizer.md` | `council_vote` node (all models) | Unified optimization framework — all four council models receive this |
| `critic.md` | `critic` node | Blind peer-review, returns JSON ranking |
| `synthesize_best.md` | `synthesize` node | Chairman synthesis from proposals + critiques |
| `prompt_health_score.md` | `PromptService.health_score()` | Eight-dimension quality scoring |
| `prompt_advisory.md` | `PromptService.advisory()` | Strengths / weaknesses / improvements |

### Key Layers

Structure follows `docs/adr/0001-backend-architecture.md` — a modular monolith: **vertical slices** for big features, a **shared kernel**, and **thin layers** for small CRUD.

| Layer | Location | Purpose |
|-------|----------|---------|
| Optimize slice | `src/promptly/optimize/` | Flagship feature: `api/` (chat router, schemas, exceptions), `core/service.py` (`ChatService`), `workers/tasks.py` (`process_chat_async`); uses the shared `graph/` engine |
| Feature slices | `src/promptly/{domain_prompt,prompt_bridge}/` | Self-contained features (`api/core/data/workers`) per ADR-0001 |
| API routes (thin layers) | `src/promptly/api/v1/` | CRUD routers: prompts, templates, stats, users, favorites, api_keys, categories, openrouter, health |
| Services (thin layers) | `src/promptly/services/` | Business logic for thin-layer features (category, favorite, prompt) |
| Repositories | `src/promptly/repositories/` | Async SQLAlchemy data access; extend `BaseRepository[T]` |
| Models | `src/promptly/models/` | Shared ORM: `User`, `ChatSession`, `Message`, `PromptVersion`, … |
| Schemas | `src/promptly/schemas/` | Pydantic I/O contracts (thin layers) |
| Config | `src/promptly/config/` | One settings class per concern (app, db, llm, redis, rate_limit, supabase) |
| Graph (shared engine) | `src/promptly/graph/` | LangGraph pipeline (state, builder, checkpointer, nodes, prompts) used by the optimize slice |
| LLM (shared kernel) | `src/promptly/llm/` | LLM client + builders, used by graph and the feature slices |
| Workers | `src/promptly/workers/` | `celery_app.py` (shared) + `tasks.py` (`score_prompt_async`); per-feature tasks live in each slice's `workers/` |

### Data Models

- **User:** `id`, `supabase_user_id`, `email`, `full_name`, `is_active`, `last_login_at`, `credits` (default 100)
- **ChatSession:** `id`, `user_id`, `graph_thread_id`
- **Message:** `id`, `session_id`, `role`, `raw_prompt`, `response` (= final optimized prompt), `council_votes` (JSON), `token_usage` (JSON)
- **PromptVersion:** `id`, `prompt_id` (grouping UUID), `user_id`, `name`, `version` (int), `content`

### Prompt Versioning

`POST /api/v1/chat/` accepts optional `prompt_id` (UUID) or `name` (string) to track results as versioned families. The Celery task handles three cases after the pipeline runs:
1. `prompt_id` supplied → append optimized result as vN+1 of that family
2. `name` supplied, family exists → append as vN+1
3. `name` supplied, new family → save original as v1, optimized as v2

### Auth

`get_current_user()` in `src/promptly/dependencies.py` accepts either a **Supabase JWT** Bearer token
or a `qac_`-prefixed API key. Supabase JWTs are verified in `core/supabase_auth.py` (ES256 via
JWKS, with HS256 fallback for legacy tokens). On first login the user row is provisioned lazily
from the verified JWT claims (`supabase_user_id`, `email`, `full_name`) — no webhook required.
Each optimization costs 10 credits (402 if insufficient); health-score and advisory cost 5 each.

**Authorization model:** the backend connects to Postgres with a role that bypasses Row-Level
Security, so **app-level ownership checks are the primary guard** — every endpoint requires
`get_current_user`, and user-data queries filter by the owner. RLS policies (migration
`b2c3d4e5f6a7`) are retained as **defense-in-depth** for any direct Supabase access. API keys
are user-scoped via `api_keys.created_by`.

### Configuration

Settings are split by concern in `src/promptly/config/`. Copy `.env.example` to `.env`. Key variables:

- `OPENROUTER_API_KEY` — required for all LLM calls (routes through OpenRouter)
- `COUNCIL_MODELS` — override the 4 model slugs; index order maps to strategy
- `DATABASE_URL` — async postgres URL (`asyncpg` driver)
- `REDIS_URL` — used by both the async job cache and Celery broker/backend

### Redis Usage

Redis serves two purposes, both via `src/promptly/db/redis.py`:
- **Celery broker/backend** — task queue and result storage
- **Job state cache** (`src/promptly/core/cache.py`) — `chat:job:{id}:status` and `chat:job:{id}` keys track the lifecycle (queued → started → completed/failed) so the FastAPI poll endpoint never touches Celery internals

The module-level `ConnectionPool` in `db/redis.py` must be reset at the start of each Celery task (`reset_connection_pool()`) because `asyncio.run()` closes the event loop between tasks, invalidating the pool's connections.

### Code Style

- **Ruff:** line-length=100, target-version=py312, rules: E, F, I, N, UP, ANN, S, B
- **MyPy:** strict=true, Python 3.12
- Pre-commit hooks enforce ruff + mypy and block commits directly to `main`
- All DB operations are async; never use synchronous SQLAlchemy patterns
