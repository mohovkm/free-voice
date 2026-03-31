export function createFakeJwt(sub = 'user@test.com') {
	return `h.${Buffer.from(
		JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 3600 })
	).toString('base64')}.s`;
}

export async function installAppShell(page, options = {}) {
	const {
		sub = 'user@test.com',
		refreshToken = 'ref',
		pushPermission = 'default',
		withSubscription = false,
		initialTheme = null,
		initialLocale = null,
		profile = {
			id: '@tester:example.test',
			email: '@tester:example.test',
			display_name: 'Tester'
		},
		cacheNames = ['fv-shell-v1', 'fv-media-v1'],
		unreadCounts = {},
		contactRequests = [],
		conversations = [],
		roomPeers = {},
		dmContacts = [],
		roomMessagesByRoom = {}
	} = options;

	await page.addInitScript(
		({
			token,
			refresh,
			theme,
			locale,
			push,
			sessionProfile,
			initialCacheNames,
			initialUnreadCounts,
			initialContactRequests,
			initialConversations,
			initialRoomPeers,
			initialDmContacts,
			initialRoomMessagesByRoom
		}) => {
			localStorage.setItem('token', token);
			localStorage.setItem('refresh_token', refresh);
			localStorage.setItem('matrix_access_token', 'matrix-token');
			localStorage.setItem('matrix_user_id', sessionProfile.id);
			localStorage.setItem('matrix_device_id', 'device-1');
			localStorage.setItem('matrix_homeserver', 'https://matrix.example.test');
			if (theme && !localStorage.getItem('fv-theme')) localStorage.setItem('fv-theme', theme);
			if (locale && !localStorage.getItem('fv-lang')) localStorage.setItem('fv-lang', locale);

			window.__FV_PLAYWRIGHT_BACKEND__ = {
				enabled: true,
				profile: sessionProfile,
				unreadCounts: initialUnreadCounts,
				contactRequests: initialContactRequests,
				conversations: initialConversations,
				roomPeers: initialRoomPeers,
				dmContacts: initialDmContacts,
				roomMessagesByRoom: initialRoomMessagesByRoom
			};

			const readJson = (key, fallback) => {
				try {
					const raw = sessionStorage.getItem(key);
					return raw ? JSON.parse(raw) : fallback;
				} catch {
					return fallback;
				}
			};
			const writeJson = (key, value) => {
				sessionStorage.setItem(key, JSON.stringify(value));
			};
			const increment = (key) => {
				const next = Number(sessionStorage.getItem(key) || '0') + 1;
				sessionStorage.setItem(key, String(next));
				return next;
			};

			increment('__fv_e2e_boot_count');
			if (!sessionStorage.getItem('__fv_e2e_cache_keys')) {
				writeJson('__fv_e2e_cache_keys', initialCacheNames);
			}

			let notificationPermission =
				sessionStorage.getItem('__fv_e2e_notification_permission') || push.permission;
			let subscription =
				push.withSubscription || sessionStorage.getItem('__fv_e2e_push_has_subscription') === '1'
					? {
							endpoint: 'https://push.example.test/sub',
							toJSON() {
								return {
									endpoint: this.endpoint,
									keys: { p256dh: 'p256dh', auth: 'auth' }
								};
							},
							async unsubscribe() {
								subscription = null;
								sessionStorage.setItem('__fv_e2e_push_has_subscription', '0');
								return true;
							}
						}
					: null;

			const listeners = new Map();
			const emit = (type) => {
				for (const listener of listeners.get(type) || []) {
					increment(`__fv_e2e_sw_event_${type}`);
					listener(new Event(type));
				}
			};

			const pushManager = {
				async getSubscription() {
					return subscription;
				},
				async subscribe() {
					subscription = {
						endpoint: 'https://push.example.test/sub',
						toJSON() {
							return {
								endpoint: this.endpoint,
								keys: { p256dh: 'p256dh', auth: 'auth' }
							};
						},
						async unsubscribe() {
							subscription = null;
							sessionStorage.setItem('__fv_e2e_push_has_subscription', '0');
							return true;
						}
					};
					sessionStorage.setItem('__fv_e2e_push_has_subscription', '1');
					increment('__fv_e2e_push_subscribe_count');
					return subscription;
				}
			};

			const registration = {
				pushManager,
				async update() {},
				async unregister() {
					increment('__fv_e2e_unregister_count');
					return true;
				}
			};

			const serviceWorker = {
				ready: Promise.resolve(registration),
				async getRegistrations() {
					return [registration];
				},
				addEventListener(type, listener) {
					if (!listeners.has(type)) listeners.set(type, new Set());
					listeners.get(type).add(listener);
				},
				removeEventListener(type, listener) {
					listeners.get(type)?.delete(listener);
				}
			};

			const notificationApi = {
				async requestPermission() {
					if (notificationPermission === 'default') notificationPermission = 'granted';
					sessionStorage.setItem('__fv_e2e_notification_permission', notificationPermission);
					return notificationPermission;
				}
			};
			Object.defineProperty(notificationApi, 'permission', {
				get() {
					return notificationPermission;
				}
			});

			const cachesApi = {
				async keys() {
					return readJson('__fv_e2e_cache_keys', []);
				},
				async delete(name) {
					const keys = readJson('__fv_e2e_cache_keys', []);
					const next = keys.filter((key) => key !== name);
					writeJson('__fv_e2e_cache_keys', next);
					return next.length !== keys.length;
				}
			};

			Object.defineProperty(window, 'PushManager', {
				configurable: true,
				value: function PushManager() {}
			});
			Object.defineProperty(window, 'Notification', {
				configurable: true,
				value: notificationApi
			});
			Object.defineProperty(navigator, 'serviceWorker', {
				configurable: true,
				value: serviceWorker
			});
			Object.defineProperty(globalThis, 'caches', {
				configurable: true,
				value: cachesApi
			});

			const originalAnchorClick = HTMLAnchorElement.prototype.click;
			HTMLAnchorElement.prototype.click = function patchedClick(...args) {
				if (this.download) {
					const existing = readJson('__fv_e2e_downloads', []);
					existing.push({ href: this.href, download: this.download });
					writeJson('__fv_e2e_downloads', existing);
				}
				return originalAnchorClick.apply(this, args);
			};

			window.__fvE2E = {
				dispatchServiceWorkerControllerChange() {
					emit('controllerchange');
				},
				getBootCount() {
					return Number(sessionStorage.getItem('__fv_e2e_boot_count') || '0');
				},
				getCacheKeys() {
					return readJson('__fv_e2e_cache_keys', []);
				},
				getUnregisterCount() {
					return Number(sessionStorage.getItem('__fv_e2e_unregister_count') || '0');
				},
				getServiceWorkerEventCount(type) {
					return Number(sessionStorage.getItem(`__fv_e2e_sw_event_${type}`) || '0');
				},
				getServiceWorkerListenerCount(type) {
					return listeners.get(type)?.size || 0;
				},
				getDownloads() {
					return readJson('__fv_e2e_downloads', []);
				},
				getSentMedia() {
					return readJson('__fv_e2e_sent_media', []);
				}
			};
		},
		{
			token: createFakeJwt(sub),
			refresh: refreshToken,
			theme: initialTheme,
			locale: initialLocale,
			push: {
				permission: pushPermission,
				withSubscription
			},
			sessionProfile: profile,
			initialCacheNames: cacheNames,
			initialUnreadCounts: unreadCounts,
			initialContactRequests: contactRequests,
			initialConversations: conversations,
			initialRoomPeers: roomPeers,
			initialDmContacts: dmContacts,
			initialRoomMessagesByRoom: roomMessagesByRoom
		}
	);
}

