// 書籤（GLOSSARY）：取了名字的 A，可以再帶一個 B。點了只有 A 的跳到 A；有 B 的把重複範圍換成 A 到 B。
// A、B 記成「哪一段的第幾格」，跟動作一樣跟著自己的段走。段的交界有兩種寫法：A 是開始，算後一段的開頭；
// B 是結尾，算前一段的結尾。這樣只在音樂 1 裡的書籤，不會因為音樂 2 刪掉、換順序而不見。
// 改段之後放不下的書籤（段不見了、格子跑到段外、B 跑到 A 前面）由 sweepBookmarks 拿掉（每個指令跑完都掃，commands.ts）。

import type { Flow } from './flow';
import { newId } from './ids';
import { rangeEnd } from './playback';
import { blocked, ok, type CommandResult } from './result';
import { tooLong } from './text-length';
import { EPS, toSeconds, units, type TimePosition } from './time';
import type { Why } from './why';

export interface Bookmark {
	id: string;
	name: string;
	/** 開始：段內的格子在段裡（不在段尾）。 */
	a: TimePosition;
	/** 結尾；只有 A 的書籤是 null。 */
	b: TimePosition | null;
}

const NO_NAME: Why = { code: 'bookmarks_no_name' };
const NOT_FOUND: Why = { code: 'bookmarks_not_found' };

/** 流程的書籤（舊流程沒有這個欄位）。 */
export function bookmarksOf(flow: Flow): Bookmark[] {
	return flow.bookmarks ?? [];
}

/** sec 最近的整拍當開始：段的交界算後一段的開頭。要先有段。 */
export function startAt(flow: Flow, sec: number): TimePosition {
	return asStart(flow, rangeEnd(flow, sec));
}

/** 書籤現在在哪（全域秒數）；放不下（段不見了、格子在段外、B 不在 A 後面）是 null。 */
export function bookmarkSeconds(flow: Flow, bm: Pick<Bookmark, 'a' | 'b'>): { a: number; b: number | null } | null {
	const a = sec(flow, bm.a, 'start');
	if (a === null) return null;
	if (!bm.b) return { a, b: null };
	const b = sec(flow, bm.b, 'end');
	return b === null || b <= a + EPS ? null : { a, b };
}

/** 在同一個地方（A、B 照秒數比）的書籤，一對一對，照清單的先後。 */
export function sameBookmarks(flow: Flow): [Bookmark, Bookmark][] {
	const list = bookmarksOf(flow).map((bm) => ({ bm, s: bookmarkSeconds(flow, bm) }));
	return list.flatMap(({ bm, s }, i) =>
		s ? list.slice(i + 1).flatMap((y): [Bookmark, Bookmark][] => (sameSeconds(y.s, s) ? [[bm, y.bm]] : [])) : []
	);
}

/** A 或 B 在這一段的書籤。 */
export function bookmarksIn(flow: Flow, segmentId: string): Bookmark[] {
	return bookmarksOf(flow).filter((bm) => bm.a.segmentId === segmentId || bm.b?.segmentId === segmentId);
}

/** 存一個書籤。名字頭尾空白去掉；A、B 照開始、結尾的寫法存。回新書籤的 id。 */
export function addBookmark(
	flow: Flow,
	name: string,
	a: TimePosition,
	b: TimePosition | null
): CommandResult<{ bookmarkId: string }> {
	if (!inSegment(flow, a)) return blocked({ code: 'bookmarks_start_outside' });
	if (b && !inSegment(flow, b)) return blocked({ code: 'bookmarks_end_outside' });
	const bm = { a: asStart(flow, a), b: b && asEnd(flow, b) };
	const s = bookmarkSeconds(flow, bm);
	if (!s) return blocked({ code: b ? 'bookmarks_b_before_a' : 'bookmarks_start_at_end' });
	const same = bookmarksOf(flow).find((x) => sameSeconds(bookmarkSeconds(flow, x), s));
	// 位置重複先講：換名字也存不了（畫面上那顆書籤會閃）
	if (same) return blocked({ code: 'bookmarks_same_place', name: same.name });
	const trimmed = name.trim();
	const problem = nameProblem(trimmed);
	if (problem) return blocked(problem);
	const id = newId('k', bookmarksOf(flow).map((x) => x.id));
	return ok({ ...flow, bookmarks: [...bookmarksOf(flow), { id, name: trimmed, ...bm }] }, { bookmarkId: id });
}

