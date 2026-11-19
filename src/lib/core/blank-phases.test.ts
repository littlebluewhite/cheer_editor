import { describe, expect, it } from 'vitest';
import { addAction, addPhase, addSegment, blankPhases, type Action, type Flow } from './index';
import { flowOf, libSample } from '../test-flows';

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
			skipped: []
		});
	});

	it('整個做、沒有 ✗、後面還沒打：都能打，還不算整個做，也不算跳過', () => {
		expect(blankPhases(lib(), true, { p1: '✓' })).toEqual({ whole: false, marks: { p1: '✓' }, shut: [], skipped: [] });
	});

	it('整個做、有 ✗：✗ 後面的環節空著、按不了，後面點過的記號不留，✗ 前面都有記號就算整個做', () => {
		expect(blankPhases(lib(), true, { p1: '✓', p2: '✗', p3: '✓' })).toEqual({
			whole: true,
			marks: { p1: '✓', p2: '✗' },
			shut: ['p3'],
			skipped: []
		});
	});

	it('整個做、有 ✗、前面的環節沒打：✗ 後面照樣按不了，算只練幾個環節，前面沒打的是跳過了', () => {
		expect(blankPhases(lib(), true, { p2: '✗' })).toEqual({ whole: false, marks: { p2: '✗' }, shut: ['p3'], skipped: ['p1'] });
	});

	it('整個做、跳過前面的環節打後面的：跳過的是前面沒打的那幾個', () => {
		expect(blankPhases(lib(), true, { p3: '✓' })).toEqual({
			whole: false,
			marks: { p3: '✓' },
			shut: [],
			skipped: ['p1', 'p2']
		});
	});

	it('只練幾個環節：✗ 後面的記號一樣不留，不算整個做，也不提醒跳過', () => {
		expect(blankPhases(lib(), false, { p1: '✗', p3: '✓' })).toEqual({
			whole: false,
			marks: { p1: '✗' },
			shut: ['p2', 'p3'],
			skipped: []
		});
		expect(blankPhases(lib(), false, { p3: '✓' })).toEqual({ whole: false, marks: { p3: '✓' }, shut: [], skipped: [] });
	});

	it('口號段（環節沒標拍）：照清單的先後，✗ 後面的都空著', () => {
		expect(blankPhases(toss(), true, { p4: '✓', p5: '✗', p6: '✓' })).toEqual({
			whole: true,
			marks: { p4: '✓', p5: '✗' },
			shut: ['p6'],
			skipped: []
		});
		expect(blankPhases(toss(), true, { p4: '✗' })).toEqual({
			whole: true,
			marks: { p4: '✗' },
			shut: ['p5', 'p6'],
			skipped: []
		});
	});
});
