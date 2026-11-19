import { describe, expect, it } from 'vitest';
import { addAction, addPhase, addSegment, blankPhases, type Action, type Flow } from './index';
import { flowOf, libSample, pyramidSample } from '../test-flows';

/** Lib（技巧）：p1 上法 1-1 到 1-2、p2 中段 1-3 到 1-6、p3 下法 1-7 到 1-8。 */
const lib = (): Action => libSample().actions[0];

/** libSample 加口號段 s2 和裡面的 x2：Toss（技巧），環節 p4 上法、p5 中段、p6 下法，不標拍。 */
function toss(): Action {
	let flow: Flow = flowOf(addSegment(libSample(), 'chant'));
	const members = [
		{ memberId: 'm1', role: '上層' },
		{ memberId: 'm2', role: '主底' }
	];
	flow = flowOf(addAction(flow, { segmentId: 's2', category: 'stunt', name: 'Toss', start: 0, length: 30, note: '', members }));
	for (const kind of ['load', 'hold', 'dismount'] as const) flow = flowOf(addPhase(flow, 'x2', { kind, name: '' }));
	return flow.actions.find((a) => a.id === 'x2')!;
}

describe('打 ✗ 之後哪些環節空著（流程核心的問法）', () => {
	it('整個做、沒有 ✗、每個環節都有記號：都能打，算整個做', () => {
		expect(blankPhases(lib(), true, { p1: '✓', p2: '△', p3: '✓' })).toEqual({
			whole: true,
			marks: { p1: '✓', p2: '△', p3: '✓' },
			shut: [],
			blanks: [],
			skipped: []
		});
	});

	it('整個做、沒有 ✗、後面還沒打：都能打，還不算整個做，也不算跳過', () => {
		expect(blankPhases(lib(), true, { p1: '✓' })).toEqual({ whole: false, marks: { p1: '✓' }, shut: [], blanks: [], skipped: [] });
	});

	it('整個做、有 ✗：✗ 後面的環節空著、按不了，後面點過的記號不留，✗ 前面都有記號就算整個做', () => {
		expect(blankPhases(lib(), true, { p1: '✓', p2: '✗', p3: '✓' })).toEqual({
			whole: true,
			marks: { p1: '✓', p2: '✗' },
			shut: ['p3'],
			blanks: ['p3'],
			skipped: []
		});
	});

	it('整個做、有 ✗、前面的環節沒打：✗ 後面照樣按不了，算只練幾個環節，前面沒打的是跳過了', () => {
		expect(blankPhases(lib(), true, { p2: '✗' })).toEqual({ whole: false, marks: { p2: '✗' }, shut: ['p3'], blanks: ['p3'], skipped: ['p1'] });
	});

	it('整個做、跳過前面的環節打後面的：跳過的是前面沒打的那幾個', () => {
		expect(blankPhases(lib(), true, { p3: '✓' })).toEqual({
			whole: false,
			marks: { p3: '✓' },
			shut: [],
			blanks: [],
			skipped: ['p1', 'p2']
		});
	});

	it('只練幾個環節：✗ 後面的記號一樣不留，不算整個做，也不提醒跳過', () => {
		expect(blankPhases(lib(), false, { p1: '✗', p3: '✓' })).toEqual({
			whole: false,
			marks: { p1: '✗' },
			shut: ['p2', 'p3'],
			blanks: ['p2', 'p3'],
			skipped: []
		});
		expect(blankPhases(lib(), false, { p3: '✓' })).toEqual({ whole: false, marks: { p3: '✓' }, shut: [], blanks: [], skipped: [] });
	});

	it('口號段（環節沒標拍）：照清單的先後，✗ 後面的都空著', () => {
		expect(blankPhases(toss(), true, { p4: '✓', p5: '✗', p6: '✓' })).toEqual({
			whole: true,
			marks: { p4: '✓', p5: '✗' },
			shut: ['p6'],
			blanks: ['p6'],
			skipped: []
		});
		expect(blankPhases(toss(), true, { p4: '✗' })).toEqual({
			whole: true,
			marks: { p4: '✗' },
			shut: ['p5', 'p6'],
			blanks: ['p5', 'p6'],
			skipped: []
		});
	});
});

