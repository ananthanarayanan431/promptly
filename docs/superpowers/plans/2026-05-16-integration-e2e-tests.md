# Integration & E2E Test Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add backend integration tests for auth/credits/chat, Playwright E2E tests for the frontend, and update CI to enforce both before merge.

**Architecture:** Backend tests follow the existing `AsyncClient` + `db_session` fixture pattern from `test_favorites.py`. Playwright E2E tests live in `frontend/e2e/` with a custom fixture that seeds users via the real API. CI gets a coverage gate bump (60→75%) and a new Playwright job in `frontend-ci.yml`.

**Tech Stack:** pytest-asyncio, httpx AsyncClient, unittest.mock, `@playwright/test`, GitHub Actions

---

## File Map

### Created
- `qa-chatbot/tests/integration/conftest.py` — shared `auth_headers` async fixture (register + login helper)
- `qa-chatbot/tests/integration/api/test_auth.py` — 11 auth flow tests
- `qa-chatbot/tests/integration/api/test_credits.py` — 5 credit deduction / 402 tests
- `qa-chatbot/tests/integration/api/test_chat.py` — 5 chat submit + poll tests (replaces empty file)
- `frontend/playwright.config.ts` — Playwright configuration
- `frontend/e2e/fixtures.ts` — custom `test` with seeded user fixture
- `frontend/e2e/auth.spec.ts` — 4 auth flow E2E tests
- `frontend/e2e/optimize.spec.ts` — 3 optimize flow E2E tests
- `frontend/e2e/credits.spec.ts` — 2 credits display E2E tests

### Modified
- `.github/workflows/backend-ci.yml` — coverage gate 60 → 75
- `.github/workflows/frontend-ci.yml` — add `e2e` job
- `frontend/package.json` — add `@playwright/test` dev dependency and `test:e2e` script

---

## Task 1: Shared Integration Test Fixture

**Files:**
- Create: `qa-chatbot/tests/integration/conftest.py`

- [ ] **Step 1: Write the file**

```python
# qa-chatbot/tests/integration/conftest.py
from collections.abc import AsyncGenerator

import pytest_asyncio
from faker import Faker
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User

fake = Faker()


@pytest_asyncio.fixture
async def auth_headers(
    client: AsyncClient, db_session: AsyncSession
) -> AsyncGenerator[dict[str, str], None]:
    """Register a fresh user, log in, yield auth headers, then delete the user."""
    email = fake.unique.email()
    password = "TestPass123!"

    reg = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password},
    )
    assert reg.status_code == 200, reg.text

    login = await client.post(
        "/api/v1/auth/login",
        data={"username": email, "password": password},
    )
    assert login.status_code == 200, login.text
    token = login.json()["data"]["access_token"]

    yield {"Authorization": f"Bearer {token}"}

    result = await db_session.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user:
        await db_session.delete(user)
        await db_session.commit()
```

- [ ] **Step 2: Verify it is importable (no syntax errors)**

```bash
cd qa-chatbot && uv run python -c "import tests.integration.conftest; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add qa-chatbot/tests/integration/conftest.py
git commit -m "test: add shared auth_headers fixture for integration tests"
```

---

## Task 2: Auth Integration Tests

**Files:**
- Create: `qa-chatbot/tests/integration/api/test_auth.py`

**Key facts:**
- `POST /api/v1/auth/register` → JSON body `{email, password}` → 200 on success, 409 on duplicate
- `POST /api/v1/auth/login` → **form data** (`data=`, not `json=`) with `username` and `password` fields → 200 on success, 400 on bad credentials
- `GET /api/v1/users/me` → Bearer JWT → 200; no token → 401
- `POST /api/v1/users/api-keys` → JSON `{name}` → 201; returned key starts with `qac_`
- `DELETE /api/v1/users/api-keys/{key_id}` → 200 on success
- After revocation, using the key as Bearer → 401

- [ ] **Step 1: Write the failing tests**

