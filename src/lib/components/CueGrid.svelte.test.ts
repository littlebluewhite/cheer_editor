import {
	addAction,
	addMembers,
	addSegment,
	createFlow,
	enableSuccessRate,
	markPhaseBeats,
	updateSegment,
	type CommandResult,
	type Flow
} from '#lib/core';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import CueGrid from './CueGrid.svelte';

function flowOf(r: CommandResult): Flow {
	if (r.kind !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(r)}`);
	return r.flow;
}

/** 音樂 1（4 個八拍）；動作從 3-3 到 4-2（8 拍）。 */
function sample(): Flow {
	let flow = flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));
	flow = flowOf(addMembers(flow, [{ name: '小A', gender: 'F', globalRole: 'top' }]));
	flow = flowOf(addSegment(flow, 'music'));
	flow = flowOf(updateSegment(flow, 's1', { eights: 4, lastBeats: 8 }));
	const members = [{ memberId: 'm1', role: null }];
	return flowOf(
		addAction(flow, { segmentId: 's1', start: 36, length: 16, category: 'stunt', name: '', note: '', members })
	);
}

/**
 * jsdom 不算版面（ADR 0002），所以換一個假的「指標位置 → 格子」：
 * clientX 是第幾個格子（照畫面順序：3-1…3-8、4-1…4-8），clientY 是第幾條（0 數字格、1 拍子、2 步驟、3 手位）。
 */
function cellAt(sheet: HTMLElement, x: number, y: number): HTMLElement {
	const kind = ['.cell', '.slot.count', '.slot.step', '.slot.motion'][y];
	return sheet.querySelectorAll<HTMLElement>(kind)[x];
}

function setup() {
	const flow = sample();
	const onchange = vi.fn();
	render(CueGrid, { flow, action: flow.actions[0], onchange, cellAt });
	const grid = within(screen.getByRole('group', { name: '拍點' }));
	const pop = () => grid.queryByRole('dialog', { name: '拍點小窗' });
	const selText = () => within(grid.getByRole('dialog', { name: '拍點小窗' })).getByText(/^選了/).textContent;
	return { grid, onchange, selText, pop };
}

/** 照畫面順序第幾格（3-1 是 0）。 */
const idx = (label: string) => {
	const [e, c] = label.split('-').map(Number);
	return (e - 3) * 8 + c - 1;
};

async function drag(el: Element, from: number, to: number, y = 0) {
	await fireEvent.pointerDown(el, { clientX: from, clientY: y, button: 0, pointerId: 1 });
	await fireEvent.pointerMove(el, { clientX: to, clientY: y, pointerId: 1 });
	await fireEvent.pointerUp(el, { clientX: to, clientY: y, pointerId: 1 });
}

describe('拍點格子：拖拉選拍', () => {
	it('在 3-5 按住拖到 3-6，選了 2 拍；點 down 就放好 2 拍', async () => {
		const { grid, onchange, selText } = setup();
		await drag(grid.getByRole('button', { name: '3-5' }), idx('3-5'), idx('3-6'));
		expect(selText()).toBe('選了 3-5 到 3-6・2 拍');
		await fireEvent.click(grid.getByRole('button', { name: 'down' }));
		expect(onchange.mock.calls[0][0].actions[0].cues).toEqual([
			{ kind: 'count', at: 4, len: 4, word: 'down', who: null }
		]);
	});

	it('往回拖也可以：從 4-1 拖回 3-7', async () => {
		const { grid, selText } = setup();
		await drag(grid.getByRole('button', { name: '4-1' }), idx('4-1'), idx('3-7'));
		expect(selText()).toBe('選了 3-7 到 4-1・3 拍');
	});

	it('拖完放開後瀏覽器補發的 click 不會把選取改回一格', async () => {
		const { grid, selText } = setup();
		const cell = grid.getByRole('button', { name: '3-5' });
		await drag(cell, idx('3-5'), idx('3-8'));
		await fireEvent.click(cell, { detail: 1 });
		expect(selText()).toBe('選了 3-5 到 3-8・4 拍');
	});

	it('每一條拍點條的空格上也能拖', async () => {
		const { selText } = setup();
		const slots = (kind: string) => screen.getByRole('group', { name: '拍點' }).querySelectorAll(`.slot.${kind}`);
		await drag(slots('count')[idx('3-4')], idx('3-4'), idx('3-6'), 1);
		expect(selText()).toBe('選了 3-4 到 3-6・3 拍');
		await drag(slots('step')[idx('3-7')], idx('3-7'), idx('3-5'), 2);
		expect(selText()).toBe('選了 3-5 到 3-7・3 拍');
		await drag(slots('motion')[idx('4-1')], idx('4-1'), idx('4-2'), 3);
		expect(selText()).toBe('選了 4-1 到 4-2・2 拍');
	});

	it('拖到動作外面，選取停在動作的最後一拍或第一拍', async () => {
		const { grid, selText } = setup();
		await drag(grid.getByRole('button', { name: '3-5' }), idx('3-5'), idx('4-8'));
		expect(selText()).toBe('選了 3-5 到 4-2・6 拍');
		await drag(grid.getByRole('button', { name: '3-5' }), idx('3-5'), idx('3-1'));
		expect(selText()).toBe('選了 3-3 到 3-5・3 拍');
	});

	it('從動作外面（變淡的格子）按下不會開始選，也不會跳出拍點小窗', async () => {
		const { grid, pop } = setup();
		const slot = screen.getByRole('group', { name: '拍點' }).querySelectorAll('.slot.count')[idx('4-5')];
		await drag(slot, idx('4-5'), idx('3-6'), 1);
		expect(pop()).toBeNull();
		expect(grid.getByRole('button', { name: '3-6' }).getAttribute('aria-pressed')).toBe('false');
	});

	it('手指：在沒選到的格子上滑是捲畫面，不選；放開才選這一拍', async () => {
		const { grid, selText, pop } = setup();
		const cell = grid.getByRole('button', { name: '3-5' });
		const touch = { button: 0, pointerType: 'touch', pointerId: 4, clientY: 0 };
		await fireEvent.pointerDown(cell, { ...touch, clientX: idx('3-5') });
		await fireEvent.pointerCancel(cell, touch);
		expect(pop()).toBeNull();
		expect(cell.getAttribute('aria-pressed')).toBe('false');

		await fireEvent.pointerDown(cell, { ...touch, clientX: idx('3-5') });
		await fireEvent.pointerUp(cell, { ...touch, clientX: idx('3-5') });
		await fireEvent.click(cell);
		expect(selText()).toBe('選了 3-5・1 拍');
	});

	it('手指：從選到的格子拖過去，選一整段', async () => {
		const { grid, selText } = setup();
		const cell = grid.getByRole('button', { name: '3-5' });
		await fireEvent.click(cell);
		const touch = { button: 0, pointerType: 'touch', pointerId: 4, clientY: 0 };
		await fireEvent.pointerDown(cell, { ...touch, clientX: idx('3-5') });
		await fireEvent.pointerMove(cell, { ...touch, clientX: idx('3-7') });
		await fireEvent.pointerUp(cell, { ...touch, clientX: idx('3-7') });
		await fireEvent.click(cell);
		expect(selText()).toBe('選了 3-5 到 3-7・3 拍');
	});

	it('不能拖的人照樣用點一格加 ＋、－', async () => {
		const { grid, selText } = setup();
		await fireEvent.click(grid.getByRole('button', { name: '3-5' }));
		await fireEvent.click(grid.getByRole('button', { name: '多選一拍' }));
		await fireEvent.click(grid.getByRole('button', { name: '多選一拍' }));
		await fireEvent.click(grid.getByRole('button', { name: '少選一拍' }));
		expect(selText()).toBe('選了 3-5 到 3-6・2 拍');
	});
});

describe('拍點格子：拍點小窗', () => {
	it('還沒選拍時看不到小窗，格子下面也沒有放拍點的按鈕；點一格就跳出小窗', async () => {
		const { grid, pop, selText } = setup();
		expect(pop()).toBeNull();
		expect(grid.queryByRole('button', { name: 'down' })).toBeNull();
		await fireEvent.click(grid.getByRole('button', { name: '3-5' }));
		expect(selText()).toBe('選了 3-5・1 拍');
		expect(within(pop()!).getByRole('button', { name: 'down' })).toBeTruthy();
	});

	it('拖拉選拍，放開才跳出小窗', async () => {
		const { grid, pop } = setup();
		const cell = grid.getByRole('button', { name: '3-5' });
		await fireEvent.pointerDown(cell, { clientX: idx('3-5'), clientY: 0, button: 0, pointerId: 1 });
		await fireEvent.pointerMove(cell, { clientX: idx('3-7'), clientY: 0, pointerId: 1 });
		expect(pop()).toBeNull();
		await fireEvent.pointerUp(cell, { clientX: idx('3-7'), clientY: 0, pointerId: 1 });
		expect(pop()).not.toBeNull();
	});

	it('點一格，再按住 Shift 點另一格，選一整段（往前點也可以）', async () => {
		const { grid, selText } = setup();
		await fireEvent.click(grid.getByRole('button', { name: '3-5' }));
		await fireEvent.click(grid.getByRole('button', { name: '4-1' }), { shiftKey: true });
		expect(selText()).toBe('選了 3-5 到 4-1・5 拍');
		await fireEvent.click(grid.getByRole('button', { name: '3-3' }), { shiftKey: true });
		expect(selText()).toBe('選了 3-3 到 3-5・3 拍');
	});

	it('Shift 按著拖，也是從上次點的那一格選起', async () => {
		const { grid, selText } = setup();
		await fireEvent.click(grid.getByRole('button', { name: '3-4' }));
		const cell = grid.getByRole('button', { name: '3-7' });
		await fireEvent.pointerDown(cell, { clientX: idx('3-7'), clientY: 0, button: 0, pointerId: 1, shiftKey: true });
		await fireEvent.pointerUp(cell, { clientX: idx('3-7'), clientY: 0, pointerId: 1 });
		expect(selText()).toBe('選了 3-4 到 3-7・4 拍');
	});

	it('按 Esc 或 ✕ 關掉小窗；Esc 不會傳出去', async () => {
		const { grid, pop } = setup();
		const outer = vi.fn();
		window.addEventListener('keydown', outer);
		await fireEvent.click(grid.getByRole('button', { name: '3-5' }));
		await fireEvent.keyDown(document.body, { key: 'Escape' });
		expect(pop()).toBeNull();
		expect(outer).not.toHaveBeenCalled();
		await fireEvent.click(grid.getByRole('button', { name: '3-5' }));
		await fireEvent.click(within(pop()!).getByRole('button', { name: '關掉' }));
		expect(pop()).toBeNull();
		window.removeEventListener('keydown', outer);
	});

	it('中文輸入法還在選字時按 Esc，只取消選字，小窗不關', async () => {
		const { grid, pop } = setup();
		await fireEvent.click(grid.getByRole('button', { name: '3-5' }));
		const input = within(pop()!).getByRole('textbox', { name: '自己打步驟' });
		await fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
		await fireEvent.keyDown(input, { key: 'Escape', keyCode: 229 });
		expect(pop()).not.toBeNull();
	});

	it('在格子外面按一下，小窗關掉；在小窗裡按不會關', async () => {
		const { grid, pop } = setup();
		await fireEvent.click(grid.getByRole('button', { name: '3-5' }));
		await fireEvent.pointerDown(within(pop()!).getByRole('button', { name: '多選一拍' }));
		expect(pop()).not.toBeNull();
		await fireEvent.pointerDown(document.body);
		expect(pop()).toBeNull();
	});

	it('點一個已經放好的拍點，選回它佔的拍，也跳出小窗', async () => {
		const flow = sample();
		const action = { ...flow.actions[0], cues: [{ kind: 'count' as const, at: 4, len: 4, word: 'down', who: null }] };
		render(CueGrid, { flow: { ...flow, actions: [action] }, action, onchange: vi.fn(), cellAt });
		const grid = within(screen.getByRole('group', { name: '拍點' }));
		await fireEvent.click(grid.getByRole('button', { name: /^拍子 down/ }));
		const pop = grid.getByRole('dialog', { name: '拍點小窗' });
		expect(within(pop).getByText(/^選了/).textContent).toBe('選了 3-5 到 3-6・2 拍');
	});

	it('給誰在小窗裡選：選了隊員再放，拍點給那個人', async () => {
		const { grid, onchange } = setup();
		await fireEvent.click(grid.getByRole('button', { name: '3-5' }));
		await fireEvent.change(grid.getByRole('combobox', { name: '給誰' }), { target: { value: '1' } });
		await fireEvent.click(grid.getByRole('button', { name: 'up' }));
		expect(onchange.mock.calls[0][0].actions[0].cues).toEqual([
			{ kind: 'count', at: 4, len: 2, word: 'up', who: { member: 'm1' } }
		]);
	});
});

describe('環節那一列', () => {
	it('動作拖到半拍上：相鄰的環節各佔自己的格子，不疊在一起', () => {
		let flow = flowOf(enableSuccessRate(sample(), 'x1'));
		flow = flowOf(markPhaseBeats(flow, 'x1', { phaseId: 'p1' }, 0, 2));
		flow = flowOf(markPhaseBeats(flow, 'x1', { phaseId: 'p2' }, 2, 2));
		flow = { ...flow, actions: flow.actions.map((a) => ({ ...a, start: 37 })) };
		render(CueGrid, { flow, action: flow.actions[0], onchange: vi.fn(), cellAt });
		const columns = [...document.querySelectorAll<HTMLElement>('.item.phase')].map((b) => b.style.gridColumn);
		expect(columns).toEqual(['4 / 5', '5 / 6']);
	});
});
