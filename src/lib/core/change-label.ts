// 這一步改了什麼：比對改之前和改之後的流程，寫成一句短的（例：「插入站位 3」）。
// 復原、重做的提示用它：「已復原：插入站位 3」。一步改到好幾樣時，寫最主要的那樣
// （刪隊員會連帶改動作、站位，寫「刪隊員」）。

import { actionWhy } from './action-types';
import type { Flow } from './flow';
import type { Segment } from './segment';
import type { Why } from './why';

interface Item {
	id: string;
}

/** 兩串（照 id）的差別：多了哪些、少了哪些、哪一個換了內容、順序有沒有變。 */
function diff<T extends Item>(before: T[], after: T[]) {
	const had = new Set(before.map((x) => x.id));
	const has = new Set(after.map((x) => x.id));
	const added = after.filter((x) => !had.has(x.id));
	const removed = before.filter((x) => !has.has(x.id));
	const changed = after.find((x) => had.has(x.id) && !before.includes(x));
	const kept = (xs: T[], ids: Set<string>) => xs.filter((x) => ids.has(x.id)).map((x) => x.id);
	const reordered = kept(before, has).join() !== kept(after, had).join();
	return { added, removed, changed, reordered };
}

/** 改了第 n 段的哪一樣（音樂、BPM、第一拍、八拍數、秒數），好幾樣一起改寫最前面那樣（N62）。 */
function segmentLabel(was: Segment, now: Segment, n: number): Why {
	if (was.kind === 'music' && now.kind === 'music') {
		if (was.audioId !== now.audioId) {
			if (was.audioId === null) return { code: 'change_label_load_audio', n };
			return { code: now.audioId === null ? 'change_label_remove_audio' : 'change_label_replace_audio', n };
		}
		if (was.bpm !== now.bpm) return { code: 'change_label_bpm', n };
		if (was.firstBeatSec !== now.firstBeatSec) return { code: 'change_label_first_beat', n };
		if (was.halfBeats !== now.halfBeats) return { code: 'change_label_eights', n };
	}
	if (was.kind === 'chant' && now.kind === 'chant' && was.tenths !== now.tenths) return { code: 'change_label_seconds', n };
	return { code: 'change_label_segment', n };
}

/** 這一步改了什麼（代號，畫面照語言寫）；看不出來（例：只換了內部的東西）就是「修改」。 */
export function changeLabel(before: Flow, after: Flow): Why {
	if (before.members !== after.members) {
		const d = diff(before.members, after.members);
		if (d.added.length === 1) return { code: 'change_label_add_member', name: d.added[0].name };
		if (d.added.length) return { code: 'change_label_add_members', count: d.added.length };
		if (d.removed.length === 1) return { code: 'change_label_delete_member', name: d.removed[0].name };
		if (d.removed.length) return { code: 'change_label_delete_members', count: d.removed.length };
		if (d.reordered) return { code: 'change_label_order_members' };
		if (d.changed) return { code: 'change_label_change_member', name: d.changed.name };
	}
	if (before.segments !== after.segments) {
		const d = diff(before.segments, after.segments);
		if (d.added.length) {
			const at = after.segments.indexOf(d.added[0]);
			// 切成兩段：新的一段接在剛變短的那一段後面
			if (d.added.length === 1 && at > 0 && after.segments[at - 1] === d.changed) return { code: 'change_label_split_segment', n: at };
			return { code: 'change_label_add_segment', n: at + 1 };
		}
		if (d.removed.length) return { code: 'change_label_delete_segment', n: before.segments.indexOf(d.removed[0]) + 1 };
		if (d.reordered) return { code: 'change_label_order_segments' };
		if (d.changed) return segmentLabel(before.segments.find((s) => s.id === d.changed!.id)!, d.changed, after.segments.indexOf(d.changed) + 1);
	}
	if (before.customRoles !== after.customRoles) {
		const d = diff(before.customRoles, after.customRoles);
		if (d.added.length) return { code: 'change_label_add_role', name: d.added[0].name };
		if (d.removed.length) return { code: 'change_label_delete_role', name: d.removed[0].name };
		if (d.changed) return { code: 'change_label_change_role', name: d.changed.name };
	}
	if (before.field !== after.field) return { code: 'change_label_field' };
	if (before.formations !== after.formations) {
		const d = diff(before.formations, after.formations);
		if (d.added.length) return { code: 'change_label_insert_formation', n: after.formations.indexOf(d.added[0]) + 1 };
		if (d.removed.length) return { code: 'change_label_delete_formation', n: before.formations.indexOf(d.removed[0]) + 1 };
		if (d.changed) return { code: 'change_label_change_formation', n: after.formations.indexOf(d.changed) + 1 };
	}
	if (before.actions !== after.actions) {
		const d = diff(before.actions, after.actions);
		if (d.added.length) return { code: 'change_label_add_action', action: actionWhy(d.added[0]) };
		if (d.removed.length) return { code: 'change_label_delete_action', action: actionWhy(d.removed[0]) };
		if (d.changed) return { code: 'change_label_change_action', action: actionWhy(d.changed) };
	}
	if (before.name !== after.name) return { code: 'change_label_flow_name' };
	if (before.timeRules !== after.timeRules) return { code: 'change_label_time_rules' };
	if (before.markers !== after.markers) return { code: 'change_label_markers' };
	return { code: 'change_label_other' };
}
