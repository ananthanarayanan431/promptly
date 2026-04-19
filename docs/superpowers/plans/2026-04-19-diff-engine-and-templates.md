# Diff Engine + Prompt Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a word-level diff API between any two prompt versions, and a global templates system with seed data.

**Architecture:**
- Diff: pure Python (`difflib.SequenceMatcher`) at word level — no LLM calls, zero cost. New `GET /prompts/versions/{prompt_id}/diff?from=1&to=2` endpoint. Frontend adds diff toggle to version history page.
- Templates: new `templates` table (global, no user FK), seeded on startup, `GET /templates` groups by category. Frontend adds a template picker to the optimize page.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async, Alembic, Pydantic v2, Next.js 14 App Router, TanStack Query v5, inline styles

---

### Task 1: Diff Utility + Schema

**Files:**
- Create: `qa-chatbot/src/app/utils/__init__.py`
- Create: `qa-chatbot/src/app/utils/diff.py`
- Modify: `qa-chatbot/src/app/schemas/prompt.py`

- [ ] **Step 1: Create utils package**

```python
# qa-chatbot/src/app/utils/__init__.py
# (empty)
```

- [ ] **Step 2: Write diff utility**

```python
# qa-chatbot/src/app/utils/diff.py
from __future__ import annotations

import difflib
import re
from dataclasses import dataclass


def _tokenize(text: str) -> list[str]:
    """Split text into tokens: words, whitespace runs, and punctuation."""
    return re.findall(r"\S+|\s+", text)


@dataclass
class DiffHunk:
    type: str  # "equal" | "insert" | "delete" | "replace"
    text: str | None = None        # for equal/insert/delete
    from_text: str | None = None   # for replace
    to_text: str | None = None     # for replace


def compute_diff(from_content: str, to_content: str) -> tuple[list[DiffHunk], dict[str, int]]:
    """
    Compute a word-level diff between two strings.
    Returns (hunks, stats) where stats = {added, removed, equal}.
    """
    from_tokens = _tokenize(from_content)
    to_tokens = _tokenize(to_content)

    matcher = difflib.SequenceMatcher(None, from_tokens, to_tokens, autojunk=False)
    hunks: list[DiffHunk] = []
    stats: dict[str, int] = {"added": 0, "removed": 0, "equal": 0}

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        from_chunk = "".join(from_tokens[i1:i2])
        to_chunk = "".join(to_tokens[j1:j2])

        if tag == "equal":
            hunks.append(DiffHunk(type="equal", text=from_chunk))
            stats["equal"] += len(from_tokens[i1:i2])
        elif tag == "insert":
            hunks.append(DiffHunk(type="insert", text=to_chunk))
            stats["added"] += len(to_tokens[j1:j2])
        elif tag == "delete":
            hunks.append(DiffHunk(type="delete", text=from_chunk))
            stats["removed"] += len(from_tokens[i1:i2])
        elif tag == "replace":
            hunks.append(DiffHunk(type="replace", from_text=from_chunk, to_text=to_chunk))
            stats["removed"] += len(from_tokens[i1:i2])
            stats["added"] += len(to_tokens[j1:j2])

    return hunks, stats
```

- [ ] **Step 3: Add diff schemas to `prompt.py`**

Append to end of `qa-chatbot/src/app/schemas/prompt.py`:

```python
# --- Diff ---


class DiffHunk(BaseModel):
    type: str  # "equal" | "insert" | "delete" | "replace"
    text: str | None = None
    from_text: str | None = None
    to_text: str | None = None


class DiffStats(BaseModel):
    added: int
    removed: int
    equal: int


class PromptDiffResponse(BaseModel):
    prompt_id: str
    from_version: int
    to_version: int
    from_content: str
    to_content: str
    hunks: list[DiffHunk]
    stats: DiffStats
```

- [ ] **Step 4: Verify mypy passes**

