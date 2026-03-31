import { test, expect } from '@playwright/test';

test.describe('Guest call flow', () => {
	test('shows guest join form', async ({ page }) => {
		await page.goto('/call/test-slug');
		await expect(page.locator('h1')).toContainText('FREE VOICE');
		await expect(page.locator('input[type="text"]')).toBeVisible();
		await expect(page.locator('button[type="submit"]')).toContainText('Join Call');
	});

	test('shows error on invalid slug', async ({ page }) => {
		await page.route(/\/api\//, (route) => {
			return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'Link not found' }) });
		});
		await page.goto('/call/bad-slug');
		await page.fill('input[type="text"]', 'Guest');
		await page.click('button[type="submit"]');
		await expect(page.locator('.error-msg')).toContainText('Link not found');
	});
});
