import { afterEach, describe, expect, it } from 'vitest';
import { truncate } from './truncate';

/** jsdom 不排版：自己給寬度。content 是內容多寬（scrollWidth），box 是框多寬（clientWidth）。 */
function sized<T extends HTMLElement>(el: T, size: { content: number; box: number }) {
	Object.defineProperty(el, 'scrollWidth', { get: () => size.content });
	Object.defineProperty(el, 'clientWidth', { get: () => size.box });
	document.body.append(el);
	return el;
}

afterEach(() => document.body.replaceChildren());

describe('truncate：被截短的字自動補 title', () => {
	it('名單的名字欄裝不下長名字時，滑鼠移上去看得到整個名字；改短裝得下就不留 title（N42）', () => {
		const size = { content: 300, box: 120 };
		const input = sized(document.createElement('input'), size);
		input.value = '名字有十八個字的隊員一二三四五六七八';
		const stop = truncate(input);
		expect(input.title).toBe('名字有十八個字的隊員一二三四五六七八');

		input.value = '小A';
		size.content = 40;
		input.dispatchEvent(new Event('input'));
		expect(input.hasAttribute('title')).toBe(false);
		stop?.();
	});

	it('「…」截短的字：title 是整段字；程式改了欄位的值（沒有 input 事件），滑鼠移上去時 title 也是新的', () => {
		const size = { content: 300, box: 120 };
		const input = sized(document.createElement('input'), size);
		input.value = '第一個很長很長的名字';
		const stop = truncate(input);
		input.value = '第二個很長很長的名字';
		input.dispatchEvent(new Event('pointerenter'));
		expect(input.title).toBe('第二個很長很長的名字');
		stop?.();
	});

	it('文字換了 title 跟著換', async () => {
		const span = sized(document.createElement('span'), { content: 300, box: 120 });
		span.textContent = '  很長的站位名字一二三四五六七八九十  ';
		const stop = truncate(span);
		expect(span.title).toBe('很長的站位名字一二三四五六七八九十');
		span.textContent = '另一個很長的站位名字';
		await Promise.resolve();
		expect(span.title).toBe('另一個很長的站位名字');
		stop?.();
	});
});
