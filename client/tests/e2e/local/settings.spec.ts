import { test, expect } from '@playwright/test';
import { installAppShell } from './helpers';

async function setupShell(
	page,
	{ pushPermission = 'default', withSubscription = false, links = [], initialTheme = null, initialLocale = null } = {}
) {
	await installAppShell(page, {
		pushPermission,
		withSubscription,
		initialTheme,
		initialLocale
	});

	await page.route('**/api/**', async (route) => {
		const url = route.request().url();
		const method = route.request().method();
		if (url.includes('/ws/')) return route.abort();
		if (url.includes('/push/config')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					vapid_public_key: 'AQAB',
					sygnal_url: 'https://sygnal.example.test/_matrix/push/v1/notify',
					app_id: 'freevoice.test'
				})
			});
		}
		if (url.includes('/push/subscribe') && method === 'POST') {
			return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
		}
		if (url.endsWith('/api/links') && method === 'GET') {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(links)
			});
		}
		if (url.endsWith('/api/links') && method === 'POST') {
			links.unshift({ slug: 'new-link', active: true });
			return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
		}
		if (url.includes('/api/links/') && method === 'DELETE') {
			const slug = url.split('/api/links/')[1];
			links = links.map((link) => (link.slug === slug ? { ...link, active: false } : link));
			return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
		}
		return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
	});
}

async function openSettings(page) {
	await page.goto('/');
	await expect(page.locator('[data-matrix-ready]')).toBeVisible();
	await page.locator('a[href="/settings"]:visible').first().click();
	await expect(page).toHaveURL(/\/settings$/);
}

test.describe('Settings and shell', () => {
	test('shows settings header and current controls', async ({ page }) => {
		await setupShell(page);
		await openSettings(page);
		await expect(page.locator('h1')).toContainText('Settings');
		await expect(page.locator('text=Language')).toBeVisible();
		await expect(page.locator('text=Theme')).toBeVisible();
		await expect(page.locator('text=Logout')).toBeVisible();
		await expect(page.locator('text=Links')).toBeVisible();
		await expect(page.locator('text=About')).toBeVisible();
		await expect(page.locator('text=Clear cache')).toBeVisible();
	});

	test('persists language choice across reloads', async ({ page }) => {
		await setupShell(page, { initialLocale: 'en' });
		await openSettings(page);
		await page.getByRole('button', { name: /Language/i }).click();
		await expect(page.locator('text=Русский')).toBeVisible();
		await page.reload();
		await openSettings(page);
		await expect(page.locator('text=Русский')).toBeVisible();
		expect(await page.evaluate(() => localStorage.getItem('fv-lang'))).toBe('ru');
	});

	test('persists theme choice across reloads', async ({ page }) => {
		await setupShell(page, { initialTheme: 'system' });
		await openSettings(page);
		await page.getByRole('button', { name: /Theme/i }).click();
		const themeAfterClick = await page.evaluate(() => localStorage.getItem('fv-theme'));
		expect(themeAfterClick).toBeTruthy();
		await page.reload();
		await openSettings(page);
		expect(await page.evaluate(() => localStorage.getItem('fv-theme'))).toBe(themeAfterClick);
	});

	test('shows active push status when permission is granted and a subscription exists', async ({ page }) => {
		await setupShell(page, { pushPermission: 'granted', withSubscription: true });
		await openSettings(page);
		await expect(page.locator('text=Push notifications active')).toBeVisible();
		await expect(page.locator('text=Enable push notifications')).toHaveCount(0);
	});

	test('shows notification recovery action when permission is denied', async ({ page }) => {
		await setupShell(page, { pushPermission: 'denied', withSubscription: false });
		await openSettings(page);
		await expect(page.locator('text=Enable push notifications')).toBeVisible();
	});

	test('opens links, guide, and about routes from settings', async ({ page }) => {
		await setupShell(page, {
			links: [{ slug: 'daily-standup', active: true }]
		});
		await openSettings(page);

		await page.locator('a[href="/links"]').click();
		await expect(page).toHaveURL('/links');
		await expect(page.locator('h1')).toContainText('Links');
		await expect(page.locator('text=daily-standup')).toBeVisible();

		await page.goto('/');
		await page.locator('a[href="/settings"]:visible').first().click();
		await page.locator('a[href="/guide"]').click();
		await expect(page).toHaveURL('/guide');
		await expect(page.locator('.guide-progress')).toContainText('1 / 8');

		await page.goto('/');
		await page.locator('a[href="/settings"]:visible').first().click();
		await page.locator('a[href="/about"]').click();
		await expect(page).toHaveURL('/about');
		await expect(page.locator('h1')).toContainText('About');
	});

	test('clears service workers and caches before reloading', async ({ page }) => {
		await setupShell(page, { pushPermission: 'granted', withSubscription: true });
		await openSettings(page);
		const bootCount = await page.evaluate(() => window.__fvE2E.getBootCount());
		await page.getByRole('button', { name: /Clear cache/i }).click();
		await expect.poll(() => page.evaluate(() => window.__fvE2E.getBootCount())).toBeGreaterThan(bootCount);
		await expect.poll(() => page.evaluate(() => window.__fvE2E.getUnregisterCount())).toBe(1);
		await expect.poll(() => page.evaluate(() => window.__fvE2E.getCacheKeys().length)).toBe(0);
	});

	test('logout redirects to login', async ({ page }) => {
		await setupShell(page);
		await openSettings(page);
		await page.click('text=Logout');
		await expect(page).toHaveURL('/login');
	});

	test('registers the service worker controllerchange hook', async ({ page }) => {
		await setupShell(page);
		await page.goto('/');
		await expect(page.locator('[data-matrix-ready]')).toBeVisible();
		await expect.poll(() => page.evaluate(() => window.__fvE2E.getServiceWorkerListenerCount('controllerchange'))).toBe(1);
		const eventCount = await page.evaluate(() => window.__fvE2E.getServiceWorkerEventCount('controllerchange'));
		await page.evaluate(() => window.__fvE2E.dispatchServiceWorkerControllerChange());
		await expect.poll(() => page.evaluate(() => window.__fvE2E.getServiceWorkerEventCount('controllerchange'))).toBeGreaterThan(eventCount);
		await expect(page.locator('[data-matrix-ready]')).toBeVisible();
	});
});