```bash
cd qa-chatbot && make typecheck 2>&1 | tail -20
```
Expected: no errors related to `utils/diff.py` or `schemas/prompt.py`

---

### Task 2: Diff Repository Method + API Endpoint

**Files:**
- Modify: `qa-chatbot/src/app/repositories/prompt_version_repo.py`
- Modify: `qa-chatbot/src/app/api/v1/prompts.py`
- Create: `qa-chatbot/src/app/api/v1/exceptions/prompts.py` (add new exception)

- [ ] **Step 1: Add `get_by_version_number` to `PromptVersionRepository`**

Add this method to the class in `prompt_version_repo.py`:

```python
async def get_by_version_number(
    self, prompt_id: UUID, version: int, user_id: UUID
) -> PromptVersion | None:
    """Return a specific version of a prompt by version number."""
    result = await self.db.execute(
        select(PromptVersion).where(
            PromptVersion.prompt_id == prompt_id,
            PromptVersion.version == version,
            PromptVersion.user_id == user_id,
        )
    )
    return result.scalar_one_or_none()
```

- [ ] **Step 2: Add new exception for diff not found**

Add to `qa-chatbot/src/app/api/v1/exceptions/prompts.py`:

```python
class PromptVersionNotFoundException(HTTPException):
    def __init__(self, detail: str = "Prompt version not found.") -> None:
        super().__init__(status_code=status.HTTP_404_NOT_FOUND, detail=detail)
```

- [ ] **Step 3: Add diff endpoint to `prompts.py`**

Add imports at the top of `qa-chatbot/src/app/api/v1/prompts.py`:

```python
from app.api.v1.exceptions.prompts import PromptInsufficientCreditsException, PromptVersionNotFoundException
from app.schemas.prompt import (
    ...,  # existing imports
    PromptDiffResponse,
)
from app.utils.diff import compute_diff
```

Add the endpoint after the existing `list_prompt_versions` endpoint:

```python
@router.get(
    "/versions/{prompt_id}/diff",
    response_model=SuccessResponse[PromptDiffResponse],
)
async def diff_prompt_versions(
    prompt_id: uuid.UUID,
    from_version: int = Query(..., alias="from", ge=1),
    to_version: int = Query(..., alias="to", ge=1),
    db: Annotated[AsyncSession, Depends(get_db)] = ...,
    current_user: Annotated[User, Depends(get_current_user)] = ...,
) -> SuccessResponse[PromptDiffResponse]:
    """
    Return a word-level diff between two versions of a prompt family.
    Both versions must belong to the current user.
    """
    repo = PromptVersionRepository(db)
    from_pv = await repo.get_by_version_number(prompt_id, from_version, current_user.id)
    to_pv = await repo.get_by_version_number(prompt_id, to_version, current_user.id)

    if from_pv is None or to_pv is None:
        raise PromptVersionNotFoundException()

    hunks, stats = compute_diff(from_pv.content, to_pv.content)

    return SuccessResponse(
        data=PromptDiffResponse(
            prompt_id=str(prompt_id),
            from_version=from_version,
            to_version=to_version,
            from_content=from_pv.content,
            to_content=to_pv.content,
            hunks=[
                {"type": h.type, "text": h.text, "from_text": h.from_text, "to_text": h.to_text}
                for h in hunks
            ],
            stats=stats,
        )
    )
```

- [ ] **Step 4: Add missing import for `Query` and `PromptVersionRepository`**

Ensure the imports at top of `prompts.py` include:
```python
from fastapi import APIRouter, Depends, Query
from app.repositories.prompt_version_repo import PromptVersionRepository
```

- [ ] **Step 5: Run linter and typecheck**

```bash
cd qa-chatbot && make check 2>&1 | tail -30
```
Expected: passes (0 errors)

---

### Task 3: Templates Model + Migration