```python
# qa-chatbot/tests/integration/api/test_auth.py
import pytest
from faker import Faker
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

fake = Faker()


@pytest.mark.asyncio
async def test_register_happy_path(client: AsyncClient) -> None:
    res = await client.post(
        "/api/v1/auth/register",
        json={"email": fake.unique.email(), "password": "StrongPass1!"},
    )
    assert res.status_code == 200
    assert "id" in res.json()["data"]
    assert "email" in res.json()["data"]


@pytest.mark.asyncio
async def test_register_duplicate_email(client: AsyncClient) -> None:
    email = fake.unique.email()
    await client.post("/api/v1/auth/register", json={"email": email, "password": "Pass123!"})
    res = await client.post("/api/v1/auth/register", json={"email": email, "password": "Pass123!"})
    assert res.status_code == 409


@pytest.mark.asyncio
async def test_login_valid_credentials(client: AsyncClient) -> None:
    email = fake.unique.email()
    password = "Pass123!"
    await client.post("/api/v1/auth/register", json={"email": email, "password": password})
    res = await client.post("/api/v1/auth/login", data={"username": email, "password": password})
    assert res.status_code == 200
    data = res.json()["data"]
    assert "access_token" in data
    assert "refresh_token" in data
    assert data["token_type"] == "bearer"


@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient) -> None:
    email = fake.unique.email()
    await client.post("/api/v1/auth/register", json={"email": email, "password": "Pass123!"})
    res = await client.post("/api/v1/auth/login", data={"username": email, "password": "wrong"})
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_login_unknown_email(client: AsyncClient) -> None:
    res = await client.post(
        "/api/v1/auth/login",
        data={"username": "nobody@example.com", "password": "irrelevant"},
    )
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_get_me_valid_jwt(client: AsyncClient, auth_headers: dict[str, str]) -> None:
    res = await client.get("/api/v1/users/me", headers=auth_headers)
    assert res.status_code == 200
    assert "email" in res.json()["data"]


@pytest.mark.asyncio
async def test_get_me_no_token(client: AsyncClient) -> None:
    res = await client.get("/api/v1/users/me")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_get_me_malformed_token(client: AsyncClient) -> None:
    res = await client.get("/api/v1/users/me", headers={"Authorization": "Bearer not.a.real.token"})
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_api_key_create(client: AsyncClient, auth_headers: dict[str, str]) -> None:
    res = await client.post(
        "/api/v1/users/api-keys",
        json={"name": "ci-test-key"},
        headers=auth_headers,
    )
    assert res.status_code == 201
    assert res.json()["data"]["key"].startswith("qac_")


@pytest.mark.asyncio
async def test_api_key_auth_on_protected_route(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    create_res = await client.post(
        "/api/v1/users/api-keys",
        json={"name": "auth-test-key"},
        headers=auth_headers,
    )
    raw_key = create_res.json()["data"]["key"]
    res = await client.get(
        "/api/v1/users/me", headers={"Authorization": f"Bearer {raw_key}"}
    )
    assert res.status_code == 200


@pytest.mark.asyncio
async def test_api_key_revoked_returns_401(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    create_res = await client.post(
        "/api/v1/users/api-keys",
        json={"name": "revoke-test-key"},
        headers=auth_headers,
    )
    key_id = create_res.json()["data"]["id"]
    raw_key = create_res.json()["data"]["key"]

    await client.delete(f"/api/v1/users/api-keys/{key_id}", headers=auth_headers)

    res = await client.get(
        "/api/v1/users/me", headers={"Authorization": f"Bearer {raw_key}"}
    )
    assert res.status_code == 401
```

- [ ] **Step 2: Run tests — expect them to pass (they test real endpoints against the live DB)**

```bash
cd qa-chatbot && uv run pytest tests/integration/api/test_auth.py -v --tb=short
```

Expected: all 11 tests PASS

- [ ] **Step 3: Commit**

```bash
git add qa-chatbot/tests/integration/api/test_auth.py
git commit -m "test: add auth integration tests (register, login, JWT, API key)"
```

---

## Task 3: Credits Integration Tests

**Files:**
- Create: `qa-chatbot/tests/integration/api/test_credits.py`

**Key facts:**
- `POST /api/v1/chat/` costs 10 credits; requires JSON `{prompt: "..."}` plus Bearer auth → 202
- `POST /api/v1/prompt-bridge/transfer` costs 5 credits (new mapping) or 1 credit (reuse); requires JSON `{source_prompt, source_model, target_model}` → 202
- Both return 402 when credits are insufficient (`ChatInsufficientCreditsException` / `PBInsufficientCreditsException`)
- To set a user's credits to a specific value, update `user.credits` directly in `db_session` and flush
- Credit balance read back via `db_session.refresh(user)` then `user.credits`
- `process_chat_async.apply_async` must be mocked so no worker is needed
- `run_prompt_transfer.apply_async` must be mocked so no worker is needed

