import * as sdk from 'matrix-js-sdk';
import { resetStore as resetMatrixStore } from '../../../stores/matrixStore';
import {
	_client,
	_request,
	_isDirectMatrixUserId,
	_beginCryptoInit,
	_setClient,
	_setCryptoInitPromise,
	_setContactsBootstrapped,
	_resetProcessedEventIds,
	getHomeserver,
	saveSession,
	clearSession
} from './client';
import { _resetReadReceiptTracking } from './messaging';
import type {
	MatrixClientLike,
	MatrixLoginResponse,
	MatrixRegisterResponse,
	MatrixUiAuthError
} from '$lib/types/matrixSdk';

interface CompatLoginResponse extends MatrixLoginResponse {
	status?: string;
	homeserver?: string;
}

function createMatrixClient(config: Record<string, unknown>): MatrixClientLike {
	return sdk.createClient(
		config as unknown as Parameters<typeof sdk.createClient>[0]
	) as unknown as MatrixClientLike;
}

export async function login(
	user: string,
	password: string
): Promise<{ access_token: string; user_id: string }> {
	if (!_isDirectMatrixUserId(user)) {
		let response: CompatLoginResponse | null | undefined;
		try {
			response = await _request<CompatLoginResponse>('POST', '/auth/matrix-login', { email: user, password });
		} catch (error) {
			const err = error as Error & { status?: number };
			if (err.status === 401 && !user.includes('@')) {
				user = `@${user}:${new URL(getHomeserver()).hostname}`;
			} else {
				throw error;
			}
		}

		if (response) {
			if (response.status === 'reset_required') {
				const error = new Error('Password reset required') as Error & { code?: string };
				error.code = 'reset_required';
				throw error;
			}
			const homeserver = response.homeserver || getHomeserver();
			saveSession(response.access_token, response.user_id, response.device_id, homeserver);
			const client = createMatrixClient({
				baseUrl: homeserver,
				accessToken: response.access_token,
				userId: response.user_id,
				deviceId: response.device_id
			});
			_setClient(client);
			_setCryptoInitPromise(null);
			_setContactsBootstrapped(false);
			void _beginCryptoInit(client);
			return { access_token: response.access_token, user_id: response.user_id };
		}
	}

	const baseUrl = getHomeserver();
	const tempClient = createMatrixClient({ baseUrl });
	const response = await tempClient.login?.('m.login.password', {
		user,
		password,
		initial_device_display_name: 'FREE VOICE'
	});
	if (!response) throw new Error('Matrix login client does not support password login');

	saveSession(response.access_token, response.user_id, response.device_id, baseUrl);
	const client = createMatrixClient({
		baseUrl,
		accessToken: response.access_token,
		userId: response.user_id,
		deviceId: response.device_id
	});
	_setClient(client);
	_setCryptoInitPromise(null);
	_setContactsBootstrapped(false);
	void _beginCryptoInit(client);
	return { access_token: response.access_token, user_id: response.user_id };
}

export async function logout(): Promise<void> {
	if (_client) {
		try {
			await _client.logout?.();
		} catch (error) {
			console.warn('logout: session may already be invalid:', error);
		}
		_client.stopClient();
		await _client.clearStores();
		_setClient(null);
		_setCryptoInitPromise(null);
	}
	_setContactsBootstrapped(false);
	_resetProcessedEventIds();
	_resetReadReceiptTracking();
	resetMatrixStore();
	clearSession();
}

export async function getProfile(): Promise<{
	id: string;
	email: string;
	display_name: string;
} | null> {
	if (!_client) return null;
	const userId = _client.getUserId();
	let displayName = _client.getUser(userId)?.displayName || '';
	try {
		const info = await _client.getProfileInfo(userId);
		displayName = info?.displayname || displayName;
	} catch (error) {
		console.warn('getProfile: profile fetch failed:', error);
	}
	return {
		id: userId,
		email: userId,
		display_name: displayName || userId
	};
}

export async function setDisplayName(name: string): Promise<void> {
	if (!_client) throw new Error('Not logged in');
	await _client.setDisplayName(name);
}

export async function register(
	user: string,
	password: string,
	displayName: string
): Promise<{ user_id: string }> {
	const baseUrl = getHomeserver();
	const tempClient = createMatrixClient({ baseUrl });

	let response: MatrixRegisterResponse | undefined;
	try {
		response = await tempClient.register?.(user, password, null, null);
	} catch (error) {
		const err = error as MatrixUiAuthError;
		if (err.httpStatus === 401 && err.data?.session) {
			const sessionId = err.data.session;
			response = await tempClient.register?.(user, password, sessionId, {
				type: 'm.login.dummy',
				session: sessionId
			});
		} else {
			throw error;
		}
	}

	if (!response) throw new Error('Matrix register client does not support registration');

	if (response.access_token && response.device_id) {
		saveSession(response.access_token, response.user_id, response.device_id, baseUrl);
		const client = createMatrixClient({
			baseUrl,
			accessToken: response.access_token,
			userId: response.user_id,
			deviceId: response.device_id
		});
		_setClient(client);
		void client.setDisplayName(displayName || user).catch(() => {});
		_setCryptoInitPromise(null);
		_setContactsBootstrapped(false);
		void _beginCryptoInit(client);
	}

	return { user_id: response.user_id };
}
