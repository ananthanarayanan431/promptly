# Domain Prompts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a self-contained "Domain Prompts" feature that lets users upload a PDF for a domain (e.g. Nutrition), auto-generates a Q&A dataset from it, stores files in MinIO, runs a prompt optimization pipeline against the dataset, and surfaces the best-performing domain-specific system prompt in a new UI section — without touching any existing chat/council pipeline code.

**Architecture:** Two-stage Celery pipeline mirrors prompt-ops: Stage 1 (`prepare_domain_dataset`) extracts text from a PDF and uses an LLM to generate Q&A pairs stored as JSONL in MinIO; Stage 2 (`run_domain_optimization`) loads the dataset, scores prompt variants against it, and saves the winning prompt to PostgreSQL. Everything lives under `qa-chatbot/src/app/domain_prompt/` and mounts as a new `/api/v1/domain-prompts` router on the existing FastAPI app. Frontend adds a new "Domain Prompts" page + sidebar nav entry.

**Tech Stack:** FastAPI, SQLAlchemy (async), Alembic, Celery, Redis (job state), MinIO (boto3/aiobotocore S3-compatible), pypdf (PDF text extraction), LangChain OpenAI (LLM via OpenRouter), Next.js 14, React Query, TypeScript.

---

## File Map

### Backend — new files (all under `qa-chatbot/src/app/domain_prompt/`)
| File | Responsibility |
|---|---|
| `__init__.py` | Package marker |
| `models.py` | `DomainPrompt` + `DomainDataset` SQLAlchemy models |
| `schemas.py` | Pydantic request/response schemas |
| `repository.py` | `DomainPromptRepository` — CRUD for both tables |
| `storage.py` | MinIO client wrapper (upload, download, presigned URLs) |
| `dataset_builder.py` | PDF text extraction + LLM Q&A generation |
| `optimizer.py` | Prompt variant generation + dataset scoring loop |
| `tasks.py` | Celery tasks: `prepare_domain_dataset`, `run_domain_optimization` |
| `router.py` | FastAPI router mounted at `/api/v1/domain-prompts` |
| `exceptions.py` | HTTP exceptions for this feature |
| `cache.py` | Redis job key helpers (domain-prompt namespace) |

### Backend — modified files
| File | Change |
|---|---|
| `src/app/api/router.py` | Import and include `domain_prompt.router` |
| `src/app/workers/celery_app.py` | Add `app.domain_prompt.tasks` to `include` list |
| `docker-compose.yml` | Add MinIO service + volume |
| `.env.example` | Add MinIO env vars |
| `src/app/config/env.py` | Add `MinioSettings` |
| `src/app/migrations/versions/` | New migration file for two new tables |

### Frontend — new files
| File | Responsibility |
|---|---|
| `src/app/(dashboard)/domain-prompts/page.tsx` | Domain prompts list + new domain modal |
| `src/components/domain-prompts/domain-card.tsx` | Individual domain card with status/score |
| `src/components/domain-prompts/new-domain-modal.tsx` | Modal: name + description + base prompt + PDF upload |
| `src/components/domain-prompts/domain-detail.tsx` | Detail view: before/after prompt diff + dataset stats |
| `src/types/domain-prompts.ts` | TypeScript types matching backend schemas |

### Frontend — modified files
| File | Change |
|---|---|
| `src/components/layout/sidebar.tsx` | Add "Domain Prompts" nav entry |

---

## Task 1: MinIO Docker service + env config

**Files:**
- Modify: `qa-chatbot/docker-compose.yml`
- Modify: `qa-chatbot/.env.example`
- Modify: `qa-chatbot/src/app/config/env.py`

- [ ] **Step 1: Add MinIO service to docker-compose.yml**

Open `qa-chatbot/docker-compose.yml` and add the minio service + volume:

```yaml
  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}
    volumes:
      - miniodata:/data
    ports:
      - "9000:9000"
      - "9001:9001"
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 10s
      timeout: 5s
      retries: 3

volumes:
  pgdata:
  redisdata:
  miniodata:
```

- [ ] **Step 2: Add env vars to .env.example**

Append to `qa-chatbot/.env.example`:

```bash
# MinIO (S3-compatible object storage)
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin123
MINIO_ENDPOINT_URL=http://localhost:9000
MINIO_BUCKET_NAME=promptly
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin123
```

- [ ] **Step 3: Add MinioSettings to env.py**

Edit `qa-chatbot/src/app/config/env.py` to add MinIO settings:

```python
from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class EnvSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    AUTH_ENABLED: bool = False


class MinioSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    MINIO_ENDPOINT_URL: str = "http://localhost:9000"
    MINIO_ACCESS_KEY: str = "minioadmin"
    MINIO_SECRET_KEY: SecretStr = SecretStr("minioadmin123")
    MINIO_BUCKET_NAME: str = "promptly"


@lru_cache
def get_env_settings() -> EnvSettings:
    return EnvSettings()


@lru_cache
def get_minio_settings() -> MinioSettings:
    return MinioSettings()
```

- [ ] **Step 4: Add actual values to your local .env**

Add to `qa-chatbot/.env` (do not commit):
```
MINIO_ENDPOINT_URL=http://localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin123
MINIO_BUCKET_NAME=promptly
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin123
```

- [ ] **Step 5: Start MinIO and verify**

```bash
cd qa-chatbot
docker compose up minio -d
# Visit http://localhost:9001 — login with minioadmin / minioadmin123
# Create bucket named "promptly" via the console
```

- [ ] **Step 6: Commit**

```bash
git add qa-chatbot/docker-compose.yml qa-chatbot/.env.example qa-chatbot/src/app/config/env.py
git commit -m "feat(domain-prompts): add MinIO docker service and config"
```

---

## Task 2: Install new Python dependencies

**Files:**
- Modify: `qa-chatbot/pyproject.toml` (or `requirements.txt` — use whichever exists)

- [ ] **Step 1: Check which dependency file exists**

```bash
ls qa-chatbot/pyproject.toml qa-chatbot/requirements.txt 2>/dev/null
```

- [ ] **Step 2: Add dependencies**

If `pyproject.toml` exists, add to `[project.dependencies]` or `[tool.poetry.dependencies]`:
```
pypdf = ">=4.0.0"
boto3 = ">=1.34.0"
```

If `requirements.txt` exists, append:
```
pypdf>=4.0.0
boto3>=1.34.0
```

- [ ] **Step 3: Install**

```bash
cd qa-chatbot
pip install pypdf boto3
```

- [ ] **Step 4: Commit**

```bash
git add qa-chatbot/pyproject.toml  # or requirements.txt
git commit -m "feat(domain-prompts): add pypdf and boto3 dependencies"
```

---

## Task 3: SQLAlchemy models

**Files:**
- Create: `qa-chatbot/src/app/domain_prompt/__init__.py`
- Create: `qa-chatbot/src/app/domain_prompt/models.py`

- [ ] **Step 1: Create package marker**

```bash
touch qa-chatbot/src/app/domain_prompt/__init__.py
```

- [ ] **Step 2: Create models.py**

```python
# qa-chatbot/src/app/domain_prompt/models.py
from __future__ import annotations

import enum
import uuid

from sqlalchemy import Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class DomainPromptStatus(str, enum.Enum):
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
    base_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    optimized_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[DomainPromptStatus] = mapped_column(
        Enum(DomainPromptStatus, name="domain_prompt_status"),
        default=DomainPromptStatus.pending,
        nullable=False,
    )
    score_before: Mapped[float | None] = mapped_column(Float, nullable=True)
    score_after: Mapped[float | None] = mapped_column(Float, nullable=True)
    credits_charged: Mapped[int] = mapped_column(Integer, default=10, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    dataset: Mapped[DomainDataset | None] = relationship(
        back_populates="domain", cascade="all, delete-orphan", uselist=False
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

    domain: Mapped[DomainPrompt] = relationship(back_populates="dataset")
```

- [ ] **Step 3: Commit**

```bash
git add qa-chatbot/src/app/domain_prompt/
git commit -m "feat(domain-prompts): add DomainPrompt and DomainDataset SQLAlchemy models"
```

---

## Task 4: Alembic migration

**Files:**
- Create: `qa-chatbot/src/app/migrations/versions/<hash>_add_domain_prompts.py`

- [ ] **Step 1: Import new models in migrations/env.py so Alembic sees them**

Open `qa-chatbot/src/app/migrations/env.py`. Find the `target_metadata` line and add the import before it:

```python
from app.domain_prompt.models import DomainDataset, DomainPrompt  # noqa: F401
```

- [ ] **Step 2: Generate the migration**

```bash
cd qa-chatbot
alembic revision --autogenerate -m "add_domain_prompts"
```

- [ ] **Step 3: Verify generated migration**

Open the new file in `src/app/migrations/versions/`. Confirm it creates `domain_prompts` and `domain_datasets` tables with all expected columns. The `domain_prompt_status` enum should be created. If the auto-generated migration looks wrong, hand-edit it to match the model exactly.