**Files:**
- Create: `qa-chatbot/src/app/models/template.py`
- Modify: `qa-chatbot/src/app/models/__init__.py`
- Create: `qa-chatbot/src/app/migrations/versions/c4d5e6f7a8b9_add_templates.py`

- [ ] **Step 1: Create Template model**

```python
# qa-chatbot/src/app/models/template.py
from __future__ import annotations

from sqlalchemy import Boolean, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, UUIDMixin


class Template(Base, UUIDMixin, TimestampMixin):
    """
    Global read-only prompt templates curated by Promptly.
    Users pick a template to pre-fill their optimize input.
    No user ownership — templates are shared across all accounts.
    """

    __tablename__ = "templates"

    category: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(String(512))
    content: Mapped[str] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
```

- [ ] **Step 2: Register in models `__init__.py`**

```python
from app.models.message import Message
from app.models.prompt_version import PromptVersion
from app.models.session import ChatSession
from app.models.template import Template
from app.models.user import User

__all__ = ["User", "ChatSession", "Message", "PromptVersion", "Template"]
```

- [ ] **Step 3: Write migration**

```python
# qa-chatbot/src/app/migrations/versions/c4d5e6f7a8b9_add_templates.py
"""add templates table

Revision ID: c4d5e6f7a8b9
Revises: a3f9c12e4b57
Create Date: 2026-04-19 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c4d5e6f7a8b9"
down_revision: str | Sequence[str] | None = "a3f9c12e4b57"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "templates",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("category", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.String(length=512), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_templates_category"), "templates", ["category"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_templates_category"), table_name="templates")
    op.drop_table("templates")
```

- [ ] **Step 4: Run migration**

```bash
cd qa-chatbot && make migrate
```
Expected: `Running upgrade a3f9c12e4b57 -> c4d5e6f7a8b9, add templates table`

---

### Task 4: Templates Repository + Seed Data

**Files:**
- Create: `qa-chatbot/src/app/repositories/template_repo.py`
- Create: `qa-chatbot/src/app/seeds/__init__.py`
- Create: `qa-chatbot/src/app/seeds/templates.py`
- Modify: `qa-chatbot/src/app/main.py`

- [ ] **Step 1: Create TemplateRepository**

```python
# qa-chatbot/src/app/repositories/template_repo.py
from sqlalchemy import select

from app.models.template import Template
from app.repositories.base import BaseRepository


class TemplateRepository(BaseRepository[Template]):
    model = Template

    async def get_active(self) -> list[Template]:
        """Return all active templates ordered by category then name."""
        result = await self.db.execute(
            select(Template)
            .where(Template.is_active.is_(True))
            .order_by(Template.category, Template.name)
        )
        return list(result.scalars().all())

    async def count_active(self) -> int:
        """Return count of active templates (used to skip seeding if already populated)."""
        from sqlalchemy import func
        result = await self.db.execute(
            select(func.count()).select_from(Template).where(Template.is_active.is_(True))
        )
        return result.scalar_one()
```

- [ ] **Step 2: Create seeds package**

```python
# qa-chatbot/src/app/seeds/__init__.py
# (empty)
```

- [ ] **Step 3: Write seed data**

