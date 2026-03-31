/**
 * LiveKit group-call E2E tests (real server).
 *
 * Requires a deployed server with LiveKit enabled and the `ff_livekit`
 * feature flag set to '1' in localStorage for every context.
 *
 * Tests run serially — each depends on shared room state established by the
 * previous test.
 */
import { test, expect } from '@playwright/test';
import {
	bootstrapTwoUserSessions,
	teardownTwoUserSessions,
	gotoContacts,
	gotoChats,
	openFirstConversation,
	sendContactInvite,
	acceptFirstContactRequest,
	expectNoErrorMessage,
	expectStableScreenshot,
	getRTCStats,
	matrixId,
	USERS,
} from './helpers';

test.describe.configure({ mode: 'serial' });

let ctxAlice, ctxBob;
let alice, bob;
let roomId = '';

async function openDmRoom(page) {
	await gotoChats(page);
	await openFirstConversation(page);
	const currentUrl = new URL(page.url());
	roomId = decodeURIComponent(currentUrl.pathname.split('/').pop() || roomId);
}

async function startVideoCall(page) {
	await openDmRoom(page);
	const callBtn = page.locator('button[aria-label="Video call"]');
	await expect(callBtn).toBeVisible({ timeout: 10_000 });
	await callBtn.click();
}

async function leaveCallSurface(page) {
	await page.click('a[href="/"]');
	await expect(page.locator('.conversation-list, .page-center').first()).toBeVisible({ timeout: 20_000 });
}

async function simulateForegroundReturn(page) {
	await page.evaluate(() => {
		const setVisibility = (value) => {
			Object.defineProperty(document, 'visibilityState', {
				configurable: true,
				value,
			});
			document.dispatchEvent(new Event('visibilitychange'));
		};

		setVisibility('hidden');
		setVisibility('visible');
		window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
	});
}

