import { get } from 'svelte/store';
import { describe, it, expect, vi, beforeEach } from 'vitest';

function jsonResponse(body, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		statusText: String(status),
		json: async () => body
	};
}

// Each test gets a fresh module instance to avoid _client state leaking between tests
describe('matrix backend — auth', () => {
	let sdk;
	let matrix;
	let mockClient;

	beforeEach(async () => {
		vi.resetModules();
		localStorage.clear();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([])));

		// Re-register the mock after resetModules
		vi.doMock('matrix-js-sdk', () => {
			mockClient = {
				login: vi.fn(),
				startClient: vi.fn(),
				stopClient: vi.fn(),
				clearStores: vi.fn().mockResolvedValue(undefined),
				logout: vi.fn(),
				getUserId: vi.fn(),
				getUser: vi.fn(),
				getAccessToken: vi.fn().mockReturnValue('tok_abc'),
				getRooms: vi.fn().mockReturnValue([]),
				getAccountData: vi.fn().mockReturnValue({ getContent: () => ({}) }),
				createRoom: vi.fn().mockResolvedValue({ room_id: '!dm:example.com' }),
				setAccountData: vi.fn().mockResolvedValue(undefined),
				once: vi.fn(),
				on: vi.fn(),
				off: vi.fn(),
				initRustCrypto: vi.fn().mockResolvedValue(undefined),
				setDisplayName: vi.fn().mockResolvedValue(undefined)
			};
			return { createClient: vi.fn(() => mockClient) };
		});

		sdk = await import('matrix-js-sdk');
		matrix = await import('@client/lib/services/backends/matrix');
	});

	describe('login()', () => {
		it('uses the API compatibility login for email identifiers', async () => {
			global.fetch.mockResolvedValueOnce(
				jsonResponse({
					status: 'ok',
					access_token: 'api_tok',
					user_id: '@alice:example.com',
					device_id: 'DEV1',
					homeserver: 'https://matrix.example.com'
				})
			);

			const result = await matrix.login('alice@example.com', 'secret');

			expect(global.fetch).toHaveBeenCalledWith(
				'/api/auth/matrix-login',
				expect.objectContaining({ method: 'POST' })
			);
			expect(mockClient.login).not.toHaveBeenCalled();
			expect(result).toEqual({ access_token: 'api_tok', user_id: '@alice:example.com' });
		});

		it('calls client.login with m.login.password and correct params', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});

			const result = await matrix.login('@alice:example.com', 'secret');

			expect(mockClient.login).toHaveBeenCalledWith('m.login.password', {
				user: '@alice:example.com',
				password: 'secret',
				initial_device_display_name: 'FREE VOICE'
			});
			expect(result).toEqual({ access_token: 'tok_abc', user_id: '@alice:example.com' });
		});

		it('throws a reset_required error when the API asks for password reset', async () => {
			global.fetch.mockResolvedValueOnce(jsonResponse({ status: 'reset_required' }));

			await expect(matrix.login('alice@example.com', 'secret')).rejects.toMatchObject({
				code: 'reset_required'
			});
		});

		it('falls back to direct SDK login when API returns 401 for a plain localpart (pure Matrix user)', async () => {
			// API returns 401 — user has no legacy DB record
			global.fetch.mockResolvedValueOnce(jsonResponse({ detail: 'Invalid credentials' }, 401));

			mockClient.login.mockResolvedValue({
				access_token: 'direct_tok',
				user_id: '@pureuser:127.0.0.1',
				device_id: 'DEV_DIRECT'
			});

			const result = await matrix.login('pureuser', 'secret');

			// Must have fallen through to SDK login with a constructed full Matrix ID
			expect(mockClient.login).toHaveBeenCalledWith(
				'm.login.password',
				expect.objectContaining({
					user: '@pureuser:localhost',
					password: 'secret'
				})
			);
			expect(result).toEqual({ access_token: 'direct_tok', user_id: '@pureuser:127.0.0.1' });
		});

		it('does NOT fall back to direct SDK login when API returns 401 for an email identifier', async () => {
			// Email identifiers are unambiguously legacy — a 401 must propagate as an error
			global.fetch.mockResolvedValueOnce(jsonResponse({ detail: 'Invalid credentials' }, 401));

			await expect(matrix.login('unknown@example.com', 'secret')).rejects.toMatchObject({
				status: 401
			});
			expect(mockClient.login).not.toHaveBeenCalled();
		});

		it('starts initRustCrypto in the background without blocking the redirect', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});

			// login() must return before initRustCrypto resolves so the redirect fires
			// immediately.  The crypto init runs as a background microtask.
			let cryptoResolve;
			mockClient.initRustCrypto.mockReturnValue(
				new Promise((r) => {
					cryptoResolve = r;
				})
			);

			const loginPromise = matrix.login('@alice:example.com', 'secret');
			// login() should resolve even though crypto hasn't finished yet
			await loginPromise;

			// Resolve crypto after login() returned — simulates real behaviour
			cryptoResolve();
		});

		it('persists session to localStorage after login', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});

			await matrix.login('@alice:example.com', 'secret');

			expect(localStorage.getItem('matrix_access_token')).toBe('tok_abc');
			expect(localStorage.getItem('matrix_user_id')).toBe('@alice:example.com');
			expect(localStorage.getItem('matrix_device_id')).toBe('DEV1');
		});
	});

	describe('init()', () => {
		it('restores session from localStorage and starts client', async () => {
			localStorage.setItem('matrix_access_token', 'stored_tok');
			localStorage.setItem('matrix_user_id', '@bob:example.com');
			localStorage.setItem('matrix_device_id', 'DEV2');

			mockClient.once.mockImplementation((event, cb) => {
				if (event === 'sync') cb('PREPARED');
			});

			await matrix.init();

			expect(sdk.createClient).toHaveBeenCalledWith(
				expect.objectContaining({ accessToken: 'stored_tok', userId: '@bob:example.com' })
			);
			expect(mockClient.startClient).toHaveBeenCalledWith({
				initialSyncLimit: 1,
				lazyLoadMembers: true
			});
		});

		it('awaits the crypto promise started by login() without calling initRustCrypto twice', async () => {
			// login() starts crypto in the background; init() must await the same
			// promise — initRustCrypto() must be called exactly once in total.
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			mockClient.once.mockImplementation((event, cb) => {
				if (event === 'sync') cb('PREPARED');
			});

			await matrix.login('@alice:example.com', 'secret');
			await matrix.init();

			expect(mockClient.initRustCrypto).toHaveBeenCalledOnce();
		});

		it('bootstraps accepted contacts into direct rooms after sync', async () => {
			localStorage.setItem('matrix_access_token', 'stored_tok');
			localStorage.setItem('matrix_user_id', '@alice:example.com');
			localStorage.setItem('matrix_device_id', 'DEV2');
			mockClient.getUserId.mockReturnValue('@alice:example.com');
			mockClient.once.mockImplementation((event, cb) => {
				if (event === 'sync') cb('PREPARED');
			});
			global.fetch.mockResolvedValueOnce(
				jsonResponse([
					{ email: 'bob@example.com', display_name: 'Bob', matrix_user_id: '@bob:example.com' }
				])
			);

			await matrix.init();

			expect(mockClient.createRoom).toHaveBeenCalledWith({
				is_direct: true,
				invite: ['@bob:example.com'],
				preset: 'trusted_private_chat'
			});
		});

		it('does not call initRustCrypto a second time if init() is called again', async () => {
			localStorage.setItem('matrix_access_token', 'stored_tok');
			localStorage.setItem('matrix_user_id', '@bob:example.com');
			localStorage.setItem('matrix_device_id', 'DEV2');

			mockClient.once.mockImplementation((event, cb) => {
				if (event === 'sync') cb('PREPARED');
			});

			await matrix.init();
			await matrix.init();

			expect(mockClient.initRustCrypto).toHaveBeenCalledOnce();
		});

		it('calls authErrorHandler when no session exists in localStorage', async () => {
			const handler = vi.fn();
			matrix.setAuthErrorHandler(handler);

			await matrix.init();

			expect(handler).toHaveBeenCalled();
			expect(mockClient.startClient).not.toHaveBeenCalled();
		});
	});

	describe('logout()', () => {
		it('calls client.logout and stopClient, clears localStorage', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			mockClient.logout.mockResolvedValue({});

			await matrix.login('@alice:example.com', 'secret');
			await matrix.logout();

			expect(mockClient.logout).toHaveBeenCalled();
			expect(mockClient.stopClient).toHaveBeenCalled();
			expect(localStorage.getItem('matrix_access_token')).toBeNull();
		});
	});

	describe('getUserId()', () => {
		it('returns userId from client after login', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			mockClient.getUserId.mockReturnValue('@alice:example.com');

			await matrix.login('@alice:example.com', 'secret');

			expect(matrix.getUserId()).toBe('@alice:example.com');
		});

		it('returns null when not logged in', () => {
			expect(matrix.getUserId()).toBeNull();
		});
	});

	describe('getProfile()', () => {
		it('returns profile shape with displayName from client', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			mockClient.getUserId.mockReturnValue('@alice:example.com');
			mockClient.getUser.mockReturnValue({ displayName: 'Alice' });

			await matrix.login('@alice:example.com', 'secret');
			const profile = await matrix.getProfile();

			expect(profile).toEqual({
				id: '@alice:example.com',
				email: '@alice:example.com',
				display_name: 'Alice'
			});
		});

		it('returns null when not logged in', async () => {
			expect(await matrix.getProfile()).toBeNull();
		});
	});

	describe('register()', () => {
		it('registers directly when no UIAA required', async () => {
			mockClient.register = vi.fn().mockResolvedValue({
				access_token: 'reg_tok',
				user_id: '@newuser:example.com',
				device_id: 'DEV3'
			});

			const result = await matrix.register('newuser', 'pass123');

			expect(mockClient.register).toHaveBeenCalledWith('newuser', 'pass123', null, null);
			expect(result).toEqual({ user_id: '@newuser:example.com' });
			expect(localStorage.getItem('matrix_access_token')).toBe('reg_tok');
		});

		it('completes UIAA dummy stage when challenged', async () => {
			const uiaaError = Object.assign(new Error('UIAA'), {
				httpStatus: 401,
				data: { session: 'sess123', flows: [{ stages: ['m.login.dummy'] }] }
			});
			mockClient.register = vi.fn().mockRejectedValueOnce(uiaaError).mockResolvedValueOnce({
				access_token: 'reg_tok2',
				user_id: '@newuser2:example.com',
				device_id: 'DEV4'
			});

			const result = await matrix.register('newuser2', 'pass456');

			expect(mockClient.register).toHaveBeenCalledTimes(2);
			expect(mockClient.register).toHaveBeenLastCalledWith('newuser2', 'pass456', 'sess123', {
				type: 'm.login.dummy',
				session: 'sess123'
			});
			expect(result).toEqual({ user_id: '@newuser2:example.com' });
		});
	});

	describe('handleHide() + reconnectIfNeeded()', () => {
		async function initClient() {
			localStorage.setItem('matrix_access_token', 'stored_tok');
			localStorage.setItem('matrix_user_id', '@alice:example.com');
			localStorage.setItem('matrix_device_id', 'DEV1');
			mockClient.on = vi.fn();
			mockClient.off = vi.fn();
			mockClient.once.mockImplementation((event, cb) => {
				if (event === 'sync') cb('PREPARED');
			});
			mockClient.getSyncState = vi.fn().mockReturnValue('SYNCING');
			await matrix.init();
			// Clear call counts from init
			mockClient.startClient.mockClear();
			mockClient.stopClient.mockClear();
		}

		it('1.1 background >= 10s + SYNCING → force restart (stopClient + startClient)', async () => {
			await initClient();
			vi.useFakeTimers();
			try {
				matrix.handleHide();
				vi.advanceTimersByTime(11000);
				matrix.reconnectIfNeeded();
				expect(mockClient.stopClient).toHaveBeenCalledOnce();
				expect(mockClient.startClient).toHaveBeenCalledOnce();
			} finally {
				vi.useRealTimers();
			}
		});

		it('1.2 background < 5s + SYNCING + fresh lastSyncAt → no restart, _backgroundedAt cleared', async () => {
			await initClient();
			const clientModule = await import('@client/lib/services/backends/matrix/client');
			vi.useFakeTimers();
			try {
				clientModule._setLastSyncAt(Date.now()); // fresh sync
				matrix.handleHide();
				vi.advanceTimersByTime(4_999); // just below FREEZE_THRESHOLD_MS (5 000)
				matrix.reconnectIfNeeded();
				expect(mockClient.stopClient).not.toHaveBeenCalled();
				expect(mockClient.startClient).not.toHaveBeenCalled();
				expect(clientModule._backgroundedAt).toBeNull();
			} finally {
				vi.useRealTimers();
			}
		});

		it('1.3 stale _lastSyncAt (> 60s) + SYNCING, no background → force restart', async () => {
			await initClient();
			const clientModule = await import('@client/lib/services/backends/matrix/client');
			vi.useFakeTimers();
			try {
				clientModule._setLastSyncAt(Date.now() - 61000); // stale
				matrix.reconnectIfNeeded();
				expect(mockClient.stopClient).toHaveBeenCalledOnce();
				expect(mockClient.startClient).toHaveBeenCalledOnce();
			} finally {
				vi.useRealTimers();
			}
		});

		it('1.4 STOPPED state → startClient only, no stopClient', async () => {
			await initClient();
			mockClient.getSyncState.mockReturnValue('STOPPED');
			matrix.reconnectIfNeeded();
			expect(mockClient.stopClient).not.toHaveBeenCalled();
			expect(mockClient.startClient).toHaveBeenCalledOnce();
		});

		it('1.5 ERROR state → startClient only, no stopClient', async () => {
			await initClient();
			mockClient.getSyncState.mockReturnValue('ERROR');
			matrix.reconnectIfNeeded();
			expect(mockClient.stopClient).not.toHaveBeenCalled();
			expect(mockClient.startClient).toHaveBeenCalledOnce();
		});

		it('1.6 no handleHide() + SYNCING + fresh lastSyncAt → no restart', async () => {
			await initClient();
			const clientModule = await import('@client/lib/services/backends/matrix/client');
			vi.useFakeTimers();
			try {
				clientModule._setLastSyncAt(Date.now()); // fresh
				matrix.reconnectIfNeeded();
				expect(mockClient.stopClient).not.toHaveBeenCalled();
				expect(mockClient.startClient).not.toHaveBeenCalled();
			} finally {
				vi.useRealTimers();
			}
		});
	});

	describe('reconnectOrReload()', () => {
		async function initClient() {
			localStorage.setItem('matrix_access_token', 'stored_tok');
			localStorage.setItem('matrix_user_id', '@alice:example.com');
			localStorage.setItem('matrix_device_id', 'DEV1');
			mockClient.on = vi.fn();
			mockClient.off = vi.fn();
			mockClient.once.mockImplementation((event, cb) => {
				if (event === 'sync') cb('PREPARED');
			});
			mockClient.getSyncState = vi.fn().mockReturnValue('SYNCING');
			await matrix.init();
			mockClient.startClient.mockClear();
			mockClient.stopClient.mockClear();
		}

		it('2.1 background >= 3 min → reloadFn called immediately, no stopClient/startClient', async () => {
			await initClient();
			const clientModule = await import('@client/lib/services/backends/matrix/client');
			vi.useFakeTimers();
			try {
				const reloadFn = vi.fn();
				matrix.handleHide();
				vi.advanceTimersByTime(181_000); // 3 min 1 sec
				matrix.reconnectOrReload(reloadFn);
				expect(reloadFn).toHaveBeenCalledOnce();
				expect(mockClient.stopClient).not.toHaveBeenCalled();
				expect(mockClient.startClient).not.toHaveBeenCalled();
			} finally {
				vi.useRealTimers();
			}
		});

		it('2.1b soft reconnect does NOT fire at 4 999 ms gap (below FREEZE_THRESHOLD_MS = 5 000)', async () => {
			// Guards against accidental threshold regression (was 10 000 before ios-lifecycle-supervisor)
			await initClient();
			vi.useFakeTimers();
			try {
				const clientModule = await import('@client/lib/services/backends/matrix/client');
				clientModule._setLastSyncAt(Date.now());
				matrix.handleHide();
				vi.advanceTimersByTime(4_999);
				matrix.reconnectOrReload(vi.fn());
				expect(mockClient.stopClient).not.toHaveBeenCalled();
			} finally {
				vi.useRealTimers();
			}
		});

		it('2.1c soft reconnect fires at 5 001 ms gap (above FREEZE_THRESHOLD_MS = 5 000)', async () => {
			await initClient();
			vi.useFakeTimers();
			try {
				const clientModule = await import('@client/lib/services/backends/matrix/client');
				clientModule._setLastSyncAt(Date.now());
				matrix.handleHide();
				vi.advanceTimersByTime(5_001);
				matrix.reconnectOrReload(vi.fn());
				expect(mockClient.stopClient).toHaveBeenCalledOnce();
			} finally {
				vi.useRealTimers();
			}
		});

		it('2.2 background >= 5s < 3 min → soft reconnect, no immediate reload', async () => {
			await initClient();
			vi.useFakeTimers();
			try {
				const reloadFn = vi.fn();
				const clientModule = await import('@client/lib/services/backends/matrix/client');
				clientModule._setLastSyncAt(Date.now()); // fresh sync at hide time
				matrix.handleHide();
				vi.advanceTimersByTime(6_000); // 6s — just above 5s threshold
				matrix.reconnectOrReload(reloadFn);
				// Soft reconnect should have fired
				expect(mockClient.stopClient).toHaveBeenCalledOnce();
				expect(mockClient.startClient).toHaveBeenCalledOnce();
				// No immediate reload
				expect(reloadFn).not.toHaveBeenCalled();
			} finally {
				vi.useRealTimers();
			}
		});

		it('2.3 medium background → soft reconnect → sync does NOT recover → reloadFn after 20s', async () => {
			await initClient();
			const clientModule = await import('@client/lib/services/backends/matrix/client');
			vi.useFakeTimers();
			try {
				const reloadFn = vi.fn();
				// Simulate stale sync (never recovered)
				clientModule._setLastSyncAt(Date.now() - 15_000);
				matrix.handleHide();
				vi.advanceTimersByTime(11_000); // 11s background
				matrix.reconnectOrReload(reloadFn);
				expect(reloadFn).not.toHaveBeenCalled();
				// Advance past the 20s verify window — sync still stale
				vi.advanceTimersByTime(21_000);
				expect(reloadFn).toHaveBeenCalledOnce();
			} finally {
				vi.useRealTimers();
			}
		});

		it('2.4 medium background → soft reconnect → sync recovers → no reload', async () => {
			await initClient();
			const clientModule = await import('@client/lib/services/backends/matrix/client');
			vi.useFakeTimers();
			try {
				const reloadFn = vi.fn();
				clientModule._setLastSyncAt(Date.now() - 15_000); // stale at hide time
				matrix.handleHide();
				vi.advanceTimersByTime(11_000); // fake time = start+11s; reconnectOrReload captures this as reconnectAt
				matrix.reconnectOrReload(reloadFn); // reconnectAt = start+11s
				// Advance 5s → fake time = start+16s; sync fires AFTER reconnectAt
				vi.advanceTimersByTime(5_000);
				clientModule._setLastSyncAt(Date.now()); // _lastSyncAt = start+16s > reconnectAt
				// Advance remaining 15s to trigger the 20s verify callback (total advance: 11+5+15=31s > 11+20=31s)
				vi.advanceTimersByTime(15_000);
				expect(reloadFn).not.toHaveBeenCalled();
			} finally {
				vi.useRealTimers();
			}
		});

		it('2.5 no background gap + sync stale > 3 min → reloadFn called', async () => {
			await initClient();
			const clientModule = await import('@client/lib/services/backends/matrix/client');
			vi.useFakeTimers();
			try {
				const reloadFn = vi.fn();
				clientModule._setLastSyncAt(Date.now() - 181_000); // 3 min 1 sec stale
				// No handleHide — foreground stale scenario
				matrix.reconnectOrReload(reloadFn);
				expect(reloadFn).toHaveBeenCalledOnce();
				expect(mockClient.stopClient).not.toHaveBeenCalled();
			} finally {
				vi.useRealTimers();
			}
		});

		it('2.6 no background gap + sync fresh → no-op', async () => {
			await initClient();
			const clientModule = await import('@client/lib/services/backends/matrix/client');
			vi.useFakeTimers();
			try {
				const reloadFn = vi.fn();
				clientModule._setLastSyncAt(Date.now()); // fresh
				matrix.reconnectOrReload(reloadFn);
				expect(reloadFn).not.toHaveBeenCalled();
				expect(mockClient.stopClient).not.toHaveBeenCalled();
				expect(mockClient.startClient).not.toHaveBeenCalled();
			} finally {
				vi.useRealTimers();
			}
		});
	});

	describe('destroy()', () => {
		it('calls stopClient after login', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			await matrix.login('@alice:example.com', 'secret');

			matrix.destroy();

			expect(mockClient.stopClient).toHaveBeenCalled();
		});
	});

	describe('getUnreadCounts()', () => {
		it('calls fn immediately with { total, highlight } counts keyed by roomId', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			mockClient.getRooms = vi.fn().mockReturnValue([
				{ roomId: '!a:example.com', getUnreadNotificationCount: (t) => t === 'highlight' ? 1 : 3 },
				{ roomId: '!b:example.com', getUnreadNotificationCount: () => 0 }
			]);
			mockClient.on = vi.fn();
			mockClient.off = vi.fn();

			await matrix.login('@alice:example.com', 'secret');

			const fn = vi.fn();
			matrix.getUnreadCounts(fn);

			expect(fn).toHaveBeenCalledOnce();
			expect(fn.mock.calls[0][0]).toEqual({ '!a:example.com': { total: 3, highlight: 1 } });
			// !b has count 0 — should be omitted
		});

		it('returns unsubscribe that removes Room.timeline, Room.receipt and RoomMember.membership listeners', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			mockClient.getRooms = vi.fn().mockReturnValue([]);
			mockClient.on = vi.fn();
			mockClient.off = vi.fn();

			await matrix.login('@alice:example.com', 'secret');

			const unsub = matrix.getUnreadCounts(vi.fn());
			unsub();

			const offEvents = mockClient.off.mock.calls.map(([evt]) => evt);
			expect(offEvents).toContain('Room.timeline');
			expect(offEvents).toContain('Room.receipt');
			expect(offEvents).toContain('RoomMember.membership');
		});
	});

	describe('onMessage()', () => {
		it('returns no-op unsubscribe when client not initialised', () => {
			const unsub = matrix.onMessage(vi.fn());
			expect(typeof unsub).toBe('function');
			// Should not throw
			unsub();
		});

		it('calls fn for new m.room.message events (toStartOfTimeline=false)', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			mockClient.getUserId.mockReturnValue('@alice:example.com');
			mockClient.on = vi.fn();
			mockClient.off = vi.fn();

			await matrix.login('@alice:example.com', 'secret');

			const fn = vi.fn();
			matrix.onMessage(fn);

			// Grab the handler registered for 'Room.timeline'
			const [, handler] = mockClient.on.mock.calls.find(([evt]) => evt === 'Room.timeline');

			const fakeEvent = {
				getType: () => 'm.room.message',
				getId: () => '$ev1',
				getSender: () => '@bob:example.com',
				getContent: () => ({ body: 'hi' }),
				getTs: () => 1700000000000,
				getRoomId: () => '!room:example.com',
				getUnsignedData: () => ({}),
				sender: { name: '@bob:example.com' }
			};

			handler(fakeEvent, null, false);

			expect(fn).toHaveBeenCalledOnce();
			expect(fn.mock.calls[0][0]).toMatchObject({
				id: '$ev1',
				senderId: '@bob:example.com',
				body: 'hi',
				roomId: '!room:example.com',
				mine: false
			});
		});

		it('skips historical events (toStartOfTimeline=true)', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			mockClient.getUserId.mockReturnValue('@alice:example.com');
			mockClient.on = vi.fn();
			mockClient.off = vi.fn();

			await matrix.login('@alice:example.com', 'secret');

			const fn = vi.fn();
			matrix.onMessage(fn);

			const [, handler] = mockClient.on.mock.calls.find(([evt]) => evt === 'Room.timeline');

			const fakeEvent = {
				getType: () => 'm.room.message',
				getId: () => '$ev2',
				getSender: () => '@bob:example.com',
				getContent: () => ({ body: 'old' }),
				getTs: () => 1700000000000,
				getRoomId: () => '!room:example.com'
			};

			handler(fakeEvent, null, true); // toStartOfTimeline = true → skip

			expect(fn).not.toHaveBeenCalled();
		});

		it('does not call fn a second time for a re-delivered event with the same event ID', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			mockClient.getUserId.mockReturnValue('@alice:example.com');
			mockClient.on = vi.fn();
			mockClient.off = vi.fn();

			await matrix.login('@alice:example.com', 'secret');

			const fn = vi.fn();
			matrix.onMessage(fn);

			const [, handler] = mockClient.on.mock.calls.find(([evt]) => evt === 'Room.timeline');

			const fakeEvent = {
				getType: () => 'm.room.message',
				getId: () => '$ev_dup',
				getSender: () => '@bob:example.com',
				getContent: () => ({ body: 'hello' }),
				getTs: () => 1700000000000,
				getRoomId: () => '!room:example.com'
			};

			handler(fakeEvent, null, false);
			handler(fakeEvent, null, false); // same event re-delivered (e.g. on reconnect)

			expect(fn).toHaveBeenCalledOnce();
		});

		// Regression: guard must use truthiness (if event.status) not strict null check
		// (event.status !== null).  The SDK fires Room.timeline with status='sending' for
		// its own local echoes; confirmed server events arrive with status=null.  Unit-test
		// mocks typically have status=undefined — a strict !== null check rejects those too,
		// causing fn to never fire in tests even when the runtime behaviour is correct.
		it('skips SDK local-echo events (status truthy, e.g. "sending")', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			mockClient.getUserId.mockReturnValue('@alice:example.com');
			mockClient.on = vi.fn();
			mockClient.off = vi.fn();

			await matrix.login('@alice:example.com', 'secret');

			const fn = vi.fn();
			matrix.onMessage(fn);

			const [, handler] = mockClient.on.mock.calls.find(([evt]) => evt === 'Room.timeline');

			// Simulate SDK local echo (status='sending') — must be ignored
			const sdkEcho = {
				getType: () => 'm.room.message',
				getId: () => '$sdk_echo',
				getSender: () => '@alice:example.com',
				getContent: () => ({ body: 'hi' }),
				getTs: () => 1700000000001,
				getRoomId: () => '!room:example.com',
				getUnsignedData: () => ({ transaction_id: 'txn_1' }),
				sender: { name: '@alice:example.com' },
				status: 'sending'
			};
			handler(sdkEcho, null, false);
			expect(fn).not.toHaveBeenCalled();
		});

		it('processes confirmed server events (status null)', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			mockClient.getUserId.mockReturnValue('@alice:example.com');
			mockClient.on = vi.fn();
			mockClient.off = vi.fn();

			await matrix.login('@alice:example.com', 'secret');

			const fn = vi.fn();
			matrix.onMessage(fn);

			const [, handler] = mockClient.on.mock.calls.find(([evt]) => evt === 'Room.timeline');

			// Simulate confirmed server event (status=null) — must be processed
			const confirmed = {
				getType: () => 'm.room.message',
				getId: () => '$confirmed_1',
				getSender: () => '@bob:example.com',
				getContent: () => ({ body: 'hello' }),
				getTs: () => 1700000000002,
				getRoomId: () => '!room:example.com',
				getUnsignedData: () => ({}),
				sender: { name: '@bob:example.com' },
				status: null
			};
			handler(confirmed, null, false);
			expect(fn).toHaveBeenCalledOnce();
			expect(fn.mock.calls[0][0]).toMatchObject({ id: '$confirmed_1', body: 'hello' });
		});
	});

	describe('init() — concurrency guard', () => {
		it('concurrent calls produce exactly one startClient() call', async () => {
			localStorage.setItem('matrix_access_token', 'stored_tok');
			localStorage.setItem('matrix_user_id', '@alice:example.com');
			localStorage.setItem('matrix_device_id', 'DEV1');

			// Immediately fire PREPARED so both concurrent calls can settle
			mockClient.once.mockImplementation((event, cb) => {
				if (event === 'sync') cb('PREPARED');
			});

			// Launch two concurrent init() calls without awaiting either first
			await Promise.all([matrix.init(), matrix.init()]);

			expect(mockClient.startClient).toHaveBeenCalledOnce();
		});
	});

	describe('getHistory()', () => {
		it('returns empty array when client not initialised', async () => {
			expect(await matrix.getHistory('!room:example.com', 10)).toEqual([]);
		});

		it('returns array with length < limit when fewer messages exist (canLoadMore=false)', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			mockClient.getUserId.mockReturnValue('@alice:example.com');

			const fakeEvent = {
				getType: () => 'm.room.message',
				getId: () => '$ev1',
				getSender: () => '@bob:example.com',
				getContent: () => ({ msgtype: 'm.text', body: 'hello' }),
				getTs: () => 1700000000000,
				getRoomId: () => '!room:example.com',
				getUnsignedData: () => ({}),
				sender: { name: '@bob:example.com' },
				status: null
			};
			const fakeTimeline = { getEvents: () => [fakeEvent] };
			const fakeRoom = { getLiveTimeline: () => fakeTimeline, findEventById: () => null };
			mockClient.getRoom = vi.fn().mockReturnValue(fakeRoom);
			mockClient.paginateEventTimeline = vi.fn().mockResolvedValue(false);

			await matrix.login('@alice:example.com', 'secret');
			const result = await matrix.getHistory('!room:example.com', 10);

			// 1 message < limit of 10 → canLoadMore would be false
			expect(result.length).toBeLessThan(10);
		});

		it('returns array with length >= limit when enough messages exist (canLoadMore=true)', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			mockClient.getUserId.mockReturnValue('@alice:example.com');

			const events = Array.from({ length: 10 }, (_, i) => ({
				getType: () => 'm.room.message',
				getId: () => `$ev${i}`,
				getSender: () => '@bob:example.com',
				getContent: () => ({ msgtype: 'm.text', body: `msg ${i}` }),
				getTs: () => 1000 + i,
				getRoomId: () => '!room:example.com',
				getUnsignedData: () => ({}),
				sender: { name: '@bob:example.com' },
				status: null
			}));
			const fakeTimeline = { getEvents: () => events };
			const fakeRoom = { getLiveTimeline: () => fakeTimeline, findEventById: () => null };
			mockClient.getRoom = vi.fn().mockReturnValue(fakeRoom);
			mockClient.paginateEventTimeline = vi.fn().mockResolvedValue(true);

			await matrix.login('@alice:example.com', 'secret');
			const result = await matrix.getHistory('!room:example.com', 10);

			expect(result.length).toBe(10);
		});

		it('returns array length >= limit when paginateEventTimeline says more pages exist even if few messages fetched', async () => {
			// Regression: room has many state events mixed in — one pagination yields only 3
			// message events but paginateEventTimeline returns true (more pages on server).
			// getHistory must signal canLoadMore=true so the room page will keep loading.
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			mockClient.getUserId.mockReturnValue('@alice:example.com');

			// 3 messages + 7 state events = 10 events total, but only 3 are m.room.message
			const msgEvents = Array.from({ length: 3 }, (_, i) => ({
				getType: () => 'm.room.message',
				getId: () => `$msg${i}`,
				getSender: () => '@bob:example.com',
				getContent: () => ({ msgtype: 'm.text', body: `msg ${i}` }),
				getTs: () => 1000 + i,
				getRoomId: () => '!room:example.com',
				getUnsignedData: () => ({}),
				sender: { name: '@bob:example.com' },
				status: null
			}));
			const stateEvents = Array.from({ length: 7 }, (_, i) => ({
				getType: () => 'm.room.member',
				getId: () => `$state${i}`,
				getSender: () => '@alice:example.com',
				getContent: () => ({ membership: 'join' }),
				getTs: () => 900 + i,
				getRoomId: () => '!room:example.com',
				getUnsignedData: () => ({}),
				sender: { name: '@alice:example.com' },
				status: null
			}));
			const allEvents = [...stateEvents, ...msgEvents];
			const fakeTimeline = { getEvents: () => allEvents };
			const fakeRoom = { getLiveTimeline: () => fakeTimeline, findEventById: () => null };
			mockClient.getRoom = vi.fn().mockReturnValue(fakeRoom);
			// Server says there are more pages even though we only got 3 messages
			mockClient.paginateEventTimeline = vi.fn().mockResolvedValue(true);

			await matrix.login('@alice:example.com', 'secret');
			const result = await matrix.getHistory('!room:example.com', 10);

			// Must signal canLoadMore=true → length >= limit
			expect(result.length).toBeGreaterThanOrEqual(10);
		});
	});

	describe('sendReadReceipt()', () => {
		it('calls client.sendReadReceipt with the freshest eligible timeline event', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			const pendingEvent = {
				getId: () => '$pending',
				getType: () => 'm.room.message',
				getTs: () => 1700000001000,
				getRoomId: () => '!room:example.com',
				status: 'sending'
			};
			const fakeEvent = {
				getId: () => '$last',
				getType: () => 'm.room.message',
				getTs: () => 1700000000000,
				getRoomId: () => '!room:example.com',
				status: null
			};
			const fakeRoom = { getLiveTimeline: () => ({ getEvents: () => [fakeEvent, pendingEvent] }) };
			mockClient.getRoom = vi.fn().mockReturnValue(fakeRoom);
			mockClient.sendReadReceipt = vi.fn().mockResolvedValue({});

			await matrix.login('@alice:example.com', 'secret');
			await matrix.sendReadReceipt('!room:example.com');

			expect(mockClient.sendReadReceipt).toHaveBeenCalledWith(fakeEvent);
		});

		it('does not throw when client not initialised', async () => {
			await expect(matrix.sendReadReceipt('!room:example.com')).resolves.toBeUndefined();
		});

		it('sends a follow-up receipt when a newer eligible event becomes available later', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			const olderEvent = {
				getId: () => '$older',
				getType: () => 'm.room.message',
				getTs: () => 1700000000000,
				getRoomId: () => '!room:example.com',
				status: null
			};
			const newerEvent = {
				getId: () => '$newer',
				getType: () => 'm.room.message',
				getTs: () => 1700000005000,
				getRoomId: () => '!room:example.com',
				status: null
			};
			let timelineEvents = [olderEvent];
			const fakeRoom = { getLiveTimeline: () => ({ getEvents: () => timelineEvents }) };
			mockClient.getRoom = vi.fn().mockReturnValue(fakeRoom);
			mockClient.sendReadReceipt = vi.fn().mockResolvedValue({});

			await matrix.login('@alice:example.com', 'secret');
			await matrix.sendReadReceipt('!room:example.com');

			timelineEvents = [olderEvent, newerEvent];
			await matrix.sendReadReceipt('!room:example.com');

			expect(mockClient.sendReadReceipt).toHaveBeenCalledTimes(2);
			expect(mockClient.sendReadReceipt).toHaveBeenNthCalledWith(1, olderEvent);
			expect(mockClient.sendReadReceipt).toHaveBeenNthCalledWith(2, newerEvent);
		});

		it('suppresses duplicate sends when the freshest eligible event has not advanced', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			const fakeEvent = {
				getId: () => '$same',
				getType: () => 'm.room.message',
				getTs: () => 1700000000000,
				getRoomId: () => '!room:example.com',
				status: null
			};
			const fakeRoom = { getLiveTimeline: () => ({ getEvents: () => [fakeEvent] }) };
			mockClient.getRoom = vi.fn().mockReturnValue(fakeRoom);
			mockClient.sendReadReceipt = vi.fn().mockResolvedValue({});

			await matrix.login('@alice:example.com', 'secret');
			await matrix.sendReadReceipt('!room:example.com');
			await matrix.sendReadReceipt('!room:example.com');

			expect(mockClient.sendReadReceipt).toHaveBeenCalledTimes(1);
			expect(mockClient.sendReadReceipt).toHaveBeenCalledWith(fakeEvent);
		});

		it('allows explicit resend attempts for the same freshest eligible event', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			const fakeEvent = {
				getId: () => '$same',
				getType: () => 'm.room.message',
				getTs: () => 1700000000000,
				getRoomId: () => '!room:example.com',
				status: null
			};
			const fakeRoom = { getLiveTimeline: () => ({ getEvents: () => [fakeEvent] }) };
			mockClient.getRoom = vi.fn().mockReturnValue(fakeRoom);
			mockClient.sendReadReceipt = vi.fn().mockResolvedValue({});

			await matrix.login('@alice:example.com', 'secret');
			await matrix.sendReadReceipt('!room:example.com');
			await matrix.sendReadReceipt('!room:example.com', true, true);

			expect(mockClient.sendReadReceipt).toHaveBeenCalledTimes(2);
			expect(mockClient.sendReadReceipt).toHaveBeenNthCalledWith(1, fakeEvent);
			expect(mockClient.sendReadReceipt).toHaveBeenNthCalledWith(2, fakeEvent);
		});

		it('skips trailing non-message events and acknowledges the latest receipt-eligible event', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			const latestMessageEvent = {
				getId: () => '$message',
				getType: () => 'm.room.message',
				getTs: () => 1700000000000,
				getRoomId: () => '!room:example.com',
				status: null
			};
			const trailingMemberEvent = {
				getId: () => '$member',
				getType: () => 'm.room.member',
				getTs: () => 1700000005000,
				getRoomId: () => '!room:example.com',
				status: null
			};
			const fakeRoom = {
				getLiveTimeline: () => ({ getEvents: () => [latestMessageEvent, trailingMemberEvent] })
			};
			mockClient.getRoom = vi.fn().mockReturnValue(fakeRoom);
			mockClient.sendReadReceipt = vi.fn().mockResolvedValue({});

			await matrix.login('@alice:example.com', 'secret');
			await matrix.sendReadReceipt('!room:example.com');

			expect(mockClient.sendReadReceipt).toHaveBeenCalledTimes(1);
			expect(mockClient.sendReadReceipt).toHaveBeenCalledWith(latestMessageEvent);
		});
	});

	describe('getPeerReadTs()', () => {
		it('returns the highest peer read timestamp', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			mockClient.getUserId.mockReturnValue('@alice:example.com');
			const peerReadEvent = { getTs: () => 1700001000000 };
			const fakeRoom = {
				getJoinedMembers: () => [{ userId: '@alice:example.com' }, { userId: '@bob:example.com' }],
				getEventReadUpTo: (userId) => (userId === '@bob:example.com' ? '$bob_read' : null),
				findEventById: (id) => (id === '$bob_read' ? peerReadEvent : null)
			};
			mockClient.getRoom = vi.fn().mockReturnValue(fakeRoom);

			await matrix.login('@alice:example.com', 'secret');
			const ts = matrix.getPeerReadTs('!room:example.com');

			expect(ts).toBe(1700001000000);
		});

		it('returns 0 when no peer receipts exist', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			mockClient.getUserId.mockReturnValue('@alice:example.com');
			const fakeRoom = {
				getJoinedMembers: () => [{ userId: '@alice:example.com' }],
				getEventReadUpTo: () => null,
				findEventById: () => null
			};
			mockClient.getRoom = vi.fn().mockReturnValue(fakeRoom);

			await matrix.login('@alice:example.com', 'secret');
			expect(matrix.getPeerReadTs('!room:example.com')).toBe(0);
		});

		it('falls back to currentState joined members when getJoinedMembers is unavailable', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			mockClient.getUserId.mockReturnValue('@alice:example.com');
			const peerReadEvent = { getId: () => '$bob_read', getTs: () => 1700001000000 };
			const fakeRoom = {
				currentState: {
					getMembers: () => [
						{ userId: '@alice:example.com', membership: 'join' },
						{ userId: '@bob:example.com', membership: 'join' }
					]
				},
				getLiveTimeline: () => ({ getEvents: () => [peerReadEvent] }),
				getEventReadUpTo: (userId) => (userId === '@bob:example.com' ? '$bob_read' : null),
				findEventById: () => null
			};
			mockClient.getRoom = vi.fn().mockReturnValue(fakeRoom);

			await matrix.login('@alice:example.com', 'secret');
			expect(matrix.getPeerReadTs('!room:example.com')).toBe(1700001000000);
		});

		it('returns 0 when client not initialised', () => {
			expect(matrix.getPeerReadTs('!room:example.com')).toBe(0);
		});
	});

	describe('getPeerReadEventId()', () => {
		it('returns the event id associated with the highest peer receipt', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			mockClient.getUserId.mockReturnValue('@alice:example.com');
			const fakeRoom = {
				getJoinedMembers: () => [{ userId: '@alice:example.com' }, { userId: '@bob:example.com' }],
				getEventReadUpTo: (userId) => (userId === '@bob:example.com' ? '$bob_read' : null),
				findEventById: (id) => (id === '$bob_read' ? { getTs: () => 1700001000000 } : null)
			};
			mockClient.getRoom = vi.fn().mockReturnValue(fakeRoom);

			await matrix.login('@alice:example.com', 'secret');
			expect(matrix.getPeerReadEventId('!room:example.com')).toBe('$bob_read');
		});

		it('returns null when no peer receipt exists', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			mockClient.getUserId.mockReturnValue('@alice:example.com');
			mockClient.getRoom = vi.fn().mockReturnValue({
				getJoinedMembers: () => [{ userId: '@alice:example.com' }, { userId: '@bob:example.com' }],
				getEventReadUpTo: () => null,
				findEventById: () => null
			});

			await matrix.login('@alice:example.com', 'secret');
			expect(matrix.getPeerReadEventId('!room:example.com')).toBeNull();
		});
	});

	describe('onReadReceiptChanged()', () => {
		it('calls fn with updated peer read ts when Room.receipt fires for the room', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			mockClient.getUserId.mockReturnValue('@alice:example.com');
			mockClient.on = vi.fn();
			mockClient.off = vi.fn();
			const peerReadEvent = { getTs: () => 1700002000000 };
			const fakeRoom = {
				roomId: '!room:example.com',
				getJoinedMembers: () => [{ userId: '@alice:example.com' }, { userId: '@bob:example.com' }],
				getEventReadUpTo: (userId) => (userId === '@bob:example.com' ? '$bob_ev' : null),
				findEventById: (id) => (id === '$bob_ev' ? peerReadEvent : null)
			};
			mockClient.getRoom = vi.fn().mockReturnValue(fakeRoom);

			await matrix.login('@alice:example.com', 'secret');

			const fn = vi.fn();
			matrix.onReadReceiptChanged('!room:example.com', fn);

			const [, handler] = mockClient.on.mock.calls.find(([evt]) => evt === 'Room.receipt');
			handler(null, fakeRoom);

			expect(fn).toHaveBeenCalledOnce();
			expect(fn.mock.calls[0][0]).toBe(1700002000000);
		});

		it('ignores receipt events from other rooms', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			mockClient.getUserId.mockReturnValue('@alice:example.com');
			mockClient.on = vi.fn();
			mockClient.off = vi.fn();
			mockClient.getRoom = vi.fn().mockReturnValue(null);

			await matrix.login('@alice:example.com', 'secret');

			const fn = vi.fn();
			matrix.onReadReceiptChanged('!room:example.com', fn);

			const [, handler] = mockClient.on.mock.calls.find(([evt]) => evt === 'Room.receipt');
			handler(null, { roomId: '!other:example.com' });

			expect(fn).not.toHaveBeenCalled();
		});

		it('returns no-op unsubscribe when client not initialised', () => {
			const unsub = matrix.onReadReceiptChanged('!room:example.com', vi.fn());
			expect(typeof unsub).toBe('function');
			unsub();
		});
	});

	describe('sendTyping()', () => {
		it('calls client.sendTyping with isTyping=true and 4000ms timeout', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			mockClient.sendTyping = vi.fn().mockResolvedValue({});

			await matrix.login('@alice:example.com', 'secret');
			await matrix.sendTyping('!room:example.com', true);

			expect(mockClient.sendTyping).toHaveBeenCalledWith('!room:example.com', true, 4000);
		});

		it('calls client.sendTyping with isTyping=false and no timeout', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			mockClient.sendTyping = vi.fn().mockResolvedValue({});

			await matrix.login('@alice:example.com', 'secret');
			await matrix.sendTyping('!room:example.com', false);

			expect(mockClient.sendTyping).toHaveBeenCalledWith('!room:example.com', false, undefined);
		});

		it('does not throw when client not initialised', async () => {
			await expect(matrix.sendTyping('!room:example.com', true)).resolves.toBeUndefined();
		});
	});

	describe('onTypingChanged()', () => {
		it('calls fn when a peer starts typing in the given room', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			mockClient.getUserId.mockReturnValue('@alice:example.com');
			mockClient.on = vi.fn();
			mockClient.off = vi.fn();

			await matrix.login('@alice:example.com', 'secret');

			const fn = vi.fn();
			matrix.onTypingChanged('!room:example.com', fn);

			const [, handler] = mockClient.on.mock.calls.find(([evt]) => evt === 'RoomMember.typing');
			const fakeMember = { roomId: '!room:example.com', userId: '@bob:example.com', typing: true };
			handler(null, fakeMember);

			expect(fn).toHaveBeenCalledOnce();
			expect(fn.mock.calls[0][0]).toEqual({ userId: '@bob:example.com', typing: true });
		});

		it('skips own typing events', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			mockClient.getUserId.mockReturnValue('@alice:example.com');
			mockClient.on = vi.fn();
			mockClient.off = vi.fn();

			await matrix.login('@alice:example.com', 'secret');

			const fn = vi.fn();
			matrix.onTypingChanged('!room:example.com', fn);

			const [, handler] = mockClient.on.mock.calls.find(([evt]) => evt === 'RoomMember.typing');
			// Typing event from own user — should be filtered
			const ownMember = { roomId: '!room:example.com', userId: '@alice:example.com', typing: true };
			handler(null, ownMember);

			expect(fn).not.toHaveBeenCalled();
		});

		it('skips typing events from a different room', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			mockClient.getUserId.mockReturnValue('@alice:example.com');
			mockClient.on = vi.fn();
			mockClient.off = vi.fn();

			await matrix.login('@alice:example.com', 'secret');

			const fn = vi.fn();
			matrix.onTypingChanged('!room:example.com', fn);

			const [, handler] = mockClient.on.mock.calls.find(([evt]) => evt === 'RoomMember.typing');
			const otherRoomMember = {
				roomId: '!other:example.com',
				userId: '@bob:example.com',
				typing: true
			};
			handler(null, otherRoomMember);

			expect(fn).not.toHaveBeenCalled();
		});

		it('returns no-op unsubscribe when client not initialised', () => {
			const unsub = matrix.onTypingChanged('!room:example.com', vi.fn());
			expect(typeof unsub).toBe('function');
			unsub(); // should not throw
		});

		it('fires callback with typing:false when peer stops typing', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			mockClient.getUserId.mockReturnValue('@alice:example.com');
			mockClient.on = vi.fn();
			mockClient.off = vi.fn();

			await matrix.login('@alice:example.com', 'secret');

			const fn = vi.fn();
			matrix.onTypingChanged('!room:example.com', fn);

			const [, handler] = mockClient.on.mock.calls.find(([evt]) => evt === 'RoomMember.typing');
			handler(null, { roomId: '!room:example.com', userId: '@bob:example.com', typing: true });
			handler(null, { roomId: '!room:example.com', userId: '@bob:example.com', typing: false });

			expect(fn).toHaveBeenCalledTimes(2);
			expect(fn.mock.calls[0][0]).toEqual({ userId: '@bob:example.com', typing: true });
			expect(fn.mock.calls[1][0]).toEqual({ userId: '@bob:example.com', typing: false });
		});

		it('fires independent events for two simultaneous typers', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			mockClient.getUserId.mockReturnValue('@alice:example.com');
			mockClient.on = vi.fn();
			mockClient.off = vi.fn();

			await matrix.login('@alice:example.com', 'secret');

			const fn = vi.fn();
			matrix.onTypingChanged('!room:example.com', fn);

			const [, handler] = mockClient.on.mock.calls.find(([evt]) => evt === 'RoomMember.typing');
			// Bob starts typing
			handler(null, { roomId: '!room:example.com', userId: '@bob:example.com', typing: true });
			// Carol starts typing
			handler(null, { roomId: '!room:example.com', userId: '@carol:example.com', typing: true });
			// Bob stops typing — carol is still typing; fn should have been called 3 times total
			handler(null, { roomId: '!room:example.com', userId: '@bob:example.com', typing: false });

			expect(fn).toHaveBeenCalledTimes(3);
			// Last call: bob stopped
			expect(fn.mock.calls[2][0]).toEqual({ userId: '@bob:example.com', typing: false });
		});

		it('unsubscribe removes listener so no further callbacks are fired', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			mockClient.getUserId.mockReturnValue('@alice:example.com');
			mockClient.on = vi.fn();
			mockClient.off = vi.fn();

			await matrix.login('@alice:example.com', 'secret');

			const fn = vi.fn();
			const unsub = matrix.onTypingChanged('!room:example.com', fn);

			// Capture the registered handler before unsubscribing
			const [, handler] = mockClient.on.mock.calls.find(([evt]) => evt === 'RoomMember.typing');

			unsub();
			expect(mockClient.off).toHaveBeenCalledWith('RoomMember.typing', handler);
		});
	});

	describe('sendMessage()', () => {
		it('calls client.sendMessage with m.text msgtype and a txnId', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			mockClient.sendMessage = vi.fn().mockResolvedValue({ event_id: '$ev1' });

			await matrix.login('@alice:example.com', 'secret');
			const txnId = matrix.sendMessage('!room:example.com', 'hello');

			expect(mockClient.sendMessage).toHaveBeenCalledWith(
				'!room:example.com',
				{ msgtype: 'm.text', body: 'hello' },
				txnId
			);
		});

		it('returns a non-empty txnId string', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			mockClient.sendMessage = vi.fn().mockResolvedValue({ event_id: '$ev1' });

			await matrix.login('@alice:example.com', 'secret');
			const txnId = matrix.sendMessage('!room:example.com', 'hello');

			expect(typeof txnId).toBe('string');
			expect(txnId.length).toBeGreaterThan(0);
		});

		it('includes m.relates_to when replyToEventId is provided', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			mockClient.sendMessage = vi.fn().mockResolvedValue({ event_id: '$ev2' });

			await matrix.login('@alice:example.com', 'secret');
			matrix.sendMessage('!room:example.com', 'reply text', '$orig_event');

			expect(mockClient.sendMessage).toHaveBeenCalledWith(
				'!room:example.com',
				{
					msgtype: 'm.text',
					body: 'reply text',
					'm.relates_to': { 'm.in_reply_to': { event_id: '$orig_event' } }
				},
				expect.any(String)
			);
		});

		it('throws synchronously when client not initialised', () => {
			expect(() => matrix.sendMessage('!room:example.com', 'hi')).toThrow(
				'Matrix client not initialised'
			);
		});

		it('onMessage() — dispatches txnId from event unsigned data', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			mockClient.getUserId.mockReturnValue('@alice:example.com');
			mockClient.on = vi.fn();
			mockClient.off = vi.fn();

			await matrix.login('@alice:example.com', 'secret');

			const fn = vi.fn();
			matrix.onMessage(fn);

			const [, handler] = mockClient.on.mock.calls.find(([evt]) => evt === 'Room.timeline');

			const fakeEvent = {
				getType: () => 'm.room.message',
				getId: () => '$ev_txn',
				getSender: () => '@bob:example.com',
				getContent: () => ({ body: 'hi' }),
				getTs: () => 1700000000000,
				getRoomId: () => '!room:example.com',
				getUnsignedData: () => ({ transaction_id: 'txn-abc-123' })
			};

			handler(fakeEvent, null, false);

			expect(fn).toHaveBeenCalledOnce();
			expect(fn.mock.calls[0][0].txnId).toBe('txn-abc-123');
		});
	});

	describe('onConversationsChanged()', () => {
		it('calls fn immediately with sorted rooms after login', async () => {
			const roomA = {
				roomId: '!a:example.com',
				name: 'Room A',
				getMyMembership: () => 'join',
				getLastActiveTimestamp: () => 1000
			};
			const roomB = {
				roomId: '!b:example.com',
				name: 'Room B',
				getMyMembership: () => 'join',
				getLastActiveTimestamp: () => 2000
			};
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			mockClient.getRooms = vi.fn().mockReturnValue([roomA, roomB]);
			mockClient.on = vi.fn();
			mockClient.off = vi.fn();

			await matrix.login('@alice:example.com', 'secret');

			const fn = vi.fn();
			matrix.onConversationsChanged(fn);

			// Should have been called with rooms sorted newest-first (roomB before roomA)
			expect(fn).toHaveBeenCalledOnce();
			const [rooms] = fn.mock.calls[0];
			expect(rooms[0].roomId).toBe('!b:example.com');
			expect(rooms[1].roomId).toBe('!a:example.com');
		});

		it('returns unsubscribe function that removes listeners', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			mockClient.getRooms = vi.fn().mockReturnValue([]);
			mockClient.on = vi.fn();
			mockClient.off = vi.fn();

			await matrix.login('@alice:example.com', 'secret');

			const unsub = matrix.onConversationsChanged(vi.fn());
			unsub();

			// 3 listeners: Room.timeline, Room, RoomMember.membership
			expect(mockClient.off).toHaveBeenCalledTimes(3);
		});

		it('calls fn with empty array when client not initialised', () => {
			const fn = vi.fn();
			matrix.onConversationsChanged(fn);
			// No client → fn not called (client is null, so we skip setup)
			expect(fn).not.toHaveBeenCalled();
		});

		it('unsubscribe before flush — no SDK listeners are registered when init() later flushes (CR-5)', async () => {
			// Client not initialised yet — onConversationsChanged queues the listener.
			const fn = vi.fn();
			const unsub = matrix.onConversationsChanged(fn);

			// Unsubscribe before init() runs.
			unsub();

			// Now simulate init() completing: login + startClient + flush.
			localStorage.setItem('matrix_access_token', 'stored_tok');
			localStorage.setItem('matrix_user_id', '@alice:example.com');
			localStorage.setItem('matrix_device_id', 'DEV1');
			mockClient.on = vi.fn();
			mockClient.off = vi.fn();
			mockClient.once.mockImplementation((event, cb) => {
				if (event === 'sync') cb('PREPARED');
			});
			mockClient.getRooms = vi.fn().mockReturnValue([]);
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));

			await matrix.init();

			// The unsubscribed listener must NOT have been registered with the SDK.
			const registeredFns = mockClient.on.mock.calls.map(([, handler]) => handler);
			// fn is the outer function passed to onConversationsChanged; the internal emit
			// closure wraps it, so we check that fn itself was never called during flush.
			expect(fn).not.toHaveBeenCalled();
			// And that no 'Room.timeline' registration corresponds to our emit closure.
			// We verify indirectly: if our listener had been registered, fn() would have
			// been called by emit() during flush (since mockClient.getRooms returns []).
			// fn not called ↔ the listener was not flushed.
		});

		it('unsubscribe after flush removes exactly the registered listeners (CR-5)', async () => {
			mockClient.login.mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			mockClient.getRooms = vi.fn().mockReturnValue([]);
			mockClient.on = vi.fn();
			mockClient.off = vi.fn();

			await matrix.login('@alice:example.com', 'secret');

			const unsub = matrix.onConversationsChanged(vi.fn());
			unsub();

			// Three listeners registered (Room.timeline, Room, RoomMember.membership),
			// all three must be removed.
			expect(mockClient.off).toHaveBeenCalledTimes(3);
		});
	});

	describe('acceptContact()', () => {
		async function loginWithClient() {
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValueOnce(
					jsonResponse({
						access_token: 'tok_abc',
						user_id: '@alice:example.com',
						device_id: 'DEV1'
					})
				)
			);
			mockClient.login = vi.fn().mockResolvedValue({
				access_token: 'tok_abc',
				user_id: '@alice:example.com',
				device_id: 'DEV1'
			});
			mockClient.getRooms = vi.fn().mockReturnValue([]);
			mockClient.on = vi.fn();
			mockClient.off = vi.fn();
			await matrix.login('@alice:example.com', 'secret');
		}

		it('resolves immediately when room is already in join state after joinRoom', async () => {
			await loginWithClient();
			const roomId = '!dm:example.com';
			// joinRoom resolves; room.getMyMembership() returns 'join' right away
			mockClient.joinRoom = vi.fn().mockResolvedValue({ room_id: roomId });
			mockClient.getRoom = vi.fn().mockReturnValue({
				getMyMembership: () => 'join'
			});

			await expect(matrix.acceptContact(roomId)).resolves.toBeUndefined();
			expect(mockClient.joinRoom).toHaveBeenCalledWith(roomId);
			// No membership listener needed since room is already 'join'
			expect(mockClient.on).not.toHaveBeenCalledWith('RoomMember.membership', expect.any(Function));
		});

		it('waits for RoomMember.membership event when SDK state is still invite after joinRoom', async () => {
			await loginWithClient();
			const roomId = '!dm:example.com';
			mockClient.getUserId = vi.fn().mockReturnValue('@alice:example.com');
			mockClient.joinRoom = vi.fn().mockResolvedValue({ room_id: roomId });
			// SDK still shows invite state initially
			mockClient.getRoom = vi.fn().mockReturnValue({
				getMyMembership: () => 'invite'
			});

			let capturedHandler;
			// Capture the RoomMember.membership handler so we can fire it manually
			mockClient.on = vi.fn().mockImplementation((event, fn) => {
				if (event === 'RoomMember.membership') capturedHandler = fn;
			});

			const acceptPromise = matrix.acceptContact(roomId);

			// Simulate SDK firing the membership event after sync
			await vi.waitFor(() => expect(capturedHandler).toBeDefined());
			capturedHandler({}, { roomId, userId: '@alice:example.com', membership: 'join' });

			await expect(acceptPromise).resolves.toBeUndefined();
		});

		it('logout() during the 5s membership wait does not throw (CR-7)', async () => {
			// Use fake timers from the start so we can advance past the 5s timeout
			// without waiting in real time.  All mock resolutions are microtask-based
			// and unaffected by fake timers.
			vi.useFakeTimers();
			try {
				await loginWithClient();

				const roomId = '!dm:example.com';
				mockClient.getUserId = vi.fn().mockReturnValue('@alice:example.com');
				mockClient.joinRoom = vi.fn().mockResolvedValue({ room_id: roomId });
				// SDK still shows invite state — acceptContact() will wait for membership
				mockClient.getRoom = vi.fn().mockReturnValue({ getMyMembership: () => 'invite' });

				let capturedHandler;
				mockClient.on = vi.fn().mockImplementation((event, fn) => {
					if (event === 'RoomMember.membership') capturedHandler = fn;
				});
				mockClient.off = vi.fn();

				const acceptPromise = matrix.acceptContact(roomId);

				// Flush the joinRoom mock promise so the membership listener gets registered
				await vi.advanceTimersByTimeAsync(0);
				expect(capturedHandler).toBeDefined();

				// Simulate logout — sets _client = null
				await matrix.logout();

				// Advance past the 5s timeout: cleanup() fires with _client === null.
				// The optional chaining in cleanup() must prevent a TypeError here.
				await vi.advanceTimersByTimeAsync(5001);

				// acceptContact() must resolve cleanly (bails out via if (!_client) return)
				await expect(acceptPromise).resolves.toBeUndefined();
			} finally {
				vi.useRealTimers();
			}
		});
	});
});

