# Integration & E2E Test Suite Design

**Date:** 2026-05-15
**Branch:** prompt-bridge-changes
**Scope:** Backend integration tests (auth, credits, chat) + Frontend Playwright E2E + CI/CD gate changes

---

## Context

The monorepo has a 60% coverage gate enforced in CI but only two integration test files:
- `tests/integration/api/test_favorites.py` — working, covers favorites CRUD
- `tests/integration/api/test_chat.py` — empty file (0 lines)

Missing coverage:
- Auth flow (login, JWT, API key, 401 handling)
- Credit deduction and 402 enforcement
- Chat job submission and polling
- Frontend has zero tests — no framework, no config, no test files

---

## Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Backend test pattern | Extend existing `tests/integration/api/` | Consistent with `test_favorites.py` pattern |
| Celery/worker E2E | Skipped for now | Mock `task.delay()` at dispatch boundary; worker E2E is a future phase |
| Frontend testing | Playwright only | Critical risks are in full-stack flows, not isolated components |
| Coverage gate | Raised from 60% to 75% | Meaningful signal without being brittle |
| Playwright job location | Inside `frontend-ci.yml` | Triggered by frontend changes; backend started as a subprocess |

---

## Section 1: Backend Integration Tests

### New files

```
qa-chatbot/tests/integration/
├── conftest.py          # shared: create_user_and_login() fixture
└── api/
    ├── test_auth.py
    ├── test_credits.py
    └── test_chat.py     # replaces empty file
```

### `tests/integration/conftest.py`

Adds a `create_user_and_login` async fixture available to all integration tests:
- Registers a user via `POST /api/v1/auth/register` using Faker-generated email/password
- Logs in via `POST /api/v1/auth/login` to get a JWT
- Returns `{"Authorization": "Bearer <token>"}` header dict + the user dict
- Teardown: deletes the user row from the DB to keep tests isolated

### `test_auth.py`

| Test | Endpoint | Expected |
|------|----------|----------|
| Register happy path | `POST /api/v1/auth/register` | 201, user returned |
| Register duplicate email | `POST /api/v1/auth/register` | 409 |
| Login valid credentials | `POST /api/v1/auth/login` | 200, JWT in response |
| Login wrong password | `POST /api/v1/auth/login` | 401 |
| Login unknown email | `POST /api/v1/auth/login` | 401 |
| Get current user (valid JWT) | `GET /api/v1/users/me` | 200, user object |
| Get current user (no token) | `GET /api/v1/users/me` | 401 |
| Get current user (malformed token) | `GET /api/v1/users/me` | 401 |
| API key auth — create key | `POST /api/v1/users/api-keys` | 201, key starts with `qac_` |
| API key auth — use key on protected route | `GET /api/v1/users/me` with key as Bearer | 200 |
| API key auth — revoke then use key | `DELETE /api/v1/users/api-keys/{key_id}` then `GET /api/v1/users/me` | 401 |

### `test_credits.py`

| Test | Setup | Endpoint | Expected |
|------|-------|----------|----------|
| Optimize costs 10 credits | User with 100 credits | `POST /api/v1/chat/` | 202, DB shows 90 credits |
| Optimize with 0 credits | User with 0 credits | `POST /api/v1/chat/` | 402 |
| Prompt Bridge transfer costs 5 credits | User with 100 credits | `POST /api/v1/prompt-bridge/transfer` | 202, DB shows 95 credits |
| Prompt Bridge with 0 credits | User with 0 credits | `POST /api/v1/prompt-bridge/transfer` | 402 |
| Insufficient credits for transfer | User with 4 credits | `POST /api/v1/prompt-bridge/transfer` | 402 |

Credit balance verified by querying the DB directly via `db_session` after each request.

### `test_chat.py`

| Test | Setup | Endpoint | Expected |
|------|-------|----------|----------|
| Submit prompt (authenticated) | Mock `task.delay`, valid user | `POST /api/v1/chat/` | 202, `job_id` in response |
| Submit prompt (unauthenticated) | No token | `POST /api/v1/chat/` | 401 |
| Poll job — known id | Seed job state in Redis | `GET /api/v1/chat/jobs/{id}` | 200, status + result |
| Poll job — unknown id | No such job | `GET /api/v1/chat/jobs/{id}` | 404 |
| Poll job — unauthenticated | No token | `GET /api/v1/chat/jobs/{id}` | 401 |

