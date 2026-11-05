// 撞位：兩個隊員同一時間靠得太近，而且至少一個人正在騰翻中走位。只是提醒，不擋任何指令。

import { actionSeconds } from './action-types';
import { CELL_M } from './field';
import type { Flow } from './flow';
import { formationTimes, formationWalks, walkPoint, type FormationWalk, type Position } from './formation';
import { EPS, segmentSpans, unitSec, units } from './time';

/** 一次撞位：連續好幾個取樣點都撞到只算一次。 */
export interface Clash {
	/** 兩個人，照名單順序。 */
	memberIds: [string, string];
	/** 兩個人最近的那一刻（全域秒數）。 */
	sec: number;
	/** 那一刻兩個人中間的位置（公尺）。 */
	pos: Position;
	/** 撞到的第一個和最後一個取樣點（全域秒數）。 */
	startSec: number;
	endSec: number;
	/** 撞位在走到哪一張站位的那段走位裡（B）。 */
	formationId: string;
}

/** 中心距離不到這麼多公尺就算靠太近：半格。 */
const TOO_CLOSE_M = CELL_M / 2;

/**
 * 整個流程的撞位，照時間排。取樣：音樂段每半拍、口號段每 0.1 秒（段內時間的每一格）。
 * 每個取樣點，兩人中心距離小於半格、至少一人在騰翻中走位，就算撞到。
 * 騰翻中走位：在他自己參加的騰翻動作時間裡（含開始、不含結束；助跑也在裡面），而且在出發之後、到達之前。
 * 一般走位、原地騰翻（位置沒變）不算；只拿騰翻中走位的人跟其他人比。
 */
export function clashes(flow: Flow): Clash[] {
	const tumbling = flow.actions
		.filter((x) => x.category === 'tumbling')
		.map((x) => ({ ...actionSeconds(flow, x), ids: new Set(x.members.map((m) => m.memberId)) }));
	if (!tumbling.length) return [];
	const times = formationTimes(flow);
	/** 每段走位（A→B）：B 的 id、B 的秒數、這段裡位置有變的人。 */
	const legs = times.slice(1).map(({ formation, sec }, i) => ({
		formationId: formation.id,
		aPos: times[i].formation.pos,
		endSec: sec,
		walks: formationWalks(flow, formation.id)
	}));
	const ids = flow.members.map((m) => m.id);
	const out: Clash[] = [];
	/** 正在撞的兩人（"i,j"）→ 這次撞位（還在接續）。 */
	let open = new Map<string, Clash & { dist: number }>();
	for (const span of segmentSpans(flow)) {
		const step = unitSec(span.segment);
		for (let k = 0; k < units(span.segment); k++) {
			const t = span.startSec + k * step;
			const leg = legs.find((l) => l.endSec > t + EPS);
			const next = new Map<string, Clash & { dist: number }>();
			if (leg) {
				const byId = new Map<string, FormationWalk>(leg.walks.map((w) => [w.memberId, w]));
				const at = (id: string): Position | undefined => {
					const w = byId.get(id);
					return w ? walkPoint(w.from, w.to, w.departSec, w.arriveSec, t) : leg.aPos[id];
				};
				/** 這個取樣點騰翻中走位的人（在 ids 裡的位置）。 */
				const tumblers: number[] = [];
				ids.forEach((id, i) => {
					const w = byId.get(id);
					if (!w || !(w.departSec < t - EPS && t < w.arriveSec - EPS)) return;
					if (tumbling.some((x) => x.ids.has(id) && x.startSec <= t + EPS && t < x.endSec - EPS)) tumblers.push(i);
				});
				const isTumbler = new Set(tumblers);
				for (const a of tumblers) {
					for (let b = 0; b < ids.length; b++) {
						// 兩個都騰翻中的那一對只從前面那個人算一次。
						if (b === a || (isTumbler.has(b) && b < a)) continue;
						const [i, j] = a < b ? [a, b] : [b, a];
						const p = at(ids[i]);
						const q = at(ids[j]);
						if (!p || !q) continue;
						const dist = Math.hypot(p[0] - q[0], p[1] - q[1]);
						if (dist >= TOO_CLOSE_M) continue;
						const key = `${i},${j}`;
						const mid: Position = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
						const prev = open.get(key);
						const c = prev ?? {
							memberIds: [ids[i], ids[j]] as [string, string],
							sec: t,
							pos: mid,
							startSec: t,
							endSec: t,
							formationId: leg.formationId,
							dist
						};
						c.endSec = t;
						if (dist < c.dist - EPS) Object.assign(c, { sec: t, pos: mid, dist });
						next.set(key, c);
					}
				}
			}
			for (const [key, c] of open) if (!next.has(key)) out.push(strip(c));
			open = next;
		}
	}
	for (const c of open.values()) out.push(strip(c));
	return out.sort((a, b) => a.sec - b.sec);
}

function strip({ dist: _, ...c }: Clash & { dist: number }): Clash {
	return c;
}
