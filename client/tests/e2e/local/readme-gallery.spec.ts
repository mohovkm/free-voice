import { test, expect } from '@playwright/test';
import { mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { installAppShell, installRoomScenario } from './helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../../..');
const screenshotDir = resolve(repoRoot, 'docs/screenshots');
const ROOM_ID = '!room-gallery:example.test';

function ensureScreenshotDir() {
	mkdirSync(screenshotDir, { recursive: true });
}

async function saveShot(page, name, locator = null) {
	ensureScreenshotDir();
	const target = resolve(screenshotDir, name);
	if (locator) {
		const capture = locator.first();
		await expect(capture).toBeVisible();
		await capture.screenshot({ path: target });
		return;
	}
	await page.screenshot({ path: target, fullPage: true });
}

function seededMediaMessages() {
	return [
		{
			id: 'text-1',
			body: 'Free Voice is moving toward a cleaner messenger UI.',
			type: 'text',
			mine: false,
			senderId: '@alice:example.test',
			senderName: 'Alice'
		},
		{
			id: 'audio-1',
			body: 'voice-note.m4a',
			type: 'audio',
			mine: false,
			senderId: '@alice:example.test',
			senderName: 'Alice',
			media: {
				mxcUrl: 'blob:remote-audio',
				mimeType: 'audio/mp4',
				size: 1204,
				filename: 'voice-note.m4a',
				thumbnailUrl: null,
				durationSecs: 18,
				waveformData: [128, 256, 512, 256, 128]
			}
		},
		{
			id: 'video-1',
			body: 'walkthrough.mp4',
			type: 'video',
			mine: true,
			senderId: '@tester:example.test',
			senderName: 'Tester',
			media: {
				mxcUrl: 'blob:local-video',
				mimeType: 'video/mp4',
				size: 4096,
				filename: 'walkthrough.mp4',
				thumbnailUrl: 'blob:video-thumb',
				durationSecs: null,
				waveformData: null
			}
		}
	];
}

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({}, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'README gallery captures desktop screenshots only');
});

test('capture chats list for README', async ({ page }) => {
	await installAppShell(page, {
		conversations: [
			{
				roomId: '!dm-alice:example.test',
				name: 'Alice',
				lastActiveTs: Date.now(),
				lastMessage: { text: 'See you in the room call', msgtype: 'm.text' }
			},
			{
				roomId: '!room-team:example.test',
				name: 'Field Team',
				lastActiveTs: Date.now() - 1000 * 60 * 4,
				lastMessage: { text: 'walkthrough.mp4', msgtype: 'm.video' }
			}
		],
		unreadCounts: {
			'!dm-alice:example.test': 2,
			'!room-team:example.test': 5
		},
		dmContacts: [
			{
				roomId: '!dm-alice:example.test',
				email: '@alice:example.test',
				display_name: 'Alice',
				status: 'accepted'
			}
		]
	});

	await page.goto('/');
	await expect(page.locator('[data-matrix-ready]')).toBeVisible();
	await saveShot(page, 'chats.png', page.locator('.conversation-list'));
});

test('capture contacts screen for README', async ({ page }) => {
	await installAppShell(page, {
		dmContacts: [
			{
				roomId: '!dm-alice:example.test',
				email: '@alice:example.test',
				display_name: 'Alice',
				status: 'accepted'
			},
			{
				roomId: '!dm-bob:example.test',
				email: '@bob:example.test',
				display_name: 'Bob',
				status: 'accepted'
			}
		],
		contactRequests: [
			{
				id: '@charlie:example.test',
				email: '@charlie:example.test',
				display_name: 'Charlie'
			}
		]
	});

	await page.goto('/');
	await expect(page.locator('[data-matrix-ready]')).toBeVisible();
	await page.locator('a[href="/contacts"]').first().click();
	await expect(page).toHaveURL(/\/contacts$/);
	await expect(page.locator('h1')).toContainText('Contacts');
	await saveShot(page, 'contacts.png', page.locator('main.app-main'));
});

