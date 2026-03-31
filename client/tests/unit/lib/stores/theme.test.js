import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { theme } from '@client/lib/stores/theme';

describe('theme store', () => {
	beforeEach(() => {
		localStorage.removeItem('fv-theme');
		document.documentElement.removeAttribute('data-theme');
	});

	it('defaults to system', () => {
		theme.init();
		expect(get(theme)).toBe('system');
	});

	it('applies data-theme attribute', () => {
		theme.set('light');
		expect(document.documentElement.getAttribute('data-theme')).toBe('light');
	});

	it('persists to localStorage', () => {
		theme.set('light');
		expect(localStorage.getItem('fv-theme')).toBe('light');
	});

	it('restores from localStorage', () => {
		localStorage.setItem('fv-theme', 'light');
		theme.init();
		expect(get(theme)).toBe('light');
	});
});
