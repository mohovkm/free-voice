import { writable } from 'svelte/store';

export type ThemePreference = 'system' | 'light' | 'dark';

const isBrowser = typeof window !== 'undefined' && typeof localStorage !== 'undefined';
const DEFAULT_THEME: ThemePreference = 'system';

function getStored(): ThemePreference | null {
	try {
		const stored = isBrowser ? localStorage.getItem('fv-theme') : null;
		return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : null;
	} catch (err) {
		console.warn(err);
		return null;
	}
}

const store = writable<ThemePreference>(getStored() || DEFAULT_THEME);

function apply(value: ThemePreference): void {
	if (!isBrowser) return;
	const resolved =
		value === 'system'
			? window.matchMedia('(prefers-color-scheme: light)').matches
				? 'light'
				: 'dark'
			: value;
	document.documentElement.setAttribute('data-theme', resolved);
	localStorage.setItem('fv-theme', value);
}

export const theme = {
	subscribe: store.subscribe,
	set(value: ThemePreference) {
		store.set(value);
		apply(value);
	},
	init() {
		const value = getStored() || DEFAULT_THEME;
		store.set(value);
		apply(value);
	}
};
