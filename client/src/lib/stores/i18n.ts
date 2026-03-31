import { derived, writable } from 'svelte/store';
import en from '$lib/i18n/en';
import ru from '$lib/i18n/ru';

type TranslationDict = Record<string, string>;
type LocaleCode = 'en' | 'ru';

const strings: Record<LocaleCode, TranslationDict> = { en, ru };
const isBrowser = typeof window !== 'undefined';

function detectLocale(): LocaleCode {
	if (!isBrowser) return 'en';
	const stored = localStorage.getItem('fv-lang');
	if (stored === 'en' || stored === 'ru') return stored;
	const browser = (navigator.language || '').slice(0, 2);
	return browser === 'ru' ? 'ru' : 'en';
}

const localeStore = writable<LocaleCode>(detectLocale());

export const locale = {
	subscribe: localeStore.subscribe,
	set(code: string) {
		if (code !== 'en' && code !== 'ru') return;
		localeStore.set(code);
		if (isBrowser) localStorage.setItem('fv-lang', code);
	}
};

export const t = derived(localeStore, ($locale) => {
	const dict = strings[$locale] || strings.en;
	return (key: string): string => dict[key] ?? strings.en[key] ?? key;
});

export const availableLocales = Object.keys(strings) as LocaleCode[];
