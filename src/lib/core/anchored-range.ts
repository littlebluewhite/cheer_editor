// 錨在段上的範圍：A（和可有可無的 B）記成「哪一段的第幾格」，跟著自己的段走。書籤和重複範圍都是。
// 這裡管：秒數換成格子、格子換成秒數、放不放得下（段在、格子在段裡、B 在 A 後面）、是不是同一個地方、
// 段的交界的寫法、插入八拍和切段時怎麼搬。段縮短、刪段、段換順序時拿不拿掉，就是換好段之後放不放得下。
// 書籤和重複範圍邊界規則的差別寫在 AnchorEdges（BOOKMARK_EDGES、REPEAT_EDGES），不是兩份程式。
// 不管：書籤的名字、id、要問的話和原因的代號（bookmarks.ts、各個改段的指令）；重複範圍開不開、播到哪（播放 module）；
// 「哪些書籤因為段改了而不見」。

import type { Flow } from './flow';
import { EPS, segmentSpans, snapToBeat, toSeconds, units, unitSec, type TimePosition } from './time';

/** A 到 B；只有 A 時 b 是 null。 */
export interface AnchoredRange {
	a: TimePosition;
	b: TimePosition | null;
}

/** 範圍現在在哪（全域秒數）。 */
export interface RangeSeconds {
	a: number;
	b: number | null;
}

/** 段的邊界怎麼算：書籤和重複範圍不一樣的地方。 */
export interface AnchorEdges {
	/** A 可以寫在段尾（就是下一段的開頭那一刻）。 */
	aAtSegmentEnd: boolean;
	/** B 可以寫在段的開頭（就是上一段的結尾那一刻）。 */
	bAtSegmentStart: boolean;
	/** 格子要是整數、不是負的（手改過的流程檔會有別的）。 */
	wholeUnits: boolean;
}

/**
 * 書籤：交界只有一種寫法（A 算後一段的開頭、B 算前一段的結尾，見 canonical），
 * 這樣只在音樂 1 裡的書籤，不會因為音樂 2 刪掉、換順序而不見。存在流程檔裡，格子要檢查。
 */
export const BOOKMARK_EDGES: AnchorEdges = { aAtSegmentEnd: false, bAtSegmentStart: false, wholeUnits: true };

/**
 * 重複範圍：從播放頭吸過來的（rangeEnd：交界算後一段，B 也是）或動作拉出來的（A 可以是段尾那一格），
 * 兩頭都可以在交界的任一邊。不存檔，格子都是算出來的整數，不檢查。
 */
export const REPEAT_EDGES: AnchorEdges = { aAtSegmentEnd: true, bAtSegmentStart: true, wholeUnits: false };

/**
 * sec 最近的整拍（口號段 0.1 秒）在哪一段的第幾格。要先有段。
 * 段的交界算後面那一段；流程結尾算最後一段的最後一格後面。格數四捨五入，浮點誤差不會掉到前一格。
 */
export function anchorAt(flow: Flow, sec: number): TimePosition {
	const snapped = snapToBeat(flow, sec);
	const spans = segmentSpans(flow);
	const span = spans.find((s) => snapped < s.startSec + s.durationSec - EPS) ?? spans.at(-1)!;
	const at = Math.round((snapped - span.startSec) / unitSec(span.segment));
	return { segmentId: span.segment.id, at: Math.min(Math.max(at, 0), units(span.segment)) };
}

/** 段在、格子是段裡的整數格（含段頭、段尾）。 */
export function onGrid(flow: Flow, p: TimePosition): boolean {
	const segment = flow.segments.find((s) => s.id === p.segmentId);
	return !!segment && Number.isInteger(p.at) && p.at >= 0 && p.at <= units(segment);
}

/**
 * 範圍現在在哪（全域秒數）。放不下是 null：A、B 所在的段不見了、格子跑到段外（段縮短），
 * 或 B 不在 A 後面（段換了順序）；段頭段尾能不能寫照 edges。
 */
export function anchoredSeconds(flow: Flow, range: AnchoredRange, edges: AnchorEdges): RangeSeconds | null {
	const a = seconds(flow, range.a, edges, 'a');
	if (a === null) return null;
	if (!range.b) return { a, b: null };
	const b = seconds(flow, range.b, edges, 'b');
	return b === null || b <= a + EPS ? null : { a, b };
}

/** 交界換成一種寫法：A 在段尾換成下一段的開頭（沒有下一段就照舊），B 在段頭換成上一段的段尾（第一段就照舊）。 */
export function canonical<T extends AnchoredRange>(flow: Flow, range: T): T {
	const i = flow.segments.findIndex((s) => s.id === range.a.segmentId);
	const next = flow.segments[i + 1];
	const a = i !== -1 && next && range.a.at === units(flow.segments[i]) ? { segmentId: next.id, at: 0 } : range.a;
	let b = range.b;
	if (b) {
		const j = flow.segments.findIndex((s) => s.id === b!.segmentId);
		const prev = flow.segments[j - 1];
		if (j > 0 && b.at === 0) b = { segmentId: prev.id, at: units(prev) };
	}
	return { ...range, a, b };
}

