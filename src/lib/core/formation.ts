// 站位：全隊在某一刻的位置。每張都包含全隊每一個人。
// 站位記「哪個段 ＋ 段內時間」（音樂段第幾個半拍、口號段第幾個 0.1 秒），flow.formations 照時間排。
// 開頭那張（formations[0]）一定在第一段的時間 0；還沒有段時 segmentId 是 null。

import { actionSeconds } from './action-types';
import { fieldGeometry } from './field';
import type { Flow } from './flow';
import { blocked, ok, type CommandResult } from './result';
import { nextId } from './ids';
import {
	EPS,
	HALF_BEATS_PER_EIGHT,
	timeTextWithUnit,
	toPosition,
	toSeconds,
	unitSec,
	units,
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
	/** 站位名稱（可有可無），例：開場、金字塔。沒有就只叫「站位 3」。 */
	name?: string;
	/** 隊員 id → 從前一張走到這張的出發和到達。只有自己設過的人才有；開頭那張沒有。 */
	walks?: Record<string, Walk>;
}

/** 一個人兩張站位之間的走位：出發和到達，跟站位一樣記「哪個段 ＋ 段內時間」。 */
export interface Walk {
	depart: TimePosition;
	arrive: TimePosition;
}

/** moveMembers、matchPrevious 多帶的結果，見 moveMembers。 */
export interface MoveResult {
	inserted: boolean;
	sec: number;
	carried: number;
}

/** 改一張站位裡一個或多個隊員的位置。位置可以在場地外 1 m 以內。 */
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
		if (!inside) return blocked('只能站到場地外 1 公尺以內');
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
): CommandResult<MoveResult> {
	return moveAt(flow, sec, () => moves);
}

/**
 * 跟上一張一樣：選到的人在播放頭這一拍的站位，改成上一張站位的位置；這一拍沒有站位就先插一張
 * （跟拖人一樣），效果就是「他們到這一拍都還站著」。改完往後帶。回傳跟 moveMembers 一樣。
 * 沒選人、播放頭在開頭那張，就擋下。
 */
export function matchPrevious(
	flow: Flow,
	sec: number,
	memberIds: string[]
): CommandResult<MoveResult> {
	if (memberIds.length === 0) return blocked('先選人');
	if (formationAt(flow, sec) === flow.formations[0]) return blocked('開頭那張前面沒有站位');
	if (memberIds.some((id) => !flow.members.some((m) => m.id === id))) return blocked('找不到這個隊員');
	return moveAt(flow, sec, (f, target) => {
		const previous = f.formations[f.formations.indexOf(target) - 1];
		return Object.fromEntries(memberIds.map((id) => [id, previous.pos[id]]));
	});
}

/** moveMembers 和 matchPrevious 共用：插站位（需要時）、改位置、往後帶。movesFor 拿到插好站位的流程和要改的那張。 */
function moveAt(
	flow: Flow,
	sec: number,
	movesFor: (flow: Flow, target: Formation) => Record<string, Position>
): CommandResult<MoveResult> {
	let f = flow;
	const inserted = !formationAt(f, sec);
	if (inserted) {
		const r = insertFormation(f, sec);
		if (r.kind !== 'ok') return r;
		f = r.flow;
	}
	const target = formationAt(f, sec)!;
	const moves = movesFor(f, target);
	const r = setPositions(f, target.id, moves);
	if (r.kind !== 'ok') return r;
	const { flow: carriedFlow, carried } = carryForward(r.flow, target, moves);
	return ok(carriedFlow, { inserted, sec: formationSec(r.flow, target), carried });
}

/**
 * 往後帶：每個被改的人，記下他在 from 這張的舊位置 p；往後一張一張看，他在那張也在 p（見 samePos）
 * 就一起改成新位置，遇到第一張不在 p 的就停。flow 是已經改好 from 的流程；from 是改之前的那張。
 * carried = 被改到的站位張數（不含 from）。
 */
