/**
 * Shared helpers for real-server E2E tests.
 *
 * All configuration comes from environment variables so tests work against
 * any deployment without code changes.
 *
 * Required env vars (see repository .env.template for a publishable example):
 *   E2E_BASE_URL       — app base URL, e.g. https://my-server.duckdns.org:8443
 *   E2E_MATRIX_DOMAIN  — Matrix homeserver domain (defaults to hostname of E2E_BASE_URL)
 *   E2E_ALICE_EMAIL    — first test account email for Matrix-era login
 *   E2E_ALICE_USER     — first test account username/localpart
 *   E2E_ALICE_PASS     — first test account password
 *   E2E_BOB_EMAIL      — second test account email for Matrix-era login
 *   E2E_BOB_USER       — second test account username/localpart
 *   E2E_BOB_PASS       — second test account password
 */

import { expect } from '@playwright/test';

// Base URL is read from E2E_BASE_URL first, then from the local root config
// so public contributors do not need maintainer-specific deployment files.
import { existsSync, readFileSync } from 'fs';
import jsYaml from 'js-yaml';
const { load: loadYaml } = jsYaml;
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const repoRoot   = resolve(__dirname, '../../../..');
const configPath = resolve(repoRoot, 'config.yml');
const appConfig = existsSync(configPath)
	? loadYaml(readFileSync(configPath, 'utf8'))
	: null;
const varsConfig = loadYaml(
	readFileSync(resolve(repoRoot, 'ansible/inventory/group_vars/all/vars.yml'), 'utf8')
);

const _baseURL = process.env.E2E_BASE_URL
	|| (appConfig
		? `https://${appConfig.duckdns_subdomain}.duckdns.org:${varsConfig.https_port}`
		: '');
const _ipBaseURL = appConfig
	? `https://${appConfig.pi_static_ip}:${varsConfig.https_port}`
	: '';

if (!_baseURL) {
	throw new Error(
		'Real E2E helpers require E2E_BASE_URL or a local config.yml with deployment settings.'
	);
}

/** Matrix homeserver domain derived from base URL or overridden via env. */
export const DOMAIN =
	process.env.E2E_MATRIX_DOMAIN || new URL(_baseURL).hostname;

/** Full Matrix user ID for a given username. */
export const matrixId = (username) => `@${username}:${DOMAIN}`;

/** Credentials for the two permanent E2E test accounts. */
export const USERS = {
	alice: {
		email: process.env.E2E_ALICE_EMAIL || '',
		username: process.env.E2E_ALICE_USER || 'testuser',
		password: process.env.E2E_ALICE_PASS || '',
	},
	bob: {
		email: process.env.E2E_BOB_EMAIL || '',
		username: process.env.E2E_BOB_USER || 'e2ebot',
		password: process.env.E2E_BOB_PASS || '',
	},
};

/**
 * Create a new BrowserContext with all settings needed for Matrix E2E tests:
 * HTTPS errors ignored, media permissions granted, fake device flags already
 * set via launchOptions in playwright.real.config.ts.
 *
 * Use this instead of browser.newContext({...}) directly so permissions are
 * not accidentally missing (getUserMedia hangs without microphone permission
 * even when --use-fake-ui-for-media-stream is set).
 */
export async function newMatrixContext(browser) {
	return browser.newContext({
		ignoreHTTPSErrors: true,
		permissions: ['microphone', 'camera'],
	});
}

/**
 * Set Matrix feature flags via localStorage before any page script runs.
 * Call on a BrowserContext before the first page.goto().
 */
export async function enableMatrixFlags(context) {
	await context.addInitScript(() => {
		localStorage.setItem('ff_matrix', '1');
		localStorage.setItem('ff_matrix_calls', '1');
	});
}

/** Enable Matrix + LiveKit feature flags and install an RTP stats probe. */
export async function enableLivekitFlags(context) {
	await enableMatrixFlags(context);
	await context.addInitScript(() => {
		localStorage.setItem('ff_livekit', '1');
	});
	// Track every RTCPeerConnection so tests can assert actual RTP flow.
	await context.addInitScript(() => {
		window.__rtcPCs = [];
		const OriginalRTCPeerConnection = window.RTCPeerConnection;
		window.RTCPeerConnection = class extends OriginalRTCPeerConnection {
			constructor(...args) {
				super(...args);
				window.__rtcPCs.push(this);
			}
		};
	});
}

