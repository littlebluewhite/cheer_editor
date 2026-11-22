// 分段練正在記的一次：從編輯 session 點記號，看流程裡多了哪一次、提示寫什麼。
import { describe, expect, it } from 'vitest';
import { addAction, addPhase, attemptWhos, type Flow, type Mark } from '#lib/core';
import { flowOf, libSample, pyramidSample, ratedSample } from '#lib/test-flows.js';
import { EditorSession } from './editor-session.svelte.js';
import { m } from '#lib/paraglide/messages.js';

const DATE = '2026-11-01';

/** 一個 session 和第 index 個動作第一張卡（每次拿都是新的一張，像換頁再回來）。 */
function setup(flow: Flow = libSample(), index = 0) {
	const s = new EditorSession(flow);
	const who = attemptWhos(flow, flow.actions[index])[0].who;
	const ask = s.recordAsk();
	const card = (date = DATE) => s.drill.card(s.flow!.actions[index], who, date, ask);
	const records = () => s.flow!.actions[index].successRate!.records.map((r) => [r.whole, r.marks, r.blanks]);
	return { s, card, records };
}

/** 金字塔的卡，選「只練幾個環節」、勾這幾個環節（p4 第一個上法 0–8、p5 第一個中段 8–24、p6 第二個上法 8–16、p7 第二個中段 16–24、p8 下法 24–32）。 */
function pickSome(...ids: string[]) {
	const ctx = setup(pyramidSample(), 1);
	ctx.card().setWhole(false);
	for (const id of ids) ctx.card().pick(id, true);
	return ctx;
}

/** 金字塔 A 第 1–2 拍（p4）、B 第 2–6 拍（p5）、D 第 3–4 拍（p6）、C 第 4–7 拍（p7），四個都勾。 */
function abdc() {
	const members = [
		{ memberId: 'm1', role: '上層' },
		{ memberId: 'm2', role: '主底' }
	];
	let flow = flowOf(addAction(libSample(), { segmentId: 's1', category: 'pyramid', name: '金字塔', start: 32, length: 32, note: '', members }));
	for (const [name, at, len] of [['A', 0, 4], ['B', 2, 10], ['D', 4, 4], ['C', 6, 8]] as const) {
		flow = flowOf(addPhase(flow, 'x2', { kind: 'hold', name, beats: { at, len } }));
	}
	const ctx = setup(flow, 1);
	ctx.card().setWhole(false);
	for (const id of ['p4', 'p5', 'p6', 'p7']) ctx.card().pick(id, true);
	return ctx;
}

const tap = (card: () => { tap(id: string, mark: Mark): void }, ...taps: [string, Mark][]) => {
	for (const [id, mark] of taps) card().tap(id, mark);
};