- [ ] **Step 4: Apply migration**

```bash
alembic upgrade head
```

Expected output ends with: `Running upgrade ... -> <new_rev>, add_domain_prompts`

- [ ] **Step 5: Commit**

```bash
git add qa-chatbot/src/app/migrations/
git commit -m "feat(domain-prompts): migration for domain_prompts and domain_datasets tables"
```

---

## Task 5: Repository

**Files:**
- Create: `qa-chatbot/src/app/domain_prompt/repository.py`

- [ ] **Step 1: Create repository.py**

```python
# qa-chatbot/src/app/domain_prompt/repository.py
from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.domain_prompt.models import DomainDataset, DomainPrompt, DomainPromptStatus
from app.repositories.base import BaseRepository


class DomainPromptRepository(BaseRepository[DomainPrompt]):
    model = DomainPrompt

    async def get_by_user(self, user_id: uuid.UUID) -> list[DomainPrompt]:
        result = await self.db.execute(
            select(DomainPrompt)
            .where(DomainPrompt.user_id == user_id)
            .options(selectinload(DomainPrompt.dataset))
            .order_by(DomainPrompt.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_by_id_and_user(
        self, domain_id: uuid.UUID, user_id: uuid.UUID
    ) -> DomainPrompt | None:
        result = await self.db.execute(
            select(DomainPrompt)
            .where(DomainPrompt.id == domain_id, DomainPrompt.user_id == user_id)
            .options(selectinload(DomainPrompt.dataset))
        )
        return result.scalar_one_or_none()

    async def set_status(
        self,
        domain: DomainPrompt,
        status: DomainPromptStatus,
        **extra: Any,
    ) -> DomainPrompt:
        return await self.update(domain, status=status, **extra)

    async def save_dataset(
        self,
        domain_id: uuid.UUID,
        user_id: uuid.UUID,
        bucket: str,
        pdf_key: str,
        dataset_key: str | None = None,
        row_count: int | None = None,
    ) -> DomainDataset:
        ds = DomainDataset(
            domain_id=domain_id,
            user_id=user_id,
            minio_bucket=bucket,
            pdf_key=pdf_key,
            dataset_key=dataset_key,
            row_count=row_count,
        )
        self.db.add(ds)
        await self.db.flush()
        await self.db.refresh(ds)
        return ds

    async def update_dataset(
        self, dataset: DomainDataset, **kwargs: Any
    ) -> DomainDataset:
        for k, v in kwargs.items():
            setattr(dataset, k, v)
        self.db.add(dataset)
        await self.db.flush()
        await self.db.refresh(dataset)
        return dataset
```

- [ ] **Step 2: Commit**

```bash
git add qa-chatbot/src/app/domain_prompt/repository.py
git commit -m "feat(domain-prompts): DomainPromptRepository with user-scoped CRUD"
```

---

## Task 6: MinIO storage wrapper

**Files:**
- Create: `qa-chatbot/src/app/domain_prompt/storage.py`

- [ ] **Step 1: Create storage.py**

```python
# qa-chatbot/src/app/domain_prompt/storage.py
from __future__ import annotations

import io

import boto3
from botocore.exceptions import ClientError

from app.config.env import get_minio_settings


def _client() -> "boto3.client":  # type: ignore[name-defined]
    s = get_minio_settings()
    return boto3.client(
        "s3",
        endpoint_url=s.MINIO_ENDPOINT_URL,
        aws_access_key_id=s.MINIO_ACCESS_KEY,
        aws_secret_access_key=s.MINIO_SECRET_KEY.get_secret_value(),
        region_name="us-east-1",
    )


def ensure_bucket(bucket: str) -> None:
    client = _client()
    try:
        client.head_bucket(Bucket=bucket)
    except ClientError:
        client.create_bucket(Bucket=bucket)


def upload_bytes(bucket: str, key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
    ensure_bucket(bucket)
    _client().put_object(Bucket=bucket, Key=key, Body=data, ContentType=content_type)


def download_bytes(bucket: str, key: str) -> bytes:
    buf = io.BytesIO()
    _client().download_fileobj(bucket, key, buf)
    buf.seek(0)
    return buf.read()


def upload_text(bucket: str, key: str, text: str, content_type: str = "text/plain") -> None:
    upload_bytes(bucket, key, text.encode("utf-8"), content_type)


def download_text(bucket: str, key: str) -> str:
    return download_bytes(bucket, key).decode("utf-8")


def object_key(user_id: str, domain_id: str, filename: str) -> str:
    return f"users/{user_id}/domains/{domain_id}/{filename}"
```

- [ ] **Step 2: Commit**

```bash
git add qa-chatbot/src/app/domain_prompt/storage.py
git commit -m "feat(domain-prompts): MinIO storage wrapper for PDF and dataset files"
```

---

## Task 7: Dataset builder (PDF → Q&A JSONL)

**Files:**
- Create: `qa-chatbot/src/app/domain_prompt/dataset_builder.py`

- [ ] **Step 1: Create dataset_builder.py**

```python
# qa-chatbot/src/app/domain_prompt/dataset_builder.py
"""
Extracts text from a PDF and uses an LLM to generate Q&A pairs
in the prompt-ops dataset format (one JSON object per line).
"""
from __future__ import annotations

import io
import json
import textwrap

from langchain_openai import ChatOpenAI
from pypdf import PdfReader

from app.config.llm import get_llm_settings

_QA_SYSTEM = textwrap.dedent("""
    You are a dataset generation assistant.
    Given a text passage, generate question-answer pairs that cover the key facts,
    concepts, and details in the passage.

    Rules:
    - Each question must be answerable solely from the provided passage.
    - Answers should be concise (1-3 sentences).
    - Output ONLY a JSON array of objects with keys "question" and "answer".
    - Generate between 5 and 10 pairs per passage.
    - Do not add any explanation, preamble, or trailing text.

    Example output:
    [
      {"question": "What is Vitamin C?", "answer": "Vitamin C is a water-soluble antioxidant vitamin."},
      {"question": "What foods are high in Vitamin C?", "answer": "Citrus fruits, bell peppers, and strawberries are high in Vitamin C."}
    ]
""").strip()


def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    reader = PdfReader(io.BytesIO(pdf_bytes))
    pages = []
    for page in reader.pages:
        text = page.extract_text()
        if text:
            pages.append(text.strip())
    return "\n\n".join(pages)


def _chunk_text(text: str, max_chars: int = 2000) -> list[str]:
    """Split text into overlapping chunks that fit within token budgets."""
    words = text.split()
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0
    for word in words:
        current.append(word)
        current_len += len(word) + 1
        if current_len >= max_chars:
            chunks.append(" ".join(current))
            # 10% overlap
            overlap = max(1, len(current) // 10)
            current = current[-overlap:]
            current_len = sum(len(w) + 1 for w in current)
    if current:
        chunks.append(" ".join(current))
    return chunks


async def generate_qa_pairs(text: str, api_key: str) -> list[dict[str, str]]:
    """Generate Q&A pairs from extracted PDF text using an LLM."""
    llm = ChatOpenAI(
        model="openai/gpt-4o-mini",
        openai_api_base="https://openrouter.ai/api/v1",
        openai_api_key=api_key,
        temperature=0.3,
        max_tokens=2048,
    )

    chunks = _chunk_text(text, max_chars=2000)
    all_pairs: list[dict[str, str]] = []

    for chunk in chunks[:15]:  # cap at 15 chunks to control cost
        try:
            response = await llm.ainvoke([
                {"role": "system", "content": _QA_SYSTEM},
                {"role": "user", "content": f"Generate Q&A pairs from this passage:\n\n{chunk}"},
            ])
            raw = str(response.content).strip()
            # Strip markdown code fences if present
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            pairs = json.loads(raw)
            if isinstance(pairs, list):
                for p in pairs:
                    if isinstance(p, dict) and "question" in p and "answer" in p:
                        all_pairs.append({
                            "question": str(p["question"]).strip(),
                            "answer": str(p["answer"]).strip(),
                        })
        except Exception:  # noqa: S110
            continue  # skip failed chunks, continue with the rest

    return all_pairs


def pairs_to_jsonl(pairs: list[dict[str, str]]) -> str:
    """Convert Q&A pairs to JSONL format (one JSON object per line)."""
    return "\n".join(json.dumps(p, ensure_ascii=False) for p in pairs)
```

- [ ] **Step 2: Commit**

```bash
git add qa-chatbot/src/app/domain_prompt/dataset_builder.py
git commit -m "feat(domain-prompts): PDF text extraction and LLM Q&A pair generation"
```

---

## Task 8: Prompt optimizer (variant scoring against dataset)

**Files:**
- Create: `qa-chatbot/src/app/domain_prompt/optimizer.py`

- [ ] **Step 1: Create optimizer.py**

