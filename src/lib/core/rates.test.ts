import { describe, expect, it } from 'vitest';
import {
	addAction,
	addMembers,
	addSegment,
	completionPercent,
	createFlow,
	dailyTable,
	enableSuccessRate,
	percent,
	recordAttempt,
	setSquad,
	successPercent,
	updateSegment,
	weakestPhase,
	type Action,
	type CommandResult,
	type Flow,
	type Mark,
	type NewAttempt
} from './index';

function flowOf(r: CommandResult): Flow {
	if (r.kind !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(r)}`);
	return r.flow;
}

/**
 * 音樂 1（4 個八拍）；隊員小美（上層）、小A、小B、小芳（上層）。
 * x1：Lib（技巧），記成功率（p1 上法、p2 中段、p3 下法）；小美、小A 第 1 組，小B、小芳 第 2 組。
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
	flow = flowOf(enableSuccessRate(flow, 'x1'));
	for (const [id, squad] of [['m1', 1], ['m2', 1], ['m3', 2], ['m4', 2]] as const) {
		flow = flowOf(setSquad(flow, 'x1', id, squad));
	}
	return flow;
}

/** 一次寫成 '✓✗·'（照 p1 p2 p3），加上其他欄位。 */
function attempt(text: string, more: Partial<NewAttempt> = {}): NewAttempt {
	const marks: Record<string, Mark> = {};
	[...text].forEach((m, i) => {
		if (m !== '·') marks[`p${i + 1}`] = m as Mark;
	});
	return { date: '2026-11-04', who: 1, practice: 'drill', whole: true, marks, ...more };
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
			lib(attempt('✓··'), attempt('✗··', { who: 2 }), attempt('✗··', { who: 2 }), attempt('✗··', { who: 2 }))
		);
		expect(table.total.phases.p1).toEqual(tally(1, 0, 3));
		expect(successPercent(table.total.phases.p1)).toBe(25);
	});

	it('只看某一組', () => {
		const action = lib(attempt('✓✓✓'), attempt('✗··', { who: 2 }), attempt('✗··', { who: 2 }));
		expect(dailyTable(action, 2).total.phases.p1).toEqual(tally(0, 0, 2));
		expect(dailyTable(action, 1).total.whole).toEqual({ clean: 1, whole: 1 });
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
		const r = weakestPhase(lib(attempt('✓✗·'), attempt('✗✓·', { whole: false })), '2026-11-04');
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
