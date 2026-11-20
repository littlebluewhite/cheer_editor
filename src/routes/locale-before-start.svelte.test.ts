// app.html 最前面的小程式：程式跑起來之前先挑好語言（改 <html lang>，不是中文就先藏起畫面，不先閃中文）。
// 它挑的語言要跟 Paraglide 的 getLocale() 一模一樣，不然會藏錯、lang 寫錯。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLocale, localStorageKey, locales } from '#lib/paraglide/runtime.js';
import html from '../app.html?raw';

const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((s) => s[1]).find((s) => s.includes(`'${localStorageKey}'`));

function run(saved: string | null, languages: string[]) {
	if (saved === null) localStorage.removeItem(localStorageKey);
	else localStorage.setItem(localStorageKey, saved);
	vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages);
	const root = document.documentElement;
	root.lang = 'zh-Hant-TW'; // app.html 本來寫的
	delete root.dataset.localePending;
	new Function(script!)();
	const result = { lang: root.lang, hidden: 'localePending' in root.dataset };
	// 小程式跑完再問 Paraglide（它第一次會把挑到的語言存起來，先問會改到 localStorage）
	return { ...result, locale: getLocale() };
}

const LANG: Record<string, string> = { 'zh-TW': 'zh-Hant-TW', en: 'en', ja: 'ja' };

afterEach(() => vi.restoreAllMocks());

describe('app.html 先挑語言', () => {
	it('有這段小程式，而且它認得的語言就是 Paraglide 的語言', () => {
		expect(script).toBeTruthy();
		const list = script!.match(/var locales = (\[.*?\]);/)![1];
		expect(JSON.parse(list.replaceAll("'", '"'))).toEqual(locales);
	});

	it.each([
		['存了英文', 'en', ['zh-TW']],
		['存了中文', 'zh-TW', ['en-US']],
		['存了還沒開放的日文：看瀏覽器語言', 'ja', ['en-US', 'zh-TW']],
		['存了還沒開放的日文、瀏覽器是日文：中文', 'ja', ['ja-JP']],
		['沒存、瀏覽器英文', null, ['en-US']],
		['沒存、瀏覽器台灣中文', null, ['zh-TW', 'en']],
		['沒存、大小寫不同', null, ['ZH-tw']],
		['沒存、前面的語言都沒有', null, ['fr-FR', 'de', 'en-GB']],
		['沒存、瀏覽器沒說', null, []]
	])('%s：跟 Paraglide 一樣，不是中文就藏起畫面', (_name, saved, languages) => {
		const r = run(saved, languages);
		expect(r.lang).toBe(LANG[r.locale]);
		expect(r.hidden).toBe(r.locale !== 'zh-TW');
	});

	it('讀不到 localStorage 也不會壞', () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('denied');
		});
		vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US']);
		new Function(script!)();
		expect(document.documentElement.lang).toBe('en');
	});
});