// ---------------------------------------------------------------------------
// Peer display name resolution (regression: "Empty room (was @user:domain)")
// ---------------------------------------------------------------------------
// With lazyLoadMembers:true, room.currentState.getMembers() may only contain
// the current user when a DM room has never been explicitly opened.
// getDMContacts() and getRoomPeer() must resolve the peer name via m.direct
// account data + _client.getUser() instead of falling back to room.name.
// ---------------------------------------------------------------------------

describe('matrix backend — peer display name (lazy member loading)', () => {
	let matrix;
	let mockClient;

	function makeRoom({
		roomId,
		membership = 'join',
		members = [],
		joinedMemberCount = members.filter((member) => member.membership === 'join').length,
		mDirectPeerId = null,
		roomName = ''
	}) {
		return {
			roomId,
			getMyMembership: () => membership,
			getJoinedMemberCount: () => joinedMemberCount,
			name: roomName,
			currentState: {
				getMembers: () => members,
				getStateEvents: (type, userId) => {
					if (type === 'm.room.member') {
						const m = members.find((m) => m.userId === userId);
						return m ? { getContent: () => m.content || {} } : null;
					}
					return null;
				}
			}
		};
	}

	beforeEach(async () => {
		vi.resetModules();
		localStorage.clear();

		vi.doMock('matrix-js-sdk', () => {
			mockClient = {
				login: vi.fn().mockResolvedValue({
					access_token: 'tok',
					user_id: '@alice:example.com',
					device_id: 'DEV1'
				}),
				startClient: vi.fn(),
				stopClient: vi.fn(),
				clearStores: vi.fn().mockResolvedValue(undefined),
				logout: vi.fn(),
				getUserId: vi.fn().mockReturnValue('@alice:example.com'),
				getUser: vi.fn().mockReturnValue(null),
				getAccessToken: vi.fn().mockReturnValue('tok'),
				getRooms: vi.fn().mockReturnValue([]),
				getAccountData: vi.fn().mockReturnValue({ getContent: () => ({}) }),
				setAccountData: vi.fn().mockResolvedValue(undefined),
				once: vi.fn(),
				on: vi.fn(),
				off: vi.fn(),
				initRustCrypto: vi.fn().mockResolvedValue(undefined),
				setDisplayName: vi.fn().mockResolvedValue(undefined),
				getHomeserverUrl: vi.fn().mockReturnValue('https://example.com')
			};
			return { createClient: vi.fn(() => mockClient) };
		});

		matrix = await import('@client/lib/services/backends/matrix');

		// Drive login() to set _client inside the module
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ detail: 'not found' }, 401)));
		await matrix.login('@alice:example.com', 'secret');
	});

	it('getDMContacts() uses m.direct + getUser() when peer member is not lazy-loaded', () => {
		// Simulate unloaded member state: only Alice is in currentState.getMembers()
		const aliceMember = {
			userId: '@alice:example.com',
			name: 'Alice',
			membership: 'join',
			content: { is_direct: true }
		};
		const room = makeRoom({
			roomId: '!dm:example.com',
			membership: 'join',
			members: [aliceMember], // peer NOT loaded
			joinedMemberCount: 2,
			roomName: 'Empty room (was @bob:example.com)' // SDK fallback name — must NOT appear
		});
		mockClient.getRooms.mockReturnValue([room]);

		// m.direct maps Bob → this room
		mockClient.getAccountData.mockReturnValue({
			getContent: () => ({ '@bob:example.com': ['!dm:example.com'] })
		});

		// getUser() returns Bob's cached profile (set via setDisplayName on registration)
		mockClient.getUser.mockImplementation((userId) =>
			userId === '@bob:example.com' ? { displayName: 'Bob' } : null
		);

		const contacts = matrix.getDMContacts();

		expect(contacts).toHaveLength(1);
		expect(contacts[0].display_name).toBe('Bob');
		expect(contacts[0].display_name).not.toContain('Empty room');
	});

	it('getDMContacts() falls back to peer userId when getUser() returns null', () => {
		const aliceMember = {
			userId: '@alice:example.com',
			name: 'Alice',
			membership: 'join',
			content: { is_direct: true }
		};
		const room = makeRoom({
			roomId: '!dm:example.com',
			membership: 'join',
			members: [aliceMember],
			joinedMemberCount: 2,
			roomName: 'Empty room (was @bob:example.com)'
		});
		mockClient.getRooms.mockReturnValue([room]);
		mockClient.getAccountData.mockReturnValue({
			getContent: () => ({ '@bob:example.com': ['!dm:example.com'] })
		});
		mockClient.getUser.mockReturnValue(null); // profile not yet cached

		const contacts = matrix.getDMContacts();

		expect(contacts[0].display_name).toBe('@bob:example.com');
		expect(contacts[0].display_name).not.toContain('Empty room');
	});

	it('getRoomPeer() uses m.direct + getUser() when peer member is not lazy-loaded', () => {
		const aliceMember = {
			userId: '@alice:example.com',
			name: 'Alice',
			membership: 'join',
			content: {}
		};
		const room = makeRoom({
			roomId: '!dm:example.com',
			membership: 'join',
			members: [aliceMember],
			roomName: 'Empty room (was @bob:example.com)'
		});
		mockClient.getRoom = vi.fn().mockReturnValue(room);
		mockClient.getAccountData.mockReturnValue({
			getContent: () => ({ '@bob:example.com': ['!dm:example.com'] })
		});
		mockClient.getUser.mockImplementation((userId) =>
			userId === '@bob:example.com' ? { displayName: 'Bob' } : null
		);

		const peer = matrix.getRoomPeer('!dm:example.com');

		expect(peer.name).toBe('Bob');
		expect(peer.name).not.toContain('Empty room');
	});

	it('getDMContacts() ignores stale direct rooms that no longer have an active peer relationship', () => {
		const aliceMember = {
			userId: '@alice:example.com',
			name: 'Alice',
			membership: 'join',
			content: { is_direct: true }
		};
		const room = makeRoom({
			roomId: '!stale:example.com',
			membership: 'join',
			members: [aliceMember],
			joinedMemberCount: 1,
			roomName: 'Empty room (was @bob:example.com)'
		});
		mockClient.getRooms.mockReturnValue([room]);
		mockClient.getAccountData.mockReturnValue({
			getContent: () => ({ '@bob:example.com': ['!stale:example.com'] })
		});

		expect(matrix.getDMContacts()).toEqual([]);
	});
});

