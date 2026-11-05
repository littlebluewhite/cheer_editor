import {
	addAction,
	addMembers,
	addSegment,
	createFlow,
	addPhase,
	PHASE_COLORS,
	toSeconds,
	updateAction,
	updatePhase,
	updateSegment,
	type Flow
} from '#lib/core';
import { flowOf } from '#lib/test-flows.js';
import TestSession from '#lib/TestSession.svelte';
import { fakeCellAt, testEditor } from '#lib/test-fakes.js';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import CueGrid from './CueGrid.svelte';

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

/** 放一個帶著 flow 的 session 進 context，畫第一個動作的拍點格子；回傳 session。 */
function renderGrid(flow: Flow, playheadSec?: number) {
	const { editor, session } = testEditor(flow);
	render(TestSession, {
		props: { editor, component: CueGrid, props: { action: flow.actions[0], cellAt: fakeCellAt, playheadSec } }
	});
	return session;
}

function setup() {
	const session = renderGrid(sample());
	const grid = within(screen.getByRole('group', { name: '拍點' }));
	const pop = () => grid.queryByRole('dialog', { name: '拍點小窗' });
	const selText = () => within(grid.getByRole('dialog', { name: '拍點小窗' })).getByText(/^選了/).textContent;
	return { grid, session, selText, pop };
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
		const { grid, session, selText } = setup();
		await drag(grid.getByRole('button', { name: '3-5' }), idx('3-5'), idx('3-6'));
		expect(selText()).toBe('選了 3-5 到 3-6・2 拍');
		await fireEvent.click(grid.getByRole('button', { name: 'down' }));
		expect(session.flow!.actions[0].cues).toEqual([
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
		await fireEvent.click(within(pop()!).getByRole('button', { name: '關閉' }));
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
		renderGrid({ ...flow, actions: [action] });
		const grid = within(screen.getByRole('group', { name: '拍點' }));
		await fireEvent.click(grid.getByRole('button', { name: /^拍子 down/ }));
		const pop = grid.getByRole('dialog', { name: '拍點小窗' });
		expect(within(pop).getByText(/^選了/).textContent).toBe('選了 3-5 到 3-6・2 拍');
	});

	it('給誰在小窗裡選：選了隊員再放，拍點給那個人', async () => {
		const { grid, session } = setup();
		await fireEvent.click(grid.getByRole('button', { name: '3-5' }));
		await fireEvent.change(grid.getByRole('combobox', { name: '給誰' }), { target: { value: '1' } });
		await fireEvent.click(grid.getByRole('button', { name: 'up' }));
		expect(session.flow!.actions[0].cues).toEqual([
			{ kind: 'count', at: 4, len: 2, word: 'up', who: { member: 'm1' } }
		]);
	});
});

describe('從 & 開始的拍點', () => {
	/** 動作拖到 3-3&（start 37）：拍子 up 給小A 從 3-3& 到 3-4&、down 給全部從 3-4& 到 3-5&。 */
	function offbeat() {
		const flow = sample();
		const cues = [
			{ kind: 'count' as const, at: 0, len: 2, word: 'up', who: { member: 'm1' } },
			{ kind: 'count' as const, at: 2, len: 2, word: 'down', who: null }
		];
		const session = renderGrid({ ...flow, actions: [{ ...flow.actions[0], start: 37, cues }] });
		const grid = within(screen.getByRole('group', { name: '拍點' }));
		return { session, grid, cues };
	}

	it('只塗半格：從 3-3 的後半格塗到 3-4 的前半格', () => {
		const { grid } = offbeat();
		const up = grid.getByRole('button', { name: /^拍子 up/ });
		const cell = (name: string) => grid.getByRole('button', { name }).style.gridColumn;
		// 一格佔兩欄（前半、後半）
		expect(cell('3-3')).toBe('6 / span 2');
		expect(cell('3-4')).toBe('8 / span 2');
		expect(up.style.gridColumn).toBe('7 / 9');
	});

	it('點它選回它原本的範圍，給誰也換成它的；換字只換掉它，旁邊的拍點不動', async () => {
		const { grid, session, cues } = offbeat();
		await fireEvent.click(grid.getByRole('button', { name: /^拍子 up/ }));
		const pop = within(grid.getByRole('dialog', { name: '拍點小窗' }));
		expect(pop.getByText(/^選了/).textContent).toBe('選了 3-3&・1 拍');
		expect((pop.getByRole('combobox', { name: '給誰' }) as HTMLSelectElement).value).toBe('1');
		await fireEvent.click(pop.getByRole('button', { name: 'down' }));
		expect(session.flow!.actions[0].cues).toEqual([
			{ kind: 'count', at: 0, len: 2, word: 'down', who: { member: 'm1' } },
			cues[1]
		]);
	});

	it('選到的半格塗半格', async () => {
		const { grid } = offbeat();
		await fireEvent.click(grid.getByRole('button', { name: /^拍子 up/ }));
		const cell = (name: string) => grid.getByRole('button', { name });
		expect(cell('3-3').classList.contains('right')).toBe(true);
		expect(cell('3-4').classList.contains('left')).toBe(true);
		expect(cell('3-4').getAttribute('aria-pressed')).toBe('true');
		expect(cell('3-5').getAttribute('aria-pressed')).toBe('false');
	});
});

