# Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Promptly monorepo to production-grade quality across repo standards, frontend safety, backend hardening, and CI/CD completeness — without changing deployment infrastructure.

**Architecture:** Four independent work streams: (1) repo-level documentation and standards files, (2) Next.js frontend hardening (security headers, error boundaries, env validation), (3) FastAPI/Celery backend hardening (request limits, Redis rate limiting, graceful shutdown, Sentry), (4) CI/CD completeness (frontend pipeline, coverage gate).

**Tech Stack:** Next.js 14, FastAPI, Celery/Redis, Python 3.11, uv, GitHub Actions, Sentry SDK, Zod, structlog

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `README.md` | Create | Root monorepo overview |
| `CONTRIBUTING.md` | Create | Branch naming, PR process, commit convention |
| `LICENSE` | Create | MIT license |
| `SECURITY.md` | Create | Vulnerability disclosure policy |
| `.gitignore` | Create | Root-level monorepo ignores |
| `frontend/.env.example` | Create | Frontend env template |
| `frontend/next.config.mjs` | Modify | Security headers (CSP, HSTS, X-Frame-Options, etc.) |
| `frontend/src/app/error.tsx` | Create | React error boundary for dashboard |
| `frontend/src/app/(dashboard)/error.tsx` | Create | Dashboard-scoped error boundary |
| `frontend/src/app/(auth)/error.tsx` | Create | Auth-scoped error boundary |
| `frontend/src/app/not-found.tsx` | Create | Global 404 page |
| `frontend/src/lib/env.ts` | Create | Zod env validation (fails loudly on missing vars) |
| `qa-chatbot/src/app/core/middleware.py` | Modify | Add `RequestLimitMiddleware` (body size + timeout) |
| `qa-chatbot/src/app/core/middleware.py` | Modify | Replace in-memory rate limiter with Redis-backed |
| `qa-chatbot/src/app/config/app.py` | Modify | Add `SENTRY_DSN`, `MAX_REQUEST_BODY_BYTES`, `REQUEST_TIMEOUT_SECONDS` |
| `qa-chatbot/src/app/config/env.py` | Modify | Add `SENTRY_DSN` optional field |
| `qa-chatbot/src/app/main.py` | Modify | Wire Sentry on startup, add `RequestLimitMiddleware` |
| `qa-chatbot/src/app/workers/celery_app.py` | Modify | Wire Sentry for Celery, add graceful SIGTERM handler |
| `qa-chatbot/pyproject.toml` | Modify | Add `sentry-sdk[fastapi]` dependency |
| `qa-chatbot/.github/workflows/ci.yml` | Modify | Add coverage gate (fail below 60%) |
| `frontend/.github/workflows/ci.yml` | Create | Frontend CI: type-check, lint, build |

---

## Task 1: Repo Standards — Root Files

**Files:**
- Create: `README.md`
- Create: `CONTRIBUTING.md`
- Create: `LICENSE`
- Create: `SECURITY.md`
- Create: `.gitignore`

- [ ] **Step 1: Create root `.gitignore`**

```
# Python
__pycache__/
*.py[cod]
*.pyo
.venv/
.mypy_cache/
.ruff_cache/
dist/
*.egg-info/
.coverage
coverage.xml
htmlcov/

# Node
node_modules/
.next/
.turbo/
*.tsbuildinfo

# Env files
.env
.env.local
.env.production
.env.*.local

# IDEs
.idea/
.vscode/
*.swp
*.swo
.DS_Store

# Test artefacts
.pytest_cache/
```

Save to `/Volumes/External/promptly/.gitignore`.

- [ ] **Step 2: Create `LICENSE` (MIT)**

```
MIT License

Copyright (c) 2026 Promptly

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Save to `/Volumes/External/promptly/LICENSE`.

- [ ] **Step 3: Create `SECURITY.md`**

```markdown
# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| latest  | ✅        |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report security issues by emailing **security@promptly.app** with:

- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fix (optional)

You will receive a response within **48 hours**. We aim to release a patch within **7 days** for critical issues.

## Scope

- SQL injection, XSS, CSRF, authentication bypass
- Secrets exposure in logs or API responses
- Insecure direct object references
- Rate limiting bypass

