// 插入八拍：在一個段的某一拍空出幾拍（音樂段幾個半拍、口號段幾個 0.1 秒），
// 這個段裡在那之後的站位、動作（拍點記在動作裡，跟著走）、走位的出發和到達、書籤一起往後延；在那之前的不變
// （照預設走、在那之前就出發的人，把出發記成自己設的）。
// 段不變長：後面的東西超過段尾就擋下。兩個書籤被擠成同一個地方也擋下（同一個地方只有一個書籤）。

import { actionWhy } from './action-types';
import { afterInsert } from './anchored-range';
import { bookmarksOf, sameBookmarks } from './bookmarks';
import type { Flow } from './flow';
import { formationWalks, memberWalk, type Walk } from './formation';
import { blocked, ok, type CommandResult } from './result';
import type { Segment } from './segment';
import { eightsWhy, HALF_BEATS_PER_EIGHT, lengthWhy, units, type TimePosition } from './time';
import type { Why } from './why';

/**
 * 在 at 插入 length 格：這一段裡從 at 起（含 at）開始的站位、動作、出發、到達都晚 length 格。
 * 在 at 以前開始、跨過 at 的動作不動；開頭那張站位不動。
 * 擋下：length 不是正整數、at 不在段的格子上、有東西會超過段尾（說卡最緊的那個和最多插多少）、兩個書籤會變成同一個地方。
 * unit 是教練選的單位，只用來寫「最多插多少」。
 */
export function insertBeats(flow: Flow, at: TimePosition, length: number, unit: 'eight' | 'beat' = 'beat'): CommandResult {
	const segment = flow.segments.find((s) => s.id === at.segmentId);
	if (!segment) return blocked({ code: 'insert_beats_no_segment' });
	if (!Number.isInteger(length) || length < 1) return blocked({ code: 'insert_beats_length' });
	const end = units(segment);
	if (!Number.isInteger(at.at) || at.at < 0 || at.at >= end) return blocked({ code: 'insert_beats_outside' });

	const moves = (p: TimePosition) => p.segmentId === at.segmentId && p.at >= at.at;
	const later = (p: TimePosition): TimePosition => (moves(p) ? { ...p, at: p.at + length } : p);
	// 卡最緊的那個：往後延之後還能再晚幾格（站位、出發和到達要在段裡，動作的結尾可以剛好是段尾）。
	// who：放不下時的原因，還沒填最多插多少（room）
	const rooms: { who: Why; room: number }[] = [];
	const fits = (who: Why, room: number) => rooms.push({ who, room });

	const formations = flow.formations.map((f, i) => {
		const who: Why = { code: 'insert_beats_overflow_formation', n: i + 1 };
		const moved = i > 0 && f.segmentId === at.segmentId && f.at >= at.at;
		// 沒自己設的人照預設走：這張往後延、出發卻在插入點以前，就把原本的出發記下來，插入點以前站的地方才不會變
		const kept = moved
			? formationWalks(flow, f.id).flatMap(({ memberId }): [string, Walk][] => {
					const w = memberWalk(flow, f.id, memberId);
					return !f.walks?.[memberId] && w && !moves(w.depart) ? [[memberId, w]] : [];
				})
			: [];
		const stored = kept.length ? { ...Object.fromEntries(kept), ...f.walks } : f.walks;
		const walks = stored && Object.fromEntries(
			Object.entries(stored).map(([id, w]): [string, Walk] => {
				for (const p of [w.depart, w.arrive]) if (moves(p)) fits(who, end - 1 - p.at);
				return [id, { depart: later(w.depart), arrive: later(w.arrive) }];
			})
		);
		if (moved) fits(who, end - 1 - f.at);
		return { ...f, ...(moved && { at: f.at + length }), ...(walks && { walks }) };
	});
	const actions = flow.actions.map((a) => {
		if (a.segmentId !== at.segmentId || a.start < at.at) return a;
		fits({ code: 'insert_beats_overflow_action', action: actionWhy(a) }, end - a.start - a.length);
		return { ...a, start: a.start + length };
	});

	// 書籤：開始在插入點以後的往後延；結尾要在插入點後面才延（剛好在插入點就是在那之前結束），在段尾的留在段尾
	const bookmarks = bookmarksOf(flow).map((bm) => {
		const { range, room } = afterInsert(bm, at, length, end);
		if (room !== null) fits({ code: 'insert_beats_overflow_bookmark', name: bm.name }, room);
		return range;
	});

	const limit = rooms.reduce<(typeof rooms)[number] | null>((t, r) => (!t || r.room < t.room ? r : t), null);
	if (limit && limit.room < length) {
		return blocked({ ...limit.who, room: roomWhy(segment, limit.room, unit) });
	}
	const done = { ...flow, formations, actions, ...(flow.bookmarks && { bookmarks }) };
	const had = new Set(sameBookmarks(flow).map(([x, y]) => `${x.id}:${y.id}`));
	const same = sameBookmarks(done).find(([x, y]) => !had.has(`${x.id}:${y.id}`));
	if (same) return blocked({ code: 'insert_beats_same_bookmark', first: same[0].name, second: same[1].name });
	return ok(done);
}

/** 被擋時說還能插多少：教練選八拍（音樂段）就照八拍講，不到 1 個八拍才說幾拍。 */
function roomWhy(segment: Segment, room: number, unit: 'eight' | 'beat'): Why {
	if (room <= 0) return { code: 'insert_beats_room_none' };
	if (segment.kind !== 'music' || unit !== 'eight') return { code: 'insert_beats_room', length: lengthWhy(segment, room) };
	const eights = Math.floor(room / HALF_BEATS_PER_EIGHT);
	if (eights === 0) return { code: 'insert_beats_room_under_eight', length: lengthWhy(segment, room) };
	const rest = room - eights * HALF_BEATS_PER_EIGHT;
	return rest
		? { code: 'insert_beats_room_eights_rest', eights: eightsWhy(eights), rest: lengthWhy(segment, rest) }
		: { code: 'insert_beats_room', length: eightsWhy(eights) };
}

