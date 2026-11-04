// 成功率怎麼算。記錄頁的每天的表、總表都用這裡的算法。
// 查詢都回傳次數，百分比由次數算：
// - 成功率 = ✓ ÷ 有打記號的次數；完成率 =（✓＋△）÷ 有打記號的次數。空的不算。
// - 整次成功率 = 整個做的次裡，打的記號全是 ✓ 的次 ÷ 整個做的次。只練幾個環節的次不算；中途 ✗、後面空著的也算。
// - 合計把次數加起來再算，不是把每組的百分比平均。

import type { Action } from './actions';
import type { Flow } from './flow';
import { attemptWhos } from './records';
import type { Attempt, Mark, Phase, PracticeKind } from './success-rate';

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

/** 總表的篩選：日期範圍（YYYY-MM-DD，兩頭都算；沒給就不限），練法（沒給就是全部）。 */
export interface RateFilter {
	from?: string;
	to?: string;
	practice?: PracticeKind;
}

/** 成功率表：一欄一組（騰翻、跳躍一欄一個人），每欄是每個環節和整次的次數；加上合計。 */
export interface RateTable {
	columns: ({ who: number | string; name: string } & RateCounts)[];
	total: RateCounts;
}

/**
 * 成功率表（總表的一塊）：這個動作每組 × 每個環節的次數，加上整次和合計。
 * 欄是現在有人的組（騰翻、跳躍是動作裡的人，照名單順序）。
 */
export function rateTable(flow: Flow, action: Action, filter: RateFilter = {}): RateTable {
	const phases = action.successRate?.phases ?? [];
	const records = (action.successRate?.records ?? []).filter(
		(r) =>
			(filter.from === undefined || r.date >= filter.from) &&
			(filter.to === undefined || r.date <= filter.to) &&
			(filter.practice === undefined || r.practice === filter.practice)
	);
	return {
		columns: attemptWhos(flow, action).map((w) => ({ ...w, ...rateCounts(phases, records.filter((r) => r.who === w.who)) })),
		total: rateCounts(phases, records)
	};
}

/** 總表的期間：今天、最近 7 天（連選的那天）、全部。 */
export type Period = 'today' | 'week' | 'all';

/** 期間換成日期範圍，從選的日期（YYYY-MM-DD）往回算；全部是不限日期。 */
export function periodRange(date: string, period: Period): { from?: string; to?: string } {
	if (period === 'all') return {};
	if (period === 'today') return { from: date, to: date };
	const [y, m, d] = date.split('-').map(Number);
	// 只做日曆的加減，用 UTC 免得碰到夏令時間。
	const from = new Date(Date.UTC(y, m - 1, d - 6));
	const pad = (n: number) => String(n).padStart(2, '0');
	return { from: `${from.getUTCFullYear()}-${pad(from.getUTCMonth() + 1)}-${pad(from.getUTCDate())}`, to: date };
}

/** 一格的明細的一天：那天的每一次記號（照記的先後），標出哪幾次是全上。 */
export interface DetailDay {
	date: string;
	marks: { mark: Mark; runThrough: boolean }[];
}

/** 一格的明細：這組（騰翻、跳躍是這個人）、這個環節每天的每一次記號，照日期排。空的不列。 */
export function cellDetail(action: Action, who: number | string, phaseId: string): DetailDay[] {
	const days = new Map<string, DetailDay['marks']>();
	for (const r of action.successRate?.records ?? []) {
		const mark = r.marks[phaseId];
		if (r.who !== who || !mark) continue;
		if (!days.has(r.date)) days.set(r.date, []);
		days.get(r.date)!.push({ mark, runThrough: r.practice === 'runThrough' });
	}
	return [...days].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, marks]) => ({ date, marks }));
}

/** 格子的顏色：90% 以上 good（綠）、75–89% fair（黃）、75% 以下 poor（紅）；沒有紀錄是 null。用顯示的整數 %。 */
export function rateBand(pct: number | null): 'good' | 'fair' | 'poor' | null {
	if (pct === null) return null;
	return pct >= 90 ? 'good' : pct >= 75 ? 'fair' : 'poor';
}
