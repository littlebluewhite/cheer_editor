// 復原、重做（#139）：元件自己開的確認框一起收掉；還沒送出的輸入框裡 ⌘Z 只退字；復原、重做說退了什麼。
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { moveMembers, type Flow } from '#lib/core';
import { editorPage } from '#lib/test-fakes.js';
import { flowOf, libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

function setup(flow: Flow = libSample()) {
	const { session, props } = editorPage(flow);
	render(Page, props);
	return session;
}

const undoKey = (el: Element | Window = window) => fireEvent.keyDown(el, { key: 'z', metaKey: true });
const redoKey = (el: Element | Window = window) => fireEvent.keyDown(el, { key: 'z', metaKey: true, shiftKey: true });
const tab = (name: '動作' | '隊員') => screen.getByRole('tab', { name: new RegExp(`^${name}`) });

describe('復原、重做時元件的確認框一起收掉', () => {
	it('刪隊員的確認開著時 ⌘Z 退幾步、⌘⇧Z：確認框不在，重做沒被清掉', async () => {
		const session = setup();
		await fireEvent.click(tab('隊員'));
		await fireEvent.change(screen.getByLabelText('第 2 位隊員的名字'), { target: { value: '阿A' } });
		await fireEvent.change(screen.getByLabelText('第 3 位隊員的名字'), { target: { value: '阿B' } });
		// 小美在 Lib 裡：刪她要先確認
		await fireEvent.click(screen.getByRole('button', { name: '刪除第 1 位隊員' }));
		expect(screen.getByRole('alertdialog')).toBeTruthy();

		await undoKey();
		await undoKey();
		expect(screen.queryByRole('alertdialog')).toBeNull();
		await redoKey();
		expect(screen.queryByRole('alertdialog')).toBeNull();
		expect(session.flow!.members.map((m) => m.name)).toEqual(['小美', '阿A', '小B', '小芳']);
		expect(session.canRedo).toBe(true);
	});
});

describe('還沒送出的輸入框裡 ⌘Z 交給瀏覽器退字', () => {
	it('加隊員的名字框打了字按 ⌘Z：不攔、流程沒變', async () => {
		const session = setup();
		await fireEvent.click(tab('隊員'));
		await fireEvent.change(screen.getByLabelText('第 2 位隊員的名字'), { target: { value: '阿A' } });
		const before = session.flow;
		const names = screen.getByLabelText(/^名字/) as HTMLTextAreaElement;
		names.focus();
		await fireEvent.input(names, { target: { value: '小明' } });
		expect(await undoKey(names)).toBe(true);
		expect(await redoKey(names)).toBe(true);
		expect(session.flow).toBe(before);
		expect(session.canUndo).toBe(true);
	});

	it('新動作表單的名稱打了字按 ⌘Z：不攔、流程沒變', async () => {
		const session = setup();
		await fireEvent.click(tab('隊員'));
		await fireEvent.change(screen.getByLabelText('第 2 位隊員的名字'), { target: { value: '阿A' } });
		await fireEvent.click(tab('動作'));
		const before = session.flow;
		const name = screen.getByLabelText('名稱') as HTMLInputElement;
		name.focus();
		await fireEvent.input(name, { target: { value: '籃拋' } });
		expect(await undoKey(name)).toBe(true);
		expect(session.flow).toBe(before);
	});
});

describe('復原、重做說退了什麼', () => {
	it('雙擊插入站位後 ⌘Z：提示「已復原：插入站位 2」；⌘⇧Z：「已重做：插入站位 2」', async () => {
		setup(flowOf(moveMembers(libSample(), 8, { m1: [3, 3] })));
		// 150 BPM 一拍 0.4 秒：3-1 是 6.4 秒 = 102.4 px（時間軸 ×1）
		await fireEvent.dblClick(document.querySelector<HTMLElement>('.film .trk')!, { clientX: 102.4 });
		await undoKey();
		expect(screen.getByRole('status').textContent).toContain('已復原：插入站位 2');
		await redoKey();
		expect(screen.getByRole('status').textContent).toContain('已重做：插入站位 2');
	});

	it('復原、重做按鈕的提示寫出下一步會退什麼；也說方向鍵連按合成一步', async () => {
		setup(flowOf(moveMembers(libSample(), 8, { m1: [3, 3] })));
		const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
		expect(button('復原').title).not.toContain('：');
		await fireEvent.dblClick(document.querySelector<HTMLElement>('.film .trk')!, { clientX: 102.4 });
		expect(button('復原').title).toContain('復原：插入站位 2');
		expect(button('復原').title).toContain('方向鍵連按');
		expect(button('重做').title).not.toContain('：插入');
		await undoKey();
		expect(button('重做').title).toContain('重做：插入站位 2');
		expect(button('復原').title).not.toContain('插入站位 2');
	});
});
