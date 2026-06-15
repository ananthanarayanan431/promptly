# Phase 2 — Structure & Naming Unification Design

**Date:** 2026-06-03
**Branch:** `changes-implementation` (off `main`)
**Status:** Design approved (hybrid + pragmatic optimize depth); awaiting user review of this spec
**Roadmap:** Phase 2 of 7 (see `2026-06-03-production-readiness-roadmap-design.md`). Phase 1 complete and **merged to `main` via PR #34** (incl. a CodeRabbit pass).

---

## 1. Context & Decisions

The backend is a **modular monolith** whose structure is *almost* consistent but undocumented:
- Big bounded features are **vertical slices**: `domain_prompt/` (~3,550 LOC), `prompt_bridge/` (~2,137 LOC), each `api/ core/ data/ [infrastructure/] [prompts/] workers/`.
- `llm/` (~433 LOC) is a genuine **shared kernel** (LLM client) used by `graph/`, `domain_prompt/`, `prompt_bridge/`.
- `graph/` (~3,066 LOC) is the **optimize feature's engine** (LangGraph pipeline) — cohesive and self-contained.
- The **flagship optimize feature is the one big feature that is NOT a slice** — it's scattered across `api/v1/chat.py`, `services/chat_service.py`, `graph/`, and `workers/tasks.py::process_chat_async`.
- Smaller CRUD features (favorites, categories, templates, users, api_keys, stats, prompts) live in **thin shared layers** (`api/v1/ + services/ + repositories/ + models/ + schemas/`).

**Decisions made (user-approved):**
- **Target = documented modular-monolith hybrid** (not uniform slices, not uniform layers).
- **Optimize depth = pragmatic**: create an `optimize/` slice for the chat API + service + worker; **keep `graph/` and `llm/` as the documented shared optimize engine at top level** (do NOT relocate the ~3k LOC graph engine).

**Goal:** make the architecture consistent *by a documented rule*, promote the flagship optimize feature to match the slice pattern at the layer level, consolidate frontend component placement, and fix naming — with **no behavior changes**.

---

## 2. The Architectural Rule (ADR)

Captured in a new `docs/adr/0001-backend-architecture.md`:

- **Vertical slice** — `feature/{api,core,data,[prompts],[workers]}` — for a *big bounded feature* with its own domain logic, persistence, and/or background work. Models + repository colocate in `data/`. Examples: `domain_prompt/`, `prompt_bridge/`, `optimize/`.
- **Shared kernel** — imported by everything; never feature-specific: `config/`, `core/` (auth, middleware, logging, cache, rate_limit, exceptions, user_context), `db/`, `llm/` (LLM client), `graph/` (the optimize engine), `models/base.py`, `utils/`, and cross-feature `schemas/` primitives.
- **Thin shared layer** — small CRUD features with little domain logic stay in `api/v1/ + services/ + repositories/ + models/ + schemas/`: favorites, categories, templates, users, api_keys, stats, prompts (health/advisory).
- **Choosing for a new feature:** substantial domain logic or background jobs → slice; thin DB-backed CRUD → shared layer. This makes the codebase consistent *by rule* rather than forcing 100-LOC features into 5-directory modules.

---

## 3. Backend Changes

### 3.1 New `optimize/` slice (the one structural move)

Create `src/app/optimize/`:

| New location | Moved from | Notes |
|---|---|---|
| `optimize/api/router.py` | `api/v1/chat.py` | chat endpoints (`POST /chat/`, `GET /chat/jobs/{id}`) |
| `optimize/api/schemas.py` | `schemas/chat.py` | chat request/response models |
| `optimize/api/exceptions.py` | `api/v1/exceptions/chat.py` | chat exceptions |
| `optimize/core/service.py` | `services/chat_service.py` | `ChatService` (orchestrates `graph/`); `core/` matches the slice shape (cf. `domain_prompt/core/`) |
| `optimize/workers/tasks.py` | `workers/tasks.py::process_chat_async` | **only** `process_chat_async` moves |

