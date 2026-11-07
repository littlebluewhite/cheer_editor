import { describe, expect, it } from 'vitest';
import {
	addAction,
	attemptText,
	attemptWhos,
	carryRecords,
	changeAttempt,
	clearPhaseBeats,
	deleteAction,
	deleteAttempt,
	deleteLastAttempt,
	deleteLastRunThrough,
	deleteMember,
	restoreAttempt,
	restoreRunThrough,
	keptAttempt,
	fillOk,
	lastRunThrough,
	addPhase,
	deletePhase,
	readFlowFile,
	recordableActions,
	recordAttempt,
	recordRunThrough,
	rateTable,
	setSquad,
	squadName,
	squadsOf,
	updateAction,
	successPercent,
	weakestPhase,
	writeFlowFile,
	type Flow,
	type NewAttempt,
	type RunThroughMarks
} from './index';
import { flowOf, ratedSample } from '../test-flows';

const sample = ratedSample;

const recordsOf = (flow: Flow, id = 'x1') => flow.actions.find((a) => a.id === id)!.successRate!.records;

/** 第 1 組在 2026-11-04 分段練、整個做。 */
const drill = (marks: NewAttempt['marks'], more: Partial<NewAttempt> = {}): NewAttempt => ({
	date: '2026-11-04',
	who: 'g1',
	practice: 'drill',
	whole: true,
	marks,
	...more
});

describe('記一次', () => {
	it('第 1 組 ✓ ✓ △：紀錄多一次，有 id、日期、誰、練法、整個做和每個環節的記號', () => {
		const r = recordAttempt(sample(), 'x1', drill({ p1: '✓', p2: '✓', p3: '△' }));
		expect(r.kind).toBe('ok');
		if (r.kind !== 'ok') return;
		expect(recordsOf(r.flow)).toEqual([
			{ id: 't1', date: '2026-11-04', who: 'g1', practice: 'drill', whole: true, marks: { p1: '✓', p2: '✓', p3: '△' } }
		]);
		expect(r.id).toBe('t1');
	});

	it('第二次排在後面，id 往下發', () => {
		let flow = flowOf(recordAttempt(sample(), 'x1', drill({ p1: '✓' }, { whole: false })));
		flow = flowOf(recordAttempt(flow, 'x1', drill({ p1: '✗' }, { who: 'g2' })));
		expect(recordsOf(flow).map((r) => [r.id, r.who, r.marks])).toEqual([
			['t1', 'g1', { p1: '✓' }],
			['t2', 'g2', { p1: '✗' }]
		]);
	});

	it('騰翻的動作：誰是隊員 id', () => {
		const flow = flowOf(recordAttempt(sample(), 'x2', drill({ p4: '✓' }, { who: 'm2' })));
		expect(recordsOf(flow, 'x2').map((r) => r.who)).toEqual(['m2']);
	});
});

describe('記一次：留哪些記號、算不算整個做', () => {
	it('✗ 後面的記號不存', () => {
		const flow = flowOf(recordAttempt(sample(), 'x1', drill({ p1: '✓', p2: '✗', p3: '✓' })));
		expect(recordsOf(flow)[0]).toMatchObject({ whole: true, marks: { p1: '✓', p2: '✗' } });
	});

	it('整個做卻跳過前面的環節：存成只練幾個環節', () => {
		const flow = flowOf(recordAttempt(sample(), 'x1', drill({ p1: '✓', p3: '✓' })));
		expect(recordsOf(flow)[0]).toMatchObject({ whole: false, marks: { p1: '✓', p3: '✓' } });
	});

	it('整個做、✗ 前面都點了：✗ 後面空著仍然是整個做', () => {
		const flow = flowOf(recordAttempt(sample(), 'x1', drill({ p1: '✓', p2: '✗' })));
		expect(recordsOf(flow)[0]).toMatchObject({ whole: true, marks: { p1: '✓', p2: '✗' } });
	});

	it('整個做、✗ 前面有沒點的：存成只練幾個環節', () => {
		const flow = flowOf(recordAttempt(sample(), 'x1', drill({ p2: '✗', p3: '✓' })));
		expect(recordsOf(flow)[0]).toMatchObject({ whole: false, marks: { p2: '✗' } });
	});

	it('只練幾個環節：還是只練幾個環節，✗ 後面一樣不存', () => {
		const flow = flowOf(recordAttempt(sample(), 'x1', drill({ p1: '✗', p3: '✓' }, { whole: false })));
		expect(recordsOf(flow)[0]).toMatchObject({ whole: false, marks: { p1: '✗' } });
	});

	it('全上裡 ✗ 後面空著，仍然是整個做；✗ 後面給了記號也不存', () => {
		const flow = flowOf(
			recordRunThrough(sample(), '2026-11-04', [
				{ actionId: 'x1', who: 'g1', marks: { p1: '✓', p2: '✗' } },
				{ actionId: 'x1', who: 'g2', marks: { p1: '✗', p2: '✓', p3: '✓' } }
			])
		);
		expect(recordsOf(flow).map((r) => [r.whole, r.marks])).toEqual([
			[true, { p1: '✓', p2: '✗' }],
			[true, { p1: '✗' }]
		]);
	});

	it.each([
		['全部點了', true, { p1: '✓', p2: '△', p3: '✓' }],
		['✗ 後面有記號', true, { p1: '✓', p2: '✗', p3: '✓' }],
		['跳過前面的環節', true, { p2: '✓', p3: '✓' }],
		['✗ 前面有沒點的', true, { p2: '✗', p3: '△' }],
		['只練幾個環節', false, { p1: '✗', p3: '✓' }]
	] as const)('查詢給的結果跟記一次存下來的一樣：%s', (_, whole, marks) => {
		const flow = sample();
		const saved = recordsOf(flowOf(recordAttempt(flow, 'x1', drill(marks, { whole }))))[0];
		expect(keptAttempt(flow.actions[0], whole, marks)).toEqual({ whole: saved.whole, marks: saved.marks, blanks: saved.blanks });
	});

	it('「全部 ✓ 存」：已點的照點的，空著的環節補 ✓', () => {
		const action = sample().actions[0];
		expect(fillOk(action, { p2: '△' })).toEqual({ p1: '✓', p2: '△', p3: '✓' });
		expect(fillOk(action, { p1: '✗' })).toEqual({ p1: '✗', p2: '✓', p3: '✓' });
		expect(fillOk(action, {})).toEqual({ p1: '✓', p2: '✓', p3: '✓' });
	});

	it('讀流程檔不套這兩條：後來加在前面的環節，舊的一次照樣打得開、還是整個做', () => {
		let flow = flowOf(clearPhaseBeats(sample(), 'x1', 0, 4));
		flow = flowOf(recordAttempt(flow, 'x1', drill({ p2: '✓', p3: '✓' })));
		flow = flowOf(addPhase(flow, 'x1', { kind: 'load', name: '', beats: { at: 0, len: 4 } }));
		const r = readFlowFile(writeFlowFile(flow, {}));
		if (r.kind !== 'ok') throw new Error(JSON.stringify(r));
		expect(r.flow.actions[0].successRate!.phases[0].id).toBe('p5');
		expect(recordsOf(r.flow)).toEqual([expect.objectContaining({ whole: true, marks: { p2: '✓', p3: '✓' } })]);
	});
});

