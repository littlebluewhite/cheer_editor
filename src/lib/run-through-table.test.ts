// 全上表正在記的：從編輯 session 拿一張表，點格子、按沒做，看每一欄會存下來的樣子、要存的是哪些、有沒有改過。
import { describe, expect, it } from 'vitest';
import { attemptWhos, type Action, type Flow } from '#lib/core';
import { pyramidSample, ratedSample } from '#lib/test-flows.js';
import { EditorSession } from './editor-session.svelte.js';

/** 一個 session 和它的全上表；mine 說哪一欄是我記的（預設每一欄都是）。 */
function setup(flow: Flow = ratedSample(), mine: (action: Action, who: string) => boolean = () => true) {
	const s = new EditorSession(flow);
	const table = s.drill.runThrough(() => s.flow!, mine);
	const action = (index: number) => s.flow!.actions[index];
	const who = (index: number, n = 0) => attemptWhos(s.flow!, action(index))[n].who;
	/** 第 index 個動作第 n 欄的格子，照環節順序。 */
	const column = (index: number, n = 0) => table.column(action(index), who(index, n));
	/** 點第 index 個動作第 n 欄的一個環節 times 次。 */
	const tap = (index: number, phaseId: string, times = 1, n = 0) => {
		for (let i = 0; i < times; i++) table.tap(action(index), who(index, n), phaseId);
	};
	return { s, table, action, who, column, tap };
}

describe('全上表正在記的', () => {
	it('每格先是 ✓；點一下換 △、✗、再回 ✓', () => {
		const { column, tap } = setup();
		expect(column(0)).toEqual(['✓', '✓', '✓']);
		tap(0, 'p3');
		expect(column(0)).toEqual(['✓', '✓', '△']);
		tap(0, 'p3');
		expect(column(0)).toEqual(['✓', '✓', '✗']);
		tap(0, 'p3');
		expect(column(0)).toEqual(['✓', '✓', '✓']);
	});

	it('變 ✗ 同一組後面按不了的變空，別組不動；改回來回到 ✓', () => {
		const { column, tap } = setup();
		tap(0, 'p3', 2, 1);
		tap(0, 'p2', 2);
		expect(column(0)).toEqual(['✓', '✗', null]);
		expect(column(0, 1)).toEqual(['✓', '✓', '✗']);
		tap(0, 'p2');
		expect(column(0)).toEqual(['✓', '✓', '✓']);
	});

	it('金字塔：之後才開始的變空，佔同樣拍的留著；改回來變空的回到 ✓', () => {
		const { column, tap } = setup(pyramidSample());
		tap(1, 'p6', 2);
		expect(column(1)).toEqual(['✓', '✓', '✗', null, null]);
		tap(1, 'p6');
		expect(column(1)).toEqual(['✓', '✓', '✓', '✓', '✓']);
	});

	it('金字塔：✗ 之前點過、之後才開始的清掉（改回來是 ✓ 不是 △）；佔同樣拍的記號留著', () => {
		const { column, tap } = setup(pyramidSample());
		tap(1, 'p7');
		tap(1, 'p5');
		tap(1, 'p6', 2);
		expect(column(1)).toEqual(['✓', '△', '✗', null, null]);
		tap(1, 'p6');
		expect(column(1)).toEqual(['✓', '△', '✓', '✓', '✓']);
	});

	it('「這個沒做」：整個動作變空、那個動作不存；再按一次回來', () => {
		const { table, action, column } = setup();
		table.toggleSkip(action(1).id);
		expect(table.skipped(action(1).id)).toBe(true);
		expect(column(1)).toEqual([null]);
		expect(table.entries.map((e) => e.actionId)).toEqual(['x1', 'x1']);
		table.toggleSkip(action(1).id);
		expect(column(1)).toEqual(['✓']);
		expect(table.entries.map((e) => e.actionId)).toEqual(['x1', 'x1', 'x2', 'x2']);
	});

	it('「後面都沒做」：這個和後面的都沒做；再按一次全部回來', () => {
		const { table, action } = setup();
		table.toggleRest(action(0).id);
		expect(table.restSkipped(action(0).id)).toBe(true);
		expect([table.skipped('x1'), table.skipped('x2')]).toEqual([true, true]);
		expect(table.entries).toEqual([]);
		table.toggleRest(action(0).id);
		expect([table.skipped('x1'), table.skipped('x2')]).toEqual([false, false]);
	});

	it('「後面都沒做」只蓋到這個和後面的：前面的不動', () => {
		const { table, action } = setup();
		table.toggleRest(action(1).id);
		expect([table.skipped('x1'), table.skipped('x2')]).toEqual([false, true]);
		expect(table.restSkipped(action(0).id)).toBe(false);
	});

	it('要存的：每一欄點的記號（沒點過的 ✓），只存我記的欄', () => {
		const { table, tap } = setup(ratedSample(), (action, who) => action.id === 'x1' && who === 'g2');
		tap(0, 'p3', 2, 1);
		expect(table.entries).toEqual([{ actionId: 'x1', who: 'g2', marks: { p1: '✓', p2: '✓', p3: '✗' } }]);
	});

	it('改過：沒點過不算；點成 △ 算；點回 ✓ 不算；按了沒做算', () => {
		const { table, action, tap } = setup();
		expect(table.dirty).toBe(false);
		tap(0, 'p1');
		expect(table.dirty).toBe(true);
		tap(0, 'p1', 2);
		expect(table.dirty).toBe(false);
		table.toggleSkip(action(1).id);
		expect(table.dirty).toBe(true);
	});

	it('存 entries：流程裡多的那一次跟表上那一欄一樣（✗ 後面空著）', () => {
		const { s, table, tap } = setup();
		tap(0, 'p2', 2);
		s.recordAsk().send({ name: 'recordRunThrough', args: ['2026-11-01', 0, table.entries] });
		expect(s.flow!.actions[0].successRate!.records.map((r) => r.marks)).toEqual([{ p1: '✓', p2: '✗' }, { p1: '✓', p2: '✓', p3: '✓' }]);
	});

	it('每張表各記各的（關掉再開是新的）', () => {
		const { s, table, tap } = setup();
		tap(0, 'p1');
		expect(s.drill.runThrough(() => s.flow!, () => true).dirty).toBe(false);
		expect(table.dirty).toBe(true);
	});
});
