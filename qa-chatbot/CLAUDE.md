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
make dev              # uvicorn app.main:app --reload (port 8000)
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

Graph state is persisted to PostgreSQL via `AsyncPostgresSaver` (`src/app/graph/checkpointer.py`), keyed by `graph_thread_id`.

### Prompts Directory

All LLM system prompts live in `prompts/` as `.md` files and are loaded once at module startup via `src/app/graph/prompts.py`. Edit prompts here to change optimization behaviour — no code changes needed.

| File | Used by | Purpose |
|------|---------|---------|
| `intent_classifier.md` | `intent_classifier` node | OPTIMIZE vs IRRELEVANT classification |
| `council_optimizer.md` | `council_vote` node (all models) | Unified optimization framework — all four council models receive this |
| `critic.md` | `critic` node | Blind peer-review, returns JSON ranking |
| `synthesize_best.md` | `synthesize` node | Chairman synthesis from proposals + critiques |
| `prompt_health_score.md` | `PromptService.health_score()` | Eight-dimension quality scoring |
| `prompt_advisory.md` | `PromptService.advisory()` | Strengths / weaknesses / improvements |

### Key Layers

| Layer | Location | Purpose |
|-------|----------|---------|
| API routes | `src/app/api/v1/` | FastAPI routers: auth, chat, users, prompts, health |
| Services | `src/app/services/` | Business logic; `ChatService` owns graph execution |
| Repositories | `src/app/repositories/` | Async SQLAlchemy data access; extend `BaseRepository[T]` |
| Models | `src/app/models/` | ORM: `User`, `ChatSession`, `Message`, `PromptVersion` |
| Schemas | `src/app/schemas/` | Pydantic I/O contracts |
| Config | `src/app/config/` | One settings class per concern (app, auth, db, llm, redis, rate_limit) |
| Graph | `src/app/graph/` | LangGraph state, builder, checkpointer, nodes, prompt loader |
| Workers | `src/app/workers/` | `celery_app.py` + `tasks.py` (process_chat_async) |

### Data Models

- **User:** `id`, `email`, `hashed_password`, `api_key_hash`, `credits` (default 100), `is_active`
- **ChatSession:** `id`, `user_id`, `graph_thread_id`
- **Message:** `id`, `session_id`, `role`, `raw_prompt`, `response` (= final optimized prompt), `council_votes` (JSON), `token_usage` (JSON)
- **PromptVersion:** `id`, `prompt_id` (grouping UUID), `user_id`, `name`, `version` (int), `content`

### Prompt Versioning

`POST /api/v1/chat/` accepts optional `prompt_id` (UUID) or `name` (string) to track results as versioned families. The Celery task handles three cases after the pipeline runs:
1. `prompt_id` supplied → append optimized result as vN+1 of that family
2. `name` supplied, family exists → append as vN+1
3. `name` supplied, new family → save original as v1, optimized as v2

### Auth

`get_current_user()` in `src/app/dependencies.py` accepts either a JWT Bearer token or a `qac_`-prefixed API key. Each optimization costs 10 credits (402 if insufficient); health-score and advisory cost 5 credits each.

### Configuration

Settings are split by concern in `src/app/config/`. Copy `.env.example` to `.env`. Key variables:

- `OPENROUTER_API_KEY` — required for all LLM calls (routes through OpenRouter)
- `COUNCIL_MODELS` — override the 4 model slugs; index order maps to strategy
- `DATABASE_URL` — async postgres URL (`asyncpg` driver)
- `REDIS_URL` — used by both the async job cache and Celery broker/backend

### Redis Usage

Redis serves two purposes, both via `src/app/db/redis.py`:
- **Celery broker/backend** — task queue and result storage
- **Job state cache** (`src/app/core/cache.py`) — `chat:job:{id}:status` and `chat:job:{id}` keys track the lifecycle (queued → started → completed/failed) so the FastAPI poll endpoint never touches Celery internals

The module-level `ConnectionPool` in `db/redis.py` must be reset at the start of each Celery task (`reset_connection_pool()`) because `asyncio.run()` closes the event loop between tasks, invalidating the pool's connections.

### Code Style

- **Ruff:** line-length=100, target-version=py312, rules: E, F, I, N, UP, ANN, S, B
- **MyPy:** strict=true, Python 3.12
- Pre-commit hooks enforce ruff + mypy and block commits directly to `main`
- All DB operations are async; never use synchronous SQLAlchemy patterns
