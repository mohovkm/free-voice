import { describe, it, expect, beforeEach } from 'vitest';
import {
	getToken,
	getRefreshToken,
	setTokens,
	clearTokens,
	isLoggedIn,
	userFromJwt
} from '@client/lib/services/auth';

describe('auth service', () => {
	beforeEach(() => {
		localStorage.removeItem('token');
		localStorage.removeItem('refresh_token');
	});

	it('stores and retrieves tokens', () => {
		setTokens('access123', 'refresh456');
		expect(getToken()).toBe('access123');
		expect(getRefreshToken()).toBe('refresh456');
	});

	it('clears tokens', () => {
		setTokens('a', 'b');
		clearTokens();
		expect(getToken()).toBeNull();
		expect(getRefreshToken()).toBeNull();
	});

	it('reports login status', () => {
		expect(isLoggedIn()).toBe(false);
		setTokens('tok', null);
		expect(isLoggedIn()).toBe(true);
	});

	it('decodes user from JWT', () => {
		// JWT with payload { "sub": "user@test.com" }
		const payload = btoa(JSON.stringify({ sub: 'user@test.com' }));
		const fakeJwt = 'header.' + payload + '.sig';
		setTokens(fakeJwt, null);
		expect(userFromJwt()).toBe('user@test.com');
	});

	it('returns null for invalid JWT', () => {
		setTokens('not-a-jwt', null);
		expect(userFromJwt()).toBeNull();
	});
});