```python
# qa-chatbot/src/app/seeds/templates.py
"""Seed curated prompt templates. Called once on startup if table is empty."""
from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.template import Template
from app.repositories.template_repo import TemplateRepository

SEED_TEMPLATES = [
    # ── Coding ──────────────────────────────────────────────────────────────
    {
        "category": "coding",
        "name": "Code Review",
        "description": "Review a function or module for bugs, style, and performance.",
        "content": (
            "Review the following code for correctness, readability, and performance. "
            "Identify any bugs, anti-patterns, or missed edge cases. "
            "Suggest concrete improvements with brief explanations. "
            "Code:\n{{code}}"
        ),
    },
    {
        "category": "coding",
        "name": "Explain Code",
        "description": "Explain what a block of code does in plain English.",
        "content": (
            "Explain what the following code does in plain English. "
            "Assume the reader understands basic programming but may not know this language. "
            "Cover: what it does, how it works, and any non-obvious behaviour. "
            "Code:\n{{code}}"
        ),
    },
    {
        "category": "coding",
        "name": "Write Unit Tests",
        "description": "Generate unit tests for a function or class.",
        "content": (
            "Write thorough unit tests for the following function. "
            "Cover the happy path, edge cases, and failure modes. "
            "Use the testing framework already present in the codebase. "
            "Function:\n{{function}}"
        ),
    },
    {
        "category": "coding",
        "name": "Debug Error",
        "description": "Diagnose an error message and suggest fixes.",
        "content": (
            "I'm seeing the following error. Explain the root cause and provide "
            "the most likely fix. If there are multiple possible causes, list them "
            "in order of likelihood.\n"
            "Error:\n{{error}}\n"
            "Relevant code:\n{{code}}"
        ),
    },
    # ── Writing ─────────────────────────────────────────────────────────────
    {
        "category": "writing",
        "name": "Blog Post",
        "description": "Draft a structured blog post on a topic.",
        "content": (
            "Write an 800-word blog post about {{topic}}. "
            "Open with a specific scene or concrete example, not a definition. "
            "Use short paragraphs (3–4 sentences max). "
            "End with one clear takeaway the reader can act on today."
        ),
    },
    {
        "category": "writing",
        "name": "Summarise Document",
        "description": "Condense a long document into key points.",
        "content": (
            "Summarise the following document in 5 bullet points. "
            "Each bullet should be one sentence. "
            "Focus on decisions, findings, and action items — skip background context. "
            "Document:\n{{document}}"
        ),
    },
    {
        "category": "writing",
        "name": "Rewrite for Clarity",
        "description": "Rewrite dense or jargon-heavy text in plain English.",
        "content": (
            "Rewrite the following text so it is clear and direct. "
            "Replace jargon with plain words. Break long sentences. "
            "Do not add new information — only clarify what is already there. "
            "Text:\n{{text}}"
        ),
    },
    # ── Customer Support ────────────────────────────────────────────────────
    {
        "category": "customer-support",
        "name": "Support Reply",
        "description": "Draft a professional, empathetic customer support response.",
        "content": (
            "You are a support agent for {{company}}. "
            "Reply to the following customer message. "
            "Acknowledge the issue, explain the cause in one sentence, "
            "and give the resolution or next steps. "
            "Tone: professional, warm, concise (under 120 words). "
            "Customer message:\n{{message}}"
        ),
    },
    {
        "category": "customer-support",
        "name": "Escalation Summary",
        "description": "Summarise a support ticket for escalation to engineering.",
        "content": (
            "Summarise the following support ticket for the engineering team. "
            "Include: issue description, steps to reproduce, customer impact, "
            "and any workarounds already tried. "
            "Be precise — use the exact error messages and version numbers mentioned. "
            "Ticket:\n{{ticket}}"
        ),
    },
    {
        "category": "customer-support",
        "name": "FAQ Answer",
        "description": "Answer a frequently asked question concisely.",
        "content": (
            "Answer the following customer question about {{product}}. "
            "Keep the answer under 80 words. "
            "If the answer requires steps, use a numbered list. "
            "Do not refer to documentation — answer directly. "
            "Question:\n{{question}}"
        ),
    },
    # ── Analysis ────────────────────────────────────────────────────────────
    {
        "category": "analysis",
        "name": "Compare Options",
        "description": "Compare two or more options with a structured pros/cons analysis.",
        "content": (
            "Compare the following options on the dimensions that matter most for this decision. "
            "Present a clear recommendation at the end with one-sentence justification. "
            "Format as a table if there are more than 3 dimensions. "
            "Options:\n{{options}}\n"
            "Context:\n{{context}}"
        ),
    },
    {
        "category": "analysis",
        "name": "Root Cause Analysis",
        "description": "Systematically identify the root cause of a problem.",
        "content": (
            "Perform a root cause analysis of the following problem using the 5-Whys method. "
            "State each 'why' and its answer. "
            "End with a concrete preventive action. "
            "Problem:\n{{problem}}"
        ),
    },
]


async def seed_templates(db: AsyncSession) -> None:
    """Insert seed templates if the table is empty."""
    repo = TemplateRepository(db)
    count = await repo.count_active()
    if count > 0:
        return

    for t in SEED_TEMPLATES:
        db.add(
            Template(
                id=uuid.uuid4(),
                category=t["category"],
                name=t["name"],
                description=t["description"],
                content=t["content"],
                is_active=True,
            )
        )
    await db.commit()
```

