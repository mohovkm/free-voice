export interface MatrixSessionSnapshot {
	accessToken: string | null;
	userId: string | null;
	deviceId: string | null;
}

const HS_KEY = 'matrix_homeserver';
const TOKEN_KEY = 'matrix_access_token';
const USER_KEY = 'matrix_user_id';
const DEVICE_KEY = 'matrix_device_id';

export function getHomeserver(): string {
	return (
		(typeof localStorage !== 'undefined' && localStorage.getItem(HS_KEY)) || window.location.origin
	);
}

export function saveSession(
	accessToken: string,
	userId: string,
	deviceId: string,
	homeserver = getHomeserver()
): void {
	localStorage.setItem(HS_KEY, homeserver);
	localStorage.setItem(TOKEN_KEY, accessToken);
	localStorage.setItem(USER_KEY, userId);
	localStorage.setItem(DEVICE_KEY, deviceId);
}

export function loadSession(): MatrixSessionSnapshot {
	return {
		accessToken: localStorage.getItem(TOKEN_KEY),
		userId: localStorage.getItem(USER_KEY),
		deviceId: localStorage.getItem(DEVICE_KEY)
	};
}

export function clearSession(): void {
	localStorage.removeItem(HS_KEY);
	localStorage.removeItem(TOKEN_KEY);
	localStorage.removeItem(USER_KEY);
	localStorage.removeItem(DEVICE_KEY);
}

export async function requestCompat<T>(
	method: string,
	path: string,
	body?: unknown,
	token?: string | null
): Promise<T | null> {
	const opts: RequestInit = { method, headers: {} };
	if (token && opts.headers) {
		(opts.headers as Record<string, string>).Authorization = `Bearer ${token}`;
	}
	if (body && opts.headers) {
		(opts.headers as Record<string, string>)['Content-Type'] = 'application/json';
		opts.body = JSON.stringify(body);
	}

	const response = await fetch(`/api${path}`, opts);
	if (!response.ok) {
		const err = await response.json().catch(() => ({ detail: response.statusText }));
		const rawDetail = err.detail;
		const detail = Array.isArray(rawDetail)
			? rawDetail[0]?.msg || response.statusText
			: rawDetail || response.statusText;
		const error = new Error(detail) as Error & { status?: number; code?: string | null };
		error.status = response.status;
		error.code = err.code || err.status || null;
		throw error;
	}
	if (response.status === 204) return null;
	return (await response.json()) as T;
}
