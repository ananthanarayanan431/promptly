// frontend/e2e/credits.spec.ts
import { test, expect } from './fixtures';

test('credits balance (100) is visible in sidebar after login', async ({ page, user }) => {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(user.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/optimize**', { timeout: 10_000 });

  // The sidebar CreditsCard renders the credit count as a plain number alongside the label "Credits".
  // It also renders "≈ 10 optimizations remaining" (100 credits / 10 = 10).
  // Locate the credits value: the sidebar contains a span with the credits number (100) next to "Credits" label.
  const creditsValue = page.locator('text=100').first();
  await expect(creditsValue).toBeVisible({ timeout: 8_000 });

  // Also confirm the "Credits" label text is present in the sidebar
  const creditsLabel = page.locator('text=Credits').first();
  await expect(creditsLabel).toBeVisible({ timeout: 5_000 });
});
