/** auth store — reactive auth state */
import { writable, derived } from 'svelte/store';
import {
	setTokens,
	clearTokens,
	isLoggedIn,
	userFromJwt,
	getToken as getJwtToken
} from '$lib/services/auth';
import type { AuthUserId } from '$lib/types/auth';

const _loggedIn = writable(isLoggedIn());

let _matrixUserId: AuthUserId | null = null;

export const loggedIn = { subscribe: _loggedIn.subscribe };

// In Matrix mode currentUser is the Matrix userId; legacy mode reads from JWT
export const currentUser = derived(_loggedIn, ($loggedIn) => {
	if (!$loggedIn) return null;
	return _matrixUserId || userFromJwt();
});

export function login(accessToken: string, refreshToken: string | null): void {
	setTokens(accessToken, refreshToken);
	_loggedIn.set(true);
}

/** Set logged-in state for Matrix mode (no JWT involved). */
export function setMatrixLoggedIn(userId: AuthUserId): void {
	_matrixUserId = userId;
	_loggedIn.set(true);
}

export async function logout(): Promise<void> {
	_matrixUserId = null;
	// push unsubscribe handled by caller
	clearTokens();
	_loggedIn.set(false);
}

/** Returns Matrix access token when in Matrix mode, JWT access token otherwise. */
export function getToken(): string | null {
	return localStorage.getItem('matrix_access_token') || getJwtToken();
}
