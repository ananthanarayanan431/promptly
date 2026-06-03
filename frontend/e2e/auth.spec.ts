// frontend/e2e/auth.spec.ts
import { test, expect } from './fixtures';

test.beforeEach(() => {
  test.skip(
    !process.env.RUN_E2E,
    'E2E requires a provisioned Supabase test project — quarantined; see docs/superpowers/notes/2026-06-03-deferred-work.md',
  );
});

test('login with valid credentials redirects to dashboard', async ({ page, user }) => {
  await page.goto('/sign-in');

  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(user.password);
  await page.getByRole('button', { name: /sign in/i }).click();

  // After login the app redirects to /optimize
  await page.waitForURL('**/optimize**', { timeout: 10_000 });
  expect(page.url()).toContain('/optimize');
});

test('login with wrong password shows error toast', async ({ page, user }) => {
  await page.goto('/sign-in');

  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill('WrongPass999!');
  await page.getByRole('button', { name: /sign in/i }).click();

  // Sonner renders toasts under [data-sonner-toaster]; any [data-type="error"] toast is sufficient
  const toast = page.locator('[data-sonner-toaster] li[data-type="error"]');
  await expect(toast).toBeVisible({ timeout: 8_000 });
});

test('navigate to /optimize without auth redirects away from dashboard', async ({ page }) => {
  // The middleware redirects unauthenticated requests for /optimize to /
  await page.goto('/optimize');
  // Wait for a redirect — the middleware sends unauthenticated users to the landing page (/)
  await page.waitForURL((url) => !url.pathname.startsWith('/optimize'), { timeout: 8_000 });
  expect(page.url()).not.toContain('/optimize');
});

test('login then logout then /optimize redirects away from dashboard', async ({ page, user }) => {
  // Log in
  await page.goto('/sign-in');
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(user.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/optimize**', { timeout: 10_000 });

  // Log out via the sidebar button (title="Log out")
  await page.getByRole('button', { name: 'Log out' }).click();

  // After logout, navigating to /optimize should redirect away
  await page.waitForURL((url) => !url.pathname.startsWith('/optimize'), { timeout: 8_000 });

  await page.goto('/optimize');
  await page.waitForURL((url) => !url.pathname.startsWith('/optimize'), { timeout: 8_000 });
  expect(page.url()).not.toContain('/optimize');
});
