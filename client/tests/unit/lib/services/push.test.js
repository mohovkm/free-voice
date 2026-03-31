import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockSubscribe = vi.fn().mockResolvedValue({
	toJSON: () => ({
		endpoint: 'https://push.example.com/sub',
		keys: { p256dh: 'p256dhkey', auth: 'authkey' }
	})
});
const mockGetSubscription = vi.fn().mockResolvedValue(null);

vi.stubGlobal('navigator', {
	serviceWorker: {
		ready: Promise.resolve({
			pushManager: { getSubscription: mockGetSubscription, subscribe: mockSubscribe }
		})
	},
	userAgent: 'TestAgent',
	language: 'en'
});
vi.stubGlobal('Notification', { permission: 'granted' });
vi.stubGlobal('PushManager', {});

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const mockLocalStorage = { getItem: vi.fn() };
vi.stubGlobal('localStorage', mockLocalStorage);

describe('push.js — subscribePush', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		mockGetSubscription.mockResolvedValue(null);
		mockLocalStorage.getItem.mockImplementation((k) =>
			k === 'matrix_homeserver' ? 'https://matrix.example.com' : null
		);
	});

	async function load() {
		vi.doMock('@client/lib/services/backends/matrix', () => ({ getAccessToken: () => 'matrix-token' }));
		const { subscribePush } = await import('@client/lib/services/push');
		return subscribePush;
	}

	it('registers pusher with correct shape: pushkey=p256dh, data={endpoint,auth}', async () => {
		mockFetch
			.mockResolvedValueOnce({
				ok: true,
				json: () => ({
					vapid_public_key: 'vapidkey',
					sygnal_url: 'https://sygnal.example.com/_matrix/push/v1/notify',
					app_id: 'org.freevoice.web'
				})
			})
			// GET /pushers (returns empty list)
			.mockResolvedValueOnce({ ok: true, json: () => ({ pushers: [] }) })
			// POST /pushers/set
			.mockResolvedValueOnce({ ok: true });

		await (
			await load()
		)();

		expect(mockFetch).toHaveBeenCalledTimes(4);
		const [url, opts] = mockFetch.mock.calls[2];
		expect(url).toBe('https://matrix.example.com/_matrix/client/v3/pushers/set');
		const body = JSON.parse(opts.body);
		expect(body.pushkey).toBe('p256dhkey');
		expect(body.data.endpoint).toBe('https://push.example.com/sub');
		expect(body.data.auth).toBe('authkey');
		expect(body.data.url).toBe('https://sygnal.example.com/_matrix/push/v1/notify');
		expect(body.app_id).toBe('org.freevoice.web');
	});

	it('aborts if /api/push/config returns no vapid_public_key', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () => ({ sygnal_url: 'https://sygnal.example.com' })
		});

		await (
			await load()
		)();

		expect(mockFetch).toHaveBeenCalledTimes(1);
	});

	it('aborts if matrix_homeserver not in localStorage', async () => {
		mockLocalStorage.getItem.mockReturnValue(null);
		mockFetch.mockResolvedValueOnce({
			json: () => ({
				vapid_public_key: 'k',
				sygnal_url: 'https://s.example.com',
				app_id: 'org.test'
			})
		});

		await (
			await load()
		)();

		expect(mockFetch).toHaveBeenCalledTimes(1);
	});
});
