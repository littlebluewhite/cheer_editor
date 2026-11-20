// 流程資料和建立流程的指令。
// 欄位照規格的流程檔格式 `flow` 那一層；之後的票再加段、動作等。

import type { Action } from './action-types';
import { newId } from './ids';
import { fieldGeometry, MAX_STRIPS, MIN_STRIPS, type FieldConfig } from './field';
import type { Formation, Position } from './formation';
import type { MarkerStyle, Member } from './members';
import { stackedMembers } from './hints';
import { answered, blocked, needsConfirm, ok, type CommandResult, type ConfirmOption } from './result';
import type { CustomRole } from './roles';
import type { AudioRef, Segment } from './segment';
import { snapPosition } from './snap';
import { tooLong } from './text-length';
import { DEFAULT_TIME_RULES, type TimeRules } from './time-rules';
import { joined, type Why } from './why';

export interface Flow {
	name: string;
	/** 建好之後可以調整（adjustField）。 */
	field: FieldConfig;
	timeRules: TimeRules;
	/** 名單順序 = 泳道順序。 */
	members: Member[];
	/** 用到的音樂檔清單（只有參照，位元組另外放）。 */
	audio: AudioRef[];
	/** 一串緊接的段，順序就是播放順序。 */
	segments: Segment[];
	/** 照時間排。第一張是流程開頭那張（第一段的時間 0），一定在、不能刪。 */
	formations: Formation[];
	/** 這支流程自己加的任務角色（固定的 12 個不存）。 */
	customRoles: CustomRole[];
	actions: Action[];
	/** 隊員的標記用號碼還是開頭字；沒有就是號碼。 */
	markers?: MarkerStyle;
}

export interface NewFlowInput {
	name: string;
	field: FieldConfig;
}

/**
 * 流程名字哪裡不行（頭尾空白先去掉；before：改之前的名字，開檔進來就超過上限的可以留著，不能更長）；沒問題是 null。
 */
export function flowNameProblem(name: string, before?: string): Why | null {
	const trimmed = name.trim();
	return trimmed ? tooLong('flowName', trimmed, before) : { code: 'flow_no_name' };
}

/** 條數的毛病：不是 1–12 的整數；沒問題是 null。 */
export function stripsProblem(strips: number): Why | null {
	if (!Number.isInteger(strips) || strips < MIN_STRIPS || strips > MAX_STRIPS) {
		return { code: 'flow_strips', min: MIN_STRIPS, max: MAX_STRIPS };
	}
	return null;
}

export function createFlow(input: NewFlowInput): CommandResult {
	const name = input.name.trim();
	const problem = flowNameProblem(name);
	if (problem) return blocked(problem);
	const stripsError = stripsProblem(input.field.strips);
	if (stripsError) return blocked(stripsError);
	return ok({
		name,
		field: { ...input.field },
		timeRules: { ...DEFAULT_TIME_RULES },
		members: [],
		audio: [],
		segments: [],
		formations: [{ id: newId('f', []), segmentId: null, at: 0, pos: {} }],
		customRoles: [],
		actions: []
	});
}

/** 隊員的名字；找不到這個人是空字串。 */
export function memberName(flow: Flow, id: string): string {
	return flow.members.find((m) => m.id === id)?.name ?? '';
}

/** 流程設定：改流程名字。存檔的檔名跟著變。 */
export function renameFlow(flow: Flow, name: string): CommandResult {
	const trimmed = name.trim();
	const problem = flowNameProblem(trimmed, flow.name);
	if (problem) return blocked(problem);
	return ok({ ...flow, name: trimmed });
}

/**
 * 調整場地：改條數或鋪向。墊子上的人照比例放大縮小，再吸到最近的 1/4 格（對中線對稱的人吸完還是對稱）；
 * 站在墊子外的人，跟最近那個邊的距離不變（還是在場外）。
 * 調完會有人疊在同一點（原本沒疊在一起）時先問，列出哪張站位誰疊在一起；確定（confirmed）才調。
 */
export function adjustField(flow: Flow, field: FieldConfig, o: ConfirmOption = {}): CommandResult {
	const problem = stripsProblem(field.strips);
	if (problem) return blocked(problem);
	const from = fieldGeometry(flow.field).mat;
	const to = fieldGeometry(field).mat;
	const axis = (v: number, lo: number, len: number, newLo: number, newLen: number) => {
		if (v < lo) return newLo - (lo - v);
		if (v > lo + len) return newLo + newLen + (v - lo - len);
		return newLo + ((v - lo) / len) * newLen;
	};
	const moveOneSide = ([x, y]: Position): Position => {
		const p: Position = [axis(x, from.x, from.width, to.x, to.width), axis(y, from.y, from.height, to.y, to.height)];
		const snapped = snapPosition(field, p, 1);
		const onMat = (v: number, lo: number, len: number) => v >= lo && v <= lo + len;
		return [onMat(x, from.x, from.width) ? snapped[0] : p[0], onMat(y, from.y, from.height) ? snapped[1] : p[1]];
	};
	// 場地和格子都對中線左右、前後對稱：照離中線多遠算，再放回原本那一邊，對稱的站位換完還是對稱
	const move = ([x, y]: Position): Position => {
		const [ax, ay] = moveOneSide([Math.abs(x), Math.abs(y)]);
		return [Math.sign(x) * ax, Math.sign(y) * ay];
	};
	const formations = flow.formations.map((f) => ({
		...f,
		pos: Object.fromEntries(Object.entries(f.pos).map(([id, p]) => [id, move(p)]))
	}));
	if (!answered(o)) {
		const items = formations.flatMap((f, i) => {
			const before = stackedMembers(flow.members, flow.formations[i].pos);
			const wasStacked = (g: Member[]) => before.some((b) => g.every((m) => b.includes(m)));
			return stackedMembers(flow.members, f.pos)
				.filter((g) => !wasStacked(g))
				.map((g): Why => {
					const names = joined('members_list', g.map((m) => m.name));
					return f.name ? { code: 'flow_stacked_named', n: i + 1, name: f.name, names } : { code: 'flow_stacked_item', n: i + 1, names };
				});
		});
		if (items.length) return needsConfirm({ code: 'flow_stacked' }, items);
	}
	return ok({ ...flow, field: { ...field }, formations });
}

/** 兩份流程內容一不一樣（不看是不是同一個物件；沒有的欄位和 undefined 算一樣）。復原用它判斷「改」有沒有改到東西。 */
export function sameFlow(a: Flow, b: Flow): boolean {
	return same(a, b);
}

function same(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
	if (Array.isArray(a) || Array.isArray(b)) {
		return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]));
	}
	const x = a as Record<string, unknown>;
	const y = b as Record<string, unknown>;
	return [...new Set([...Object.keys(x), ...Object.keys(y)])].every((k) => same(x[k], y[k]));
}