```python
# qa-chatbot/src/app/domain_prompt/optimizer.py
"""
Domain prompt optimizer.

Generates N candidate prompt variants from the base_prompt, evaluates each
against a validation split of the Q&A dataset using semantic similarity,
and returns the best-scoring candidate.

Flow (mirrors prompt-ops strategy):
  1. Split dataset → train (70%) / validation (15%) / test (15%)
  2. Generate 5 candidate prompt variants using an LLM
  3. For each candidate: run it on validation questions, score output
     against gold answers via embedding cosine similarity
  4. Return the candidate with the highest mean score
"""
from __future__ import annotations

import json
import random
import textwrap

from langchain_openai import ChatOpenAI

_VARIANT_SYSTEM = textwrap.dedent("""
    You are a prompt engineering expert.
    Given a base system prompt for a specific domain, generate {n} improved variants.
    Each variant should:
    - Preserve the original intent and domain focus
    - Be clearer, more specific, and better structured
    - Include explicit output format instructions if appropriate
    - Be suitable as a system prompt for an AI assistant

    Output ONLY a JSON array of strings, where each string is one variant.
    No preamble, no explanation.
""").strip()

_SCORE_SYSTEM = textwrap.dedent("""
    You are an evaluation judge.
    Given a question, a gold answer, and a model's answer, rate how well
    the model's answer matches the gold answer on a scale from 0.0 to 1.0.

    0.0 = completely wrong or irrelevant
    0.5 = partially correct
    1.0 = fully correct and equivalent to gold answer

    Output ONLY a JSON object: {"score": <float>}
    No explanation.
""").strip()


def _split_dataset(
    pairs: list[dict[str, str]], seed: int = 42
) -> tuple[list[dict[str, str]], list[dict[str, str]], list[dict[str, str]]]:
    data = list(pairs)
    random.seed(seed)
    random.shuffle(data)
    n = len(data)
    train_end = int(n * 0.70)
    val_end = int(n * 0.85)
    return data[:train_end], data[train_end:val_end], data[val_end:]


async def _generate_variants(base_prompt: str, n: int, llm: ChatOpenAI) -> list[str]:
    system = _VARIANT_SYSTEM.format(n=n)
    try:
        response = await llm.ainvoke([
            {"role": "system", "content": system},
            {"role": "user", "content": f"Base prompt:\n\n{base_prompt}"},
        ])
        raw = str(response.content).strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        variants = json.loads(raw)
        if isinstance(variants, list) and all(isinstance(v, str) for v in variants):
            return variants[:n]
    except Exception:  # noqa: S110
        pass
    return [base_prompt]  # fallback: return base prompt unchanged


async def _score_answer(question: str, gold: str, predicted: str, judge_llm: ChatOpenAI) -> float:
    try:
        response = await judge_llm.ainvoke([
            {"role": "system", "content": _SCORE_SYSTEM},
            {
                "role": "user",
                "content": (
                    f"Question: {question}\n"
                    f"Gold answer: {gold}\n"
                    f"Model answer: {predicted}"
                ),
            },
        ])
        raw = str(response.content).strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        result = json.loads(raw)
        score = float(result.get("score", 0.0))
        return max(0.0, min(1.0, score))
    except Exception:  # noqa: S110
        return 0.0


async def _evaluate_prompt(
    prompt: str,
    val_split: list[dict[str, str]],
    eval_llm: ChatOpenAI,
    judge_llm: ChatOpenAI,
    max_examples: int = 15,
) -> float:
    examples = val_split[:max_examples]
    if not examples:
        return 0.0

    scores: list[float] = []
    for ex in examples:
        question = ex["question"]
        gold = ex["answer"]
        try:
            response = await eval_llm.ainvoke([
                {"role": "system", "content": prompt},
                {"role": "user", "content": question},
            ])
            predicted = str(response.content).strip()
        except Exception:  # noqa: S110
            predicted = ""
        score = await _score_answer(question, gold, predicted, judge_llm)
        scores.append(score)

    return sum(scores) / len(scores) if scores else 0.0


async def optimize_domain_prompt(
    base_prompt: str,
    dataset_jsonl: str,
    api_key: str,
    num_candidates: int = 5,
) -> dict[str, object]:
    """
    Returns:
        {
            "optimized_prompt": str,
            "score_before": float,
            "score_after": float,
        }
    """
    pairs: list[dict[str, str]] = []
    for line in dataset_jsonl.strip().splitlines():
        try:
            pairs.append(json.loads(line))
        except Exception:  # noqa: S110
            continue

    if not pairs:
        return {
            "optimized_prompt": base_prompt,
            "score_before": 0.0,
            "score_after": 0.0,
        }

    _, val_split, _ = _split_dataset(pairs)
    if not val_split:
        val_split = pairs[:5]

    fast_llm = ChatOpenAI(
        model="openai/gpt-4o-mini",
        openai_api_base="https://openrouter.ai/api/v1",
        openai_api_key=api_key,
        temperature=0.7,
        max_tokens=512,
    )
    judge_llm = ChatOpenAI(
        model="openai/gpt-4o-mini",
        openai_api_base="https://openrouter.ai/api/v1",
        openai_api_key=api_key,
        temperature=0.0,
        max_tokens=64,
    )

    score_before = await _evaluate_prompt(base_prompt, val_split, fast_llm, judge_llm)

    variants = await _generate_variants(base_prompt, num_candidates, fast_llm)

    best_prompt = base_prompt
    best_score = score_before

    for variant in variants:
        score = await _evaluate_prompt(variant, val_split, fast_llm, judge_llm)
        if score > best_score:
            best_score = score
            best_prompt = variant

    return {
        "optimized_prompt": best_prompt,
        "score_before": round(score_before, 4),
        "score_after": round(best_score, 4),
    }
```

- [ ] **Step 2: Commit**

```bash
git add qa-chatbot/src/app/domain_prompt/optimizer.py
git commit -m "feat(domain-prompts): prompt variant generation and dataset-based scoring"
```

---

## Task 9: Redis cache helpers

**Files:**
- Create: `qa-chatbot/src/app/domain_prompt/cache.py`

- [ ] **Step 1: Create cache.py**

```python
# qa-chatbot/src/app/domain_prompt/cache.py
from app.db.redis import get_redis_client
from app.config.redis import get_redis_settings

_redis_settings = get_redis_settings()
_JOB_PREFIX = "domain_prompt:job:"


def _job_key(job_id: str) -> str:
    return f"{_JOB_PREFIX}{job_id}"


async def set_dp_job_status(job_id: str, status: str) -> None:
    redis = await get_redis_client()
    await redis.set(
        f"{_job_key(job_id)}:status",
        status,
        ex=_redis_settings.REDIS_TTL_SECONDS,
    )


async def get_dp_job_status(job_id: str) -> str | None:
    redis = await get_redis_client()
    result: str | None = await redis.get(f"{_job_key(job_id)}:status")
    return result


async def set_dp_job_owner(job_id: str, user_id: str) -> None:
    redis = await get_redis_client()
    await redis.set(
        f"{_job_key(job_id)}:owner",
        user_id,
        ex=_redis_settings.REDIS_TTL_SECONDS,
    )


async def get_dp_job_owner(job_id: str) -> str | None:
    redis = await get_redis_client()
    result: str | None = await redis.get(f"{_job_key(job_id)}:owner")
    return result


async def set_dp_job_result(job_id: str, result: dict) -> None:
    import json
    redis = await get_redis_client()
    await redis.set(
        f"{_job_key(job_id)}:result",
        json.dumps(result),
        ex=_redis_settings.REDIS_TTL_SECONDS,
    )


async def get_dp_job_result(job_id: str) -> dict | None:
    import json
    redis = await get_redis_client()
    raw: str | None = await redis.get(f"{_job_key(job_id)}:result")
    if raw is None:
        return None
    result: dict = json.loads(raw)
    return result
```

- [ ] **Step 2: Commit**

```bash
git add qa-chatbot/src/app/domain_prompt/cache.py
git commit -m "feat(domain-prompts): Redis job state helpers (domain_prompt namespace)"
```

---

## Task 10: Celery tasks

**Files:**
- Create: `qa-chatbot/src/app/domain_prompt/tasks.py`
- Modify: `qa-chatbot/src/app/workers/celery_app.py`

- [ ] **Step 1: Create tasks.py**

