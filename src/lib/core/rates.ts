// 成功率怎麼算。記錄頁的每天的表、總表都用這裡的算法。
// 查詢都回傳次數，百分比由次數算：
// - 成功率 = ✓ ÷ 有打記號的次數；完成率 =（✓＋△）÷ 有打記號的次數。空的不算。
// - 整次成功率 = 整個做的次裡，打的記號全是 ✓ 的次 ÷ 整個做的次。只練幾個環節的次不算；中途 ✗、後面空著的也算。
// - 合計把次數加起來再算，不是把每組的百分比平均。

import type { Action } from './actions';
import type { Attempt, Phase } from './success-rate';

/** 一個環節的次數：✓、△、✗ 各幾次，和有打記號的次數（空的不算）。 */
export interface Tally {
	success: number;
	minor: number;
	fail: number;
	marked: number;
}

/** 整次的次數：整個做的次裡全是 ✓ 的（clean），和整個做的次數（whole）。 */
export interface WholeTally {
	clean: number;
	whole: number;
}

/** 一格一格的次數：每個環節（key 是環節 id），加上整次。 */
export interface RateCounts {
	phases: Record<string, Tally>;
	whole: WholeTally;
}

/** 每天的表：一天一列（照日期排），加上合計。 */
export interface DailyTable {
	days: ({ date: string } & RateCounts)[];
	total: RateCounts;
}

/** part ÷ total，四捨五入到整數的百分比；total 是 0 就沒有（null）。 */
export function percent(part: number, total: number): number | null {
	return total === 0 ? null : Math.round((part * 100) / total);
}

/** 成功率（%）：✓ ÷ 有打記號的次數。 */
export function successPercent(t: Tally): number | null {
	return percent(t.success, t.marked);
}

/** 完成率（%）：（✓＋△）÷ 有打記號的次數。 */
export function completionPercent(t: Tally): number | null {
	return percent(t.success + t.minor, t.marked);
}

/** 這些次在每個環節、和整次的次數。 */
export function rateCounts(phases: Phase[], attempts: Attempt[]): RateCounts {
	const counts: RateCounts = {
		phases: Object.fromEntries(phases.map((p) => [p.id, { success: 0, minor: 0, fail: 0, marked: 0 }])),
		whole: { clean: 0, whole: 0 }
	};
	for (const a of attempts) {
		for (const p of phases) {
			const mark = a.marks[p.id];
			if (!mark) continue;
			const t = counts.phases[p.id];
			t.marked++;
			if (mark === '✓') t.success++;
			else if (mark === '△') t.minor++;
			else t.fail++;
		}
		if (a.whole) {
			counts.whole.whole++;
			if (Object.values(a.marks).every((m) => m === '✓')) counts.whole.clean++;
		}
	}
	return counts;
}

/**
 * 每天的表：動作每天、每個環節的次數，加上整次和合計。分段練和全上都算。
 * who 是要看哪一組（騰翻、跳躍是隊員 id）；沒給就是全部。
 */
export function dailyTable(action: Action, who?: number | string): DailyTable {
	const phases = action.successRate?.phases ?? [];
	const records = (action.successRate?.records ?? []).filter((r) => who === undefined || r.who === who);
	const dates = [...new Set(records.map((r) => r.date))].sort();
	return {
		days: dates.map((date) => ({ date, ...rateCounts(phases, records.filter((r) => r.date === date)) })),
		total: rateCounts(phases, records)
	};
}

/**
 * 最弱的環節：那天有記號的環節裡成功率最低的（比真正的比例，不比四捨五入後的數字），一樣低就取前面的。
 * 那天沒紀錄就是 null。
 */
export function weakestPhase(action: Action, date: string): { phase: Phase; tally: Tally } | null {
	const phases = action.successRate?.phases ?? [];
	const counts = rateCounts(phases, (action.successRate?.records ?? []).filter((r) => r.date === date));
	let weakest: { phase: Phase; tally: Tally } | null = null;
	for (const phase of phases) {
		const tally = counts.phases[phase.id];
		if (tally.marked === 0) continue;
		if (!weakest || tally.success * weakest.tally.marked < weakest.tally.success * tally.marked) {
			weakest = { phase, tally };
		}
	}
	return weakest;
}
