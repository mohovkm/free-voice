import { test, expect } from '@playwright/test';

const fakeToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1MUB0ZXN0LmNvbSIsImV4cCI6OTk5OTk5OTk5OX0.sig';
const sipCreds = { sip_username: 'u_test01', sip_password: 'pass123', room_name: 'room_test', turn: { uris: [], username: '', password: '' } };

/**
 * Minimal SIP server over WebSocket.
 * Responds to REGISTER with 200 OK and INVITE with 100 + 180.
 * Uses Playwright WebSocketRoute API: ws.onMessage(handler), ws.send(text).
 */
function mockSipWs(ws) {
	ws.onMessage((text) => {
		if (typeof text !== 'string') return;
		const firstLine = text.split('\r\n')[0];
		if (firstLine.startsWith('SIP/2.0')) return; // ignore responses

		const method = firstLine.split(' ')[0];
		const via = text.match(/^Via:.*$/m)?.[0] ?? '';
		const from = text.match(/^From:.*$/m)?.[0] ?? '';
		const to = text.match(/^To:.*$/m)?.[0] ?? '';
		const callId = text.match(/^Call-ID:.*$/m)?.[0] ?? '';
		const cseq = text.match(/^CSeq:.*$/m)?.[0] ?? '';
		const headers = [via, from, to, callId, cseq, 'Content-Length: 0'].join('\r\n');

		if (method === 'REGISTER') {
			ws.send(`SIP/2.0 200 OK\r\n${headers}\r\n\r\n`);
		} else if (method === 'INVITE') {
			ws.send(`SIP/2.0 100 Trying\r\n${headers}\r\n\r\n`);
			ws.send(`SIP/2.0 180 Ringing\r\n${headers}\r\n\r\n`);
		} else if (method === 'BYE' || method === 'CANCEL') {
			ws.send(`SIP/2.0 200 OK\r\n${headers}\r\n\r\n`);
		}
	});
}

/** Set up auth state + mock API routes that return SIP creds */
async function setupAuthAndRoutes(page, routePattern, response) {
	await page.routeWebSocket(/\/api\/ws\/chat/, (ws) => ws.onMessage(() => {}));
	await page.routeWebSocket(/\/ws/, mockSipWs);

	await page.route(/\/api\//, (route) => {
		const url = route.request().url();
		if (url.includes('/auth/login')) {
			return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: fakeToken, refresh_token: 'r_tok' }) });
		}
		if (url.includes('/turn-credentials')) {
			return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ uris: [], username: '', password: '' }) });
		}
		if (url.match(routePattern)) {
			return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
		}
		return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
	});
	await page.evaluate((t) => localStorage.setItem('token', t), fakeToken);
	await page.evaluate(() => localStorage.setItem('refresh_token', 'r_tok'));
}

