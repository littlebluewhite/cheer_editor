import { describe, expect, it } from 'vitest';
import {
	addAction,
	addMembers,
	addSegment,
	attemptText,
	attemptWhos,
	carryRecords,
	clearPhaseBeats,
	createFlow,
	deleteAction,
	deleteLastAttempt,
	deleteMember,
	markPhaseBeats,
	readFlowFile,
	recordableActions,
	recordAttempt,
	recordRunThrough,
	rateTable,
	setSquad,
	updateAction,
	updateSegment,
	writeFlowFile,
	type CommandResult,
	type Flow,
	type NewAttempt,
	type RunThroughMarks
} from './index';

function flowOf(r: CommandResult): Flow {
	if (r.kind !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(r)}`);
	return r.flow;
}

/**
 * 音樂 1（4 個八拍）；隊員小美（上層）、小A、小B、小芳（上層）。
 * x1：Lib（技巧，第 1 個八拍），環節 p1 上法 1-1 到 1-2、p2 中段 1-3 到 1-6、p3 下法 1-7 到 1-8；小美、小A 第 1 組，小B、小芳 第 2 組。
 * x2：騰翻（第 3 個八拍），環節 p4 整體「騰翻」整個動作；小美、小A 在裡面。
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
	flow = flowOf(
		addAction(flow, {
			segmentId: 's1',
			category: 'tumbling',
			name: '',
			start: 32,
			length: 16,
			note: '',
			members: [
				{ memberId: 'm1', role: '騰翻' },
				{ memberId: 'm2', role: '騰翻' }
			]
		})
	);
	return flowOf(markPhaseBeats(flow, 'x2', { kind: 'whole', name: '騰翻' }, 0, 16));
}

const recordsOf = (flow: Flow, id = 'x1') => flow.actions.find((a) => a.id === id)!.successRate!.records;

/** 第 1 組在 2026-11-04 分段練、整個做。 */
const drill = (marks: NewAttempt['marks'], more: Partial<NewAttempt> = {}): NewAttempt => ({
	date: '2026-11-04',
	who: 1,
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
			{ id: 't1', date: '2026-11-04', who: 1, practice: 'drill', whole: true, marks: { p1: '✓', p2: '✓', p3: '△' } }
		]);
		expect(r.id).toBe('t1');
	});

	it('第二次排在後面，id 往下發', () => {
		let flow = flowOf(recordAttempt(sample(), 'x1', drill({ p1: '✓' }, { whole: false })));
		flow = flowOf(recordAttempt(flow, 'x1', drill({ p1: '✗' }, { who: 2 })));
		expect(recordsOf(flow).map((r) => [r.id, r.who, r.marks])).toEqual([
			['t1', 1, { p1: '✓' }],
			['t2', 2, { p1: '✗' }]
		]);
	});

	it('騰翻的動作：誰是隊員 id', () => {
		const flow = flowOf(recordAttempt(sample(), 'x2', drill({ p4: '✓' }, { who: 'm2' })));
		expect(recordsOf(flow, 'x2').map((r) => r.who)).toEqual(['m2']);
	});
});

describe('刪掉上一次', () => {
	/** 11/04：第 1 組 t1、第 2 組 t2、第 1 組 t3；11/05：第 1 組 t4。 */
	function recorded(): Flow {
		let flow = sample();
		for (const input of [
			drill({ p1: '✓' }),
			drill({ p1: '✓' }, { who: 2 }),
			drill({ p1: '✗' }),
			drill({ p1: '△' }, { date: '2026-11-05' })
		]) {
			flow = flowOf(recordAttempt(flow, 'x1', input));
		}
		return flow;
	}

	it('拿掉這組在那天最後記的一次，別組、別天的不動', () => {
		let flow = flowOf(deleteLastAttempt(recorded(), 'x1', 1, '2026-11-04'));
		expect(recordsOf(flow).map((r) => r.id)).toEqual(['t1', 't2', 't4']);
		flow = flowOf(deleteLastAttempt(flow, 'x1', 1, '2026-11-04'));
		expect(recordsOf(flow).map((r) => r.id)).toEqual(['t2', 't4']);
	});

	it('那天這組沒有紀錄就擋下來', () => {
		expect(deleteLastAttempt(recorded(), 'x1', 2, '2026-11-05')).toEqual({
			kind: 'blocked',
			message: '這一天還沒有紀錄'
		});
	});

	it('刪掉的 id 不再發', () => {
		let flow = flowOf(deleteLastAttempt(recorded(), 'x1', 1, '2026-11-05'));
		flow = flowOf(recordAttempt(flow, 'x1', drill({ p2: '✓' })));
		expect(recordsOf(flow).map((r) => r.id)).toEqual(['t1', 't2', 't3', 't5']);
	});
});

describe('把現在的紀錄帶到這份流程上（復原、重做）', () => {
	/** x1：t1 第 1 組 ✓✓△、t2 第 2 組 ✓、t3 第 1 組只有下法 ✗；x2：t4 小A ✓。 */
	function recorded(base = sample()): Flow {
		let flow = base;
		flow = flowOf(recordAttempt(flow, 'x1', drill({ p1: '✓', p2: '✓', p3: '△' })));
		flow = flowOf(recordAttempt(flow, 'x1', drill({ p1: '✓' }, { who: 2, whole: false })));
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
		const fewer = flowOf(deleteLastAttempt(current, 'x1', 1, '2026-11-04'));
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
		const cleared = flowOf(markPhaseBeats(off, 'x2', { kind: 'whole', name: '騰翻' }, 0, 16));
		const carried = carryRecords(current, cleared);
		expect(recordsOf(carried, 'x2')).toEqual([]);
	});

	it('發過的 id 不會因為換上舊的流程又發一次', () => {
		const older = sample();
		let current = recorded();
		current = flowOf(deleteLastAttempt(current, 'x2', 'm2', '2026-11-04'));
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
		let older = flowOf(markPhaseBeats(flowOf(addAction(sample(), toss('m3'))), 'x3', { kind: 'whole', name: '拋投' }, 0, 8));
		older = flowOf(setSquad(older, 'x3', ['m3'], 1));
		let current = flowOf(deleteAction(older, 'x3'));
		current = flowOf(markPhaseBeats(flowOf(addAction(current, toss('m4'))), 'x3', { kind: 'whole', name: '拋投' }, 0, 8));
		current = flowOf(setSquad(current, 'x3', ['m4'], 1));
		const phase = current.actions.find((a) => a.id === 'x3')!.successRate!.phases[0].id;
		current = flowOf(recordAttempt(current, 'x3', drill({ [phase]: '✓' })));

		expect(phase).not.toBe(older.actions.find((a) => a.id === 'x3')!.successRate!.phases[0].id);
		expect(recordsOf(carryRecords(older, current), 'x3')).toEqual([]);
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
		flow = flowOf(recordAttempt(flow, 'x1', drill({ p1: '✓' }, { who: 2 })));
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
		flow = flowOf(markPhaseBeats(add('toss', 16, 'm1'), 'x3', { kind: 'whole', name: '拋投' }, 0, 4));
		flow = add('jump', 20, 'm2'); // 跳躍：沒有環節
		flow = add('dance', 24, 'm3'); // 沒打開
		expect(recordableActions(flow).map((a) => a.id)).toEqual(['x1', 'x3', 'x2']);
	});

	it('每組一張卡：組照號碼排，名字是「第 n 組」加上層；沒分到組的人不出現', () => {
		let flow = flowOf(setSquad(sample(), 'x1', ['m1'], 3));
		flow = flowOf(setSquad(flow, 'x1', ['m2'], null));
		const x1 = flow.actions.find((a) => a.id === 'x1')!;
		expect(attemptWhos(flow, x1)).toEqual([
			{ who: 1, name: '第 1 組 小芳' },
			{ who: 2, name: '第 2 組 小美' }
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
		['沒有人的組', 'x1', drill({ p1: '✓' }, { who: 3 }), '這一組沒有人'],
		['分組的動作給了隊員', 'x1', drill({ p1: '✓' }, { who: 'm1' }), '這一組沒有人'],
		['騰翻的動作給了不在動作裡的隊員', 'x2', drill({ p4: '✓' }, { who: 'm3' }), '這個隊員不在動作裡'],
		['騰翻的動作給了組', 'x2', drill({ p4: '✓' }, { who: 1 }), '這個隊員不在動作裡'],
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
		{ actionId: 'x1', who: 1, marks: { p1: '✓', p2: '✓', p3: '✓' } },
		{ actionId: 'x1', who: 2, marks: { p1: '✓', p2: '△', p3: '✗' } },
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
		flow = flowOf(deleteLastAttempt(flow, 'x1', 1, date));
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
		expect(recordRunThrough(sample(), date, [{ actionId: 'x9', who: 1, marks: { p1: '✓' } }])).toMatchObject({
			kind: 'blocked'
		});
	});

	it('算進整次成功率；練法篩選分得開全上和分段練', () => {
		let flow = flowOf(recordAttempt(sample(), 'x1', drill({ p1: '✓', p2: '✓', p3: '✓' }, { who: 2 })));
		flow = flowOf(recordRunThrough(flow, date, sheet()));
		const lib = flow.actions[0];
		const squad2 = (practice?: 'drill' | 'runThrough') =>
			rateTable(flow, lib, { practice }).columns.find((c) => c.who === 2)!;
		expect(squad2().whole).toEqual({ whole: 2, clean: 1 });
		expect(squad2('runThrough').whole).toEqual({ whole: 1, clean: 0 });
		expect(squad2('runThrough').phases.p3).toMatchObject({ fail: 1, marked: 1 });
		expect(squad2('drill').whole).toEqual({ whole: 1, clean: 1 });
		expect(squad2('drill').phases.p3).toMatchObject({ fail: 0, marked: 1 });
	});
});
