// 刪段、調段順序（docs/adr/0003-v1-small-decisions.md）、從播放頭切段。
// 動作、站位記「哪個段 ＋ 段內時間」，所以跟著自己的段走。開頭那張站位永遠在流程開頭，「跟著第一段」：
// 第一段換了，新的第一段開頭本來就有站位就用那張（原本的開頭那張：段還在就變成一般站位，段刪掉了就跟著刪）；
// 沒有的話開頭那張自己搬過去：換順序時整張搬，刪段時位置換成那一刻大家所在的地方。站位不會變多。

import { actionWhy } from './action-types';
import { afterSplit } from './anchored-range';
import { bookmarkSeconds, bookmarksOf } from './bookmarks';
import type { Flow } from './flow';
import { positionsAt, withWalks, type Formation } from './formation';
import { newId } from './ids';
import { RECORDS_UNDOABLE_WHY, answered, blocked, needsConfirm, ok, type CommandResult, type ConfirmOption } from './result';
import type { Segment } from './segment';
import { recordCount } from './success-rate';
import { EPS, HALF_BEATS_PER_EIGHT, atWhy, fromWhy, labelWhy, segmentSpans, toPosition, totalSeconds } from './time';
import type { Why } from './why';

/** 刪段：段裡的動作、站位，A 或 B 在這段的書籤一起刪。會刪到東西時先問（列出清單）；空的段直接刪。 */
export function deleteSegment(flow: Flow, segmentId: string, option: ConfirmOption = {}): CommandResult {
	const index = flow.segments.findIndex((s) => s.id === segmentId);
	if (index === -1) return blocked({ code: 'segment_order_no_segment' });
	const segment = flow.segments[index];
	const droppedActions = flow.actions.filter((a) => a.segmentId === segmentId);
	// 開頭那張跟著新的第一段（刪掉唯一的段時回到沒有段），不算刪掉；
	// 只有新的第一段開頭本來就有站位、那張接手當開頭時，原本的開頭那張才真的刪掉。
	const next = flow.segments[1]?.id;
	const takenOver = flow.formations.some((f) => f.segmentId === next && f.at === 0);
	const droppedFormations = flow.formations.filter(
		(f, i) => f.segmentId === segmentId && !(i === 0 && !takenOver)
	);
	// 書籤：段拿掉之後放不下的（A 或 B 在這段）
	const segments = flow.segments.toSpliced(index, 1);
	const droppedBookmarks = bookmarksOf(flow).filter((b) => !bookmarkSeconds({ ...flow, segments }, b));
	if (!answered(option) && (droppedActions.length || droppedFormations.length || droppedBookmarks.length)) {
		const records = recordCount(droppedActions);
		const label = labelWhy(segmentSpans(flow)[index]);
		const code = records === 1 ? 'segment_order_delete_records_one' : 'segment_order_delete_records';
		const why: Why = records
			? { code, segment: label, count: records, undoable: RECORDS_UNDOABLE_WHY }
			: { code: 'segment_order_delete', segment: label };
		return needsConfirm(why, [
			...droppedActions.map((a): Why => ({ code: 'segment_order_item_action', action: actionWhy(a), from: fromWhy(segment, a.start) })),
			...droppedFormations.map((f): Why => ({ code: 'segment_order_item_formation', n: flow.formations.indexOf(f) + 1, at: atWhy(segment, f.at) })),
			...droppedBookmarks.map((b): Why => ({ code: 'segment_order_item_bookmark', name: b.name }))
		]);
	}
	const actions = flow.actions.filter((a) => a.segmentId !== segmentId);
	const used = new Set(segments.map((s) => (s.kind === 'music' ? s.audioId : null)));
	const audio = flow.audio.filter((a) => used.has(a.id));
	const bookmarks = flow.bookmarks && bookmarksOf(flow).filter((b) => !droppedBookmarks.includes(b));
	return ok({ ...flow, segments, actions, audio, formations: reorder(flow, segments), ...(bookmarks && { bookmarks }) });
}

/** 調段順序：往前（-1）或往後（1）跟旁邊那段換位置。 */
export function moveSegment(flow: Flow, segmentId: string, dir: -1 | 1): CommandResult {
	const index = flow.segments.findIndex((s) => s.id === segmentId);
	if (index === -1) return blocked({ code: 'segment_order_no_segment' });
	const to = index + dir;
	if (to < 0) return blocked({ code: 'segment_order_first' });
	if (to >= flow.segments.length) return blocked({ code: 'segment_order_last' });
	const segments = flow.segments.with(index, flow.segments[to]).with(to, flow.segments[index]);
	return ok({ ...flow, segments, formations: reorder(flow, segments) });
}

/**
 * 從播放頭（全域秒數）這個八拍把音樂段切成兩段：切點吸到那個八拍的開頭，新段插在後面，
 * 沿用音樂檔和 BPM，第一拍接在切點。切點以後的動作、站位、走位搬到新段，時間不變。
 * 有動作跨過切點就擋下（說是哪個）。
 */
