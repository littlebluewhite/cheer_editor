// 頁面例外（B01，#197）：欄位有焦點時畫面把它換掉（關對話框、刪站位），頁面不丟例外；
// 沒送出的字照常送出或照常丟掉，「未存」不卡住，接著 ⌘Z 真的復原上一步。
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { domPendingInput } from '#lib/pending-input.js';
import { editorPage } from '#lib/test-fakes.js';
import { moveMembers } from '#lib/core';
import { flowOf, libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

// 跟 Chrome 一樣：拿掉有焦點的欄位（或包著它的東西）時，當下就發 change（字改過的話）、blur、focusout（jsdom 都不發）。
/** 有焦點的欄位上次送出（或拿到焦點）時的字：拿掉時字不一樣就跟離開欄位一樣發 change。 */
const lastSent = new WeakMap<EventTarget, string>();
for (const type of ['focusin', 'change'])
	window.addEventListener(type, (e) => lastSent.set(e.target!, (e.target as HTMLInputElement).value), true);
for (const [proto, name] of [
	[Element.prototype, 'remove'],
	[CharacterData.prototype, 'remove']
] as const) {
	const original = proto[name];
	proto[name] = function (this: ChildNode) {
		blurIfInside(this);
		original.call(this);
	};
}
const removeChild = Node.prototype.removeChild;
Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
	blurIfInside(child);
	return removeChild.call(this, child) as T;
};
function blurIfInside(node: Node) {
	const el = document.activeElement;
	if (el && el !== document.body && node.contains(el)) {
		const value = (el as HTMLInputElement).value;
		if (value !== undefined && value !== lastSent.get(el)) el.dispatchEvent(new Event('change', { bubbles: true }));
		el.dispatchEvent(new FocusEvent('blur'));
		el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
	}
}

/** 事件處理裡丟出來的例外（jsdom 不往外丟，只發 window 的 error）。 */
let errors: unknown[] = [];
const onerror = (e: ErrorEvent) => {
	errors.push(e.error);
	e.preventDefault();
};
beforeEach(() => {
	errors = [];
	window.addEventListener('error', onerror);
});
afterEach(() => {
	window.removeEventListener('error', onerror);
	cleanup();
});

const undoKey = () => fireEvent.keyDown(window, { key: 'z', metaKey: true });

function setup(flow = libSample()) {
	const { session, props } = editorPage(flow);
	render(Page, props);
	return session;
}

describe('欄位有焦點時畫面把它換掉', () => {
	it('流程設定的名字欄打了字按 Esc 關掉：沒有例外；打的字照常送出、「未存」不卡住；⌘Z 退回原本的名字', async () => {
		const session = setup();
		const before = session.flow!.name;
		await fireEvent.click(screen.getByRole('button', { name: '流程設定' }));
		const dialog = screen.getByRole('dialog', { name: '流程設定' });
		const name = within(dialog).getByLabelText('流程名字') as HTMLInputElement;
		name.focus();
		await fireEvent.input(name, { target: { value: '新名字' } });
		await fireEvent.keyDown(name, { key: 'Escape' });

		expect(errors).toEqual([]);
		expect(screen.queryByRole('dialog', { name: '流程設定' })).toBeNull();
		expect(session.flow!.name).toBe('新名字');
		expect(domPendingInput.pending).toBe(false);

		await undoKey();
		expect(errors).toEqual([]);
		expect(session.flow!.name).toBe(before);
	});

	it('站位名稱打了字、焦點還在裡面時刪掉這張站位：沒有例外；沒送出的字照常丟掉、「未存」不卡住；⌘Z 站位回來', async () => {
		const session = setup(flowOf(moveMembers(libSample(), 8, { m1: [3, 3] })));
		await fireEvent.click(screen.getByRole('button', { name: '站位 2' }));
		const name = screen.getByLabelText('站位名稱') as HTMLInputElement;
		name.focus();
		await fireEvent.input(name, { target: { value: '開場' } });
		// 點 ✕ 不搶焦點（例：觸控），焦點還在名稱欄裡時整張站位被拿掉
		await fireEvent.click(screen.getByRole('button', { name: '刪除站位 2' }));

		expect(errors).toEqual([]);
		expect(session.flow!.formations).toHaveLength(1);
		// 打的字是給站位 2 的：不會改到播放頭換過去的站位 1
		expect(session.flow!.formations[0].name).toBeUndefined();
		expect(domPendingInput.pending).toBe(false);

		await undoKey();
		expect(errors).toEqual([]);
		expect(session.flow!.formations).toHaveLength(2);
		expect(session.flow!.formations[1].name).toBeUndefined();
	});
});
