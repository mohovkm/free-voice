import * as sdk from 'matrix-js-sdk';
import { resetStore as resetMatrixStore } from '../../../stores/matrixStore';
import {
	clearSession,
	getHomeserver,
	loadSession,
	requestCompat as _request,
	saveSession
} from './clientSession';
import { setOnlinePresence, START_CLIENT_OPTIONS } from './clientSync';
import { MatrixSyncState, type MatrixClientLike } from '$lib/types/matrixSdk';

export { clearSession, getHomeserver, loadSession, saveSession, _request };

export let _client: MatrixClientLike | null = null;
export let _cryptoInitPromise: Promise<void> | null = null;
export let _authErrorHandler: (() => void) | null = null;
export let _contactsBootstrapped = false;

export const _pendingConversationListeners: Array<() => void> = [];
export let _processedEventIds = new Set<string>();

let _initPromise: Promise<void> | null = null;

const FREEZE_THRESHOLD_MS = 5_000;
const SYNC_STALE_MS = 60_000;
const HARD_RELOAD_THRESHOLD_MS = 180_000;
const FOREGROUND_STALE_MS = 180_000;

export let _backgroundedAt: number | null = null;
export let _lastSyncAt: number | null = null;

function createMatrixClient(config: Record<string, unknown>): MatrixClientLike {
	return sdk.createClient(
		config as unknown as Parameters<typeof sdk.createClient>[0]
	) as unknown as MatrixClientLike;
}

export function _setClient(client: MatrixClientLike | null): void {
	_client = client;
}

export function _setCryptoInitPromise(promise: Promise<void> | null): void {
	_cryptoInitPromise = promise;
}

export function _setContactsBootstrapped(value: boolean): void {
	_contactsBootstrapped = value;
}

export function _resetProcessedEventIds(): void {
	_processedEventIds = new Set<string>();
}

export function _setLastSyncAt(value: number | null): void {
	_lastSyncAt = value;
}

export function _isDirectMatrixUserId(input: string): boolean {
	const trimmed = input.trim();
	return trimmed.startsWith('@') && trimmed.includes(':');
}

export function _beginCryptoInit(client: MatrixClientLike): Promise<void> {
	if (_cryptoInitPromise) return _cryptoInitPromise;
	_cryptoInitPromise = (async () => {
		try {
			await client.initRustCrypto();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (!message.includes("account in the store doesn't match")) throw error;
			await client.clearStores();
			await client.initRustCrypto();
		}
	})();
	return _cryptoInitPromise;
}

export function init(): Promise<void> {
	if (_initPromise) return _initPromise;

	_initPromise = (async () => {
		if (!_client) {
			const { accessToken, userId, deviceId } = loadSession();
			if (!accessToken || !userId || !deviceId) {
				_authErrorHandler?.();
				return;
			}
			_client = createMatrixClient({
				baseUrl: getHomeserver(),
				accessToken,
				userId,
				deviceId
			});
		}

		await _beginCryptoInit(_client);
		_client.on('sync', () => {
			_lastSyncAt = Date.now();
		});

		await new Promise<void>((resolve, reject) => {
			_client?.once('sync', (state: string) => {
				if (state === MatrixSyncState.PREPARED || state === MatrixSyncState.SYNCING) {
					resolve();
					return;
				}
				reject(new Error(`Matrix sync failed: ${state}`));
			});
			_client?.startClient(START_CLIENT_OPTIONS);
		});

		setOnlinePresence(_client);
		const { _bootstrapAcceptedContacts } = await import('./contacts');
		await _bootstrapAcceptedContacts();

		const pendingToFlush = _pendingConversationListeners.splice(0);
		for (const emit of pendingToFlush) {
			_client.on('Room.timeline', emit);
			_client.on('Room', emit);
			_client.on('RoomMember.membership', emit);
			emit();
		}
	})();

	_initPromise.finally(() => {
		_initPromise = null;
	});
	return _initPromise;
}

export function destroy(): void {
	_client?.stopClient();
	_contactsBootstrapped = false;
	resetMatrixStore();
}

export function handleHide(): void {
	_backgroundedAt = Date.now();
}

export function reconnectIfNeeded(): void {
	if (!_client) return;
	const state = _client.getSyncState();

	if (state === MatrixSyncState.SYNCING) {
		const elapsed = _backgroundedAt !== null ? Date.now() - _backgroundedAt : 0;
		const isFrozenByBackground = _backgroundedAt !== null && elapsed >= FREEZE_THRESHOLD_MS;
		const isSyncStale = _lastSyncAt !== null && Date.now() - _lastSyncAt > SYNC_STALE_MS;
		_backgroundedAt = null;
		if (isFrozenByBackground || isSyncStale) {
			console.info(
				'[matrix] force-restarting frozen/stale sync, elapsed:',
				elapsed,
				'lastSyncAge:',
				_lastSyncAt ? Date.now() - _lastSyncAt : 'n/a'
			);
			_client.stopClient();
			_client.startClient(START_CLIENT_OPTIONS);
			setOnlinePresence(_client);
		}
		return;
	}

	_backgroundedAt = null;
	if (state === MatrixSyncState.STOPPED || state === MatrixSyncState.ERROR || state === null) {
		console.info('[matrix] restarting dead sync loop, state:', state);
		_client.startClient(START_CLIENT_OPTIONS);
		setOnlinePresence(_client);
	}
}

export function reconnectOrReload(reloadFn: () => void = () => location.reload()): void {
	if (!_client) return;

	const now = Date.now();
	const gap = _backgroundedAt !== null ? now - _backgroundedAt : 0;
	_backgroundedAt = null;

	if (gap >= HARD_RELOAD_THRESHOLD_MS) {
		console.info('[matrix] watchdog: long background freeze detected, elapsed:', gap, '— reloading');
		reloadFn();
		return;
	}

	const state = _client.getSyncState();
	if (gap >= FREEZE_THRESHOLD_MS) {
		console.info(
			'[matrix] watchdog: medium background freeze, attempting soft reconnect, elapsed:',
			gap
		);
		const reconnectAt = now;
		if (state === MatrixSyncState.SYNCING) {
			_client.stopClient();
		}
		_client.startClient(START_CLIENT_OPTIONS);
		setOnlinePresence(_client);
		setTimeout(() => {
			if (_lastSyncAt === null || _lastSyncAt < reconnectAt) {
				console.info('[matrix] watchdog: sync did not recover after reconnect — reloading');
				reloadFn();
			}
		}, 20_000);
		return;
	}

	if (_lastSyncAt !== null && now - _lastSyncAt > FOREGROUND_STALE_MS) {
		console.info('[matrix] watchdog: foreground sync stale, age:', now - _lastSyncAt, '— reloading');
		reloadFn();
	}
}

export function getUserId(): string | null {
	return _client?.getUserId() ?? null;
}

export function getAccessToken(): string | null {
	return _client?.getAccessToken() ?? null;
}

export function getMediaUrl(mxcUrl: string): string | null {
	if (!mxcUrl || !_client) return null;
	return _client.mxcUrlToHttp(mxcUrl) ?? null;
}

export function setAuthErrorHandler(callback: (() => void) | null): void {
	_authErrorHandler = callback;
}