describe('現在播到的那一拍', () => {
	it('播放頭在 3-5& 時，3-5 那一格有標記；別格沒有', () => {
		const flow = sample();
		renderGrid(flow, toSeconds(flow, { segmentId: 's1', at: 41 }));
		const grid = within(screen.getByRole('group', { name: '拍點' }));
		expect(grid.getByRole('button', { name: '3-5' }).getAttribute('aria-current')).toBe('time');
		expect(document.querySelectorAll('[aria-current]')).toHaveLength(1);
	});

	it('播放頭不在這個動作的八拍裡，就沒有標記', () => {
		const flow = sample();
		renderGrid(flow, toSeconds(flow, { segmentId: 's1', at: 4 }));
		expect(document.querySelectorAll('[aria-current]')).toHaveLength(0);
	});
});

describe('方向鍵', () => {
	it('左右移選取；Shift 加方向鍵延長選取，焦點跟著走', async () => {
		const { grid, selText } = setup();
		const cell = (name: string) => grid.getByRole('button', { name });
		await fireEvent.click(cell('3-5'));
		await fireEvent.keyDown(cell('3-5'), { key: 'ArrowRight' });
		expect(selText()).toBe('選了 3-6・1 拍');
		expect(document.activeElement).toBe(cell('3-6'));
		await fireEvent.keyDown(cell('3-6'), { key: 'ArrowRight', shiftKey: true });
		await fireEvent.keyDown(cell('3-7'), { key: 'ArrowRight', shiftKey: true });
		expect(selText()).toBe('選了 3-6 到 3-8・3 拍');
		expect(document.activeElement).toBe(cell('3-8'));
		await fireEvent.keyDown(cell('3-8'), { key: 'ArrowLeft', shiftKey: true });
		expect(selText()).toBe('選了 3-6 到 3-7・2 拍');
		await fireEvent.keyDown(cell('3-7'), { key: 'ArrowLeft' });
		expect(selText()).toBe('選了 3-5・1 拍');
	});

	it('到動作頭尾就停住', async () => {
		const { grid, selText } = setup();
		await fireEvent.click(grid.getByRole('button', { name: '3-3' }));
		await fireEvent.keyDown(grid.getByRole('button', { name: '3-3' }), { key: 'ArrowLeft' });
		expect(selText()).toBe('選了 3-3・1 拍');
		await fireEvent.click(grid.getByRole('button', { name: '4-2' }));
		await fireEvent.keyDown(grid.getByRole('button', { name: '4-2' }), { key: 'ArrowRight', shiftKey: true });
		expect(selText()).toBe('選了 4-2・1 拍');
	});
});

describe('環節那一列', () => {
	it('動作拖到半拍上：相鄰的環節各佔自己的格子，不疊在一起', () => {
		let flow = flowOf(addPhase(sample(), 'x1', { kind: 'load', name: '', beats: { at: 0, len: 2 } }));
		flow = flowOf(addPhase(flow, 'x1', { kind: 'hold', name: '', beats: { at: 2, len: 2 } }));
		flow = flowOf(updateAction(flow, 'x1', { start: 37 }));
		renderGrid(flow);
		const columns = [...document.querySelectorAll<HTMLElement>('.item.phase')].map((b) => b.style.gridColumn);
		expect(columns).toEqual(['8 / 10', '10 / 12']);
	});

	it('動作拖到半拍上：點環節選回它那一格，清掉就刪掉它，隔壁的環節還在', async () => {
		let flow = flowOf(addPhase(sample(), 'x1', { kind: 'load', name: '', beats: { at: 0, len: 2 } }));
		flow = flowOf(addPhase(flow, 'x1', { kind: 'hold', name: '', beats: { at: 2, len: 2 } }));
		flow = flowOf(updateAction(flow, 'x1', { start: 37 }));
		const session = renderGrid(flow);
		const grid = within(screen.getByRole('group', { name: '拍點' }));
		await fireEvent.click(grid.getByRole('button', { name: /^環節 上法/ }));
		const pop = within(grid.getByRole('dialog', { name: '拍點小窗' }));
		expect(pop.getByText(/^選了/).textContent).toBe('選了 3-4・1 拍');
		await fireEvent.click(pop.getByRole('button', { name: '清掉環節' }));
		const phases = session.flow!.actions[0].successRate!.phases;
		expect(phases.map((p) => [p.id, p.beats])).toEqual([['p2', { at: 3, len: 2 }]]);
	});
});

