# Promptly — AI Prompt Optimization Platform

Promptly turns rough prompts into production-grade ones using a **multi-model council pipeline**: four LLMs independently rewrite your prompt, blind-review each other's proposals, and a chairman model synthesises the best result.

---

## Features

### Core — Prompt Optimization
- **Council pipeline** — 4 models optimize in parallel (Round 1), blind peer-review all proposals (Round 2), chairman synthesizes the winner (Round 3)
- **Quality gate** — detects already-optimized prompts and short-circuits (5 credits instead of 10)
- **Iterative refinement** — quality gate can trigger additional passes when the first synthesis isn't strong enough
- **Structured reasoning** — every optimization explains what changed, why, and what was preserved
- **Feedback loop** — submit feedback on any result to refine it further in the same session
- **Version history** — every optimization is saved as a versioned prompt family; compare across versions
- **Prompt categories** — tag prompts by category (code generation, analysis, writing, etc.) to apply specialized optimization guidance

### Prompt Analysis
- **Health score** — 8-dimension quality scoring (role/persona, goal clarity, context, output format, examples, guardrails, tone, conciseness)
- **Advisory** — strengths, weaknesses, and improvement suggestions without running a full optimization

### Domain Prompts
- Upload a PDF of domain knowledge to build a specialized dataset
- Generate Q&A pairs from the document, then optimize a prompt against them
- Stored in MinIO; supports dataset augmentation and re-optimization runs

### Prompt Bridge
- Transfer a prompt optimized for one LLM (e.g. GPT-4o) to work well on another (e.g. Claude Sonnet)
- Learns a style-transfer mapping from calibrated example pairs, then applies it to your prompt
- Reuses saved mappings (1 credit) or performs a full re-extraction (5 credits)

### Library
- **Versions** — browse and restore any version of any prompt family
- **Prompt Library** — saved/favorited prompts (prompt store)
- **Prompt Project** — organize prompts into projects
- **History** — full session history with sidebar search

### Account
- Credits system (starts at 100): optimize = 10 credits, health/advisory = 5, bridge = 1–5, domain = variable
- API key management for programmatic access (`qac_`-prefixed keys)
- Billing dashboard

---

## Architecture

```
Browser → Next.js (:3000)
              ↓ axios (NEXT_PUBLIC_API_URL)
         FastAPI (:8000)  →  202 { job_id }
              ↓ Celery task dispatch
         Redis (broker)
              ↓ Celery Worker → LangGraph → OpenRouter LLMs
              ↓ writes result + SSE progress events to Redis
         FastAPI GET /chat/jobs/{id}/stream ← frontend SSE stream
                                            ← falls back to polling every 1 s
```

`POST /api/v1/chat/` never blocks — it returns `job_id` immediately. The LangGraph pipeline runs in the Celery worker. Without the worker running, all optimize requests will hang in `queued` state.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 14 (App Router), TypeScript strict, Tailwind CSS, shadcn/ui, TanStack Query v5, Zustand |
| Backend | FastAPI, Python 3.12, SQLAlchemy 2.0 (async + asyncpg), Alembic |
| Queue | Celery + Redis |
| AI Pipeline | LangGraph, OpenRouter (multi-model council) |
| Database | PostgreSQL 16 |
| Object Storage | MinIO (domain prompt PDFs and datasets) |
| Code Quality | Ruff, MyPy strict, ESLint, pre-commit hooks |

---

## Quick Start