describe('分段練正在記的一次', () => {
	it('只有一個環節：點了就存成整個做，提示「已記下」', () => {
		const { s, card, records } = setup(ratedSample(), 1);
		const [only] = card().planned;
		card().tap(only.id, '✓');
		expect(records()).toEqual([[true, { [only.id]: '✓' }, undefined]]);
		expect(s.notice).toBe(m.practice_saved());
		expect(card().unsaved).toBe(false);
	});

	it('整個做：點了先不存、卡上標還沒存；按存才存，提示「已記下」', () => {
		const { s, card, records } = setup();
		tap(card, ['p1', '✓'], ['p2', '✓'], ['p3', '△']);
		expect(records()).toEqual([]);
		expect(card().unsaved).toBe(true);
		expect(s.drill.hasUnsaved(s.flow!.actions[0], 'g1', DATE)).toBe(true);
		expect(s.notice).toBe('');
		card().save();
		expect(records()).toEqual([[true, { p1: '✓', p2: '✓', p3: '△' }, undefined]]);
		expect(s.notice).toBe(m.practice_saved());
		expect(card().unsaved).toBe(false);
	});

	it('再點一次點著的記號就取消', () => {
		const { card } = setup();
		tap(card, ['p1', '✓'], ['p1', '✓']);
		expect(card().shown).toEqual({});
		expect(card().unsaved).toBe(false);
	});

	it('整個做點了 ✗：後面的按不了、點過的不留；存下來後面空著', () => {
		const { card, records } = setup();
		tap(card, ['p3', '✓'], ['p1', '✓'], ['p2', '✗']);
		expect(card().shown).toEqual({ p1: '✓', p2: '✗' });
		expect(card().shut).toEqual(['p3']);
		card().save();
		expect(records()).toEqual([[true, { p1: '✓', p2: '✗' }, ['p3']]]);
	});

	it('金字塔 ✗ 之後才開始的按不了，佔同樣拍的還可以按；取消 ✗ 或改成 ✓ 又可以按', () => {
		const { card } = setup(pyramidSample(), 1);
		card().tap('p6', '✗');
		expect(card().shut).toEqual(['p7', 'p8']);
		card().tap('p6', '✓');
		expect(card().shut).toEqual([]);
		card().tap('p6', '✗');
		card().tap('p6', '✗');
		expect(card().shut).toEqual([]);
	});

	it('全部 ✓ 存：點了的照點的，還能打、沒打的補 ✓，按不了的空著', () => {
		const { s, card, records } = setup(pyramidSample(), 1);
		card().tap('p6', '✗');
		card().saveAllOk();
		expect(records()).toEqual([[true, { p4: '✓', p5: '✓', p6: '✗' }, ['p7', 'p8']]]);
		expect(s.notice).toBe(m.practice_saved());
	});

	it('整個做跳過了前面的環節：存之前就說；存成只練幾個環節', () => {
		const { card, records } = setup();
		card().tap('p1', '✓');
		expect(card().skipping).toBe(false);
		card().tap('p1', '✓');
		card().tap('p3', '✓');
		expect(card().skipping).toBe(true);
		card().tap('p1', '✓');
		card().tap('p2', '✓');
		expect(card().skipping).toBe(false);
		card().tap('p2', '✓');
		card().save();
		expect(records()).toEqual([[false, { p1: '✓', p3: '✓' }, undefined]]);
	});

	it('只練幾個環節：點到最後一個勾的環節就存', () => {
		const { s, card, records } = setup();
		card().setWhole(false);
		card().pick('p1', true);
		card().pick('p2', true);
		card().tap('p1', '✓');
		expect(records()).toEqual([]);
		card().tap('p2', '△');
		expect(records()).toEqual([[false, { p1: '✓', p2: '△' }, undefined]]);
		expect(s.notice).toBe(m.practice_saved());
	});

	it('只練幾個環節：點了 ✗ 就存（環節沒有疊）', () => {
		const { card, records } = setup();
		card().setWhole(false);
		card().pick('p1', true);
		card().pick('p2', true);
		card().tap('p1', '✗');
		expect(records()).toEqual([[false, { p1: '✗' }, undefined]]);
	});

	it('只練幾個環節：同時在做的沒打先等，打完才存', () => {
		const { card, records } = pickSome('p5', 'p6', 'p7');
		card().tap('p6', '✗');
		expect(records()).toEqual([]);
		expect(card().waiting).toEqual(['p5']);
		expect(card().shut).toEqual(['p7', 'p8']);
		card().tap('p5', '✓');
		expect(records()).toEqual([[false, { p5: '✓', p6: '✗' }, undefined]]);
		expect(card().waiting).toEqual([]);
	});

	it('只練幾個環節：點到最後一個勾的環節，另一個勾了、佔同樣拍的還沒打也先等', () => {
		const { card, records } = pickSome('p5', 'p6');
		card().tap('p6', '✓');
		expect(records()).toEqual([]);
		expect(card().waiting).toEqual(['p5']);
		card().tap('p5', '△');
		expect(records()).toEqual([[false, { p5: '△', p6: '✓' }, undefined]]);
	});

	it('只練幾個環節、環節沒有疊：點了 ✗ 不等', () => {
		const { card, records } = setup();
		card().setWhole(false);
		card().pick('p1', true);
		card().pick('p2', true);
		card().tap('p2', '✗');
		expect(card().waiting).toEqual([]);
		expect(records()).toEqual([[false, { p2: '✗' }, undefined]]);
	});

	it('在等的時候按存：照現在點的存，沒打的不記', () => {
		const { card, records } = pickSome('p5', 'p6');
		card().tap('p6', '✗');
		card().save();
		expect(records()).toEqual([[false, { p6: '✗' }, undefined]]);
	});

	it('B ✗ 再 C ✗ 之後只等跟 C 佔同樣拍的 D，不回頭再等只跟 B 佔同樣拍的 A', () => {
		const { card, records } = abdc();
		tap(card, ['p5', '✗'], ['p7', '✗']);
		expect(card().waiting).toEqual(['p6']);
		card().tap('p6', '✓');
		expect(records()).toEqual([[false, { p5: '✗', p6: '✓', p7: '✗' }, undefined]]);
	});

	it('等到一半換頁再回來（重拿一張卡）：等的環節跟離開前一樣', () => {
		const { s, card } = abdc();
		tap(card, ['p5', '✗'], ['p7', '✗']);
		const who = attemptWhos(s.flow!, s.flow!.actions[1])[0].who;
		const again = s.drill.card(s.flow!.actions[1], who, DATE, s.recordAsk());
		expect(again.waiting).toEqual(['p6']);
		expect(again.shown).toEqual({ p5: '✗', p7: '✗' });
	});

	it('換整個／只練幾個環節、改勾的環節：點到一半的清掉', () => {
		const { card } = pickSome('p5', 'p6');
		card().tap('p6', '✗');
		card().pick('p7', true);
		expect(card().unsaved).toBe(false);
		card().tap('p6', '✗');
		card().setWhole(true);
		expect(card().unsaved).toBe(false);
		card().tap('p4', '✓');
		card().setWhole(false);
		expect(card().unsaved).toBe(false);
		expect(card().picked).toEqual(['p5', 'p6', 'p7']);
	});

	it('換日期是另一份；這次練跟著卡不跟日期', () => {
		const { card } = setup();
		card().tap('p1', '✓');
		expect(card('2026-11-02').unsaved).toBe(false);
		card('2026-11-02').tap('p2', '✓');
		expect(card().shown).toEqual({ p1: '✓' });
		expect(card('2026-11-02').shown).toEqual({ p2: '✓' });
		card('2026-11-02').setWhole(false);
		expect(card().whole).toBe(false);
	});

	it('不是這次要練的環節的記號不算還沒存', () => {
		const { s, card } = setup();
		card().tap('p1', '✓');
		card('2026-11-02').setWhole(false);
		card('2026-11-02').pick('p2', true);
		expect(card().marks).toEqual({});
		expect(s.drill.hasUnsaved(s.flow!.actions[0], 'g1', DATE)).toBe(false);
	});

	it('換一支流程：全部清掉', () => {
		const { s, card } = setup();
		card().tap('p1', '✓');
		card('2026-11-02').setWhole(false);
		s.open(libSample());
		expect(card().unsaved).toBe(false);
		expect(card().whole).toBe(true);
	});
});
