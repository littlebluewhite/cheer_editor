import { describe, expect, it } from 'vitest';
import {
	ACTION_COLORS,
	PHASE_COLORS,
	addAction,
	addMembers,
	addPhase,
	addSegment,
	attemptText,
	carryRecords,
	createFlow,
	deletePhase,
	markPhaseBeats,
	recordAttempt,
	setSquad,
	updatePhase,
	updateSegment,
	type CommandResult,
	type Flow,
	type NewAttempt
} from './index';

function flowOf(r: CommandResult): Flow {
	if (r.kind !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(r)}`);
	return r.flow;
}

/**
 * 音樂 1（4 個八拍）；隊員小美（上層）、小A、小B、小芳（上層）。
 * x1：Lib（技巧，第 1 個八拍），環節 p1 上法 1-1 到 1-2、p2 中段 1-3 到 1-6、p3 下法 1-7 到 1-8；小美、小A 第 1 組，小B、小芳 第 2 組。
 */
function sample(): Flow {
	let flow = flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));
	flow = flowOf(
		addMembers(flow, [
			{ name: '小美', gender: 'F', globalRole: 'top' },
			{ name: '小A', gender: 'M', globalRole: 'base' },
			{ name: '小B', gender: 'M', globalRole: 'base' },
			{ name: '小芳', gender: 'F', globalRole: 'top' }
		])
	);
	flow = flowOf(addSegment(flow, 'music'));
	flow = flowOf(updateSegment(flow, 's1', { eights: 4, lastBeats: 8 }));
	const members = [
		{ memberId: 'm1', role: '上層' },
		{ memberId: 'm2', role: '主底' },
		{ memberId: 'm3', role: '主底' },
		{ memberId: 'm4', role: '上層' }
	];
	flow = flowOf(addAction(flow, { segmentId: 's1', category: 'stunt', name: 'Lib', start: 0, length: 16, note: '', members }));
	for (const [kind, at, len] of [['load', 0, 4], ['hold', 4, 8], ['dismount', 12, 4]] as const) {
		flow = flowOf(markPhaseBeats(flow, 'x1', { kind, name: '' }, at, len));
	}
	for (const [id, squad] of [['m1', 1], ['m2', 1], ['m3', 2], ['m4', 2]] as const) {
		flow = flowOf(setSquad(flow, 'x1', [id], squad));
	}
	return flow;
}

const lib = (flow: Flow) => flow.actions.find((a) => a.id === 'x1')!;
const phasesOf = (flow: Flow) => lib(flow).successRate!.phases;

/** 第 1 組在 2026-11-04 分段練、整個做。 */
const drill = (marks: NewAttempt['marks'], more: Partial<NewAttempt> = {}): NewAttempt => ({
	date: '2026-11-04',
	who: 1,
	practice: 'drill',
	whole: true,
	marks,
	...more
});

describe('加環節', () => {
	it('給種類和名字，加在最後；名字去掉頭尾空白；回傳新的 id', () => {
		const r = addPhase(sample(), 'x1', { kind: 'load', name: '  二層 ' });
		expect(r.kind).toBe('ok');
		if (r.kind !== 'ok') return;
		expect(r.id).toBe('p4');
		expect(phasesOf(r.flow).at(-1)).toEqual({ id: 'p4', kind: 'load', name: '二層' });
	});

	it('名字可以空', () => {
		const flow = flowOf(addPhase(sample(), 'x1', { kind: 'transition', name: '   ' }));
		expect(phasesOf(flow).at(-1)).toEqual({ id: 'p4', kind: 'transition', name: '' });
	});

	it('種類只能五種', () => {
		const r = addPhase(sample(), 'x1', { kind: 'stand' as never, name: '' });
		expect(r).toEqual({ kind: 'blocked', message: '沒有這種環節' });
	});

	it('沒打開記成功率不能加', () => {
		let flow = sample();
		flow = flowOf(addAction(flow, { segmentId: 's1', category: 'toss', name: '', start: 16, length: 8, note: '', members: [{ memberId: 'm4', role: '上層' }] }));
		expect(addPhase(flow, 'x2', { kind: 'whole', name: '' })).toEqual({
			kind: 'blocked',
			message: '先打開記成功率才能加環節'
		});
	});

	it('後來才加的環節：之前記的那幾次，這一格是空的', () => {
		let flow = flowOf(recordAttempt(sample(), 'x1', drill({ p1: '✓', p2: '✓', p3: '△' })));
		flow = flowOf(addPhase(flow, 'x1', { kind: 'load', name: '二層' }));
		const [attempt] = lib(flow).successRate!.records;
		expect(attempt.marks).toEqual({ p1: '✓', p2: '✓', p3: '△' });
		expect(attemptText(lib(flow), attempt)).toBe('✓✓△·');
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

	it('有紀錄：回傳要確認，訊息寫會清掉幾次的記號；流程不變', () => {
		let flow = flowOf(recordAttempt(sample(), 'x1', drill({ p1: '✓', p2: '✗' })));
		flow = flowOf(recordAttempt(flow, 'x1', drill({ p1: '✓', p2: '△', p3: '✓' }, { who: 2 })));
		flow = flowOf(recordAttempt(flow, 'x1', drill({ p1: '✗' })));
		expect(deletePhase(flow, 'x1', 'p2')).toEqual({
			kind: 'confirm',
			message: '中段 有紀錄，刪掉會清掉 2 次的記號，確定就刪掉',
			items: []
		});
	});

	it('確定後拿掉環節和它的記號；拿掉後一個記號都沒有的那一次整筆拿掉', () => {
		let flow = flowOf(recordAttempt(sample(), 'x1', drill({ p1: '✓', p2: '✓', p3: '✓' })));
		flow = flowOf(recordAttempt(flow, 'x1', drill({ p1: '✗' }, { whole: false })));
		flow = flowOf(updatePhase(flow, 'x1', 'p1', { name: '延伸' }));
		expect(deletePhase(flow, 'x1', 'p1')).toMatchObject({
			kind: 'confirm',
			message: '上法 延伸 有紀錄，刪掉會清掉 2 次的記號，確定就刪掉'
		});
		flow = flowOf(deletePhase(flow, 'x1', 'p1', { confirmed: true }));
		expect(phasesOf(flow).map((p) => p.id)).toEqual(['p2', 'p3']);
		expect(lib(flow).successRate!.records.map((r) => r.marks)).toEqual([{ p2: '✓', p3: '✓' }]);
	});

	it('刪了的環節 id 不再發', () => {
		let flow = flowOf(deletePhase(sample(), 'x1', 'p3'));
		const r = addPhase(flow, 'x1', { kind: 'dismount', name: '' });
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

describe('復原：只換環節，紀錄照「把現在的紀錄帶到這份流程上」', () => {
	it('刪了有紀錄的環節再復原：環節回來，它的記號已經清掉了', () => {
		const before = flowOf(recordAttempt(sample(), 'x1', drill({ p1: '✓', p2: '△' })));
		const after = flowOf(deletePhase(before, 'x1', 'p2', { confirmed: true }));
		const undone = carryRecords(before, after);
		expect(phasesOf(undone).map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
		expect(lib(undone).successRate!.records.map((r) => r.marks)).toEqual([{ p1: '✓' }]);
	});

	it('加了環節、記了一次再復原：環節拿掉，那一次只留還在的環節的記號', () => {
		const before = sample();
		let after = flowOf(addPhase(before, 'x1', { kind: 'load', name: '二層' }));
		after = flowOf(recordAttempt(after, 'x1', drill({ p1: '✓', p4: '✗' })));
		const undone = carryRecords(before, after);
		expect(phasesOf(undone).map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
		expect(lib(undone).successRate!.records.map((r) => r.marks)).toEqual([{ p1: '✓' }]);
	});
});
