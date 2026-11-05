// 編輯畫面的鍵盤（#95）：空白鍵照一般網頁、輸入框裡的 ⌘Z 退回流程、方向鍵移人合成一步、Home／End、分頁。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { createFakeEngine } from '#lib/audio/fake-engine.js';
import { EditorSession } from '#lib/editor-session.svelte.js';
import { libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

/** 頁面放範例流程：音樂 1（4 個八拍）、小美、小A、小B、小芳，動作 Lib。 */
function setup() {
	const session = new EditorSession(libSample());
	render(Page, { createEngine: () => createFakeEngine(), session });
	return session;
}

const playing = () => !!screen.queryByRole('button', { name: '暫停' });
const position = () => screen.getByLabelText('目前位置').textContent;
const undoButton = () => screen.getByRole('button', { name: '復原' }) as HTMLButtonElement;
const redoButton = () => screen.getByRole('button', { name: '重做' }) as HTMLButtonElement;
const dot = (id: string) => document.querySelector<SVGGElement>(`[data-member-id="${id}"]`)!;
const tab = (name: '動作' | '隊員') => screen.getByRole('tab', { name: new RegExp(`^${name}`) });

/** 焦點放在 el 上按空白鍵；回傳有沒有被 preventDefault（被攔下來就是 false）。 */
async function space(el: Element | Window) {
	if (el instanceof HTMLElement || el instanceof SVGElement) el.focus();
	return fireEvent.keyDown(el, { key: ' ' });
}

describe('空白鍵', () => {
	it('焦點在按鈕、連結、分頁、勾選框、選單、任務角色選單、輸入框、可編輯區上：照瀏覽器原本的行為，不播放', async () => {
		setup();
		// 點色條選動作，任務角色選單才出來
		await fireEvent.click(document.querySelector('[data-lane="m1"] [data-action-id="x1"]')!);
		const editable = document.createElement('div');
		editable.setAttribute('contenteditable', 'true');
		editable.tabIndex = 0;
		document.querySelector('.inspector')!.append(editable);
		const targets = [
			screen.getByRole('button', { name: '流程設定' }),
			screen.getByRole('link', { name: /使用說明/ }),
			tab('隊員'),
			screen.getByLabelText('節拍器'),
			screen.getByRole('combobox', { name: '小美 的任務角色' }),
			screen.getByLabelText('延遲校正（毫秒）'),
			editable
		];
		for (const el of targets) {
			expect(await space(el), el.outerHTML.slice(0, 60)).toBe(true);
			expect(playing()).toBe(false);
		}
		await fireEvent.click(tab('隊員'));
		const selects = [screen.getByLabelText('第 1 位隊員的性別'), screen.getByLabelText(/^名字/)];
		for (const el of selects) {
			expect(await space(el)).toBe(true);
			expect(playing()).toBe(false);
		}
	});

	it('焦點不在那些東西上（頁面本身、場上的人）：空白鍵播放／暫停', async () => {
		setup();
		expect(await space(window)).toBe(false);
		expect(playing()).toBe(true);
		expect(await space(dot('m1'))).toBe(false);
		expect(playing()).toBe(false);
		await space(dot('m1'));
		expect(playing()).toBe(true);
	});

	it('段設定開著時，空白鍵和段設定裡的暫停鈕都能暫停', async () => {
		setup();
		await fireEvent.click(screen.getByRole('button', { name: '播放' }));
		await fireEvent.click(screen.getByRole('button', { name: /^音樂 1/ }));
		const dialog = screen.getByRole('dialog', { name: '音樂 1 設定' });
		// 段設定打開時焦點在對話框本身
		expect(await space(document.activeElement!)).toBe(false);
		expect(playing()).toBe(false);
		// 對話框開著時空白鍵只暫停，不開始播
		await space(document.activeElement!);
		expect(playing()).toBe(false);

		await fireEvent.click(within(dialog).getByRole('button', { name: '關閉' }));
		await fireEvent.click(screen.getByRole('button', { name: '播放' }));
		await fireEvent.click(screen.getByRole('button', { name: /^音樂 1/ }));
		await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '暫停' }));
		expect(within(screen.getByRole('dialog')).queryByRole('button', { name: '暫停' })).toBeNull();
		await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '關閉' }));
		expect(playing()).toBe(false);
	});
});

