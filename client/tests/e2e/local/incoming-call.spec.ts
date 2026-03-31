import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';

const readmeCallScreenshot = fileURLToPath(new URL('../../../docs/screenshots/call-view.png', import.meta.url));

const fakeToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1MUB0ZXN0LmNvbSIsImV4cCI6OTk5OTk5OTk5OX0.sig';
const sipCreds = { sip_username: 'u_test01', sip_password: 'pass123', room_name: 'room_test', turn: { uris: [], username: '', password: '' } };

function mockSipWs(ws) {
	ws.onMessage((text) => {
		if (typeof text !== 'string') return;
		const firstLine = text.split('\r\n')[0];
		if (firstLine.startsWith('SIP/2.0')) return;
		const method = firstLine.split(' ')[0];
		const via = text.match(/^Via:.*$/m)?.[0] ?? '';
		const from = text.match(/^From:.*$/m)?.[0] ?? '';
		const to = text.match(/^To:.*$/m)?.[0] ?? '';
		const callId = text.match(/^Call-ID:.*$/m)?.[0] ?? '';
		const cseq = text.match(/^CSeq:.*$/m)?.[0] ?? '';
		const headers = [via, from, to, callId, cseq, 'Content-Length: 0'].join('\r\n');
		if (method === 'REGISTER') ws.send(`SIP/2.0 200 OK\r\n${headers}\r\n\r\n`);
		else if (method === 'INVITE') {
			ws.send(`SIP/2.0 100 Trying\r\n${headers}\r\n\r\n`);
			ws.send(`SIP/2.0 180 Ringing\r\n${headers}\r\n\r\n`);
		} else if (method === 'BYE' || method === 'CANCEL') {
			ws.send(`SIP/2.0 200 OK\r\n${headers}\r\n\r\n`);
		}
	});
}

async function setupWsAndAuth(page) {
	await page.routeWebSocket(/\/api\/ws\/chat/, (ws) => ws.onMessage(() => {}));
	await page.routeWebSocket(/\/ws/, mockSipWs);
	await page.addInitScript(() => {
		localStorage.setItem('token', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1MUB0ZXN0LmNvbSIsImV4cCI6OTk5OTk5OTk5OX0.sig');
		localStorage.setItem('refresh_token', 'r_tok');
		localStorage.setItem('matrix_access_token', 'matrix-token');
		localStorage.setItem('matrix_user_id', '@tester:example.test');
		localStorage.setItem('matrix_device_id', 'device-1');
		localStorage.setItem('matrix_homeserver', 'https://matrix.example.test');
		window.__FV_PLAYWRIGHT_BACKEND__ = {
			enabled: true,
			profile: {
				id: '@tester:example.test',
				email: '@tester:example.test',
				display_name: 'Tester'
			}
		};
	});
	await page.reload();
}

async function openIncomingRoute(page, url: string) {
	await page.evaluate((targetUrl) => {
		window.location.href = targetUrl;
	}, url);
}

test.describe('Incoming call — direct navigation', () => {
	test('shows caller name and answer/decline buttons', async ({ page }) => {
		await page.goto('/');
		await setupWsAndAuth(page);
		await openIncomingRoute(page, '/call/incoming/room_p2p?caller=alice%40test.com&name=Alice');

		await expect(page.locator('.caller-name')).toHaveText('Alice');
		await expect(page.locator('button[aria-label="Answer call"]')).toBeVisible();
		await expect(page.locator('button[aria-label="Decline call"]')).toBeVisible();
		if (process.env.README_CALL_SCREENSHOT === '1') {
			await page.locator('.incoming-screen').screenshot({ path: readmeCallScreenshot });
		}
	});

	test('decline navigates to home', async ({ page }) => {
		await page.goto('/');
		await setupWsAndAuth(page);
		await openIncomingRoute(page, '/call/incoming/room_p2p?caller=alice%40test.com&name=Alice');

		await page.locator('button[aria-label="Decline call"]').click();
		await expect(page).toHaveURL('/');
	});

	test('answer fetches SIP creds and shows call view', async ({ page }) => {
		await page.goto('/');
		await setupWsAndAuth(page);
		await page.route(/\/api\//, (route) => {
			if (route.request().url().includes('/rooms/room_p2p/join')) {
				return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sipCreds) });
			}
			if (route.request().url().includes('/turn-credentials')) {
				return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ uris: [], username: '', password: '' }) });
			}
			return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
		});
		await openIncomingRoute(page, '/call/incoming/room_p2p?caller=alice%40test.com&name=Alice');

		await page.locator('button[aria-label="Answer call"]').click();

		await expect(page.locator('.call-view')).toBeVisible({ timeout: 5000 });
		await expect(page.locator('button[aria-label="End call"]')).toBeVisible();
	});
});

test.describe('Incoming call — WebSocket call_invite', () => {
	test('call_invite URL format is correct for incoming route', async ({ page }) => {
		// Verify the URL that would be navigated to on call_invite is well-formed
		// (The WS→navigation integration is covered by the websocket unit test)
		const room = 'room_abc123';
		const callerEmail = 'bob@test.com';
		const callerName = 'Bob Smith';
		const url = `/call/incoming/${room}?caller=${encodeURIComponent(callerEmail)}&name=${encodeURIComponent(callerName)}`;

		await page.goto('/');
		await setupWsAndAuth(page);
		await openIncomingRoute(page, url);

		await expect(page.locator('.caller-name')).toHaveText('Bob Smith');
		await expect(page).toHaveURL(new RegExp(room));
	});
});
