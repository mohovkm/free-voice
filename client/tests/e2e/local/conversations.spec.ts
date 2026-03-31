import { test, expect } from '@playwright/test';

const fakeJwt = 'h.' + Buffer.from(JSON.stringify({ sub: 'user@test.com', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64') + '.s';

async function loginAndSetup(page, contacts = [], unread = [], rooms = []) {
	await page.addInitScript(({ token }) => {
		localStorage.setItem('token', token);
		localStorage.setItem('refresh_token', 'ref');
	}, { token: fakeJwt });

	await page.route(/\/api\//, (route) => {
		const url = route.request().url();
		const method = route.request().method();
		if (url.includes('/ws/')) return route.abort();
		if (url.includes('/contacts')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(contacts) });
		if (url.includes('/rooms') && method === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rooms) });
		if (url.includes('/messages/p2p/')) {
			const email = decodeURIComponent(url.split('/messages/p2p/')[1].split('?')[0]);
			const message = contacts.find((contact) => contact.email === email)?.last_message_at;
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(message ? [{ id: 1, created_at: message }] : [])
			});
		}
		if (url.includes('/rooms') && method === 'POST') {
			const payload = route.request().postDataJSON();
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ id: 'room-new', name: payload.name, room_name: 'room_new', max_members: 5, role: 'owner', created_at: new Date().toISOString() })
			});
		}
		if (url.includes('/messages/unread')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(unread) });
		return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
	});
}

test.describe('Conversations list', () => {
	test('shows empty state when no contacts', async ({ page }) => {
		await loginAndSetup(page);
		await page.goto('/');
		await expect(page.locator('h1')).toContainText('Chats');
	});

	test('shows contacts with online status', async ({ page }) => {
		await loginAndSetup(page, [
			{ id: '1', email: 'alice@test.com', display_name: 'Alice', online: true, last_message_at: '2026-03-09T12:34:00.000Z' },
			{ id: '2', email: 'bob@test.com', display_name: 'Bob', online: false }
		], [], [{ id: 'r1', name: 'Family', created_at: new Date().toISOString() }]);
		await page.goto('/');
		await expect(page.locator('.conv-name', { hasText: 'Alice' })).toBeVisible();
		await expect(page.locator('.conv-name', { hasText: 'Bob' })).toBeVisible();
		await expect(page.locator('.conv-name', { hasText: 'Family' })).toBeVisible();
		await expect(page.locator('a[aria-label="Chat with Alice"] .conv-time')).not.toHaveText('');
	});

	test('navigates to chat on click', async ({ page }) => {
		await loginAndSetup(page, [
			{ id: '1', email: 'alice@test.com', display_name: 'Alice', online: true }
		]);
		await page.goto('/');
		await page.click('text=Alice');
		await expect(page).toHaveURL(/\/chat\//);
	});

	test('creates a new group chat from the chats page', async ({ page }) => {
		await loginAndSetup(page);
		await page.goto('/');
		await page.click('button[aria-label="New chat"]');
		await page.click('text=New group');
		await page.fill('input[placeholder="Room name"]', 'Project Team');
		await page.click('text=Create');
		await expect(page).toHaveURL(/\/room\/room-new$/);
	});
});

test.describe('Contacts page', () => {
	test('shows contacts list', async ({ page }) => {
		await loginAndSetup(page, [
			{ id: '1', email: 'alice@test.com', display_name: 'Alice', online: false }
		]);
		await page.goto('/contacts');
		await expect(page.locator('.list-item .item-name', { hasText: 'Alice' }).first()).toBeVisible();
	});

	test('has add contact input', async ({ page }) => {
		await loginAndSetup(page);
		await page.goto('/contacts');
		await expect(page.locator('input[type="email"]')).toBeVisible();
	});
});