- [ ] **Step 1: Write the failing tests**

```python
# qa-chatbot/tests/integration/api/test_credits.py
from unittest.mock import MagicMock, patch

import pytest
from faker import Faker
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User

fake = Faker()


async def _register_and_login(client: AsyncClient, credits: int, db: AsyncSession) -> tuple[dict[str, str], User]:
    """Register a user, set their credits, and return auth headers + user ORM object."""
    email = fake.unique.email()
    password = "Pass123!"
    await client.post("/api/v1/auth/register", json={"email": email, "password": password})

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one()
    user.credits = credits
    await db.flush()

    login = await client.post("/api/v1/auth/login", data={"username": email, "password": password})
    token = login.json()["data"]["access_token"]
    return {"Authorization": f"Bearer {token}"}, user


@pytest.mark.asyncio
async def test_chat_deducts_10_credits(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, user = await _register_and_login(client, credits=100, db=db_session)
    with patch("app.api.v1.chat.process_chat_async") as mock_task:
        mock_task.apply_async.return_value = MagicMock(id="fake-celery-id")
        res = await client.post(
            "/api/v1/chat/",
            json={"prompt": "You are a helpful assistant."},
            headers=headers,
        )
    assert res.status_code == 202
    await db_session.refresh(user)
    assert user.credits == 90


@pytest.mark.asyncio
async def test_chat_returns_402_with_zero_credits(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers, _ = await _register_and_login(client, credits=0, db=db_session)
    res = await client.post(
        "/api/v1/chat/",
        json={"prompt": "You are a helpful assistant."},
        headers=headers,
    )
    assert res.status_code == 402


@pytest.mark.asyncio
async def test_bridge_transfer_deducts_5_credits(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers, user = await _register_and_login(client, credits=100, db=db_session)
    with patch("app.prompt_bridge.api.router.run_prompt_transfer") as mock_task:
        mock_task.apply_async.return_value = MagicMock(id="fake-celery-id")
        res = await client.post(
            "/api/v1/prompt-bridge/transfer",
            json={
                "source_prompt": "You are a helpful assistant.",
                "source_model": "openai/gpt-4o",
                "target_model": "anthropic/claude-3-5-sonnet",
            },
            headers=headers,
        )
    assert res.status_code == 202
    await db_session.refresh(user)
    assert user.credits == 95


@pytest.mark.asyncio
async def test_bridge_transfer_returns_402_with_zero_credits(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers, _ = await _register_and_login(client, credits=0, db=db_session)
    res = await client.post(
        "/api/v1/prompt-bridge/transfer",
        json={
            "source_prompt": "You are a helpful assistant.",
            "source_model": "openai/gpt-4o",
            "target_model": "anthropic/claude-3-5-sonnet",
        },
        headers=headers,
    )
    assert res.status_code == 402


@pytest.mark.asyncio
async def test_bridge_transfer_returns_402_with_insufficient_credits(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers, _ = await _register_and_login(client, credits=4, db=db_session)
    res = await client.post(
        "/api/v1/prompt-bridge/transfer",
        json={
            "source_prompt": "You are a helpful assistant.",
            "source_model": "openai/gpt-4o",
            "target_model": "anthropic/claude-3-5-sonnet",
        },
        headers=headers,
    )
    assert res.status_code == 402
```

- [ ] **Step 2: Run tests**

```bash
cd qa-chatbot && uv run pytest tests/integration/api/test_credits.py -v --tb=short
```

Expected: all 5 tests PASS

- [ ] **Step 3: Commit**

```bash
git add qa-chatbot/tests/integration/api/test_credits.py
git commit -m "test: add credit deduction and 402 integration tests"
```

---

## Task 4: Chat Integration Tests

**Files:**
- Modify: `qa-chatbot/tests/integration/api/test_chat.py` (currently empty)

**Key facts:**
- `POST /api/v1/chat/` → JSON `{prompt: "..."}` → 202 with `{job_id, session_id}` in `data`
- `GET /api/v1/chat/jobs/{job_id}` → reads from Redis; seed state with `set_job_status` + `set_job_result` + `set_job_owner`
- `get_job_result` / `set_job_result` / `set_job_status` / `set_job_owner` are in `app.core.cache`
- An unknown job_id returns 404
- Unauthenticated requests return 401
- Import path for task mock: `app.api.v1.chat.process_chat_async`