function _isTransientNavigationError(error) {
	if (!(error instanceof Error)) return false;
	return (
		error.message.includes('ERR_NAME_NOT_RESOLVED') ||
		error.message.includes('ERR_NETWORK_CHANGED') ||
		error.message.includes('ERR_INTERNET_DISCONNECTED')
	);
}

/**
 * Retry the initial navigation for transient environment-level failures.
 *
 * This is limited to page entry and does not retry assertions or user actions.
 */
async function gotoWithRetry(page, url, options = {}, attempts = 3) {
	let lastError;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			const target =
				attempt > 1 && typeof url === 'string' && url.startsWith('/')
					? new URL(url, _ipBaseURL).toString()
					: url;
			await page.goto(target, options);
			return;
		} catch (error) {
			lastError = error;
			if (!_isTransientNavigationError(error) || attempt === attempts) throw error;
			await page.waitForTimeout(1000 * attempt);
		}
	}
	throw lastError;
}

/**
 * Log in as the given user via the UI.
 * Accepts either an email identifier or a Matrix username/localpart.
 * Waits for the redirect to '/' — login() now returns fast (Rust crypto init
 * runs in the background), so this resolves quickly.  Callers that need the
 * backend to be fully ready (crypto + sync) should separately wait for
 * [data-matrix-ready] on the app shell.
 */
export async function loginAs(page, { email, username, password }) {
	const identifier = email || username;
	await gotoWithRetry(page, '/login');
	await page.waitForSelector('input[type="text"]');
	await page.fill('input[type="text"]', identifier);
	await page.fill('input[type="password"]', password);
	await page.click('button[type="submit"]');
	// Real-server login can take longer on the Pi, and successful auth may restore
	// an in-app route instead of the root chats view.
	try {
		await page.waitForURL('/', { timeout: 60_000 });
	} catch {
		await expect(page.locator('.app-shell')).toBeVisible({ timeout: 30_000 });
		await expect(page).not.toHaveURL(/\/login$/, { timeout: 30_000 });
	}
}

/** Wait until the app shell reports Matrix init + first sync complete. */
export async function waitForMatrixReady(page, timeout = 90_000) {
	await page.waitForSelector('[data-matrix-ready]', { timeout });
}

/**
 * Register a new Matrix account via the UI.
 * Returns true on success (redirected to '/'), false if username already taken.
 * Uses a short timeout — register() now returns fast (same background-crypto
 * pattern as login()).
 */
export async function registerUser(page, { username, password }) {
	await gotoWithRetry(page, '/register');
	const textInputs = page.locator('input[type="text"]');
	await expect(textInputs).toHaveCount(2, { timeout: 15_000 });
	await textInputs.nth(0).fill(username);
	await textInputs.nth(1).fill(username);
	await page.fill('input[type="password"]', password);
	await page.click('button[type="submit"]');
	try {
		await page.waitForURL('/', { timeout: 30_000 });
		return true;
	} catch {
		const currentUrl = page.url();
		if (!/\/(login|register)$/.test(currentUrl)) {
			await expect(page.locator('.app-shell')).toBeVisible({ timeout: 15_000 });
			return true;
		}
		return false;
	}
}

/**
 * Log out via the Settings page logout button.
 * Waits for redirect to /login.
 */
export async function logoutUser(page) {
	// Navigate to settings via the nav link (client-side navigation preserves in-memory auth state)
	await page.click('a[href="/settings"]');
	await page.waitForSelector('button.danger', { timeout: 10_000 });
	await page.click('button.danger');
	await page.waitForURL('/login', { timeout: 10_000 });
}

/**
 * Leave all Matrix rooms (joined + invited) for the currently logged-in user.
 *
 * Uses the Matrix REST API directly so cleanup is fast and does not depend on
 * the SDK being initialised. Call this after loginAs() but before running
 * tests, to ensure a clean slate regardless of how many rooms prior runs left.
 */