## Out of Scope

- Issues in third-party dependencies (report upstream)
- Social engineering
- Physical security

We appreciate responsible disclosure and will credit researchers in release notes if desired.
```

Save to `/Volumes/External/promptly/SECURITY.md`.

- [ ] **Step 4: Create `CONTRIBUTING.md`**

```markdown
# Contributing to Promptly

## Development Setup

```bash
# Backend
cd qa-chatbot
make infra && make migrate && make dev

# Frontend
cd frontend
npm install && npm run dev
```

## Branch Naming

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feat/<short-description>` | `feat/redis-rate-limiting` |
| Bug fix | `fix/<short-description>` | `fix/session-restore-bug` |
| Chore | `chore/<short-description>` | `chore/update-dependencies` |
| Docs | `docs/<short-description>` | `docs/api-reference` |

## Commit Convention

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add Redis-backed rate limiting
fix: restore in-flight session on navigation
chore: upgrade sentry-sdk to 2.x
docs: add CONTRIBUTING guide
```

## Pull Request Process

1. Branch from `main` (never commit directly to `main`)
2. Keep PRs focused — one concern per PR
3. All CI checks must pass before merging
4. Backend PRs require `pytest` to pass with ≥ 60% coverage
5. Frontend PRs require `npm run build` to succeed with no type errors
6. Write a clear PR description explaining **why**, not just **what**

## Code Standards

### Backend (Python)
- `uv run ruff check src/` — must pass
- `uv run ruff format src/` — auto-format before committing
- `uv run mypy src/` — strict typing, must pass

### Frontend (TypeScript)
- `npm run lint` — ESLint must pass
- TypeScript strict mode — no `any` without explicit justification

## Testing

### Backend
```bash
cd qa-chatbot
uv run pytest tests/ -v --cov=app --cov-report=term-missing
```

### Frontend
```bash
cd frontend
npm run build   # catches type errors
npm run lint
```
```

Save to `/Volumes/External/promptly/CONTRIBUTING.md`.

- [ ] **Step 5: Create `README.md`**

```markdown
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
```

Save to `/Volumes/External/promptly/README.md`.

- [ ] **Step 6: Commit**

```bash
cd /Volumes/External/promptly
git add .gitignore LICENSE SECURITY.md CONTRIBUTING.md README.md
git commit -m "docs: add repo standards — README, CONTRIBUTING, LICENSE, SECURITY, .gitignore"
```

---

## Task 2: Frontend — `.env.example`

**Files:**
- Create: `frontend/.env.example`

- [ ] **Step 1: Create `frontend/.env.example`**

```bash
# Backend API base URL — must match where qa-chatbot FastAPI runs
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Save to `frontend/.env.example`.

- [ ] **Step 2: Commit**

```bash
cd /Volumes/External/promptly
git add frontend/.env.example
git commit -m "chore: add frontend .env.example for developer onboarding"
```

---

## Task 3: Frontend — Environment Validation

**Files:**
- Create: `frontend/src/lib/env.ts`
- Modify: `frontend/src/lib/api.ts` (import env)

- [ ] **Step 1: Create `frontend/src/lib/env.ts`**

This module validates required env vars at module-load time so the app fails loudly on misconfiguration rather than silently hitting the wrong URL.

```typescript
import { z } from 'zod';

const envSchema = z.object({
  NEXT_PUBLIC_API_URL: z
    .string()
    .url('NEXT_PUBLIC_API_URL must be a valid URL')
    .default('http://localhost:8000'),
});

const _env = envSchema.safeParse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
});

if (!_env.success) {
  console.error('❌ Invalid environment variables:', _env.error.flatten().fieldErrors);
  throw new Error('Invalid environment configuration. Check your .env.local file.');
}

export const env = _env.data;
```

Save to `frontend/src/lib/env.ts`.

- [ ] **Step 2: Update `frontend/src/lib/api.ts` to use `env`**

Find the `baseURL` line in `api.ts` (the axios instance creation). Replace the raw `process.env` access with the validated `env` import:

```typescript
// At the top of api.ts, add:
import { env } from '@/lib/env';

// Replace the baseURL line from:
//   baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
// To:
//   baseURL: env.NEXT_PUBLIC_API_URL,
```

