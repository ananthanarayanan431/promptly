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

# Run
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

Swagger UI is available at `http://localhost:8000/docs` in dev mode.

## Architecture

**Stack:** FastAPI + SQLAlchemy 2.0 (async) + PostgreSQL (pgvector) + Redis + Celery + LangGraph

**Purpose:** Prompt optimizer — submits an existing prompt through a multi-model council that
independently optimizes it from different angles, then synthesizes the best result.

### LangGraph Pipeline

```
intent_classifier → (create → END with rejection)
                  → (optimize → guardrails → council_vote → synthesize → END)
                                ↓ (safety fail)
                              END
```

1. **intent_classifier** — first gate: detects whether the user wants to OPTIMIZE an existing
   prompt or CREATE a new one. CREATE requests are rejected here with an explanation; only
   OPTIMIZE requests proceed. Uses `prompts/intent_classifier.md`.

2. **guardrails** — safety gate: rejects empty input, prompts >8000 chars, injection patterns,
   and blocked keywords. Short-circuits to END on failure.

3. **council_vote** — each `COUNCIL_MODELS` model independently optimizes the raw prompt using a
   different strategy. Model 0 uses `prompts/council_optimizer_analytical.md` (precision,
   constraints, output format); model 1 uses `prompts/council_optimizer_creative.md` (context,
   persona depth, exemplars). Returns `council_responses: [{model, optimized_prompt, usage}]`.

4. **synthesize** — acts as meta-judge: evaluates all council proposals, extracts the strongest
   elements from each, and produces one coherent synthesized best prompt. Uses
   `prompts/synthesize_best.md`. Returns `final_response` = the final optimized prompt.

Graph state is persisted to PostgreSQL via `AsyncPostgresSaver` (`src/app/graph/checkpointer.py`),
keyed by `graph_thread_id`. Prompts are loaded from `prompts/` at module startup via
`src/app/graph/prompts.py`.

### Prompts Directory

`prompts/` lives at the project root and contains all LLM system prompts as `.md` files.
Edit prompts here to tune optimization behavior — no code changes needed.

| File | Used by | Purpose |
|------|---------|---------|
| `intent_classifier.md` | `intent_classifier` node | Binary OPTIMIZE/CREATE classification |
| `council_optimizer_analytical.md` | `council_vote` node (model 0) | Precision, constraints, output format |
| `council_optimizer_creative.md` | `council_vote` node (model 1) | Context, persona, exemplars, reasoning |
| `synthesize_best.md` | `synthesize` node | Judge + merge council proposals |

### Request Flow

```
POST /api/v1/chat  →  ChatService.process()  →  LangGraph graph  →  DB (ChatSession + Message)
```

Response shape:
```json
{
  "session_id": "...",
  "original_prompt": "the raw input",
  "optimized_prompt": "the final synthesized best prompt",
  "council_proposals": [{"model": "...", "optimized_prompt": "...", "usage": {}}],
  "token_usage": {"total_tokens": N}
}
```

- Auth via `get_current_user()` in `src/app/dependencies.py` — JWT Bearer or `qac_`-prefixed API key
- Each optimization request costs 10 credits (402 if insufficient)
- Streaming variant (`/chat/stream`) emits SSE chunks from the synthesize node

### Key Layers

| Layer | Location | Purpose |
|-------|----------|---------|
| API routes | `src/app/api/v1/` | FastAPI routers (auth, chat, users, prompts, health) |
| Services | `src/app/services/` | Business logic; `ChatService` owns graph execution |
| Repositories | `src/app/repositories/` | Async SQLAlchemy data access; extend `BaseRepository` |
| Models | `src/app/models/` | ORM: `User`, `ChatSession`, `Message`; use `UUIDMixin + TimestampMixin` |
| Schemas | `src/app/schemas/` | Pydantic I/O contracts |
| Config | `src/app/config/` | One settings class per concern (app, auth, db, llm, redis, rate_limit) |
| Graph | `src/app/graph/` | LangGraph state, builder, checkpointer, nodes, and prompt loader |
| Prompts | `prompts/` | System prompts as `.md` files, loaded once at module startup |
| Workers | `src/app/workers/` | Celery app + background tasks (Redis broker) |

### Data Models

- **User:** `id`, `email`, `hashed_password`, `api_key_hash`, `credits` (default 100), `is_active`
- **ChatSession:** `id`, `user_id`, `graph_thread_id` — one session per LangGraph thread
- **Message:** `id`, `session_id`, `role`, `raw_prompt`, `enhanced_prompt` (unused, kept for schema compat), `response` (= final optimized prompt), `council_votes` (JSON), `token_usage` (JSON)

### Configuration

Settings are loaded from environment variables via `pydantic-settings`. Copy `.env.example` to `.env` before running locally. Key variables:

- `OPENROUTER_API_KEY` — required for all LLM calls
- `COUNCIL_MODELS` — list of models; index 0 uses analytical strategy, index 1 uses creative strategy
- `DATABASE_URL` — async postgres URL (asyncpg driver)
- `REDIS_URL` — used by both cache and Celery

### Code Style

- **Ruff:** line-length=100, target-version=py312, rules: E, F, I, N, UP, ANN, S, B
- **MyPy:** strict=true, Python 3.12
- Pre-commit hooks enforce ruff + mypy and block commits directly to `main`
- All DB operations are async; never use synchronous SQLAlchemy patterns