describe('刪掉上一次', () => {
	/** 11/04：第 1 組 t1、第 2 組 t2、第 1 組 t3、第 1 組全上 t4；11/05：第 1 組 t5。 */
	function recorded(): Flow {
		let flow = sample();
		for (const input of [drill({ p1: '✓' }), drill({ p1: '✓' }, { who: 'g2' }), drill({ p1: '✗' })]) {
			flow = flowOf(recordAttempt(flow, 'x1', input));
		}
		flow = flowOf(recordRunThrough(flow, '2026-11-04', [{ actionId: 'x1', who: 'g1', marks: { p1: '✓', p2: '✓', p3: '✓' } }]));
		return flowOf(recordAttempt(flow, 'x1', drill({ p1: '△' }, { date: '2026-11-05' })));
	}

	it('拿掉這組在那天、那種練法最後記的一次，別組、別天、別種練法的不動', () => {
		let flow = flowOf(deleteLastAttempt(recorded(), 'x1', 'g1', '2026-11-04', 'drill'));
		expect(recordsOf(flow).map((r) => r.id)).toEqual(['t1', 't2', 't4', 't5']);
		flow = flowOf(deleteLastAttempt(flow, 'x1', 'g1', '2026-11-04', 'drill'));
		expect(recordsOf(flow).map((r) => r.id)).toEqual(['t2', 't4', 't5']);
	});

	it('全上的最後一筆只有指定全上才刪', () => {
		const flow = flowOf(deleteLastAttempt(recorded(), 'x1', 'g1', '2026-11-04', 'runThrough'));
		expect(recordsOf(flow).map((r) => r.id)).toEqual(['t1', 't2', 't3', 't5']);
	});

	it('回傳刪掉的那一次和它原本排第幾', () => {
		const r = deleteLastAttempt(recorded(), 'x1', 'g1', '2026-11-04', 'drill');
		expect(r.kind === 'ok' && [r.attempt.id, r.index]).toEqual(['t3', 2]);
	});

	it('那天這組這種練法沒有紀錄就擋下來', () => {
		expect(deleteLastAttempt(recorded(), 'x1', 'g2', '2026-11-05', 'drill')).toEqual({
			kind: 'blocked',
			message: '這一天還沒有紀錄'
		});
		expect(deleteLastAttempt(recorded(), 'x1', 'g2', '2026-11-04', 'runThrough')).toEqual({
			kind: 'blocked',
			message: '這一天還沒有紀錄'
		});
	});

	it('刪掉的 id 不再發', () => {
		let flow = flowOf(deleteLastAttempt(recorded(), 'x1', 'g1', '2026-11-05', 'drill'));
		flow = flowOf(recordAttempt(flow, 'x1', drill({ p2: '✓' })));
		expect(recordsOf(flow).map((r) => r.id)).toEqual(['t1', 't2', 't3', 't4', 't6']);
	});
});