- [ ] **Step 3: Verify build still passes**

```bash
cd /Volumes/External/promptly/frontend
npm run build
```

Expected: build succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
cd /Volumes/External/promptly
git add frontend/src/lib/env.ts frontend/src/lib/api.ts
git commit -m "feat(frontend): add Zod env validation — fail loudly on missing NEXT_PUBLIC_API_URL"
```

---

## Task 4: Frontend — Security Headers in `next.config.mjs`

**Files:**
- Modify: `frontend/next.config.mjs`

- [ ] **Step 1: Replace `next.config.mjs` with security headers**

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  headers: async () => [
    {
      source: '/(.*)',
      headers: [
        {
          key: 'X-Frame-Options',
          value: 'DENY',
        },
        {
          key: 'X-Content-Type-Options',
          value: 'nosniff',
        },
        {
          key: 'Referrer-Policy',
          value: 'strict-origin-when-cross-origin',
        },
        {
          key: 'Permissions-Policy',
          value: 'camera=(), microphone=(), geolocation=()',
        },
        {
          key: 'X-DNS-Prefetch-Control',
          value: 'on',
        },
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=63072000; includeSubDomains; preload',
        },
        {
          key: 'Content-Security-Policy',
          value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "font-src 'self'",
            `connect-src 'self' ${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'} ws://localhost:*`,
            "frame-ancestors 'none'",
          ].join('; '),
        },
      ],
    },
  ],

  // Disable powered-by header
  poweredByHeader: false,
};

export default nextConfig;
```

- [ ] **Step 2: Verify build passes**

```bash
cd /Volumes/External/promptly/frontend
npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
cd /Volumes/External/promptly
git add frontend/next.config.mjs
git commit -m "feat(frontend): add security headers — CSP, HSTS, X-Frame-Options, Referrer-Policy"
```

---

## Task 5: Frontend — Error Boundaries and 404 Page

**Files:**
- Create: `frontend/src/app/error.tsx`
- Create: `frontend/src/app/(dashboard)/error.tsx`
- Create: `frontend/src/app/(auth)/error.tsx`
- Create: `frontend/src/app/not-found.tsx`

- [ ] **Step 1: Create root `frontend/src/app/error.tsx`**

Next.js requires `error.tsx` to be a Client Component. It receives `error` and `reset` props.

```typescript
'use client';

import { useEffect } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[GlobalError]', error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4 px-4 max-w-md">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-destructive/10 mx-auto">
            <AlertCircle className="h-6 w-6 text-destructive" />
          </div>
          <h1 className="text-xl font-bold text-foreground">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            An unexpected error occurred. Our team has been notified.
          </p>
          {error.digest && (
            <p className="text-xs text-muted-foreground/60 font-mono">
              Error ID: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
```

Save to `frontend/src/app/error.tsx`.

- [ ] **Step 2: Create `frontend/src/app/(dashboard)/error.tsx`**

Dashboard error boundary — renders inside the layout (sidebar stays visible).

```typescript
'use client';

import { useEffect } from 'react';
import { AlertCircle, RefreshCw, Home } from 'lucide-react';
import Link from 'next/link';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[DashboardError]', error);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center h-full">
      <div className="text-center space-y-4 px-4 max-w-md">
        <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-destructive/10 mx-auto">
          <AlertCircle className="h-6 w-6 text-destructive" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">Page error</h2>
        <p className="text-sm text-muted-foreground">
          This page encountered an error. You can try again or go back to the dashboard.
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground/60 font-mono">
            Error ID: {error.digest}
          </p>
        )}
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            Try again
          </button>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium border border-border hover:bg-accent transition-colors"
          >
            <Home className="h-4 w-4" />
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
```

Save to `frontend/src/app/(dashboard)/error.tsx`.

- [ ] **Step 3: Create `frontend/src/app/(auth)/error.tsx`**

```typescript
'use client';

import { useEffect } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import Link from 'next/link';