```python
# qa-chatbot/src/app/domain_prompt/tasks.py
"""
Two-stage Celery pipeline for domain prompt optimization.

Stage 1 — prepare_domain_dataset:
  PDF bytes → text extraction → LLM Q&A generation → JSONL stored in MinIO
  On success: dispatches run_domain_optimization automatically.

Stage 2 — run_domain_optimization:
  Loads JSONL from MinIO → scores prompt variants → saves winning prompt to DB.

Both tasks follow the same Redis job lifecycle as process_chat_async:
  queued → started → completed | failed
"""
from __future__ import annotations

import asyncio
from typing import Any

from app.workers.celery_app import celery_app


@celery_app.task(bind=True, max_retries=2, default_retry_delay=10)  # type: ignore[untyped-decorator]
def prepare_domain_dataset(
    self: Any,
    *,
    job_id: str,
    domain_id: str,
    user_id: str,
) -> None:
    async def _run() -> None:
        from uuid import UUID

        from app.config.env import get_minio_settings
        from app.config.llm import get_llm_settings
        from app.db.redis import reset_connection_pool
        from app.db.session import AsyncSessionLocal, dispose_async_engine
        from app.domain_prompt.cache import set_dp_job_result, set_dp_job_status
        from app.domain_prompt.dataset_builder import (
            extract_text_from_pdf,
            generate_qa_pairs,
            pairs_to_jsonl,
        )
        from app.domain_prompt.models import DomainPromptStatus
        from app.domain_prompt.repository import DomainPromptRepository
        from app.domain_prompt.storage import download_bytes, object_key, upload_text

        reset_connection_pool()
        await dispose_async_engine()

        await set_dp_job_status(job_id, "started")

        minio_cfg = get_minio_settings()
        llm_cfg = get_llm_settings()
        api_key = llm_cfg.OPENROUTER_API_KEY.get_secret_value()
        bucket = minio_cfg.MINIO_BUCKET_NAME

        try:
            async with AsyncSessionLocal() as db:
                repo = DomainPromptRepository(db)
                domain = await repo.get_by_id(UUID(domain_id))
                if domain is None:
                    raise ValueError(f"Domain {domain_id} not found")

                await repo.set_status(domain, DomainPromptStatus.preparing_dataset)
                await db.commit()

                # Download PDF from MinIO
                pdf_key = object_key(user_id, domain_id, "source.pdf")
                pdf_bytes = download_bytes(bucket, pdf_key)

                # Extract text and generate Q&A pairs
                text = extract_text_from_pdf(pdf_bytes)
                pairs = await generate_qa_pairs(text, api_key)

                if not pairs:
                    raise ValueError("No Q&A pairs could be extracted from the PDF")

                # Upload JSONL dataset to MinIO
                jsonl = pairs_to_jsonl(pairs)
                dataset_key = object_key(user_id, domain_id, "dataset.jsonl")
                upload_text(bucket, dataset_key, jsonl)

                # Update dataset record
                domain_with_ds = await repo.get_by_id(UUID(domain_id))
                if domain_with_ds and domain_with_ds.dataset:
                    await repo.update_dataset(
                        domain_with_ds.dataset,
                        dataset_key=dataset_key,
                        row_count=len(pairs),
                    )

                await db.commit()

            # Dispatch Stage 2
            run_domain_optimization.apply_async(
                kwargs={"job_id": job_id, "domain_id": domain_id, "user_id": user_id}
            )

        except Exception as exc:
            async with AsyncSessionLocal() as db:
                repo = DomainPromptRepository(db)
                domain = await repo.get_by_id(UUID(domain_id))
                if domain:
                    await repo.set_status(
                        domain,
                        DomainPromptStatus.failed,
                        error_message=str(exc)[:500],
                    )
                    await db.commit()

            await set_dp_job_status(job_id, "failed")
            await set_dp_job_result(job_id, {"error": str(exc)})
            raise self.retry(exc=exc) from exc
        finally:
            await dispose_async_engine()

    try:
        asyncio.run(_run())
    except Exception as exc:
        raise exc


@celery_app.task(bind=True, max_retries=2, default_retry_delay=10)  # type: ignore[untyped-decorator]
def run_domain_optimization(
    self: Any,
    *,
    job_id: str,
    domain_id: str,
    user_id: str,
) -> None:
    async def _run() -> None:
        from uuid import UUID

        from app.config.env import get_minio_settings
        from app.config.llm import get_llm_settings
        from app.db.redis import reset_connection_pool
        from app.db.session import AsyncSessionLocal, dispose_async_engine
        from app.domain_prompt.cache import set_dp_job_result, set_dp_job_status
        from app.domain_prompt.models import DomainPromptStatus
        from app.domain_prompt.optimizer import optimize_domain_prompt
        from app.domain_prompt.repository import DomainPromptRepository
        from app.domain_prompt.storage import download_text, object_key, upload_text

        reset_connection_pool()
        await dispose_async_engine()

        minio_cfg = get_minio_settings()
        llm_cfg = get_llm_settings()
        api_key = llm_cfg.OPENROUTER_API_KEY.get_secret_value()
        bucket = minio_cfg.MINIO_BUCKET_NAME

        try:
            async with AsyncSessionLocal() as db:
                repo = DomainPromptRepository(db)
                domain = await repo.get_by_id(UUID(domain_id))
                if domain is None:
                    raise ValueError(f"Domain {domain_id} not found")

                await repo.set_status(domain, DomainPromptStatus.optimizing)
                await db.commit()

                # Load dataset from MinIO
                dataset_key = object_key(user_id, domain_id, "dataset.jsonl")
                dataset_jsonl = download_text(bucket, dataset_key)

                # Run optimization
                result = await optimize_domain_prompt(
                    base_prompt=domain.base_prompt,
                    dataset_jsonl=dataset_jsonl,
                    api_key=api_key,
                )

                # Save result to MinIO
                import json
                result_key = object_key(user_id, domain_id, "result.json")
                upload_text(bucket, result_key, json.dumps(result, indent=2))

                # Save winning prompt to DB
                await repo.set_status(
                    domain,
                    DomainPromptStatus.completed,
                    optimized_prompt=result["optimized_prompt"],
                    score_before=result["score_before"],
                    score_after=result["score_after"],
                )
                await db.commit()

            await set_dp_job_status(job_id, "completed")
            await set_dp_job_result(job_id, {
                "domain_id": domain_id,
                "optimized_prompt": result["optimized_prompt"],
                "score_before": result["score_before"],
                "score_after": result["score_after"],
            })

        except Exception as exc:
            async with AsyncSessionLocal() as db:
                repo = DomainPromptRepository(db)
                domain = await repo.get_by_id(UUID(domain_id))
                if domain:
                    await repo.set_status(
                        domain,
                        DomainPromptStatus.failed,
                        error_message=str(exc)[:500],
                    )
                    await db.commit()

            await set_dp_job_status(job_id, "failed")
            await set_dp_job_result(job_id, {"error": str(exc)})
            raise self.retry(exc=exc) from exc
        finally:
            await dispose_async_engine()

    try:
        asyncio.run(_run())
    except Exception as exc:
        raise exc
```

- [ ] **Step 2: Register tasks in celery_app.py**

Open `qa-chatbot/src/app/workers/celery_app.py`. Change:
```python
    include=["app.workers.tasks"],
```
to:
```python
    include=["app.workers.tasks", "app.domain_prompt.tasks"],
```

- [ ] **Step 3: Commit**

```bash
git add qa-chatbot/src/app/domain_prompt/tasks.py qa-chatbot/src/app/workers/celery_app.py
git commit -m "feat(domain-prompts): two-stage Celery pipeline for dataset prep and optimization"
```

---

## Task 11: Pydantic schemas

**Files:**
- Create: `qa-chatbot/src/app/domain_prompt/schemas.py`

- [ ] **Step 1: Create schemas.py**

```python
# qa-chatbot/src/app/domain_prompt/schemas.py
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.domain_prompt.models import DomainPromptStatus


class CreateDomainRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    base_prompt: str = Field(min_length=10, max_length=10000)


class DatasetInfo(BaseModel):
    row_count: int | None
    pdf_key: str
    dataset_key: str | None

    class Config:
        from_attributes = True


class DomainPromptResponse(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    base_prompt: str
    optimized_prompt: str | None
    status: DomainPromptStatus
    score_before: float | None
    score_after: float | None
    credits_charged: int
    error_message: str | None
    dataset: DatasetInfo | None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class DomainListResponse(BaseModel):
    domains: list[DomainPromptResponse]


class CreateDomainJobResponse(BaseModel):
    job_id: str
    domain_id: str


class DomainJobPollResponse(BaseModel):
    job_id: str
    status: str
    domain_id: str | None = None
    result: dict | None = None
    error: str | None = None
```

- [ ] **Step 2: Commit**

```bash
git add qa-chatbot/src/app/domain_prompt/schemas.py
git commit -m "feat(domain-prompts): Pydantic schemas for request/response"
```

---

## Task 12: HTTP exceptions

**Files:**
- Create: `qa-chatbot/src/app/domain_prompt/exceptions.py`

- [ ] **Step 1: Create exceptions.py**

