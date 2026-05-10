# Domain Optimization Run History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store every PDO optimization run in a `domain_optimization_runs` table so the Optimize tab always starts fresh, all past runs are browsable in the History tab, and runs are grouped by domain (up to 5 visible when clicking a domain name).

**Architecture:** A new `DomainOptimizationRun` model captures prompt_input, optimized_prompt, and stats for each Celery optimization job. The Celery task writes a run row instead of patching the domain record. The domain model retains `last_prompt`/`optimized_prompt` columns but they are no longer populated by the optimizer (kept as nullable for backwards compatibility). The frontend `OptimizeTab` tracks current-session run result in local state only; `HistoryTab` fetches real runs from a new `GET /{domain_id}/runs` endpoint.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async, Alembic, Pydantic v2, Next.js 14 App Router, TanStack Query v5, TypeScript strict

---

## File Map

| File | Action | What changes |
|------|--------|--------------|
| `qa-chatbot/src/app/domain_prompt/models.py` | Modify | Add `DomainOptimizationRun` model |
| `qa-chatbot/src/app/migrations/versions/<rev>_add_domain_optimization_runs.py` | Create | Alembic migration |
| `qa-chatbot/src/app/domain_prompt/repository.py` | Modify | Add `DomainOptimizationRunRepository` with `create_run`, `get_runs_by_domain` |
| `qa-chatbot/src/app/domain_prompt/schemas.py` | Modify | Add `OptimizationRunResponse`, `RunListResponse` |
| `qa-chatbot/src/app/domain_prompt/tasks.py` | Modify | `run_domain_optimization` writes run row, stops patching domain |
| `qa-chatbot/src/app/domain_prompt/router.py` | Modify | Add `GET /{domain_id}/runs` endpoint |
| `frontend/src/types/domain-prompts.ts` | Modify | Add `OptimizationRun`, `RunListResponse` interfaces |
| `frontend/src/app/(dashboard)/domain-prompts/_components/domain-workspace.tsx` | Modify | `OptimizeTab` fresh-start state; `HistoryTab` fetches real runs |

---

### Task 1: Add `DomainOptimizationRun` SQLAlchemy model

**Files:**
- Modify: `qa-chatbot/src/app/domain_prompt/models.py`

- [ ] **Step 1: Open the models file and add the new model class**

  The file is at `qa-chatbot/src/app/domain_prompt/models.py`. Add `DomainOptimizationRun` after `DomainDataset`. The full file after the change:

  ```python
  from __future__ import annotations

  import enum
  import uuid

  from sqlalchemy import Enum, Float, ForeignKey, Integer, String, Text
  from sqlalchemy.orm import Mapped, mapped_column, relationship

  from app.models.base import Base, TimestampMixin, UUIDMixin


  class DomainPromptStatus(enum.StrEnum):
      pending = "pending"
      preparing_dataset = "preparing_dataset"
      optimizing = "optimizing"
      completed = "completed"
      failed = "failed"


  class DomainPrompt(Base, UUIDMixin, TimestampMixin):
      __tablename__ = "domain_prompts"

      user_id: Mapped[uuid.UUID] = mapped_column(
          ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
      )
      name: Mapped[str] = mapped_column(String(120), nullable=False)
      description: Mapped[str | None] = mapped_column(Text, nullable=True)
      base_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
      last_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
      optimized_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
      status: Mapped[DomainPromptStatus] = mapped_column(
          Enum(DomainPromptStatus, name="domain_prompt_status"),
          default=DomainPromptStatus.pending,
          nullable=False,
      )
      score_before: Mapped[float | None] = mapped_column(Float, nullable=True)
      score_after: Mapped[float | None] = mapped_column(Float, nullable=True)
      win_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
      candidates_tried: Mapped[int | None] = mapped_column(Integer, nullable=True)
      credits_charged: Mapped[int] = mapped_column(Integer, default=10, nullable=False)
      error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

      dataset: Mapped[DomainDataset | None] = relationship(
          back_populates="domain", cascade="all, delete-orphan", uselist=False, lazy="raise"
      )
      runs: Mapped[list[DomainOptimizationRun]] = relationship(
          back_populates="domain", cascade="all, delete-orphan", lazy="raise"
      )


  class DomainDataset(Base, UUIDMixin, TimestampMixin):
      __tablename__ = "domain_datasets"

      domain_id: Mapped[uuid.UUID] = mapped_column(
          ForeignKey("domain_prompts.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
      )
      user_id: Mapped[uuid.UUID] = mapped_column(
          ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
      )
      minio_bucket: Mapped[str] = mapped_column(String(120), nullable=False)
      pdf_key: Mapped[str] = mapped_column(String(500), nullable=False)
      dataset_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
      row_count: Mapped[int | None] = mapped_column(Integer, nullable=True)

      domain: Mapped[DomainPrompt] = relationship(back_populates="dataset", lazy="raise")


  class DomainOptimizationRun(Base, UUIDMixin, TimestampMixin):
      __tablename__ = "domain_optimization_runs"

      domain_id: Mapped[uuid.UUID] = mapped_column(
          ForeignKey("domain_prompts.id", ondelete="CASCADE"), nullable=False, index=True
      )
      domain_name: Mapped[str] = mapped_column(String(120), nullable=False)
      prompt_input: Mapped[str] = mapped_column(Text, nullable=False)
      optimized_prompt: Mapped[str] = mapped_column(Text, nullable=False)
      score_before: Mapped[float | None] = mapped_column(Float, nullable=True)
      score_after: Mapped[float | None] = mapped_column(Float, nullable=True)
      win_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
      candidates_tried: Mapped[int | None] = mapped_column(Integer, nullable=True)
      rounds_run: Mapped[int | None] = mapped_column(Integer, nullable=True)
      dataset_size: Mapped[int | None] = mapped_column(Integer, nullable=True)

      domain: Mapped[DomainPrompt] = relationship(back_populates="runs", lazy="raise")
  ```

