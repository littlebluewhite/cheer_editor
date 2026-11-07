import { describe, expect, it } from 'vitest';
import {
	checkRecord,
	deleteAction,
	deletePhase,
	putRecords,
	runCommands,
	takeRecords,
	type Attempt,
	type Flow,
	type StoredAttempt
} from './index';
import { flowOf, ratedSample } from '../test-flows';

/** 手機發的一次：第 1 組在 11/4 分段練、整個做。 */
const attempt = (id: string, marks: Attempt['marks'], more: Partial<Attempt> = {}): Attempt => ({
	id,
	date: '2026-11-04',
	who: 'g1',
	practice: 'drill',
	whole: true,
	marks,
	...more
});

const stored = (actionId: string, a: Attempt): StoredAttempt => ({ actionId, attempt: a });

const recordsOf = (flow: Flow, id = 'x1') => flow.actions.find((a) => a.id === id)!.successRate!.records;

describe('分開存的紀錄放回流程、拿出來', () => {
	it('放回去再拿出來不變：每個動作照給的順序放，拿出來照動作、照記的先後', () => {
		const records = [
			stored('x1', attempt('tabc123def456', { p1: '✓', p2: '✓', p3: '△' })),
			stored('x2', attempt('tqwe123rty456', { [ratedSample().actions[1].successRate!.phases[0].id]: '✗' }, { who: 'm1' })),
			stored('x1', attempt('tzzz000yyy111', { p1: '✗' }, { who: 'g2', whole: false }))
		];
		const flow = putRecords(ratedSample(), records);

		expect(recordsOf(flow).map((r) => r.id)).toEqual(['tabc123def456', 'tzzz000yyy111']);
		expect(recordsOf(flow, 'x2').map((r) => r.id)).toEqual(['tqwe123rty456']);
		const taken = takeRecords(flow);
		expect(taken.flow).toEqual(ratedSample());
		expect(taken.records).toEqual([records[0], records[2], records[1]]);
		expect(putRecords(taken.flow, taken.records)).toEqual(flow);
	});

	it('指到不在的動作、不記成功率的動作的不放', () => {
		const flow = putRecords(ratedSample(), [stored('x9', attempt('tabc123def456', { p1: '✓' }))]);
		expect(flow).toEqual(ratedSample());
	});

	it('跑一步：清掉的、改了記號的照結果拿出來（例：刪掉環節，打在它上面的記號丟掉，丟光的整筆不見）', () => {
		const flow = putRecords(ratedSample(), [
			stored('x1', attempt('tabc123def456', { p1: '✓', p2: '✓' })),
			stored('x1', attempt('tzzz000yyy111', { p1: '✗' }, { whole: false }))
		]);
		const r = runCommands(flow, [{ name: 'deletePhase', args: ['x1', 'p1'], options: { confirmed: true } }], 'stepabc12345');
		expect(r.kind).toBe('ok');
		if (r.kind !== 'ok') return;
		expect(takeRecords(r.flow).records).toEqual([stored('x1', attempt('tabc123def456', { p2: '✓' }))]);
	});
});

describe('記一次的檢查（伺服器收一次時）', () => {
	it('對得上：照收', () => {
		const a = attempt('tabc123def456', { p1: '✓', p2: '✓', p3: '△' });
		expect(checkRecord(ratedSample(), stored('x1', a))).toEqual({ kind: 'ok', record: stored('x1', a) });
	});

	it('打在不在的環節上的記號丟掉，其他的照收', () => {
		const flow = flowOf(deletePhase(ratedSample(), 'x1', 'p3', { confirmed: true }));
		const r = checkRecord(flow, stored('x1', attempt('tabc123def456', { p1: '✓', p2: '✓', p3: '△' })));
		expect(r).toEqual({ kind: 'ok', record: stored('x1', attempt('tabc123def456', { p1: '✓', p2: '✓' })) });
	});

	it('記號丟光了：整筆不存', () => {
		const flow = flowOf(deletePhase(ratedSample(), 'x1', 'p3', { confirmed: true }));
		const r = checkRecord(flow, stored('x1', attempt('tabc123def456', { p3: '△' }, { whole: false })));
		expect(r).toEqual({ kind: 'dropped', message: '記號打的環節都被刪掉了' });
	});

	it('動作、組、隊員不在了：整筆不存，說原因', () => {
		const gone = flowOf(deleteAction(ratedSample(), 'x1', { confirmed: true }));
		expect(checkRecord(gone, stored('x1', attempt('tabc123def456', { p1: '✓' })))).toEqual({
			kind: 'dropped',
			message: '這個動作被刪掉了'
		});
		expect(checkRecord(ratedSample(), stored('x1', attempt('tabc123def456', { p1: '✓' }, { who: 'g9' })))).toEqual({
			kind: 'dropped',
			message: '這一組沒有人了'
		});
		const x2 = ratedSample().actions[1].successRate!.phases[0].id;
		expect(checkRecord(ratedSample(), stored('x2', attempt('tabc123def456', { [x2]: '✓' }, { who: 'm4' })))).toEqual({
			kind: 'dropped',
			message: '這個隊員不在動作裡'
		});
	});

	it('不守記一次的規則（記號不對、日期不對、id 不是亂數）：整筆不存', () => {
		const bad = (a: Attempt) => checkRecord(ratedSample(), stored('x1', a)).kind;
		expect(bad(attempt('tabc123def456', { p1: '?' as never }))).toBe('dropped');
		expect(bad(attempt('tabc123def456', { p1: '✓' }, { date: '2026-13-01' }))).toBe('dropped');
		expect(bad(attempt('t1', { p1: '✓' }))).toBe('dropped');
		expect(bad(attempt('tabc123def456', { p1: '✓' }, { practice: 'runThrough', runThroughId: 'r1' }))).toBe('dropped');
	});

	it('一個人記的全上：帶全上 id 和開的時間，照收', () => {
		const a = attempt('tabc123def456', { p1: '✓', p2: '✓', p3: '✓' }, {
			practice: 'runThrough',
			runThroughId: 'rabc123def456',
			runThroughStartedAt: 1_762_000_000_000
		});
		expect(checkRecord(ratedSample(), stored('x1', a))).toEqual({ kind: 'ok', record: stored('x1', a) });
	});

	it('跟手機上記一次存成的一樣（recordAttempt 在一步裡發的 id）', () => {
		const r = runCommands(
			ratedSample(),
			[{ name: 'recordAttempt', args: ['x1', { date: '2026-11-04', who: 'g2', practice: 'drill', whole: true, marks: { p1: '✓' } }] }],
			'stepabc12345'
		);
		if (r.kind !== 'ok') throw new Error(r.kind);
		const [record] = takeRecords(r.flow).records;
		expect(checkRecord(ratedSample(), record)).toEqual({ kind: 'ok', record });
	});
});