describe('改環節', () => {
	/** 3-3 到 3-4 上法「延伸」（紅色）、3-5 到 3-6 中段。 */
	function phased() {
		let flow = flowOf(addPhase(sample(), 'x1', { kind: 'load', name: '延伸', beats: { at: 0, len: 4 } }));
		flow = flowOf(updatePhase(flow, 'x1', 'p1', { color: '#c62828' }));
		flow = flowOf(addPhase(flow, 'x1', { kind: 'hold', name: '', beats: { at: 4, len: 4 } }));
		const session = renderGrid(flow);
		const grid = within(screen.getByRole('group', { name: '拍點' }));
		const edit = () => within(grid.getByRole('dialog', { name: '拍點小窗' })).queryByRole('group', { name: '改環節' });
		/** session 現在的流程裡的環節。 */
		const sent = () => session.flow!.actions[0].successRate!.phases;
		return { grid, edit, sent };
	}

	it('點環節的色條：小窗看得到它現在的名字、種類、顏色', async () => {
		const { grid, edit } = phased();
		await fireEvent.click(grid.getByRole('button', { name: /^環節 上法 延伸/ }));
		const box = within(edit()!);
		expect((box.getByRole('textbox', { name: '這個環節的名字' }) as HTMLInputElement).value).toBe('延伸');
		expect((box.getByRole('combobox', { name: '這個環節的種類' }) as HTMLSelectElement).value).toBe('load');
		expect((box.getByRole('combobox', { name: '這個環節的顏色' }) as HTMLSelectElement).value).toBe('#c62828');
	});

	it('改名字（頭尾空白去掉）', async () => {
		const { grid, edit, sent } = phased();
		await fireEvent.click(grid.getByRole('button', { name: /^環節 上法 延伸/ }));
		await fireEvent.change(within(edit()!).getByRole('textbox', { name: '這個環節的名字' }), {
			target: { value: '  撐高 ' }
		});
		expect(sent()[0]).toEqual({ id: 'p1', kind: 'load', name: '撐高', color: '#c62828', beats: { at: 0, len: 4 } });
	});

	it('改種類', async () => {
		const { grid, edit, sent } = phased();
		await fireEvent.click(grid.getByRole('button', { name: /^環節 中段/ }));
		await fireEvent.change(within(edit()!).getByRole('combobox', { name: '這個環節的種類' }), {
			target: { value: 'dismount' }
		});
		expect(sent()[1]).toEqual({ id: 'p2', kind: 'dismount', name: '', beats: { at: 4, len: 4 } });
	});

	it('顏色只能挑照種類、辨識色或石板灰；挑照種類就回到種類的顏色', async () => {
		const { grid, edit, sent } = phased();
		await fireEvent.click(grid.getByRole('button', { name: /^環節 中段/ }));
		const color = within(edit()!).getByRole('combobox', { name: '這個環節的顏色' }) as HTMLSelectElement;
		expect([...color.options].map((o) => o.value)).toEqual(['', ...PHASE_COLORS.map((c) => c.value)]);
		expect(color.value).toBe('');
		await fireEvent.change(color, { target: { value: '#475569' } });
		expect(sent()[1].color).toBe('#475569');

		await fireEvent.click(grid.getByRole('button', { name: /^環節 上法 延伸/ }));
		await fireEvent.change(within(edit()!).getByRole('combobox', { name: '這個環節的顏色' }), {
			target: { value: '' }
		});
		expect(sent()[0]).toEqual({ id: 'p1', kind: 'load', name: '延伸', beats: { at: 0, len: 4 } });
	});

	it('選的拍不是剛好一個環節時，不出現改的地方', async () => {
		const { grid, edit } = phased();
		await fireEvent.click(grid.getByRole('button', { name: '3-3' }));
		expect(edit()).toBeNull();
		await fireEvent.click(grid.getByRole('button', { name: '3-6' }), { shiftKey: true });
		expect(edit()).toBeNull();
		await fireEvent.click(grid.getByRole('button', { name: '3-7' }));
		expect(edit()).toBeNull();
		await fireEvent.click(grid.getByRole('button', { name: '3-5' }));
		await fireEvent.click(grid.getByRole('button', { name: '3-6' }), { shiftKey: true });
		expect(edit()).not.toBeNull();
	});
});
