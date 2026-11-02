// 站位：全隊在某一刻的位置。每張都包含全隊每一個人。
// 站位記「哪個段 ＋ 段內時間」（音樂段第幾個半拍、口號段第幾個 0.1 秒），flow.formations 照時間排。
// 開頭那張（formations[0]）一定在第一段的時間 0；還沒有段時 segmentId 是 null。

import { fieldGeometry } from './field';
import type { Flow } from './flow';
import { blocked, ok, type CommandResult } from './result';
import { nextId } from './ids';
import {
	EPS,
	HALF_BEATS_PER_EIGHT,
	atText,
	toPosition,
	toSeconds,
	unitSec,
	type TimePosition
} from './time';

/** 公尺座標 [x, y]，方向見 docs/flow-file-format.md 的「位置座標」。存真正的值，不四捨五入。 */
export type Position = [number, number];

export interface Formation {
	id: string;
	/** 哪一段；只有開頭那張在還沒有段時是 null。 */
	segmentId: string | null;
	/** 段內時間：音樂段第幾個半拍，口號段第幾個 0.1 秒。 */
	at: number;
	/** 隊員 id → 位置。 */
	pos: Record<string, Position>;
	/** 隊員 id → 從前一張走到這張的出發和到達。只有自己設過的人才有；開頭那張沒有。 */
	walks?: Record<string, Walk>;
}

/** 一個人兩張站位之間的走位：出發和到達，跟站位一樣記「哪個段 ＋ 段內時間」。 */
export interface Walk {
	depart: TimePosition;
	arrive: TimePosition;
}

/** 改一張站位裡一個或多個隊員的位置。位置可以在墊子外 1 m 以內。 */
export function setPositions(
	flow: Flow,
	formationId: string,
	moves: Record<string, Position>
): CommandResult {
	const formation = flow.formations.find((f) => f.id === formationId);
	if (!formation) return blocked('找不到這張站位');
	const { outer } = fieldGeometry(flow.field);
	const eps = 1e-9;
	for (const [id, [x, y]] of Object.entries(moves)) {
		if (!flow.members.some((m) => m.id === id)) return blocked('找不到這個隊員');
		const inside =
			x >= outer.x - eps &&
			x <= outer.x + outer.width + eps &&
			y >= outer.y - eps &&
			y <= outer.y + outer.height + eps;
		if (!inside) return blocked('只能站到墊子外 1 m 以內');
	}
	const updated = { ...formation, pos: { ...formation.pos, ...moves } };
	return ok({ ...flow, formations: flow.formations.map((f) => (f === formation ? updated : f)) });
}

/**
 * 在播放頭（全域秒數）拖人：改這一拍的站位；這一拍沒有站位就先插一張（位置帶入那一刻大家走到的地方）。
 * 改完往後帶（見 carryForward）。被擋就什麼都不改。
 * inserted = 有插新的站位；sec = 改到的那張站位的全域秒數（這一拍開始的時間）；carried = 往後帶到幾張站位。
 */
export function moveMembers(
	flow: Flow,
	sec: number,
	moves: Record<string, Position>
): CommandResult<{ inserted: boolean; sec: number; carried: number }> {
	let f = flow;
	const inserted = !formationAt(f, sec);
	if (inserted) {
		const r = insertFormation(f, sec);
		if (r.kind !== 'ok') return r;
		f = r.flow;
	}
	const target = formationAt(f, sec)!;
	const r = setPositions(f, target.id, moves);
	if (r.kind !== 'ok') return r;
	const { flow: carriedFlow, carried } = carryForward(r.flow, target, moves);
	return { kind: 'ok', flow: carriedFlow, inserted, sec: formationSec(r.flow, target), carried };
}

/**
 * 往後帶：每個被改的人，記下他在 from 這張的舊位置 p；往後一張一張看，他在那張也在 p（容許 1e-9）
 * 就一起改成新位置，遇到第一張不在 p 的就停。flow 是已經改好 from 的流程；from 是改之前的那張。
 * carried = 被改到的站位張數（不含 from）。
 */
