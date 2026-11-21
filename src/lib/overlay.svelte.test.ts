// 蓋住編輯畫面的 module 自己的疊層規則：Esc 只給最上面那一層、打開框時先收小窗、小窗不算蓋住、對話框外面的才 inert。
// 按鍵在編輯頁上的結果（Delete、⌘S、Shift+Tab）在 src/routes/overlay.svelte.test.ts。
import { afterEach, describe, expect, it } from 'vitest';
import { covered, covers, layer, topDialog, type LayerKind } from './overlay.svelte.js';

let opened: (() => void)[] = [];
afterEach(() => {
	for (const off of opened.reverse()) off();
	opened = [];
	document.body.replaceChildren();
});

/** 開一層：回傳它的外框和被關過幾次（怎麼關的）。 */
function open(kind: LayerKind, parent: Element = document.body) {
	const el = document.createElement('div');
	parent.append(el);
	const closed: string[] = [];
	const off = layer({ kind, close: (by) => closed.push(by) })(el) as () => void;
	opened.push(off);
	return { el, closed, off };
}

const esc = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));

describe('蓋住編輯畫面的 module', () => {
	it('Esc 一次只給最上面那一層；它關了，下一個 Esc 才給下面那層', () => {
		const pop = open('pop');
		const dialog = open('dialog');
		esc();
		expect(dialog.closed).toEqual(['escape']);
		expect(pop.closed).toEqual([]);
		dialog.off();
		esc();
		expect(pop.closed).toEqual(['escape']);
	});

	it('中文輸入法選字時的 Esc 不算', () => {
		const dialog = open('dialog');
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true }));
		expect(dialog.closed).toEqual([]);
	});

	it('框（找書籤）打開時先收開著的小窗；對話框打開時不收', () => {
		const pop = open('pop');
		open('dialog');
		expect(pop.closed).toEqual([]);
		open('box');
		expect(pop.closed).toEqual(['outside']);
	});

	it('小窗不算蓋住；對話框、框算', () => {
		const pop = open('pop');
		expect(covered()).toBe(false);
		pop.off();
		const box = open('box');
		expect(covered()).toBe(true);
		box.off();
		open('dialog');
		expect(covered()).toBe(true);
	});

	it('inert 只看編輯畫面外面的對話框；放在裡面的（名詞對照表）、框都不算', () => {
		const editor = document.createElement('div');
		document.body.append(editor);
		open('dialog', editor);
		open('box', editor);
		expect(covers(editor)).toBe(false);
		open('dialog');
		expect(covers(editor)).toBe(true);
	});

	it('最上面的對話框：上面開了小窗也還是它（Tab 照樣只在它裡面轉）', () => {
		const below = open('dialog');
		const top = open('dialog');
		open('pop');
		expect(topDialog(top.el)).toBe(true);
		expect(topDialog(below.el)).toBe(false);
	});
});
