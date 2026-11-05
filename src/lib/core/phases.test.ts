import { describe, expect, it } from 'vitest';
import {
	ACTION_COLORS,
	PHASE_COLORS,
	addAction,
	addPhase,
	addSegment,
	attemptText,
	carryRecords,
	deletePhase,
	nextPhaseKind,
	recordAttempt,
	updatePhase,
	type Flow,
	type PhaseKind,
	type NewAttempt
} from './index';
import { flowOf, libSample, squadNumbers } from '../test-flows';

const sample = libSample;

const lib = (flow: Flow) => flow.actions.find((a) => a.id === 'x1')!;
const phasesOf = (flow: Flow) => lib(flow).successRate!.phases;

/** 第 1 組在 2026-11-04 分段練、整個做。 */
const drill = (marks: NewAttempt['marks'], more: Partial<NewAttempt> = {}): NewAttempt => ({
	date: '2026-11-04',
	who: 'g1',
	practice: 'drill',
	whole: true,
	marks,
	...more
});

/** sample 加口號段 s2 和裡面的 x2：Toss（拋投，小美、小A），還沒有環節（加了環節，兩個人進新的一組 g3）。 */
function chant(): Flow {
	let flow = flowOf(addSegment(sample(), 'chant'));
	const members = [
		{ memberId: 'm1', role: '上層' },
		{ memberId: 'm2', role: '主底' }
	];
	return flowOf(addAction(flow, { segmentId: 's2', category: 'toss', name: 'Toss', start: 0, length: 30, note: '', members }));
}

const toss = (flow: Flow) => flow.actions.find((a) => a.id === 'x2')!;

describe('口號段加環節（不標拍）', () => {
	it('給種類和名字，加在最後、不標拍；名字去掉頭尾空白；回傳新的 id', () => {
		let flow = flowOf(addPhase(chant(), 'x2', { kind: 'whole', name: '' }));
		const r = addPhase(flow, 'x2', { kind: 'load', name: '  二層 ' });
		expect(r.kind).toBe('ok');
		if (r.kind !== 'ok') return;
		expect(r.id).toBe('p5');
		expect(toss(r.flow).successRate!.phases).toEqual([
			{ id: 'p4', kind: 'whole', name: '' },
			{ id: 'p5', kind: 'load', name: '二層' }
		]);
	});

	it('加第一個環節就開始記成功率，動作裡的人全部進第 1 組', () => {
		const flow = flowOf(addPhase(chant(), 'x2', { kind: 'whole', name: '' }));
		expect(toss(flow).successRate!.records).toEqual([]);
		expect(squadNumbers(toss(flow))).toEqual([1, 1]);
	});

	it('騰翻、跳躍不分組', () => {
		let flow = flowOf(addSegment(sample(), 'chant'));
		flow = flowOf(addAction(flow, { segmentId: 's2', category: 'tumbling', name: '', start: 0, length: 30, note: '', members: [{ memberId: 'm2', role: null }] }));
		flow = flowOf(addPhase(flow, 'x2', { kind: 'whole', name: '' }));
		expect(toss(flow).successRate!.phases).toHaveLength(1);
		expect(toss(flow).members.some((m) => 'squad' in m)).toBe(false);
	});

	it('種類只能五種', () => {
		const r = addPhase(chant(), 'x2', { kind: 'stand' as never, name: '' });
		expect(r).toEqual({ kind: 'blocked', message: '沒有這種環節' });
	});

	it('音樂段的環節要在拍點格子選拍標，不能這樣加', () => {
		expect(addPhase(sample(), 'x1', { kind: 'load', name: '' })).toEqual({
			kind: 'blocked',
			message: '音樂段的環節要選拍標'
		});
	});

	it('後來才加的環節：之前記的那幾次，這一格是空的', () => {
		let flow = flowOf(addPhase(chant(), 'x2', { kind: 'whole', name: '' }));
		flow = flowOf(recordAttempt(flow, 'x2', drill({ p4: '✓' }, { who: 'g3' })));
		flow = flowOf(addPhase(flow, 'x2', { kind: 'load', name: '二層' }));
		const [attempt] = toss(flow).successRate!.records;
		expect(attempt.marks).toEqual({ p4: '✓' });
		expect(attemptText(toss(flow), attempt)).toBe('✓·');
	});
});

