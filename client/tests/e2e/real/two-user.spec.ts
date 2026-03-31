/**
 * Two-user real E2E tests.
 *
 * Uses two browser contexts (Alice and Bob) logged in simultaneously.
 * All navigation uses SvelteKit client-side link clicks to avoid full page
 * reloads — this keeps the Matrix client running in each browser context.
 *
 * Bob's account (e2ebot) is registered if it does not yet exist.
 *
 * Tests MUST run serially (each depends on the previous).
 */
import { test, expect } from '@playwright/test';
import {
	bootstrapTwoUserSessions,
	teardownTwoUserSessions,
	collectConsoleErrors,
	gotoContacts,
	gotoChats,
	openFirstConversation,
	ensureAcceptedConversation,
	sendContactInvite,
	acceptFirstContactRequest,
	rejectFirstContactRequest,
	expectNoErrorMessage,
	expectStableScreenshot,
	USERS,
} from './helpers';

// Ensure sequential execution — each test depends on the previous
test.describe.configure({ mode: 'serial' });

let ctxAlice, ctxBob;
let alice, bob;
const bobMatrixLogs = [];

test.describe('Two-user flows', () => {
	test.beforeAll(async ({ browser }) => {
		// Increase hook timeout: two logins + Rust crypto init (up to ~30s on fresh
		// IndexedDB) + Matrix sync.  Fresh browser contexts (used in E2E) always hit
		// the slow path; real users only pay this cost once (subsequent loads are ~2-5s).
		test.setTimeout(150_000);

		({ ctxAlice, ctxBob, alice, bob } = await bootstrapTwoUserSessions(browser));

		// Capture all Bob's matrix-related console logs for the entire test run
		bob.on('console', (msg) => {
			const text = msg.text();
			if (text.includes('[matrix]')) {
				bobMatrixLogs.push(`[${msg.type()}] ${text}`);
			}
		});
	});

	test.afterAll(async () => {
		await teardownTwoUserSessions({ alice, bob, ctxAlice, ctxBob });
	});

	// ── Contact setup ────────────────────────────────────────────────────────

	test('Alice and Bob open contacts — no pending invites yet', async () => {
		// Both navigate via SPA link (keeps Matrix client running, no reload).
		// Confirm contacts page is live and empty of invites before the test begins.
		await gotoContacts(alice);
		await gotoContacts(bob);

		// Neither side should have a pending invite at this point
		await expect(bob.locator('.btn-accept')).not.toBeVisible();
	});

	test('Alice adds Bob as a contact and Bob accepts the invite live without reload', async () => {
		test.setTimeout(90_000);

		// Bob is already on /contacts via SPA nav from the previous test — no reload.
		// Alice sends the invite now.
		await sendContactInvite(alice, USERS.bob.username);
		await expectNoErrorMessage(alice);

		// Bob must see the accept controls appear live via the RoomMember.membership
		// event subscription — no page reload, no navigation.
		await expect(bob.locator('.btn-accept').first()).toBeVisible({ timeout: 60_000 });
		await expectStableScreenshot(
			bob.locator('.request-item').first(),
			'two-user-contact-request-pending.png',
			{
				mask: [bob.locator('.request-item .text-muted').first()],
				// Mask-edge antialiasing around the hidden secondary line varies by a few pixels
				// across real deployed runs; keep the visual assertion strict but non-flaky.
				maxDiffPixels: 400,
			}
		);
		await acceptFirstContactRequest(bob);

		await bob.waitForTimeout(2_000);
		await expectNoErrorMessage(bob);
	});

	test('accepted contact shows online presence and stable contact-list visuals', async () => {
		await expect(alice.locator('.online-dot').first()).toBeVisible({ timeout: 60_000 });
		await expectStableScreenshot(
			alice.locator('.list').last(),
			'two-user-contacts-online.png'
		);
	});

	// ── Messaging ────────────────────────────────────────────────────────────

	test('Alice sends a message to Bob', async () => {
		// Navigate to chats list
		await gotoChats(alice);
		await alice.waitForTimeout(2_000);

		// Open the DM room with Bob
		await openFirstConversation(alice);

		// Send a uniquely identifiable message
		const msgText = `hello_${Date.now()}`;
		const input = alice.locator('input[type="text"], textarea').last();
		await input.fill(msgText);
		await input.press('Enter');

		// Message appears in Alice's view (strict mode: use .first() — message may appear in both sent/received bubbles)
		await expect(alice.locator(`text=${msgText}`).first()).toBeVisible({ timeout: 10_000 });
	});

	test('sent message appears exactly once — no echo duplication (regression for WP-2)', async () => {
		// Regression: before the txnId echo-reconciliation fix (WP-2) the local
		// optimistic echo was NOT replaced by the server-confirmed event.  Instead
		// ingestEvent() appended a second copy, so the sender saw the same message
		// twice.  The earlier "Alice sends a message" test masked this because it
		// used .first(), which succeeds even when two matching elements exist.
		//
		// This test makes the duplication observable:
		//   1. send a uniquely-tagged message
		//   2. wait long enough for the server confirmation to arrive and for
		//      ingestEvent() to have run its echo-reconciliation path
		//   3. assert that exactly ONE .bubble contains the text

		// Alice is still on the room page from the previous test.
		const msgText = `echo_dedup_${Date.now()}`;
		const input = alice.locator('input[type="text"], textarea').last();
		await input.fill(msgText);
		await input.press('Enter');

		// Give the local echo time to render AND the server confirmation time to
		// arrive through Matrix /sync (~2-3 s on the local Pi).  If echo
		// reconciliation is broken the confirmed event arrives here as a second
		// .bubble copy.
		await alice.waitForTimeout(5_000);

		// Exactly one bubble must contain the text — .first() / .last() would hide
		// duplicates, so we intentionally count.
		await expect(alice.locator(`.bubble:has-text("${msgText}")`)).toHaveCount(1);
	});

	test("Bob receives Alice's message", async () => {
		// Client-side nav keeps Matrix client alive (no full page reload)
		await gotoChats(bob);
		await openFirstConversation(bob);

		// At least one message bubble should be visible
		// 30s — Matrix sync may take longer than 15s on the Pi
		await expect(
			bob.locator('.bubble').last()
		).toBeVisible({ timeout: 30_000 });
	});

	test('Bob sees typing indicator when Alice types (Dendrite typing support)', async () => {
		// Both pages are still on the /room/ page from the previous test.
		// Alice types without submitting — Dendrite must propagate m.typing to Bob.
		const aliceInput = alice.locator('input[type="text"]').last();
		await aliceInput.click();
		await aliceInput.type('hel', { delay: 80 });

		// The typing indicator must appear in Bob's view within 15s
		await expect(bob.locator('.typing-indicator')).toBeVisible({ timeout: 15_000 });
	});

	test('typing indicator clears after Alice sends', async () => {
		const aliceInput = alice.locator('input[type="text"]').last();
		await aliceInput.press('Enter');

		// Bob's typing indicator stays mounted in the DOM, but it must become
		// inactive within 10s after the message is sent.
		await expect(bob.locator('.typing-indicator')).toHaveAttribute('aria-hidden', 'true', {
			timeout: 10_000,
		});
		await expect(bob.locator('.typing-indicator')).not.toHaveClass(/typing-visible/);
	});

	test('Alice sees typing indicator when Bob types and the room visuals stay stable', async () => {
		const bobInput = bob.locator('input[type="text"]').last();
		await bobInput.click();
		await bobInput.type('reply', { delay: 80 });

		await expect(alice.locator('.typing-indicator')).toBeVisible({ timeout: 15_000 });
		await expectStableScreenshot(alice.locator('.typing-indicator'), 'two-user-room-typing.png', {
			mask: [
				alice.locator('.typing-label'),
			],
		});

		await bobInput.press('Enter');
		await expect(alice.locator('.typing-indicator')).toHaveAttribute('aria-hidden', 'true', {
			timeout: 10_000,
		});
		await expect(alice.locator('.typing-indicator')).not.toHaveClass(/typing-visible/);
	});

	test("Alice's sent message shows single tick before Bob reads", async () => {
		// Alice sends a unique message from the current room page
		const aliceInput = alice.locator('input[type="text"]').last();
		const msgText = `tick_${Date.now()}`;
		await aliceInput.fill(msgText);
		await aliceInput.press('Enter');

		// The last sent bubble (mine) should immediately show a single tick (✓)
		const lastMineBubble = alice.locator('.bubble.mine').last();
		await expect(lastMineBubble).toBeVisible({ timeout: 5_000 });
		await expect(lastMineBubble.locator('.tick')).toContainText('✓');
	});

	test("Alice's sent message shows double tick after Bob opens the chat", async () => {
		// When this test runs in isolation it must create its own accepted DM precondition.
		await ensureAcceptedConversation(alice, bob);

		// Bob stays on the conversation list so the fresh message remains unread until he re-enters the room.
		await gotoChats(alice);
		await openFirstConversation(alice);
		await gotoChats(bob);
		const aliceConversation = bob.locator('.conversation-list [href]').first();
		await expect(aliceConversation).toBeVisible({ timeout: 30_000 });

		const aliceInput = alice.locator('input[type="text"]').last();
		const msgText = `read_ack_${Date.now()}`;
		await aliceInput.fill(msgText);
		await aliceInput.press('Enter');

		const readReceiptBubble = alice.locator(`.bubble.mine:has-text("${msgText}")`).last();
		await expect(alice.locator(`.bubble.mine:has-text("${msgText}")`)).toHaveCount(1);
		await expect(readReceiptBubble.locator('.tick')).toContainText('✓');

		// Bob opens the room after the message is already unread in the conversation list.
		await aliceConversation.click();
		await bob.waitForURL(/\/room\//, { timeout: 15_000 });
		const bobMessages = bob.locator('.messages');
		await expect(bobMessages).toBeVisible({ timeout: 15_000 });
		await bobMessages.evaluate((element) => {
			element.scrollTop = element.scrollHeight;
		});
		await expect(bob.locator(`.bubble:has-text("${msgText}")`).last()).toBeVisible({ timeout: 30_000 });

		// The freshly sent bubble should now show double tick (✓✓, .tick.read).
		await expect
			.poll(async () => readReceiptBubble.locator('.tick').textContent(), { timeout: 60_000 })
			.toContain('✓✓');
		await expect(readReceiptBubble.locator('.tick.read')).toBeVisible({ timeout: 5_000 });
	});

	test("Bob's message creates an unread badge for Alice that clears when she opens the room", async () => {
		await gotoContacts(alice);

		const bobInput = bob.locator('input[type="text"]').last();
		const msgText = `bob_unread_${Date.now()}`;
		await bobInput.fill(msgText);
		await bobInput.press('Enter');

		const lastMineBubble = bob.locator('.bubble.mine').last();
		await expect(lastMineBubble).toBeVisible({ timeout: 10_000 });
		await expect(lastMineBubble.locator('.tick')).toContainText('✓');

		await gotoChats(alice);
		const bobConversation = alice
			.locator('.conversation-list [href]')
			.filter({ hasText: USERS.bob.username })
			.first();
		await expect(bobConversation).toBeVisible({ timeout: 30_000 });
		await expect(bobConversation.locator('[aria-label*="unread"]')).toBeVisible({ timeout: 30_000 });
		await expectStableScreenshot(
			alice.locator('.conversation-list'),
			'two-user-conversations-unread.png',
			{ maxDiffPixels: 250 }
		);

		await bobConversation.click();
		await alice.waitForURL(/\/room\//, { timeout: 10_000 });
		await bob.waitForTimeout(3_000);
		await expect(lastMineBubble.locator('.tick.read')).toBeVisible({ timeout: 15_000 });

		await gotoChats(alice);
		await expect(bobConversation.locator('[aria-label*="unread"]')).not.toBeVisible({ timeout: 15_000 });
	});

	// ── Call flow ────────────────────────────────────────────────────────────

	test('Alice initiates an audio call to Bob', async () => {
		const aliceErrors = collectConsoleErrors(alice);

		// Navigate to contacts
		await gotoContacts(alice);

		// Find and click the audio call button next to Bob's contact
		const callBtn = alice.locator('a[aria-label*="Audio call"]').first();
		await expect(callBtn).toBeVisible({ timeout: 15_000 });
		await callBtn.click();

		// Alice should land on the dial page
		await alice.waitForURL(/\/call\/dial\//, { timeout: 15_000 });
		await expect(alice.locator('.call-page')).toBeVisible({ timeout: 10_000 });

		// Invite sent — ringing_out state shows .pulse
		// If .pulse never appears, log dial errors before failing
		await alice.locator('.pulse').waitFor({ timeout: 15_000 }).catch(() => {
			const dialErrors = aliceErrors.filter(e => e.includes('[livekit-dial]') || e.includes('[livekit-answer]'));
			if (dialErrors.length) console.error('[test] Alice dial errors:', dialErrors);
			else console.error('[test] Alice dial: no livekit errors captured; full error list:', aliceErrors);
		});
		await expect(alice.locator('.pulse')).toBeVisible({ timeout: 1_000 });

		// No critical JS errors during call setup (transient network/sync noise excluded)
		const critical = aliceErrors.filter(
			(e) =>
				!e.includes('service worker') &&
				!e.includes('push') &&
				!e.includes('404') &&
				!e.includes('/api/') &&
				!e.includes('fetch failed') &&
				!e.includes('Failed to fetch') &&
				!e.includes('ConnectionError') &&
				!e.includes('/sync error')
		);
		expect(critical).toHaveLength(0);
	});

	test('Bob receives and answers the incoming call', async () => {
		// Capture Bob's console for diagnostic logging
		const bobLogs = [];
		const bobConsoleListener = (msg) => {
			if (msg.type() === 'warning' || msg.type() === 'error') {
				bobLogs.push(`[${msg.type()}] ${msg.text()}`);
			}
		};
		bob.on('console', bobConsoleListener);

		// Bob's layout receives the call_invite signal and navigates automatically
		const urlCheckPromise = expect(bob).toHaveURL(/\/call\/incoming\//, { timeout: 45_000 });
		await urlCheckPromise.catch(async (err) => {
			bob.off('console', bobConsoleListener);
			console.error('[test] Bob all matrix logs so far:', bobMatrixLogs);
			const localLogs = bobLogs.filter(l => l.includes('[matrix]') || l.includes('[livekit]'));
			console.error('[test] Bob logs during call wait:', localLogs.length ? localLogs : bobLogs.slice(-20));
			throw err;
		});
		bob.off('console', bobConsoleListener);

		// Incoming call screen is shown
		await expect(bob.locator('.incoming-screen')).toBeVisible({ timeout: 10_000 });
		await expect(bob.locator('.caller-name')).toBeVisible();
		await expectStableScreenshot(
			bob.locator('.incoming-screen'),
			'two-user-incoming-audio-call.png'
		);

		// Bob answers
		await bob.locator('.btn-answer').click();

		// Incoming screen disappears once answered
		await expect(bob.locator('.incoming-screen')).not.toBeVisible({ timeout: 15_000 });
	});

	test('Alice hangs up the connected call', async () => {
		// Alice's call phase should progress to connected after Bob answers
		const hangupBtn = alice.locator(
			'button[aria-label*="ang"], button[aria-label*="End"], button[aria-label*="end"]'
		);
		await expect(hangupBtn.first()).toBeVisible({ timeout: 30_000 });
		await hangupBtn.first().click();

		// Alice leaves the call page — verify she's no longer on any /call/ route
		await alice.waitForURL((url) => !url.pathname.startsWith('/call/'), { timeout: 15_000 });
	});

	test('Alice can remove Bob from contacts after the call', async () => {
		await gotoContacts(alice);
		const bobRow = alice.locator('.list-item').filter({ has: alice.locator('[aria-label*="Remove"]') }).first();
		await expect(bobRow).toBeVisible({ timeout: 15_000 });
		await bobRow.locator('[aria-label*="Remove"]').click();

		await expect
			.poll(async () => alice.locator('[aria-label*="Remove"]').count(), { timeout: 20_000 })
			.toBe(0);
	});
});

test.describe('Two-user contact rejection flow', () => {
	let ctxAliceReject, ctxBobReject;
	let aliceReject, bobReject;

	test.beforeAll(async ({ browser }) => {
		test.setTimeout(150_000);
		({ ctxAlice: ctxAliceReject, ctxBob: ctxBobReject, alice: aliceReject, bob: bobReject } =
			await bootstrapTwoUserSessions(browser));
	});

	test.afterAll(async () => {
		await teardownTwoUserSessions({
			alice: aliceReject,
			bob: bobReject,
			ctxAlice: ctxAliceReject,
			ctxBob: ctxBobReject,
		});
	});

	test('Alice adds Bob and Bob can reject the invite live without reload', async () => {
		test.setTimeout(90_000);

		await gotoContacts(aliceReject);
		await gotoContacts(bobReject);

		await sendContactInvite(aliceReject, USERS.bob.username);
		await expectNoErrorMessage(aliceReject);

		await expect(bobReject.locator('.btn-accept').first()).toBeVisible({ timeout: 60_000 });
		await expectStableScreenshot(
			bobReject.locator('.request-item').first(),
			'two-user-contact-request-pending.png',
			{
				mask: [bobReject.locator('.request-item .text-muted').first()],
				maxDiffPixels: 400,
			}
		);
		await rejectFirstContactRequest(bobReject);

		await expect(bobReject.locator('.btn-accept')).not.toBeVisible({ timeout: 15_000 });
		await expect
			.poll(async () => aliceReject.locator('.pending-label').count(), { timeout: 20_000 })
			.toBe(0);
	});
});