- [ ] **Step 4: Call seed in `main.py` lifespan**

Add import:
```python
from app.seeds.templates import seed_templates
```

Add call inside the lifespan function, after `_seed_anonymous_user`:
```python
async with AsyncSessionLocal() as session:
    await seed_templates(session)
```

- [ ] **Step 5: Run typecheck**

```bash
cd qa-chatbot && make typecheck 2>&1 | tail -20
```
Expected: no new errors

---

### Task 5: Templates API

**Files:**
- Create: `qa-chatbot/src/app/schemas/template.py`
- Create: `qa-chatbot/src/app/api/v1/templates.py`
- Modify: `qa-chatbot/src/app/api/router.py`

- [ ] **Step 1: Create template schemas**

```python
# qa-chatbot/src/app/schemas/template.py
from pydantic import BaseModel


class TemplateOut(BaseModel):
    id: str
    category: str
    name: str
    description: str
    content: str

    model_config = {"from_attributes": True}


class TemplateCategoryGroup(BaseModel):
    category: str
    templates: list[TemplateOut]


class TemplateListResponse(BaseModel):
    categories: list[TemplateCategoryGroup]
    total: int
```

- [ ] **Step 2: Create templates router**

```python
# qa-chatbot/src/app/api/v1/templates.py
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.types.response import SuccessResponse
from app.dependencies import get_current_user, get_db
from app.models.user import User
from app.repositories.template_repo import TemplateRepository
from app.schemas.template import TemplateCategoryGroup, TemplateListResponse, TemplateOut

router = APIRouter(prefix="/templates", tags=["templates"])


@router.get("", response_model=SuccessResponse[TemplateListResponse])
async def list_templates(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[TemplateListResponse]:
    """
    Return all active prompt templates grouped by category.
    Templates are global presets — they do not belong to any user.
    """
    repo = TemplateRepository(db)
    templates = await repo.get_active()

    grouped: dict[str, list[TemplateOut]] = {}
    for t in templates:
        out = TemplateOut(
            id=str(t.id),
            category=t.category,
            name=t.name,
            description=t.description,
            content=t.content,
        )
        grouped.setdefault(t.category, []).append(out)

    categories = [
        TemplateCategoryGroup(category=cat, templates=items)
        for cat, items in grouped.items()
    ]

    return SuccessResponse(
        data=TemplateListResponse(categories=categories, total=len(templates))
    )
```

- [ ] **Step 3: Register router**

In `qa-chatbot/src/app/api/router.py`:
```python
from app.api.v1 import auth, chat, health, prompts, stats, templates, users

api_router = APIRouter()

api_router.include_router(health.router)
api_router.include_router(chat.router)
api_router.include_router(prompts.router)
api_router.include_router(templates.router)
api_router.include_router(stats.router)
api_router.include_router(auth.router)
api_router.include_router(users.router)
```

- [ ] **Step 4: Run full check**

```bash
cd qa-chatbot && make check 2>&1 | tail -30
```
Expected: passes (0 errors)

---

### Task 6: Frontend — Diff Types + Version History Diff View

**Files:**
- Modify: `frontend/src/types/api.ts`
- Modify: `frontend/src/app/(dashboard)/versions/[id]/page.tsx`

