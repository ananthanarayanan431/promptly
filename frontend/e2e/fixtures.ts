// frontend/e2e/fixtures.ts
import { test as base, expect } from '@playwright/test';
import { faker } from '@faker-js/faker';

// NOTE: this fixture authenticates via POST /api/v1/auth/register + /api/v1/auth/login,
// neither of which exists after the Supabase migration. The e2e suite is QUARANTINED
// (specs skip unless RUN_E2E is set; the CI job is gated off via the RUN_E2E repo var).
// Repair requires a provisioned Supabase test project to mint a real session —
// see docs/superpowers/notes/2026-06-03-deferred-work.md

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