### Prerequisites
- Docker (for PostgreSQL, Redis, MinIO)
- Python 3.12 + [uv](https://github.com/astral-sh/uv)
- Node.js 18+

### 1. Backend

```bash
cd qa-chatbot
cp .env.example .env       # fill in OPENROUTER_API_KEY and other vars
make install               # uv sync --all-extras
make infra                 # start postgres + redis + minio containers
make migrate               # run alembic migrations
make dev                   # uvicorn on :8000
```

### 2. Celery Worker (required — separate terminal)

```bash
cd qa-chatbot && make worker
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev                # Next.js on :3000
```

Set `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `frontend/.env.local` (see `frontend/.env.example`).

Visit `http://localhost:3000` · API docs at `http://localhost:8000/docs`

---

## Environment Variables

### Backend (`qa-chatbot/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENROUTER_API_KEY` | ✅ | Routes all LLM calls |
| `DATABASE_URL` | ✅ | Async postgres (`postgresql+asyncpg://...`) |
| `REDIS_URL` | ✅ | Celery broker/backend + job state cache |
| `SUPABASE_URL` | ✅ | Supabase project URL (JWT verification via JWKS) |
| `SUPABASE_ANON_KEY` | ✅ | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase service-role key |
| `SUPABASE_JWT_SECRET` | ✅ | HS256 fallback for token verification |
| `COUNCIL_MODELS` | — | Override 4 model slugs (comma-separated); index order maps to the 4 optimization strategies |
| `DEFAULT_MODEL` | — | Chairman/synthesizer model slug |
| `MINIO_ENDPOINT_URL` | — | Default: `http://localhost:9000` |
| `MINIO_ACCESS_KEY` | — | MinIO credentials |
| `MINIO_SECRET_KEY` | — | MinIO credentials |
| `MINIO_BUCKET_NAME` | — | Default: `promptly` |

### Frontend (`frontend/.env.local`)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_API_URL` | ✅ | Backend base URL |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL (browser auth) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase anon key (browser auth) |

---

## Project Structure

```
promptly/
├── qa-chatbot/                   # FastAPI backend
│   ├── prompts/                  # LLM system prompts (.md files, edit to change behavior)
│   └── src/app/                  # modular monolith — see docs/adr/0001-backend-architecture.md
│       ├── optimize/             # Flagship "optimize" slice (chat api + service + worker)
│       ├── domain_prompt/        # Domain Prompts feature (PDF → dataset → optimize)
│       ├── prompt_bridge/        # Prompt Bridge feature (cross-model style transfer)
│       ├── graph/                # Shared LangGraph engine — nodes, state, checkpointer
│       ├── llm/                  # Shared LLM client (OpenRouter)
│       ├── api/v1/               # Thin-layer routers (prompts, favorites, categories, users, health, ...)
│       ├── services/ repositories/ models/ schemas/  # Thin-layer CRUD
│       └── core/ config/ db/ workers/  # Shared kernel (auth, settings, sessions, Celery)
└── frontend/                    # Next.js frontend
    └── src/
        ├── app/(dashboard)/      # Dashboard routes
        │   ├── optimize/         # Main optimization chat page
        │   ├── analyze/          # Health score + advisory
        │   ├── bridge/           # Prompt Bridge UI
        │   ├── domain-prompts/   # Domain Prompts UI
        │   └── versions/         # Version history browser
        ├── components/optimize/  # Chat messages, result panel, job progress stepper
        ├── hooks/                # TanStack Query hooks, SSE job stream
        ├── stores/               # Zustand (job state)
        └── types/api.ts          # TypeScript interfaces mirroring backend schemas
```

---

## Controlling LLM Behavior

All system prompts live in `qa-chatbot/prompts/` as `.md` files, loaded once at startup. Edit them and restart the worker — no code changes needed.

| File | Controls |
|------|----------|
| `council_optimizer.md` | How all 4 council models optimize prompts |
| `critic.md` | How models blind-review each other's proposals |
| `synthesize_best.md` | How the chairman picks and merges the best result |
| `intent_classifier.md` | What gets rejected vs. passed to the optimizer |
| `prompt_health_score.md` | The 8 scoring dimensions and their weights |
| `prompt_advisory.md` | Strengths/weaknesses analysis format |

---

## Development Commands

```bash
# Backend
cd qa-chatbot
make lint        # ruff check
make format      # ruff format
make typecheck   # mypy --strict
make test        # pytest with coverage
make check       # lint + format + typecheck in one go

# Frontend
cd frontend
npm run lint     # eslint
npm run build    # type-check + production build
```

---

## Documentation

- **Backend architecture (ADR):** [`docs/adr/0001-backend-architecture.md`](docs/adr/0001-backend-architecture.md) — the modular-monolith rule.
- **Deployment runbook:** [`docs/deployment.md`](docs/deployment.md) — Docker Compose build / migrate / deploy / rollback.
- **Per-app guides:** [`qa-chatbot/README.md`](qa-chatbot/README.md) · [`qa-chatbot/CLAUDE.md`](qa-chatbot/CLAUDE.md) (backend) · [`frontend/CLAUDE.md`](frontend/CLAUDE.md).
- **Deferred work:** [`docs/superpowers/notes/2026-06-03-deferred-work.md`](docs/superpowers/notes/2026-06-03-deferred-work.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

See [SECURITY.md](SECURITY.md) for the vulnerability disclosure policy.

## License

[MIT](LICENSE)
