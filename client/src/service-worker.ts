/// <reference types="@sveltejs/kit" />
import { build, files, version } from '$service-worker';

declare const self: ServiceWorkerGlobalScope;

const CACHE = `fv-${version}`;
const ASSETS = [...build, ...files];

// Race a network fetch against a timeout. Rejects with an error on timeout.
function fetchWithTimeout(request: RequestInfo | URL, ms: number): Promise<Response> {
	return Promise.race([
		fetch(request),
		new Promise<Response>((_, reject) => setTimeout(() => reject(new Error('sw-timeout')), ms))
	]);
}

self.addEventListener('install', (event: ExtendableEvent) => {
	event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
	self.skipWaiting();
});

self.addEventListener('activate', (event: ExtendableEvent) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
	);
	self.clients.claim();
});

self.addEventListener('fetch', (event: FetchEvent) => {
	const url = new URL(event.request.url);

	// Network-first for API calls (no timeout — server latency is unbounded by design)
	if (url.pathname.startsWith('/api/')) {
		event.respondWith(
			fetch(event.request).catch(
				() =>
					new Response(JSON.stringify({ detail: 'Offline' }), {
						status: 503,
						headers: { 'Content-Type': 'application/json' }
					})
			)
		);
		return;
	}

	// Cache-first for build assets (content-hashed).
	// Fall back to network with timeout; if both fail return a 404 so the SW never
	// emits an unhandled rejection. Timeout prevents hung fetches after iOS resume.
	if (url.pathname.startsWith('/_app/')) {
		event.respondWith(
			caches
				.match(event.request)
				.then(
					(r) => r || fetchWithTimeout(event.request, 4_000).catch(() => new Response('Not found', { status: 404 }))
				)
		);
		return;
	}

	// SPA navigation: try network with timeout; fall back to cached index.html; 504 if missing.
	if (event.request.mode === 'navigate') {
		event.respondWith(
			fetchWithTimeout(event.request, 4_000).catch(() =>
				caches.match('/index.html').then(
					(r) => r || new Response('Gateway Timeout', { status: 504 })
				)
			)
		);
		return;
	}

	// Default: cache-first (serves ASSETS like icons/manifest cached at install),
	// falling back to plain network. No SW cache.put on the fallback path —
	// media files (video, audio) are cached in IndexedDB by mediaCache, and
	// cloning the response stream for cache.put causes body-lock bugs on iOS/WebKit
	// when fetchCachedMedia concurrently reads the original body via response.blob().
	event.respondWith(
		caches.match(event.request).then(
			(r) =>
				r ||
				fetch(event.request).catch(
					() =>
						new Response('Service Unavailable', {
							status: 503,
							headers: { 'Content-Type': 'text/plain' }
						})
				)
		)
	);
});

interface NotificationTargetPayload {
	kind?: string;
	room_id?: string;
}

interface PushPayload {
	type?: string;
	title?: string;
	body?: string;
	preview?: string;
	room_id?: string;
	from?: string;
	video?: boolean;
	target?: NotificationTargetPayload;
}

function buildNotificationBody(data: PushPayload): string {
	return data?.preview || data?.body || '';
}

function buildNotificationUrl(data: PushPayload): string {
	const target = data?.target || {};
	if (target.kind === 'root') return '/';
	if (data?.type === 'chat' && target.kind === 'room' && target.room_id) {
		return `/room/${encodeURIComponent(target.room_id)}`;
	}
	return '/';
}

// Push notifications
self.addEventListener('push', (event: PushEvent) => {
	let data: PushPayload = {};
	try {
		data = (event.data?.json() as PushPayload) ?? {};
	} catch (err) {
		console.warn(err);
	}
	const body = buildNotificationBody(data);
	const url = buildNotificationUrl(data);

	// For call pushes, store the call data in IndexedDB so the app can
	// show the incoming call UI even if the m.call.invite event isn't
	// in the SDK timeline (initialSyncLimit: 1 may not include it).
	const storePromise = data.type === 'call' && data.room_id
		? storePendingCall(data)
		: Promise.resolve();

	event.waitUntil(
		storePromise.then(() =>
			self.registration.showNotification(data.title || 'FREE VOICE', {
				body,
				icon: '/icon-192.png',
				badge: '/icon-192.png',
				data: { url, pushData: data }
			})
		)
	);
});

function storePendingCall(data: PushPayload): Promise<void> {
	return new Promise((resolve) => {
		const req = indexedDB.open('fv-push', 1);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains('nav')) db.createObjectStore('nav');
			if (!db.objectStoreNames.contains('call')) db.createObjectStore('call');
		};
		req.onsuccess = () => {
			try {
				const db = req.result;
				if (!db.objectStoreNames.contains('call')) { resolve(); return; }
				const tx = db.transaction('call', 'readwrite');
				tx.objectStore('call').put({
					room_id: data.room_id,
					from: data.from,
					video: data.video ?? true,
					ts: Date.now()
				}, 'pending');
				tx.oncomplete = () => resolve();
				tx.onerror = () => resolve();
			} catch { resolve(); }
		};
		req.onerror = () => resolve();
	});
}

self.addEventListener('notificationclick', (event: NotificationEvent) => {
	event.notification.close();
	const path = event.notification.data?.url || '/';
	const url = self.location.origin + path;

	event.waitUntil((async () => {
		// Bring the existing PWA window to the foreground so the 1s IDB polling
		// loop (started in +layout.svelte before backend.init()) can detect the
		// pending call record. If the app is not open, launch it — onMount starts
		// the poll before backend.init() so cold-start detection is also fast.
		const allClients = await self.clients.matchAll({ type: 'window' });
		const pwClient = allClients.find(c => c.url.startsWith(self.location.origin));
		if (pwClient) {
			// For root target (calls/contacts) just focus — call detection reads from IndexedDB.
			// For room targets navigate to the specific room without disrupting an active call.
			if (path !== '/') await pwClient.navigate(url);
			await pwClient.focus();
			return;
		}
		await self.clients.openWindow(url);
	})());
});