describe('輸入框裡的 ⌘Z／Ctrl+Z', () => {
	/** 在欄位裡打字，還沒離開欄位（沒有 change）。 */
	async function type(input: HTMLInputElement, value: string) {
		input.focus();
		await fireEvent.input(input, { target: { value } });
	}

	it('打了字還沒送出：先送出再退回，欄位回到原本的字；不多記一步', async () => {
		const session = setup();
		await fireEvent.click(tab('隊員'));
		const name = screen.getByLabelText('第 1 位隊員的名字') as HTMLInputElement;
		await type(name, '小美美');
		// 被攔下來：瀏覽器自己的復原不跑
		expect(await fireEvent.keyDown(name, { key: 'z', metaKey: true })).toBe(false);
		expect(name.value).toBe('小美');
		expect(session.flow!.members[0].name).toBe('小美');
		// 跟真的離開欄位一樣再送一次：值沒變，不記一步
		await fireEvent.change(name);
		expect(session.canUndo).toBe(false);
		expect(redoButton().disabled).toBe(false);
		await fireEvent.keyDown(name, { key: 'z', ctrlKey: true, shiftKey: true });
		expect(name.value).toBe('小美美');
		expect(redoButton().disabled).toBe(true);
	});

	it('沒打字：直接退回流程的上一步', async () => {
		const session = setup();
		await fireEvent.click(tab('隊員'));
		const name = screen.getByLabelText('第 2 位隊員的名字') as HTMLInputElement;
		await type(name, '阿A');
		await fireEvent.change(name);
		expect(session.flow!.members[1].name).toBe('阿A');
		const gender = screen.getByLabelText('第 1 位隊員的性別') as HTMLSelectElement;
		gender.focus();
		expect(await fireEvent.keyDown(gender, { key: 'z', ctrlKey: true })).toBe(false);
		expect(session.flow!.members[1].name).toBe('小A');
		expect(name.value).toBe('小A');
		expect(undoButton().disabled).toBe(true);
	});

	it('對話框開著時也一樣：段設定裡打了八拍數按 ⌘Z，退回；關掉也不多記一步', async () => {
		const session = setup();
		await fireEvent.click(screen.getByRole('button', { name: /^音樂 1/ }));
		const eights = screen.getByLabelText('八拍數') as HTMLInputElement;
		await type(eights, '6');
		expect(await fireEvent.keyDown(eights, { key: 'z', metaKey: true })).toBe(false);
		expect(eights.value).toBe('4');
		expect(session.flow!.segments[0]).toMatchObject({ halfBeats: 64 });
		expect(screen.getByRole('dialog')).toBeTruthy();
		await fireEvent.keyDown(eights, { key: 'Escape' });
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(session.canUndo).toBe(false);
		expect(session.canRedo).toBe(true);
	});
});

describe('方向鍵移人', () => {
	it('連續移同一批人算一步；中間做了別的操作就斷開', async () => {
		const session = setup();
		const start = dot('m1').getAttribute('transform');
		dot('m1').focus();
		await fireEvent.keyDown(dot('m1'), { key: 'ArrowRight' });
		await fireEvent.keyDown(dot('m1'), { key: 'ArrowRight' });
		await fireEvent.keyDown(dot('m1'), { key: 'ArrowDown' });
		const moved = dot('m1').getAttribute('transform');
		expect(moved).not.toBe(start);
		await fireEvent.keyDown(dot('m1'), { key: 'z', metaKey: true });
		expect(dot('m1').getAttribute('transform')).toBe(start);
		expect(session.canUndo).toBe(false);
		await fireEvent.keyDown(dot('m1'), { key: 'z', metaKey: true, shiftKey: true });
		expect(dot('m1').getAttribute('transform')).toBe(moved);

		// 換一批人：斷開
		await fireEvent.keyDown(dot('m2'), { key: 'ArrowLeft' });
		await fireEvent.keyDown(dot('m1'), { key: 'ArrowLeft' });
		// 中間改了別的：斷開
		await fireEvent.click(tab('隊員'));
		const name = screen.getByLabelText('第 4 位隊員的名字') as HTMLInputElement;
		await fireEvent.change(name, { target: { value: '芳芳' } });
		await fireEvent.keyDown(dot('m1'), { key: 'ArrowLeft' });
		const steps = [];
		while (session.undo()) steps.push(1);
		// 第一批（合成一步）、m2、m1、改名、m1
		expect(steps).toHaveLength(5);
	});
});

describe('Home／End、分頁', () => {
	it('Home 跳到流程開頭、End 跳到流程結尾', async () => {
		setup();
		expect(await fireEvent.keyDown(window, { key: 'End' })).toBe(false);
		const clock = document.querySelector('.clock')!.textContent!;
		const [now, total] = clock.split('/').map((s) => s.trim());
		expect(now).toBe(total);
		await fireEvent.keyDown(window, { key: 'Home' });
		expect(position()).toBe('音樂 1 1-1');
		// 輸入框裡的 Home／End 是移游標
		await fireEvent.keyDown(screen.getByLabelText('延遲校正（毫秒）'), { key: 'End' });
		expect(position()).toBe('音樂 1 1-1');
	});

	it('分頁可以用左右方向鍵切換，焦點跟著走；播放頭不動', async () => {
		setup();
		tab('動作').focus();
		await fireEvent.keyDown(tab('動作'), { key: 'ArrowRight' });
		expect(tab('隊員').getAttribute('aria-selected')).toBe('true');
		expect(document.activeElement).toBe(tab('隊員'));
		await fireEvent.keyDown(tab('隊員'), { key: 'ArrowRight' });
		expect(tab('動作').getAttribute('aria-selected')).toBe('true');
		await fireEvent.keyDown(tab('動作'), { key: 'ArrowLeft' });
		expect(tab('隊員').getAttribute('aria-selected')).toBe('true');
		expect(document.activeElement).toBe(tab('隊員'));
		expect(position()).toBe('音樂 1 1-1');
	});
});

describe('練習畫面維持現在的快捷鍵規則', () => {
	it('空白鍵、Home／End、⌘Z 都不動；⌘S 照樣存（在 practice 測）', async () => {
		const session = setup();
		await fireEvent.click(tab('隊員'));
		await fireEvent.change(screen.getByLabelText('第 1 位隊員的名字'), { target: { value: '美' } });
		await fireEvent.click(screen.getByRole('button', { name: '練習' }));
		await fireEvent.keyDown(window, { key: ' ' });
		await fireEvent.keyDown(window, { key: 'End' });
		await fireEvent.keyDown(window, { key: 'z', metaKey: true });
		expect(session.flow!.members[0].name).toBe('美');
		await fireEvent.click(screen.getByRole('button', { name: '編排' }));
		expect(playing()).toBe(false);
		expect(position()).toBe('音樂 1 1-1');
	});
});