- [ ] **Step 1: Write the tests**

```python
# qa-chatbot/tests/integration/api/test_chat.py
import json
import uuid
from unittest.mock import MagicMock, patch

import pytest
from faker import Faker
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import set_job_owner, set_job_result, set_job_status
from app.models.user import User

fake = Faker()


async def _make_user_with_credits(
    client: AsyncClient, db: AsyncSession, credits: int = 100
) -> dict[str, str]:
    email = fake.unique.email()
    password = "Pass123!"
    reg = await client.post("/api/v1/auth/register", json={"email": email, "password": password})
    user_id = reg.json()["data"]["id"]

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one()
    user.credits = credits
    await db.flush()

    login = await client.post("/api/v1/auth/login", data={"username": email, "password": password})
    token = login.json()["data"]["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_submit_chat_returns_job_id(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _make_user_with_credits(client, db_session)
    with patch("app.api.v1.chat.process_chat_async") as mock_task:
        mock_task.apply_async.return_value = MagicMock(id="fake-celery-id")
        res = await client.post(
            "/api/v1/chat/",
            json={"prompt": "You are a helpful assistant."},
            headers=headers,
        )
    assert res.status_code == 202
    data = res.json()["data"]
    assert "job_id" in data
    assert "session_id" in data


@pytest.mark.asyncio
async def test_submit_chat_unauthenticated(client: AsyncClient) -> None:
    res = await client.post("/api/v1/chat/", json={"prompt": "hello"})
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_poll_job_known_id(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_with_credits(client, db_session)

    # Get the user id from /me so we can seed job ownership
    me = await client.get("/api/v1/users/me", headers=headers)
    user_id = me.json()["data"]["id"]

    job_id = str(uuid.uuid4())
    await set_job_status(job_id, "completed")
    await set_job_owner(job_id, user_id)
    await set_job_result(
        job_id,
        json.dumps({"status": "completed", "result": {"optimized_prompt": "Better prompt."}}),
    )

    res = await client.get(f"/api/v1/chat/jobs/{job_id}", headers=headers)
    assert res.status_code == 200
    assert res.json()["data"]["status"] == "completed"


@pytest.mark.asyncio
async def test_poll_job_unknown_id(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _make_user_with_credits(client, db_session)
    res = await client.get(f"/api/v1/chat/jobs/{uuid.uuid4()}", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_poll_job_unauthenticated(client: AsyncClient) -> None:
    res = await client.get(f"/api/v1/chat/jobs/{uuid.uuid4()}")
    assert res.status_code == 401
```

- [ ] **Step 2: Run tests**

```bash
cd qa-chatbot && uv run pytest tests/integration/api/test_chat.py -v --tb=short
```

Expected: all 5 tests PASS

- [ ] **Step 3: Commit**

```bash
git add qa-chatbot/tests/integration/api/test_chat.py
git commit -m "test: add chat submit and poll integration tests"
```

---

## Task 5: Bump Backend Coverage Gate

**Files:**
- Modify: `.github/workflows/backend-ci.yml:107`

- [ ] **Step 1: Update the coverage threshold**

In `.github/workflows/backend-ci.yml`, find line 107 and change:
```yaml
            --cov-fail-under=60
```
to:
```yaml
            --cov-fail-under=75
```

- [ ] **Step 2: Run full test suite locally to confirm it passes the new gate**

```bash
cd qa-chatbot && uv run pytest tests/ -v --tb=short --cov=app --cov-report=term-missing --cov-fail-under=75
```

Expected: tests pass and coverage is ≥75%

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/backend-ci.yml
git commit -m "ci: raise coverage gate from 60% to 75%"
```

---

## Task 6: Install Playwright and Configure Frontend

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/playwright.config.ts`

- [ ] **Step 1: Install Playwright**

```bash
cd frontend && npm install --save-dev @playwright/test @faker-js/faker
npx playwright install chromium
```

- [ ] **Step 2: Add test script to package.json**

In `frontend/package.json`, update the `scripts` block to add:
```json
"test:e2e": "playwright test"
```

The full scripts block becomes:
```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "test:e2e": "playwright test"
}
```

