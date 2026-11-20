// 翻譯檔（messages/*.json，ADR 0017）：三種語言的句子要一樣多、名字一樣，不能用到查資料時找到的陷阱字（ADR 0016）。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const load = (locale: string) =>
	JSON.parse(readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;
const keys = (locale: string) => Object.keys(load(locale)).sort();

describe('翻譯檔', () => {
	it('英文、日文跟中文的句子一樣多、名字一樣', () => {
		expect(keys('en')).toEqual(keys('zh-TW'));
		expect(keys('ja')).toEqual(keys('zh-TW'));
	});

	it('英文、日文裡沒有中文字（漢字只檢查英文）', () => {
		for (const [key, text] of Object.entries(load('en'))) expect(text, key).not.toMatch(/\p{Script=Han}/u);
	});

	it('不用陷阱字：sectionals、全上げ、セカンドレベル、單獨的スポット', () => {
		for (const [key, text] of Object.entries(load('en'))) expect(text, key).not.toMatch(/\bsectionals?\b/i);
		for (const [key, text] of Object.entries(load('ja'))) {
			expect(text, key).not.toMatch(/全上げ|セカンドレベル/);
			expect(text, key).not.toMatch(/(?<!バック|フロント)スポット(?!ター)/);
		}
	});
});
