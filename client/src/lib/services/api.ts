import type { ApiMethod, ApiRequestBody } from '$lib/types/api';
import { getToken, getRefreshToken, setTokens, clearTokens } from './auth';
import { normalizeApiErrorPayload, normalizeRefreshTokenResponse } from './normalizers/api';

let onAuthFailure: (() => void) | null = null;

/** Register a callback for when auth fails (token expired, refresh failed) */
export function onAuthError(fn: (() => void) | null): void {
	onAuthFailure = fn;
}

async function request(
	method: ApiMethod,
	path: string,
	body?: ApiRequestBody
): Promise<unknown | null> {
	const opts: RequestInit = { method, headers: {} };
	const token = getToken();
	if (token && opts.headers) {
		(opts.headers as Record<string, string>).Authorization = `Bearer ${token}`;
	}
	if (body && opts.headers) {
		(opts.headers as Record<string, string>)['Content-Type'] = 'application/json';
		opts.body = JSON.stringify(body);
	}

	let response = await fetch(`/api${path}`, opts);

	if (response.status === 401 && getRefreshToken()) {
		const refreshResponse = await fetch('/api/auth/refresh', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ refresh_token: getRefreshToken() })
		});
		if (refreshResponse.ok) {
			const tokens = normalizeRefreshTokenResponse(await refreshResponse.json());
			setTokens(tokens.accessToken, tokens.refreshToken);
			if (opts.headers) {
				(opts.headers as Record<string, string>).Authorization = `Bearer ${tokens.accessToken}`;
			}
			response = await fetch(`/api${path}`, opts);
		} else {
			clearTokens();
			onAuthFailure?.();
			return null;
		}
	}

	if (!response.ok) {
		const errorPayload = normalizeApiErrorPayload(
			await response.json().catch(() => null),
			response.statusText
		);
		throw new Error(errorPayload.detail);
	}
	if (response.status === 204) return null;
	return response.json();
}

export const get = (path: string): Promise<unknown | null> => request('GET', path);
export const post = (path: string, body?: ApiRequestBody): Promise<unknown | null> =>
	request('POST', path, body);
export const patch = (path: string, body?: ApiRequestBody): Promise<unknown | null> =>
	request('PATCH', path, body);
export const del = (path: string, body?: ApiRequestBody): Promise<unknown | null> =>
	request('DELETE', path, body);