- [ ] **Step 2: Verify the file parses without errors**

  ```bash
  cd qa-chatbot
  uv run python -c "from app.domain_prompt.models import DomainOptimizationRun; print('OK')"
  ```
  Expected: `OK`

- [ ] **Step 3: Commit**

  ```bash
  git add qa-chatbot/src/app/domain_prompt/models.py
  git commit -m "feat: add DomainOptimizationRun model"
  ```

---

### Task 2: Create Alembic migration

**Files:**
- Create: `qa-chatbot/src/app/migrations/versions/<rev>_add_domain_optimization_runs.py`

- [ ] **Step 1: Autogenerate the migration**

  ```bash
  cd qa-chatbot
  make migration name=add_domain_optimization_runs
  ```
  Expected: A new file appears in `src/app/migrations/versions/` with name like `<hash>_add_domain_optimization_runs.py`.

- [ ] **Step 2: Inspect the generated file to confirm it creates the right table**

  Open the generated file and verify the `upgrade()` function creates a table named `domain_optimization_runs` with columns:
  `id` (UUID PK), `domain_id` (UUID FK → domain_prompts.id CASCADE), `domain_name` (VARCHAR 120), `prompt_input` (TEXT), `optimized_prompt` (TEXT), `score_before` (FLOAT nullable), `score_after` (FLOAT nullable), `win_rate` (FLOAT nullable), `candidates_tried` (INTEGER nullable), `rounds_run` (INTEGER nullable), `dataset_size` (INTEGER nullable), `created_at`, `updated_at`.

  Also verify there is a `create_index` call for `domain_id`.

  If the autogenerate missed anything, add it manually. The minimal correct upgrade block:

  ```python
  def upgrade() -> None:
      op.create_table(
          "domain_optimization_runs",
          sa.Column("id", sa.UUID(), nullable=False),
          sa.Column("domain_id", sa.UUID(), nullable=False),
          sa.Column("domain_name", sa.String(length=120), nullable=False),
          sa.Column("prompt_input", sa.Text(), nullable=False),
          sa.Column("optimized_prompt", sa.Text(), nullable=False),
          sa.Column("score_before", sa.Float(), nullable=True),
          sa.Column("score_after", sa.Float(), nullable=True),
          sa.Column("win_rate", sa.Float(), nullable=True),
          sa.Column("candidates_tried", sa.Integer(), nullable=True),
          sa.Column("rounds_run", sa.Integer(), nullable=True),
          sa.Column("dataset_size", sa.Integer(), nullable=True),
          sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
          sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
          sa.ForeignKeyConstraint(["domain_id"], ["domain_prompts.id"], ondelete="CASCADE"),
          sa.PrimaryKeyConstraint("id"),
      )
      op.create_index("ix_domain_optimization_runs_domain_id", "domain_optimization_runs", ["domain_id"])
  ```

  And the `downgrade()` block:

  ```python
  def downgrade() -> None:
      op.drop_index("ix_domain_optimization_runs_domain_id", table_name="domain_optimization_runs")
      op.drop_table("domain_optimization_runs")
  ```

