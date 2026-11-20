import { describe, expect, it } from 'vitest';
import { m } from '#lib/paraglide/messages.js';
import { getLocale, localStorageKey } from '#lib/paraglide/runtime.js';
import { holdTabLocale } from './shown-locale.js';

describe('這個分頁的語言', () => {
	it('別的分頁換成英文（存的變了）：這個分頁還是中文，字也是中文', () => {
		holdTabLocale();
		expect(getLocale()).toBe('zh-TW');
		localStorage.setItem(localStorageKey, 'en');
		expect(getLocale()).toBe('zh-TW');
		expect(m.language()).toBe('語言');
	});
});