export function matrixMediaUrl(mxcUrl) {
	if (!mxcUrl?.startsWith('mxc://')) return mxcUrl;
	const withoutScheme = mxcUrl.slice('mxc://'.length);
	const slashIndex = withoutScheme.indexOf('/');
	const server = withoutScheme.slice(0, slashIndex);
	const mediaId = withoutScheme.slice(slashIndex + 1);
	return `https://matrix.example.test/_matrix/media/v3/download/${server}/${mediaId}`;
}

export async function installRoomScenario(
	page,
	{
		roomId = '!room:example.test',
		roomName = 'Alice',
		roomRole = 'member',
		roomMessages = [],
		roomMembers = null
	} = {}
) {
	await installAppShell(page, {
		conversations: [
			{
				roomId,
				name: roomName,
				lastActiveTs: Date.now(),
				lastMessage: { text: 'Media room', msgtype: 'm.text' }
			}
		],
		roomPeers: {
			[roomId]: {
				name: roomName,
				userId: '@alice:example.test'
			}
		},
		dmContacts: [
			{
				roomId,
				email: '@alice:example.test',
				display_name: roomName,
				status: 'accepted'
			}
		],
		roomMessagesByRoom: {
			[roomId]: roomMessages
		}
	});

	const members =
		roomMembers ??
		[
			{ id: '@tester:example.test', display_name: 'Tester' },
			{ id: '@alice:example.test', display_name: roomName }
		];
	await page.route('**/api/rooms/**', async (route) => {
		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ members, role: roomRole, active_call: null })
		});
	});
	await page.route('**/api/push/config', async (route) => {
		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				vapid_public_key: 'AQAB',
				sygnal_url: 'https://sygnal.example.test/_matrix/push/v1/notify',
				app_id: 'freevoice.test'
			})
		});
	});
	await page.route('**/api/push/subscribe', async (route) => {
		return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
	});
}

