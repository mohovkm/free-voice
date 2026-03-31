import { test, expect } from '@playwright/test';

test.describe('Auth flow', () => {
	test('shows login page by default', async ({ page }) => {
		await page.goto('/login');
		await expect(page.locator('h1')).toContainText('FREE VOICE');
		await expect(page.locator('input[type="email"]')).toBeVisible();
		await expect(page.locator('input[type="password"]')).toBeVisible();
	});

	test('has link to register', async ({ page }) => {
		await page.goto('/login');
		const link = page.locator('a[href="/register"]');
		await expect(link).toBeVisible();
	});

	test('register page has all fields', async ({ page }) => {
		await page.goto('/register');
		await expect(page.locator('input[type="text"]')).toBeVisible();
		await expect(page.locator('input[type="email"]')).toBeVisible();
		await expect(page.locator('input[type="password"]')).toBeVisible();
	});

	test('shows error on invalid login', async ({ page }) => {
		await page.route(/\/api\//, (route) => {
			if (route.request().url().includes('/auth/login')) {
				return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ detail: 'Invalid credentials' }) });
			}
			return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
		});
		await page.goto('/login');
		await page.fill('input[type="email"]', 'bad@test.com');
		await page.fill('input[type="password"]', 'wrong');
		await page.click('button[type="submit"]');
		await expect(page.locator('.error-msg')).toContainText('Invalid credentials');
	});

	test('successful login redirects to chats', async ({ page }) => {
		const fakeJwt = 'h.' + Buffer.from(JSON.stringify({ sub: 'user@test.com', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64') + '.s';
		await page.route(/\/api\//, (route) => {
			const url = route.request().url();
			if (url.includes('/auth/login')) {
				return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: fakeJwt, refresh_token: 'ref' }) });
			}
			if (url.includes('/ws/')) return route.abort();
			return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
		});
		await page.goto('/login');
		await page.fill('input[type="email"]', 'user@test.com');
		await page.fill('input[type="password"]', 'pass123');
		await page.click('button[type="submit"]');
		await expect(page).toHaveURL('/');
	});
});
