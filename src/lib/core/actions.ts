// 動作：一群隊員在一個段裡一起做的一件事。時間存段 ＋ 段內整數時間
// （音樂段是第幾個半拍，口號段是第幾個 0.1 秒），不存全域秒數。

import { cueFallout, cueProblem, type Cue } from './cues';
import { phaseFallout, phaseFalloutText } from './phase-beats';
import { memberName, type Flow } from './flow';
import { answered, blocked, needsConfirm, ok, type CommandResult, type ConfirmOption } from './result';
import { roleGlossary } from './roles';
import type { Segment } from './segment';
import {
	askRecords,
	compactSquads,
	fitRecords,
	perPerson,
	replacePhases,
	settleRecords,
	successRateProblem,
	type SuccessRate
} from './success-rate';
import { nextId } from './ids';
import { EPS, HALF_BEATS_PER_EIGHT, toPosition, toSeconds, unitSec, units } from './time';

/** 大類，固定 7 個，不能自訂。流程檔存英文代號。 */
export type ActionCategory = 'stunt' | 'pyramid' | 'toss' | 'tumbling' | 'jump' | 'dance' | 'other';

export const ACTION_CATEGORIES: { key: ActionCategory; label: string }[] = [
	{ key: 'stunt', label: '技巧' },
	{ key: 'pyramid', label: '金字塔' },
	{ key: 'toss', label: '拋投' },
	{ key: 'tumbling', label: '騰翻' },
	{ key: 'jump', label: '跳躍' },
	{ key: 'dance', label: '舞蹈' },
	{ key: 'other', label: '其他' }
];

export interface ActionMember {
	memberId: string;
	/** 任務角色的名稱（固定或自訂）；沒掛是 null。 */
	role: string | null;
	/** 第幾組（1 起）；沒有就是沒分組（舊流程檔沒有這個欄位）。 */
	squad?: number;
}

export interface Action {
	id: string;
	segmentId: string;
	category: ActionCategory;
	name: string;
	/** 段內第幾個半拍／0.1 秒開始。 */
	start: number;
	/** 幾個半拍／0.1 秒。 */
	length: number;
	note: string;
	members: ActionMember[];
	/** 辨識色（#rrggbb）：教練自己挑來認動作的顏色；沒有就用大類的顏色（舊流程檔沒有這個欄位）。 */
	color?: string;
	/** 這個動作的拍點；沒有就是空的（舊流程檔沒有這個欄位）。 */
	cues?: Cue[];
	/** 成功率的設定：有環節才有；沒有就是不記成功率（舊流程檔沒有這個欄位）。 */
	successRate?: SuccessRate;
}

export type NewActionInput = Omit<Action, 'id'>;

/** 新增動作，回傳新動作的 id。 */
export function addAction(flow: Flow, input: NewActionInput): CommandResult<{ id: string }> {
	const action = normalize({ id: nextId('x', flow.actions.map((a) => a.id)), ...input });
	const problem = check(flow, action);
	if (problem) return blocked(problem);
	return { kind: 'ok', flow: { ...flow, actions: [...flow.actions, action] }, id: action.id };
}

/**
 * 名稱去掉頭尾空白；人複製一份，不跟呼叫端共用物件；辨識色是空的就不留欄位（用大類的顏色）。
 * 不記成功率（沒有環節）、或騰翻跳躍（不分組）的動作，人身上的組拿掉（例：從別的動作複製人、大類換成騰翻）。
 * 對不上的紀錄也拿掉（組沒人了、人移出動作、大類換成騰翻或換掉騰翻）。
 */
function normalize({ color, ...action }: Action): Action {
	const grouped = !!action.successRate && !perPerson(action.category);
	return fitRecords({
		...action,
		...(color ? { color } : {}),
		name: action.name.trim(),
		members: action.members.map(({ squad, ...m }) => (grouped && squad !== undefined ? { ...m, squad } : m))
	});
}

