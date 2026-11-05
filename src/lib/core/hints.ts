// 提醒（只提醒，不擋）：看起來可能排錯的地方。畫面用黃字寫出來，教練自己決定要不要改。

import type { Action } from './action-types';
import type { Position } from './formation';
import type { Member } from './members';
import type { Segment } from './segment';

/** 兩個人的位置差不到這麼多公尺，就當成疊在同一點（吸附最細是 1/8 格，約 0.23 公尺）。 */
const STACK_M = 0.05;

/** 撐人的大類：有上層就要有底層。 */
const LIFTING = new Set(['stunt', 'pyramid', 'toss']);
const BASE_ROLES = new Set(['底層', '主底', '側底']);

/** 名單裡重複的名字（去掉頭尾空白比），照第一次出現的順序。 */
export function duplicateNames(members: Member[]): string[] {
	const seen = new Set<string>();
	const dup = new Set<string>();
	for (const m of members) {
		const name = m.name.trim();
		if (seen.has(name)) dup.add(name);
		seen.add(name);
	}
	return [...dup];
}

/** 這一刻疊在同一點的人：每一組照名單順序，至少 2 個人。 */
export function stackedMembers(members: Member[], positions: Record<string, Position>): Member[][] {
	const groups: Member[][] = [];
	for (const m of members) {
		const p = positions[m.id];
		if (!p) continue;
		const group = groups.find((g) => {
			const q = positions[g[0].id];
			return Math.hypot(p[0] - q[0], p[1] - q[1]) < STACK_M;
		});
		if (group) group.push(m);
		else groups.push([m]);
	}
	return groups.filter((g) => g.length > 1);
}

/** 動作的人和任務角色看起來不對的地方：技巧、金字塔、拋投有上層卻沒有底層。 */
export function actionHints(action: Pick<Action, 'category' | 'members'>): string[] {
	const roles = action.members.map((m) => m.role);
	if (LIFTING.has(action.category) && roles.includes('上層') && !roles.some((r) => r && BASE_ROLES.has(r))) {
		return ['有上層，但沒有底層（底層、主底、側底）'];
	}
	return [];
}

/** 音樂段比音樂檔長幾秒（從第一拍算段的長度）；沒有比較長是 0。 */
export function musicOverrunSec(segment: Segment, audioDurationSec: number): number {
	if (segment.kind !== 'music') return 0;
	const end = segment.firstBeatSec + (segment.halfBeats * 30) / segment.bpm;
	const over = end - audioDurationSec;
	return over > 0.05 ? over : 0;
}
