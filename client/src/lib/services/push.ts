/** push.ts — Web Push subscription + Dendrite pusher registration via Sygnal */

interface PushConfig {
	vapid_public_key?: string;
	sygnal_url?: string;
	app_id?: string;
}

interface PushSubscriptionJson {
	endpoint?: string;
	keys?: {
		p256dh?: string;
		auth?: string;
	};
}

interface MatrixPusherSummary {
	app_id?: string;
	pushkey?: string;
}

let _lastPushkey: string | null = null; // track last registered pushkey to avoid redundant re-registration

export async function subscribePush(): Promise<void> {
	if (
		typeof window === 'undefined' ||
		typeof navigator === 'undefined' ||
		typeof Notification === 'undefined' ||
		!('serviceWorker' in navigator) ||
		!('PushManager' in window)
	) {
		return;
	}

	try {
		if (Notification.permission === 'default') {
			const perm = await Notification.requestPermission();
			if (perm !== 'granted') {
				console.warn('[push] permission not granted:', perm);
				return;
			}
		}
		if (Notification.permission !== 'granted') return;

		// Fetch push config (VAPID public key, Sygnal URL, app_id)
		const cfgResp = await fetch('/api/push/config');
		if (!cfgResp.ok) throw new Error(`push config: ${cfgResp.status}`);
		const pushConfig = (await cfgResp.json()) as PushConfig;
		if (!pushConfig.vapid_public_key || !pushConfig.sygnal_url || !pushConfig.app_id) return;

		const registration = await navigator.serviceWorker.ready;
		let subscription = await registration.pushManager.getSubscription();

		// Only re-subscribe if we don't have a valid subscription
		if (!subscription) {
			subscription = await registration.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: _urlBase64ToUint8Array(
					pushConfig.vapid_public_key
				) as BufferSource
			});
		}

		const json = subscription.toJSON() as PushSubscriptionJson;
		const pushkey = json.keys?.p256dh;
		const auth = json.keys?.auth;
		const endpoint = json.endpoint;
		if (!pushkey || !auth || !endpoint) return;

		// Skip if already registered with this exact pushkey
		if (_lastPushkey === pushkey) return;

		const { getAccessToken } = await import('./backends/matrix');
		const token = getAccessToken() || localStorage.getItem('matrix_access_token');
		if (!token) return;

		const homeserver = localStorage.getItem('matrix_homeserver');
		if (!homeserver) return;

		// Delete all existing pushers for this app_id first to avoid stale accumulation
		await _deleteAllPushers(homeserver, token, pushConfig.app_id);

		// Register the new pusher
		const pusherResp = await fetch(`${homeserver}/_matrix/client/v3/pushers/set`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({
				kind: 'http',
				app_id: pushConfig.app_id,
				app_display_name: 'FREE VOICE',
				device_display_name: navigator.userAgent.slice(0, 64),
				pushkey,
				lang: navigator.language || 'en',
				data: {
					url: pushConfig.sygnal_url,
					endpoint,
					auth,
					lang: localStorage.getItem('fv-lang') || navigator.language?.slice(0, 2) || 'en'
				}
			})
		});
		if (!pusherResp.ok) throw new Error(`pushers/set: ${pusherResp.status}`);

		// Register with our API so the gateway can identify device owners for sender-skip
		await fetch('/api/push/subscribe', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({ endpoint, keys: { p256dh: pushkey, auth } })
		});
		_lastPushkey = pushkey;
	} catch (error) {
		console.warn('[push] subscribePush failed:', error);
	}
}

async function _deleteAllPushers(homeserver: string, token: string, appId: string): Promise<void> {
	try {
		const resp = await fetch(`${homeserver}/_matrix/client/v3/pushers`, {
			headers: { Authorization: `Bearer ${token}` }
		});
		if (!resp.ok) return;
		const payload = (await resp.json()) as { pushers?: MatrixPusherSummary[] };
		const stale = (payload.pushers ?? []).filter((pusher) => pusher.app_id === appId);
		await Promise.all(
			stale.map((pusher) =>
				fetch(`${homeserver}/_matrix/client/v3/pushers/set`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
					body: JSON.stringify({ kind: null, app_id: pusher.app_id, pushkey: pusher.pushkey })
				}).catch(() => {})
			)
		);
	} catch (error) {
		console.warn('[push] _deleteAllPushers failed:', error);
	}
}

function _urlBase64ToUint8Array(base64String: string): Uint8Array {
	const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
	const raw = atob(base64);
	const arr = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
	return arr;
}
