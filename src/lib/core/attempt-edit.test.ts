// 改某一次的查詢（attemptEdit）：按得了、亮著的，就是「改一次」真的存下來的（#357）。
// 對照的是 changeAttempt 存進流程的那一筆，不是 attemptEdit 自己回的 saved。
import { describe, expect, it } from 'vitest';
import { addAction, addPhase, attemptEdit, changeAttempt, deletePhase, markPhaseBeats, recordAttempt, type Flow, type Mark, type NewAttempt } from './index';
import { flowOf, libSample, pyramidSample, ratedSample } from '../test-flows';

const MARK_KEYS: Mark[] = ['✓', '△', '✗'];

const drill = (who: string, marks: NewAttempt['marks'], more: Partial<NewAttempt> = {}): NewAttempt => ({
	date: '2026-11-04',
	who,
	practice: 'drill',
	whole: true,
	marks,
	...more
});

const actionOf = (flow: Flow, id: string) => flow.actions.find((a) => a.id === id)!;
const attemptOf = (flow: Flow, actionId: string, attemptId: string) =>
	actionOf(flow, actionId).successRate!.records.find((r) => r.id === attemptId)!;

/** 點一顆（再點一次點著的那顆就取消），跟卡片一樣。 */
function tap(flow: Flow, actionId: string, attemptId: string, marks: Record<string, Mark>, phase: string, mark: Mark) {
	if (marks[phase] === mark) {
		const { [phase]: _, ...rest } = marks;
		return rest;
	}
	return attemptEdit(actionOf(flow, actionId), attemptOf(flow, actionId, attemptId), { ...marks, [phase]: mark }).marks;
}

/** 「改一次」真的存下來的記號；擋下來是 null。 */
function stored(flow: Flow, actionId: string, attemptId: string, marks: Record<string, Mark>) {
	const r = changeAttempt(flow, actionId, attemptId, marks);
	return r.kind === 'ok' ? attemptOf(r.flow, actionId, attemptId).marks : null;
}

/**
 * 照這一份改到一半的記號：亮著的就是存下來的；按得了的每一顆，點下去會亮、也會存；按不了的點了也不存。
 * 擋下來（一個記號都沒有、全上空了一格）不算對不上。
 */
function expectSeenIsStored(flow: Flow, actionId: string, attemptId: string, marks: Record<string, Mark>) {
	const action = actionOf(flow, actionId);
	const attempt = attemptOf(flow, actionId, attemptId);
	const seen = attemptEdit(action, attempt, marks);
	const now = stored(flow, actionId, attemptId, marks);
	if (now) expect(seen.marks, 'lit vs stored').toEqual(now);
	if (now) expect(seen.saved.marks, 'saved vs stored').toEqual(now);
	for (const p of action.successRate!.phases) {
		for (const mark of MARK_KEYS) {
			const label = `${p.id} ${mark}`;
			if (seen.shut.includes(p.id)) {
				expect(stored(flow, actionId, attemptId, { ...seen.marks, [p.id]: mark })?.[p.id], `shut ${label} not stored`).toBeUndefined();
				continue;
			}
			if (seen.marks[p.id] === mark) continue;
			const next = tap(flow, actionId, attemptId, seen.marks, p.id, mark);
			expect(next[p.id], `tap ${label} lit`).toBe(mark);
			const after = stored(flow, actionId, attemptId, next);
			if (after) {
				expect(after[p.id], `tap ${label} stored`).toBe(mark);
				expect(attemptEdit(action, attempt, next).marks, `tap ${label} lit vs stored`).toEqual(after);
			}
		}
	}
	return seen;
}

/** 金字塔 A 第 1–2 拍、B 第 2–4 拍、C 第 4–5 拍；記 B ✗、C ✗（A 空著），再刪掉 B：A 跟 C 不再佔同樣的拍。 */
function pyramidWithoutB() {
	const members = [
		{ memberId: 'm1', role: '上層' },
		{ memberId: 'm2', role: '主底' }
	];
	let flow = flowOf(addAction(libSample(), { segmentId: 's1', category: 'pyramid', name: '金字塔', start: 32, length: 32, note: '', members }));
	for (const [kind, at, len] of [['load', 0, 4], ['hold', 2, 6], ['dismount', 6, 4]] as const) {
		flow = flowOf(addPhase(flow, 'x2', { kind, name: '', beats: { at, len } }));
	}
	const [a, b, c] = actionOf(flow, 'x2').successRate!.phases.map((p) => p.id);
	flow = flowOf(recordAttempt(flow, 'x2', drill('g3', { [b]: '✗', [c]: '✗' })));
	flow = flowOf(deletePhase(flow, 'x2', b, { confirmed: true }));
	return { flow, a, c };
}

/** Lib 之後加一個環節（第 15–16 拍）。 */
const withLater = (flow: Flow) => flowOf(addPhase(flow, 'x1', { kind: 'hold', name: '', beats: { at: 14, len: 2 } }, { confirmed: true }));

