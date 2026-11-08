// 這一步改了什麼：比對改之前和改之後的流程，寫成一句短的（例：「插入站位 3」）。
// 復原、重做的提示用它：「已復原：插入站位 3」。一步改到好幾樣時，寫最主要的那樣
// （刪隊員會連帶改動作、站位，寫「刪隊員」）。

import { actionLabel } from './action-types';
import type { Flow } from './flow';
import type { Segment } from './segment';

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
function segmentLabel(was: Segment, now: Segment, n: number): string {
	const which = `第 ${n} 段`;
	if (was.kind === 'music' && now.kind === 'music') {
		if (was.audioId !== now.audioId) {
			if (was.audioId === null) return `載入${which}的音樂`;
			return now.audioId === null ? `拿掉${which}的音樂` : `換${which}的音樂`;
		}
		if (was.bpm !== now.bpm) return `改${which}的 BPM`;
		if (was.firstBeatSec !== now.firstBeatSec) return `改${which}的第一拍`;
		if (was.halfBeats !== now.halfBeats) return `改${which}的八拍數`;
	}
	if (was.kind === 'chant' && now.kind === 'chant' && was.tenths !== now.tenths) return `改${which}的秒數`;
	return `改${which}`;
}

/** 這一步改了什麼；看不出來（例：只換了內部的東西）就是「修改」。 */
export function changeLabel(before: Flow, after: Flow): string {
	if (before.members !== after.members) {
		const d = diff(before.members, after.members);
		if (d.added.length) return d.added.length === 1 ? `加隊員 ${d.added[0].name}` : `加 ${d.added.length} 位隊員`;
		if (d.removed.length) return d.removed.length === 1 ? `刪隊員 ${d.removed[0].name}` : `刪 ${d.removed.length} 位隊員`;
		if (d.reordered) return '排隊員順序';
		if (d.changed) return `改隊員 ${d.changed.name}`;
	}
	if (before.segments !== after.segments) {
		const d = diff(before.segments, after.segments);
		if (d.added.length) {
			const at = after.segments.indexOf(d.added[0]);
			// 切成兩段：新的一段接在剛變短的那一段後面
			if (d.added.length === 1 && at > 0 && after.segments[at - 1] === d.changed) return `把第 ${at} 段切成兩段`;
			return `加第 ${at + 1} 段`;
		}
		if (d.removed.length) return `刪第 ${before.segments.indexOf(d.removed[0]) + 1} 段`;
		if (d.reordered) return '排段的順序';
		if (d.changed) return segmentLabel(before.segments.find((s) => s.id === d.changed!.id)!, d.changed, after.segments.indexOf(d.changed) + 1);
	}
	if (before.customRoles !== after.customRoles) {
		const d = diff(before.customRoles, after.customRoles);
		if (d.added.length) return `加任務角色「${d.added[0].name}」`;
		if (d.removed.length) return `刪任務角色「${d.removed[0].name}」`;
		if (d.changed) return `改任務角色「${d.changed.name}」`;
	}
	if (before.field !== after.field) return '調整場地';
	if (before.formations !== after.formations) {
		const d = diff(before.formations, after.formations);
		if (d.added.length) return `插入站位 ${after.formations.indexOf(d.added[0]) + 1}`;
		if (d.removed.length) return `刪站位 ${before.formations.indexOf(d.removed[0]) + 1}`;
		if (d.changed) return `改站位 ${after.formations.indexOf(d.changed) + 1}`;
	}
	if (before.actions !== after.actions) {
		const d = diff(before.actions, after.actions);
		if (d.added.length) return `新增動作 ${actionLabel(d.added[0])}`;
		if (d.removed.length) return `刪動作 ${actionLabel(d.removed[0])}`;
		if (d.changed) return `改動作 ${actionLabel(d.changed)}`;
	}
	if (before.name !== after.name) return '改流程名字';
	if (before.timeRules !== after.timeRules) return '改時間規則';
	if (before.markers !== after.markers) return '改標記方式';
	return '修改';
}