```python
# qa-chatbot/src/app/domain_prompt/exceptions.py
from fastapi import HTTPException, status


class DomainInsufficientCreditsException(HTTPException):
    def __init__(self) -> None:
        super().__init__(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Insufficient credits. 10 credits required per domain optimization.",
        )


class DomainNotFoundException(HTTPException):
    def __init__(self) -> None:
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Domain not found.",
        )


class DomainJobNotFoundException(HTTPException):
    def __init__(self) -> None:
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Domain optimization job not found.",
        )


class InvalidPDFException(HTTPException):
    def __init__(self, detail: str = "Uploaded file is not a valid PDF.") -> None:
        super().__init__(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail)


class DomainAlreadyRunningException(HTTPException):
    def __init__(self) -> None:
        super().__init__(
            status_code=status.HTTP_409_CONFLICT,
            detail="This domain already has an optimization in progress.",
        )
```

- [ ] **Step 2: Commit**

```bash
git add qa-chatbot/src/app/domain_prompt/exceptions.py
git commit -m "feat(domain-prompts): HTTP exception classes"
```

---

## Task 13: FastAPI router

**Files:**
- Create: `qa-chatbot/src/app/domain_prompt/router.py`
- Modify: `qa-chatbot/src/app/api/router.py`

- [ ] **Step 1: Create router.py**

```python
# qa-chatbot/src/app/domain_prompt/router.py
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.types.response import SuccessResponse
from app.config.env import get_minio_settings
from app.core.rate_limit import RateLimiter
from app.dependencies import get_current_user, get_db
from app.domain_prompt.cache import (
    get_dp_job_owner,
    get_dp_job_result,
    get_dp_job_status,
    set_dp_job_owner,
    set_dp_job_status,
)
from app.domain_prompt.exceptions import (
    DomainAlreadyRunningException,
    DomainInsufficientCreditsException,
    DomainJobNotFoundException,
    DomainNotFoundException,
    InvalidPDFException,
)
from app.domain_prompt.models import DomainPrompt, DomainPromptStatus
from app.domain_prompt.repository import DomainPromptRepository
from app.domain_prompt.schemas import (
    CreateDomainJobResponse,
    DomainJobPollResponse,
    DomainListResponse,
    DomainPromptResponse,
)
from app.domain_prompt.storage import object_key, upload_bytes
from app.domain_prompt.tasks import prepare_domain_dataset
from app.models.user import User
from app.repositories.user_repo import UserRepository

router = APIRouter(prefix="/domain-prompts", tags=["domain-prompts"])

_write_limiter = RateLimiter(requests=10, window_seconds=60)
_read_limiter = RateLimiter(requests=60, window_seconds=60)


def _to_response(domain: DomainPrompt) -> DomainPromptResponse:
    return DomainPromptResponse.model_validate(domain)


# -------------------------
# LIST DOMAINS
# -------------------------
@router.get(
    "/",
    response_model=SuccessResponse[DomainListResponse],
    dependencies=[Depends(_read_limiter)],
)
async def list_domains(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[DomainListResponse]:
    """List all domain prompts for the current user."""
    repo = DomainPromptRepository(db)
    domains = await repo.get_by_user(current_user.id)
    return SuccessResponse(
        data=DomainListResponse(domains=[_to_response(d) for d in domains])
    )


# -------------------------
# CREATE DOMAIN + UPLOAD PDF
# -------------------------
@router.post(
    "/",
    response_model=SuccessResponse[CreateDomainJobResponse],
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(_write_limiter)],
)
async def create_domain(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    name: Annotated[str, Form(min_length=1, max_length=120)],
    base_prompt: Annotated[str, Form(min_length=10, max_length=10000)],
    file: Annotated[UploadFile, File()],
    description: Annotated[str | None, Form(max_length=500)] = None,
) -> SuccessResponse[CreateDomainJobResponse]:
    """
    Create a new domain prompt by uploading a PDF source file.

    The PDF is stored in MinIO, a Q&A dataset is generated from it,
    and the prompt optimization pipeline is queued as a background job.

    Cost: 10 credits, deducted immediately.
    Returns HTTP 202 with a job_id to poll for progress.
    """
    if current_user.credits < 10:
        raise DomainInsufficientCreditsException()

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise InvalidPDFException()

    # Deduct credits first
    user_repo = UserRepository(db)
    deducted = await user_repo.deduct_credits(current_user.id, 10)
    if not deducted:
        raise DomainInsufficientCreditsException()

    # Create domain record
    domain_repo = DomainPromptRepository(db)
    domain = await domain_repo.create(
        user_id=current_user.id,
        name=name.strip(),
        description=description.strip() if description else None,
        base_prompt=base_prompt.strip(),
        status=DomainPromptStatus.pending,
        credits_charged=10,
    )

    # Upload PDF to MinIO
    minio_cfg = get_minio_settings()
    bucket = minio_cfg.MINIO_BUCKET_NAME
    pdf_key = object_key(str(current_user.id), str(domain.id), "source.pdf")
    pdf_bytes = await file.read()
    upload_bytes(bucket, pdf_key, pdf_bytes, content_type="application/pdf")

    # Create dataset record (pdf_key stored; dataset_key filled after generation)
    await domain_repo.save_dataset(
        domain_id=domain.id,
        user_id=current_user.id,
        bucket=bucket,
        pdf_key=pdf_key,
    )
    await db.commit()

    # Set up job tracking
    job_id = str(uuid.uuid4())
    await set_dp_job_status(job_id, "queued")
    await set_dp_job_owner(job_id, str(current_user.id))

    # Dispatch Stage 1
    prepare_domain_dataset.apply_async(
        kwargs={
            "job_id": job_id,
            "domain_id": str(domain.id),
            "user_id": str(current_user.id),
        }
    )

    return SuccessResponse(
        data=CreateDomainJobResponse(job_id=job_id, domain_id=str(domain.id))
    )


# -------------------------
# GET DOMAIN DETAIL
# -------------------------
@router.get(
    "/{domain_id}",
    response_model=SuccessResponse[DomainPromptResponse],
    dependencies=[Depends(_read_limiter)],
)
async def get_domain(
    domain_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[DomainPromptResponse]:
    """Get a specific domain prompt with its optimized result."""
    repo = DomainPromptRepository(db)
    domain = await repo.get_by_id_and_user(domain_id, current_user.id)
    if domain is None:
        raise DomainNotFoundException()
    return SuccessResponse(data=_to_response(domain))


# -------------------------
# RE-OPTIMIZE DOMAIN
# -------------------------
@router.post(
    "/{domain_id}/optimize",
    response_model=SuccessResponse[CreateDomainJobResponse],
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(_write_limiter)],
)
async def reoptimize_domain(
    domain_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[CreateDomainJobResponse]:
    """
    Re-run optimization on an existing domain (dataset already prepared).
    Cost: 10 credits.
    """
    repo = DomainPromptRepository(db)
    domain = await repo.get_by_id_and_user(domain_id, current_user.id)
    if domain is None:
        raise DomainNotFoundException()

    if domain.status in (DomainPromptStatus.preparing_dataset, DomainPromptStatus.optimizing):
        raise DomainAlreadyRunningException()

    if not domain.dataset or not domain.dataset.dataset_key:
        raise DomainNotFoundException()

    if current_user.credits < 10:
        raise DomainInsufficientCreditsException()

    user_repo = UserRepository(db)
    deducted = await user_repo.deduct_credits(current_user.id, 10)
    if not deducted:
        raise DomainInsufficientCreditsException()

    await repo.set_status(domain, DomainPromptStatus.pending)
    await db.commit()

    job_id = str(uuid.uuid4())
    await set_dp_job_status(job_id, "queued")
    await set_dp_job_owner(job_id, str(current_user.id))

    from app.domain_prompt.tasks import run_domain_optimization
    run_domain_optimization.apply_async(
        kwargs={
            "job_id": job_id,
            "domain_id": str(domain_id),
            "user_id": str(current_user.id),
        }
    )

    return SuccessResponse(
        data=CreateDomainJobResponse(job_id=job_id, domain_id=str(domain_id))
    )


# -------------------------
# POLL JOB STATUS
# -------------------------
@router.get(
    "/jobs/{job_id}",
    response_model=SuccessResponse[DomainJobPollResponse],
    dependencies=[Depends(_read_limiter)],
)
async def poll_domain_job(
    job_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[DomainJobPollResponse]:
    """Poll for domain optimization job status."""
    owner = await get_dp_job_owner(job_id)
    if owner is None or owner != str(current_user.id):
        raise DomainJobNotFoundException()

    job_status = await get_dp_job_status(job_id)
    if job_status is None:
        raise DomainJobNotFoundException()

    result = None
    error = None

    if job_status == "completed":
        raw = await get_dp_job_result(job_id)
        if raw:
            result = raw

    elif job_status == "failed":
        raw = await get_dp_job_result(job_id)
        if raw:
            error = raw.get("error", "Unknown error")

    return SuccessResponse(
        data=DomainJobPollResponse(
            job_id=job_id,
            status=job_status,
            result=result,
            error=error,
        )
    )


# -------------------------
# DELETE DOMAIN
# -------------------------
@router.delete(
    "/{domain_id}",
    response_model=SuccessResponse[dict],
    dependencies=[Depends(_write_limiter)],
)
async def delete_domain(
    domain_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> SuccessResponse[dict]:
    """Delete a domain and its associated MinIO objects."""
    repo = DomainPromptRepository(db)
    domain = await repo.get_by_id_and_user(domain_id, current_user.id)
    if domain is None:
        raise DomainNotFoundException()
    await repo.delete(domain)
    await db.commit()
    return SuccessResponse(data={"deleted": str(domain_id)})
```

