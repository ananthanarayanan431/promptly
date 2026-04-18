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