- [ ] **Step 1: Add types to `api.ts`**

```typescript
export interface DiffHunk {
  type: 'equal' | 'insert' | 'delete' | 'replace';
  text?: string;
  from_text?: string;
  to_text?: string;
}

export interface DiffStats {
  added: number;
  removed: number;
  equal: number;
}

export interface PromptDiffResponse {
  prompt_id: string;
  from_version: number;
  to_version: number;
  from_content: string;
  to_content: string;
  hunks: DiffHunk[];
  stats: DiffStats;
}
```

- [ ] **Step 2: Add diff view to version history page**

In `versions/[id]/page.tsx`, add these state vars after `const [copied, setCopied] = useState(false)`:

```tsx
const [showDiff, setShowDiff] = useState(false);
const [diffFrom, setDiffFrom] = useState<number | null>(null);
```

Add diff query (after `sortedVersions` declaration):
```tsx
const { data: diffData, isFetching: diffLoading } = useQuery({
  queryKey: ['prompt-diff', params.id, diffFrom, activeVersion?.version],
  queryFn: async () => {
    const res = await api.get<{ data: PromptDiffResponse }>(
      `/api/v1/prompts/versions/${params.id}/diff`,
      { params: { from: diffFrom, to: activeVersion?.version } }
    );
    return res.data.data;
  },
  enabled: showDiff && diffFrom !== null && activeVersion !== null && diffFrom !== activeVersion?.version,
});
```

Add import at top:
```tsx
import type { PromptFamily, PromptVersion, PromptDiffResponse } from '@/types/api';
```

In the right panel header, after the copy/optimize buttons, add a Diff toggle:
```tsx
{sortedVersions.length > 1 && (
  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
    <select
      value={diffFrom ?? ''}
      onChange={e => {
        const v = parseInt(e.target.value, 10);
        setDiffFrom(isNaN(v) ? null : v);
        if (!isNaN(v)) setShowDiff(true);
      }}
      style={{ height: 28, padding: '0 8px', borderRadius: 6, fontSize: 12,
        border: '1px solid #2a2a2e', background: '#1a1a1a', color: '#b5b5ba',
        cursor: 'pointer', fontFamily: 'var(--font-geist-mono, monospace)' }}>
      <option value="">Diff from…</option>
      {sortedVersions
        .filter(v => v.version !== activeVersion?.version)
        .map(v => (
          <option key={v.version} value={v.version}>v{v.version}</option>
        ))}
    </select>
    {showDiff && diffFrom !== null && (
      <button type="button" onClick={() => { setShowDiff(false); setDiffFrom(null); }}
        style={{ height: 28, padding: '0 10px', borderRadius: 6, fontSize: 12,
          border: '1px solid rgba(255,107,122,0.3)', background: 'transparent',
          color: '#ff6b7a', cursor: 'pointer', fontFamily: 'var(--font-geist, ui-sans-serif)' }}>
        Clear
      </button>
    )}
  </div>
)}
```

Replace the content area (`<pre>` block) with a conditional:
```tsx
<div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
  {showDiff && diffData ? (
    <DiffView diff={diffData} />
  ) : (
    <pre style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 13,
      lineHeight: 1.8, color: '#ededed', whiteSpace: 'pre-wrap',
      wordBreak: 'break-word', margin: 0 }}>
      {activeVersion.content}
    </pre>
  )}
  {diffLoading && (
    <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11,
      color: '#5a5a60', marginTop: 12 }}>Computing diff…</div>
  )}
</div>
```

Add `DiffView` component in the same file (above the `export default`):