So the `optimize/` slice = `api/ + core/ + workers/`. Under **pragmatic depth it has no `data/` dir**: the `ChatSession` and `Message` ORM models stay in shared `models/` (they're small, referenced across features, and moving them adds churn for no behavior gain). This is a documented, intentional deviation from the full slice shape.

**Stays put (shared kernel / engine):** `graph/` (entire engine — builder, checkpointer, nodes/, prompts/, state), `llm/`, `workers/celery_app.py`, `models/` (incl. `ChatSession`, `Message`).

**`workers/tasks.py` split:** it currently holds two tasks. `process_chat_async` → `optimize/workers/tasks.py`. `score_prompt_async` (prompt health-scoring — a thin-layer "prompts" concern) **stays** in `src/app/workers/tasks.py`.

**Rewiring:**
- `api/router.py`: replace `from app.api.v1 import chat` / `include_router(chat.router)` with the `optimize` router.
- `workers/celery_app.py`: `include=[...]` → keep `"app.workers.tasks"` (for `score_prompt_async`), add `"app.optimize.workers.tasks"`, keep the two existing slice task modules.
- Update all imports of `app.services.chat_service`, `app.schemas.chat`, `app.api.v1.chat`, `app.api.v1.exceptions.chat`, and `app.workers.tasks.process_chat_async` (app code + tests).
- `main.py` / `dependencies.py` `get_graph` / `compile_graph` — **unchanged** (graph/ stays).

### 3.2 Reference slices & thin layers
- `domain_prompt/`, `prompt_bridge/` — unchanged (they are the exemplars).
- Thin-layer features — unchanged except removal of the chat files moved in 3.1.

### 3.3 Explicitly NOT touched
- **Alembic revision IDs** — rewriting applied revisions is risky with ~zero benefit. The hand-typed IDs (`a1b2c3d4e5f6`, …) stay; the ADR notes "use `alembic revision` autogenerated IDs going forward."
- No behavior changes, no dependency changes, no API contract changes (routes/paths identical — only internal module paths move).

---

## 4. Frontend Changes

The frontend is already clean; this is light.

### 4.1 Consolidate component placement
Standardize on the dominant pattern **`src/components/<feature>/`** (used by ~10 features). Two features currently *also* use colocated `_components/`:
- `app/(dashboard)/bridge/_components/bridge-workspace.tsx` → `src/components/bridge/`
- `app/(dashboard)/domain-prompts/_components/{domain-prompts-client,domain-workspace}.tsx` → `src/components/domain-prompts/`

Move those files, update imports, remove the empty `_components/` dirs.

### 4.2 Document conventions
Add to `frontend/CLAUDE.md` (Component Conventions section): `src/components/ui/` = shadcn primitives (don't edit); `src/components/<feature>/` = feature components matching a route; `src/lib/` = framework-agnostic helpers + clients; `src/hooks/` = React hooks; `src/stores/` = Zustand stores; `src/types/` = shared TS types mirroring backend shapes.

---

## 5. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Import churn from the optimize move breaks something | Move one logical unit per commit; run `ruff`+`mypy`+full `pytest` after each; routes/paths unchanged so API contract is stable. |
| A test imports a moved symbol by old path | Grep each moved symbol before/after; tests are part of the green gate. |
| `score_prompt_async` accidentally moved | Spec pins it stays in `workers/tasks.py`; verify the celery `include` resolves both task modules. |
| Frontend import paths after component moves | `tsc --noEmit` + `next build` catch broken imports. |
| Touching recently-edited graph code | We deliberately do NOT move `graph/` (pragmatic depth). |

---

## 6. Execution Strategy

Incremental, subagent-driven, on `supbase-implementation`, scoped commits, **full backend test suite + frontend build green between each task**. Likely task order:
1. ADR doc (`docs/adr/0001-backend-architecture.md`).
2. Create `optimize/` slice — move chat API/schemas/exceptions/service (rewire `api/router.py`), tests green.
3. Move `process_chat_async` → `optimize/workers/tasks.py`, rewire celery `include`, tests green.
4. Frontend: consolidate `_components/` into `src/components/<feature>/`, build green.
5. Docs: update `qa-chatbot/CLAUDE.md` (Key Layers reflects `optimize/` slice) + `frontend/CLAUDE.md` (conventions).

---

## 7. Success Criteria

- `optimize/` slice exists with chat API + service + worker; `graph/`/`llm/` remain shared; **all chat routes respond at the same paths**.
- `score_prompt_async` still registered and working; both task modules in celery `include`.
- No imports of the old `app.services.chat_service` / `app.schemas.chat` / `app.api.v1.chat` paths remain.
- Frontend: no colocated `_components/` dirs remain; all feature components under `src/components/<feature>/`; `next build` green.
- ADR committed; CLAUDE.md files reflect the rule.
- `ruff` + `mypy` + `eslint` + `tsc` green; backend `pytest` passes; `next build` succeeds.
- No behavior or API-contract changes.

## 8. Next Step
On approval → **writing-plans** for the Phase 2 implementation plan, then subagent-driven execution.