function carryForward(
	flow: Flow,
	from: Formation,
	moves: Record<string, Position>
): { flow: Flow; carried: number } {
	const eps = 1e-9;
	const same = (p: Position | undefined, q: Position) =>
		!!p && Math.abs(p[0] - q[0]) <= eps && Math.abs(p[1] - q[1]) <= eps;
	const start = flow.formations.findIndex((f) => f.id === from.id) + 1;
	const formations = [...flow.formations];
	const touched = new Set<number>();
	for (const [id, to] of Object.entries(moves)) {
		const old = from.pos[id];
		if (!old || same(old, to)) continue;
		for (let i = start; i < formations.length && same(formations[i].pos[id], old); i++) {
			formations[i] = { ...formations[i], pos: { ...formations[i].pos, [id]: to } };
			touched.add(i);
		}
	}
	return { flow: { ...flow, formations }, carried: touched.size };
}

/**
 * 場地旁邊那一行字，告訴教練在播放頭拖人會改哪一張站位，還是會插一張新的。
 * 站位編號照時間排，跟站位縮圖列一樣；拍子音樂段寫「3-5&」，口號段寫「12.3 秒」。
 */
export function moveTargetText(flow: Flow, sec: number): string {
	const target = formationAt(flow, sec);
	if (target) {
		const index = flow.formations.indexOf(target);
		// 只有開頭那張的 segmentId 可能是 null。
		const when = index === 0 ? '開頭' : beatText(flow, target as TimePosition);
		return `拖人會改：站位 ${index + 1}（${when}）`;
	}
	// 不在站位上表示已經有段，toPosition 一定有值。
	return `拖人會在 ${beatText(flow, toPosition(flow, sec)!)} 插一張新站位`;
}

function beatText(flow: Flow, { segmentId, at }: TimePosition): string {
	const segment = flow.segments.find((s) => s.id === segmentId)!;
	return segment.kind === 'chant' ? `${atText(segment, at)} 秒` : atText(segment, at);
}

/** 開頭那張（formations[0]）不能刪。 */
const deletable = (index: number) => index > 0;

/** 刪一張站位。開頭那張不能刪。 */
export function deleteFormation(flow: Flow, formationId: string): CommandResult {
	const index = flow.formations.findIndex((f) => f.id === formationId);
	if (index === -1) return blocked('找不到這張站位');
	if (!deletable(index)) return blocked('流程開頭一定有一張站位，不能刪');
	return ok({ ...flow, formations: flow.formations.toSpliced(index, 1) });
}

/** 每張站位、它的全域秒數、能不能刪，照時間排。 */
export function formationTimes(
	flow: Flow
): { formation: Formation; sec: number; deletable: boolean }[] {
	return flow.formations.map((formation, i) => ({
		formation,
		sec: formationSec(flow, formation),
		deletable: deletable(i)
	}));
}

/** 站位的全域秒數。開頭那張還沒有段時是 0。 */
function formationSec(flow: Flow, f: Formation): number {
	return f.segmentId === null ? 0 : toSeconds(flow, { segmentId: f.segmentId, at: f.at });
}

/**
 * 這一刻（全域秒數）每個人站在哪：兩張站位之間，每人照自己的走位時間走（見 walkTimes），
 * 出發前在前一張的位置，出發到到達之間直線等速（可以跨段），到達後在後一張的位置。
 * 最後一張之後站著不動。
 */
export function positionsAt(flow: Flow, sec: number): Record<string, Position> {
	const times = flow.formations.map((f) => formationSec(flow, f));
	const next = times.findIndex((t) => t > sec);
	if (next === -1) return flow.formations.at(-1)!.pos;
	if (next === 0) return flow.formations[0].pos;
	const a = flow.formations[next - 1];
	const b = flow.formations[next];
	const out: Record<string, Position> = {};
	for (const [id, [ax, ay]] of Object.entries(a.pos)) {
		const [bx, by] = b.pos[id] ?? [ax, ay];
		const { depart, arrive } = walkTimes(flow, next, id);
		const k = Math.min(Math.max((sec - depart) / (arrive - depart), 0), 1);
		out[id] = [ax + (bx - ax) * k, ay + (by - ay) * k];
	}
	return out;
}

/**
 * 一個人在 formations[index - 1]（A）→ formations[index]（B）的出發和到達（全域秒數）。
 * 自己設的（B 的 walks）夾在 A、B 之間；夾完出發不早於到達就當沒設。
 * 預設：到達 = B；出發 = B 往前一個八拍（用 B 所在音樂段的 BPM），落進前一段時往前取到那一段的格子上。
 * B 在口號段，或 A、B 之間不到一個八拍：整段走（出發 = A）。
 */