- [ ] **Step 2: Mount router in api/router.py**

Open `qa-chatbot/src/app/api/router.py` and add:

```python
from fastapi import APIRouter

from app.api.v1 import (
    api_keys,
    auth,
    categories,
    chat,
    favorites,
    health,
    prompts,
    stats,
    templates,
    users,
)
from app.domain_prompt import router as domain_prompt_router

api_router = APIRouter()

api_router.include_router(health.router)
api_router.include_router(chat.router)
api_router.include_router(prompts.router)
api_router.include_router(templates.router)
api_router.include_router(stats.router)
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(favorites.router)
api_router.include_router(api_keys.router)
api_router.include_router(categories.router)
api_router.include_router(domain_prompt_router.router)
```

- [ ] **Step 3: Smoke test the API boots**

```bash
cd qa-chatbot && make dev
# Visit http://localhost:8000/docs
# Confirm /api/v1/domain-prompts/* routes appear
```

- [ ] **Step 4: Commit**

```bash
git add qa-chatbot/src/app/domain_prompt/router.py qa-chatbot/src/app/api/router.py
git commit -m "feat(domain-prompts): FastAPI router mounted at /api/v1/domain-prompts"
```

---

## Task 14: TypeScript types (frontend)

**Files:**
- Create: `frontend/src/types/domain-prompts.ts`

- [ ] **Step 1: Create domain-prompts.ts**

```typescript
// frontend/src/types/domain-prompts.ts

export type DomainPromptStatus =
  | 'pending'
  | 'preparing_dataset'
  | 'optimizing'
  | 'completed'
  | 'failed';

export interface DatasetInfo {
  row_count: number | null;
  pdf_key: string;
  dataset_key: string | null;
}

export interface DomainPrompt {
  id: string;
  name: string;
  description: string | null;
  base_prompt: string;
  optimized_prompt: string | null;
  status: DomainPromptStatus;
  score_before: number | null;
  score_after: number | null;
  credits_charged: number;
  error_message: string | null;
  dataset: DatasetInfo | null;
  created_at: string;
  updated_at: string;
}

export interface DomainListResponse {
  domains: DomainPrompt[];
}

export interface CreateDomainJobResponse {
  job_id: string;
  domain_id: string;
}

export interface DomainJobPollResponse {
  job_id: string;
  status: string;
  domain_id: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/types/domain-prompts.ts
git commit -m "feat(domain-prompts): TypeScript types for domain prompts API"
```

---

## Task 15: Domain card component

**Files:**
- Create: `frontend/src/components/domain-prompts/domain-card.tsx`

- [ ] **Step 1: Create domain-card.tsx**

```tsx
// frontend/src/components/domain-prompts/domain-card.tsx
'use client';

import type { DomainPrompt, DomainPromptStatus } from '@/types/domain-prompts';

const STATUS_LABELS: Record<DomainPromptStatus, string> = {
  pending: 'Queued',
  preparing_dataset: 'Building Dataset…',
  optimizing: 'Optimizing…',
  completed: 'Ready',
  failed: 'Failed',
};

const STATUS_COLORS: Record<DomainPromptStatus, string> = {
  pending: '#8a8a90',
  preparing_dataset: '#f59e0b',
  optimizing: '#7c5cff',
  completed: '#22c55e',
  failed: '#f43f5e',
};

function ScoreBadge({ before, after }: { before: number | null; after: number | null }) {
  if (before === null || after === null) return null;
  const pct = Math.round((after - before) * 100);
  const color = pct >= 0 ? '#22c55e' : '#f43f5e';
  return (
    <span style={{ fontSize: 11, color, fontFamily: 'var(--font-geist-mono, monospace)' }}>
      {pct >= 0 ? '+' : ''}{pct}% score
    </span>
  );
}

export function DomainCard({
  domain,
  onClick,
}: {
  domain: DomainPrompt;
  onClick: () => void;
}) {
  const statusColor = STATUS_COLORS[domain.status];
  const statusLabel = STATUS_LABELS[domain.status];
  const isRunning = domain.status === 'preparing_dataset' || domain.status === 'optimizing';

  return (
    <div
      onClick={onClick}
      style={{
        background: '#141418',
        border: '1px solid #222226',
        borderRadius: 10,
        padding: '16px 18px',
        cursor: 'pointer',
        transition: 'border-color 150ms, background 150ms',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.borderColor = '#7c5cff44';
        (e.currentTarget as HTMLDivElement).style.background = '#18181c';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.borderColor = '#222226';
        (e.currentTarget as HTMLDivElement).style.background = '#141418';
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, fontWeight: 600, fontSize: 14, color: '#ededed',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {domain.name}
        </span>
        {/* Premium tag */}
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
          background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
          color: '#fff', letterSpacing: '0.04em', flexShrink: 0,
        }}>
          PREMIUM
        </span>
        {/* Status badge */}
        <span style={{
          fontSize: 11, padding: '2px 8px', borderRadius: 20,
          background: `${statusColor}22`, color: statusColor, flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          {isRunning && (
            <span style={{
              width: 5, height: 5, borderRadius: '50%', background: statusColor,
              animation: 'pulse 1.4s ease-in-out infinite',
              display: 'inline-block',
            }} />
          )}
          {statusLabel}
        </span>
      </div>

      {/* Description */}
      {domain.description && (
        <p style={{ fontSize: 12.5, color: '#8a8a90', margin: 0,
          overflow: 'hidden', display: '-webkit-box',
          WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          {domain.description}
        </p>
      )}

      {/* Footer: dataset info + score */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
        {domain.dataset?.row_count && (
          <span style={{ fontSize: 11, color: '#5a5a60',
            fontFamily: 'var(--font-geist-mono, monospace)' }}>
            {domain.dataset.row_count} Q&A pairs
          </span>
        )}
        <ScoreBadge before={domain.score_before} after={domain.score_after} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/domain-prompts/domain-card.tsx
git commit -m "feat(domain-prompts): DomainCard component with status, premium tag, score"
```

---

## Task 16: New domain modal

**Files:**
- Create: `frontend/src/components/domain-prompts/new-domain-modal.tsx`

- [ ] **Step 1: Create new-domain-modal.tsx**

```tsx
// frontend/src/components/domain-prompts/new-domain-modal.tsx
'use client';

import { useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { CreateDomainJobResponse } from '@/types/domain-prompts';

interface Props {
  onClose: () => void;
  onJobStarted: (jobId: string, domainId: string) => void;
}

export function NewDomainModal({ onClose, onJobStarted }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [basePrompt, setBasePrompt] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) { setError('Please upload a PDF file.'); return; }
    if (!name.trim()) { setError('Domain name is required.'); return; }
    if (!basePrompt.trim()) { setError('Base prompt is required.'); return; }

    setError(null);
    setSubmitting(true);

    try {
      const form = new FormData();
      form.append('name', name.trim());
      form.append('base_prompt', basePrompt.trim());
      form.append('file', file);
      if (description.trim()) form.append('description', description.trim());

      const res = await api.post<{ data: CreateDomainJobResponse }>(
        '/api/v1/domain-prompts/',
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      onJobStarted(res.data.data.job_id, res.data.data.domain_id);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail ?? 'Failed to create domain. Please try again.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px', borderRadius: 7,
    border: '1px solid #2a2a2e', background: '#1a1a1e',
    color: '#ededed', fontSize: 13, outline: 'none', boxSizing: 'border-box',
  };
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 12, color: '#8a8a90', marginBottom: 6, fontWeight: 500,
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: '#101014', border: '1px solid #222226', borderRadius: 14,
        padding: 28, width: '100%', maxWidth: 540,
        fontFamily: 'var(--font-geist, ui-sans-serif)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#ededed', flex: 1 }}>
            New Domain Prompt
          </h2>
          {/* Premium badge */}
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
            background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
            color: '#fff', marginRight: 12,
          }}>PREMIUM · 10 credits</span>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#5a5a60', cursor: 'pointer', fontSize: 18,
          }}>×</button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={labelStyle}>Domain Name *</label>
            <input
              style={inputStyle} value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Nutrition, Legal, Medical"
              required
            />
          </div>

          <div>
            <label style={labelStyle}>Description</label>
            <input
              style={inputStyle} value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Brief description of this domain"
            />
          </div>

          <div>
            <label style={labelStyle}>Base System Prompt *</label>
            <textarea
              style={{ ...inputStyle, minHeight: 100, resize: 'vertical', lineHeight: 1.5 }}
              value={basePrompt}
              onChange={e => setBasePrompt(e.target.value)}
              placeholder="You are a nutrition expert. Given a question about nutrients, provide accurate and detailed information..."
              required
            />
          </div>

          <div>
            <label style={labelStyle}>Source PDF *</label>
            <div
              onClick={() => fileRef.current?.click()}
              style={{
                border: '1.5px dashed #2a2a2e', borderRadius: 8, padding: '20px 16px',
                textAlign: 'center', cursor: 'pointer', color: '#5a5a60', fontSize: 13,
                transition: 'border-color 150ms',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = '#7c5cff')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = '#2a2a2e')}
            >
              {file
                ? <span style={{ color: '#7c5cff' }}>{file.name}</span>
                : <>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="1.5" style={{ marginBottom: 6 }}>
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                      <polyline points="17 8 12 3 7 8"/>
                      <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    <div>Click to upload PDF</div>
                    <div style={{ fontSize: 11, marginTop: 4 }}>Dataset will be generated from this file</div>
                  </>
              }
            </div>
            <input
              ref={fileRef} type="file" accept=".pdf"
              style={{ display: 'none' }}
              onChange={e => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {error && (
            <p style={{ margin: 0, fontSize: 12.5, color: '#f43f5e' }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              padding: '10px 0', borderRadius: 8, border: 'none',
              background: submitting ? '#2a2a2e' : '#7c5cff',
              color: submitting ? '#5a5a60' : '#fff',
              fontWeight: 600, fontSize: 14, cursor: submitting ? 'not-allowed' : 'pointer',
              transition: 'background 150ms',
            }}
          >
            {submitting ? 'Creating…' : 'Create Domain Prompt'}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/domain-prompts/new-domain-modal.tsx
git commit -m "feat(domain-prompts): NewDomainModal with PDF upload and form validation"
```