/** pyramidSample 的金字塔（#278 的例子）。 */
const [上一, 中一, 上二, 中二, 下] = ['p4', 'p5', 'p6', 'p7', 'p8'];
function pyramid(): Action {
	const action = pyramidSample().actions.find((a) => a.id === 'x2')!;
	expect(action.successRate!.phases.map((p) => p.id)).toEqual([上一, 中一, 上二, 中二, 下]);
	return action;
}

describe('打 ✗ 之後照拍算哪些環節空著（金字塔的環節佔同樣的拍）', () => {
	it('上法「第二個」✗：之後才開始的中段「第二個」、下法按不了；中段「第一個」佔同樣的拍，可以打，不打就空著，還是整個做', () => {
		expect(blankPhases(pyramid(), true, { [上一]: '✓', [上二]: '✗' })).toEqual({
			whole: true,
			marks: { [上一]: '✓', [上二]: '✗' },
			shut: [中二, 下],
			blanks: [中一, 中二, 下],
			skipped: []
		});
		expect(blankPhases(pyramid(), true, { [上一]: '✓', [上二]: '✗', [中一]: '△' })).toEqual({
			whole: true,
			marks: { [上一]: '✓', [中一]: '△', [上二]: '✗' },
			shut: [中二, 下],
			blanks: [中二, 下],
			skipped: []
		});
	});

	it('上法「第一個」✗：剛好從 1-5 接著開始的也空著，後面的都空著（跟以前一樣）', () => {
		expect(blankPhases(pyramid(), true, { [上一]: '✗', [中一]: '✓', [上二]: '✓' })).toEqual({
			whole: true,
			marks: { [上一]: '✗' },
			shut: [中一, 上二, 中二, 下],
			blanks: [中一, 上二, 中二, 下],
			skipped: []
		});
	});

	it('中段「第一個」✗、上法「第二個」✗：兩個 ✗ 都留，最早做完的上法「第二個」之後才開始的空著', () => {
		expect(blankPhases(pyramid(), true, { [上一]: '✓', [中一]: '✗', [上二]: '✗' })).toEqual({
			whole: true,
			marks: { [上一]: '✓', [中一]: '✗', [上二]: '✗' },
			shut: [中二, 下],
			blanks: [中二, 下],
			skipped: []
		});
	});

	it('中段「第一個」✗：上法「第二個」、中段「第二個」佔同樣的拍，可以打；下法（2-5 才開始）空著', () => {
		expect(blankPhases(pyramid(), true, { [上一]: '✓', [中一]: '✗', [中二]: '✓', [下]: '✓' })).toEqual({
			whole: true,
			marks: { [上一]: '✓', [中一]: '✗', [中二]: '✓' },
			shut: [下],
			blanks: [上二, 下],
			skipped: []
		});
	});

	it('上法「第二個」✗，其他沒打：上法「第一個」整個在 ✗ 之前，算只練幾個環節，提醒跳過的只有它', () => {
		expect(blankPhases(pyramid(), true, { [上二]: '✗' })).toEqual({
			whole: false,
			marks: { [上二]: '✗' },
			shut: [中二, 下],
			blanks: [中一, 中二, 下],
			skipped: [上一]
		});
	});

	it('上法「第一個」✗、中段「第一個」✗：中段「第一個」在之後才開始，它的 ✗ 不留', () => {
		expect(blankPhases(pyramid(), true, { [上一]: '✗', [中一]: '✗' })).toEqual({
			whole: true,
			marks: { [上一]: '✗' },
			shut: [中一, 上二, 中二, 下],
			blanks: [中一, 上二, 中二, 下],
			skipped: []
		});
	});

	it('只練幾個環節：一樣照拍算，之後才開始的按不了', () => {
		expect(blankPhases(pyramid(), false, { [上二]: '✗', [下]: '✓' })).toEqual({
			whole: false,
			marks: { [上二]: '✗' },
			shut: [中二, 下],
			blanks: [中一, 中二, 下],
			skipped: []
		});
	});
});