describe('改某一次、刪掉某一次', () => {
	/** 11/04 第 1 組：t1 ✓✓✓、t2 ✓✓✓、t3 ✓✓✓，全上 t4 ✓✓✓。 */
	function recorded(): Flow {
		let flow = sample();
		for (let i = 0; i < 3; i++) flow = flowOf(recordAttempt(flow, 'x1', drill({ p1: '✓', p2: '✓', p3: '✓' })));
		return flowOf(recordRunThrough(flow, '2026-11-04', [{ actionId: 'x1', who: 'g1', marks: { p1: '✓', p2: '✓', p3: '✓' } }]));
	}
	const lowest = (flow: Flow) => {
		const w = weakestPhase(flow.actions[0], '2026-11-04');
		return w && successPercent(w.tally);
	};

	it('改中間那一次的記號：還在原來的位置、id 不變，成功率跟著變', () => {
		const flow = recorded();
		expect(lowest(flow)).toBeNull();
		const changed = flowOf(changeAttempt(flow, 'x1', 't2', { p1: '✓', p2: '✓', p3: '✗' }));
		expect(recordsOf(changed).map((r) => [r.id, r.marks.p3])).toEqual([
			['t1', '✓'],
			['t2', '✗'],
			['t3', '✓'],
			['t4', '✓']
		]);
		expect(lowest(changed)).toBe(75);
	});

	it('改成 ✗：後面的記號不存（跟記的時候一樣）；整個做卻空了一格算只練幾個環節', () => {
		let flow = flowOf(changeAttempt(recorded(), 'x1', 't1', { p1: '✗', p2: '✓', p3: '✓' }));
		expect(recordsOf(flow)[0]).toMatchObject({ whole: true, marks: { p1: '✗' } });
		flow = flowOf(changeAttempt(flow, 'x1', 't2', { p1: '✓', p3: '✓' }));
		expect(recordsOf(flow)[1]).toMatchObject({ whole: false, marks: { p1: '✓', p3: '✓' } });
	});

	it('全上的那一次也能改；空了一格就擋下來', () => {
		const flow = flowOf(changeAttempt(recorded(), 'x1', 't4', { p1: '✓', p2: '△', p3: '✓' }));
		expect(recordsOf(flow)[3]).toMatchObject({ practice: 'runThrough', runThroughId: 'r1', marks: { p2: '△' } });
		expect(changeAttempt(flow, 'x1', 't4', { p1: '✓', p3: '✓' })).toEqual({
			kind: 'blocked',
			message: '全上的一次每個環節都要有記號（✗ 後面的不用）'
		});
	});

	describe('只看那一次當時就有的環節', () => {
		const later = (flow: Flow) =>
			flowOf(addPhase(flow, 'x1', { kind: 'whole', name: '', beats: { at: 14, len: 2 } }, { confirmed: true }));
		const p4 = (flow: Flow) => flow.actions[0].successRate!.phases[3].id;

		it('之後才加的環節不變成空著的，打了記號也不存；整個做還是整個做', () => {
			const flow = later(flowOf(recordAttempt(sample(), 'x1', drill({ p1: '✓', p2: '✓', p3: '✓' }))));
			const changed = flowOf(changeAttempt(flow, 'x1', 't1', { p1: '✓', p2: '△', p3: '✓', [p4(flow)]: '✓' }));
			expect(recordsOf(changed)[0]).toEqual({ ...recordsOf(flow)[0], marks: { p1: '✓', p2: '△', p3: '✓' } });
		});

		it('中途 ✗ 的一次：空著的只留當時就有的，之後才加的不算進去', () => {
			const flow = later(flowOf(recordAttempt(sample(), 'x1', drill({ p1: '✓', p2: '✗' }))));
			const changed = flowOf(changeAttempt(flow, 'x1', 't1', { p1: '△', p2: '✗' }));
			expect(recordsOf(changed)[0]).toMatchObject({ whole: true, marks: { p1: '△', p2: '✗' }, blanks: ['p3'] });
		});

		it('✗ 的環節刪掉了：改前面的記號，空著的照樣空著、還是整個做', () => {
			let flow = flowOf(recordAttempt(sample(), 'x1', drill({ p1: '✓', p2: '✗' })));
			flow = flowOf(deletePhase(flow, 'x1', 'p2', { confirmed: true }));
			const changed = flowOf(changeAttempt(flow, 'x1', 't1', { p1: '△', p3: '✓' }));
			expect(recordsOf(changed)[0]).toMatchObject({ whole: true, marks: { p1: '△' }, blanks: ['p3'] });
		});
	});

	it('一個記號都沒有、找不到那一次就擋下來', () => {
		expect(changeAttempt(recorded(), 'x1', 't1', {})).toEqual({ kind: 'blocked', message: '一次至少要有一個記號' });
		expect(changeAttempt(recorded(), 'x1', 't9', { p1: '✓' })).toEqual({ kind: 'blocked', message: '找不到這一次' });
	});

	it('刪掉某一次：只拿掉它，回傳它和原本排第幾，救回放回原位；全上的也一樣', () => {
		const r = deleteAttempt(recorded(), 'x1', 't2');
		expect(r.kind === 'ok' && [recordsOf(r.flow).map((a) => a.id), r.attempt.id, r.index]).toEqual([
			['t1', 't3', 't4'],
			't2',
			1
		]);
		if (r.kind !== 'ok') return;
		expect(recordsOf(flowOf(restoreAttempt(r.flow, 'x1', r.attempt, r.index))).map((a) => a.id)).toEqual([
			't1',
			't2',
			't3',
			't4'
		]);
		expect(recordsOf(flowOf(deleteAttempt(recorded(), 'x1', 't4'))).map((a) => a.id)).toEqual(['t1', 't2', 't3']);
		expect(deleteAttempt(recorded(), 'x1', 't9')).toEqual({ kind: 'blocked', message: '找不到這一次' });
	});
});