export async function setLoggedInSession(page, { sub = 'user@test.com', refreshToken = 'ref' } = {}) {
	const token = createFakeJwt(sub);
	await page.addInitScript(
		({ accessToken, refresh }) => {
			localStorage.setItem('token', accessToken);
			localStorage.setItem('refresh_token', refresh);
		},
		{ accessToken: token, refresh: refreshToken }
	);
	return token;
}

export async function installPushEnvironment(
	page,
	{ permission = 'default', withSubscription = false } = {}
) {
	await page.addInitScript(
		({ initialPermission, initialSubscription }) => {
			let subscription = initialSubscription
				? {
						endpoint: 'https://push.example.test/sub',
						toJSON() {
							return {
								endpoint: this.endpoint,
								keys: { p256dh: 'p256dh', auth: 'auth' }
							};
						},
						async unsubscribe() {
							subscription = null;
							return true;
						}
					}
				: null;

			const pushManager = {
				async getSubscription() {
					return subscription;
				},
				async subscribe() {
					subscription = {
						endpoint: 'https://push.example.test/sub',
						toJSON() {
							return {
								endpoint: this.endpoint,
								keys: { p256dh: 'p256dh', auth: 'auth' }
							};
						},
						async unsubscribe() {
							subscription = null;
							return true;
						}
					};
					return subscription;
				}
			};

			const registration = {
				pushManager,
				async update() {},
				async unregister() {
					return true;
				}
			};

			Object.defineProperty(window, 'PushManager', {
				configurable: true,
				value: function PushManager() {}
			});
			Object.defineProperty(window, 'Notification', {
				configurable: true,
				value: {
					permission: initialPermission,
					requestPermission: async () => {
						if (initialPermission === 'default') {
							return 'granted';
						}
						return initialPermission;
					}
				}
			});
			Object.defineProperty(navigator, 'serviceWorker', {
				configurable: true,
				value: {
					ready: Promise.resolve(registration),
					getRegistrations: async () => [registration]
				}
			});
		},
		{ initialPermission: permission, initialSubscription: withSubscription }
	);
}
