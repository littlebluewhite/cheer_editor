// 書籤（GLOSSARY）：取了名字的 A，可以再帶一個 B。點了只有 A 的跳到 A；有 B 的把重複範圍換成 A 到 B。
// A、B 記成「哪一段的第幾格」，跟動作一樣跟著自己的段走。段的交界有兩種寫法：A 是開始，算後一段的開頭；
// B 是結尾，算前一段的結尾。這樣只在音樂 1 裡的書籤，不會因為音樂 2 刪掉、換順序而不見。
// 改段之後放不下的書籤（段不見了、格子跑到段外、B 跑到 A 前面）由 sweepBookmarks 拿掉（每個指令跑完都掃，commands.ts）。
// 段頭段尾、秒數、放不放得下、同一個地方、改段時怎麼搬：錨在段上的範圍（anchored-range.ts，BOOKMARK_EDGES）。

import {
	anchorAt,
	anchoredSeconds,
	BOOKMARK_EDGES,
	canonical,
	onGrid,
	pastEnd,
	REPEAT_EDGES,
	samePairs,
	samePlace,
	touches,
	type AnchoredRange,
	type RangeSeconds
} from './anchored-range';
import type { Action } from './action-types';
import { same as sameContent, type Flow } from './flow';
import { newId } from './ids';
import { blocked, ok, type CommandResult } from './result';
import { tooLong } from './text-length';
import { EPS, toSeconds, type TimePosition } from './time';
import { said, type Why } from './why';

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
	return canonical(flow, { a: anchorAt(flow, sec), b: null }).a;
}

/** 書籤現在在哪（全域秒數）；放不下（段不見了、格子在段外、B 不在 A 後面）是 null。 */
export function bookmarkSeconds(flow: Flow, bm: Pick<Bookmark, 'a' | 'b'>): RangeSeconds | null {
	return anchoredSeconds(flow, bm, BOOKMARK_EDGES);
}

/** 刪段時拿掉的書籤：A 或 B 在那段的。 */
export function bookmarksIn(flow: Flow, segmentId: string): Bookmark[] {
	return bookmarksOf(flow).filter((bm) => touches(bm, segmentId));
}

/** 段縮短成 end 格時拿掉的書籤：開始在新的段尾或之後、結尾在段尾之後的。 */
export function bookmarksPastEnd(flow: Flow, segmentId: string, end: number): Bookmark[] {
	return bookmarksOf(flow).filter((bm) => pastEnd(bm, segmentId, end, BOOKMARK_EDGES));
}

/** 在同一個地方（A、B 照秒數比）的書籤，一對一對，照清單的先後。 */
export function sameBookmarks(flow: Flow): [Bookmark, Bookmark][] {
	return samePairs(flow, bookmarksOf(flow), BOOKMARK_EDGES);
}

/** 跟重複範圍在同一個地方（A、B 照秒數比）的書籤：播放 module 問「哪個書籤正在播」用。範圍不完整（只有 A）就沒有。 */
export function bookmarkOfRange(flow: Flow, range: AnchoredRange): Bookmark | undefined {
	if (!range.b) return undefined;
	return samePlace(flow, bookmarksOf(flow), range, BOOKMARK_EDGES, REPEAT_EDGES);
}

/** 開始剛好在 a 的動作（照秒數比，交界兩種寫法都算）：存書籤時名字先填它的名字。 */
export function bookmarkAction(flow: Flow, a: TimePosition): Action | undefined {
	const sec = toSeconds(flow, a);
	return flow.actions.find((x) => Math.abs(toSeconds(flow, { segmentId: x.segmentId, at: x.start }) - sec) < EPS);
}

/**
 * 存一個書籤。名字頭尾空白去掉；A、B 照開始、結尾的寫法存。回新書籤的 id。
 * 同一個地方已經有書籤：擋下，多帶那個書籤的 id（bookmarkId，畫面拿來閃它）。
 */
export function addBookmark(
	flow: Flow,
	name: string,
	a: TimePosition,
	b: TimePosition | null
): CommandResult<{ bookmarkId: string }> {
	if (!onGrid(flow, a)) return blocked({ code: 'bookmarks_start_outside' });
	if (b && !onGrid(flow, b)) return blocked({ code: 'bookmarks_end_outside' });
	const bm = canonical(flow, { a, b });
	if (!bookmarkSeconds(flow, bm)) return blocked({ code: b ? 'bookmarks_b_before_a' : 'bookmarks_start_at_end' });
	const same = samePlace(flow, bookmarksOf(flow), bm, BOOKMARK_EDGES);
	// 位置重複先講：換名字也存不了（畫面上那顆書籤會閃）
	if (same) return { kind: 'blocked', ...said({ code: 'bookmarks_same_place', name: same.name }), bookmarkId: same.id };
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

/**
 * 換上流程時，改段連帶拿掉的書籤（GLOSSARY「書籤」：一定告訴教練拿掉了哪個），照 before 的先後。
 * 段的內容沒變就是空的：只刪書籤不算（刪書籤本身的提示已經寫了是哪個），段換了一份但內容一樣也不算。
 */
export function lostBookmarks(before: Flow, after: Flow): Bookmark[] {
	if (sameContent(before.segments, after.segments)) return [];
	const kept = new Set(bookmarksOf(after).map((b) => b.id));
	return bookmarksOf(before).filter((b) => !kept.has(b.id));
}

/** 書籤名字哪裡不行（已經去掉頭尾空白）；before：改之前的名字（開檔進來就超過上限的可以留著，不能更長）。 */
export function nameProblem(name: string, before?: string): Why | null {
	return name ? tooLong('bookmarkName', name, before) : NO_NAME;
}