function carryForward(
	flow: Flow,
	from: Formation,
	moves: Record<string, Position>
): { flow: Flow; carried: number } {
	const start = flow.formations.findIndex((f) => f.id === from.id) + 1;
	const formations = [...flow.formations];
	const touched = new Set<number>();
	for (const [id, to] of Object.entries(moves)) {
		const old = from.pos[id];
		if (!old || samePos(old, to)) continue;
		const at = (i: number) => formations[i].pos[id];
		for (let i = start; i < formations.length && at(i) && samePos(at(i), old); i++) {
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
		const t = target as TimePosition;
		const when = index === 0 ? '開頭' : timeTextWithUnit(flow, t.segmentId, t);
		return `拖人會改：站位 ${index + 1}（${when}）`;
	}
	// 不在站位上表示已經有段，toPosition 一定有值。
	const p = toPosition(flow, sec)!;
	return `拖人會在 ${timeTextWithUnit(flow, p.segmentId, p)} 插一張新站位`;
}

/** 幫一張站位取名。清成空白就拿掉名字，只顯示號碼。 */
export function renameFormation(flow: Flow, formationId: string, name: string): CommandResult {
	const formation = flow.formations.find((f) => f.id === formationId);
	if (!formation) return blocked('找不到這張站位');
	const { name: _, ...rest } = formation;
	const trimmed = name.trim();
	const updated: Formation = { ...rest, ...(trimmed ? { name: trimmed } : {}) };
	return ok({ ...flow, formations: flow.formations.map((f) => (f === formation ? updated : f)) });
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
 * 設出發和到達：formationId 是 B（走到的那一張），walks 是隊員 id → 出發、到達，每個人可以不一樣。
 * 寫進去的就是自己設的，跟預設一樣也寫。擋下：開頭那張、出發不早於到達、時間不在 A 和 B 之間。
 */
export function setWalks(flow: Flow, formationId: string, walks: Record<string, Walk>): CommandResult {
	const index = walkFormationIndex(flow, formationId);
	if (typeof index === 'string') return blocked(index);
	const aSec = formationSec(flow, flow.formations[index - 1]);
	const bSec = formationSec(flow, flow.formations[index]);
	for (const [id, { depart, arrive }] of Object.entries(walks)) {
		if (!flow.members.some((m) => m.id === id)) return blocked('找不到這個隊員');
		const d = toSeconds(flow, depart);
		const a = toSeconds(flow, arrive);
		if (!inGrid(flow, depart) || !inGrid(flow, arrive) || d < aSec - EPS || a > bSec + EPS) {
			return blocked('出發和到達要在前一張和這一張站位之間');
		}
		if (d >= a - EPS) return blocked('出發要早於到達');
	}
	const b = flow.formations[index];
	const updated = withWalks(b, { ...b.walks, ...walks });
	return ok({ ...flow, formations: flow.formations.with(index, updated) });
}

/** 清掉 formationId（B）上這些人的出發和到達設定，回到預設。 */
export function clearWalks(flow: Flow, formationId: string, memberIds: string[]): CommandResult {
	const index = walkFormationIndex(flow, formationId);
	if (typeof index === 'string') return blocked(index);
	const b = flow.formations[index];
	const walks = { ...b.walks };
	for (const id of memberIds) delete walks[id];
	return ok({ ...flow, formations: flow.formations.with(index, withWalks(b, walks)) });
}

/**
 * 一個人走到 formationId（B）這張的出發和到達（自己設的夾過、或預設），給表單顯示。
 * 開頭那張或找不到站位是 null。
 */
export function memberWalk(flow: Flow, formationId: string, memberId: string): Walk | null {
	const index = walkFormationIndex(flow, formationId);
	if (typeof index === 'string') return null;
	const { depart, arrive } = walkTimes(flow, index, memberId);
	// A、B 和設定都在格子上，所以換回段內時間不會偏；剛好在交界時算後面那一段，秒數一樣。
	return { depart: toPosition(flow, depart)!, arrive: toPosition(flow, arrive)! };
}

/** 走太快：每秒超過這麼多公尺。這個數字是猜的，還沒跟教練確認過，之後可能要改。 */
export const TOO_FAST_MPS = 4;

/** 很喘：每秒超過這麼多公尺，跑得到但很累。也是猜的，還沒跟教練確認過。 */
export const TIRING_MPS = 2.5;

/** 一個人 A→B 的走位：起點、終點、出發和到達（全域秒數）、速度（公尺／秒）、是不是太快、是不是很喘。 */
export interface FormationWalk {
	memberId: string;
	from: Position;
	to: Position;
	departSec: number;
	arriveSec: number;
	speed: number;
	tooFast: boolean;
	/** 跑得到但很喘：速度超過 TIRING_MPS、沒超過 TOO_FAST_MPS。太快的人這裡是 false。 */
	tiring: boolean;
}

/**
 * 這段的走位：走到 formationId（B）這張時，位置有變的人，照名單順序。
 * 只看位置，不看 walks（位置一樣的人就算有設定也站著不動）。開頭那張或找不到站位是空的。
 * 太快：速度超過 TOO_FAST_MPS；很喘：超過 TIRING_MPS 但沒到太快。
 * 走位期間跟他自己參加的騰翻動作時間重疊，就兩個都不算。
 */
export function formationWalks(flow: Flow, formationId: string): FormationWalk[] {
	const index = walkFormationIndex(flow, formationId);
	if (typeof index === 'string') return [];
	const a = flow.formations[index - 1];
	const b = flow.formations[index];
	const tumbling = flow.actions
		.filter((x) => x.category === 'tumbling')
		.map((x) => ({ ...actionSeconds(flow, x), ids: x.members.map((m) => m.memberId) }));
	const out: FormationWalk[] = [];
	for (const { id } of flow.members) {
		const from = a.pos[id];
		const to = b.pos[id];
		if (!from || !to || samePos(from, to)) continue;
		const { depart, arrive } = walkTimes(flow, index, id);
		const speed = Math.hypot(to[0] - from[0], to[1] - from[1]) / (arrive - depart);
		const tumbles = tumbling.some(
			(t) => t.ids.includes(id) && t.startSec < arrive - EPS && depart < t.endSec - EPS
		);
		const tooFast = speed > TOO_FAST_MPS + EPS && !tumbles;
		out.push({
			memberId: id,
			from,
			to,
			departSec: depart,
			arriveSec: arrive,
			speed,
			tooFast,
			tiring: speed > TIRING_MPS + EPS && !tumbles && !tooFast
		});
	}
	return out;
}

/** 能設出發和到達的站位在 formations 裡的位置；不能設時回原因。 */
function walkFormationIndex(flow: Flow, formationId: string): number | string {
	const index = flow.formations.findIndex((f) => f.id === formationId);
	if (index === -1) return '找不到這張站位';
	if (index === 0) return '開頭那張前面沒有站位，不能設出發和到達';
	return index;
}

/**
 * 一個人在 formations[index - 1]（A）→ formations[index]（B）的出發和到達（全域秒數）。
 * 自己設的（B 的 walks）夾在 A、B 之間；夾完出發不早於到達就當沒設。
 * 預設：到達 = B；出發 = B 往前一個八拍（用 B 所在音樂段的 BPM），落進前一段時往前取到那一段的格子上。
 * B 在口號段，或 A、B 之間不到一個八拍：整段走（出發 = A）。
 */
function walkTimes(flow: Flow, index: number, memberId: string): { depart: number; arrive: number } {
	return customWalk(flow, index, memberId) ?? defaultWalk(flow, index);
}

/** 自己設的出發和到達（全域秒數），夾在 A、B 之間；沒設、或夾完出發不早於到達是 null（見 walkTimes）。 */
function customWalk(
	flow: Flow,
	index: number,
	memberId: string
): { depart: number; arrive: number } | null {
	const b = flow.formations[index];
	const custom = b.walks?.[memberId];
	if (!custom) return null;
	const aSec = formationSec(flow, flow.formations[index - 1]);
	const bSec = formationSec(flow, b);
	const clamp = (p: TimePosition) => Math.min(Math.max(toSeconds(flow, p), aSec), bSec);
	const depart = clamp(custom.depart);
	const arrive = clamp(custom.arrive);
	return depart < arrive - EPS ? { depart, arrive } : null;
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

/** 播放頭這一刻用的站位：站位時間不晚於播放頭的最後一張。number 照時間排，跟站位縮圖列一樣。 */
export function currentFormation(flow: Flow, sec: number): { formation: Formation; number: number } {
	const next = flow.formations.findIndex((f) => formationSec(flow, f) > sec + EPS);
	const index = next === -1 ? flow.formations.length - 1 : Math.max(next - 1, 0);
	return { formation: flow.formations[index], number: index + 1 };
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
		// 段改短後，自己設的出發／到達可能不在格子上：時間沒變就照原本記的寫回去，不吸到格子
		const custom = b.walks?.[id];
		const at = (sec: number) =>
			[custom?.depart, custom?.arrive].find((q) => q && Math.abs(toSeconds(flow, q) - sec) < EPS) ??
			toPosition(after, sec)!;
		const set = (into: Record<string, Walk>, index: number, w: number[] | null) => {
			const d = defaultWalk(after, index);
			if (!w || (Math.abs(d.depart - w[0]) < EPS && Math.abs(d.arrive - w[1]) < EPS)) delete into[id];
			else into[id] = { depart: at(w[0]), arrive: at(w[1]) };
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

/**
 * 挪站位：把站位時間改到 to，隊員的位置不變。sec = 新的站位時間（全域秒數）。
 * 擋下：開頭那張、to 不在段的格子上、不在前一張之後和後一張（最後一張是流程結尾）之前。
 */
export function moveFormation(
	flow: Flow,
	formationId: string,
	to: TimePosition
): CommandResult<{ sec: number; squeezed: number }> {
	const index = flow.formations.findIndex((f) => f.id === formationId);
	if (index === -1) return blocked('找不到這張站位');
	if (index === 0) return blocked('開頭那張不能挪');
	const sec = toSeconds(flow, to);
	const [a, b, c] = [-1, 0, 1].map((i) => flow.formations[index + i]);
	const aSec = formationSec(flow, a);
	const inside =
		inGrid(flow, to) && sec > aSec + EPS && (!c || sec < formationSec(flow, c) - EPS);
	if (!inside) {
		const { before, after } = neighbourTimes(flow, index);
		const end = after ? `站位 ${index + 2}（${after}）` : '流程結尾';
		return blocked(`站位 ${index + 1} 要挪到站位 ${index}（${before}）之後、${end}之前`);
	}
	const shift = sec - formationSec(flow, b);
	if (Math.abs(shift) < EPS) return ok(flow, { sec, squeezed: 0 });
	// 這張上自己設的出發和到達跟著挪一樣多秒，夾在前一張和新的站位時間之間，
	// 不在格子上就往前取（跟插站位一樣）；夾完出發不早於到達就當沒設。
	const moved = (t: number) => toPosition(flow, Math.min(Math.max(t + shift, aSec), sec))!;
	const walks: Record<string, Walk> = {};
	for (const id of Object.keys(b.walks ?? {})) {
		const w = customWalk(flow, index, id);
		if (!w) continue;
		const depart = moved(w.depart);
		const arrive = moved(w.arrive);
		if (toSeconds(flow, depart) < toSeconds(flow, arrive) - EPS) walks[id] = { depart, arrive };
	}
	const formation = withWalks({ ...b, ...to }, walks);
	const after = { ...flow, formations: flow.formations.with(index, formation) };
	return ok(after, { sec, squeezed: shortened(flow, after, c ? [b.id, c.id] : [b.id]) });
}

/** 左邊欄「站位時間」框下面那一行：能挪到哪。開頭那張不能挪；找不到站位是空字串。 */
export function moveFormationHint(flow: Flow, formationId: string): string {
	const index = flow.formations.findIndex((f) => f.id === formationId);
	if (index === -1) return '';
	if (index === 0) return '開頭那張不能挪';
	const { before, after } = neighbourTimes(flow, index);
	return after ? `可以挪到 ${before} 之後、${after} 之前` : `可以挪到 ${before} 之後`;
}

/**
 * 挪 formations[index]（不是開頭那張）時，前一張和後一張的站位時間給教練看：
 * 在這張那一段只寫段內時間，別段前面加段名。沒有後一張是 null。
 */
function neighbourTimes(flow: Flow, index: number): { before: string; after: string | null } {
	// 有前一張表示已經有段，segmentId 一定有值。
	const home = flow.formations[index].segmentId!;
	const text = (f: Formation) => timeTextWithUnit(flow, home, f as TimePosition);
	const c = flow.formations[index + 1];
	return { before: text(flow.formations[index - 1]), after: c ? text(c) : null };
}

/** 走到 formationIds 這幾張的走位，after 比 before 短的人數（一人只算一次）。 */
function shortened(before: Flow, after: Flow, formationIds: string[]): number {
	const lengths = (flow: Flow, id: string) =>
		new Map(formationWalks(flow, id).map((w) => [w.memberId, w.arriveSec - w.departSec]));
	const out = new Set<string>();
	for (const id of formationIds) {
		const was = lengths(before, id);
		for (const [memberId, now] of lengths(after, id)) {
			if (now < was.get(memberId)! - EPS) out.add(memberId);
		}
	}
	return out.size;
}

/** 段內時間在不在那一段的格子上（音樂段半拍、口號段 0.1 秒，不超出段）。 */
function inGrid(flow: Flow, { segmentId, at }: TimePosition): boolean {
	const segment = flow.segments.find((s) => s.id === segmentId);
	return !!segment && Number.isInteger(at) && at >= 0 && at < units(segment);
}

/** 換掉站位的 walks；沒有人就拿掉這個欄位。 */
export function withWalks(f: Formation, walks: Record<string, Walk>): Formation {
	const { walks: _, ...rest } = f;
	return Object.keys(walks).length ? { ...rest, walks } : rest;
}

/** 兩個位置是不是同一個點：x、y 都差不到 1e-9 公尺（浮點數誤差）。 */
export function samePos(a: Position, b: Position): boolean {
	return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
}
