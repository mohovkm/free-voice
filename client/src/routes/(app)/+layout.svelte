<script>
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { loggedIn } from '$lib/stores/auth';
	import { backend } from '$lib/services/activeBackend';
	import { ensureFreshToken } from '$lib/services/auth';
	import { t } from '$lib/stores/i18n';
	import { refreshRequestCount } from '$lib/stores/contactRequests';
	import { clearUnread, totalUnread, loadUnread, incrementUnread, activeRoomId } from '$lib/stores/unread';
	import { subscribePush } from '$lib/services/push';
	import BottomNav from '$lib/components/BottomNav.svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import { startPresenceTracking } from '$lib/stores/presence';
	import { ClientEventType } from '$lib/types/events';

	const PUSH_DB_NAME = 'fv-push';
	const NAV_STORE = 'nav';
	const CALL_STORE = 'call';
	const PENDING_CALL_KEY = 'pending';

	// Update app badge whenever totalUnread changes
	$: if (typeof navigator !== 'undefined' && 'setAppBadge' in navigator) {
		$totalUnread > 0 ? navigator.setAppBadge($totalUnread) : navigator.clearAppBadge();
	}

	// Clear unread for the currently open chat and track active room
	$: {
		const m = $page.params;
		const roomId = m?.id ? decodeURIComponent(m.id) : m?.room ? decodeURIComponent(m.room) : null;
		activeRoomId.set(roomId);
		if (m?.email) clearUnread(decodeURIComponent(m.email));
		if (roomId) clearUnread(roomId);
	}

	$: hideBottomNav =
		$page.url.pathname.startsWith('/room/') || $page.url.pathname.startsWith('/call/');

	// Set to true after backend.init() completes (crypto + first sync done).
	// Used by E2E tests to wait for the backend to be ready before asserting UI state.
	let matrixReady = false;
	// Set to true when backend.init() rejects — shows error + retry instead of
	// a permanent spinner (SR-3).
	let initError = false;
	let hideBottomNav = false;

	onMount(async () => {
		if (!$loggedIn) {
			goto(resolve('/login'));
			return;
		}

		// On PWA cold launch (no referrer), always start at home
		if (!document.referrer && window.location.pathname !== '/') {
			goto(resolve('/'), { replaceState: true });
		}

		backend.setAuthErrorHandler(() => {
			goto(resolve('/login'));
		});

		// ── Incoming-call detection via IDB polling ──────────────────────────
		// On iOS, visibilitychange / pageshow / SW postMessage are all unreliable
		// when the app returns from the background via a notification tap.
		// Polling IndexedDB every second is the most robust pattern: the SW writes
		// the call record before showing the notification, and the UI keeps reading
		// until it finds something or the 2-minute window expires.
		//
		// Guards:
		//  - 800ms IDB timeout prevents post-resume WebKit stalls from freezing the loop
		//  - watchdog reload is suppressed while the poll is active
		//  - deduplication via Set prevents re-handling the same call on repeated polls

		// Peek at the pending call record without deleting it (readonly, with stall guard)
		function _peekPendingCall() {
			return Promise.race([
				new Promise((res) => {
					const req = indexedDB.open(PUSH_DB_NAME, 1);
					req.onupgradeneeded = (e) => {
						const db = e.target.result;
						if (!db.objectStoreNames.contains(NAV_STORE)) db.createObjectStore(NAV_STORE);
						if (!db.objectStoreNames.contains(CALL_STORE)) db.createObjectStore(CALL_STORE);
					};
					req.onsuccess = (e) => {
						const db = e.target.result;
						if (!db.objectStoreNames.contains(CALL_STORE)) { res(null); return; }
						const tx = db.transaction(CALL_STORE, 'readonly');
						const get = tx.objectStore(CALL_STORE).get(PENDING_CALL_KEY);
						get.onsuccess = () => res(get.result || null);
						get.onerror = () => res(null);
					};
					req.onerror = () => res(null);
				}),
				new Promise((res) => setTimeout(() => res(null), 800))
			]);
		}

		// Delete the pending record — called after we've decided to handle the call
		function _deletePendingCall() {
			const req = indexedDB.open(PUSH_DB_NAME, 1);
			req.onsuccess = (e) => {
				const db = e.target.result;
				if (!db.objectStoreNames.contains(CALL_STORE)) return;
				db.transaction(CALL_STORE, 'readwrite').objectStore(CALL_STORE).delete(PENDING_CALL_KEY);
			};
		}

		let _callPollInterval = null;
		let _callPollDeadline = 0;
		const _handledCallKeys = new Set();

		function startCallPolling() {
			// Restart with a fresh 2-minute window on every foreground return
			if (_callPollInterval) clearInterval(_callPollInterval);
			_callPollDeadline = Date.now() + 120_000;
			_callPollInterval = setInterval(async () => {
				if (Date.now() > _callPollDeadline) {
					clearInterval(_callPollInterval);
					_callPollInterval = null;
					return;
				}
				let call;
				try { call = await _peekPendingCall(); } catch { return; }
				if (!call || !call.room_id) return;
				if (Date.now() - call.ts > 120_000) {
					_deletePendingCall();
					clearInterval(_callPollInterval);
					_callPollInterval = null;
					return;
				}
				const key = `${call.room_id}:${call.ts}`;
				if (_handledCallKeys.has(key)) return;
				_handledCallKeys.add(key);
				_deletePendingCall();
				if ($page.url.pathname.startsWith('/call/incoming')) return;
				backend.notify({
					type: ClientEventType.CALL_INVITE,
					room: call.room_id,
					caller_name: call.from || '',
					caller_email: '',
					video: call.video ?? true
				});
				goto(resolve(
					`/call/incoming/${encodeURIComponent(call.room_id)}?name=${encodeURIComponent(call.from || '')}&video=${call.video ? 1 : 0}`
				));
			}, 1000);
		}

		// Start polling before backend.init() so cold-start detection doesn't wait
		// for the full Matrix sync (~30s on a fresh device).
		startCallPolling();

		// Init backend (handles token refresh + WS/Matrix connect internally).
		// This awaits Rust crypto init + first Matrix sync — may take up to ~30s on
		// a fresh device (WASM download + IndexedDB creation); subsequent loads are fast.
		try {
			await backend.init();
		} catch (err) {
			console.error('[layout] backend.init() failed:', err);
			initError = true;
			return;
		}
		matrixReady = true;

		const stopPresence = startPresenceTracking();
		refreshRequestCount();

		const unsubConversations = backend.onConversationsChanged(() => refreshRequestCount());
		const unsubUnread = (await loadUnread()) || (() => {});

		// Subscribe push after Matrix init so getAccessToken() is available
		subscribePush();

		// Handle push notification click — read pending nav URL stored by SW (WebKit bug 263687)
		new Promise((res) => {
			const req = indexedDB.open(PUSH_DB_NAME, 1);
			req.onupgradeneeded = (e) => e.target.result.createObjectStore(NAV_STORE);
			req.onsuccess = (e) => {
				const db = e.target.result;
				const tx = db.transaction(NAV_STORE, 'readwrite');
				const store = tx.objectStore(NAV_STORE);
				const get = store.get(PENDING_CALL_KEY);
				get.onsuccess = () => {
					if (get.result) {
						store.delete(PENDING_CALL_KEY);
						res(get.result);
					} else res(null);
				};
				get.onerror = () => res(null);
			};
			req.onerror = () => res(null);
		}).then((url) => {
			if (url) goto(resolve(url));
		});

		// Periodic background refresh every 10 minutes
		const refreshInterval = setInterval(() => ensureFreshToken(), 10 * 60 * 1000);

		const unsubCall = backend.onCallSignal((msg) => {
			if (msg.type === ClientEventType.CALL_INVITE) {
				backend.notify(msg);
				goto(
					resolve(
						`/call/incoming/${encodeURIComponent(msg.room)}?caller=${encodeURIComponent(msg.caller_email)}&name=${encodeURIComponent(msg.caller_name)}&video=${msg.video ?? 1}`
					)
				);
			}
			if (msg.type === ClientEventType.ROOM_CALL_INVITE) {
				const action = backend.notify(msg);
				if (action?.navigateTo) goto(resolve(action.navigateTo));
			}
			if (
				msg.type === ClientEventType.ROOM_CALL_UPDATED ||
				msg.type === ClientEventType.ROOM_CALL_ENDED
			) {
				const action = backend.notify(msg);
				if (action?.navigateTo) goto(resolve(action.navigateTo));
			}
			if (
				msg.type === ClientEventType.CALL_DECLINE ||
				msg.type === ClientEventType.CALL_CANCEL ||
				msg.type === ClientEventType.CALL_ANSWERED ||
				msg.type === ClientEventType.CALL_ENDED
			) {
				backend.notify(msg);
			}
		});

		const unsubMsg = backend.onMessage((msg) => {
			if (
				msg.type === ClientEventType.CONTACT_REQUEST ||
				msg.type === ClientEventType.CONTACT_ACCEPTED
			) {
				refreshRequestCount();
			}
			if (msg.type === ClientEventType.MESSAGE) {
				if (msg.sender_email) {
					// Legacy mode: key unread by sender email
					const currentEmail = $page.params?.email;
					if (!currentEmail || decodeURIComponent(currentEmail) !== msg.sender_email) {
						incrementUnread(msg.sender_email);
					}
				}
				// Matrix mode: unread counts are owned exclusively by the getUnreadCounts()
				// subscription set up by loadUnread() (full-replace on Room.timeline/receipt).
				// Calling incrementUnread() here would race with that subscription and cause
				// badge flicker or silent zeroing (CR-4, SR-1).
			}
		});

		// Reconnect after iOS background freeze
		function handleVisibilityChange() {
			if (document.visibilityState === 'hidden') {
				backend.handleHide?.(); // record timestamp for freeze detection
			} else if (document.visibilityState === 'visible') {
				backend.reconnectIfNeeded?.();
				backend.resumeAudio?.(); // restore iOS AudioContext killed on background
				subscribePush(); // re-register push in case subscription expired
				startCallPolling(); // restart poll with fresh 2-min window on foreground return
			}
		}
		// pagehide fires before visibilitychange:hidden on iOS — belt-and-suspenders
		function handlePageHide() {
			backend.handleHide?.();
		}
		function handlePageShow(e) {
			if (e.persisted) {
				backend.reconnectIfNeeded?.();
				subscribePush();
				startCallPolling(); // restart poll on bfcache restore
			}
		}
		// Restart sync when network comes back (covers offline → online transitions)
		function handleOnline() {
			backend.reconnectIfNeeded?.();
		}
		// Periodic health-check: catches sync death while app is in foreground
		// (e.g. network switch, server restart) without requiring a hide/show cycle
		const healthCheckInterval = setInterval(() => backend.reconnectIfNeeded?.(), 30_000);

		// Watchdog: ticks every 5s. On resume after iOS suspension the gap between ticks
		// reflects actual frozen time. If >= 3 min → zombie state → hard reload.
		// For shorter gaps (>= 5s) → soft reconnect + 20s verify → reload if still stale.
		// Reload is suppressed while the call-detection poll is active to prevent a race
		// where the watchdog kills the page before the poll detects the incoming call.
		const reload = () => {
			if (_callPollInterval) return;
			location.reload();
		};
		const watchdogInterval = setInterval(() => backend.reconnectOrReload?.(reload), 5_000);

		// When a new SW activates (new deploy), reload immediately so users run fresh assets.
		if (navigator.serviceWorker) {
			navigator.serviceWorker.addEventListener('controllerchange', reload);
		}

		// Foreground staleness check: if sync hasn't fired in > 3 min while the app is
		// visible (no hide/show cycle), the sync loop silently died → hard reload.
		const foregroundStaleInterval = setInterval(() => {
			if (document.visibilityState === 'visible') backend.reconnectOrReload?.(reload);
		}, 60_000);

		document.addEventListener('visibilitychange', handleVisibilityChange);
		window.addEventListener('pagehide', handlePageHide);
		window.addEventListener('pageshow', handlePageShow);
		window.addEventListener('online', handleOnline);

		return () => {
			unsubCall();
			unsubMsg();
			unsubConversations();
			unsubUnread();
			stopPresence();
			backend.destroy();
			clearInterval(refreshInterval);
			clearInterval(healthCheckInterval);
			clearInterval(watchdogInterval);
			clearInterval(foregroundStaleInterval);
			if (_callPollInterval) clearInterval(_callPollInterval);
			document.removeEventListener('visibilitychange', handleVisibilityChange);
			window.removeEventListener('pagehide', handlePageHide);
			window.removeEventListener('pageshow', handlePageShow);
			window.removeEventListener('online', handleOnline);
		};
	});