- [ ] **Step 3: Run the migration**

  ```bash
  cd qa-chatbot
  make migrate
  ```
  Expected: `INFO  [alembic.runtime.migration] Running upgrade ... -> ..., add_domain_optimization_runs`

- [ ] **Step 4: Verify the table exists**

  ```bash
  cd qa-chatbot
  uv run python -c "
  import asyncio
  from app.db.session import AsyncSessionLocal
  from sqlalchemy import text

  async def check():
      async with AsyncSessionLocal() as db:
          result = await db.execute(text(\"SELECT column_name FROM information_schema.columns WHERE table_name='domain_optimization_runs' ORDER BY ordinal_position\"))
          for row in result:
              print(row[0])

  asyncio.run(check())
  "
  ```
  Expected output: columns listed including `id`, `domain_id`, `domain_name`, `prompt_input`, `optimized_prompt`, `score_before`, `score_after`, `win_rate`, `candidates_tried`, `rounds_run`, `dataset_size`, `created_at`, `updated_at`.

- [ ] **Step 5: Commit**

  ```bash
  git add qa-chatbot/src/app/migrations/versions/
  git commit -m "feat: migration for domain_optimization_runs table"
  ```

---

### Task 3: Add repository methods for runs

**Files:**
- Modify: `qa-chatbot/src/app/domain_prompt/repository.py`

- [ ] **Step 1: Add `DomainOptimizationRunRepository` to the repository file**

  Open `qa-chatbot/src/app/domain_prompt/repository.py` and add at the bottom:

  ```python
  from app.domain_prompt.models import DomainOptimizationRun  # add to existing import


  class DomainOptimizationRunRepository(BaseRepository[DomainOptimizationRun]):
      model = DomainOptimizationRun

      async def create_run(
          self,
          *,
          domain_id: uuid.UUID,
          domain_name: str,
          prompt_input: str,
          optimized_prompt: str,
          score_before: float | None = None,
          score_after: float | None = None,
          win_rate: float | None = None,
          candidates_tried: int | None = None,
          rounds_run: int | None = None,
          dataset_size: int | None = None,
      ) -> DomainOptimizationRun:
          run = DomainOptimizationRun(
              domain_id=domain_id,
              domain_name=domain_name,
              prompt_input=prompt_input,
              optimized_prompt=optimized_prompt,
              score_before=score_before,
              score_after=score_after,
              win_rate=win_rate,
              candidates_tried=candidates_tried,
              rounds_run=rounds_run,
              dataset_size=dataset_size,
          )
          self.db.add(run)
          await self.db.flush()
          return run

      async def get_runs_by_domain(
          self, domain_id: uuid.UUID, *, limit: int = 50
      ) -> list[DomainOptimizationRun]:
          result = await self.db.execute(
              select(DomainOptimizationRun)
              .where(DomainOptimizationRun.domain_id == domain_id)
              .order_by(DomainOptimizationRun.created_at.desc())
              .limit(limit)
          )
          return list(result.scalars().all())
  ```

  Update the top-level import in the file from:
  ```python
  from app.domain_prompt.models import DomainDataset, DomainPrompt, DomainPromptStatus
  ```
  to:
  ```python
  from app.domain_prompt.models import DomainDataset, DomainOptimizationRun, DomainPrompt, DomainPromptStatus
  ```

