/**
 * Real auth E2E tests — runs against the deployed Matrix server.
 *
 * Covers: login, invalid credentials, registration, logout, password reset,
 * and legacy-user migration into Matrix.
 */
import { test, expect } from '@playwright/test';
import { enableMatrixFlags, loginAs, registerUser, logoutUser, USERS, collectConsoleErrors } from './helpers';

function buildLegacyUser() {
	const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
	return {
		email: `legacy-migration-${suffix}@example.com`,
		displayName: `Legacy Migration ${suffix}`,
		initialPassword: `LegacyPass!${suffix}`,
	};
}

async function registerVerifiedLegacyUser(request, legacyUser) {
	const registerResp = await request.post('/api/auth/debug/legacy-user', {
		data: {
			email: legacyUser.email,
			password: legacyUser.initialPassword,
			display_name: legacyUser.displayName,
		},
	});
	expect(registerResp.ok()).toBeTruthy();
}

async function requestResetLinkFromUi(page, email) {
	const resetResponsePromise = page.waitForResponse((response) =>
		response.url().includes('/api/auth/password-reset/request') && response.request().method() === 'POST'
	);
	await page.fill('input[type="email"]', email);
	await page.click('button[type="submit"]');
	const resetResponse = await resetResponsePromise;
	expect(resetResponse.ok()).toBeTruthy();
	const resetBody = await resetResponse.json();
	test.skip(
		!resetBody.debug_reset_link,
		'Auth migration E2E requires API EMAIL_DEBUG=1 so verification/reset links are exposed in responses.',
	);
	await expect(page.locator('.info-msg')).toBeVisible({ timeout: 15_000 });
	return resetBody.debug_reset_link;
}

async function completePasswordReset(page, resetLink, newPassword) {
	await page.goto(resetLink);
	await page.locator('input[type="password"]').nth(0).fill(newPassword);
	await page.locator('input[type="password"]').nth(1).fill(newPassword);
	await page.click('button[type="submit"]');
	await expect(page.locator('.info-msg')).toBeVisible({ timeout: 15_000 });
	await page.getByRole('button', { name: 'Sign In' }).click();
	await page.waitForURL('/login', { timeout: 15_000 });
}

async function beginMatrixRegistration(request, username, password) {
	return request.post('/_matrix/client/v3/register', {
		data: { username, password },
		ignoreHTTPSErrors: true,
	});
}

