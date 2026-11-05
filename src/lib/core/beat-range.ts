// 拍的範圍：動作裡從某個半拍起、幾個半拍長的一段（拍點、環節標的拍都是）。
// 切掉一段、塞進變短的動作、對齊整拍、檢查、切進每個八拍，拍點和標的拍共用這裡。
// 兩邊的差別只有一個，寫在 RULES：拍點可以落在半拍「&」上（動作被拖半拍時跟著走），標的拍一定在音樂的整拍上。

import type { Action } from './action-types';
import type { Cue, CueKind } from './cues';
import type { Phase } from './phase-types';
import type { Segment } from './segment';
import { atText, HALF_BEATS_PER_BEAT as BEAT, HALF_BEATS_PER_EIGHT as EIGHT, lengthText } from './time';

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

/**
 * 拍點小窗和八拍表的拍：「3-5 到 3-6・2 拍」，只有一拍（或不到一拍）是「3-5・1 拍」。
 * at 是段內時間；結束拍寫最後一拍開始的那個半拍（從 & 開始的就落在 & 上：「2-4& 到 2-7&・4 拍」）。
 */
export function beatSpanText(segment: Segment, at: number, len: number): string {
	const last = at + len - BEAT;
	const range = last > at ? `${atText(segment, at)} 到 ${atText(segment, last)}` : atText(segment, at);
	return `${range}・${lengthText(segment, len)} 拍`;
}

/** 一段拍落在一個八拍裡的那一段：從這個八拍開頭算第 start 個半拍到第 end 個半拍（不含 end，0–16）。 */
export interface EightPiece {
	start: number;
	end: number;
	/** 這段拍從這個八拍開始（不是從前一個八拍接過來的）。 */
	first: boolean;
	/** 這段拍在這個八拍結束（不是接到下一個八拍）。 */
	last: boolean;
}

/** 動作碰到的一個八拍，和切進這個八拍的拍點、環節標的拍。 */
export interface ActionEight {
	/** 段內第幾個八拍，從 0 起。 */
	eight: number;
	/** 照拍點的先後；track 是第幾軌（從 0 起）。 */
	cues: (EightPiece & { cue: Cue; track: number })[];
	/** 標了拍的環節，照環節的先後；沒標拍的不切。 */
	phases: (EightPiece & { phase: Phase; beats: BeatRange })[];
}

/**
 * 把動作的拍點和環節標的拍切進動作碰到的每個八拍（八拍表、拍點格子都用這一份）。
 * 碰到的八拍每個都有一個，沒有拍的也有；跨八拍的拍兩個八拍各拿自己那一段，從「&」開始的從那個半拍算。
 * 疊放：同一種拍點在同一個八拍裡跟前面的疊在一起，就照先後放進第一個空出來的軌（別種不算疊）。
 * 給了 cues 就只切那些（例：個人表只切給他的）；沒給是動作全部的拍點。只算音樂段的動作。
 */
export function actionEights(action: Action, cues: readonly Cue[] = action.cues ?? []): ActionEight[] {
	const first = Math.floor(action.start / EIGHT);
	const last = Math.floor((action.start + action.length - 1) / EIGHT);
	return Array.from({ length: last - first + 1 }, (_, i) => {
		const eight = first + i;
		const lo = eight * EIGHT;
		/** 每一種拍點每一軌畫到這個八拍的第幾個半拍。 */
		const ends: Partial<Record<CueKind, number[]>> = {};
		return {
			eight,
			cues: cues.flatMap((cue) => {
				const piece = pieceIn(lo, action.start + cue.at, cue.len);
				if (!piece) return [];
				const tracks = (ends[cue.kind] ??= []);
				let track = tracks.findIndex((end) => end <= piece.start);
				if (track < 0) track = tracks.length;
				tracks[track] = piece.end;
				return [{ ...piece, cue, track }];
			}),
			phases: (action.successRate?.phases ?? []).flatMap((phase) => {
				const { beats } = phase;
				if (!beats) return [];
				const piece = pieceIn(lo, action.start + beats.at, beats.len);
				return piece ? [{ ...piece, phase, beats }] : [];
			})
		};
	});
}

/** 從段內第 from 個半拍起、len 個半拍長的一段，落在從 lo 開始的那個八拍裡的那一段；沒落在裡面是 null。 */
function pieceIn(lo: number, from: number, len: number): EightPiece | null {
	const hi = lo + EIGHT;
	const to = from + len;
	if (to <= lo || from >= hi) return null;
	return { start: Math.max(from, lo) - lo, end: Math.min(to, hi) - lo, first: from >= lo, last: to <= hi };
}