describe('救回刪掉的那一次', () => {
	function deleted() {
		let flow = sample();
		for (const input of [drill({ p1: '✓' }), drill({ p1: '✗' }), drill({ p1: '△' }, { who: 'g2' })]) {
			flow = flowOf(recordAttempt(flow, 'x1', input));
		}
		const r = deleteLastAttempt(flow, 'x1', 'g1', '2026-11-04', 'drill');
		if (r.kind !== 'ok') throw new Error(r.kind);
		return r;
	}

	it('放回原本的位置，一模一樣', () => {
		const { flow, attempt, index } = deleted();
		const back = flowOf(restoreAttempt(flow, 'x1', attempt, index));
		expect(recordsOf(back).map((r) => r.id)).toEqual(['t1', 't2', 't3']);
		expect(recordsOf(back)[1]).toEqual(attempt);
	});

	it('刪掉之後又記了一次：救回的還是排在原本的位置，新記的在後面', () => {
		const { flow, attempt, index } = deleted();
		const more = flowOf(recordAttempt(flow, 'x1', drill({ p2: '✓' })));
		const back = flowOf(restoreAttempt(more, 'x1', attempt, index));
		expect(recordsOf(back).map((r) => r.id)).toEqual(['t1', 't2', 't3', 't4']);
	});

	it('已經在了（救回過）就擋下來', () => {
		const { flow, attempt, index } = deleted();
		const back = flowOf(restoreAttempt(flow, 'x1', attempt, index));
		expect(restoreAttempt(back, 'x1', attempt, index).kind).toBe('blocked');
	});

	it('動作不在了就擋下來', () => {
		const { flow, attempt, index } = deleted();
		const gone = flowOf(deleteAction(flow, 'x1', { confirmed: true }));
		expect(restoreAttempt(gone, 'x1', attempt, index)).toEqual({ kind: 'blocked', message: '找不到這個動作' });
	});
});