export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[AuthError]', error);
  }, [error]);

  return (
    <div className="space-y-6 text-center">
      <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-destructive/10 mx-auto">
        <AlertCircle className="h-6 w-6 text-destructive" />
      </div>
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-foreground">Something went wrong</h2>
        <p className="text-sm text-muted-foreground">
          An error occurred during authentication. Please try again.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={reset}
          className="w-full inline-flex items-center justify-center gap-2 h-10 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          Try again
        </button>
        <Link
          href="/login"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Back to login
        </Link>
      </div>
    </div>
  );
}
```

Save to `frontend/src/app/(auth)/error.tsx`.

- [ ] **Step 4: Create `frontend/src/app/not-found.tsx`**

```typescript
import Link from 'next/link';
import { Lightbulb, ArrowLeft } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="text-center space-y-6 max-w-md">
        <div className="flex items-center justify-center gap-2 text-primary">
          <Lightbulb className="h-8 w-8" />
          <span className="text-xl font-bold">Promptly</span>
        </div>
        <div className="space-y-2">
          <h1 className="text-6xl font-black text-foreground">404</h1>
          <h2 className="text-xl font-semibold text-foreground">Page not found</h2>
          <p className="text-sm text-muted-foreground">
            The page you&apos;re looking for doesn&apos;t exist or has been moved.
          </p>
        </div>
        <Link
          href="/optimize"
          className="inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold hover:bg-primary/90 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Promptly
        </Link>
      </div>
    </div>
  );
}
```

Save to `frontend/src/app/not-found.tsx`.

- [ ] **Step 5: Verify build**

```bash
cd /Volumes/External/promptly/frontend
npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
cd /Volumes/External/promptly
git add frontend/src/app/error.tsx \
        frontend/src/app/\(dashboard\)/error.tsx \
        frontend/src/app/\(auth\)/error.tsx \
        frontend/src/app/not-found.tsx
git commit -m "feat(frontend): add error boundaries and 404 page"
```

---

## Task 6: Backend — Request Size Limit + Timeout Middleware

**Files:**
- Modify: `qa-chatbot/src/app/core/middleware.py`
- Modify: `qa-chatbot/src/app/config/app.py`
- Modify: `qa-chatbot/src/app/main.py`

- [ ] **Step 1: Add config fields to `qa-chatbot/src/app/config/app.py`**

Add two new fields to `AppSettings`:

```python
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class AppSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )
    APP_NAME: str = "qa-chatbot"
    ENVIRONMENT: str = "development"
    DEBUG: bool = False
    API_V1_PREFIX: str = "/api/v1"
    CORS_ORIGIN: list[str] = ["http://localhost:3000", "*"]
    # Request hardening
    MAX_REQUEST_BODY_BYTES: int = 1 * 1024 * 1024   # 1 MB default
    REQUEST_TIMEOUT_SECONDS: float = 60.0


@lru_cache
def get_app_settings() -> AppSettings:
    return AppSettings()
```

- [ ] **Step 2: Add `RequestLimitMiddleware` to `qa-chatbot/src/app/core/middleware.py`**

Append this class after the existing `RateLimitMiddleware`:

```python
import asyncio

from app.config.app import get_app_settings


