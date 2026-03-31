import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { loggedIn, currentUser, login, logout, setMatrixLoggedIn, getToken } from '@client/lib/stores/auth';

describe('auth store', () => {
	beforeEach(() => {
		logout();
	});

	it('starts logged out', () => {
		expect(get(loggedIn)).toBe(false);
		expect(get(currentUser)).toBeNull();
	});

	it('logs in and exposes user', () => {
		const payload = btoa(JSON.stringify({ sub: 'user@test.com' }));
		login('h.' + payload + '.s', 'refresh');
		expect(get(loggedIn)).toBe(true);
		expect(get(currentUser)).toBe('user@test.com');
	});

	it('logs out', () => {
		const payload = btoa(JSON.stringify({ sub: 'u@t.com' }));
		login('h.' + payload + '.s', 'r');
		logout();
		expect(get(loggedIn)).toBe(false);
		expect(get(currentUser)).toBeNull();
	});

	describe('setMatrixLoggedIn()', () => {
		it('sets loggedIn to true without a JWT', () => {
			setMatrixLoggedIn('@alice:example.com');
			expect(get(loggedIn)).toBe(true);
		});

		it('exposes Matrix userId as currentUser', () => {
			setMatrixLoggedIn('@alice:example.com');
			expect(get(currentUser)).toBe('@alice:example.com');
		});

		it('clears Matrix userId on logout', () => {
			setMatrixLoggedIn('@alice:example.com');
			logout();
			expect(get(loggedIn)).toBe(false);
			expect(get(currentUser)).toBeNull();
		});
	});

	describe('getToken()', () => {
		it('returns Matrix access token when present in localStorage', () => {
			localStorage.setItem('matrix_access_token', 'matrix_tok');
			expect(getToken()).toBe('matrix_tok');
			localStorage.removeItem('matrix_access_token');
		});

		it('returns JWT token when no Matrix token present', () => {
			const payload = btoa(JSON.stringify({ sub: 'u@t.com' }));
			login('h.' + payload + '.s', 'r');
			expect(getToken()).toBe('h.' + payload + '.s');
		});
	});
});