Celery dispatch mocked via `unittest.mock.patch("app.workers.tasks.process_chat_async.apply_async")` so no worker is needed.

---

## Section 2: Frontend Playwright E2E

### New files

```
frontend/
├── playwright.config.ts
├── e2e/
│   ├── fixtures.ts          # custom test with seeded user
│   ├── auth.spec.ts
│   ├── optimize.spec.ts
│   └── credits.spec.ts
```

### `playwright.config.ts`

```ts
baseURL: 'http://localhost:3000'
webServer: { command: 'npm run dev', port: 3000, reuseExistingServer: true }
retries: process.env.CI ? 2 : 0
reporter: process.env.CI ? 'github' : 'html'
use: { trace: 'on-first-retry' }
projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }]
```

### `e2e/fixtures.ts`

Exports a custom `test` that:
- Seeds a test user via `request.post('/api/v1/auth/register')` with Faker data before each test
- Exposes `{ user, authToken }` to the test body
- Tears down by deleting the user via API after each test
- Also exports `expect` re-exported from `@playwright/test`

### `auth.spec.ts`

| Test | Steps | Assert |
|------|-------|--------|
| Login valid credentials | Fill form, submit | Redirected to `/dashboard` |
| Login wrong password | Fill form with bad password | Error message visible |
| Protected route without auth | Navigate to `/dashboard` directly | Redirected to `/login` |
| Logout | Login, click logout | Redirected to `/login`; `/dashboard` redirects again |

### `optimize.spec.ts`

| Test | Steps | Assert |
|------|-------|--------|
| Submit prompt | Login, fill prompt textarea, submit | Polling spinner visible |
| Poll resolves | Wait for result (mock or real fast LLM) | Optimized result text visible on page |
| Submit with no credits | Seed user with 0 credits, submit | 402 error message shown in UI |

### `credits.spec.ts`

| Test | Steps | Assert |
|------|-------|--------|
| Balance shown in header | Login | Credits count visible in nav/header |
| Balance decreases after optimize | Login, submit prompt, wait for result | Credits count decremented |

---

## Section 3: CI/CD Changes

### `backend-ci.yml`

Single change — coverage gate:
```yaml
# Before
--cov-fail-under=60
# After
--cov-fail-under=75
```

### `frontend-ci.yml`

Add `e2e` job after existing `quality` job:

```yaml
e2e:
  needs: quality
  runs-on: ubuntu-latest
  services:
    postgres:
      image: pgvector/pgvector:pg16
      env:
        POSTGRES_USER: postgres
        POSTGRES_PASSWORD: postgres
        POSTGRES_DB: qa_chatbot_test
      ports: ["5432:5432"]
    redis:
      image: redis:7
      ports: ["6379:6379"]
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-python@v5
      with: { python-version: '3.11' }
    - name: Install backend deps
      run: cd qa-chatbot && pip install uv && uv sync
    - name: Run migrations
      run: cd qa-chatbot && alembic upgrade head
      env:
        DATABASE_URL: postgresql+asyncpg://postgres:postgres@localhost:5432/qa_chatbot_test
    - name: Start backend server
      run: cd qa-chatbot && uvicorn src.app.main:app --port 8000 &
      env:
        DATABASE_URL: postgresql+asyncpg://postgres:postgres@localhost:5432/qa_chatbot_test
        REDIS_URL: redis://localhost:6379/0
        SECRET_KEY: ${{ secrets.SECRET_KEY }}
        OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
    - uses: actions/setup-node@v4
      with: { node-version: '20', cache: 'npm', cache-dependency-path: frontend/package-lock.json }
    - name: Install frontend deps
      run: cd frontend && npm ci
    - name: Install Playwright browsers
      run: cd frontend && npx playwright install --with-deps chromium
    - name: Run Playwright tests
      run: cd frontend && npx playwright test
      env:
        NEXT_PUBLIC_API_URL: http://localhost:8000
    - name: Upload Playwright report
      uses: actions/upload-artifact@v4
      if: failure()
      with:
        name: playwright-report
        path: frontend/playwright-report/
```

### Branch Protection (manual step)

After merging, add `test` and `e2e` as required status checks in GitHub → Settings → Branches → `main` protection rules.

---

## Out of Scope (Future Phase)

- Celery worker E2E (submit → real async job → poll result)
- Vitest component tests
- Visual regression testing
- Load / performance testing