test('capture settings screen for README', async ({ page }) => {
	await installAppShell(page, {
		withSubscription: true,
		pushPermission: 'granted',
		profile: {
			id: '@tester:example.test',
			email: '@tester:example.test',
			display_name: 'Konstantin'
		}
	});

	await page.route('**/api/push/config', async (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				vapid_public_key: 'AQAB',
				sygnal_url: 'https://sygnal.example.test/_matrix/push/v1/notify',
				app_id: 'freevoice.test'
			})
		})
	);
	await page.route('**/api/push/subscribe', async (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
	);

	await page.goto('/');
	await expect(page.locator('[data-matrix-ready]')).toBeVisible();
	await page.locator('a[href="/settings"]').first().click();
	await expect(page).toHaveURL(/\/settings$/);
	await expect(page.locator('h1')).toContainText('Settings');
	await saveShot(page, 'settings.png', page.locator('.settings-list'));
});

test('capture p2p chat screen for README', async ({ page }) => {
	await installRoomScenario(page, {
		roomId: ROOM_ID,
		roomName: 'Alice',
		roomMessages: [
			{
				id: 'msg-1',
				body: 'Can you review the latest deploy logs?',
				type: 'text',
				mine: false,
				senderId: '@alice:example.test',
				senderName: 'Alice'
			},
			{
				id: 'msg-2',
				body: 'Already on it. I will push a fix tonight.',
				type: 'text',
				mine: true,
				senderId: '@tester:example.test',
				senderName: 'Tester'
			}
		]
	});

	await page.goto('/');
	await expect(page.locator('[data-matrix-ready]')).toBeVisible();
	await page.locator(`a[href="/room/${encodeURIComponent(ROOM_ID)}"]`).first().click();
	await expect(page).toHaveURL(new RegExp(`/room/${encodeURIComponent(ROOM_ID)}$`));
	await saveShot(page, 'p2p-chat.png', page.locator('main.app-main'));
});

test('capture media messages screen for README', async ({ page }) => {
	await installRoomScenario(page, {
		roomId: ROOM_ID,
		roomName: 'Alice',
		roomMessages: seededMediaMessages()
	});

	await page.route('https://matrix.example.test/**', async (route) => {
		return route.fulfill({
			status: 200,
			contentType: route.request().url().includes('video') ? 'video/mp4' : 'audio/mp4',
			body: Buffer.alloc(128, 7)
		});
	});

	await page.goto('/');
	await expect(page.locator('[data-matrix-ready]')).toBeVisible();
	await page.locator(`a[href="/room/${encodeURIComponent(ROOM_ID)}"]`).first().click();
	await expect(page.locator('.audio-player')).toBeVisible();
	await expect(page.locator('button[aria-label="Open video"]')).toBeVisible();
	await saveShot(page, 'media-messages.png', page.locator('main.app-main'));
});

test('capture call view for README', async ({ page }) => {
	await page.evaluate((t) => localStorage.setItem('token', t), 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1MUB0ZXN0LmNvbSIsImV4cCI6OTk5OTk5OTk5OX0.sig');
	await page.evaluate(() => localStorage.setItem('refresh_token', 'r_tok'));
	await page.routeWebSocket(/\/api\/ws\/chat/, (ws) => ws.onMessage(() => {}));
	await page.routeWebSocket(/\/ws/, (ws) => {
		ws.onMessage((text) => {
			if (typeof text !== 'string') return;
		});
	});
	await page.goto('/');
	await page.goto('/call/incoming/room_p2p?caller=alice%40test.com&name=Alice');
	await expect(page.locator('.incoming-screen')).toBeVisible();
	await expect(page.locator('button[aria-label="Answer call"]')).toBeVisible();
	await expect(page.locator('button[aria-label="Decline call"]')).toBeVisible();
	await saveShot(page, 'call-view.png', page.locator('.incoming-screen'));
});
