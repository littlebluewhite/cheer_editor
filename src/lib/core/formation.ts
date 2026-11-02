// 站位：全隊在某一刻的位置。每張都包含全隊每一個人。
// 站位記「哪個段 ＋ 段內時間」（音樂段第幾個半拍、口號段第幾個 0.1 秒），flow.formations 照時間排。
// 開頭那張（formations[0]）一定在第一段的時間 0；還沒有段時 segmentId 是 null。

import { fieldGeometry } from './field';
import type { Flow } from './flow';
import { blocked, ok, type CommandResult } from './result';
import { nextId } from './segment';
import { toPosition, toSeconds } from './time';

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
 * 被擋就什麼都不改。inserted = 有插新的站位；sec = 改到的那張站位的全域秒數（這一拍開始的時間）。
 */
export function moveMembers(
	flow: Flow,
	sec: number,
	moves: Record<string, Position>
): CommandResult<{ inserted: boolean; sec: number }> {
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
	return { ...r, inserted, sec: formationSec(r.flow, target) };
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
 * 這一刻（全域秒數）每個人站在哪：兩張站位之間每人直線等速（可以跨段），
 * 最後一張之後站著不動。
 */
export function positionsAt(flow: Flow, sec: number): Record<string, Position> {
	const times = flow.formations.map((f) => formationSec(flow, f));
	const next = times.findIndex((t) => t > sec);
	if (next === -1) return flow.formations.at(-1)!.pos;
	if (next === 0) return flow.formations[0].pos;
	const a = flow.formations[next - 1];
	const b = flow.formations[next];
	const k = (sec - times[next - 1]) / (times[next] - times[next - 1]);
	const out: Record<string, Position> = {};
	for (const [id, [ax, ay]] of Object.entries(a.pos)) {
		const [bx, by] = b.pos[id] ?? [ax, ay];
		out[id] = [ax + (bx - ax) * k, ay + (by - ay) * k];
	}
	return out;
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

/** 在播放頭所在的那一拍插一張站位，位置帶入那一刻大家走到的地方，所以其他人的走法不變。 */
export function insertFormation(flow: Flow, sec: number): CommandResult {
	const p = toPosition(flow, sec);
	if (!p) return blocked('請先加一段');
	if (formationAt(flow, sec)) return blocked('這一拍已經有站位');
	const sec0 = toSeconds(flow, p);
	const formation: Formation = {
		id: nextId('f', flow.formations.map((f) => f.id)),
		...p,
		pos: { ...positionsAt(flow, sec0) }
	};
	const index = flow.formations.findIndex((f) => formationSec(flow, f) > sec0);
	const formations = flow.formations.toSpliced(
		index === -1 ? flow.formations.length : index,
		0,
		formation
	);
	return ok({ ...flow, formations });
}