export async function cleanupRooms(page) {
	const result = await page.evaluate(async (baseURL) => {
		const token = localStorage.getItem('matrix_access_token');
		const homeserver = localStorage.getItem('matrix_homeserver') || baseURL;
		if (!token) return { error: 'no token' };

		// Snapshot current rooms via a quick /sync with no timeout
		let data;
		try {
			const res = await fetch(
				`${homeserver}/_matrix/client/v3/sync?timeout=0`,
				{ headers: { Authorization: `Bearer ${token}` } }
			);
			data = await res.json();
		} catch (e) {
			return { error: e.message };
		}

		const joinIds   = Object.keys(data?.rooms?.join   || {});
		const inviteIds = Object.keys(data?.rooms?.invite || {});
		const roomIds = [...new Set([...joinIds, ...inviteIds])];

		// Leave all rooms, then forget them so future runs do not inherit stale DM state.
		await Promise.allSettled(
			roomIds.map(async (roomId) => {
				await fetch(`${homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/leave`, {
					method: 'POST',
					headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
					body: '{}',
				});
				await fetch(`${homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/forget`, {
					method: 'POST',
					headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
					body: '{}',
				});
			})
		);

		return { joined: joinIds.length, invited: inviteIds.length, forgotten: roomIds.length };
	}, _baseURL);
	return result;
}

/** Remove accepted contacts and reject pending requests via the app UI. */
export async function clearContactsState(page) {
	await gotoContacts(page);

	for (let i = 0; i < 10; i += 1) {
		const rejectButtons = page.locator('.btn-reject');
		const before = await rejectButtons.count();
		if (before === 0) break;
		const rejectButton = rejectButtons.first();
		await expect(rejectButton).toBeVisible({ timeout: 15_000 });
		await rejectButton.click();
		await expect(rejectButtons).toHaveCount(before - 1);
	}

	for (let i = 0; i < 10; i += 1) {
		const removeButtons = page.locator('[aria-label*="Remove"]');
		const before = await removeButtons.count();
		if (before === 0) break;
		const removeButton = removeButtons.first();
		await expect(removeButton).toBeVisible({ timeout: 15_000 });
		await removeButton.click();
		await expect(removeButtons).toHaveCount(before - 1);
	}
}

/** Fail fast if an accepted contact row is still visible for the given peer. */
export async function expectNoAcceptedContact(page, username) {
	const peerId = matrixId(username);
	const acceptedRow = page
		.locator('.list-item')
		.filter({ hasText: peerId })
		.filter({ has: page.locator('[aria-label*="Remove"]') })
		.first();
	await expect(
		acceptedRow,
		`stale accepted contact row is still visible for ${peerId}; reset preconditions before asserting a fresh invite`
	).toHaveCount(0);
}

/**
 * Bootstrap two clean Matrix sessions that are ready for multi-user tests.
 *
 * Returns { ctxAlice, ctxBob, alice, bob }.
 */
export async function bootstrapTwoUserSessions(browser, { livekit = false } = {}) {
	const ctxAlice = await newMatrixContext(browser);
	const ctxBob = await newMatrixContext(browser);

	const flagBootstrap = livekit ? enableLivekitFlags : enableMatrixFlags;
	await flagBootstrap(ctxAlice);
	await flagBootstrap(ctxBob);

	const alice = await ctxAlice.newPage();
	const bob = await ctxBob.newPage();

	const registered = await registerUser(bob, USERS.bob);
	if (!registered) {
		await loginAs(bob, USERS.bob);
	}
	await loginAs(alice, USERS.alice);

	const [bobCleanup, aliceCleanup] = await Promise.all([cleanupRooms(bob), cleanupRooms(alice)]);
	console.log('Cleanup — Bob:', bobCleanup, '| Alice:', aliceCleanup);

	await Promise.all([waitForMatrixReady(alice), waitForMatrixReady(bob)]);
	await Promise.all([clearContactsState(alice), clearContactsState(bob)]);

	return { ctxAlice, ctxBob, alice, bob };
}

/** Leave rooms for both users and close both browser contexts. */
export async function teardownTwoUserSessions({ alice, bob, ctxAlice, ctxBob }) {
	if (alice) await cleanupRooms(alice).catch(() => {});
	if (bob) await cleanupRooms(bob).catch(() => {});
	await closeContextSafely(ctxAlice);
	await closeContextSafely(ctxBob);
}

async function closeContextSafely(context) {
	if (!context) return;
	try {
		await context.close();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		// Playwright can occasionally lose retry trace artifact paths while closing a failed
		// retry context. That should not turn an otherwise-useful validation failure into a
		// teardown failure.
		if (message.includes('ENOENT') && message.includes('.trace')) {
			console.warn('Ignoring Playwright trace cleanup ENOENT during context.close():', message);
			return;
		}
		throw error;
	}
}