/**
 * list 裡跟 range 在同一個地方（A、B 照秒數比）的第一個；range 放不下就沒有。
 * rangeEdges：range 跟 list 不是同一種時（例：拿重複範圍找書籤），range 的邊界照它。
 */
export function samePlace<T extends AnchoredRange>(
	flow: Flow,
	list: T[],
	range: AnchoredRange,
	edges: AnchorEdges,
	rangeEdges: AnchorEdges = edges
): T | undefined {
	const s = anchoredSeconds(flow, range, rangeEdges);
	return s ? list.find((x) => sameSeconds(anchoredSeconds(flow, x, edges), s)) : undefined;
}

/** 兩頭寫的是不是同一格（同一段、同一個格數；不是照秒數比，交界的兩種寫法算不一樣）。有一個沒有就不是。 */
export function samePosition(p: TimePosition | null | undefined, q: TimePosition | null | undefined): boolean {
	return !!p && !!q && p.segmentId === q.segmentId && Math.abs(p.at - q.at) < EPS;
}

/** list 裡在同一個地方的，一對一對，照清單的先後；放不下的不算。 */
export function samePairs<T extends AnchoredRange>(flow: Flow, list: T[], edges: AnchorEdges): [T, T][] {
	const all = list.map((x) => ({ x, s: anchoredSeconds(flow, x, edges) }));
	return all.flatMap(({ x, s }, i) =>
		s ? all.slice(i + 1).flatMap((y): [T, T][] => (sameSeconds(y.s, s) ? [[x, y.x]] : [])) : []
	);
}

/**
 * 插入八拍：在 at 空出 length 格之後範圍在哪。end 是那一段原本的格數（段不變長）。
 * A 在插入點或之後的往後延；B 在插入點後面才延（剛好在插入點是在那之前結束），在段尾的留在段尾。
 * room：延了的那頭還能再晚幾格（A 要在段裡、B 可以剛好是段尾）；沒有延的是 null。
 */
export function afterInsert<T extends AnchoredRange>(
	range: T,
	at: TimePosition,
	length: number,
	end: number
): { range: T; room: number | null } {
	const here = (p: TimePosition) => p.segmentId === at.segmentId;
	const a = here(range.a) && range.a.at >= at.at;
	const b = !!range.b && here(range.b) && range.b.at > at.at && range.b.at < end;
	if (!a && !b) return { range, room: null };
	const rooms = [...(a ? [end - 1 - range.a.at] : []), ...(b ? [end - range.b!.at] : [])];
	return {
		range: {
			...range,
			a: a ? { ...range.a, at: range.a.at + length } : range.a,
			b: b ? { ...range.b!, at: range.b!.at + length } : range.b
		},
		room: Math.min(...rooms)
	};
}

/** 切段：segmentId 從第 cut 格切開，後面變成 newSegmentId。A 在切點以後的搬過去；B 剛好在切點的是前一段的段尾，留著。 */
export function afterSplit<T extends AnchoredRange>(range: T, segmentId: string, cut: number, newSegmentId: string): T {
	const moved = (p: TimePosition): TimePosition => ({ segmentId: newSegmentId, at: p.at - cut });
	const a = range.a.segmentId === segmentId && range.a.at >= cut ? moved(range.a) : range.a;
	const b = range.b && range.b.segmentId === segmentId && range.b.at > cut ? moved(range.b) : range.b;
	return { ...range, a, b };
}

/** 一頭的秒數：段要在、格子在段裡；A 在段尾、B 在段頭能不能寫照 edges。 */
function seconds(flow: Flow, p: TimePosition, edges: AnchorEdges, end: 'a' | 'b'): number | null {
	const segment = flow.segments.find((s) => s.id === p.segmentId);
	if (!segment) return null;
	if (edges.wholeUnits && !Number.isInteger(p.at)) return null;
	const last = units(segment);
	const min = edges.wholeUnits ? 0 : -Infinity;
	const fits =
		end === 'a'
			? p.at >= min && (edges.aAtSegmentEnd ? p.at <= last : p.at < last)
			: p.at <= last && (edges.bAtSegmentStart ? p.at >= min : p.at > 0);
	return fits ? toSeconds(flow, p) : null;
}

function sameSeconds(x: RangeSeconds | null, y: RangeSeconds): boolean {
	if (!x || Math.abs(x.a - y.a) > EPS) return false;
	return x.b === null || y.b === null ? x.b === y.b : Math.abs(x.b - y.b) <= EPS;
}
