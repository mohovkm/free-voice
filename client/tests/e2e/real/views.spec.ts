/**
 * Real views E2E tests — navigate every app route and assert no console errors.
 *
 * Uses a single shared login session and SvelteKit client-side navigation
 * (clicking <a> links) to avoid full page reloads that would reset the
 * in-memory Matrix auth state.
 */
import { test, expect } from '@playwright/test';
import { newMatrixContext, enableMatrixFlags, loginAs, USERS, collectConsoleErrors } from './helpers';

// Known non-critical noise from the Matrix JS SDK and legacy API calls.
// These appear as console.error but are expected in Matrix mode.
const KNOWN_NOISE = [
	'service worker',
	'push',
	'Push',
	'404',
	'/api/',
	'422',
	'MatrixRTCSessionManager',
	"Can't fetch server versions",
	'/sync error',
	'ConnectionError',
	'fetch failed',
	'Failed to fetch',
];

function isCritical(msg) {
	return !KNOWN_NOISE.some((s) => msg.includes(s));
}

test.describe('Views — all routes render without errors', () => {
	let sharedContext;
	let sharedPage;

	test.beforeAll(async ({ browser }) => {
		sharedContext = await newMatrixContext(browser);
		await enableMatrixFlags(sharedContext);
		sharedPage = await sharedContext.newPage();
		await loginAs(sharedPage, USERS.alice);
		// Give Matrix sync a moment to settle after login
		await sharedPage.waitForTimeout(3_000);
	});

	test.afterAll(async () => {
		await sharedContext?.close();
	});

	/** Navigate via SvelteKit client-side link click (no full page reload). */
	async function navTo(href) {
		// force: true bypasses any overlay that might be covering the link
		await sharedPage.click(`a[href="${href}"]`, { force: true });
		await sharedPage.waitForTimeout(1_000);
	}

	/** Navigate to settings-linked routes via the settings page. */
	async function navViaSettings(href) {
		await navTo('/settings');
		await sharedPage.click(`a[href="${href}"]`);
		await sharedPage.waitForTimeout(1_000);
	}

	async function checkNoErrors() {
		const errors = collectConsoleErrors(sharedPage);
		await sharedPage.waitForTimeout(2_000);
		const critical = errors.filter(isCritical);
		expect(critical, `Unexpected console errors`).toHaveLength(0);
	}

	test('home (chats list) renders', async () => {
		await navTo('/');
		const hasContent = await sharedPage.locator('.conversation-list, .page-center').first().isVisible();
		expect(hasContent).toBe(true);
		await checkNoErrors();
	});

	test('contacts page renders', async () => {
		await navTo('/contacts');
		await expect(sharedPage.locator('h1')).toContainText('Contacts');
		await expect(sharedPage.locator('.add-row input')).toBeVisible();
		await checkNoErrors();
	});

	test('settings page renders', async () => {
		await navTo('/settings');
		await expect(sharedPage.locator('button.danger')).toBeVisible();
		await checkNoErrors();
	});

	test('guide page renders', async () => {
		// Use page.goto — isLoggedIn() fix on deployed server makes this safe
		await sharedPage.goto('/guide');
		await expect(sharedPage).not.toHaveURL('/login');
		await checkNoErrors();
	});

	test('about page renders', async () => {
		await sharedPage.goto('/about');
		await expect(sharedPage).not.toHaveURL('/login');
		await checkNoErrors();
	});
});
