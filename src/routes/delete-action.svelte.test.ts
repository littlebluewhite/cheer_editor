// 刪動作不再無聲無息（#134）：拍點格子、小窗、動作表單裡按 Delete／Backspace 不刪整個動作；
// 名詞對照表開著時快捷鍵不穿過去；刪了動作有「已刪掉…・復原」提示，有反悔按鈕的提示留 10 秒、滑鼠在上面時不收。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { placeCue } from '#lib/core';
import { editorPage } from '#lib/test-fakes.js';
import { flowOf, libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

/** 範例流程（Lib：小美、小A、小B、小芳）；Lib 的 1-1 放 down、1-3 放 up。點泳道上 Lib 的色條選到它。 */
async function setup() {
	let flow = flowOf(placeCue(libSample(), 'x1', { kind: 'count', at: 0, len: 2, word: 'down' }));
	flow = flowOf(placeCue(flow, 'x1', { kind: 'count', at: 4, len: 2, word: 'up' }));
	const { session, props } = editorPage(flow);
	render(Page, props);
	await fireEvent.click(bar()!);
	return session;
}

const bar = () => document.querySelector('[data-lane="m1"] [data-action-id="x1"]');
const grid = () => within(screen.getByRole('group', { name: '拍點' }));
const position = () => screen.getByLabelText('目前位置').textContent;
const playing = () => !!screen.queryByRole('button', { name: '暫停' });

/** 焦點放在 el 上按 key。 */
async function press(el: HTMLElement, key: string) {
	el.focus();
	await fireEvent.keyDown(el, { key });
}

describe('拍點格子、小窗、動作表單裡的 Delete／Backspace', () => {
	it('在拍點格子選一拍按 Delete：只清掉那一拍的拍點，動作還在', async () => {
		const session = await setup();
		await fireEvent.click(grid().getByRole('button', { name: '1-1' }));
		await press(grid().getByRole('button', { name: '1-1' }), 'Delete');
		expect(bar()).not.toBeNull();
		expect(session.flow!.actions[0].cues?.map((c) => c.word)).toEqual(['up']);
	});

	it('焦點在拍點小窗裡按 Backspace：一樣只清掉選的拍點', async () => {
		const session = await setup();
		await fireEvent.click(grid().getByRole('button', { name: '1-3' }));
		const pop = within(screen.getByRole('dialog', { name: '拍點小窗' }));
		await press(pop.getByRole('button', { name: '多選一拍' }), 'Backspace');
		expect(bar()).not.toBeNull();
		expect(session.flow!.actions[0].cues?.map((c) => c.word)).toEqual(['down']);
	});

	it('在動作表單 × 掉一個人後按 Backspace：動作還在', async () => {
		const session = await setup();
		// 點下去焦點在 × 上；這一列拿掉之後焦點不能掉到頁面上
		const x = screen.getByRole('button', { name: '把 小A 移出這個動作' });
		x.focus();
		await fireEvent.click(x);
		await fireEvent.keyDown(document.activeElement ?? window, { key: 'Backspace' });
		expect(bar()).not.toBeNull();
		expect(session.flow!.actions).toHaveLength(1);
		expect(session.flow!.actions[0].members).toHaveLength(3);
	});
});

describe('名詞對照表開著時', () => {
	it('Delete、方向鍵、Home／End、數字鍵、空白鍵都不動到底下的編輯畫面', async () => {
		const session = await setup();
		await fireEvent.keyDown(window, { key: 'ArrowRight' });
		const at = position();
		const before = session.flow;
		await fireEvent.click(screen.getByRole('button', { name: '名詞對照表' }));
		const dialog = screen.getByRole('dialog', { name: '名詞對照表' });
		for (const key of ['Delete', 'Backspace', 'ArrowRight', 'ArrowLeft', 'Home', 'End', '1', ' ']) {
			await fireEvent.keyDown(document.activeElement ?? dialog, { key });
		}
		expect(session.flow).toBe(before);
		expect(bar()).not.toBeNull();
		expect(position()).toBe(at);
		expect(playing()).toBe(false);
	});
});

describe('刪動作的提示', () => {
	it('在泳道選動作按 Delete：刪掉、提示「已刪掉動作 技巧·Lib」，按「復原」動作回來', async () => {
		await setup();
		await fireEvent.keyDown(window, { key: 'Delete' });
		expect(bar()).toBeNull();
		expect(screen.getByRole('status').textContent).toBe('已刪掉動作 技巧·Lib');
		await fireEvent.click(screen.getByRole('button', { name: '復原刪掉的動作' }));
		expect(bar()).not.toBeNull();
		expect(screen.queryByRole('status')).toBeNull();
	});

	it('表單的「刪除動作」也一樣有提示和復原', async () => {
		await setup();
		await fireEvent.click(screen.getByRole('button', { name: '刪除動作' }));
		expect(bar()).toBeNull();
		expect(screen.getByRole('status').textContent).toBe('已刪掉動作 技巧·Lib');
		await fireEvent.click(screen.getByRole('button', { name: '復原刪掉的動作' }));
		expect(bar()).not.toBeNull();
	});

	it('有「復原」的提示留 10 秒；滑鼠在上面時不收，移開了把剩下的時間走完', async () => {
		await setup();
		vi.useFakeTimers();
		try {
			await fireEvent.keyDown(window, { key: 'Delete' });
			await vi.advanceTimersByTimeAsync(9000);
			expect(screen.getByRole('status')).toBeTruthy();
			await vi.advanceTimersByTimeAsync(1500);
			expect(screen.queryByRole('status')).toBeNull();

			await fireEvent.click(screen.getByRole('button', { name: '復原' }));
			await fireEvent.click(bar()!);
			await fireEvent.keyDown(window, { key: 'Delete' });
			await vi.advanceTimersByTimeAsync(3000);
			const toast = screen.getByRole('status').parentElement!;
			await fireEvent.pointerEnter(toast);
			await vi.advanceTimersByTimeAsync(30000);
			expect(screen.getByRole('status')).toBeTruthy();
			await fireEvent.pointerLeave(toast);
			await vi.advanceTimersByTimeAsync(6500);
			expect(screen.getByRole('status')).toBeTruthy();
			await vi.advanceTimersByTimeAsync(1000);
			expect(screen.queryByRole('status')).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});
});