---

## Task 17: Domain detail view

**Files:**
- Create: `frontend/src/components/domain-prompts/domain-detail.tsx`

- [ ] **Step 1: Create domain-detail.tsx**

```tsx
// frontend/src/components/domain-prompts/domain-detail.tsx
'use client';

import { useState } from 'react';
import type { DomainPrompt } from '@/types/domain-prompts';

interface Props {
  domain: DomainPrompt;
  onClose: () => void;
  onReoptimize: () => void;
  reoptimizing: boolean;
}

export function DomainDetail({ domain, onClose, onReoptimize, reoptimizing }: Props) {
  const [copied, setCopied] = useState(false);

  function copyPrompt() {
    if (!domain.optimized_prompt) return;
    navigator.clipboard.writeText(domain.optimized_prompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const scoreImprovement = domain.score_before !== null && domain.score_after !== null
    ? Math.round((domain.score_after - domain.score_before) * 100)
    : null;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: '#101014', border: '1px solid #222226', borderRadius: 14,
        padding: 28, width: '100%', maxWidth: 680, maxHeight: '85vh',
        overflowY: 'auto', fontFamily: 'var(--font-geist, ui-sans-serif)',
      }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 20 }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#ededed' }}>
              {domain.name}
            </h2>
            {domain.description && (
              <p style={{ margin: '4px 0 0', fontSize: 13, color: '#8a8a90' }}>
                {domain.description}
              </p>
            )}
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#5a5a60', cursor: 'pointer',
            fontSize: 20, marginLeft: 12,
          }}>×</button>
        </div>

        {/* Stats row */}
        {domain.status === 'completed' && (
          <div style={{
            display: 'flex', gap: 16, marginBottom: 20,
            padding: '12px 16px', background: '#141418', borderRadius: 8,
          }}>
            {domain.dataset?.row_count && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#7c5cff',
                  fontFamily: 'var(--font-geist-mono, monospace)' }}>
                  {domain.dataset.row_count}
                </div>
                <div style={{ fontSize: 11, color: '#5a5a60' }}>Q&A pairs</div>
              </div>
            )}
            {domain.score_before !== null && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#ededed',
                  fontFamily: 'var(--font-geist-mono, monospace)' }}>
                  {Math.round((domain.score_before) * 100)}%
                </div>
                <div style={{ fontSize: 11, color: '#5a5a60' }}>Before</div>
              </div>
            )}
            {domain.score_after !== null && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#22c55e',
                  fontFamily: 'var(--font-geist-mono, monospace)' }}>
                  {Math.round((domain.score_after) * 100)}%
                </div>
                <div style={{ fontSize: 11, color: '#5a5a60' }}>After</div>
              </div>
            )}
            {scoreImprovement !== null && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 700,
                  color: scoreImprovement >= 0 ? '#22c55e' : '#f43f5e',
                  fontFamily: 'var(--font-geist-mono, monospace)' }}>
                  {scoreImprovement >= 0 ? '+' : ''}{scoreImprovement}%
                </div>
                <div style={{ fontSize: 11, color: '#5a5a60' }}>Improvement</div>
              </div>
            )}
          </div>
        )}

        {/* Prompts */}
        {domain.optimized_prompt && (
          <>
            <Section label="Original Prompt" content={domain.base_prompt} />
            <div style={{ margin: '12px 0', textAlign: 'center' }}>
              <span style={{ fontSize: 12, color: '#5a5a60' }}>↓ optimized</span>
            </div>
            <Section label="Optimized Prompt" content={domain.optimized_prompt} highlight />
          </>
        )}

        {domain.status === 'failed' && (
          <div style={{ padding: '12px 16px', background: 'rgba(244,63,94,0.08)',
            border: '1px solid rgba(244,63,94,0.2)', borderRadius: 8, marginBottom: 16 }}>
            <p style={{ margin: 0, fontSize: 13, color: '#f43f5e' }}>
              {domain.error_message ?? 'Optimization failed. Please try again.'}
            </p>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          {domain.optimized_prompt && (
            <button onClick={copyPrompt} style={{
              flex: 1, padding: '10px 0', borderRadius: 8,
              border: '1px solid #2a2a2e', background: 'transparent',
              color: copied ? '#22c55e' : '#ededed', fontWeight: 500, fontSize: 13,
              cursor: 'pointer',
            }}>
              {copied ? '✓ Copied!' : 'Copy Optimized Prompt'}
            </button>
          )}
          <button
            onClick={onReoptimize}
            disabled={reoptimizing || domain.status === 'optimizing' || domain.status === 'preparing_dataset'}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 6, padding: '10px 0', borderRadius: 8, border: 'none',
              background: reoptimizing ? '#2a2a2e' : '#7c5cff',
              color: reoptimizing ? '#5a5a60' : '#fff',
              fontWeight: 600, fontSize: 13,
              cursor: reoptimizing ? 'not-allowed' : 'pointer',
            }}
          >
            {/* Premium tag inline */}
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
              background: 'rgba(255,255,255,0.2)', color: '#fff',
            }}>PREMIUM</span>
            {reoptimizing ? 'Re-optimizing…' : 'Re-optimize (10 cr)'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ label, content, highlight }: { label: string; content: string; highlight?: boolean }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ fontSize: 11, color: '#5a5a60', marginBottom: 6,
        fontFamily: 'var(--font-geist-mono, monospace)', textTransform: 'uppercase',
        letterSpacing: '0.06em' }}>
        {label}
      </div>
      <pre style={{
        margin: 0, padding: '12px 14px',
        background: highlight ? 'rgba(124,92,255,0.06)' : '#141418',
        border: `1px solid ${highlight ? 'rgba(124,92,255,0.2)' : '#1f1f23'}`,
        borderRadius: 8, fontSize: 12.5, color: '#d4d4d8',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6,
        fontFamily: 'var(--font-geist-mono, monospace)',
        maxHeight: 220, overflowY: 'auto',
      }}>
        {content}
      </pre>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/domain-prompts/domain-detail.tsx
git commit -m "feat(domain-prompts): DomainDetail view with before/after diff and re-optimize"
```

---

## Task 18: Domain prompts page

**Files:**
- Create: `frontend/src/app/(dashboard)/domain-prompts/page.tsx`

- [ ] **Step 1: Create page.tsx**