/** 改書籤的名字。 */
export function renameBookmark(flow: Flow, bookmarkId: string, name: string): CommandResult {
	const list = bookmarksOf(flow);
	const before = list.find((x) => x.id === bookmarkId);
	if (!before) return blocked(NOT_FOUND);
	const trimmed = name.trim();
	const problem = nameProblem(trimmed, before.name);
	if (problem) return blocked(problem);
	return ok({ ...flow, bookmarks: list.map((x) => (x === before ? { ...x, name: trimmed } : x)) });
}

/** 刪一個書籤。 */
export function deleteBookmark(flow: Flow, bookmarkId: string): CommandResult {
	const list = bookmarksOf(flow);
	if (!list.some((x) => x.id === bookmarkId)) return blocked(NOT_FOUND);
	return ok({ ...flow, bookmarks: list.filter((x) => x.id !== bookmarkId) });
}

/** 拿掉放不下的書籤；都放得下就回同一份流程。 */
export function sweepBookmarks(flow: Flow): Flow {
	const list = bookmarksOf(flow);
	const kept = list.filter((bm) => bookmarkSeconds(flow, bm) !== null);
	return kept.length === list.length ? flow : { ...flow, bookmarks: kept };
}

/** 書籤名字哪裡不行（已經去掉頭尾空白）；before：改之前的名字（開檔進來就超過上限的可以留著，不能更長）。 */
export function nameProblem(name: string, before?: string): Why | null {
	return name ? tooLong('bookmarkName', name, before) : NO_NAME;
}

/** 段在、格子在段裡（含段尾）。 */
function inSegment(flow: Flow, p: TimePosition): boolean {
	const segment = flow.segments.find((s) => s.id === p.segmentId);
	return !!segment && Number.isInteger(p.at) && p.at >= 0 && p.at <= units(segment);
}

/** 開始的秒數：段要在，格子在段裡、不在段尾（段尾是下一段的開頭）。結尾：格子不在段的開頭（那是上一段的結尾），可以是段尾。 */
function sec(flow: Flow, p: TimePosition, as: 'start' | 'end'): number | null {
	const segment = flow.segments.find((s) => s.id === p.segmentId);
	if (!segment || !Number.isInteger(p.at)) return null;
	const end = units(segment);
	const fits = as === 'start' ? p.at >= 0 && p.at < end : p.at > 0 && p.at <= end;
	return fits ? toSeconds(flow, p) : null;
}

/** 段尾當開始：換成下一段的開頭（沒有下一段就照舊）。 */
function asStart(flow: Flow, p: TimePosition): TimePosition {
	const i = flow.segments.findIndex((s) => s.id === p.segmentId);
	const next = flow.segments[i + 1];
	return i !== -1 && next && p.at === units(flow.segments[i]) ? { segmentId: next.id, at: 0 } : p;
}

/** 段的開頭當結尾：換成上一段的段尾（第一段就照舊）。 */
function asEnd(flow: Flow, p: TimePosition): TimePosition {
	const i = flow.segments.findIndex((s) => s.id === p.segmentId);
	const prev = flow.segments[i - 1];
	return i > 0 && p.at === 0 ? { segmentId: prev.id, at: units(prev) } : p;
}

function sameSeconds(x: { a: number; b: number | null } | null, y: { a: number; b: number | null }): boolean {
	if (!x || Math.abs(x.a - y.a) > EPS) return false;
	return x.b === null || y.b === null ? x.b === y.b : Math.abs(x.b - y.b) <= EPS;
}