describe('把現在的紀錄帶到這份流程上（復原、重做）', () => {
	/** x1：t1 第 1 組 ✓✓△、t2 第 2 組 ✓、t3 第 1 組只有下法 ✗；x2：t4 小A ✓。 */
	function recorded(base = sample()): Flow {
		let flow = base;
		flow = flowOf(recordAttempt(flow, 'x1', drill({ p1: '✓', p2: '✓', p3: '△' })));
		flow = flowOf(recordAttempt(flow, 'x1', drill({ p1: '✓' }, { who: 'g2', whole: false })));
		flow = flowOf(recordAttempt(flow, 'x1', drill({ p3: '✗' }, { whole: false })));
		return flowOf(recordAttempt(flow, 'x2', drill({ p4: '✓' }, { who: 'm2' })));
	}

	it('換上記之前的流程：編排是換上的，紀錄是現在的', () => {
		const older = flowOf(updateAction(sample(), 'x1', { name: '舊的名字' }));
		const current = recorded();
		const carried = carryRecords(older, current);
		expect(carried.actions[0].name).toBe('舊的名字');
		expect(recordsOf(carried)).toEqual(recordsOf(current));
		expect(recordsOf(carried, 'x2')).toEqual(recordsOf(current, 'x2'));
	});

	it('換上的流程比較新（重做），紀錄一樣用現在的', () => {
		const current = recorded();
		const newer = flowOf(updateAction(current, 'x1', { name: '新的名字' }));
		const fewer = flowOf(deleteLastAttempt(current, 'x1', 'g1', '2026-11-04', 'drill'));
		const carried = carryRecords(newer, fewer);
		expect(carried.actions[0].name).toBe('新的名字');
		expect(recordsOf(carried).map((r) => r.id)).toEqual(['t1', 't2']);
	});

	it('指到不在的環節的記號丟掉；丟到一個記號都沒有的那一次整筆拿掉', () => {
		const base = sample();
		const noDismount: Flow = {
			...base,
			actions: base.actions.map((a) =>
				a.id === 'x1' ? { ...a, successRate: { ...a.successRate!, phases: a.successRate!.phases.slice(0, 2) } } : a
			)
		};
		const carried = carryRecords(noDismount, recorded());
		expect(recordsOf(carried).map((r) => [r.id, r.marks])).toEqual([
			['t1', { p1: '✓', p2: '✓' }],
			['t2', { p1: '✓' }]
		]);
	});

	it('指到沒有人的組、不在動作裡的隊員的紀錄丟掉', () => {
		let older = flowOf(setSquad(sample(), 'x1', ['m3'], null));
		older = flowOf(setSquad(older, 'x1', ['m4'], null));
		older = flowOf(updateAction(older, 'x2', { members: [{ memberId: 'm1', role: '騰翻' }] }));
		const carried = carryRecords(older, recorded());
		expect(recordsOf(carried).map((r) => r.id)).toEqual(['t1', 't3']);
		expect(recordsOf(carried, 'x2')).toEqual([]);
	});

	it('指到不在的動作、或換上的動作不記成功率：紀錄丟掉', () => {
		const older = flowOf(clearPhaseBeats(flowOf(deleteAction(sample(), 'x2')), 'x1', 0, 999));
		const carried = carryRecords(older, recorded());
		expect(carried.actions.map((a) => [a.id, a.successRate])).toEqual([['x1', undefined]]);
	});

	it('換上的流程有、現在沒有的紀錄不會回來', () => {
		const current = recorded();
		const off = flowOf(clearPhaseBeats(current, 'x2', 0, 999, { confirmed: true }));
		const cleared = flowOf(addPhase(off, 'x2', { kind: 'whole', name: '騰翻', beats: { at: 0, len: 16 } }));
		const carried = carryRecords(current, cleared);
		expect(recordsOf(carried, 'x2')).toEqual([]);
	});

	it('發過的 id 不會因為換上舊的流程又發一次', () => {
		const older = sample();
		let current = recorded();
		current = flowOf(deleteLastAttempt(current, 'x2', 'm2', '2026-11-04', 'drill'));
		const carried = carryRecords(older, current);
		const again = flowOf(recordAttempt(carried, 'x2', drill({ p4: '△' }, { who: 'm1' })));
		expect(recordsOf(again, 'x2').map((r) => r.id)).toEqual(['t5']);
	});

	it('動作的 id 刪了又用：舊的那個動作不會拿到新動作的紀錄（環節的 id 不重用）', () => {
		const toss = (memberId: string) => ({
			segmentId: 's1',
			category: 'toss' as const,
			name: '',
			start: 16,
			length: 8,
			note: '',
			members: [{ memberId, role: null }]
		});
		let older = flowOf(addPhase(flowOf(addAction(sample(), toss('m3'))), 'x3', { kind: 'whole', name: '拋投', beats: { at: 0, len: 8 } }));
		older = flowOf(setSquad(older, 'x3', ['m3'], 1));
		let current = flowOf(deleteAction(older, 'x3'));
		current = flowOf(addPhase(flowOf(addAction(current, toss('m4'))), 'x3', { kind: 'whole', name: '拋投', beats: { at: 0, len: 8 } }));
		current = flowOf(setSquad(current, 'x3', ['m4'], 1));
		const x3 = current.actions.find((a) => a.id === 'x3')!;
		const phase = x3.successRate!.phases[0].id;
		current = flowOf(recordAttempt(current, 'x3', drill({ [phase]: '✓' }, { who: squadsOf(x3)[0] })));

		expect(phase).not.toBe(older.actions.find((a) => a.id === 'x3')!.successRate!.phases[0].id);
		expect(recordsOf(carryRecords(older, current), 'x3')).toEqual([]);
	});

	it('組空掉、後面的組號往前補再復原：紀錄還是指到同一個組，不會算到別組頭上', () => {
		const before = recorded();
		const after = flowOf(setSquad(before, 'x1', ['m1', 'm2'], null, { confirmed: true }));
		const x1 = (flow: Flow) => flow.actions.find((a) => a.id === 'x1')!;
		expect(recordsOf(after).map((r) => [r.id, r.who])).toEqual([['t2', 'g2']]);
		expect(squadName(after, x1(after), 'g2')).toBe('第 1 組 小芳');

		const undone = carryRecords(before, after);
		expect(recordsOf(undone).map((r) => [r.id, r.who])).toEqual([['t2', 'g2']]);
		expect(squadName(undone, x1(undone), 'g2')).toBe('第 2 組 小芳');
		const redone = carryRecords(after, undone);
		expect(recordsOf(redone).map((r) => [r.id, r.who])).toEqual([['t2', 'g2']]);
	});

	it('新分出來的組有紀錄再復原：紀錄丟掉，不會混進那個人原來的組', () => {
		const before = sample();
		let after = flowOf(setSquad(before, 'x1', ['m1'], 3));
		after = flowOf(recordAttempt(after, 'x1', drill({ p1: '✓' }, { who: 'g3' })));

		expect(recordsOf(carryRecords(before, after))).toEqual([]);
	});

	it('組裡的人變了再復原：紀錄還是留在那一組，不問', () => {
		const before = flowOf(setSquad(sample(), 'x1', ['m1'], null));
		let after = flowOf(setSquad(before, 'x1', ['m1'], 2));
		after = flowOf(recordAttempt(after, 'x1', drill({ p1: '✓' }, { who: 'g2' })));
		const t = recordsOf(after)[0].id;

		expect(recordsOf(carryRecords(before, after)).map((r) => [r.id, r.who])).toEqual([[t, 'g2']]);
	});

	it('沒有紀錄要帶：換上的流程原封不動', () => {
		const older = flowOf(updateAction(sample(), 'x1', { name: '舊的名字' }));
		const current = flowOf(updateAction(older, 'x1', { name: '新的名字' }));
		expect(carryRecords(older, current)).toBe(older);
	});
});