test.describe('LiveKit group calls', () => {
	test.beforeAll(async ({ browser }) => {
		test.setTimeout(120_000);

		({ ctxAlice, ctxBob, alice, bob } = await bootstrapTwoUserSessions(browser, { livekit: true }));
	});

	test.afterAll(async () => {
		await teardownTwoUserSessions({ alice, bob, ctxAlice, ctxBob });
	});

	// ── Contact / room setup ─────────────────────────────────────────────────

	test('Alice adds Bob as a contact (create shared DM room)', async () => {
		await gotoContacts(alice);
		await sendContactInvite(alice, matrixId(USERS.bob.username));
		await alice.waitForTimeout(4_000);
		await expectNoErrorMessage(alice);
	});

	test('Bob accepts Alice contact invite', async () => {
		test.setTimeout(90_000);

		await gotoContacts(bob);
		await acceptFirstContactRequest(bob);

		await bob.waitForTimeout(2_000);
		await expectNoErrorMessage(bob);
	});

	// ── Direct call lifecycle ────────────────────────────────────────────────

	test('Alice starts a DM video call and Bob sees the incoming call UI', async () => {
		test.setTimeout(60_000);

		await startVideoCall(alice);
		await alice.waitForURL(/\/call\/dial\//, { timeout: 15_000 });
		await expect(alice.locator('.call-overlay')).toContainText('Calling', { timeout: 15_000 });
		await expect(alice.locator('button[aria-label="Mute microphone"]')).toBeDisabled();
		await expectStableScreenshot(alice.locator('.call-page'), 'livekit-dm-dialing.png', {
			mask: [alice.locator('video')],
		});

		await bob.waitForURL(/\/call\/incoming\//, { timeout: 30_000 });
		await expect(bob.locator('.incoming-screen')).toBeVisible({ timeout: 15_000 });
		await expect(bob.locator('button[aria-label="Answer call"]')).toBeVisible();
		await expect(bob.locator('button[aria-label="Decline call"]')).toBeVisible();
		await expectStableScreenshot(bob.locator('.incoming-screen'), 'livekit-dm-incoming.png');
	});

	test('Bob can decline the incoming call and Alice sees the declined outcome', async () => {
		test.setTimeout(60_000);

		await bob.locator('button[aria-label="Decline call"]').click();
		await expect(bob.locator('.call-overlay')).toContainText('Call declined', { timeout: 30_000 });
		await expect(alice.locator('.call-overlay')).toContainText(/Call declined|No answer/, { timeout: 35_000 });

		await Promise.all([leaveCallSurface(alice), leaveCallSurface(bob)]);
	});

	test('Bob answers the DM call, both sides connect, recover from foreground return, and Alice can hang up', async ({ browser }) => {
		test.setTimeout(120_000);

		await teardownTwoUserSessions({ alice, bob, ctxAlice, ctxBob });
		({ ctxAlice, ctxBob, alice, bob } = await bootstrapTwoUserSessions(browser, { livekit: true }));

		await gotoContacts(alice);
		await sendContactInvite(alice, matrixId(USERS.bob.username));
		await expectNoErrorMessage(alice);

		await gotoContacts(bob);
		await acceptFirstContactRequest(bob);
		await expectNoErrorMessage(bob);

		await startVideoCall(alice);
		await bob.waitForURL(/\/call\/incoming\//, { timeout: 30_000 });
		await bob.locator('button[aria-label="Answer call"]').click();

		await expect(alice.locator('button[aria-label="Mute microphone"]')).toBeEnabled({ timeout: 30_000 });
		await expect(bob.locator('button[aria-label="Mute microphone"]')).toBeEnabled({ timeout: 30_000 });
		await expectStableScreenshot(alice.locator('.call-page'), 'livekit-dm-connected.png', {
			mask: [alice.locator('video')],
		});

		await Promise.all([alice.waitForTimeout(2_000), bob.waitForTimeout(2_000)]);
		const [aliceStats, bobStats] = await Promise.all([getRTCStats(alice), getRTCStats(bob)]);
		expect(aliceStats.audioOutbound, 'Alice → SFU: audio').toBeGreaterThan(0);
		expect(aliceStats.videoOutbound, 'Alice → SFU: video').toBeGreaterThan(0);
		expect(aliceStats.audioInbound, 'SFU → Alice: audio from Bob').toBeGreaterThan(0);
		expect(aliceStats.videoInbound, 'SFU → Alice: video from Bob').toBeGreaterThan(0);
		expect(bobStats.audioOutbound, 'Bob → SFU: audio').toBeGreaterThan(0);
		expect(bobStats.videoOutbound, 'Bob → SFU: video').toBeGreaterThan(0);
		expect(bobStats.audioInbound, 'SFU → Bob: audio from Alice').toBeGreaterThan(0);
		expect(bobStats.videoInbound, 'SFU → Bob: video from Alice').toBeGreaterThan(0);

		await simulateForegroundReturn(alice);
		await expect(alice.locator('button[aria-label="Mute microphone"]')).toBeEnabled({ timeout: 20_000 });
		await alice.waitForTimeout(2_000);
		const alicePostForeground = await getRTCStats(alice);
		expect(alicePostForeground.audioOutbound, 'Alice audio survives foreground return').toBeGreaterThan(0);
		expect(alicePostForeground.videoOutbound, 'Alice video survives foreground return').toBeGreaterThan(0);

		const hangupBtn = alice.locator('button[aria-label="End call"]');
		await expect(hangupBtn).toBeVisible({ timeout: 10_000 });
		await hangupBtn.click();

		await expect(alice.locator('.call-overlay')).toContainText('Call ended', { timeout: 30_000 });
		await expect(bob.locator('.call-overlay')).toContainText('Call ended', { timeout: 30_000 });

		await Promise.all([leaveCallSurface(alice), leaveCallSurface(bob)]);
	});

	test('Alice can cancel a ringing call before Bob answers', async ({ browser }) => {
		test.setTimeout(120_000);

		await teardownTwoUserSessions({ alice, bob, ctxAlice, ctxBob });
		({ ctxAlice, ctxBob, alice, bob } = await bootstrapTwoUserSessions(browser, { livekit: true }));

		await gotoContacts(alice);
		await sendContactInvite(alice, matrixId(USERS.bob.username));
		await expectNoErrorMessage(alice);

		await gotoContacts(bob);
		await acceptFirstContactRequest(bob);
		await expectNoErrorMessage(bob);

		await startVideoCall(alice);
		await bob.waitForURL(/\/call\/incoming\//, { timeout: 30_000 });

		await alice.locator('button[aria-label="End call"]').click();
		await expect(alice.locator('.call-overlay')).toContainText('Call cancelled', { timeout: 30_000 });
		await bob.goto('/');
		await expect(bob.locator('.conversation-list, .page-center').first()).toBeVisible({ timeout: 20_000 });

		await Promise.all([leaveCallSurface(alice), leaveCallSurface(bob)]);
	});
});