/**
 * 改動作的任何欄位（含換段、換人），照新增的規則檢查。
 * 變短會切到拍點、有拍點的動作換到口號段、或拿掉的人（任務角色）有拍點給他時，回「要確認」並列出那些拍點；
 * 帶 { confirmed: true } 再送一次才切短、拿掉。
 * 會動到紀錄時也先問（換大類讓算法變了、組沒人了、騰翻跳躍拿掉人：要確認；有紀錄的組換了人：選保留舊紀錄或清掉重算），
 * 跟拍點一起問；帶 { confirmed: true } 或 { records } 再送一次。做完組號補成不跳號（見 compactSquads）。
 */
export function updateAction(
	flow: Flow,
	id: string,
	changes: Partial<NewActionInput>,
	options: ConfirmOption = {}
): CommandResult {
	const old = flow.actions.find((a) => a.id === id);
	if (!old) return blocked('找不到這個動作');
	let action = normalize({ ...old, ...changes, id });
	const from = flow.segments.find((s) => s.id === old.segmentId);
	const to = flow.segments.find((s) => s.id === action.segmentId);
	const fallout = from && to ? cueFallout(from, to, old, action, flow) : null;
	if (fallout) action = { ...action, cues: fallout.cues };
	const realigned = from && to ? phaseFallout(from, to, old, action) : null;
	// 只挪半拍、沒切到的標的拍不用問。
	const marked = realigned?.items.length ? realigned : null;
	const asked = fallout || marked ? falloutMessage(old, action, from!, to!, fallout, marked) : null;
	const items = [...(fallout?.items ?? []), ...(marked?.items ?? [])];
	// 刪掉的環節的記號在上面問過了：換環節放在紀錄問完之後，不再算成「換了人」清掉的。
	const settled = settleRecords(flow, old, action, options.records);
	action = realigned ? replacePhases(settled.action, realigned.phases) : settled.action;
	const problem = check(flow, action);
	if (problem) return blocked(problem);
	if (!answered(options) && settled.ask) {
		const head = asked ? `${asked}；` : `動作「${actionLabel(old)}」`;
		return askRecords(head, { ...settled.ask, items: [...items, ...settled.ask.items] });
	}
	if (asked && !answered(options)) return needsConfirm(asked, items);
	return ok({ ...flow, actions: flow.actions.map((a) => (a.id === id ? compactSquads(action) : a)) });
}

/**
 * 「動作「技巧·Lib」變短，會拿掉 1 個、切短 1 個拍點」；換了人或任務角色是「…換了人或任務角色，會拿掉 N 個拍點」，
 * 兩個都有就「…變短、換了人或任務角色，…」；換到口號段是「…換到口號段，會拿掉 N 個拍點」。
 * 也動到環節標的拍時接在後面：「…拍點，刪掉 1 個環節」；只動到標的拍是「…變短，會切短 1 個環節標的拍」，
 * 拖到半拍上、標的拍對齊整拍時切到是「…拖到半拍上，會切短 1 個環節標的拍」。
 */
function falloutMessage(
	old: Action,
	action: Action,
	from: Segment,
	to: Segment,
	cues: { removed: number; cut: number; orphaned: number } | null,
	phases: Parameters<typeof phaseFalloutText>[0] & { shifted: boolean } | null
): string {
	const label = `動作「${actionLabel(action)}」`;
	const shorter = action.length < old.length ? '變短' : '';
	const offBeat = phases?.shifted ? '拖到半拍上' : '';
	if (!cues) {
		const why =
			to.kind !== 'music'
				? '換到口號段'
				: from.kind !== 'music'
					? '換到音樂段'
					: [shorter, offBeat].filter(Boolean).join('、');
		return `${label}${why}，會${phaseFalloutText(phases!)}`;
	}
	const more = phases ? `，${phaseFalloutText(phases)}` : '';
	if (to.kind !== 'music') return `${label}換到口號段，會拿掉 ${cues.removed} 個拍點${more}`;
	const why = [shorter, cues.orphaned ? '換了人或任務角色' : '', offBeat].filter(Boolean);
	const parts = [cues.removed ? `拿掉 ${cues.removed} 個` : '', cues.cut ? `切短 ${cues.cut} 個` : ''].filter(Boolean);
	return `${label}${why.join('、')}，會${parts.join('、')}拍點${more}`;
}