```tsx
function DiffView({ diff }: { diff: PromptDiffResponse }) {
  return (
    <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 13, lineHeight: 1.8 }}>
      {/* Stats bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16,
        padding: '8px 12px', borderRadius: 8, background: '#131316', border: '1px solid #1f1f23',
        fontSize: 11.5 }}>
        <span style={{ color: '#5a5a60' }}>
          v{diff.from_version} → v{diff.to_version}
        </span>
        <span style={{ color: '#22c55e' }}>+{diff.stats.added} added</span>
        <span style={{ color: '#ff6b7a' }}>−{diff.stats.removed} removed</span>
        <span style={{ color: '#5a5a60' }}>{diff.stats.equal} unchanged</span>
      </div>
      {/* Inline diff */}
      <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.9 }}>
        {diff.hunks.map((hunk, i) => {
          if (hunk.type === 'equal') {
            return <span key={i} style={{ color: '#8a8a90' }}>{hunk.text}</span>;
          }
          if (hunk.type === 'insert') {
            return (
              <span key={i} style={{ background: 'rgba(34,197,94,0.15)',
                color: '#22c55e', borderRadius: 2, padding: '0 1px' }}>
                {hunk.text}
              </span>
            );
          }
          if (hunk.type === 'delete') {
            return (
              <span key={i} style={{ background: 'rgba(255,107,122,0.15)',
                color: '#ff6b7a', textDecoration: 'line-through', borderRadius: 2, padding: '0 1px' }}>
                {hunk.text}
              </span>
            );
          }
          // replace: show old (red strikethrough) then new (green)
          return (
            <span key={i}>
              <span style={{ background: 'rgba(255,107,122,0.15)', color: '#ff6b7a',
                textDecoration: 'line-through', borderRadius: 2, padding: '0 1px' }}>
                {hunk.from_text}
              </span>
              <span style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e',
                borderRadius: 2, padding: '0 1px', marginLeft: 2 }}>
                {hunk.to_text}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run frontend type check**

```bash
cd frontend && npm run build 2>&1 | grep -E "error|Error" | grep -v Warning | head -20
```
Expected: no new TypeScript errors

---

### Task 7: Frontend — Template Types + Template Picker in Optimize

**Files:**
- Modify: `frontend/src/types/api.ts`
- Modify: `frontend/src/components/optimize/optimize-chat.tsx`

- [ ] **Step 1: Add template types to `api.ts`**

```typescript
export interface Template {
  id: string;
  category: string;
  name: string;
  description: string;
  content: string;
}

export interface TemplateCategoryGroup {
  category: string;
  templates: Template[];
}

