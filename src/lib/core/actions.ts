// 動作的指令：加、改、拖、拉、刪、檢查。動作的型別和小工具在 action-types.ts。

import {
	ACTION_CATEGORIES,
	actionLabel,
	actionSeconds,
	replaceAction,
	type Action,
	type ActionChanges,
	type NewActionInput
} from './action-types';
import { cueFallout, cueProblem } from './cues';
import { memberName, type Flow } from './flow';
import { answered, blocked, needsConfirm, ok, type CommandResult, type ConfirmOption } from './result';
import { roleGlossary } from './roles';
import { falloutQuestion, settle, type Settled } from './settle';
import { squadProblem } from './success-rate';
import { nextId } from './ids';
import { EPS, HALF_BEATS_PER_EIGHT, toPosition, toSeconds, unitSec, units } from './time';

/** 新增動作，回傳新動作的 id。 */
export function addAction(flow: Flow, input: NewActionInput): CommandResult<{ id: string }> {
	const id = nextId('x', flow.actions.map((a) => a.id));
	const members = input.members.map(({ memberId, role }) => ({ memberId, role }));
	const settled = checked(flow, undefined, normalize({ id, ...input, members }), {});
	if (settled.kind === 'blocked') return settled;
	return { kind: 'ok', flow: { ...flow, actions: [...flow.actions, settled.action] }, id };
}

/** 名稱去掉頭尾空白；人複製一份，不跟呼叫端共用物件；辨識色是空的就不留欄位（用大類的顏色）。組和紀錄交給收尾（settle）。 */
function normalize({ color, ...action }: Action): Action {
	return {
		...action,
		...(color ? { color } : {}),
		name: action.name.trim(),
		members: action.members.map((m) => ({ ...m }))
	};
}

/**
 * 改動作的任何欄位（含換段、換人），照新增的規則檢查。
 * 變短會切到拍點、有拍點的動作換到口號段、或拿掉的人（任務角色）有拍點給他時，回「要確認」並列出那些拍點；
 * 帶 { confirmed: true } 再送一次才切短、拿掉。
 * 會動到紀錄時也先問（換大類讓算法變了、組沒人了、騰翻跳躍拿掉人：要確認；有紀錄的組換了人：選保留舊紀錄或清掉重算），
 * 跟拍點一起問；帶 { confirmed: true } 或 { records } 再送一次。環節、組、紀錄怎麼收見 settle。
 */
export function updateAction(
	flow: Flow,
	id: string,
	changes: ActionChanges,
	options: ConfirmOption = {}
): CommandResult {
	const old = flow.actions.find((a) => a.id === id);
	if (!old) return blocked('找不到這個動作');
	let action = normalize({ ...old, ...changes, id });
	const from = flow.segments.find((s) => s.id === old.segmentId);
	const to = flow.segments.find((s) => s.id === action.segmentId);
	const cues = from && to ? cueFallout(from, to, old, action, flow) : null;
	if (cues) action = { ...action, cues: cues.cues };
	const settled = checked(flow, old, action, options);
	if (settled.kind === 'blocked') return settled;
	return (
		falloutQuestion(flow, old, settled.action, cues, settled.fallout, options) ??
		ok(replaceAction(flow, settled.action))
	);
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

/**
 * 設組：給動作裡的隊員（可以一次好幾個）第幾組（1 起）；null 是沒分組。一次給好幾個人也是一個指令（復原一步）。
 * 做完組號補成 1、2、3 不跳號。有紀錄的組換了人，先問保留舊紀錄還是清掉重算；組裡的人都換走了，只問會清掉幾次（見 settle）。
 */
export function setSquad(
	flow: Flow,
	actionId: string,
	memberIds: string[],
	squad: number | null,
	options: ConfirmOption = {}
): CommandResult {
	const action = flow.actions.find((a) => a.id === actionId);
	if (!action || !flow.segments.some((s) => s.id === action.segmentId)) return blocked('找不到這個動作');
	if (memberIds.some((id) => !action.members.some((m) => m.memberId === id))) return blocked('這個隊員不在動作裡');
	const problem = squad === null ? null : squadProblem(action, squad);
	if (problem) return blocked(problem);
	const members = action.members.map((m) => {
		if (!memberIds.includes(m.memberId)) return m;
		const { squad: _, ...rest } = m;
		return squad === null ? rest : { ...rest, squad };
	});
	const settled = settle(flow, action, { ...action, members }, options);
	if (settled.kind === 'blocked') return settled;
	return (
		falloutQuestion(flow, action, settled.action, null, settled.fallout, options) ??
		ok(replaceAction(flow, settled.action))
	);
}

/** 檢查動作、收尾：大類、段、時間、拍點先檢查，再收尾（成功率規則在裡面），最後檢查人。 */
function checked(flow: Flow, before: Action | undefined, action: Action, options: ConfirmOption): Settled {
	const shape = shapeProblem(flow, action);
	if (shape) return { kind: 'blocked', message: shape };
	const settled = settle(flow, before, action, options);
	if (settled.kind === 'blocked') return settled;
	const people = peopleProblem(flow, settled.action);
	return people ? { kind: 'blocked', message: people } : settled;
}

/** 動作的大類、段、時間、拍點哪裡不行（給教練看的原因）；沒問題是 null。 */
function shapeProblem(flow: Flow, action: Action): string | null {
	if (!ACTION_CATEGORIES.some((c) => c.key === action.category)) return '請選大類';
	const segment = flow.segments.find((s) => s.id === action.segmentId);
	if (!segment) return '找不到這一段';
	const music = segment.kind === 'music';
	if (!Number.isInteger(action.start) || !Number.isInteger(action.length)) {
		return music ? '音樂段的時間要落在半拍上' : '口號段的時間最細 0.1 秒';
	}
	if (action.start < 0) return '動作的開始不能在段之前';
	if (action.length < 1) return music ? '動作長度至少要半拍' : '動作長度至少要 0.1 秒';
	if (action.start + action.length > units(segment)) return '動作不能跨段，要跨就拆成兩個';
	if (action.members.length === 0) return '一個動作至少要有 1 個人';
	for (const cue of action.cues ?? []) {
		const problem = cueProblem(segment, action, cue);
		if (problem) return problem;
	}
	return null;
}

/** 動作裡的人哪裡不行（找不到、重複、沒有這個任務角色、同一時間在別的動作裡）；沒問題是 null。 */
function peopleProblem(flow: Flow, action: Action): string | null {
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