export function splitSegment(flow: Flow, segmentId: string, sec: number): CommandResult {
	const index = flow.segments.findIndex((s) => s.id === segmentId);
	if (index === -1) return blocked({ code: 'segment_order_no_segment' });
	const old = flow.segments[index];
	if (old.kind !== 'music') return blocked({ code: 'segment_order_chant' });
	const pos = toPosition(flow, sec);
	if (pos?.segmentId !== segmentId || sec >= totalSeconds(flow) - EPS) return blocked({ code: 'segment_order_playhead_outside' });
	const cut = Math.floor(pos.at / HALF_BEATS_PER_EIGHT) * HALF_BEATS_PER_EIGHT;
	if (cut === 0) return blocked({ code: 'segment_order_first_eight' });
	const across = flow.actions.find((a) => a.segmentId === segmentId && a.start < cut && a.start + a.length > cut);
	if (across) {
		return blocked({ code: 'segment_order_across', action: actionWhy(across), start: atWhy(old, across.start), cut: atWhy(old, cut) });
	}
	const id = newId('s', flow.segments.map((s) => s.id));
	const firstBeatSec = old.firstBeatSec + (cut * 30) / old.bpm;
	const after: Segment = { ...old, id, firstBeatSec, halfBeats: old.halfBeats - cut };
	const segments = flow.segments.with(index, { ...old, halfBeats: cut }).toSpliced(index + 1, 0, after);
	/** 切點以後的時間點換到新段。 */
	const moved = <T extends { segmentId: string | null; at: number }>(p: T): T =>
		p.segmentId === segmentId && p.at >= cut ? { ...p, segmentId: id, at: p.at - cut } : p;
	const formations = flow.formations.map((f) => {
		const g = moved(f);
		if (!g.walks) return g;
		const walks = Object.fromEntries(
			Object.entries(g.walks).map(([m, w]) => [m, { depart: moved(w.depart), arrive: moved(w.arrive) }])
		);
		return withWalks(g, walks);
	});
	const actions = flow.actions.map((a) =>
		a.segmentId === segmentId && a.start >= cut ? { ...a, segmentId: id, start: a.start - cut } : a
	);
	// 書籤：開始在切點以後的搬過去；結尾剛好在切點的是前一段的段尾，留著
	const bookmarks = flow.bookmarks?.map((bm) => afterSplit(bm, segmentId, cut, id));
	return ok({ ...flow, segments, formations, actions, ...(bookmarks && { bookmarks }) });
}

/**
 * 段換成 segments（刪了或換了順序）之後的站位：刪掉的段裡的站位拿掉、指到刪掉的段的走位設定拿掉，
 * 照新的段順序排，開頭那張跟著新的第一段。
 */
function reorder(flow: Flow, segments: Segment[]): Formation[] {
	const alive = new Set(segments.map((s) => s.id));
	const [oldOpening, ...rest] = flow.formations;
	const first = segments[0]?.id ?? null;
	if (first === null) return [{ ...withWalks(oldOpening, {}), segmentId: null, at: 0 }];

	// 開頭以外、段還在的站位；原本的開頭那張段還在、又不是新的第一段，就變成一般站位。
	let kept = rest.filter((f) => alive.has(f.segmentId!));
	let opening: Formation;
	if (oldOpening.segmentId === first) {
		opening = oldOpening;
	} else {
		const takeover = kept.find((f) => f.segmentId === first && f.at === 0);
		if (takeover) {
			kept = kept.filter((f) => f !== takeover);
			opening = withWalks(takeover, {});
			if (alive.has(oldOpening.segmentId!)) kept.push(oldOpening);
		} else if (alive.has(oldOpening.segmentId!)) {
			// 換順序：開頭那張整張搬到新的第一段開頭，不多做一張。
			opening = { ...withWalks(oldOpening, {}), segmentId: first, at: 0 };
		} else {
			// 刪段：開頭那張留著，位置換成新的第一段開始那一刻大家所在的地方。
			const startSec = segmentSpans(flow).find((s) => s.segment.id === first)!.startSec;
			opening = { ...withWalks(oldOpening, {}), segmentId: first, at: 0, pos: positionsAt(flow, startSec) };
		}
	}

	const order = new Map(segments.map((s, i) => [s.id, i]));
	kept.sort((a, b) => order.get(a.segmentId!)! - order.get(b.segmentId!)! || a.at - b.at);
	return [opening, ...kept].map((f) => {
		if (!f.walks) return f;
		const walks = Object.fromEntries(
			Object.entries(f.walks).filter(([, w]) => alive.has(w.depart.segmentId) && alive.has(w.arrive.segmentId))
		);
		return withWalks(f, walks);
	});
}