describe('改編排後對不上的紀錄拿掉，流程檔照樣打得開', () => {
	/** x1：t1 第 1 組、t2 第 2 組；x2：t3 小美、t4 小A。 */
	function recorded(): Flow {
		let flow = sample();
		flow = flowOf(recordAttempt(flow, 'x1', drill({ p1: '✓' })));
		flow = flowOf(recordAttempt(flow, 'x1', drill({ p1: '✓' }, { who: 'g2' })));
		flow = flowOf(recordAttempt(flow, 'x2', drill({ p4: '✓' }, { who: 'm1' })));
		return flowOf(recordAttempt(flow, 'x2', drill({ p4: '✗' }, { who: 'm2' })));
	}
	const reopened = (flow: Flow) => {
		const r = readFlowFile(writeFlowFile(flow, {}));
		return r.kind === 'ok' ? r.flow : r;
	};
	const ids = (flow: Flow, id: string) => recordsOf(flow, id).map((r) => r.id);

	it('組裡的人都換到別組：這組的紀錄拿掉', () => {
		let flow = flowOf(setSquad(recorded(), 'x1', ['m3'], 1, { records: 'keep' }));
		flow = flowOf(setSquad(flow, 'x1', ['m4'], null, { confirmed: true }));
		expect(ids(flow, 'x1')).toEqual(['t1']);
		expect(reopened(flow)).toEqual(flow);
	});

	it('組裡的人都移出動作：這組的紀錄拿掉；組還有人就留著', () => {
		const members = sample().actions[0].members.filter((m) => m.memberId !== 'm3' && m.memberId !== 'm4');
		const flow = flowOf(updateAction(recorded(), 'x1', { members }, { confirmed: true }));
		expect(ids(flow, 'x1')).toEqual(['t1']);
		expect(reopened(flow)).toEqual(flow);
	});

	it('騰翻的動作移出一個人：他的紀錄拿掉', () => {
		const flow = flowOf(updateAction(recorded(), 'x2', { members: [{ memberId: 'm1', role: '騰翻' }] }, { confirmed: true }));
		expect(ids(flow, 'x2')).toEqual(['t3']);
		expect(reopened(flow)).toEqual(flow);
	});

	it('大類從技巧換成騰翻：組的紀錄都拿掉', () => {
		const flow = flowOf(updateAction(recorded(), 'x1', { category: 'tumbling' }, { confirmed: true }));
		expect(ids(flow, 'x1')).toEqual([]);
		expect(reopened(flow)).toEqual(flow);
	});

	it('刪隊員：他自己的紀錄、他在的組的紀錄都拿掉', () => {
		const flow = flowOf(deleteMember(recorded(), 'm2', { confirmed: true }));
		expect(ids(flow, 'x1')).toEqual(['t2']);
		expect(ids(flow, 'x2')).toEqual(['t3']);
		expect(reopened(flow)).toEqual(flow);
	});
});

describe('記錄頁要的清單', () => {
	it('要記的動作：有打開記成功率、而且有環節的，照流程順序排', () => {
		let flow = sample();
		const add = (category: 'toss' | 'jump' | 'dance', start: number, memberId: string) =>
			flowOf(
				addAction(flow, {
					segmentId: 's1',
					category,
					name: '',
					start,
					length: 4,
					note: '',
					members: [{ memberId, role: null }]
				})
			);
		flow = flowOf(addPhase(add('toss', 16, 'm1'), 'x3', { kind: 'whole', name: '拋投', beats: { at: 0, len: 4 } }));
		flow = add('jump', 20, 'm2'); // 跳躍：沒有環節
		flow = add('dance', 24, 'm3'); // 沒打開
		expect(recordableActions(flow).map((a) => a.id)).toEqual(['x1', 'x3', 'x2']);
	});

	it('每組一張卡：組照號碼排，名字是「第 n 組」加上層，帶著全組；沒分到組的人不出現', () => {
		let flow = flowOf(setSquad(sample(), 'x1', ['m1'], 3));
		flow = flowOf(setSquad(flow, 'x1', ['m2'], null));
		const x1 = flow.actions.find((a) => a.id === 'x1')!;
		expect(attemptWhos(flow, x1)).toEqual([
			{ who: 'g2', name: '第 1 組 小芳', people: ['小B', '小芳'] },
			{ who: 'g3', name: '第 2 組 小美', people: ['小美'] }
		]);
	});

	it('騰翻的動作每人一張卡，照名單順序', () => {
		const flow = flowOf(
			updateAction(sample(), 'x2', {
				members: [
					{ memberId: 'm4', role: '騰翻' },
					{ memberId: 'm2', role: '騰翻' }
				]
			})
		);
		const x2 = flow.actions.find((a) => a.id === 'x2')!;
		expect(attemptWhos(flow, x2)).toEqual([
			{ who: 'm2', name: '小A' },
			{ who: 'm4', name: '小芳' }
		]);
	});

	it('一次寫成一排記號，照環節順序，空的寫「·」', () => {
		let flow = flowOf(recordAttempt(sample(), 'x1', drill({ p1: '✓', p2: '✓', p3: '△' })));
		flow = flowOf(recordAttempt(flow, 'x1', drill({ p1: '✗' })));
		flow = flowOf(recordAttempt(flow, 'x1', drill({ p3: '✓', p1: '△' }, { whole: false })));
		const x1 = flow.actions.find((a) => a.id === 'x1')!;
		expect(x1.successRate!.records.map((r) => attemptText(x1, r))).toEqual(['✓✓△', '✗··', '△·✓']);
	});
});