describe('改環節', () => {
	it('改種類、名字（去掉頭尾空白）、顏色；沒給的不動', () => {
		let flow = flowOf(updatePhase(sample(), 'x1', 'p1', { name: ' 延伸 ' }));
		expect(phasesOf(flow)[0]).toEqual({ id: 'p1', kind: 'load', name: '延伸', beats: { at: 0, len: 4 } });
		flow = flowOf(updatePhase(flow, 'x1', 'p1', { kind: 'transition', color: '#c62828' }));
		expect(phasesOf(flow)[0]).toEqual({
			id: 'p1',
			kind: 'transition',
			name: '延伸',
			color: '#c62828',
			beats: { at: 0, len: 4 }
		});
	});

	it('顏色可以是石板灰；給 null 回到種類的顏色', () => {
		let flow = flowOf(updatePhase(sample(), 'x1', 'p1', { color: '#475569' }));
		expect(phasesOf(flow)[0].color).toBe('#475569');
		flow = flowOf(updatePhase(flow, 'x1', 'p1', { color: null }));
		expect(phasesOf(flow)[0]).toEqual({ id: 'p1', kind: 'load', name: '', beats: { at: 0, len: 4 } });
	});

	it('顏色不在辨識色 9 色和石板灰裡：擋下來', () => {
		expect(updatePhase(sample(), 'x1', 'p1', { color: '#123456' })).toEqual({
			kind: 'blocked',
			message: '環節的顏色只能挑辨識色或石板灰'
		});
	});

	it('種類不對：擋下來', () => {
		expect(updatePhase(sample(), 'x1', 'p1', { kind: 'other' as never })).toEqual({
			kind: 'blocked',
			message: '沒有這種環節'
		});
	});

	it('找不到環節：擋下來', () => {
		expect(updatePhase(sample(), 'x1', 'p9', { name: 'x' })).toEqual({ kind: 'blocked', message: '找不到這個環節' });
	});

	it('辨識色 9 色加石板灰是環節可以挑的顏色', () => {
		expect(PHASE_COLORS.map((c) => c.label)).toEqual(['紅', '橘', '金', '綠', '青', '藍', '靛', '紫', '粉', '石板灰']);
		expect(ACTION_COLORS).toHaveLength(9);
	});
});

describe('刪環節', () => {
	it('沒紀錄就直接刪', () => {
		const flow = flowOf(deletePhase(sample(), 'x1', 'p2'));
		expect(phasesOf(flow).map((p) => p.id)).toEqual(['p1', 'p3']);
	});

	it('有紀錄：回傳要確認，訊息寫會刪掉幾個環節、清掉幾次的記號，清單列要刪的環節；流程不變', () => {
		let flow = flowOf(recordAttempt(sample(), 'x1', drill({ p1: '✓', p2: '✗' })));
		flow = flowOf(recordAttempt(flow, 'x1', drill({ p1: '✓', p2: '△', p3: '✓' }, { who: 'g2' })));
		flow = flowOf(recordAttempt(flow, 'x1', drill({ p1: '✗' })));
		expect(deletePhase(flow, 'x1', 'p2')).toEqual({
			kind: 'confirm',
			message: '會刪掉 1 個環節，清掉 2 次的記號，確定就刪掉',
			items: ['刪掉：環節 中段']
		});
	});

	it('確定後拿掉環節和它的記號；拿掉後一個記號都沒有的那一次整筆拿掉', () => {
		let flow = flowOf(recordAttempt(sample(), 'x1', drill({ p1: '✓', p2: '✓', p3: '✓' })));
		flow = flowOf(recordAttempt(flow, 'x1', drill({ p1: '✗' }, { whole: false })));
		flow = flowOf(updatePhase(flow, 'x1', 'p1', { name: '延伸' }));
		expect(deletePhase(flow, 'x1', 'p1')).toEqual({
			kind: 'confirm',
			message: '會刪掉 1 個環節，清掉 2 次的記號，確定就刪掉',
			items: ['刪掉：環節 上法 延伸']
		});
		flow = flowOf(deletePhase(flow, 'x1', 'p1', { confirmed: true }));
		expect(phasesOf(flow).map((p) => p.id)).toEqual(['p2', 'p3']);
		expect(lib(flow).successRate!.records.map((r) => r.marks)).toEqual([{ p2: '✓', p3: '✓' }]);
	});

	it('刪了的環節 id 不再發', () => {
		let flow = flowOf(deletePhase(sample(), 'x1', 'p3'));
		const r = addPhase(flow, 'x1', { kind: 'dismount', name: '', beats: { at: 12, len: 4 } });
		expect(r.kind === 'ok' && r.id).toBe('p4');
	});

	it('找不到環節：擋下來', () => {
		expect(deletePhase(sample(), 'x1', 'p9')).toEqual({ kind: 'blocked', message: '找不到這個環節' });
	});

	it('刪掉最後一個環節：動作不記成功率了，組一起拿掉', () => {
		let flow = sample();
		for (const id of ['p1', 'p2', 'p3']) flow = flowOf(deletePhase(flow, 'x1', id));
		expect(lib(flow).successRate).toBeUndefined();
		expect(lib(flow).members.some((m) => 'squad' in m)).toBe(false);
	});
});