</script>

{#if $loggedIn}
	{#if initError}
		<div class="app-loading">
			<p class="loading-title">{$t('appLoadingFailed')}</p>
			<button class="btn-retry" on:click={() => location.reload()}>{$t('retry')}</button>
		</div>
	{:else if !matrixReady}
		<div class="app-loading">
			<span class="spinner"></span>
			<p class="loading-title">{$t('appLoading')}</p>
			<p class="loading-hint">{$t('appLoadingHint')}</p>
		</div>
	{:else}
		<div class="app-shell" data-matrix-ready>
			<Sidebar />
			<main
				class="app-main"
				class:immersive-main={hideBottomNav}
			>
				<slot />
			</main>
			{#if !hideBottomNav}
				<BottomNav />
			{/if}
		</div>
	{/if}
{/if}

<style>
	.app-loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		height: 100dvh;
		height: 100vh;
		padding: 24px;
		text-align: center;
	}
	.loading-title {
		font-size: 1rem;
		font-weight: 500;
		color: var(--text-primary);
		margin: 0;
	}
	.loading-hint {
		font-size: 0.8125rem;
		color: var(--text-muted);
		margin: 0;
	}
	.btn-retry {
		padding: 8px 20px;
		border-radius: 6px;
		border: 1px solid var(--border, #ccc);
		background: var(--surface, #fff);
		color: var(--text-primary);
		font-size: 0.9375rem;
		cursor: pointer;
	}
	.spinner {
		width: 36px;
		height: 36px;
		border: 3px solid var(--border, #ccc);
		border-top-color: var(--primary, #4f8ef7);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.app-shell {
		display: flex;
		flex-direction: column;
		height: 100dvh;
		height: 100vh;
		padding-top: env(safe-area-inset-top);
	}
	.app-main {
		flex: 1;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
	}

	.app-main.immersive-main {
		overflow: hidden;
		min-height: 0;
	}

	@media (min-width: 768px) {
		.app-shell {
			flex-direction: row;
		}
		.app-main {
			height: 100dvh;
			height: 100vh;
		}
	}
</style>