- [ ] **Step 3: Create playwright.config.ts**

```typescript
// frontend/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
```

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/playwright.config.ts
git commit -m "chore: install Playwright and add test:e2e script"
```

---

## Task 7: Playwright Fixtures

**Files:**
- Create: `frontend/e2e/fixtures.ts`

**Key facts:**
- The backend API base URL is `http://localhost:8000`
- Register: `POST /api/v1/auth/register` → JSON `{email, password}`
- Login: `POST /api/v1/auth/login` → **form data** `username=&password=` with `Content-Type: application/x-www-form-urlencoded` → `data.access_token`
- To seed 0 credits, use `POST /api/v1/users/credits/add` with `{amount: -100}` using the user's own token (or just register the user without adding credits — they start at 100)
- There's no admin delete endpoint, so teardown skips DB cleanup (tests use unique emails so there's no collision risk)

- [ ] **Step 1: Write fixtures.ts**

```typescript
// frontend/e2e/fixtures.ts
import { test as base, expect } from '@playwright/test';
import { faker } from '@faker-js/faker';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

type UserFixture = {
  user: { email: string; password: string; id: string };
  authToken: string;
};

export const test = base.extend<UserFixture>({
  user: async ({ request }, use) => {
    const email = faker.internet.email({ provider: 'playwright-test.example' });
    const password = 'TestPass123!';

    const reg = await request.post(`${API_BASE}/api/v1/auth/register`, {
      data: { email, password },
    });
    const regBody = await reg.json();
    const id = regBody.data.id as string;

    await use({ email, password, id });
  },

  authToken: async ({ request, user }, use) => {
    const params = new URLSearchParams();
    params.append('username', user.email);
    params.append('password', user.password);

    const login = await request.post(`${API_BASE}/api/v1/auth/login`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: params.toString(),
    });
    const loginBody = await login.json();
    await use(loginBody.data.access_token as string);
  },
});

export { expect };
```

- [ ] **Step 2: Commit**

```bash
git add frontend/e2e/fixtures.ts
git commit -m "test: add Playwright user fixture with register/login seeding"
```

---

## Task 8: Auth E2E Tests

**Files:**
- Create: `frontend/e2e/auth.spec.ts`

**Key facts before writing:** You need to know the actual page selectors. Check the login page:
- Login form is at `/login`; the dashboard is at some path under `/` or `/dashboard`
- Look at `frontend/src/app/(dashboard)/` for the dashboard route and `frontend/src/app/(auth)/login/` for the login form

Run this before writing tests:
```bash
find /Volumes/External/promptly/frontend/src/app -name "page.tsx" | head -20
```

Then read the login page component to find the actual form field selectors (input name/placeholder/label text).

- [ ] **Step 1: Find login page selectors**

```bash
find frontend/src/app -name "page.tsx" | head -20
```

Then read the login page file to identify:
- The email input selector (by `name`, `placeholder`, or `label`)
- The password input selector
- The submit button selector
- The error message element

- [ ] **Step 2: Write auth.spec.ts using the real selectors**

Replace `<EMAIL_SELECTOR>`, `<PASSWORD_SELECTOR>`, `<SUBMIT_SELECTOR>`, `<ERROR_SELECTOR>`, and `<DASHBOARD_PATH>` with the real values you found in Step 1:

```typescript
// frontend/e2e/auth.spec.ts
import { test, expect } from './fixtures';

test('login with valid credentials redirects to dashboard', async ({ page, user }) => {
  await page.goto('/login');
  await page.fill('<EMAIL_SELECTOR>', user.email);
  await page.fill('<PASSWORD_SELECTOR>', user.password);
  await page.click('<SUBMIT_SELECTOR>');
  await expect(page).toHaveURL(/<DASHBOARD_PATH>/);
});

test('login with wrong password shows error', async ({ page, user }) => {
  await page.goto('/login');
  await page.fill('<EMAIL_SELECTOR>', user.email);
  await page.fill('<PASSWORD_SELECTOR>', 'wrong-password');
  await page.click('<SUBMIT_SELECTOR>');
  await expect(page.locator('<ERROR_SELECTOR>')).toBeVisible();
});

test('protected route without auth redirects to login', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/login/);
});

test('logout redirects to login and blocks re-entry', async ({ page, user, authToken }) => {
  // Log in via localStorage/cookie injection to skip form
  await page.goto('/login');
  await page.fill('<EMAIL_SELECTOR>', user.email);
  await page.fill('<PASSWORD_SELECTOR>', user.password);
  await page.click('<SUBMIT_SELECTOR>');
  await expect(page).toHaveURL(/<DASHBOARD_PATH>/);

  // Click logout
  await page.click('<LOGOUT_SELECTOR>');
  await expect(page).toHaveURL(/login/);

  // Confirm dashboard is blocked again
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/login/);
});
```