describe('口號段刪環節', () => {
	/** chant 的 x2 加了 p4 整體、p5 上法。 */
	const two = () => {
		const flow = flowOf(addPhase(chant(), 'x2', { kind: 'whole', name: '' }));
		return flowOf(addPhase(flow, 'x2', { kind: 'load', name: '' }));
	};

	it('沒紀錄就直接刪，剩下的照加的先後', () => {
		const flow = flowOf(deletePhase(two(), 'x2', 'p4'));
		expect(toss(flow).successRate!.phases).toEqual([{ id: 'p5', kind: 'load', name: '' }]);
	});

	it('有記號先問；刪掉最後一個時也說動作不再記成功率，確定後組和紀錄一起拿掉', () => {
		let flow = flowOf(addPhase(chant(), 'x2', { kind: 'whole', name: '' }));
		flow = flowOf(recordAttempt(flow, 'x2', drill({ p4: '✓' }, { who: 'g3' })));
		expect(deletePhase(flow, 'x2', 'p4')).toEqual({
			kind: 'confirm',
			message: '會刪掉 1 個環節，清掉 1 次的記號；動作沒有環節了，不再記成功率，確定就刪掉',
			items: ['刪掉：環節 整體']
		});
		flow = flowOf(deletePhase(flow, 'x2', 'p4', { confirmed: true }));
		expect(toss(flow).successRate).toBeUndefined();
		expect(toss(flow).members.some((m) => 'squad' in m)).toBe(false);
	});
});

describe('復原：只換環節，紀錄照「把現在的紀錄帶到這份流程上」', () => {
	it('刪了有紀錄的環節再復原：環節回來，它的記號已經清掉了', () => {
		const before = flowOf(recordAttempt(sample(), 'x1', drill({ p1: '✓', p2: '△' })));
		const after = flowOf(deletePhase(before, 'x1', 'p2', { confirmed: true }));
		const undone = carryRecords(before, after);
		expect(phasesOf(undone).map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
		expect(lib(undone).successRate!.records.map((r) => r.marks)).toEqual([{ p1: '✓' }]);
	});

	it('加了環節、記了一次再復原：環節拿掉，那一次只留還在的環節的記號', () => {
		const before = flowOf(addPhase(chant(), 'x2', { kind: 'whole', name: '' }));
		let after = flowOf(addPhase(before, 'x2', { kind: 'load', name: '二層' }));
		after = flowOf(recordAttempt(after, 'x2', drill({ p4: '✓', p5: '✗' }, { who: 'g3' })));
		const undone = carryRecords(before, after);
		expect(toss(undone).successRate!.phases.map((p) => p.id)).toEqual(['p4']);
		expect(toss(undone).successRate!.records.map((r) => r.marks)).toEqual([{ p4: '✓' }]);
	});
});

describe('下一個環節預設的種類', () => {
	it('接在上一個環節後面：上法 → 中段 → 轉接 → 下法；下法、整體後面不變；沒有環節是上法', () => {
		expect([undefined, 'load', 'hold', 'transition', 'dismount', 'whole'].map((k) => nextPhaseKind(k as PhaseKind | undefined))).toEqual([
			'load',
			'hold',
			'transition',
			'dismount',
			'dismount',
			'whole'
		]);
	});
});