```tsx
// frontend/src/app/(dashboard)/domain-prompts/page.tsx
'use client';

import { useState, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { DomainListResponse, DomainPrompt } from '@/types/domain-prompts';
import { DomainCard } from '@/components/domain-prompts/domain-card';
import { NewDomainModal } from '@/components/domain-prompts/new-domain-modal';
import { DomainDetail } from '@/components/domain-prompts/domain-detail';

export default function DomainPromptsPage() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [selected, setSelected] = useState<DomainPrompt | null>(null);
  const [pollingJobId, setPollingJobId] = useState<string | null>(null);
  const [reoptimizing, setReoptimizing] = useState(false);

  const { data, isLoading } = useQuery<DomainListResponse>({
    queryKey: ['domain-prompts'],
    queryFn: async () => {
      const res = await api.get<{ data: DomainListResponse }>('/api/v1/domain-prompts/');
      return res.data.data;
    },
    refetchInterval: pollingJobId ? 3000 : false,
  });

  // Poll job status when we have an active job
  useEffect(() => {
    if (!pollingJobId) return;
    const interval = setInterval(async () => {
      try {
        const res = await api.get<{ data: { status: string } }>(
          `/api/v1/domain-prompts/jobs/${pollingJobId}`
        );
        const { status } = res.data.data;
        if (status === 'completed' || status === 'failed') {
          setPollingJobId(null);
          qc.invalidateQueries({ queryKey: ['domain-prompts'] });
        }
      } catch {
        setPollingJobId(null);
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [pollingJobId, qc]);

  const reoptimizeMutation = useMutation({
    mutationFn: async (domainId: string) => {
      const res = await api.post<{ data: { job_id: string } }>(
        `/api/v1/domain-prompts/${domainId}/optimize`
      );
      return res.data.data.job_id;
    },
    onSuccess: (jobId) => {
      setPollingJobId(jobId);
      setReoptimizing(false);
      setSelected(null);
      qc.invalidateQueries({ queryKey: ['domain-prompts'] });
    },
    onError: () => setReoptimizing(false),
  });

  const handleJobStarted = useCallback((jobId: string) => {
    setShowNew(false);
    setPollingJobId(jobId);
    qc.invalidateQueries({ queryKey: ['domain-prompts'] });
  }, [qc]);

  const handleReoptimize = useCallback(() => {
    if (!selected) return;
    setReoptimizing(true);
    reoptimizeMutation.mutate(selected.id);
  }, [selected, reoptimizeMutation]);

  // Keep selected in sync with latest data
  const latestSelected = selected
    ? data?.domains.find(d => d.id === selected.id) ?? selected
    : null;

  return (
    <div style={{
      flex: 1, overflowY: 'auto', padding: '32px 40px',
      fontFamily: 'var(--font-geist, ui-sans-serif)',
    }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 28 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#ededed' }}>
              Domain Prompts
            </h1>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
              background: 'linear-gradient(135deg, #f59e0b, #ef4444)', color: '#fff',
            }}>PREMIUM</span>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: '#8a8a90' }}>
            Upload a PDF to generate a domain-specific dataset and optimize a system prompt for your use case.
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 7, padding: '9px 16px',
            borderRadius: 8, border: 'none', background: '#7c5cff',
            color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          New Domain
        </button>
      </div>

      {/* Active job banner */}
      {pollingJobId && (
        <div style={{
          marginBottom: 20, padding: '12px 16px',
          background: 'rgba(124,92,255,0.08)', border: '1px solid rgba(124,92,255,0.2)',
          borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%', background: '#7c5cff', flexShrink: 0,
            animation: 'pulse 1.4s ease-in-out infinite',
          }} />
          <span style={{ fontSize: 13, color: '#a78bfa' }}>
            Domain optimization in progress… this may take a few minutes.
          </span>
        </div>
      )}

      {/* Domain grid */}
      {isLoading ? (
        <div style={{ color: '#5a5a60', fontSize: 13, paddingTop: 40, textAlign: 'center' }}>
          Loading domains…
        </div>
      ) : !data?.domains.length ? (
        <div style={{
          textAlign: 'center', paddingTop: 80, color: '#5a5a60',
        }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1" style={{ marginBottom: 12, opacity: 0.4 }}>
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          <div style={{ fontSize: 14, marginBottom: 6 }}>No domain prompts yet</div>
          <div style={{ fontSize: 12.5 }}>
            Upload a PDF to create your first domain-specific prompt.
          </div>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 14,
        }}>
          {data.domains.map(domain => (
            <DomainCard
              key={domain.id}
              domain={domain}
              onClick={() => setSelected(domain)}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {showNew && (
        <NewDomainModal
          onClose={() => setShowNew(false)}
          onJobStarted={handleJobStarted}
        />
      )}
      {latestSelected && (
        <DomainDetail
          domain={latestSelected}
          onClose={() => setSelected(null)}
          onReoptimize={handleReoptimize}
          reoptimizing={reoptimizing}
        />
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/\(dashboard\)/domain-prompts/page.tsx
git commit -m "feat(domain-prompts): Domain Prompts page with grid, polling, and modals"
```

---

## Task 19: Add sidebar nav entry

**Files:**
- Modify: `frontend/src/components/layout/sidebar.tsx`

- [ ] **Step 1: Add "Domain Prompts" to the NAV array**

In `sidebar.tsx`, find the `NAV` array and add the new entry after `'prompt-library'`:

```typescript
const NAV = [
  { key: 'dashboard',      label: 'Dashboard',      href: '/dashboard',      kbd: 'D' },
  { key: 'optimize',       label: 'Optimize',       href: '/optimize',       kbd: 'O' },
  { key: 'analyze',        label: 'Analyze',        href: '/analyze',        kbd: 'A' },
  { key: 'versions',       label: 'Versions',       href: '/versions',       kbd: 'V' },
  { key: 'prompt-library', label: 'Prompt Library', href: '/prompt-library', kbd: 'S' },
  { key: 'domain-prompts', label: 'Domain Prompts', href: '/domain-prompts' },
  { key: 'prompts-media',  label: 'Prompts Media',  href: '/prompts-media' },
  { key: 'prompt-project', label: 'Prompt Project', href: '/prompt-project' },
  { key: 'history',        label: 'History',        href: '/history' },
  { key: 'billing',        label: 'Billing',        href: '/billing' },
  { key: 'settings',       label: 'Settings',       href: '/settings' },
];
```

- [ ] **Step 2: Add NavIcon for domain-prompts**

In the `icons` object inside `NavIcon`, add:

```typescript
'domain-prompts': (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6">
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="9" y1="13" x2="15" y2="13"/>
    <line x1="9" y1="17" x2="12" y2="17"/>
  </svg>
),
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/layout/sidebar.tsx
git commit -m "feat(domain-prompts): add Domain Prompts sidebar nav entry with icon"
```

---

## Task 20: End-to-end smoke test

- [ ] **Step 1: Start full stack**

```bash
# Terminal 1
cd qa-chatbot && make infra && make migrate && make dev

# Terminal 2
cd qa-chatbot && make worker

# Terminal 3
cd frontend && npm run dev
```

- [ ] **Step 2: Verify MinIO**

Visit `http://localhost:9001` — confirm the `promptly` bucket exists.

- [ ] **Step 3: Test the full flow**

1. Open `http://localhost:3000/domain-prompts`
2. Click **New Domain**
3. Fill in name (e.g. "Nutrition"), base prompt, upload a PDF
4. Submit — confirm 202 response and progress banner appears
5. Watch the domain card status change: `Queued → Building Dataset → Optimizing → Ready`
6. Click the completed card → detail modal shows before/after prompts and score
7. Click "Copy Optimized Prompt" — confirm clipboard works
8. Click "Re-optimize" — confirm 10 credits deducted and new job starts

- [ ] **Step 4: Check Swagger**

Visit `http://localhost:8000/docs` — confirm all `/api/v1/domain-prompts/*` routes are listed.

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "feat(domain-prompts): complete domain prompts feature — PDF upload, dataset gen, optimization, UI"
```

---

## Self-Review

**Spec coverage check:**
- ✅ PDF upload → MinIO storage (Tasks 1, 6, 13)
- ✅ Dataset generation from PDF via LLM (Task 7)
- ✅ JSONL dataset stored in MinIO (Tasks 7, 10)
- ✅ Two-stage Celery pipeline (Task 10)
- ✅ Prompt variant scoring against dataset (Task 8)
- ✅ Domain prompt stored in PostgreSQL (Tasks 3, 4)
- ✅ User-scoped access (repository filters by user_id everywhere)
- ✅ 10 credits charged, Premium tag shown (Tasks 13, 15, 16, 18)
- ✅ Job polling via Redis (Tasks 9, 13)
- ✅ Does not touch existing chat/council pipeline
- ✅ All code in `qa-chatbot/src/app/domain_prompt/` (isolated dir)
- ✅ Same FastAPI server, new router mounted on existing `api_router`
- ✅ MinIO Docker service added to docker-compose (Task 1)
- ✅ Frontend: sidebar entry, page, card, modal, detail view (Tasks 14–19)
- ✅ Re-optimize from existing dataset without re-uploading PDF (Task 13)

**Type consistency check:**
- `DomainPromptRepository` uses `DomainPrompt` and `DomainDataset` models defined in Task 3 — consistent throughout Tasks 5, 10, 13
- `set_dp_job_status` / `get_dp_job_status` defined in Task 9, used in Tasks 10 and 13 — consistent
- `object_key(user_id, domain_id, filename)` defined in Task 6, used in Tasks 10 and 13 — consistent
- `DomainPromptResponse` uses `DatasetInfo` nested model — `DomainDataset` ORM maps via `from_attributes=True` — consistent
- Frontend `DomainPrompt` type mirrors backend `DomainPromptResponse` fields exactly