- [ ] **Step 2: Verify the file parses**

  ```bash
  cd qa-chatbot
  uv run python -c "from app.domain_prompt.repository import DomainOptimizationRunRepository; print('OK')"
  ```
  Expected: `OK`

- [ ] **Step 3: Commit**

  ```bash
  git add qa-chatbot/src/app/domain_prompt/repository.py
  git commit -m "feat: add DomainOptimizationRunRepository with create_run and get_runs_by_domain"
  ```

---

### Task 4: Add Pydantic schemas for runs

**Files:**
- Modify: `qa-chatbot/src/app/domain_prompt/schemas.py`

- [ ] **Step 1: Add `OptimizationRunResponse` and `RunListResponse` to the schemas file**

  Open `qa-chatbot/src/app/domain_prompt/schemas.py` and append at the bottom (after `TournamentStateResponse`):

  ```python
  class OptimizationRunResponse(BaseModel):
      id: uuid.UUID
      domain_id: uuid.UUID
      domain_name: str
      prompt_input: str
      optimized_prompt: str
      score_before: float | None
      score_after: float | None
      win_rate: float | None
      candidates_tried: int | None
      rounds_run: int | None
      dataset_size: int | None
      created_at: datetime

      model_config = {"from_attributes": True}


  class RunListResponse(BaseModel):
      runs: list[OptimizationRunResponse]
  ```

- [ ] **Step 2: Verify**

  ```bash
  cd qa-chatbot
  uv run python -c "from app.domain_prompt.schemas import OptimizationRunResponse, RunListResponse; print('OK')"
  ```
  Expected: `OK`

- [ ] **Step 3: Commit**

  ```bash
  git add qa-chatbot/src/app/domain_prompt/schemas.py
  git commit -m "feat: add OptimizationRunResponse and RunListResponse schemas"
  ```

---

### Task 5: Update Celery task to write run row

**Files:**
- Modify: `qa-chatbot/src/app/domain_prompt/tasks.py`

The key change: in `run_domain_optimization`, instead of calling `repo.set_status(domain, DomainPromptStatus.completed, optimized_prompt=..., ...)`, we:
1. Call `repo.set_status(domain, DomainPromptStatus.completed)` (no extra kwargs)
2. Insert a `DomainOptimizationRun` row via `DomainOptimizationRunRepository`

- [ ] **Step 1: Replace the DB-write block inside `run_domain_optimization`**

  Find this block in `run_domain_optimization` (around lines 204–218 of tasks.py):

  ```python
  async with AsyncSessionLocal() as db:
      repo = DomainPromptRepository(db)
      domain = await repo.get_by_id(UUID(domain_id))
      if domain is None:
          raise ValueError(f"Domain {domain_id} not found")
      await repo.set_status(
          domain,
          DomainPromptStatus.completed,
          optimized_prompt=str(result["optimized_prompt"]),
          score_before=float(result["score_before"]),  # type: ignore[arg-type]
          score_after=float(result["score_after"]),  # type: ignore[arg-type]
          win_rate=float(result["win_rate"]),  # type: ignore[arg-type]
          candidates_tried=int(str(result["candidates_tried"])),
      )
      await db.commit()
  ```

  Replace it with:

  ```python
  async with AsyncSessionLocal() as db:
      repo = DomainPromptRepository(db)
      domain = await repo.get_by_id(UUID(domain_id))
      if domain is None:
          raise ValueError(f"Domain {domain_id} not found")
      await repo.set_status(domain, DomainPromptStatus.completed)

      from app.domain_prompt.repository import DomainOptimizationRunRepository
      run_repo = DomainOptimizationRunRepository(db)
      dataset_size: int | None = None
      if domain.dataset is not None:
          dataset_size = domain.dataset.row_count
      await run_repo.create_run(
          domain_id=domain.id,
          domain_name=domain.name,
          prompt_input=prompt_to_optimize,
          optimized_prompt=str(result["optimized_prompt"]),
          score_before=float(result["score_before"]),  # type: ignore[arg-type]
          score_after=float(result["score_after"]),  # type: ignore[arg-type]
          win_rate=float(result["win_rate"]),  # type: ignore[arg-type]
          candidates_tried=int(str(result["candidates_tried"])),
          rounds_run=int(str(result.get("rounds_run", 40))),
          dataset_size=dataset_size,
      )
      await db.commit()
  ```