/** Navigate via SvelteKit client-side links to the contacts view. */
export async function gotoContacts(page) {
	await page.click('a[href="/contacts"]');
	await page.waitForSelector('.add-row input', { timeout: 15_000 });
}

/** Navigate via SvelteKit client-side links to the conversations view. */
export async function gotoChats(page) {
	await page.click('a[href="/"]');
	await expect(page.locator('.conversation-list, .page-center').first()).toBeVisible({ timeout: 20_000 });
}

/** Open the first visible conversation from the conversations view. */
export async function openFirstConversation(page) {
	const firstRoom = page.locator('.conversation-list [href]').first();
	await expect(firstRoom).toBeVisible({ timeout: 30_000 });
	await firstRoom.click();
	await page.waitForURL(/\/room\//, { timeout: 15_000 });
}

/** Ensure Alice and Bob have an accepted DM conversation visible in chats. */
export async function ensureAcceptedConversation(alicePage, bobPage, bobIdentifier = USERS.bob.username) {
	await gotoChats(alicePage);
	if (await alicePage.locator('.conversation-list [href]').count()) return;

	await gotoContacts(alicePage);
	await gotoContacts(bobPage);

	await sendContactInvite(alicePage, bobIdentifier);
	await expectNoErrorMessage(alicePage);
	await acceptFirstContactRequest(bobPage);
	await expectNoErrorMessage(bobPage);

	await gotoChats(alicePage);
	await expect(alicePage.locator('.conversation-list [href]').first()).toBeVisible({ timeout: 30_000 });
}

/** Send a contact invite from the contacts page. */
export async function sendContactInvite(page, identifier) {
	await page.fill('.add-row input', '');
	await page.fill('.add-row input', identifier);
	await page.click('.add-row button[aria-label]');
}

/** Accept the first pending contact request. */
export async function acceptFirstContactRequest(page) {
	const acceptButton = page.locator('.btn-accept').first();
	await expect(acceptButton).toBeVisible({ timeout: 60_000 });
	await acceptButton.click();
}

/** Reject the first pending contact request. */
export async function rejectFirstContactRequest(page) {
	const rejectButton = page.locator('.btn-reject').first();
	await expect(rejectButton).toBeVisible({ timeout: 60_000 });
	await rejectButton.click();
}

/** Assert the current view has no visible inline error message. */
export async function expectNoErrorMessage(page) {
	await expect(page.locator('.error-msg')).not.toBeVisible();
}

/**
 * Assert a stable screenshot for a deterministic UI surface.
 *
 * Screenshots should target focused containers rather than whole pages.
 */
export async function expectStableScreenshot(locator, name, options = {}) {
	await expect(locator).toHaveScreenshot(name, {
		animations: 'disabled',
		caret: 'hide',
		scale: 'css',
		...options,
	});
}

/**
 * Read WebRTC RTP byte counters from live peer connections on the page,
 * broken down by media kind so audio and video can be asserted independently.
 */
export async function getRTCStats(page) {
	return page.evaluate(async () => {
		const pcs = window.__rtcPCs || [];
		const result = { audioOutbound: 0, videoOutbound: 0, audioInbound: 0, videoInbound: 0 };
		for (const pc of pcs) {
			if (pc.signalingState === 'closed') continue;
			const stats = await pc.getStats();
			for (const entry of stats.values()) {
				if (entry.type === 'outbound-rtp') {
					if (entry.mediaType === 'audio') result.audioOutbound += entry.bytesSent || 0;
					if (entry.mediaType === 'video') result.videoOutbound += entry.bytesSent || 0;
				}
				if (entry.type === 'inbound-rtp') {
					if (entry.mediaType === 'audio') result.audioInbound += entry.bytesReceived || 0;
					if (entry.mediaType === 'video') result.videoInbound += entry.bytesReceived || 0;
				}
			}
		}
		return result;
	});
}

/**
 * Attach console error and page error listeners.
 * Returns the collected errors array (filled in place as tests run).
 */
export function collectConsoleErrors(page) {
	const errors = [];
	page.on('console', (msg) => {
		if (msg.type() === 'error') errors.push(`[console.error] ${msg.text()}`);
	});
	page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));
	return errors;
}
