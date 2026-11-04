import { describe, expect, it } from 'vitest';
import {
	addAction,
	completionPercent,
	dailyTable,
	cellDetail,
	addPhase,
	percent,
	periodRange,
	rateBand,
	rateTable,
	recordAttempt,
	successPercent,
	weakestPhase,
	type Action,
	type Flow,
	type Mark,
	type NewAttempt
} from './index';
import { flowOf, libSample } from '../test-flows';

const sample = libSample;

/** 一次寫成 '✓✗·'（照 p1 p2 p3），加上其他欄位。 */
function attempt(text: string, more: Partial<NewAttempt> = {}): NewAttempt {
	const marks: Record<string, Mark> = {};
	[...text].forEach((m, i) => {
		if (m !== '·') marks[`p${i + 1}`] = m as Mark;
	});
	return { date: '2026-11-04', who: 'g1', practice: 'drill', whole: true, marks, ...more };
}

/** 照順序記好這些次，回傳 Lib。 */
function lib(...attempts: NewAttempt[]): Action {
	let flow = sample();
	for (const a of attempts) flow = flowOf(recordAttempt(flow, 'x1', a));
	return flow.actions.find((a) => a.id === 'x1')!;
}

const tally = (success: number, minor: number, fail: number) => ({ success, minor, fail, marked: success + minor + fail });
const none = tally(0, 0, 0);

describe('每天的表', () => {
	it('第 1 組記 ✓✓△、✓✗·、✓✓✓：上法 100%、中段 67%、下法 50%（完成率 100%，2 次），整次 33%', () => {
		const table = dailyTable(lib(attempt('✓✓△'), attempt('✓✗·'), attempt('✓✓✓')));
		const day = { date: '2026-11-04', phases: { p1: tally(3, 0, 0), p2: tally(2, 0, 1), p3: tally(1, 1, 0) }, whole: { clean: 1, whole: 3 } };
		expect(table.days).toEqual([day]);
		expect(table.total).toEqual({ phases: day.phases, whole: day.whole });
		expect(successPercent(day.phases.p1)).toBe(100);
		expect(successPercent(day.phases.p2)).toBe(67);
		expect(successPercent(day.phases.p3)).toBe(50);
		expect(completionPercent(day.phases.p3)).toBe(100);
		expect(percent(day.whole.clean, day.whole.whole)).toBe(33);
	});

	it('空的不算：只練上法的次，中段、下法的次數不變', () => {
		const table = dailyTable(lib(attempt('✓··', { whole: false }), attempt('△··', { whole: false })));
		expect(table.total.phases).toEqual({ p1: tally(1, 1, 0), p2: none, p3: none });
		expect(successPercent(none)).toBeNull();
		expect(completionPercent(none)).toBeNull();
	});

	it('只練幾個環節的次不算整次，就算全是 ✓', () => {
		const table = dailyTable(lib(attempt('✓✓·', { whole: false }), attempt('✓✓✓')));
		expect(table.total.whole).toEqual({ clean: 1, whole: 1 });
	});

	it('中途 ✗、後面空著的次也算整次（不是全 ✓）', () => {
		const table = dailyTable(lib(attempt('✗··'), attempt('✓✓✓')));
		expect(table.total.whole).toEqual({ clean: 1, whole: 2 });
	});

	it('一次都沒有整個做：整次是 0 ÷ 0，沒有百分比', () => {
		const table = dailyTable(lib(attempt('✓··', { whole: false })));
		expect(table.total.whole).toEqual({ clean: 0, whole: 0 });
		expect(percent(0, 0)).toBeNull();
	});

	it('照日期排，合計把每天的次數加起來；分段練和全上都算', () => {
		const table = dailyTable(
			lib(
				attempt('✓✓✓', { date: '2026-11-05' }),
				attempt('✗··', { date: '2026-11-03' }),
				attempt('✓✓△', { date: '2026-11-05', practice: 'runThrough', runThroughId: 'r1' })
			)
		);
		expect(table.days.map((d) => d.date)).toEqual(['2026-11-03', '2026-11-05']);
		expect(table.days[1].phases.p3).toEqual(tally(1, 1, 0));
		expect(table.total.phases).toEqual({ p1: tally(2, 0, 1), p2: tally(2, 0, 0), p3: tally(1, 1, 0) });
		expect(table.total.whole).toEqual({ clean: 1, whole: 3 });
	});

	it('合計加次數、不平均百分比：第 1 組 1 次 ✓、第 2 組 3 次 ✗ → 25%，不是 50%', () => {
		const table = dailyTable(
			lib(attempt('✓··'), attempt('✗··', { who: 'g2' }), attempt('✗··', { who: 'g2' }), attempt('✗··', { who: 'g2' }))
		);
		expect(table.total.phases.p1).toEqual(tally(1, 0, 3));
		expect(successPercent(table.total.phases.p1)).toBe(25);
	});

	it('只看某一組', () => {
		const action = lib(attempt('✓✓✓'), attempt('✗··', { who: 'g2' }), attempt('✗··', { who: 'g2' }));
		expect(dailyTable(action, 'g2').total.phases.p1).toEqual(tally(0, 0, 2));
		expect(dailyTable(action, 'g1').total.whole).toEqual({ clean: 1, whole: 1 });
		expect(dailyTable(action).total.phases.p1).toEqual(tally(1, 0, 2));
	});

	it('沒有紀錄：沒有天，合計每格都是 0 次', () => {
		const table = dailyTable(lib());
		expect(table.days).toEqual([]);
		expect(table.total).toEqual({ phases: { p1: none, p2: none, p3: none }, whole: { clean: 0, whole: 0 } });
	});
});

