// 拍的範圍：動作裡從某個半拍起、幾個半拍長的一段（拍點、環節標的拍都是）。
// 切掉一段、塞進變短的動作、對齊整拍、檢查，拍點和標的拍共用這裡。
// 兩邊的差別只有一個，寫在 RULES：拍點可以落在半拍「&」上（動作被拖半拍時跟著走），標的拍一定在音樂的整拍上。

import type { Action } from './action-types';
import type { Segment } from './segment';
import { atText, HALF_BEATS_PER_BEAT as BEAT } from './time';

/** 從動作開始算第幾個半拍起（0 = 動作開始那一刻）、幾個半拍長。 */
export interface BeatRange {
	at: number;
	len: number;
}

/** 拍點、環節標的拍。 */
export type RangeOf = 'cue' | 'phase';

const RULES: Record<RangeOf, { noun: string; wholeBeat: boolean }> = {
	cue: { noun: '拍點', wholeBeat: false },
	phase: { noun: '環節', wholeBeat: true }
};

/** 從動作開始算第 at 個半拍，在不在音樂的整拍上。 */
export function onBeat(action: Action, at: number): boolean {
	return (action.start + at) % BEAT === 0;
}

/** 這段拍哪裡不守規則（給教練看的原因）：落在半拍上、（標的拍）在整拍上、佔整數拍至少 1 拍、在動作裡面。沒問題是 null。 */
export function rangeProblem(of: RangeOf, action: Action, { at, len }: BeatRange): string | null {
	const { noun, wholeBeat } = RULES[of];
	if (!Number.isInteger(at) || !Number.isInteger(len)) return `${noun}要落在半拍上`;
	if (wholeBeat && !onBeat(action, at)) return `${noun}要標在整拍上`;
	if (len < BEAT || len % BEAT !== 0) return `${noun}要佔整數拍，至少 1 拍`;
	if (at < 0 || at + len > action.length) return `${noun}要在動作裡面`;
	return null;
}

/**
 * 把 [from, to) 半拍從這段拿掉，回傳露在外面的幾塊（前面的在前；留哪幾塊由用的人決定）。
 * 露出來的長度取到整拍（動作被拖半拍後可能差半拍），不到一拍的不回。沒碰到是 null。
 */
export function cutOut({ at, len }: BeatRange, from: number, to: number): BeatRange[] | null {
	if (at >= to || at + len <= from) return null;
	return [
		...(at < from ? [{ at, len: from - at }] : []),
		...(at + len > to ? [{ at: to, len: at + len - to }] : [])
	]
		.map((x) => ({ ...x, len: x.len - (x.len % BEAT) }))
		.filter((x) => x.len >= BEAT);
}

/**
 * 動作改了之後，這段拍放到哪裡：標的拍落在 & 上時挪 by 個半拍（1 往後、-1 往前）對齊整拍，拍點不挪；
 * 再塞進動作：挪到動作開始前的往後收一拍、跑出後面的切掉，長度取到整拍。不到一拍是 undefined。
 */
export function fitRange(of: RangeOf, action: Action, range: BeatRange, by: 1 | -1 = 1): BeatRange | undefined {
	const moved = RULES[of].wholeBeat && !onBeat(action, range.at) ? range.at + by : range.at;
	const at = moved < 0 ? moved + BEAT : moved;
	const fit = Math.min(moved + range.len, action.length) - at;
	const len = fit - (fit % BEAT);
	return len >= BEAT ? { at, len } : undefined;
}

/** 從第一拍到最後一拍（都是段內時間）；只有一拍就只寫那一拍。 */
export function rangeText(segment: Segment, action: Action, at: number, len: number): string {
	const first = atText(segment, action.start + at);
	return len > BEAT ? `${first} 到 ${atText(segment, action.start + at + len - BEAT)}` : first;
}