test.describe('Call UI — P2P dial', () => {
	test('shows call view with controls when dialing', async ({ page }) => {
		await page.goto('/');
		await setupAuthAndRoutes(page, /calls\/dial/, sipCreds);
		await page.goto('/call/dial/user@test.com');

		// Call view should render with overlay (connecting/calling) and controls
		await expect(page.locator('.call-view')).toBeVisible();
		await expect(page.locator('.call-overlay')).toBeVisible();
		await expect(page.locator('.call-controls')).toBeVisible();

		// All three control buttons present
		await expect(page.locator('button[aria-label="Mute microphone"]')).toBeVisible();
		await expect(page.locator('button[aria-label="Turn off camera"]')).toBeVisible();
		await expect(page.locator('button[aria-label="End call"]')).toBeVisible();

		// Media elements exist
		await expect(page.locator('video.remote-video')).toBeAttached();
		await expect(page.locator('video.local-video')).toBeAttached();
		await expect(page.locator('audio')).toBeAttached();
	});

	test('mic toggle changes button state', async ({ page }) => {
		await page.goto('/');
		await setupAuthAndRoutes(page, /calls\/dial/, sipCreds);
		await page.goto('/call/dial/user@test.com');
		await expect(page.locator('.call-controls')).toBeVisible();

		const micBtn = page.locator('.ctrl-btn').first();
		await expect(micBtn).not.toHaveClass(/active/);
		await micBtn.click();
		await expect(micBtn).toHaveClass(/active/);
		await expect(page.locator('button[aria-label="Unmute microphone"]')).toBeVisible();
	});

	test('cam toggle changes button state', async ({ page }) => {
		await page.goto('/');
		await setupAuthAndRoutes(page, /calls\/dial/, sipCreds);
		await page.goto('/call/dial/user@test.com');
		await expect(page.locator('.call-controls')).toBeVisible();

		const camBtn = page.locator('.ctrl-btn').nth(1);
		await expect(camBtn).not.toHaveClass(/active/);
		await camBtn.click();
		await expect(camBtn).toHaveClass(/active/);
		await expect(page.locator('button[aria-label="Turn on camera"]')).toBeVisible();
	});

	test('hangup navigates to home', async ({ page }) => {
		await page.goto('/');
		await setupAuthAndRoutes(page, /calls\/dial/, sipCreds);
		await page.goto('/call/dial/user@test.com');
		await expect(page.locator('.call-controls')).toBeVisible();

		await page.locator('button[aria-label="End call"]').click();
		await expect(page).toHaveURL('/');
	});

	test('shows error on API failure', async ({ page }) => {
		await page.goto('/');
		await page.routeWebSocket(/\/api\/ws\/chat/, (ws) => ws.onMessage(() => {}));
		await page.routeWebSocket(/\/ws/, mockSipWs);
		await page.route(/\/api\//, (route) => {
			if (route.request().url().includes('/calls/dial')) {
				return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'User not found' }) });
			}
			return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
		});
		await page.evaluate((t) => localStorage.setItem('token', t), fakeToken);
		await page.goto('/call/dial/nobody@test.com');

		await expect(page.locator('.call-error')).toBeVisible();
	});
});

test.describe('Call UI — Room call', () => {
	test('shows call view when joining room', async ({ page }) => {
		await page.goto('/');
		await setupAuthAndRoutes(page, /rooms\/.*\/join/, sipCreds);
		await page.goto('/call/room/room123');

		await expect(page.locator('.call-view')).toBeVisible();
		await expect(page.locator('.call-controls')).toBeVisible();
		await expect(page.locator('button[aria-label="End call"]')).toBeVisible();
	});
});

test.describe('Call UI — Guest join', () => {
	test('guest form submits and shows call view', async ({ page }) => {
		await page.routeWebSocket(/\/api\/ws\/chat/, (ws) => ws.onMessage(() => {}));
		await page.routeWebSocket(/\/ws/, mockSipWs);
		await page.route(/\/api\//, (route) => {
			if (route.request().url().includes('/links/abc123/join')) {
				return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sipCreds) });
			}
			if (route.request().url().includes('/turn-credentials')) {
				return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ uris: [], username: '', password: '' }) });
			}
			return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
		});
		await page.goto('/call/abc123');

		// Guest form visible
		await expect(page.locator('input[placeholder="Your name"]')).toBeVisible();
		await page.fill('input[placeholder="Your name"]', 'Test Guest');
		await page.click('button:has-text("Join Call")');

		// Call view should appear
		await expect(page.locator('.call-view')).toBeVisible({ timeout: 5000 });
		await expect(page.locator('.call-controls')).toBeVisible();
	});

	test('guest hangup returns to name form', async ({ page }) => {
		await page.routeWebSocket(/\/api\/ws\/chat/, (ws) => ws.onMessage(() => {}));
		await page.routeWebSocket(/\/ws/, mockSipWs);
		await page.route(/\/api\//, (route) => {
			if (route.request().url().includes('/links/abc123/join')) {
				return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sipCreds) });
			}
			if (route.request().url().includes('/turn-credentials')) {
				return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ uris: [], username: '', password: '' }) });
			}
			return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
		});
		await page.goto('/call/abc123');
		await page.fill('input[placeholder="Your name"]', 'Test Guest');
		await page.click('button:has-text("Join Call")');
		await expect(page.locator('.call-view')).toBeVisible({ timeout: 5000 });

		await page.locator('button[aria-label="End call"]').click();
		await expect(page.locator('input[placeholder="Your name"]')).toBeVisible();
	});
});