describe('百分比', () => {
	it('四捨五入到整數；0 次沒有百分比', () => {
		expect(percent(2, 3)).toBe(67);
		expect(percent(1, 3)).toBe(33);
		expect(percent(1, 8)).toBe(13);
		expect(percent(0, 4)).toBe(0);
		expect(percent(0, 0)).toBeNull();
	});
});

describe('最弱的環節', () => {
	it('上面的例子：下法 50%', () => {
		const r = weakestPhase(lib(attempt('✓✓△'), attempt('✓✗·'), attempt('✓✓✓')), '2026-11-04');
		expect(r?.phase.id).toBe('p3');
		expect(r?.tally).toEqual(tally(1, 1, 0));
	});

	it('一樣低就取前面的：上法、中段都是 50%', () => {
		const r = weakestPhase(lib(attempt('✓✗·'), attempt('✗··', { whole: false }), attempt('·✓·', { whole: false })), '2026-11-04');
		expect(r?.phase.id).toBe('p1');
	});

	it('比真正的比例，不比四捨五入後的數字：2/3 比 67/100 低', () => {
		const action = lib(
			...Array.from({ length: 67 }, () => attempt('✓··', { whole: false })),
			...Array.from({ length: 33 }, () => attempt('✗··', { whole: false })),
			attempt('·✓·', { whole: false }),
			attempt('·✓·', { whole: false }),
			attempt('·✗·', { whole: false })
		);
		expect(weakestPhase(action, '2026-11-04')?.phase.id).toBe('p2');
	});

	it('只看那天：別天的紀錄不算；那天沒有記號的環節不算', () => {
		const action = lib(attempt('✗✗✗', { date: '2026-11-03' }), attempt('✓··', { whole: false }), attempt('·✗·', { date: '2026-11-03', whole: false }));
		expect(weakestPhase(action, '2026-11-04')?.phase.id).toBe('p1');
	});

	it('那天沒紀錄就沒有', () => {
		expect(weakestPhase(lib(attempt('✗··')), '2026-11-05')).toBeNull();
	});
});

/** 照順序記好這些次，回傳整個流程（總表要組的名字）。 */
function recorded(...attempts: NewAttempt[]): Flow {
	let flow = sample();
	for (const a of attempts) flow = flowOf(recordAttempt(flow, 'x1', a));
	return flow;
}
const x1 = (flow: Flow) => flow.actions.find((a) => a.id === 'x1')!;
const runThrough = (id: string) => ({ practice: 'runThrough' as const, runThroughId: id });