- [ ] **Step 3: Run auth tests**

```bash
cd frontend && npx playwright test e2e/auth.spec.ts --headed
```

Expected: all 4 tests PASS (fix any selector mismatches until they do)

- [ ] **Step 4: Commit**

```bash
git add frontend/e2e/auth.spec.ts
git commit -m "test: add Playwright auth E2E tests"
```

---

## Task 9: Optimize E2E Tests

**Files:**
- Create: `frontend/e2e/optimize.spec.ts`

**Key facts:** Read `frontend/src/app/(dashboard)/` to find the optimize/chat page selectors before writing. You need:
- The prompt textarea selector
- The submit button selector
- The loading/spinner selector visible while polling
- The result display selector when the job completes
- The error message selector shown on 402

- [ ] **Step 1: Find optimize page selectors**

```bash
find frontend/src/app -path "*/bridge*" -name "*.tsx" -o -path "*/optimize*" -name "*.tsx" | head -10
```

Read the relevant component to find the actual selectors.

- [ ] **Step 2: Write optimize.spec.ts using real selectors**

Replace all `<...>` placeholders with real values found in Step 1:

```typescript
// frontend/e2e/optimize.spec.ts
import { test, expect } from './fixtures';

test('submitting a prompt shows polling spinner', async ({ page, user }) => {
  // Log in
  await page.goto('/login');
  await page.fill('<EMAIL_SELECTOR>', user.email);
  await page.fill('<PASSWORD_SELECTOR>', user.password);
  await page.click('<SUBMIT_SELECTOR>');
  await expect(page).toHaveURL(/<DASHBOARD_PATH>/);

  await page.fill('<PROMPT_TEXTAREA_SELECTOR>', 'You are a helpful assistant.');
  await page.click('<OPTIMIZE_SUBMIT_SELECTOR>');
  await expect(page.locator('<SPINNER_SELECTOR>')).toBeVisible();
});

test('optimize with no credits shows error', async ({ page, user, authToken }) => {
  // Drain credits via API
  const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
  await page.request.post(`${API_BASE}/api/v1/users/credits/add`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    data: JSON.stringify({ amount: -100 }),
  });

  await page.goto('/login');
  await page.fill('<EMAIL_SELECTOR>', user.email);
  await page.fill('<PASSWORD_SELECTOR>', user.password);
  await page.click('<SUBMIT_SELECTOR>');
  await expect(page).toHaveURL(/<DASHBOARD_PATH>/);

  await page.fill('<PROMPT_TEXTAREA_SELECTOR>', 'You are a helpful assistant.');
  await page.click('<OPTIMIZE_SUBMIT_SELECTOR>');
  await expect(page.locator('<ERROR_MESSAGE_SELECTOR>')).toBeVisible();
});
```

- [ ] **Step 3: Run optimize tests**

```bash
cd frontend && npx playwright test e2e/optimize.spec.ts --headed
```

Expected: all tests PASS (fix selectors until they do)

- [ ] **Step 4: Commit**

```bash
git add frontend/e2e/optimize.spec.ts
git commit -m "test: add Playwright optimize E2E tests"
```

---

## Task 10: Credits Display E2E Tests

**Files:**
- Create: `frontend/e2e/credits.spec.ts`

**Key facts:** Find the credits display selector in the dashboard layout or nav component. Run:
```bash
grep -r "credits" frontend/src --include="*.tsx" -l
```
Then read those files to find the element that displays the credit count.

- [ ] **Step 1: Find the credits display selector**

```bash
grep -r "credits" frontend/src --include="*.tsx" -l
```

Read the relevant components to identify the selector for the credits counter in the UI.

- [ ] **Step 2: Write credits.spec.ts**

Replace `<CREDITS_DISPLAY_SELECTOR>` with the real value:

```typescript
// frontend/e2e/credits.spec.ts
import { test, expect } from './fixtures';

test('credits balance is visible in the dashboard', async ({ page, user }) => {
  await page.goto('/login');
  await page.fill('<EMAIL_SELECTOR>', user.email);
  await page.fill('<PASSWORD_SELECTOR>', user.password);
  await page.click('<SUBMIT_SELECTOR>');
  await expect(page).toHaveURL(/<DASHBOARD_PATH>/);

  await expect(page.locator('<CREDITS_DISPLAY_SELECTOR>')).toBeVisible();
  await expect(page.locator('<CREDITS_DISPLAY_SELECTOR>')).toContainText('100');
});
```

- [ ] **Step 3: Run credits tests**

```bash
cd frontend && npx playwright test e2e/credits.spec.ts --headed
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/e2e/credits.spec.ts
git commit -m "test: add Playwright credits display E2E test"
```

---

## Task 11: Add Playwright Job to Frontend CI

**Files:**
- Modify: `.github/workflows/frontend-ci.yml`

- [ ] **Step 1: Add the `e2e` job**

Append the following job to `.github/workflows/frontend-ci.yml` after the `quality` job:

```yaml
  e2e:
    name: Playwright E2E
    runs-on: ubuntu-latest
    needs: quality

    services:
      postgres:
        image: pgvector/pgvector:pg16
        env:
          POSTGRES_DB: qa_chatbot_test
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4

      - name: Install uv
        uses: astral-sh/setup-uv@v4
        with:
          version: "latest"

      - name: Set up Python
        run: uv python install 3.11

      - name: Install backend dependencies
        run: uv sync --all-extras
        working-directory: qa-chatbot

      - name: Run migrations
        run: uv run alembic upgrade head
        working-directory: qa-chatbot
        env:
          DATABASE_URL: postgresql+asyncpg://postgres:postgres@localhost:5432/qa_chatbot_test

      - name: Start backend server
        run: uv run uvicorn src.app.main:app --host 0.0.0.0 --port 8000 &
        working-directory: qa-chatbot
        env:
          DATABASE_URL: postgresql+asyncpg://postgres:postgres@localhost:5432/qa_chatbot_test
          REDIS_URL: redis://localhost:6379/0
          SECRET_KEY: test-secret-key-for-ci-only
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
          ENVIRONMENT: test

      - name: Wait for backend to be ready
        run: |
          for i in $(seq 1 30); do
            curl -sf http://localhost:8000/health && break || sleep 2
          done

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json

      - name: Install frontend dependencies
        run: npm ci
        working-directory: frontend

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium
        working-directory: frontend

      - name: Run Playwright tests
        run: npm run test:e2e
        working-directory: frontend
        env:
          NEXT_PUBLIC_API_URL: http://localhost:8000
          CI: true

      - name: Upload Playwright report
        uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: frontend/playwright-report/
```

- [ ] **Step 2: Check the backend has a `/health` endpoint** (used in the wait step above)

```bash
grep -r "health" qa-chatbot/src/app/api --include="*.py" -l
```

If no health route exists, change the wait step to poll `/api/v1/auth/register` with a bad request and check for a non-502:
```bash
for i in $(seq 1 30); do
  curl -sf -o /dev/null -w "%{http_code}" -X POST http://localhost:8000/api/v1/auth/register \
    -H "Content-Type: application/json" -d '{}' | grep -q "42[02]" && break || sleep 2
done
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/frontend-ci.yml
git commit -m "ci: add Playwright E2E job to frontend CI"
```

---

## Self-Review Notes

- Login uses **form data** (`data=`), not JSON — all fixtures and tests use the correct encoding.
- `InvalidCredentialsException` returns **400**, not 401 — test_auth.py asserts 400 for wrong password and unknown email.
- `register` returns **200** (no explicit `status_code` on the route decorator) — test asserts 200 not 201.
- `process_chat_async` is patched at `app.api.v1.chat.process_chat_async` (the import location, not the definition location).
- `run_prompt_transfer` is patched at `app.prompt_bridge.api.router.run_prompt_transfer`.
- Tasks 8–10 deliberately leave selector discovery as explicit steps — selectors can only be confirmed by reading the actual frontend components, not assumed.
- The `/health` endpoint existence is verified in Task 11 Step 2 rather than assumed.