- [ ] **Step 2: Verify the task module parses**

  ```bash
  cd qa-chatbot
  uv run python -c "from app.domain_prompt.tasks import run_domain_optimization; print('OK')"
  ```
  Expected: `OK`

- [ ] **Step 3: Commit**

  ```bash
  git add qa-chatbot/src/app/domain_prompt/tasks.py
  git commit -m "feat: write DomainOptimizationRun row on PDO completion instead of patching domain"
  ```

---

### Task 6: Add `GET /{domain_id}/runs` API endpoint

**Files:**
- Modify: `qa-chatbot/src/app/domain_prompt/router.py`

- [ ] **Step 1: Add the new import and endpoint to router.py**

  Add to the imports at the top of `router.py`:
  ```python
  from app.domain_prompt.schemas import (
      # existing imports ...
      OptimizationRunResponse,
      RunListResponse,
  )
  ```

  Also import the new repository:
  ```python
  from app.domain_prompt.repository import DomainOptimizationRunRepository, DomainPromptRepository
  ```

  Add the endpoint before `@router.delete("/{domain_id}")`:

  ```python
  @router.get(
      "/{domain_id}/runs",
      response_model=SuccessResponse[RunListResponse],
      dependencies=[Depends(_read_limiter)],
  )
  async def list_domain_runs(
      domain_id: uuid.UUID,
      db: Annotated[AsyncSession, Depends(get_db)],
      current_user: Annotated[User, Depends(get_current_user)],
  ) -> SuccessResponse[RunListResponse]:
      """Return optimization run history for a domain (newest first, max 50)."""
      domain_repo = DomainPromptRepository(db)
      domain = await domain_repo.get_by_id_and_user(domain_id, current_user.id)
      if domain is None:
          raise DomainNotFoundException()

      run_repo = DomainOptimizationRunRepository(db)
      runs = await run_repo.get_runs_by_domain(domain_id)
      return SuccessResponse(
          data=RunListResponse(runs=[OptimizationRunResponse.model_validate(r) for r in runs])
      )
  ```

- [ ] **Step 2: Add `DomainOptimizationRunRepository` to the existing repository import in router.py**

  Find this line in router.py:
  ```python
  from app.domain_prompt.repository import DomainPromptRepository
  ```
  Replace with:
  ```python
  from app.domain_prompt.repository import DomainOptimizationRunRepository, DomainPromptRepository
  ```

  And in the schemas import block, add `OptimizationRunResponse` and `RunListResponse` to the existing import list.

- [ ] **Step 3: Start the dev server and test the endpoint**

  ```bash
  cd qa-chatbot
  make dev
  ```

  In another terminal:
  ```bash
  # Replace <TOKEN> with a valid JWT from /api/v1/auth/login
  # Replace <DOMAIN_ID> with an existing domain UUID
  curl -s -H "Authorization: Bearer <TOKEN>" \
    http://localhost:8000/api/v1/domain-prompts/<DOMAIN_ID>/runs | python3 -m json.tool
  ```
  Expected: `{"status": "success", "data": {"runs": [...]}}`  (empty array is fine for now)

- [ ] **Step 4: Commit**

  ```bash
  git add qa-chatbot/src/app/domain_prompt/router.py
  git commit -m "feat: add GET /{domain_id}/runs endpoint for optimization run history"
  ```

---

### Task 7: Add frontend types for optimization runs

**Files:**
- Modify: `frontend/src/types/domain-prompts.ts`

- [ ] **Step 1: Append the new interfaces**

  Open `frontend/src/types/domain-prompts.ts` and append at the bottom:

  ```typescript
  export interface OptimizationRun {
    id: string;
    domain_id: string;
    domain_name: string;
    prompt_input: string;
    optimized_prompt: string;
    score_before: number | null;
    score_after: number | null;
    win_rate: number | null;
    candidates_tried: number | null;
    rounds_run: number | null;
    dataset_size: number | null;
    created_at: string;
  }

  export interface RunListResponse {
    runs: OptimizationRun[];
  }
  ```

