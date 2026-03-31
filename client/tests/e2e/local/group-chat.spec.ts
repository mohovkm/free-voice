import { test, expect } from '@playwright/test';

function makeJwt(sub) {
	return 'h.' + Buffer.from(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64') + '.s';
}

async function setupGroupChat(page, { userId = 'owner-1', role = 'owner', activeCall = null } = {}) {
	const token = makeJwt(userId);
	await page.addInitScript(({ accessToken }) => {
		localStorage.setItem('token', accessToken);
		localStorage.setItem('refresh_token', 'ref');
	}, { accessToken: token });

	const roomDetail = {
		id: 'room-1',
		name: 'Family',
		room_name: 'room_abc',
		role,
		member_count: 2,
		call_max_members: 5,
		active_call: activeCall,
		members: [
			{ id: 'owner-1', email: 'owner@test.com', display_name: 'Owner', role: 'owner' },
			{ id: 'user-2', email: 'alice@test.com', display_name: 'Alice', role: 'member' }
		]
	};
	const contacts = [
		{ id: 'user-2', email: 'alice@test.com', display_name: 'Alice', online: true, status: 'accepted' },
		{ id: 'user-3', email: 'bob@test.com', display_name: 'Bob', online: false, status: 'accepted' }
	];
	const messages = [
		{ id: 'm1', sender_id: 'user-2', sender_display_name: 'Alice', body: 'Hello group', created_at: new Date().toISOString() }
	];

	await page.route(/\/api\//, async (route) => {
		const url = route.request().url();
		const method = route.request().method();
		if (url.includes('/ws/')) return route.abort();
		if (url.includes('/contacts/requests/count')) {
			return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 0 }) });
		}
		if (url.endsWith('/api/devices')) {
			return route.fulfill({ status: 204, body: '' });
		}
		if (url.endsWith('/api/messages/room/room-1')) {
			return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(messages) });
		}
		if (url.endsWith('/api/turn-credentials')) {
			return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ uris: [] }) });
		}
		if (url.endsWith('/api/rooms/room-1') && method === 'GET') {
			return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(roomDetail) });
		}
		if (url.endsWith('/api/rooms/room-1/join') && method === 'POST') {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ room_name: 'room_abc', sip_username: 'u_owner', sip_password: 'pass', turn: { uris: [] } })
			});
		}
		if (url.endsWith('/api/rooms/room-1') && method === 'PATCH') {
			const payload = route.request().postDataJSON();
			roomDetail.name = payload.name;
			return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(roomDetail) });
		}
		if (url.endsWith('/api/contacts')) {
			return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(contacts) });
		}
		if (url.endsWith('/api/rooms/room-1/members') && method === 'POST') {
			const payload = route.request().postDataJSON();
			if (payload.email === 'bob@test.com') {
				roomDetail.members.push({ id: 'user-3', email: 'bob@test.com', display_name: 'Bob', role: 'member' });
				roomDetail.member_count = roomDetail.members.length;
			}
			return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ detail: 'Member added' }) });
		}
		if (url.endsWith('/api/rooms/room-1/members/alice%40test.com') && method === 'DELETE') {
			roomDetail.members.splice(roomDetail.members.findIndex((member) => member.email === 'alice@test.com'), 1);
			roomDetail.member_count = roomDetail.members.length;
			return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ detail: 'Member removed' }) });
		}
		return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
	});
}

test.describe('Group chat', () => {
	test('shows sender names, owner settings, and member management', async ({ page }) => {
		await setupGroupChat(page, { userId: 'owner-1', role: 'owner' });

		await page.goto('/room/room-1');
		await expect(page.locator('text=Hello group')).toBeVisible();
		await expect(page.locator('text=Alice')).toBeVisible();
		await expect(page.locator('button[aria-label="Video call"]')).toBeVisible();
		await expect(page.locator('button[aria-label="Chat settings"]')).toBeVisible();

		await page.click('button[aria-label="Chat settings"]');
		await expect(page).toHaveURL(/\/room\/room-1\/settings$/);
		await expect(page.locator('input#room-name')).toHaveValue('Family');

		await page.fill('input#room-name', 'New Family');
		await page.click('text=Save changes');
		await expect(page.locator('input#room-name')).toHaveValue('New Family');

		await page.fill('input[type="email"]', 'bob@test.com');
		await page.click('button[aria-label="Add member"]');
		await expect(page.locator('.list-item', { hasText: 'Bob' })).toBeVisible();

		await page.click('button[aria-label="Remove member"]');
		await expect(page.locator('.list-item', { hasText: 'Alice' })).toHaveCount(0);
	});

	test('hides settings from non-owners and redirects settings route', async ({ page }) => {
		await setupGroupChat(page, { userId: 'user-2', role: 'member' });

		await page.goto('/room/room-1');
		await expect(page.locator('button[aria-label="Chat settings"]')).toHaveCount(0);

		await page.goto('/room/room-1/settings');
		await expect(page).toHaveURL(/\/room\/room-1$/);
	});

	test('shows active room call banner in chat', async ({ page }) => {
		await setupGroupChat(page, {
			activeCall: {
				room_name: 'room_abc',
				participant_count: 2,
				started_at: new Date().toISOString(),
				started_by_name: 'Alice'
			}
		});

		await page.goto('/room/room-1');
		await expect(page.locator('text=Call in progress')).toBeVisible();
		await expect(page.locator('text=2 participants')).toBeVisible();
		await expect(page.locator('.banner-subtitle', { hasText: 'Alice' })).toBeVisible();
	});
});
