import { normalizeRefreshTokenResponse } from './normalizers/api';
import { parseJwtPayload } from './normalizers/auth';

const TOKEN_KEY = 'token';
const REFRESH_KEY = 'refresh_token';

export function getToken(): string | null {
	return localStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
	return localStorage.getItem(REFRESH_KEY);
}

export function setTokens(access: string, refresh: string | null): void {
	localStorage.setItem(TOKEN_KEY, access);
	if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
}

export function clearTokens(): void {
	localStorage.removeItem(TOKEN_KEY);
	localStorage.removeItem(REFRESH_KEY);
	// Also clear Matrix session so page-reload doesn't re-authenticate a logged-out user
	localStorage.removeItem('matrix_access_token');
	localStorage.removeItem('matrix_user_id');
	localStorage.removeItem('matrix_device_id');
}

export function isLoggedIn(): boolean {
	// Matrix mode stores its token under a different key; check both
	return Boolean(getToken() || localStorage.getItem('matrix_access_token'));
}

export function userFromJwt(): string | null {
	const token = getToken();
	if (!token) return null;
	try {
		return parseJwtPayload(token).sub ?? null;
	} catch (err) {
		console.warn('[auth]', err);
		return null;
	}
}

/** Seconds until access token expires. Returns 0 if no token or unparseable. */
export function tokenExpiresIn(): number {
	const token = getToken();
	if (!token) return 0;
	try {
		const payload = parseJwtPayload(token);
		return Math.max(0, (payload.exp || 0) - Date.now() / 1000);
	} catch (err) {
		console.warn('[auth]', err);
		return 0;
	}
}

/** Refresh access token if it expires within `thresholdSec` seconds. Returns fresh token or null. */
export async function ensureFreshToken(thresholdSec = 120): Promise<string | null> {
	if (tokenExpiresIn() > thresholdSec) return getToken();
	const refresh = getRefreshToken();
	if (!refresh) return null;
	try {
		const r = await fetch('/api/auth/refresh', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ refresh_token: refresh })
		});
		if (r.ok) {
			const tokens = normalizeRefreshTokenResponse(await r.json());
			setTokens(tokens.accessToken, tokens.refreshToken);
			return tokens.accessToken;
		}
	} catch (err) {
		console.warn('[auth]', err);
	}
	return null;
}