describe('matrix backend — contact re-invite lifecycle', () => {
	let matrix;
	let mockClient;

	function makeDirectRoom({
		roomId,
		joinedMemberCount,
		peerUserId = '@bob:example.com',
		peerMembership = null
	}) {
		return {
			roomId,
			getMyMembership: () => 'join',
			getLastActiveTimestamp: () => Date.now(),
			getLiveTimeline: () => ({ getEvents: () => [] }),
			getUnreadNotificationCount: () => 0,
			getJoinedMemberCount: () => joinedMemberCount,
			currentState: {
				getMembers: () => [
					{ userId: '@alice:example.com', membership: 'join', name: 'Alice', content: { is_direct: true } }
				],
				getStateEvents: (type, userId) => {
					if (type !== 'm.room.member') return null;
					if (userId === '@alice:example.com') {
						return { getContent: () => ({ is_direct: true, membership: 'join' }) };
					}
					if (userId === peerUserId && peerMembership) {
						return { getContent: () => ({ membership: peerMembership }) };
					}
					return null;
				}
			}
		};
	}

	beforeEach(async () => {
		vi.resetModules();
		localStorage.clear();

		vi.doMock('matrix-js-sdk', () => {
			mockClient = {
				login: vi.fn().mockResolvedValue({
					access_token: 'tok',
					user_id: '@alice:example.com',
					device_id: 'DEV1'
				}),
				startClient: vi.fn(),
				stopClient: vi.fn(),
				clearStores: vi.fn().mockResolvedValue(undefined),
				logout: vi.fn(),
				getUserId: vi.fn().mockReturnValue('@alice:example.com'),
				getUser: vi.fn().mockReturnValue(null),
				getAccessToken: vi.fn().mockReturnValue('tok'),
				getRooms: vi.fn().mockReturnValue([]),
				getRoom: vi.fn().mockReturnValue(null),
				getAccountData: vi.fn().mockReturnValue({ getContent: () => ({}) }),
				setAccountData: vi.fn().mockResolvedValue(undefined),
				createRoom: vi.fn().mockResolvedValue({ room_id: '!new:example.com' }),
				once: vi.fn(),
				on: vi.fn(),
				off: vi.fn(),
				initRustCrypto: vi.fn().mockResolvedValue(undefined),
				setDisplayName: vi.fn().mockResolvedValue(undefined),
				getHomeserverUrl: vi.fn().mockReturnValue('https://example.com')
			};
			return { createClient: vi.fn(() => mockClient) };
		});

		matrix = await import('@client/lib/services/backends/matrix');
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ detail: 'not found' }, 401)));
		await matrix.login('@alice:example.com', 'secret');
	});

	it('addContact() creates a fresh DM when m.direct points at a stale joined room', async () => {
		const staleRoom = makeDirectRoom({
			roomId: '!stale:example.com',
			joinedMemberCount: 1
		});
		mockClient.getRoom.mockImplementation((roomId) =>
			roomId === '!stale:example.com' ? staleRoom : null
		);
		mockClient.getAccountData.mockReturnValue({
			getContent: () => ({ '@bob:example.com': ['!stale:example.com'] })
		});

		await matrix.addContact('@bob:example.com');

		expect(mockClient.createRoom).toHaveBeenCalledWith({
			is_direct: true,
			invite: ['@bob:example.com'],
			preset: 'trusted_private_chat'
		});
		expect(mockClient.setAccountData).toHaveBeenCalledWith('m.direct', {
			'@bob:example.com': ['!stale:example.com', '!new:example.com']
		});
	});

	it('addContact() still short-circuits when the mapped DM is an active accepted contact', async () => {
		const acceptedRoom = makeDirectRoom({
			roomId: '!accepted:example.com',
			joinedMemberCount: 2,
			peerMembership: 'join'
		});
		mockClient.getRoom.mockImplementation((roomId) =>
			roomId === '!accepted:example.com' ? acceptedRoom : null
		);
		mockClient.getAccountData.mockReturnValue({
			getContent: () => ({ '@bob:example.com': ['!accepted:example.com'] })
		});

		await matrix.addContact('@bob:example.com');

		expect(mockClient.createRoom).not.toHaveBeenCalled();
		expect(mockClient.setAccountData).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Media upload helpers
// ---------------------------------------------------------------------------

describe('matrix backend — media helpers', () => {
	let matrix;
	let mockClient;
	let matrixStore;

	beforeEach(async () => {
		vi.resetModules();
		mockClient = {
			login: vi.fn(),
			startClient: vi.fn(),
			stopClient: vi.fn(),
			logout: vi.fn(),
			on: vi.fn(),
			off: vi.fn(),
			once: vi.fn(),
			getRooms: vi.fn().mockReturnValue([]),
			getRoom: vi.fn().mockReturnValue(null),
			getUserId: vi.fn().mockReturnValue('@alice:example.com'),
			getAccessToken: vi.fn().mockReturnValue('tok_abc'),
			initRustCrypto: vi.fn().mockResolvedValue(undefined),
			uploadContent: vi.fn(),
			sendMessage: vi.fn().mockResolvedValue({ event_id: '$ev1' }),
			mxcUrlToHttp: vi.fn((mxc) => `https://example.com/_matrix/media/v3/download/${mxc.slice(6)}`)
		};
		vi.doMock('matrix-js-sdk', () => ({ createClient: vi.fn(() => mockClient) }));
		matrix = await import('@client/lib/services/backends/matrix');
		matrixStore = await import('@client/lib/stores/matrixStore');
		matrixStore.resetStore();
		// Inject the mock client directly via the internal setter
		const clientModule = await import('@client/lib/services/backends/matrix/client');
		clientModule._setClient(mockClient);
	});

	describe('uploadMedia()', () => {
		it('calls uploadContent and returns structured result', async () => {
			const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' });
			mockClient.uploadContent.mockResolvedValue({ content_uri: 'mxc://example.com/abc123' });

			const result = await matrix.uploadMedia(file);

			expect(mockClient.uploadContent).toHaveBeenCalledWith(file, {
				name: 'photo.jpg',
				type: 'image/jpeg',
				onlyContentUri: false
			});
			expect(result).toEqual({
				mxcUrl: 'mxc://example.com/abc123',
				mimeType: 'image/jpeg',
				size: file.size,
				filename: 'photo.jpg'
			});
		});
	});

	describe('getMediaUrl()', () => {
		it('converts mxc:// URI to http URL via SDK', () => {
			const url = matrix.getMediaUrl('mxc://example.com/abc123');
			expect(url).toBe('https://example.com/_matrix/media/v3/download/example.com/abc123');
		});

		it('returns null for falsy input', () => {
			expect(matrix.getMediaUrl(null)).toBeNull();
			expect(matrix.getMediaUrl('')).toBeNull();
		});
	});

	describe('sendMediaMessage()', () => {
		it('uploads file and sends message with correct msgtype', async () => {
			const file = new File(['data'], 'clip.mp4', { type: 'video/mp4' });
			mockClient.uploadContent.mockResolvedValue({ content_uri: 'mxc://example.com/vid1' });

			// happy-dom doesn't implement video playback; make the video element fire 'error'
			// immediately so extractVideoInfo resolves { duration: null, thumbBlob: null } without the 5s timeout.
			const origCreate = document.createElement.bind(document);
			vi.spyOn(document, 'createElement').mockImplementation((tag) => {
				const el = origCreate(tag);
				if (tag === 'video') queueMicrotask(() => el.dispatchEvent(new Event('error')));
				return el;
			});

			const txnId = await matrix.sendMediaMessage('!room:example.com', file, 'm.video');

			expect(mockClient.sendMessage).toHaveBeenCalledWith(
				'!room:example.com',
				expect.objectContaining({
					msgtype: 'm.video',
					body: 'clip.mp4',
					url: 'mxc://example.com/vid1'
				}),
				txnId
			);
			vi.restoreAllMocks();
		});

		it('includes m.relates_to when replyToEventId is provided', async () => {
			const file = new File(['data'], 'doc.pdf', { type: 'application/pdf' });
			mockClient.uploadContent.mockResolvedValue({ content_uri: 'mxc://example.com/file1' });

			await matrix.sendMediaMessage('!room:example.com', file, 'm.file', '$orig_event');

			expect(mockClient.sendMessage).toHaveBeenCalledWith(
				'!room:example.com',
				expect.objectContaining({
					'm.relates_to': { 'm.in_reply_to': { event_id: '$orig_event' } }
				}),
				expect.any(String)
			);
		});

		it('accepts a file within the per-type size limit', async () => {
			// 9 MB image — under the 10 MB limit
			const data = new Uint8Array(9 * 1024 * 1024);
			const file = new File([data], 'photo.jpg', { type: 'image/jpeg' });
			mockClient.uploadContent.mockResolvedValue({ content_uri: 'mxc://example.com/img1' });

			await expect(
				matrix.sendMediaMessage('!room:example.com', file, 'm.image')
			).resolves.toBeDefined();
		});

		it('rejects an image exceeding the 10 MB limit', async () => {
			// 11 MB image — over the 10 MB limit
			const data = new Uint8Array(11 * 1024 * 1024);
			const file = new File([data], 'big.jpg', { type: 'image/jpeg' });

			await expect(
				matrix.sendMediaMessage('!room:example.com', file, 'm.image')
			).rejects.toThrow(/max 10 MB/i);
			expect(mockClient.uploadContent).not.toHaveBeenCalled();
		});

		it('rejects an audio file exceeding the 5 MB limit', async () => {
			const data = new Uint8Array(6 * 1024 * 1024);
			const file = new File([data], 'long.ogg', { type: 'audio/ogg' });

			await expect(
				matrix.sendMediaMessage('!room:example.com', file, 'm.audio')
			).rejects.toThrow(/max 5 MB/i);
			expect(mockClient.uploadContent).not.toHaveBeenCalled();
		});

		it('audio file-picker send: no info.duration or info.waveform when audioMeta is null', async () => {
			const file = new File(['audio'], 'podcast.ogg', { type: 'audio/ogg' });
			mockClient.uploadContent.mockResolvedValue({ content_uri: 'mxc://example.com/aud1' });

			await matrix.sendMediaMessage('!room:example.com', file, 'm.audio', null, null);

			const [, content] = mockClient.sendMessage.mock.calls.at(-1);
			expect(content.info.duration).toBeUndefined();
			expect(content.info.waveform).toBeUndefined();
		});

		it('voice recording send: includes info.duration and info.waveform when audioMeta is provided', async () => {
			const file = new File(['audio'], 'voice.webm', { type: 'audio/webm' });
			mockClient.uploadContent.mockResolvedValue({ content_uri: 'mxc://example.com/aud2' });
			const waveform = Array(60).fill(0.5);
			const audioMeta = { durationSecs: 30, waveformData: waveform };

			await matrix.sendMediaMessage('!room:example.com', file, 'm.audio', null, audioMeta);

			const [, content] = mockClient.sendMessage.mock.calls.at(-1);
			expect(content.info.duration).toBe(30000); // 30s → 30000 ms
			expect(content.info.waveform).toEqual(waveform);
		});

		it('removes the local echo and rejects when Matrix event send fails after upload', async () => {
			const file = new File(['audio'], 'voice.m4a', { type: 'audio/mp4' });
			mockClient.uploadContent.mockResolvedValue({ content_uri: 'mxc://example.com/aud3' });
			mockClient.sendMessage.mockRejectedValue(new Error('M_FORBIDDEN'));

			await expect(
				matrix.sendMediaMessage('!room:example.com', file, 'm.audio')
			).rejects.toThrow(/M_FORBIDDEN/);

			expect(get(matrixStore.messagesFor('!room:example.com'))).toEqual([]);
		});
	});

	describe('extractAudioInfo()', () => {
		it('returns { durationSecs, waveformData } with 60 bars on success', async () => {
			const pcm = new Float32Array(44100).fill(0.5); // 1s of audio
			const mockBuffer = { duration: 1.0, getChannelData: vi.fn().mockReturnValue(pcm) };
			const mockCtx = {
				decodeAudioData: vi.fn().mockResolvedValue(mockBuffer),
				close: vi.fn().mockResolvedValue(undefined)
			};
			vi.stubGlobal('AudioContext', vi.fn(() => mockCtx));

			const file = new File(['fake-audio'], 'voice.webm', { type: 'audio/webm' });
			const result = await matrix.extractAudioInfo(file);

			expect(result.durationSecs).toBeCloseTo(1.0);
			expect(Array.isArray(result.waveformData)).toBe(true);
			expect(result.waveformData).toHaveLength(60);
			expect(result.waveformData.every((v) => Number.isInteger(v) && v >= 0 && v <= 1024)).toBe(
				true
			);

			vi.unstubAllGlobals();
		});

		it('returns { durationSecs: null, waveformData: null } when decodeAudioData throws', async () => {
			const mockCtx = {
				decodeAudioData: vi.fn().mockRejectedValue(new Error('unsupported')),
				close: vi.fn().mockResolvedValue(undefined)
			};
			vi.stubGlobal('AudioContext', vi.fn(() => mockCtx));

			const file = new File(['garbage'], 'bad.ogg', { type: 'audio/ogg' });
			const result = await matrix.extractAudioInfo(file);

			expect(result.durationSecs).toBeNull();
			expect(result.waveformData).toBeNull();

			vi.unstubAllGlobals();
		});

		it('returns { durationSecs: null, waveformData: null } when AudioContext is unavailable', async () => {
			vi.stubGlobal('AudioContext', undefined);
			// ensure webkitAudioContext is also absent
			const orig = globalThis.webkitAudioContext;
			delete globalThis.webkitAudioContext;

			const file = new File(['data'], 'voice.webm', { type: 'audio/webm' });
			const result = await matrix.extractAudioInfo(file);

			expect(result.durationSecs).toBeNull();
			expect(result.waveformData).toBeNull();

			vi.unstubAllGlobals();
			if (orig !== undefined) globalThis.webkitAudioContext = orig;
		});
	});
});

describe('matrix backend — onCallSignal warm-start backfill', () => {
	let matrix;
	let mockClient;
	let syncListeners;
	let timelineListeners;

	beforeEach(async () => {
		vi.resetModules();
		localStorage.clear();
		syncListeners = [];
		timelineListeners = [];

		vi.doMock('matrix-js-sdk', () => {
			mockClient = {
				login: vi.fn(),
				startClient: vi.fn(),
				stopClient: vi.fn(),
				clearStores: vi.fn().mockResolvedValue(undefined),
				logout: vi.fn(),
				getUserId: vi.fn().mockReturnValue('@alice:example.com'),
				getUser: vi.fn().mockReturnValue(null),
				getAccessToken: vi.fn().mockReturnValue('tok'),
				getRooms: vi.fn().mockReturnValue([]),
				getAccountData: vi.fn().mockReturnValue({ getContent: () => ({}) }),
				createRoom: vi.fn().mockResolvedValue({ room_id: '!dm:example.com' }),
				setAccountData: vi.fn().mockResolvedValue(undefined),
				once: vi.fn((event, cb) => { if (event === 'sync') cb('PREPARED'); }),
				on: vi.fn((event, cb) => {
					if (event === 'sync') syncListeners.push(cb);
					if (event === 'Room.timeline') timelineListeners.push(cb);
				}),
				off: vi.fn((event, cb) => {
					if (event === 'sync') syncListeners = syncListeners.filter(l => l !== cb);
					if (event === 'Room.timeline') timelineListeners = timelineListeners.filter(l => l !== cb);
				}),
				initRustCrypto: vi.fn().mockResolvedValue(undefined),
				setDisplayName: vi.fn().mockResolvedValue(undefined)
			};
			return { createClient: vi.fn(() => mockClient) };
		});

		localStorage.setItem('matrix_access_token', 'tok');
		localStorage.setItem('matrix_user_id', '@alice:example.com');
		localStorage.setItem('matrix_device_id', 'DEV1');

		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }));
		matrix = await import('@client/lib/services/backends/matrix');
		await matrix.init();
	});

	/** Build a minimal mock Room with a single m.call.invite event in the timeline */
	function makeRoomWithInvite({ callId = 'call-1', sender = '@bob:example.com', hungUp = false } = {}) {
		const now = Date.now();
		const inviteEvent = {
			getType: () => 'm.call.invite',
			getSender: () => sender,
			getTs: () => now - 100,
			getContent: () => ({ call_id: callId, lifetime: 60000, offer: { sdp: '' } })
		};
		const events = [inviteEvent];
		if (hungUp) {
			events.push({
				getType: () => 'm.call.hangup',
				getSender: () => sender,
				getTs: () => now,
				getContent: () => ({ call_id: callId })
			});
		}
		return {
			roomId: '!room:example.com',
			getLiveTimeline: () => ({ getEvents: () => events })
		};
	}

	it('3.1 PREPARED fires → checkPendingInvites runs and signals call invite from backfill', () => {
		mockClient.getRooms.mockReturnValue([makeRoomWithInvite()]);
		const callback = vi.fn();
		matrix.onCallSignal(callback);

		// Simulate Matrix client reconnect: fire PREPARED via the sync listener
		expect(syncListeners.length).toBeGreaterThan(0);
		syncListeners.forEach(cb => cb('PREPARED'));

		// Should have been called at least once (initial + PREPARED), but only ONE
		// unique call_id should be signalled (deduplication via signalledCallIds)
		const inviteCalls = callback.mock.calls.filter(([m]) => m.type === 'call_invite');
		expect(inviteCalls.length).toBe(1);
		expect(inviteCalls[0][0]).toMatchObject({ type: 'call_invite', room: '!room:example.com' });
	});

	it('3.2 call_id already signalled → PREPARED does NOT re-signal (deduplication)', () => {
		mockClient.getRooms.mockReturnValue([makeRoomWithInvite({ callId: 'call-dup' })]);
		const callback = vi.fn();
		matrix.onCallSignal(callback);

		// First call at registration time already signals it
		const firstCount = callback.mock.calls.filter(([m]) => m.type === 'call_invite').length;
		expect(firstCount).toBe(1);

		// Fire PREPARED multiple times (simulating multiple reconnects)
		syncListeners.forEach(cb => cb('PREPARED'));
		syncListeners.forEach(cb => cb('PREPARED'));

		const totalInvites = callback.mock.calls.filter(([m]) => m.type === 'call_invite').length;
		expect(totalInvites).toBe(1); // still only 1 — deduplicated
	});

	it('3.3 unsubscribe removes the sync listener', () => {
		const callback = vi.fn();
		// client.js also registers a 'sync' listener for _lastSyncAt tracking during init()
		const countBeforeSignal = syncListeners.length;
		const unsub = matrix.onCallSignal(callback);
		// onCallSignal adds one more sync listener
		expect(syncListeners.length).toBe(countBeforeSignal + 1);

		unsub();

		// The onCallSignal listener should be removed; client.js listener remains
		expect(syncListeners.length).toBe(countBeforeSignal);
	});
});