function walkTimes(flow: Flow, index: number, memberId: string): { depart: number; arrive: number } {
	const b = flow.formations[index];
	const custom = b.walks?.[memberId];
	if (custom) {
		const aSec = formationSec(flow, flow.formations[index - 1]);
		const bSec = formationSec(flow, b);
		const clamp = (p: TimePosition) => Math.min(Math.max(toSeconds(flow, p), aSec), bSec);
		const depart = clamp(custom.depart);
		const arrive = clamp(custom.arrive);
		if (depart < arrive - EPS) return { depart, arrive };
	}
	return defaultWalk(flow, index);
}

/** 沒設的人在 formations[index - 1] → formations[index] 的出發和到達（見 walkTimes）。 */
function defaultWalk(flow: Flow, index: number): { depart: number; arrive: number } {
	const aSec = formationSec(flow, flow.formations[index - 1]);
	const b = flow.formations[index];
	const arrive = formationSec(flow, b);
	const segment = flow.segments.find((s) => s.id === b.segmentId);
	if (segment?.kind !== 'music') return { depart: aSec, arrive };
	const depart = arrive - HALF_BEATS_PER_EIGHT * unitSec(segment);
	if (depart <= aSec + EPS) return { depart: aSec, arrive };
	return { depart: toSeconds(flow, toPosition(flow, depart)!), arrive };
}

/**
 * 播放頭這一刻所在的那一拍（音樂段的半拍、口號段的 0.1 秒）上的站位；不在站位上是 undefined。
 * 還沒有段時，播放頭一定在開頭那張上。
 */
export function formationAt(flow: Flow, sec: number): Formation | undefined {
	const p = toPosition(flow, sec);
	if (!p) return flow.formations[0];
	return flow.formations.find((f) => f.segmentId === p.segmentId && f.at === p.at);
}

/**
 * 在播放頭所在的那一拍插一張站位，位置帶入那一刻大家走到的地方。
 * 插之前和插之後，每個人每一刻的位置都一樣：插在 t，對原本 A→B 有走位（出發 s、到達 e）的人，
 * 還沒出發（t ≤ s）的人 B 記 [s, e]；正在走的人新站位記 [s, t]、B 記 [t, e]；已經到的人新站位記 [s, e]。
 * 只在預設會算出不一樣時才寫。
 */
export function insertFormation(flow: Flow, sec: number): CommandResult {
	const p = toPosition(flow, sec);
	if (!p) return blocked('請先加一段');
	if (formationAt(flow, sec)) return blocked('這一拍已經有站位');
	const t = toSeconds(flow, p);
	const formation: Formation = {
		id: nextId('f', flow.formations.map((f) => f.id)),
		...p,
		pos: { ...positionsAt(flow, t) }
	};
	const bIndex = flow.formations.findIndex((f) => formationSec(flow, f) > t);
	if (bIndex === -1) return ok({ ...flow, formations: [...flow.formations, formation] });
	const a = flow.formations[bIndex - 1];
	const b = flow.formations[bIndex];
	const before = Object.fromEntries(
		Object.keys(a.pos).map((id) => [id, walkTimes(flow, bIndex, id)] as const)
	);
	let after: Flow = { ...flow, formations: flow.formations.toSpliced(bIndex, 0, formation) };
	const walks: Record<'inserted' | 'b', Record<string, Walk>> = { inserted: {}, b: { ...b.walks } };
	for (const [id, { depart: s, arrive: e }] of Object.entries(before)) {
		if (samePos(a.pos[id], b.pos[id] ?? a.pos[id])) continue;
		const mine = t <= s ? null : t < e ? [s, t] : [s, e];
		const next = t <= s ? [s, e] : t < e ? [t, e] : null;
		const set = (into: Record<string, Walk>, index: number, w: number[] | null) => {
			const d = defaultWalk(after, index);
			if (!w || (Math.abs(d.depart - w[0]) < EPS && Math.abs(d.arrive - w[1]) < EPS)) delete into[id];
			else into[id] = { depart: toPosition(after, w[0])!, arrive: toPosition(after, w[1])! };
		};
		set(walks.inserted, bIndex, mine);
		set(walks.b, bIndex + 1, next);
	}
	after = {
		...after,
		formations: after.formations.with(bIndex, withWalks(formation, walks.inserted)).with(
			bIndex + 1,
			withWalks(b, walks.b)
		)
	};
	return ok(after);
}

/** 換掉站位的 walks；沒有人就拿掉這個欄位。 */
function withWalks(f: Formation, walks: Record<string, Walk>): Formation {
	const { walks: _, ...rest } = f;
	return Object.keys(walks).length ? { ...rest, walks } : rest;
}

function samePos(a: Position, b: Position): boolean {
	return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
}