describe('記一次：擋下來的情況', () => {
	it.each([
		['記號指到不在的環節', 'x1', drill({ p1: '✓', p9: '✓' }), '記號要打在這個動作的環節上'],
		['記號指到別的動作的環節', 'x1', drill({ p4: '✓' }), '記號要打在這個動作的環節上'],
		['記號不是 ✓ △ ✗', 'x1', drill({ p1: 'O' as never }), '記號只能是 ✓、△、✗'],
		['一個記號都沒有', 'x1', drill({}), '一次至少要有一個記號'],
		['沒有人的組', 'x1', drill({ p1: '✓' }, { who: 'g3' }), '這一組沒有人'],
		['分組的動作給了隊員', 'x1', drill({ p1: '✓' }, { who: 'm1' }), '這一組沒有人'],
		['騰翻的動作給了不在動作裡的隊員', 'x2', drill({ p4: '✓' }, { who: 'm3' }), '這個隊員不在動作裡'],
		['騰翻的動作給了組', 'x2', drill({ p4: '✓' }, { who: 'g1' }), '這個隊員不在動作裡'],
		['日期寫錯', 'x1', drill({ p1: '✓' }, { date: '2026/11/4' }), '日期要寫成 2026-11-04 這樣'],
		['全上沒帶全上的 id', 'x1', drill({ p1: '✓' }, { practice: 'runThrough' }), '全上要帶同一次全上的 id'],
		['分段練帶了全上的 id', 'x1', drill({ p1: '✓' }, { runThroughId: 'u1' }), '全上要帶同一次全上的 id']
	] as const)('%s', (_, actionId, input, message) => {
		expect(recordAttempt(sample(), actionId, input)).toEqual({ kind: 'blocked', message });
	});

	it('沒打開記成功率的動作', () => {
		const flow = flowOf(
			addAction(sample(), {
				segmentId: 's1',
				category: 'jump',
				name: '',
				start: 48,
				length: 8,
				note: '',
				members: [{ memberId: 'm3', role: null }]
			})
		);
		expect(recordAttempt(flow, 'x3', drill({ p1: '✓' }, { who: 'm3' }))).toEqual({
			kind: 'blocked',
			message: '這個動作沒有記成功率'
		});
	});
});

describe('記一次全上', () => {
	const date = '2026-11-04';
	/** Lib 第 1 組全 ✓、第 2 組下法 ✗；騰翻小美 ✓、小A ✗。 */
	const sheet = (): RunThroughMarks[] => [
		{ actionId: 'x1', who: 'g1', marks: { p1: '✓', p2: '✓', p3: '✓' } },
		{ actionId: 'x1', who: 'g2', marks: { p1: '✓', p2: '△', p3: '✗' } },
		{ actionId: 'x2', who: 'm1', marks: { p4: '✓' } },
		{ actionId: 'x2', who: 'm2', marks: { p4: '✗' } }
	];

	it('一次存成很多次：都標成全上、帶同一個全上 id、整個做，日期是給的那天', () => {
		const r = recordRunThrough(sample(), date, sheet());
		expect(r.kind).toBe('ok');
		if (r.kind !== 'ok') return;
		expect(r.runThroughId).toBe('r1');
		const all = [...recordsOf(r.flow), ...recordsOf(r.flow, 'x2')];
		expect(all.map((a) => [a.who, a.marks])).toEqual(sheet().map((e) => [e.who, e.marks]));
		for (const a of all) {
			expect(a).toMatchObject({ date, practice: 'runThrough', runThroughId: 'r1', whole: true });
		}
		expect(new Set(all.map((a) => a.id)).size).toBe(4);
	});

	it('第二次全上帶新的全上 id；刪掉了也不重用', () => {
		let flow = flowOf(recordRunThrough(sample(), date, sheet().slice(0, 1)));
		flow = flowOf(deleteLastAttempt(flow, 'x1', 'g1', date, 'runThrough'));
		const r = recordRunThrough(flow, date, sheet().slice(0, 1));
		expect(r.kind === 'ok' && r.runThroughId).toBe('r2');
	});

	it('沒做的動作（沒給）沒有紀錄', () => {
		const flow = flowOf(recordRunThrough(sample(), date, sheet().slice(0, 2)));
		expect(recordsOf(flow)).toHaveLength(2);
		expect(recordsOf(flow, 'x2')).toEqual([]);
	});

	it('每個動作都沒做：擋下來，什麼都不存', () => {
		expect(recordRunThrough(sample(), date, [])).toMatchObject({ kind: 'blocked' });
	});

	it('有一次不守記一次的規則：擋下來寫出是哪個動作，一次都不存', () => {
		const bad = [...sheet().slice(0, 1), { actionId: 'x2', who: 'm3', marks: { p4: '✓' } } as const];
		expect(recordRunThrough(sample(), date, bad)).toEqual({ kind: 'blocked', message: '騰翻：這個隊員不在動作裡' });
		expect(recordRunThrough(sample(), '11/4', sheet())).toMatchObject({ kind: 'blocked' });
		expect(recordRunThrough(sample(), date, [{ actionId: 'x9', who: 'g1', marks: { p1: '✓' } }])).toMatchObject({
			kind: 'blocked'
		});
	});

	it('算進整次成功率；練法篩選分得開全上和分段練', () => {
		let flow = flowOf(recordAttempt(sample(), 'x1', drill({ p1: '✓', p2: '✓', p3: '✓' }, { who: 'g2' })));
		flow = flowOf(recordRunThrough(flow, date, sheet()));
		const lib = flow.actions[0];
		const squad2 = (practice?: 'drill' | 'runThrough') =>
			rateTable(flow, lib, { practice }).columns.find((c) => c.who === 'g2')!;
		expect(squad2().whole).toEqual({ whole: 2, clean: 1 });
		expect(squad2('runThrough').whole).toEqual({ whole: 1, clean: 0 });
		expect(squad2('runThrough').phases.p3).toMatchObject({ fail: 1, marked: 1 });
		expect(squad2('drill').whole).toEqual({ whole: 1, clean: 1 });
		expect(squad2('drill').phases.p3).toMatchObject({ fail: 0, marked: 1 });
	});
});

