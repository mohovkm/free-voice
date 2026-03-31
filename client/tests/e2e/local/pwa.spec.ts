import { test, expect } from '@playwright/test';

test.describe('PWA', () => {
	test('serves manifest.json', async ({ page }) => {
		const response = await page.goto('/manifest.json');
		expect(response.status()).toBe(200);
		const manifest = await response.json();
		expect(manifest.name).toBe('FREE VOICE');
		expect(manifest.display).toBe('standalone');
		expect(manifest.icons.length).toBeGreaterThan(0);
	});

	test('has PWA meta tags', async ({ page }) => {
		await page.goto('/login');
		await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#17212B');
		await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.json');
	});

	test('has apple-touch-icon', async ({ page }) => {
		await page.goto('/login');
		await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/apple-touch-icon.png');
	});
});
