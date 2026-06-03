// frontend/e2e/optimize.spec.ts
import { test, expect } from './fixtures';

test.beforeEach(() => {
  test.skip(
    !process.env.RUN_E2E,
    'E2E requires a provisioned Supabase test project — quarantined; see docs/superpowers/notes/2026-06-03-deferred-work.md',
  );
});

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

// Helper: sign in and land on /optimize
async function loginAndGoToOptimize(
  page: import('@playwright/test').Page,
  user: { email: string; password: string },
) {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(user.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/optimize**', { timeout: 10_000 });
}

test('submit a prompt shows polling spinner', async ({ page, user }) => {
  await loginAndGoToOptimize(page, user);

  // The ChatInput textarea has placeholder "Paste your prompt here to optimize..."
  const textarea = page.locator('textarea[placeholder="Paste your prompt here to optimize..."]');
  await expect(textarea).toBeVisible({ timeout: 8_000 });

  await textarea.fill('You are a helpful assistant. Answer every question concisely.');

  // Submit via the circular send button (an unlabelled button inside the input widget)
  // The button becomes enabled once text is present; it contains the up-arrow SVG.
  // Pressing Enter (without Shift) also submits — use keyboard for reliability.
  await textarea.press('Enter');

  // After submission a loading spinner SVG appears inside the send button area
  // and/or the textarea becomes disabled while the job is in flight.
  // The ChatMessage component renders a loading turn — look for the spinning indicator.
  const spinner = page.locator('svg[style*="animation"], .animate-spin').first();
  await expect(spinner).toBeVisible({ timeout: 8_000 });
});

test('submit with 0 credits shows error message', async ({ page, user, authToken }) => {
  // Drain all credits before navigating
  await page.request.post(`${API_BASE}/api/v1/users/credits/add`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    data: JSON.stringify({ amount: -100 }),
  });

  await loginAndGoToOptimize(page, user);

  const textarea = page.locator('textarea[placeholder="Paste your prompt here to optimize..."]');
  await expect(textarea).toBeVisible({ timeout: 8_000 });
  await textarea.fill('You are a helpful assistant. Answer every question concisely.');
  await textarea.press('Enter');

  // Expect either a Sonner error toast or an inline error message in the chat turn
  const errorToast = page.locator('[data-sonner-toaster] li[data-type="error"]');
  const inlineError = page.locator('text=/insufficient credits|not enough credits|402|credits/i');
  await expect(errorToast.or(inlineError).first()).toBeVisible({ timeout: 10_000 });
});
