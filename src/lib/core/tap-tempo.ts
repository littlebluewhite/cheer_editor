// 敲擊測速：跟著音樂連點，用點的間隔算出 BPM。不做自動偵測（決定 D5）。

/** 至少點幾下才算。 */
export const MIN_TAPS = 8;

/** 間隔跟中位數差超過這個比例就當成點歪了，不算進去。 */
const OUTLIER = 0.25;

/**
 * 點的時間（秒，由小到大）→ BPM，取到整數。點不到 MIN_TAPS 下是 null。
 * 先拿間隔的中位數，去掉離它太遠的間隔（點歪一下會帶歪前後兩個間隔），剩下的取平均。
 */
export function tapBpm(times: number[]): number | null {
	if (times.length < MIN_TAPS) return null;
	const gaps = times.slice(1).map((t, i) => t - times[i]);
	const sorted = [...gaps].sort((a, b) => a - b);
	const mid = sorted.length / 2;
	const median = sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
	const kept = gaps.filter((g) => Math.abs(g - median) <= median * OUTLIER);
	const average = kept.reduce((a, b) => a + b, 0) / kept.length;
	return Math.round(60 / average);
}