/** 拖色條：把動作的開始移到 startSec（全域秒數）最近的那一格，留在原來那一段；跨段、撞到人就擋。要確認時跟 updateAction 一樣。 */
export function moveAction(
	flow: Flow,
	id: string,
	startSec: number,
	options: ConfirmOption = {}
): CommandResult {
	const at = unitAt(flow, id, startSec);
	return at === null ? blocked('找不到這個動作') : updateAction(flow, id, { start: at }, options);
}

/** 拉色條右邊：把動作的結束改到 endSec（全域秒數）最近的那一格；太短、超出段尾、撞到人就擋。會切到拍點時跟 updateAction 一樣先問。 */
export function resizeAction(
	flow: Flow,
	id: string,
	endSec: number,
	options: ConfirmOption = {}
): CommandResult {
	const at = unitAt(flow, id, endSec);
	const action = flow.actions.find((a) => a.id === id);
	return at === null || !action
		? blocked('找不到這個動作')
		: updateAction(flow, id, { length: at - action.start }, options);
}

/** 全域秒數在動作那一段裡最近的整數時間（可以落在段外，交給檢查擋）。 */
function unitAt(flow: Flow, id: string, sec: number): number | null {
	const action = flow.actions.find((a) => a.id === id);
	const segment = action && flow.segments.find((s) => s.id === action.segmentId);
	if (!action || !segment) return null;
	const segStart = toSeconds(flow, { segmentId: segment.id, at: 0 });
	return Math.round((sec - segStart) / unitSec(segment));
}

/** 刪動作。有紀錄先回「要確認」，寫會清掉幾次；帶 { confirmed: true } 再送一次才刪。 */
export function deleteAction(flow: Flow, id: string, options: ConfirmOption = {}): CommandResult {
	const action = flow.actions.find((a) => a.id === id);
	if (!action) return blocked('找不到這個動作');
	const count = action.successRate?.records.length ?? 0;
	if (count && !answered(options)) return needsConfirm(`刪掉動作「${actionLabel(action)}」會清掉 ${count} 次紀錄`, []);
	return ok({ ...flow, actions: flow.actions.filter((a) => a.id !== id) });
}

/** 動作哪裡不行（給教練看的原因）；沒問題是 null。 */
function check(flow: Flow, action: Action): string | null {
	if (!ACTION_CATEGORIES.some((c) => c.key === action.category)) return '請選大類';
	const segment = flow.segments.find((s) => s.id === action.segmentId);
	if (!segment) return '找不到這一段';
	const music = segment.kind === 'music';
	if (!Number.isInteger(action.start) || !Number.isInteger(action.length)) {
		return music ? '音樂段的時間要落在半拍上' : '口號段的時間最細 0.1 秒';
	}
	if (action.start < 0) return '開始時間不能在段之前';
	if (action.length < 1) return music ? '動作長度至少要半拍' : '動作長度至少要 0.1 秒';
	if (action.start + action.length > units(segment)) return '動作不能跨段，要跨就拆成兩個';
	if (action.members.length === 0) return '一個動作至少要有 1 個人';
	for (const cue of action.cues ?? []) {
		const problem = cueProblem(segment, action, cue);
		if (problem) return problem;
	}
	const successRate = successRateProblem(segment, action);
	if (successRate) return successRate;
	const roles = roleGlossary(flow).map((r) => r.name);
	const seen = new Set<string>();
	for (const { memberId, role } of action.members) {
		if (!flow.members.some((m) => m.id === memberId)) return '找不到這個隊員';
		if (seen.has(memberId)) return '同一個人只能放一次';
		seen.add(memberId);
		if (role !== null && !roles.includes(role)) return `沒有「${role}」這個任務角色`;
	}
	for (const other of flow.actions) {
		if (other.id === action.id || !overlaps(other, action)) continue;
		const shared = action.members.find((m) => other.members.some((o) => o.memberId === m.memberId));
		if (shared) {
			return `${memberName(flow, shared.memberId)} 同一時間已經在「${actionLabel(other)}」裡`;
		}
	}
	return null;
}

/** 動作不能跨段，所以只有同一段、段內時間有交集才會重疊。 */
function overlaps(a: Action, b: Action): boolean {
	return a.segmentId === b.segmentId && a.start < b.start + b.length && b.start < a.start + a.length;
}