class RequestLimitMiddleware(BaseHTTPMiddleware):
    """Rejects oversized request bodies and enforces a per-request timeout."""

    async def dispatch(self, request: Request, call_next: Any) -> Any:
        settings = get_app_settings()

        # ── Body size check ────────────────────────────────────────────────────
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > settings.MAX_REQUEST_BODY_BYTES:
            return JSONResponse(
                status_code=413,
                content={"detail": "Request body too large"},
            )

        # ── Per-request timeout ────────────────────────────────────────────────
        try:
            return await asyncio.wait_for(
                call_next(request),
                timeout=settings.REQUEST_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            return JSONResponse(
                status_code=504,
                content={"detail": "Request timed out"},
            )
```

Also add `import asyncio` at the top of the file if not already present.

- [ ] **Step 3: Register `RequestLimitMiddleware` in `qa-chatbot/src/app/main.py`**

In the `create_app()` function, import and add the new middleware **before** `CorrelationIdMiddleware`:

```python
from app.core.middleware import CorrelationIdMiddleware, RateLimitMiddleware, RequestLimitMiddleware

# Inside create_app(), add after existing middleware registrations:
app.add_middleware(RequestLimitMiddleware)
```

Note: Starlette middleware is applied in reverse registration order — `RequestLimitMiddleware` registered last runs first on requests.

- [ ] **Step 4: Update `.env.example` with new keys**

Append to `qa-chatbot/.env.example`:

```bash
# Request hardening
MAX_REQUEST_BODY_BYTES=1048576
REQUEST_TIMEOUT_SECONDS=60
```

- [ ] **Step 5: Verify backend starts without errors**

```bash
cd /Volumes/External/promptly/qa-chatbot
uv run uvicorn app.main:app --reload --port 8000
```

Expected: server starts, no import errors.

- [ ] **Step 6: Run existing tests**

```bash
cd /Volumes/External/promptly/qa-chatbot
uv run ruff check src/ && uv run mypy src/
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd /Volumes/External/promptly/qa-chatbot
git add src/app/core/middleware.py src/app/config/app.py src/app/main.py .env.example
git commit -m "feat(backend): add RequestLimitMiddleware — body size cap + request timeout"
```

---

## Task 7: Backend — Redis-Backed Rate Limiting

**Files:**
- Modify: `qa-chatbot/src/app/core/middleware.py`

The current `RateLimitMiddleware` uses an in-memory dict. This doesn't survive restarts and doesn't work across multiple API workers. Replace with Redis INCR + EXPIRE — atomic and distributed.

- [ ] **Step 1: Replace `RateLimitMiddleware` in `qa-chatbot/src/app/core/middleware.py`**

Replace the entire `RateLimitMiddleware` class with:

```python
import redis.asyncio as aioredis

from app.config.rate_limit import get_rate_limit_settings
from app.config.redis import get_redis_settings


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Redis-backed sliding-window rate limiter keyed by client IP."""

    def __init__(self, app: Any) -> None:
        super().__init__(app)
        redis_settings = get_redis_settings()
        self._redis: aioredis.Redis = aioredis.from_url(  # type: ignore[assignment]
            str(redis_settings.REDIS_URL),
            encoding="utf-8",
            decode_responses=True,
        )

    async def dispatch(self, request: Request, call_next: Any) -> Any:
        settings = get_rate_limit_settings()
        client_ip = request.client.host if request.client else "unknown"
        key = f"rl:{client_ip}"

        pipe = self._redis.pipeline()
        await pipe.incr(key)
        await pipe.expire(key, settings.RATE_LIMIT_WINDOW_SECONDS)
        results: list[int] = await pipe.execute()
        count: int = results[0]

        if count > settings.RATE_LIMIT_REQUESTS:
            return JSONResponse(
                status_code=429,
                content={"detail": "Rate limit exceeded. Please slow down."},
                headers={"Retry-After": str(settings.RATE_LIMIT_WINDOW_SECONDS)},
            )

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(settings.RATE_LIMIT_REQUESTS)
        response.headers["X-RateLimit-Remaining"] = str(
            max(0, settings.RATE_LIMIT_REQUESTS - count)
        )
        return response
```

This uses `redis.asyncio` which is already in the project dependencies (`redis[hiredis]>=7.4.0`).

- [ ] **Step 2: Verify ruff and mypy pass**

```bash
cd /Volumes/External/promptly/qa-chatbot
uv run ruff check src/app/core/middleware.py
uv run mypy src/app/core/middleware.py
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Volumes/External/promptly/qa-chatbot
git add src/app/core/middleware.py
git commit -m "feat(backend): replace in-memory rate limiter with Redis-backed distributed limiter"
```

---

## Task 8: Backend — Sentry Integration

**Files:**
- Modify: `qa-chatbot/pyproject.toml`
- Modify: `qa-chatbot/src/app/config/app.py`
- Modify: `qa-chatbot/src/app/main.py`
- Modify: `qa-chatbot/src/app/workers/celery_app.py`
- Modify: `qa-chatbot/.env.example`

- [ ] **Step 1: Add `sentry-sdk` to `qa-chatbot/pyproject.toml`**

In the `[project]` `dependencies` list, add:

```toml
"sentry-sdk[fastapi]>=2.0.0",
```

Then install:

```bash
cd /Volumes/External/promptly/qa-chatbot
uv sync
```

- [ ] **Step 2: Add `SENTRY_DSN` to `qa-chatbot/src/app/config/app.py`**

```python
from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class AppSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )
    APP_NAME: str = "qa-chatbot"
    ENVIRONMENT: str = "development"
    DEBUG: bool = False
    API_V1_PREFIX: str = "/api/v1"
    CORS_ORIGIN: list[str] = ["http://localhost:3000", "*"]
    MAX_REQUEST_BODY_BYTES: int = 1 * 1024 * 1024
    REQUEST_TIMEOUT_SECONDS: float = 60.0
    SENTRY_DSN: SecretStr | None = None


@lru_cache
def get_app_settings() -> AppSettings:
    return AppSettings()
```

- [ ] **Step 3: Wire Sentry into FastAPI in `qa-chatbot/src/app/main.py`**

Add Sentry initialisation inside `create_app()` **before** middleware registration:

```python
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
from sentry_sdk.integrations.celery import CeleryIntegration


def _init_sentry(settings: AppSettings) -> None:
    if not settings.SENTRY_DSN:
        return
    sentry_sdk.init(
        dsn=settings.SENTRY_DSN.get_secret_value(),
        environment=settings.ENVIRONMENT,
        integrations=[
            FastApiIntegration(transaction_style="endpoint"),
            SqlalchemyIntegration(),
            CeleryIntegration(),
        ],
        traces_sample_rate=0.2 if settings.ENVIRONMENT == "production" else 0.0,
        send_default_pii=False,  # never send passwords/tokens
    )
```

Call it at the start of `create_app()`:

```python
def create_app() -> FastAPI:
    settings = get_app_settings()
    _init_sentry(settings)
    # ... rest of create_app unchanged
```

- [ ] **Step 4: Wire Sentry into Celery in `qa-chatbot/src/app/workers/celery_app.py`**

```python
import sentry_sdk
from sentry_sdk.integrations.celery import CeleryIntegration

from app.config.app import get_app_settings
from app.config.redis import get_redis_settings

redis_settings = get_redis_settings()
app_settings = get_app_settings()

celery_app = Celery(
    "qa_chatbot",
    broker=str(redis_settings.REDIS_URL),
    backend=str(redis_settings.REDIS_URL),
    include=["app.workers.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
)

# Initialise Sentry for the worker process (CeleryIntegration patches task signals)
if app_settings.SENTRY_DSN:
    sentry_sdk.init(
        dsn=app_settings.SENTRY_DSN.get_secret_value(),
        environment=app_settings.ENVIRONMENT,
        integrations=[CeleryIntegration()],
        traces_sample_rate=0.0,
        send_default_pii=False,
    )
```

- [ ] **Step 5: Add `SENTRY_DSN` to `.env.example`**

Append to `qa-chatbot/.env.example`:

```bash
# Sentry — leave blank to disable error tracking (safe for local dev)
SENTRY_DSN=
```

- [ ] **Step 6: Verify ruff and mypy pass**

```bash
cd /Volumes/External/promptly/qa-chatbot
uv run ruff check src/
uv run mypy src/
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd /Volumes/External/promptly/qa-chatbot
git add pyproject.toml uv.lock src/app/config/app.py src/app/main.py src/app/workers/celery_app.py .env.example
git commit -m "feat(backend): add Sentry SDK integration for FastAPI and Celery"
```

---

## Task 9: Backend — Celery Graceful Shutdown

**Files:**
- Modify: `qa-chatbot/src/app/workers/celery_app.py`

When Kubernetes (or Docker) sends SIGTERM, Celery should finish any in-flight task before exiting rather than being killed mid-execution.

- [ ] **Step 1: Add SIGTERM handler to `qa-chatbot/src/app/workers/celery_app.py`**

Append at the bottom of the file (after `celery_app` is defined):

```python
import logging
import signal

logger = logging.getLogger(__name__)


def _graceful_shutdown(signum: int, frame: object) -> None:  # noqa: ARG001
    """
    On SIGTERM: tell Celery to finish the current task then exit cleanly.
    `celery_app.control.revoke` would hard-cancel; we use warm shutdown instead.
    """
    logger.info("SIGTERM received — initiating warm Celery shutdown")
    celery_app.control.broadcast("shutdown", destination=None)


signal.signal(signal.SIGTERM, _graceful_shutdown)
```

- [ ] **Step 2: Verify ruff / mypy**

```bash
cd /Volumes/External/promptly/qa-chatbot
uv run ruff check src/app/workers/
uv run mypy src/app/workers/
```

Expected: no errors. Note: `ARG001` (unused function argument) is suppressed inline since `signum`/`frame` are required by the signal API but we don't use them.

- [ ] **Step 3: Commit**

```bash
cd /Volumes/External/promptly/qa-chatbot
git add src/app/workers/celery_app.py
git commit -m "feat(backend): add SIGTERM graceful shutdown handler for Celery worker"
```

---

## Task 10: CI/CD — Frontend Pipeline

**Files:**
- Create: `frontend/.github/workflows/ci.yml`

Note: GitHub Actions looks for workflows in `.github/workflows/` relative to the repo root. Since the frontend is in a subdirectory, the workflow runs from the repo root but `working-directory` scopes all steps.

- [ ] **Step 1: Create `frontend/.github/workflows/ci.yml`**

Wait — GitHub Actions must be in the **root** `.github/workflows/`. Create `/.github/workflows/frontend-ci.yml` at the repo root level instead.

Check if root `.github` exists:

```bash
ls /Volumes/External/promptly/.github/ 2>/dev/null || echo "not found"
```

If not found, create the directory: `mkdir -p /Volumes/External/promptly/.github/workflows/`

- [ ] **Step 2: Create `/.github/workflows/frontend-ci.yml`**

```yaml
name: Frontend CI

on:
  pull_request:
    branches: [main, develop]
    paths:
      - 'frontend/**'
      - '.github/workflows/frontend-ci.yml'
  push:
    branches: [main, develop]
    paths:
      - 'frontend/**'

jobs:
  quality:
    name: Type Check, Lint & Build
    runs-on: ubuntu-latest

    defaults:
      run:
        working-directory: frontend

    steps:
      - uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json

      - name: Install dependencies
        run: npm ci

      - name: Lint (ESLint)
        run: npm run lint

      - name: Type check
        run: npx tsc --noEmit

      - name: Build
        run: npm run build
        env:
          NEXT_PUBLIC_API_URL: http://localhost:8000
```

Save to `/Volumes/External/promptly/.github/workflows/frontend-ci.yml`.

- [ ] **Step 3: Commit**

```bash
cd /Volumes/External/promptly
git add .github/workflows/frontend-ci.yml
git commit -m "ci: add frontend CI pipeline — lint, type-check, build on PR"
```

---

## Task 11: CI/CD — Coverage Gate in Backend CI

**Files:**
- Modify: `qa-chatbot/.github/workflows/ci.yml`

- [ ] **Step 1: Update the pytest step in `qa-chatbot/.github/workflows/ci.yml`**

Find the `Run unit tests` and `Run integration tests` steps. Replace them with a single step that enforces a coverage minimum:

```yaml
      - name: Run tests with coverage gate
        run: |
          uv run pytest tests/ \
            -v --tb=short \
            --cov=app \
            --cov-report=xml \
            --cov-report=term-missing \
            --cov-fail-under=60
```

This fails the CI job if coverage drops below 60%. Adjust threshold as test suite grows.

Also update the artifact upload step to match:

```yaml
      - name: Upload coverage report
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: coverage-report
          path: coverage.xml
```

- [ ] **Step 2: Commit**

```bash
cd /Volumes/External/promptly/qa-chatbot
git add .github/workflows/ci.yml
git commit -m "ci(backend): add coverage gate — fail CI if coverage drops below 60%"
```

---

## Final Verification

- [ ] **Verify full frontend build**

```bash
cd /Volumes/External/promptly/frontend
npm run build
```

Expected: `✓ Compiled successfully` with all 10 routes.

- [ ] **Verify backend linting**

```bash
cd /Volumes/External/promptly/qa-chatbot
uv run ruff check src/ && uv run mypy src/
```

Expected: no errors.

- [ ] **Final commit summary**

```bash
cd /Volumes/External/promptly
git log --oneline -15
```

Expected: all 11 task commits visible in clean history.