- [ ] **Step 2: Verify TypeScript compiles**

  ```bash
  cd frontend
  npm run build 2>&1 | head -30
  ```
  Expected: no new type errors in `domain-prompts.ts`.

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/src/types/domain-prompts.ts
  git commit -m "feat: add OptimizationRun and RunListResponse frontend types"
  ```

---

### Task 8: Rewrite `HistoryTab` to use real run data

**Files:**
- Modify: `frontend/src/app/(dashboard)/domain-prompts/_components/domain-workspace.tsx`

The current `HistoryTab` (around line 759–780) fakes one entry from `domain.optimized_prompt`. Replace it entirely with a real fetch.

- [ ] **Step 1: Add the import for the new type at the top of domain-workspace.tsx**

  Find the existing import:
  ```typescript
  import type { DomainPrompt, DomainListResponse, DatasetRowsResponse, QAPair, TournamentState } from '@/types/domain-prompts';
  ```
  Replace with:
  ```typescript
  import type { DomainPrompt, DomainListResponse, DatasetRowsResponse, QAPair, TournamentState, OptimizationRun, RunListResponse } from '@/types/domain-prompts';
  ```

- [ ] **Step 2: Replace the `HistoryTab` function**

  Find and replace the entire `HistoryTab` function (from `function HistoryTab` to its closing `}` around line 780):

  ```typescript
  function HistoryTab({ domain }: { domain: DomainPrompt }) {
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const { data, isLoading } = useQuery<RunListResponse>({
      queryKey: ['domain-runs', domain.id],
      queryFn: async () => {
        const res = await api.get<{ data: RunListResponse }>(`/api/v1/domain-prompts/${domain.id}/runs`);
        return res.data.data;
      },
    });

    const runs = data?.runs ?? [];

    if (isLoading) {
      return (
        <div className="ply-card" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 13 }}>
          Loading history…
        </div>
      );
    }

    if (runs.length === 0) {
      return (
        <div className="ply-card" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 13 }}>
          No runs yet. Submit a prompt in the Optimize tab to start the first tournament.
        </div>
      );
    }

    return (
      <div className="ply-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 13 }}>
          Tournament history · {domain.name}
          <span style={{ marginLeft: 8, fontWeight: 400, fontSize: 11.5, color: 'var(--text-subtle)' }}>
            {runs.length} run{runs.length !== 1 ? 's' : ''}
          </span>
        </div>
        {runs.slice(0, 5).map((run, i) => (
          <div key={run.id}>
            <div
              onClick={() => setExpandedId(expandedId === run.id ? null : run.id)}
              style={{
                display: 'grid',
                gridTemplateColumns: '160px 1fr 100px 100px 1fr',
                gap: 10, alignItems: 'center',
                padding: '12px 16px', fontSize: 12.5,
                borderBottom: '1px solid var(--border)',
                cursor: 'pointer',
                background: expandedId === run.id ? 'var(--surface-2)' : undefined,
              }}
            >
              <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--mono)', fontSize: 11.5 }}>
                {new Date(run.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
              <span style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="trophy" size={12} />
                {run.domain_name}
              </span>
              <span className="mono">{run.win_rate != null ? `${Math.round(run.win_rate * 100)}% wr` : '—'}</span>
              <span className="mono" style={{ color: 'var(--text-muted)' }}>{run.rounds_run ?? 40} rounds</span>
              <span style={{ color: expandedId === run.id ? 'var(--primary)' : 'var(--text-subtle)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                {expandedId === run.id ? '▲ hide' : '▼ view prompt'}
              </span>
            </div>
            {expandedId === run.id && (
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600, marginBottom: 6 }}>Input prompt</div>
                  <pre className="ply-prompt-block" style={{ margin: 0, fontSize: 12, maxHeight: 120, overflowY: 'auto' }}>{run.prompt_input}</pre>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600, marginBottom: 6 }}>PDO optimized</div>
                  <pre className="ply-prompt-block" style={{ margin: 0, fontSize: 12, maxHeight: 180, overflowY: 'auto' }}>{run.optimized_prompt}</pre>
                </div>
                <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
                  {run.score_before != null && <span>Score before: <strong>{run.score_before.toFixed(3)}</strong></span>}
                  {run.score_after != null && <span>Score after: <strong>{run.score_after.toFixed(3)}</strong></span>}
                  {run.candidates_tried != null && <span>Candidates: <strong>{run.candidates_tried}</strong></span>}
                  {run.dataset_size != null && <span>Dataset: <strong>{run.dataset_size} Q&A</strong></span>}
                </div>
              </div>
            )}
          </div>
        ))}
        {runs.length > 5 && (
          <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-subtle)', textAlign: 'center' }}>
            Showing 5 of {runs.length} runs
          </div>
        )}
      </div>
    );
  }
  ```

- [ ] **Step 3: Verify TypeScript compiles**

  ```bash
  cd frontend
  npm run build 2>&1 | grep -E "error|Error" | head -20
  ```
  Expected: no errors related to `HistoryTab` or `OptimizationRun`.

- [ ] **Step 4: Commit**

  ```bash
  git add frontend/src/app/(dashboard)/domain-prompts/_components/domain-workspace.tsx
  git commit -m "feat: rewrite HistoryTab to fetch real optimization run history"
  ```

---

### Task 9: Make `OptimizeTab` start fresh (no stale result on load)

**Files:**
- Modify: `frontend/src/app/(dashboard)/domain-prompts/_components/domain-workspace.tsx`

The current `OptimizeTab` reads `domain.optimized_prompt` and `domain.last_prompt` to decide whether to show a result. Since the task in Task 5 stops writing those fields, the domain object will have `null` for both. But we need to also show the new run result right after a fresh optimization completes in the current session.

The job-poll result already contains `optimized_prompt` in its `result` field. We capture it in local state.

- [ ] **Step 1: Find and update the `OptimizeTab` result detection**

  In `domain-workspace.tsx`, find the `OptimizeTab` function. Locate the logic that computes `hasResult` — it looks like:
  ```typescript
  const hasResult = !!domain.optimized_prompt && !!domain.last_prompt;
  ```
  or similar usage of `domain.optimized_prompt`.

  The pattern to follow: add a `sessionResult` state variable that gets set when a job completes in this session. Replace any read of `domain.optimized_prompt` inside `OptimizeTab` with `sessionResult`.

  Find `OptimizeTab` function definition. It should have a `useMutation` or polling mechanism. Add state:
  ```typescript
  const [sessionResult, setSessionResult] = useState<{
    optimized_prompt: string;
    score_before: number;
    score_after: number;
    win_rate: number;
    candidates_tried: number;
  } | null>(null);
  ```

  Then in the polling effect (the `setInterval` that polls `/api/v1/domain-prompts/jobs/${pollingJobId}`), when `status === 'completed'`, add:
  ```typescript
  if (res.data.data.result) {
    const r = res.data.data.result as Record<string, unknown>;
    setSessionResult({
      optimized_prompt: String(r.optimized_prompt ?? ''),
      score_before: Number(r.score_before ?? 0),
      score_after: Number(r.score_after ?? 0),
      win_rate: Number(r.win_rate ?? 0),
      candidates_tried: Number(r.candidates_tried ?? 0),
    });
  }
  ```

  Change `hasResult` to:
  ```typescript
  const hasResult = !!sessionResult;
  ```

  And wherever the component renders `domain.optimized_prompt` (the result panel), replace with `sessionResult?.optimized_prompt`.

  Also replace `domain.last_prompt` rendered as "original prompt" with `draft` (the textarea value at time of submit, already tracked in state).

  The stats panel that shows `domain.score_before`, `domain.score_after`, `domain.win_rate`, `domain.candidates_tried` should now read from `sessionResult`.

  Concretely, find the result display section that looks like:
  ```tsx
  {hasResult && !busy && (
    <div ...>
      ...
      <pre ...>{domain.optimized_prompt}</pre>
      ...
      {domain.score_before} ... {domain.score_after}
    </div>
  )}
  ```
  And replace `domain.optimized_prompt` → `sessionResult?.optimized_prompt`, `domain.score_before` → `sessionResult?.score_before`, `domain.score_after` → `sessionResult?.score_after`, `domain.win_rate` → `sessionResult?.win_rate`, `domain.candidates_tried` → `sessionResult?.candidates_tried`.

- [ ] **Step 2: Invalidate the runs query when a job completes**

  In the same polling effect, when `status === 'completed'`, add:
  ```typescript
  void qc.invalidateQueries({ queryKey: ['domain-runs', domain.id] });
  ```
  This ensures the History tab refreshes automatically after a run completes.

- [ ] **Step 3: Verify the full build compiles**

  ```bash
  cd frontend
  npm run build 2>&1 | grep -E "error|Error" | head -20
  ```
  Expected: zero errors.

- [ ] **Step 4: Commit**

  ```bash
  git add frontend/src/app/(dashboard)/domain-prompts/_components/domain-workspace.tsx
  git commit -m "feat: OptimizeTab starts fresh; session result captured in state; invalidates runs query on complete"
  ```

---

### Task 10: Manual integration smoke test

- [ ] **Step 1: Start the full stack**

  ```bash
  # Terminal 1
  cd qa-chatbot && make infra && make dev

  # Terminal 2
  cd qa-chatbot && make worker

  # Terminal 3
  cd frontend && npm run dev
  ```

- [ ] **Step 2: Verify Optimize tab is empty on domain load**

  1. Open the browser at `http://localhost:3000`.
  2. Navigate to Domain Prompts.
  3. Click an existing domain that previously had `optimized_prompt` set.
  4. Click the Optimize tab.
  5. **Expected:** Empty state with the "Run the PDO tournament" message — NO stale result shown.

