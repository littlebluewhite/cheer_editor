import { describe, expect, it } from 'vitest';
import {
	inStep,
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
	undoRecords,
	updateAction,
	updatePhase,
	type ActionCategory,
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

/** sample 加口號段 s2 和裡面的 x2：Toss（技巧，小美、小A），還沒有環節（加了環節，兩個人進新的一組 g3）。 */
function chant(): Flow {
	let flow = flowOf(addSegment(sample(), 'chant'));
	const members = [
		{ memberId: 'm1', role: '上層' },
		{ memberId: 'm2', role: '主底' }
	];
	return flowOf(addAction(flow, { segmentId: 's2', category: 'stunt', name: 'Toss', start: 0, length: 30, note: '', members }));
}

const toss = (flow: Flow) => flow.actions.find((a) => a.id === 'x2')!;

describe('口號段加環節（不標拍）', () => {
	it('給種類和名字，加在最後、不標拍；名字去掉頭尾空白；回傳新的 id', () => {
		let flow = flowOf(addPhase(chant(), 'x2', { kind: 'hold', name: '' }));
		const r = addPhase(flow, 'x2', { kind: 'load', name: '  二層 ' });
		expect(r.kind).toBe('ok');
		if (r.kind !== 'ok') return;
		expect(r.id).toBe('p5');
		expect(toss(r.flow).successRate!.phases).toEqual([
			{ id: 'p4', kind: 'hold', name: '' },
			{ id: 'p5', kind: 'load', name: '二層' }
		]);
	});

	it('加第一個環節就開始記成功率，動作裡的人全部進第 1 組', () => {
		const flow = flowOf(addPhase(chant(), 'x2', { kind: 'hold', name: '' }));
		expect(toss(flow).successRate!.records).toEqual([]);
		expect(squadNumbers(toss(flow))).toEqual([1, 1]);
	});

	it('騰翻、跳躍不分組', () => {
		let flow = flowOf(addSegment(sample(), 'chant'));
		flow = flowOf(addAction(flow, { segmentId: 's2', category: 'tumbling', name: '', start: 0, length: 30, note: '', members: [{ memberId: 'm2', role: null }] }));
		flow = flowOf(addPhase(flow, 'x2', { kind: 'tumble', name: '' }));
		expect(toss(flow).successRate!.phases).toHaveLength(1);
		expect(toss(flow).members.some((m) => 'squad' in m)).toBe(false);
	});

	it('種類要是大類能用的：技巧用上法到下法，拋投只用拋法，騰翻只用翻法，跳躍只用跳法，舞蹈、其他不能加', () => {
		expect(addPhase(chant(), 'x2', { kind: 'stand' as never, name: '' })).toEqual({
			kind: 'blocked',
			message: '技巧的環節只能用上法、中段、轉接、下法'
		});
		expect(addPhase(chant(), 'x2', { kind: 'toss', name: '' })).toEqual({
			kind: 'blocked',
			message: '技巧的環節只能用上法、中段、轉接、下法'
		});
		const as = (category: ActionCategory) => {
			const flow = flowOf(addSegment(sample(), 'chant'));
			return flowOf(addAction(flow, { segmentId: 's2', category, name: '', start: 0, length: 30, note: '', members: [{ memberId: 'm2', role: null }] }));
		};
		expect(addPhase(as('toss'), 'x2', { kind: 'load', name: '' })).toEqual({ kind: 'blocked', message: '拋投的環節只能用拋法' });
		expect(addPhase(as('tumbling'), 'x2', { kind: 'toss', name: '' })).toEqual({ kind: 'blocked', message: '騰翻的環節只能用翻法' });
		expect(addPhase(as('jump'), 'x2', { kind: 'tumble', name: '' })).toEqual({ kind: 'blocked', message: '跳躍的環節只能用跳法' });
		expect(addPhase(as('dance'), 'x2', { kind: 'load', name: '' })).toEqual({ kind: 'blocked', message: '舞蹈的動作不記成功率' });
		expect(addPhase(as('other'), 'x2', { kind: 'load', name: '' })).toEqual({ kind: 'blocked', message: '其他的動作不記成功率' });
		expect(addPhase(as('toss'), 'x2', { kind: 'toss', name: '' }).kind).toBe('ok');
	});

	it('翻法、跳法一樣一個人一組，不分組；拋法照樣全部的人進第 1 組', () => {
		const as = (category: ActionCategory, kind: PhaseKind) => {
			let flow = flowOf(addSegment(sample(), 'chant'));
			const members = [
				{ memberId: 'm1', role: null },
				{ memberId: 'm2', role: null }
			];
			flow = flowOf(addAction(flow, { segmentId: 's2', category, name: '', start: 0, length: 30, note: '', members }));
			return toss(flowOf(addPhase(flow, 'x2', { kind, name: '' })));
		};
		expect(as('tumbling', 'tumble').members.some((m) => 'squad' in m)).toBe(false);
		expect(as('jump', 'jump').members.some((m) => 'squad' in m)).toBe(false);
		expect(squadNumbers(as('toss', 'toss'))).toEqual([1, 1]);
	});

	it('音樂段的環節要在拍點格子選拍標，不能這樣加', () => {
		expect(addPhase(sample(), 'x1', { kind: 'load', name: '' })).toEqual({
			kind: 'blocked',
			message: '音樂段的環節要選拍標',
			why: { code: 'phases_music_needs_beats' }
		});
	});

	it('後來才加的環節：之前整個做的那幾次寫「—」（這次還沒有這個環節），不寫像空著、像沒成功的「·」', () => {
		let flow = flowOf(addPhase(chant(), 'x2', { kind: 'hold', name: '' }));
		flow = flowOf(recordAttempt(flow, 'x2', drill({ p4: '✓' }, { who: 'g3' })));
		flow = flowOf(addPhase(flow, 'x2', { kind: 'load', name: '二層' }));
		const [attempt] = toss(flow).successRate!.records;
		expect(attempt.marks).toEqual({ p4: '✓' });
		expect(attemptText(toss(flow), attempt)).toBe('✓—');
	});

	it('後來才加的環節：中途 ✗ 後面空著的還是「·」，只有那時還沒有的寫「—」', () => {
		let flow = flowOf(addPhase(chant(), 'x2', { kind: 'hold', name: '' }));
		flow = flowOf(addPhase(flow, 'x2', { kind: 'load', name: '二層' }));
		const [p1, p2] = toss(flow).successRate!.phases.map((p) => p.id);
		flow = flowOf(recordAttempt(flow, 'x2', drill({ [p1]: '✗' }, { who: 'g3' })));
		flow = flowOf(addPhase(flow, 'x2', { kind: 'dismount', name: '' }));
		const [attempt] = toss(flow).successRate!.records;
		expect(attempt.blanks).toEqual([p2]);
		expect(attemptText(toss(flow), attempt)).toBe('✗·—');
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

	it('種類不是大類能用的：擋下來', () => {
		expect(updatePhase(sample(), 'x1', 'p1', { kind: 'toss' })).toEqual({
			kind: 'blocked',
			message: '技巧的環節只能用上法、中段、轉接、下法'
		});
	});

	it('找不到環節：擋下來', () => {
		expect(updatePhase(sample(), 'x1', 'p9', { name: 'x' })).toEqual({
			kind: 'blocked',
			message: '找不到這個環節',
			why: { code: 'phases_not_found' }
		});
	});

	it('找不到動作、動作的段：擋下來', () => {
		expect(updatePhase(sample(), 'x9', 'p1', { name: 'x' })).toEqual({
			kind: 'blocked',
			message: '找不到這個動作',
			why: { code: 'phases_no_action' }
		});
		const flow = sample();
		const lost = { ...flow, actions: flow.actions.map((a) => (a.id === 'x1' ? { ...a, segmentId: 's9' } : a)) };
		expect(deletePhase(lost, 'x1', 'p1')).toEqual({
			kind: 'blocked',
			message: '找不到這一段',
			why: { code: 'phases_no_segment' }
		});
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
			message: '會刪掉 1 個環節，清掉 2 次的記號（清掉的紀錄按「復原」會回來），確定就刪掉',
			why: { code: 'phases_delete_one', count: 1, lost: '清掉 2 次的記號' },
			items: ['刪掉：環節 中段']
		});
	});

	it('確定後拿掉環節和它的記號；拿掉後一個記號都沒有的那一次整筆拿掉', () => {
		let flow = flowOf(recordAttempt(sample(), 'x1', drill({ p1: '✓', p2: '✓', p3: '✓' })));
		flow = flowOf(recordAttempt(flow, 'x1', drill({ p1: '✗' }, { whole: false })));
		flow = flowOf(updatePhase(flow, 'x1', 'p1', { name: '延伸' }));
		expect(deletePhase(flow, 'x1', 'p1')).toEqual({
			kind: 'confirm',
			message: '會刪掉 1 個環節，一起清掉 1 次紀錄和 1 次的記號（清掉的紀錄按「復原」會回來），確定就刪掉',
			why: { code: 'phases_delete_one', count: 1, lost: '一起清掉 1 次紀錄和 1 次的記號' },
			items: ['刪掉：環節 上法 延伸']
		});
		flow = flowOf(deletePhase(flow, 'x1', 'p1', { confirmed: true }));
		expect(phasesOf(flow).map((p) => p.id)).toEqual(['p2', 'p3']);
		expect(lib(flow).successRate!.records.map((r) => r.marks)).toEqual([{ p2: '✓', p3: '✓' }]);
	});

	it('確認框寫的次數跟真的不見的一樣：只剩空著的環節的那一次整筆不見也算進去（N26）', () => {
		// t1 上法 ✗、中段和下法空著；t2 只練下法 ✓。先刪上法，t1 只剩空著的中段、下法。
		let flow = flowOf(recordAttempt(sample(), 'x1', drill({ p1: '✗' })));
		flow = flowOf(recordAttempt(flow, 'x1', drill({ p3: '✓' }, { whole: false })));
		flow = flowOf(recordAttempt(flow, 'x1', drill({ p2: '✓', p3: '✓' }, { whole: false })));
		flow = flowOf(deletePhase(flow, 'x1', 'p1', { confirmed: true }));
		flow = flowOf(deletePhase(flow, 'x1', 'p2', { confirmed: true }));
		expect(lib(flow).successRate!.records).toHaveLength(3);
		expect(deletePhase(flow, 'x1', 'p3')).toEqual({
			kind: 'confirm',
			message: '會刪掉 1 個環節，一起清掉 3 次紀錄（清掉的紀錄按「復原」會回來）；動作沒有環節了，不再記成功率，確定就刪掉',
			why: { code: 'phases_delete_none_left_one', count: 1, lost: '一起清掉 3 次紀錄' },
			items: ['刪掉：環節 下法']
		});
	});

	it('有的整筆不見、有的只少了記號：分開寫幾次紀錄、幾次的記號', () => {
		let flow = flowOf(recordAttempt(sample(), 'x1', drill({ p1: '✓', p2: '✓', p3: '✓' })));
		flow = flowOf(recordAttempt(flow, 'x1', drill({ p1: '✗' }, { whole: false })));
		flow = flowOf(recordAttempt(flow, 'x1', drill({ p2: '✓' }, { whole: false })));
		expect(deletePhase(flow, 'x1', 'p1')).toMatchObject({
			message: '會刪掉 1 個環節，一起清掉 1 次紀錄和 1 次的記號（清掉的紀錄按「復原」會回來），確定就刪掉'
		});
	});

	it('刪了的環節 id 不再發：新的環節 id 是亂數', () => {
		const flow = flowOf(deletePhase(sample(), 'x1', 'p3'));
		const r = inStep('k3m9q2w7', () => addPhase(flow, 'x1', { kind: 'dismount', name: '', beats: { at: 12, len: 4 } }));
		expect(r.kind === 'ok' && r.id).toMatch(/^p[a-z0-9]{12}$/);
	});

	it('找不到環節：擋下來', () => {
		expect(deletePhase(sample(), 'x1', 'p9')).toEqual({
			kind: 'blocked',
			message: '找不到這個環節',
			why: { code: 'phases_not_found' }
		});
	});

	it('刪掉最後一個環節：動作不記成功率了，組一起拿掉', () => {
		let flow = sample();
		for (const id of ['p1', 'p2', 'p3']) flow = flowOf(deletePhase(flow, 'x1', id));
		expect(lib(flow).successRate).toBeUndefined();
		expect(lib(flow).members.some((m) => 'squad' in m)).toBe(false);
	});
});

describe('口號段刪環節', () => {
	/** chant 的 x2 加了 p4 中段、p5 上法。 */
	const two = () => {
		const flow = flowOf(addPhase(chant(), 'x2', { kind: 'hold', name: '' }));
		return flowOf(addPhase(flow, 'x2', { kind: 'load', name: '' }));
	};

	it('沒紀錄就直接刪，剩下的照加的先後', () => {
		const flow = flowOf(deletePhase(two(), 'x2', 'p4'));
		expect(toss(flow).successRate!.phases).toEqual([{ id: 'p5', kind: 'load', name: '' }]);
	});

	it('有記號先問；刪掉最後一個時也說動作不再記成功率，確定後組和紀錄一起拿掉', () => {
		let flow = flowOf(addPhase(chant(), 'x2', { kind: 'hold', name: '' }));
		flow = flowOf(recordAttempt(flow, 'x2', drill({ p4: '✓' }, { who: 'g3' })));
		expect(deletePhase(flow, 'x2', 'p4')).toEqual({
			kind: 'confirm',
			message: '會刪掉 1 個環節，一起清掉 1 次紀錄（清掉的紀錄按「復原」會回來）；動作沒有環節了，不再記成功率，確定就刪掉',
			why: { code: 'phases_delete_none_left_one', count: 1, lost: '一起清掉 1 次紀錄' },
			items: ['刪掉：環節 中段']
		});
		flow = flowOf(deletePhase(flow, 'x2', 'p4', { confirmed: true }));
		expect(toss(flow).successRate).toBeUndefined();
		expect(toss(flow).members.some((m) => 'squad' in m)).toBe(false);
	});
});

describe('換大類：環節的種類跟著換', () => {
	const kinds = (flow: Flow) => phasesOf(flow).map((p) => p.kind);

	it('換成拋投都變拋法、騰翻都變翻法、跳躍都變跳法；id、名字、標的拍照留', () => {
		for (const [category, kind] of [['toss', 'toss'], ['tumbling', 'tumble'], ['jump', 'jump']] as const) {
			const flow = flowOf(updateAction(sample(), 'x1', { category }, { confirmed: true }));
			expect(phasesOf(flow)).toEqual(phasesOf(sample()).map((p) => ({ ...p, kind })));
		}
	});

	it('換成拋投，紀錄照留（一樣是一組一起算）', () => {
		const before = flowOf(recordAttempt(sample(), 'x1', drill({ p1: '✓' })));
		const flow = flowOf(updateAction(before, 'x1', { category: 'toss' }));
		expect(lib(flow).successRate!.records).toEqual(lib(before).successRate!.records);
	});

	it('從拋投換回技巧、金字塔：都變上法', () => {
		const toss = flowOf(updateAction(sample(), 'x1', { category: 'toss' }));
		expect(kinds(flowOf(updateAction(toss, 'x1', { category: 'stunt' })))).toEqual(['load', 'load', 'load']);
		expect(kinds(flowOf(updateAction(toss, 'x1', { category: 'pyramid' })))).toEqual(['load', 'load', 'load']);
	});

	it('技巧換成金字塔：種類都能用，不動', () => {
		const flow = flowOf(updateAction(sample(), 'x1', { category: 'pyramid' }));
		expect(phasesOf(flow)).toEqual(phasesOf(sample()));
	});

	it('換成舞蹈、其他：沒紀錄就直接拿掉環節和組，不記成功率', () => {
		for (const category of ['dance', 'other'] as const) {
			const flow = flowOf(updateAction(sample(), 'x1', { category }));
			expect(lib(flow).successRate).toBeUndefined();
			expect(lib(flow).members.some((m) => 'squad' in m)).toBe(false);
		}
	});

	it('換成舞蹈，有紀錄先問；確定才拿掉；復原紀錄回來', () => {
		const before = flowOf(recordAttempt(sample(), 'x1', drill({ p1: '✓' })));
		const r = updateAction(before, 'x1', { category: 'dance' });
		expect(r.kind).toBe('confirm');
		expect(r.kind === 'confirm' && r.message).toBe('動作「技巧·Lib」換成舞蹈，不記成功率，會清掉 1 次紀錄（清掉的紀錄按「復原」會回來）');
		const after = flowOf(updateAction(before, 'x1', { category: 'dance' }, { confirmed: true }));
		expect(lib(after).successRate).toBeUndefined();
		expect(lib(after).members.some((m) => 'squad' in m)).toBe(false);
		expect(lib(undoRecords(before, after, after)).successRate!.records).toEqual(lib(before).successRate!.records);
	});
});

describe('換大類：金字塔有環節佔同樣的拍', () => {
	/** sample 換成金字塔，再加 p4 上法「第二個」佔 p2 的 1-3 到 1-4。 */
	const overlapped = () => {
		const flow = flowOf(updateAction(sample(), 'x1', { category: 'pyramid' }));
		return flowOf(addPhase(flow, 'x1', { kind: 'load', name: '第二個', beats: { at: 4, len: 4 } }));
	};

	it.each([
		['技巧', 'stunt'],
		['拋投', 'toss'],
		['騰翻', 'tumbling'],
		['跳躍', 'jump']
	] as const)('換成%s：擋下來，說先分開；流程不變', (label, category) => {
		expect(updateAction(overlapped(), 'x1', { category })).toEqual({
			kind: 'blocked',
			message: `有環節佔同樣的拍，先分開才能換成${label}`
		});
		expect(updateAction(overlapped(), 'x1', { category }, { confirmed: true }).kind).toBe('blocked');
	});

	it('換成舞蹈、其他照舊：環節拿掉', () => {
		for (const category of ['dance', 'other'] as const) {
			expect(lib(flowOf(updateAction(overlapped(), 'x1', { category }))).successRate).toBeUndefined();
		}
	});

	it('金字塔沒有環節佔同樣的拍：照舊換，環節跟著換種類', () => {
		const flow = flowOf(updateAction(sample(), 'x1', { category: 'pyramid' }));
		expect(phasesOf(flowOf(updateAction(flow, 'x1', { category: 'toss' }))).map((p) => p.kind)).toEqual(['toss', 'toss', 'toss']);
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
		const before = flowOf(addPhase(chant(), 'x2', { kind: 'hold', name: '' }));
		let after = flowOf(addPhase(before, 'x2', { kind: 'load', name: '二層' }));
		after = flowOf(recordAttempt(after, 'x2', drill({ p4: '✓', p5: '✗' }, { who: 'g3' })));
		const undone = carryRecords(before, after);
		expect(toss(undone).successRate!.phases.map((p) => p.id)).toEqual(['p4']);
		expect(toss(undone).successRate!.records.map((r) => r.marks)).toEqual([{ p4: '✓' }]);
	});
});

describe('下一個環節預設的種類', () => {
	it('技巧、金字塔接在上一個環節後面：上法 → 中段 → 轉接 → 下法；下法後面不變；沒有環節是上法', () => {
		const kinds = [undefined, 'load', 'hold', 'transition', 'dismount'] as const;
		const expected = ['load', 'hold', 'transition', 'dismount', 'dismount'];
		expect(kinds.map((k) => nextPhaseKind('stunt', k))).toEqual(expected);
		expect(kinds.map((k) => nextPhaseKind('pyramid', k))).toEqual(expected);
	});

	it('拋投一律拋法、騰翻一律翻法、跳躍一律跳法；舞蹈、其他沒有', () => {
		expect([undefined, 'toss'].map((k) => nextPhaseKind('toss', k as PhaseKind | undefined))).toEqual(['toss', 'toss']);
		expect(nextPhaseKind('tumbling', 'tumble')).toBe('tumble');
		expect(nextPhaseKind('jump', undefined)).toBe('jump');
		expect(nextPhaseKind('dance', undefined)).toBeNull();
		expect(nextPhaseKind('other', undefined)).toBeNull();
	});
});
