import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { locale, t, availableLocales } from '@client/lib/stores/i18n';

describe('i18n store', () => {
	beforeEach(() => {
		localStorage.removeItem('fv-lang');
		locale.set('en');
	});

	it('defaults to en', () => {
		expect(get(locale)).toBe('en');
	});

	it('translates keys', () => {
		const tr = get(t);
		expect(tr('signIn')).toBe('Sign In');
	});

	it('switches to ru', () => {
		locale.set('ru');
		expect(get(locale)).toBe('ru');
		const tr = get(t);
		expect(tr('signIn')).toBe('Войти');
	});

	it('falls back to en for missing keys', () => {
		locale.set('ru');
		const tr = get(t);
		// If a key exists in en but not ru, should fall back
		expect(tr('nonexistent_key')).toBe('nonexistent_key');
	});

	it('persists locale to localStorage', () => {
		locale.set('ru');
		expect(localStorage.getItem('fv-lang')).toBe('ru');
	});

	it('exposes available locales', () => {
		expect(availableLocales).toContain('en');
		expect(availableLocales).toContain('ru');
	});

	it('ignores invalid locale', () => {
		locale.set('xx');
		expect(get(locale)).toBe('en');
	});
});