export interface TemplateListResponse {
  categories: TemplateCategoryGroup[];
  total: number;
}
```

- [ ] **Step 2: Read optimize-chat.tsx to find the prompt input area**

Read `frontend/src/components/optimize/optimize-chat.tsx` — find where the input textarea and submit area are rendered.

- [ ] **Step 3: Add template picker button and modal**

In `optimize-chat.tsx`:
1. Add import: `import { useQuery } from '@tanstack/react-query';` (if not already present)
2. Add state: `const [showTemplates, setShowTemplates] = useState(false);`
3. Add query:
```tsx
const { data: templatesData } = useQuery({
  queryKey: ['templates'],
  queryFn: async () => {
    const res = await api.get<{ data: TemplateListResponse }>('/api/v1/templates');
    return res.data.data;
  },
  staleTime: Infinity, // templates never change at runtime
});
```
4. Add a "Templates" button next to the send button (or above the textarea) that sets `showTemplates(true)`
5. Render a `TemplatePickerModal` component (defined in the same file or a sibling file) that shows categories + templates; clicking a template sets the input value and closes the modal.

The `TemplatePickerModal`:
```tsx
function TemplatePickerModal({
  data,
  onSelect,
  onClose,
}: {
  data: TemplateListResponse;
  onSelect: (content: string) => void;
  onClose: () => void;
}) {
  const [activeCategory, setActiveCategory] = useState(data.categories[0]?.category ?? '');

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}>
      <div style={{ width: 640, maxHeight: '80vh', borderRadius: 14, background: '#141414',
        border: '1px solid #2a2a2e', display: 'flex', flexDirection: 'column',
        overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #1f1f23',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11,
            textTransform: 'uppercase', letterSpacing: '0.12em', color: '#7c5cff' }}>
            Prompt Templates
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none',
            cursor: 'pointer', color: '#5a5a60', fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
        {/* Category tabs */}
        <div style={{ display: 'flex', gap: 4, padding: '10px 16px',
          borderBottom: '1px solid #1f1f23', overflowX: 'auto' }}>
          {data.categories.map(g => (
            <button key={g.category} onClick={() => setActiveCategory(g.category)}
              style={{ padding: '4px 12px', borderRadius: 6, fontSize: 12,
                border: '1px solid transparent', cursor: 'pointer',
                background: activeCategory === g.category ? 'rgba(124,92,255,0.15)' : 'transparent',
                color: activeCategory === g.category ? '#7c5cff' : '#8a8a90',
                borderColor: activeCategory === g.category ? 'rgba(124,92,255,0.3)' : 'transparent',
                fontFamily: 'var(--font-geist-mono, monospace)',
                textTransform: 'capitalize', whiteSpace: 'nowrap' as const }}>
              {g.category.replace(/-/g, ' ')}
            </button>
          ))}
        </div>
        {/* Template list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex',
          flexDirection: 'column', gap: 6 }}>
          {(data.categories.find(g => g.category === activeCategory)?.templates ?? []).map(t => (
            <button key={t.id} onClick={() => { onSelect(t.content); onClose(); }}
              style={{ textAlign: 'left', padding: '12px 14px', borderRadius: 8,
                border: '1px solid #1f1f23', background: 'transparent', cursor: 'pointer',
                transition: 'background 120ms, border-color 120ms' }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(124,92,255,0.06)';
                e.currentTarget.style.borderColor = 'rgba(124,92,255,0.25)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.borderColor = '#1f1f23';
              }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#ededed', marginBottom: 4 }}>
                {t.name}
              </div>
              <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 11,
                color: '#5a5a60', lineHeight: 1.5 }}>
                {t.description}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Final build check**

```bash
cd frontend && npm run build 2>&1 | grep -E "^.*error" | grep -v Warning | head -20
```
Expected: no new errors

---

### Task 8: Final Verification

- [ ] **Step 1: Backend lint + typecheck clean**
```bash
cd qa-chatbot && make check 2>&1 | tail -10
```

- [ ] **Step 2: Verify diff endpoint URL pattern is correct**

`GET /api/v1/prompts/versions/{prompt_id}/diff?from=1&to=2` — confirm no route conflicts with existing `GET /api/v1/prompts/versions/{prompt_id}`

- [ ] **Step 3: Verify templates seeded**

Start dev server and check:
```bash
curl -s http://localhost:8000/api/v1/templates | python3 -m json.tool | head -40
```
Expected: JSON with `categories` array containing coding/writing/customer-support/analysis groups

- [ ] **Step 4: Commit**
```bash
git add qa-chatbot/src/app/utils/ qa-chatbot/src/app/seeds/ qa-chatbot/src/app/models/template.py \
  qa-chatbot/src/app/repositories/template_repo.py qa-chatbot/src/app/schemas/template.py \
  qa-chatbot/src/app/api/v1/templates.py qa-chatbot/src/app/api/router.py \
  qa-chatbot/src/app/migrations/versions/c4d5e6f7a8b9_add_templates.py \
  qa-chatbot/src/app/main.py qa-chatbot/src/app/schemas/prompt.py \
  qa-chatbot/src/app/repositories/prompt_version_repo.py qa-chatbot/src/app/api/v1/prompts.py \
  frontend/src/types/api.ts frontend/src/app/(dashboard)/versions/ \
  frontend/src/components/optimize/optimize-chat.tsx
git commit -m "feat: add prompt diff engine and prompt templates"
```