describe('刪掉上一次全上', () => {
	const date = '2026-11-04';
	const run1: RunThroughMarks[] = [
		{ actionId: 'x1', who: 'g1', marks: { p1: '✓', p2: '✓', p3: '✓' } },
		{ actionId: 'x2', who: 'm1', marks: { p4: '✓' } }
	];
	const run2: RunThroughMarks[] = [
		{ actionId: 'x1', who: 'g2', marks: { p1: '✗' } },
		{ actionId: 'x2', who: 'm2', marks: { p4: '✗' } }
	];
	/** 分段練一次、全上 r1、再分段練一次、全上 r2。 */
	const recorded = () => {
		let flow = flowOf(recordAttempt(sample(), 'x1', drill({ p1: '✓' }, { whole: false })));
		flow = flowOf(recordRunThrough(flow, date, run1));
		flow = flowOf(recordAttempt(flow, 'x1', drill({ p2: '✓' }, { whole: false })));
		return flowOf(recordRunThrough(flow, date, run2));
	};
	const runIds = (flow: Flow) => [...recordsOf(flow), ...recordsOf(flow, 'x2')].map((r) => r.runThroughId ?? '-');

	it('整次拿掉這天最後存的那次全上（每個動作的都拿掉），分段練和前一次全上留著', () => {
		const flow = flowOf(deleteLastRunThrough(recorded(), date));
		expect(runIds(flow)).toEqual(['-', 'r1', '-', 'r1']);
		const again = flowOf(deleteLastRunThrough(flow, date));
		expect(runIds(again)).toEqual(['-', '-']);
	});

	it('只看這一天：別天的全上不刪', () => {
		const other = flowOf(recordRunThrough(recorded(), '2026-11-05', run1));
		const flow = flowOf(deleteLastRunThrough(other, date));
		expect(runIds(flow)).toEqual(['-', 'r1', '-', 'r3', 'r1', 'r3']);
	});

	it('這天沒有全上：擋下來', () => {
		const flow = flowOf(recordAttempt(sample(), 'x1', drill({ p1: '✓' })));
		expect(deleteLastRunThrough(flow, date)).toEqual({ kind: 'blocked', message: '這一天還沒有全上' });
	});

	it('這天有沒有全上：有就是這天最後存的那次的全上 id；只有分段練、只有別天的全上就沒有', () => {
		expect(lastRunThrough(recorded(), date)).toBe('r2');
		expect(lastRunThrough(flowOf(deleteLastRunThrough(recorded(), date)), date)).toBe('r1');
		expect(lastRunThrough(recorded(), '2026-11-05')).toBeUndefined();
		expect(lastRunThrough(flowOf(recordAttempt(sample(), 'x1', drill({ p1: '✓' }))), date)).toBeUndefined();
		expect(lastRunThrough(sample(), date)).toBeUndefined();
	});

	it('全上 id 照號碼比，不照字：r10 比 r9 晚', () => {
		let flow = sample();
		for (let i = 0; i < 10; i++) flow = flowOf(recordRunThrough(flow, date, run1));
		expect(lastRunThrough(flow, date)).toBe('r10');
	});

	it('救回：整次放回原本的位置；已經在了就擋下來', () => {
		const before = recorded();
		const r = deleteLastRunThrough(before, date);
		if (r.kind !== 'ok') throw new Error(r.kind);
		const back = flowOf(restoreRunThrough(r.flow, r.removed));
		expect(back.actions).toEqual(before.actions);
		expect(restoreRunThrough(back, r.removed)).toEqual({ kind: 'blocked', message: '這次全上已經在了' });
	});

	it('救回之前又記了一次：放回原本排第幾，又記的排在後面', () => {
		const r = deleteLastRunThrough(recorded(), date);
		if (r.kind !== 'ok') throw new Error(r.kind);
		const more = flowOf(recordAttempt(r.flow, 'x1', drill({ p3: '✓' }, { whole: false })));
		const back = flowOf(restoreRunThrough(more, r.removed));
		expect(runIds(back)).toEqual(['-', 'r1', '-', 'r2', '-', 'r1', 'r2']);
	});
});