describe('成功率表', () => {
	it('一欄一組（寫組的名字），每格是這組這個環節的次數；合計把每組的次數加起來', () => {
		const flow = recorded(attempt('✓✓△'), attempt('✓✗·'), attempt('✗··', { who: 'g2' }), attempt('✓✓✓', { who: 'g2' }));
		const table = rateTable(flow, x1(flow));
		expect(table.columns.map((c) => [c.who, c.name])).toEqual([
			['g1', '第 1 組 小美'],
			['g2', '第 2 組 小芳']
		]);
		expect(table.columns[0].phases).toEqual({ p1: tally(2, 0, 0), p2: tally(1, 0, 1), p3: tally(0, 1, 0) });
		expect(table.columns[0].whole).toEqual({ clean: 0, whole: 2 });
		expect(table.columns[1].phases).toEqual({ p1: tally(1, 0, 1), p2: tally(1, 0, 0), p3: tally(1, 0, 0) });
		expect(table.columns[1].whole).toEqual({ clean: 1, whole: 2 });
		expect(table.total.phases).toEqual({ p1: tally(3, 0, 1), p2: tally(2, 0, 1), p3: tally(1, 1, 0) });
		expect(table.total.whole).toEqual({ clean: 1, whole: 4 });
	});

	it('合計加次數、不平均百分比：第 1 組 1 次 ✓、第 2 組 3 次 ✗ → 25%', () => {
		const flow = recorded(attempt('✓··'), attempt('✗··', { who: 'g2' }), attempt('✗··', { who: 'g2' }), attempt('✗··', { who: 'g2' }));
		expect(successPercent(rateTable(flow, x1(flow)).total.phases.p1)).toBe(25);
	});

	it('日期範圍：from 到 to（都算進去）以外的天不算', () => {
		const flow = recorded(
			attempt('✗··', { date: '2026-10-28' }),
			attempt('✓··', { date: '2026-10-29' }),
			attempt('✓··', { date: '2026-11-04' }),
			attempt('✗··', { date: '2026-11-05' })
		);
		const table = rateTable(flow, x1(flow), { from: '2026-10-29', to: '2026-11-04' });
		expect(table.total.phases.p1).toEqual(tally(2, 0, 0));
		expect(rateTable(flow, x1(flow)).total.phases.p1).toEqual(tally(2, 0, 2));
	});

	it('練法：只看分段練、只看全上', () => {
		const flow = recorded(attempt('✓··'), attempt('✗✗✗', runThrough('r1')), attempt('△✓✓', runThrough('r2')));
		expect(rateTable(flow, x1(flow), { practice: 'drill' }).total.phases.p1).toEqual(tally(1, 0, 0));
		const run = rateTable(flow, x1(flow), { practice: 'runThrough' }).total;
		expect(run.phases.p1).toEqual(tally(0, 1, 1));
		expect(run.whole).toEqual({ clean: 0, whole: 2 });
	});

	it('騰翻、跳躍是一欄一個人（照名單順序）', () => {
		let flow = sample();
		const members = [
			{ memberId: 'm3', role: '騰翻' },
			{ memberId: 'm1', role: '騰翻' }
		];
		flow = flowOf(addAction(flow, { segmentId: 's1', category: 'tumbling', name: '', start: 32, length: 16, note: '', members }));
		flow = flowOf(addPhase(flow, 'x2', { kind: 'whole', name: '騰翻', beats: { at: 0, len: 16 } }));
		const tumbling = () => flow.actions.find((a) => a.id === 'x2')!;
		const phase = tumbling().successRate!.phases[0].id;
		const mark = (who: string, m: Mark): NewAttempt => ({ date: '2026-11-04', who, practice: 'drill', whole: true, marks: { [phase]: m } });
		for (const a of [mark('m1', '✓'), mark('m3', '✗'), mark('m3', '✓')]) flow = flowOf(recordAttempt(flow, 'x2', a));
		const table = rateTable(flow, tumbling());
		expect(table.columns.map((c) => [c.who, c.name])).toEqual([
			['m1', '小美'],
			['m3', '小B']
		]);
		expect(table.columns[1].phases[phase]).toEqual(tally(1, 0, 1));
		expect(table.total.phases[phase]).toEqual(tally(2, 0, 1));
	});

	it('沒有紀錄：每格都是 0 次', () => {
		const flow = recorded();
		const table = rateTable(flow, x1(flow));
		expect(table.columns[0].phases.p1).toEqual(none);
		expect(table.total.whole).toEqual({ clean: 0, whole: 0 });
	});
});

describe('期間', () => {
	it('今天：只有選的那天', () => {
		expect(periodRange('2026-11-04', 'today')).toEqual({ from: '2026-11-04', to: '2026-11-04' });
	});

	it('最近 7 天：從選的日期往回算，連那天共 7 天（跨月、跨年）', () => {
		expect(periodRange('2026-11-04', 'week')).toEqual({ from: '2026-10-29', to: '2026-11-04' });
		expect(periodRange('2027-01-03', 'week')).toEqual({ from: '2026-12-28', to: '2027-01-03' });
	});

	it('全部：不限日期', () => {
		expect(periodRange('2026-11-04', 'all')).toEqual({});
	});
});

describe('一格的明細', () => {
	it('這組、這個環節每天的每一次記號，照日期排，標出全上的那幾次；別組、沒打這個環節的不算', () => {
		const flow = recorded(
			attempt('✓✓✗', { date: '2026-11-05' }),
			attempt('✓✗·', { date: '2026-11-04' }),
			attempt('✗··', { date: '2026-11-04', who: 'g2' }),
			attempt('✓✓△', { date: '2026-11-04', ...runThrough('r1') }),
			attempt('✓··', { date: '2026-11-04', whole: false })
		);
		expect(cellDetail(x1(flow), 'g1', 'p3')).toEqual([
			{ date: '2026-11-04', marks: [{ mark: '△', runThrough: true }] },
			{ date: '2026-11-05', marks: [{ mark: '✗', runThrough: false }] }
		]);
		expect(cellDetail(x1(flow), 'g1', 'p1').map((d) => d.marks.map((m) => m.mark).join(''))).toEqual(['✓✓✓', '✓']);
		expect(cellDetail(x1(flow), 'g2', 'p2')).toEqual([]);
	});
});

describe('格子的顏色', () => {
	it('90% 以上綠、75–89% 黃、75% 以下紅；沒有紀錄沒有顏色', () => {
		expect(rateBand(100)).toBe('good');
		expect(rateBand(90)).toBe('good');
		expect(rateBand(89)).toBe('fair');
		expect(rateBand(75)).toBe('fair');
		expect(rateBand(74)).toBe('poor');
		expect(rateBand(0)).toBe('poor');
		expect(rateBand(null)).toBeNull();
	});
});