describe('改某一次：按得了、亮著的，跟存下來的一樣', () => {
	it('整個做的一次，之後才加的環節按不了', () => {
		const flow = withLater(flowOf(recordAttempt(ratedSample(), 'x1', drill('g1', { p1: '✓', p2: '✓', p3: '✓' }))));
		const p4 = actionOf(flow, 'x1').successRate!.phases[3].id;
		const seen = expectSeenIsStored(flow, 'x1', 't1', { p1: '✓', p2: '✓', p3: '✓' });
		expect(seen.shut).toEqual([p4]);
	});

	it('只練幾個環節的一次，之後才加的環節照記一次的規則：按得了，也存', () => {
		const flow = withLater(flowOf(recordAttempt(ratedSample(), 'x1', drill('g1', { p1: '✓' }, { whole: false }))));
		const seen = expectSeenIsStored(flow, 'x1', 't1', { p1: '✓' });
		expect(seen.shut).toEqual([]);
	});

	it('中途 ✗：✗ 做完之後才開始的按不了；✗ 換成 ✓ 就按得了', () => {
		const flow = flowOf(recordAttempt(ratedSample(), 'x1', drill('g1', { p1: '✓', p2: '✗' })));
		expect(expectSeenIsStored(flow, 'x1', 't1', { p1: '✓', p2: '✗' }).shut).toEqual(['p3']);
		expect(expectSeenIsStored(flow, 'x1', 't1', { p1: '✓', p2: '✓' }).shut).toEqual([]);
	});

	it('✗ 的環節後來被刪了：原本空著的按不了（存的時候照樣空著）', () => {
		let flow = flowOf(recordAttempt(ratedSample(), 'x1', drill('g1', { p1: '✓', p2: '✗' })));
		flow = flowOf(deletePhase(flow, 'x1', 'p2', { confirmed: true }));
		expect(attemptOf(flow, 'x1', 't1')).toMatchObject({ marks: { p1: '✓' }, blanks: ['p3'] });
		expect(expectSeenIsStored(flow, 'x1', 't1', { p1: '✓' }).shut).toEqual(['p3']);
		expect(expectSeenIsStored(flow, 'x1', 't1', { p1: '✗' }).shut).toEqual(['p3']);
	});

	it('刪掉別的環節之後原本空著的不再佔同樣的拍：按得了，打了就存', () => {
		const { flow, a, c } = pyramidWithoutB();
		expect(attemptOf(flow, 'x2', 't1')).toMatchObject({ marks: { [c]: '✗' }, blanks: [a] });
		expect(expectSeenIsStored(flow, 'x2', 't1', { [c]: '✗' }).shut).toEqual([]);
		expect(expectSeenIsStored(flow, 'x2', 't1', { [a]: '✓', [c]: '✗' }).shut).toEqual([]);
	});

	it('金字塔佔同樣拍的環節：跟 ✗ 佔同樣拍的按得了，之後才開始的按不了', () => {
		// p4 上法「第一個」、p5 中段「第一個」、p6 上法「第二個」、p7 中段「第二個」、p8 下法
		const flow = flowOf(recordAttempt(pyramidSample(), 'x2', drill('g3', { p4: '✓', p6: '✗' })));
		expect(expectSeenIsStored(flow, 'x2', 't1', { p4: '✓', p6: '✗' }).shut).toEqual(['p7', 'p8']);
		expect(expectSeenIsStored(flow, 'x2', 't1', { p4: '✓', p5: '△', p6: '✗' }).shut).toEqual(['p7', 'p8']);
		expect(expectSeenIsStored(flow, 'x2', 't1', { p4: '✓', p6: '✓' }).shut).toEqual([]);
	});

	it('標拍改了，存著的記號落在現在按不了的環節：打開時不亮（存的時候也不留）', () => {
		// 上法「第二個」p6 原本跟 ✗ 的中段「第一個」p5 佔同樣的拍，記了 ✓；之後 p6 的拍改到 p5 做完之後
		let flow = flowOf(recordAttempt(pyramidSample(), 'x2', drill('g3', { p4: '✓', p5: '✗', p6: '✓' })));
		flow = flowOf(markPhaseBeats(flow, 'x2', 'p6', 24, 8));
		const opened = attemptOf(flow, 'x2', 't1').marks;
		expect(opened).toEqual({ p4: '✓', p5: '✗', p6: '✓' });
		const seen = expectSeenIsStored(flow, 'x2', 't1', opened);
		expect(seen.marks).toEqual({ p4: '✓', p5: '✗' });
		expect(seen.shut).toEqual(['p6', 'p8']);
	});

	it('點了 ✗，按不了的環節點過的記號不留；取消 ✗ 也不會再冒出來', () => {
		const flow = flowOf(recordAttempt(ratedSample(), 'x1', drill('g1', { p1: '✓', p2: '✓', p3: '✓' })));
		const failed = tap(flow, 'x1', 't1', { p1: '✓', p2: '✓', p3: '✓' }, 'p2', '✗');
		expect(failed).toEqual({ p1: '✓', p2: '✗' });
		expect(tap(flow, 'x1', 't1', failed, 'p2', '✗')).toEqual({ p1: '✓' });
	});
});