/** 在播放頭新增動作時預設的段和時間：從播放頭那一格開始，音樂段一個八拍、口號段 3 秒，不超出段尾。沒有段是 null。 */
export function actionSlotAt(
	flow: Flow,
	sec: number
): { segmentId: string; start: number; length: number } | null {
	const pos = toPosition(flow, sec);
	const segment = pos && flow.segments.find((s) => s.id === pos.segmentId);
	if (!pos || !segment) return null;
	const wanted = segment.kind === 'music' ? HALF_BEATS_PER_EIGHT : 30;
	return { segmentId: pos.segmentId, start: pos.at, length: Math.min(wanted, units(segment) - pos.at) };
}

/** 動作在全域秒數上的開始和結束（結束那一刻不算在動作裡）。 */
export function actionSeconds(flow: Flow, action: Action): { startSec: number; endSec: number } {
	const { segmentId, start, length } = action;
	return {
		startSec: toSeconds(flow, { segmentId, at: start }),
		endSec: toSeconds(flow, { segmentId, at: start + length })
	};
}

/** 某個隊員在這一刻（全域秒數）在哪個動作裡、任務角色是什麼；沒在動作裡是 null。 */
export function memberActionAt(
	flow: Flow,
	memberId: string,
	sec: number
): { action: Action; role: string | null } | null {
	const pos = toPosition(flow, sec);
	if (!pos) return null;
	for (const action of flow.actions) {
		if (action.segmentId !== pos.segmentId) continue;
		if (pos.at < action.start || pos.at >= action.start + action.length) continue;
		const member = action.members.find((m) => m.memberId === memberId);
		if (member) return { action, role: member.role };
	}
	return null;
}

/** 這一刻沒在任何動作裡的隊員 id，照名單順序。 */
export function idleAt(flow: Flow, sec: number): string[] {
	return flow.members.filter((m) => !memberActionAt(flow, m.id, sec)).map((m) => m.id);
}

/** 「沿用上一個動作的人」的候選：播放頭以前（含剛好在播放頭）結束的動作，越晚結束越前面；同時結束的，晚開始的在前。 */
export function previousActions(flow: Flow, sec: number): Action[] {
	return flow.actions
		.map((action) => ({ action, ...actionSeconds(flow, action) }))
		.filter((a) => a.endSec <= sec + EPS)
		.sort((a, b) => b.endSec - a.endSec || b.startSec - a.startSec)
		.map((a) => a.action);
}

/** 一鍵選人的組：全隊、全部底層、全部上層（看全局角色）、這一拍沒在動作裡的人。 */
export type MemberGroup = 'all' | 'base' | 'top' | 'idle';

/** 一鍵選人：那一組的隊員 id，照名單順序。sec 只有「這一拍沒在動作裡的人」用到。 */
export function memberGroup(flow: Flow, group: MemberGroup, sec: number): string[] {
	if (group === 'idle') return idleAt(flow, sec);
	return flow.members.filter((m) => group === 'all' || m.globalRole === group).map((m) => m.id);
}

/** 場上要畫在最上面的任務角色。 */
const RAISED_ROLES = ['上層', '中層'];

/** 這一刻任務角色是上層或中層的隊員 id（場上畫在最上面），照名單順序。看任務角色，不看全局角色。 */
export function raisedAt(flow: Flow, sec: number): string[] {
	return flow.members
		.filter((m) => RAISED_ROLES.includes(memberActionAt(flow, m.id, sec)?.role ?? ''))
		.map((m) => m.id);
}

/** 流程裡換掉這個動作（照 id 找）。 */
export function replaceAction(flow: Flow, action: Action): Flow {
	return { ...flow, actions: flow.actions.map((a) => (a.id === action.id ? action : a)) };
}

/** 給教練看的動作名字：「技巧·Lib」；沒取名就只有大類。 */
export function actionLabel(action: Action): string {
	const category = ACTION_CATEGORIES.find((c) => c.key === action.category)?.label ?? '';
	return action.name ? `${category}·${action.name}` : category;
}
