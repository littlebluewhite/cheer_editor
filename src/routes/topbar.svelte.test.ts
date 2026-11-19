// 上方列永遠一行（#280）：不管視窗多寬多高，HTML 的順序就是畫面由左到右的順序，Tab 才照畫面走。
import { render, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { editorPage } from '#lib/test-fakes.js';
import { libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

Element.prototype.scrollIntoView = () => {};

const real = { w: window.innerWidth, h: window.innerHeight };
function windowOf(w: number, h: number) {
	Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
	Object.defineProperty(window, 'innerHeight', { value: h, configurable: true });
}
beforeEach(() => localStorage.clear());
afterEach(() => windowOf(real.w, real.h));

const topbar = () => document.querySelector<HTMLElement>('.topbar')!;
/** a 在 HTML 裡排在 b 前面（Tab 先到 a）。 */
const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('上方列永遠一行', () => {
	for (const [w, h] of [
		[1024, 768],
		[1440, 900],
		[1728, 1000],
		[1920, 1080]
	]) {
		it(`${w}×${h}：Tab 的順序是選單、編排｜練習、播放區、右邊的按鈕`, async () => {
			windowOf(w, h);
			render(Page, editorPage(libSample()).props);
			await tick();
			const bar = within(topbar());
			const order = [
				bar.getByRole('button', { name: '選單' }),
				bar.getByRole('button', { name: '編排' }),
				bar.getByRole('button', { name: '練習' }),
				bar.getByRole('button', { name: '播放' }),
				bar.getByRole('button', { name: /^編輯/ }),
				bar.getByRole('button', { name: /^檢視/ }),
				bar.getByRole('button', { name: /^復原/ }),
				bar.getByRole('button', { name: /^重做/ }),
				bar.getByRole('button', { name: /八拍表/ }),
				bar.getByRole('button', { name: /存檔/ })
			];
			for (let i = 1; i < order.length; i++) expect(before(order[i - 1], order[i]), `${order[i - 1].textContent} 在 ${order[i].textContent} 前面`).toBe(true);
		});
	}

	it('字收成圖示的按鈕，滑鼠移上去看得到名字（title），報讀軟體讀得到名字', async () => {
		render(Page, editorPage(libSample()).props);
		await tick();
		const bar = within(topbar());
		for (const name of ['選單', '編輯', '檢視', '復原', '重做', '八拍表']) {
			const b = bar.getByRole('button', { name: new RegExp(`^${name}`) });
			expect(b.title, name).toMatch(new RegExp(`^${name}`));
		}
		for (const name of ['節拍器', '重複']) expect(bar.getByRole('checkbox', { name: new RegExp(name) }).closest('label')!.title).toMatch(new RegExp(`^${name}`));
	});
});