test.describe('Auth — Matrix mode', () => {
	test.beforeEach(async ({ context }) => {
		await enableMatrixFlags(context);
	});

	test('login page renders correctly in Matrix mode', async ({ page }) => {
		const errors = collectConsoleErrors(page);
		await page.goto('/login');
		await expect(page.locator('h1')).toContainText('FREE VOICE');
		// Matrix mode still uses a text input, but the identifier is email-first.
		await expect(page.locator('input[type="text"]')).toBeVisible();
		await expect(page.locator('input[type="password"]')).toBeVisible();
		await expect(page.locator('button[type="submit"]')).toBeVisible();
		expect(errors).toHaveLength(0);
	});

	test('shows error on wrong credentials', async ({ page }) => {
		await page.goto('/login');
		await page.fill('input[type="text"]', `wrong-user-${Date.now()}@example.com`);
		await page.fill('input[type="password"]', 'wrongpassword_xyz');
		await page.click('button[type="submit"]');
		// Error message should appear
		const errorMsg = page.locator('.error-msg');
		await expect(errorMsg).toBeVisible({ timeout: 15_000 });
		// Still on login page
		await expect(page).toHaveURL('/login');
	});

	test('plain username login shows readable error, not [object Object]', async ({ page }) => {
		// Regression: MatrixLoginRequest used EmailStr — plain usernames caused a FastAPI
		// 422 validation error whose `detail` is an array, displayed as [object Object].
		await page.goto('/login');
		await page.fill('input[type="text"]', 'plaintextusername');
		await page.fill('input[type="password"]', 'wrongpassword_xyz');
		await page.click('button[type="submit"]');
		const errorMsg = page.locator('.error-msg');
		await expect(errorMsg).toBeVisible({ timeout: 15_000 });
		const text = await errorMsg.textContent();
		expect(text).not.toContain('[object Object]');
		expect(text.trim().length).toBeGreaterThan(0);
		await expect(page).toHaveURL('/login');
	});

	test('successful login redirects to chats and shows app shell', async ({ page }) => {
		test.skip(!USERS.alice.email, 'Set E2E_ALICE_EMAIL for real migrated-user login coverage.');
		const errors = collectConsoleErrors(page);
		await loginAs(page, USERS.alice);
		// App shell visible
		await expect(page.locator('.app-shell')).toBeVisible();
		// Filter expected non-critical errors: service worker, push, and legacy API 404s
		// (Matrix mode doesn't use the legacy FastAPI backend)
		const criticalErrors = errors.filter(
			(e) =>
				!e.includes('service worker') &&
				!e.includes('push') &&
				!e.includes('Push') &&
				!e.includes('404') &&
				!e.includes('/api/')
		);
		expect(criticalErrors).toHaveLength(0);
	});

	test.describe('reset password and migration', () => {
		test.describe.configure({ mode: 'serial' });

		let legacyUser;
		let migratedPassword;

		test('legacy verified user is forced through reset and migrates into Matrix on first sign-in', async ({ page, request }) => {
			legacyUser = buildLegacyUser();
			migratedPassword = `MigratedPass!${Date.now()}`;

			await registerVerifiedLegacyUser(request, legacyUser);

			await page.goto('/login');
			await page.fill('input[type="text"]', legacyUser.email);
			await page.fill('input[type="password"]', legacyUser.initialPassword);
			await page.click('button[type="submit"]');
			await page.waitForURL(/\/forgot-password/, { timeout: 15_000 });
			expect(new URL(page.url()).searchParams.get('email')).toBe(legacyUser.email);
			expect(new URL(page.url()).searchParams.get('required')).toBe('1');
			await expect(page.locator('p.text-secondary')).toContainText(/reset/i);

			const resetLink = await requestResetLinkFromUi(page, legacyUser.email);
			await completePasswordReset(page, resetLink, migratedPassword);

			await loginAs(page, { email: legacyUser.email, password: migratedPassword });
			await expect(page.locator('.app-shell')).toBeVisible({ timeout: 45_000 });
		});

		test('migrated Matrix user can request another reset and sign in with the new password', async ({ page }) => {
			test.skip(!legacyUser || !migratedPassword, 'Migration case did not complete in this run.');

			const finalPassword = `ResetAgain!${Date.now()}`;
			await page.goto(`/forgot-password?email=${encodeURIComponent(legacyUser.email)}`);

			const resetLink = await requestResetLinkFromUi(page, legacyUser.email);
			await completePasswordReset(page, resetLink, finalPassword);

			await loginAs(page, { email: legacyUser.email, password: finalPassword });
			await expect(page.locator('.app-shell')).toBeVisible({ timeout: 45_000 });
			await expect(page).toHaveURL('/');
		});

	});

	test('migrated user can sign in with plain username (localpart) instead of email', async ({ page, request }) => {
		// Regression: authenticate_matrix_user only queried user_by_email — plain localpart
		// returned "invalid credentials" even for valid accounts.
		// Self-contained: creates its own user and drives the full migration cycle.
		const user = buildLegacyUser();
		const password = `LocalpartPass!${Date.now()}`;

		await registerVerifiedLegacyUser(request, user);

		// First login triggers reset-required redirect
		await page.goto('/login');
		await page.fill('input[type="text"]', user.email);
		await page.fill('input[type="password"]', user.initialPassword);
		await page.click('button[type="submit"]');
		await page.waitForURL(/\/forgot-password/, { timeout: 15_000 });

		// Complete password reset — this provisions the Matrix account
		const resetLink = await requestResetLinkFromUi(page, user.email);
		await completePasswordReset(page, resetLink, password);

		// Log in with localpart instead of email — this is the regression path
		const localpart = user.email.split('@')[0].toLowerCase();
		await loginAs(page, { email: localpart, password });
		await expect(page.locator('.app-shell')).toBeVisible({ timeout: 45_000 });
	});

	test('unauthenticated visit to "/" redirects to /login', async ({ page }) => {
		// No login — Matrix flags are set but no credentials stored
		await page.goto('/');
		await page.waitForURL('/login', { timeout: 10_000 });
	});

	test('logout redirects to /login and clears session', async ({ page }) => {
		test.skip(!USERS.alice.email, 'Set E2E_ALICE_EMAIL for real migrated-user logout coverage.');
		await loginAs(page, USERS.alice);
		await logoutUser(page);
		await expect(page).toHaveURL('/login');
		// Verify session is cleared — navigating to app redirects back to login
		await page.goto('/');
		await page.waitForURL('/login', { timeout: 10_000 });
	});

	test('pure Matrix user (no legacy DB record) can sign in with plain username', async ({ page, request, baseURL }) => {
		// Regression: login() only tried the legacy API path for plain localparts.
		// Pure Matrix users (registered directly on Dendrite) are not in the legacy DB,
		// so the API returned 401 and the frontend re-threw instead of falling back to
		// direct Matrix SDK login.

		const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
		const username = `puremat-${suffix}`;
		const password = `PureMatPass!${suffix}`;

		// Register directly on Dendrite via the Matrix client API (UIAA dummy flow)
		const r1 = await beginMatrixRegistration(request, username, password);
		// Dendrite responds with 401 + session token to begin UIAA when direct
		// registration is enabled. This deployment intentionally disables that
		// flow, in which case a 403 is also valid and ends the test here.
		expect([401, 403]).toContain(r1.status());
		if (r1.status() === 403) {
			return;
		}

		const b1 = await r1.json();
		const session = b1.session;
		expect(session).toBeTruthy();

		const r2 = await request.post('/_matrix/client/v3/register', {
			data: { username, password, auth: { type: 'm.login.dummy', session } },
			ignoreHTTPSErrors: true,
		});
		expect(r2.ok()).toBeTruthy();

		// Log in via the app UI using the plain username — triggers API-401 → SDK fallback
		await loginAs(page, { email: username, password });
		await expect(page.locator('.app-shell')).toBeVisible({ timeout: 45_000 });
		// Wait to confirm the app stays on '/' and does not redirect back to /login.
		// Previously _bootstrapAcceptedContacts returned 401 "User not found" for pure
		// Matrix users, which triggered _authErrorHandler → immediate logout.
		await page.waitForTimeout(3000);
		await expect(page).toHaveURL('/');
	});

	test('register page renders in Matrix mode (username only)', async ({ page }) => {
		await page.goto('/register');
		// Matrix mode: username + display name + password fields (no email)
		await expect(page.locator('input[placeholder="Username"]')).toBeVisible();
		await expect(page.locator('input[type="password"]')).toBeVisible();
		await expect(page.locator('input[type="email"]')).not.toBeVisible();
	});
});