- [ ] **Step 3: Run a PDO optimization**

  1. Paste a sample prompt in the textarea: `You are a helpful assistant. Answer questions clearly.`
  2. Click "Run PDO".
  3. Watch the tournament visualization update in real time.
  4. When complete, the Optimize tab should show the newly optimized prompt.
  5. **Expected:** Result panel appears with the optimized prompt and stats.

- [ ] **Step 4: Verify History tab shows the new run**

  1. Click the History tab.
  2. **Expected:** The run just completed is listed at the top, with date, domain name, win rate, and rounds.
  3. Click the row to expand it.
  4. **Expected:** Input prompt, PDO-optimized prompt, and stats all visible.

- [ ] **Step 5: Navigate away and back — verify Optimize tab is fresh again**

  1. Click a different domain, then click back to the original domain.
  2. Click the Optimize tab.
  3. **Expected:** Empty state again (session result is local state, cleared on domain switch).

- [ ] **Step 6: Verify History still shows old runs**

  1. Click the History tab.
  2. **Expected:** Previous run still listed (it's persisted in DB, not session state).

---

## Self-Review Checklist

**Spec coverage:**
- ✅ New `domain_optimization_runs` table — Task 1 + 2
- ✅ Alembic migration — Task 2
- ✅ Repository methods `create_run`, `get_runs_by_domain` — Task 3
- ✅ Celery task writes run row (not domain patch) — Task 5
- ✅ `GET /{domain_id}/runs` endpoint — Task 6
- ✅ Frontend types — Task 7
- ✅ `HistoryTab` shows real runs grouped by domain (up to 5 visible) — Task 8
- ✅ `OptimizeTab` starts fresh on load — Task 9
- ✅ Runs query invalidated when new run completes so History tab auto-refreshes — Task 9
- ✅ Domain name snapshot stored on run row — `domain_name` field in Task 1

**No placeholders found.**

**Type consistency check:**
- `DomainOptimizationRun` model fields match `create_run()` params in Task 3 ✅
- `OptimizationRunResponse` fields match `DomainOptimizationRun` model fields ✅
- `OptimizationRun` frontend interface fields match `OptimizationRunResponse` backend schema ✅
- `sessionResult` shape matches the `result` dict returned by job poll (`optimized_prompt`, `score_before`, `score_after`, `win_rate`, `candidates_tried`) ✅
