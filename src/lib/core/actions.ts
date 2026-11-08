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
import { RECORDS_UNDOABLE, answered, blocked, needsConfirm, ok, type CommandResult, type ConfirmOption } from './result';
import { roleGlossary } from './roles';
import { falloutQuestion, settle, type CueFallout, type Settled } from './settle';
import { allSquadIds, squadProblem, squadsOf } from './success-rate';
import { freshIds, nextId } from './ids';
import { tooLong } from './text-length';
import { atTextWithUnit, EPS, HALF_BEATS_PER_EIGHT, lengthText, lengthTextWithUnit, sizeText, toPosition, toSeconds, unitSec, units } from './time';

/** 新增動作，回傳新動作的 id。人可以帶著別的動作的組（從別的動作複製人）：照號碼對，發新的組 id（見 settle）。 */
export function addAction(flow: Flow, input: NewActionInput): CommandResult<{ id: string }> {
	const id = nextId('x', flow.actions.map((a) => a.id));
	// 組只認別的動作的組（從別的動作複製人），收尾照號碼換成這個動作自己的組；其他的不收。
	const others = allSquadIds(flow);
	const members = input.members.map(({ memberId, role, squad }) => ({
		memberId,
		role,
		...(squad !== undefined && others.includes(squad) && { squad })
	}));
	const settled = checked(flow, undefined, normalize({ id, ...input, members }), {});
	if (settled.kind === 'blocked') return settled;
	return { kind: 'ok', flow: { ...settled.flow, actions: [...flow.actions, settled.action] }, id };
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
	const r = changeAction(flow, id, changes, options);
	if (r.kind === 'blocked') return r;
	return falloutQuestion(flow, r.old, r.action, r.cues, r.fallout, options) ?? ok(replaceAction(r.flow, r.action));
}

/**
 * updateAction 還沒問之前的那一步：改好、檢查、收好的動作（還沒換進流程）和拍點、環節、紀錄的後果。
 * 段縮短裁短動作時用它拿後果組確認清單，不用再算一次。
 */
export function changeAction(
	flow: Flow,
	id: string,
	changes: ActionChanges,
	options: ConfirmOption = {}
): (Settled & { kind: 'ok'; old: Action; cues: CueFallout | null }) | (Settled & { kind: 'blocked' }) {
	const old = flow.actions.find((a) => a.id === id);
	if (!old) return { kind: 'blocked', message: '找不到這個動作' };
	let action = normalize({ ...old, ...changes, id });
	const from = flow.segments.find((s) => s.id === old.segmentId);
	const to = flow.segments.find((s) => s.id === action.segmentId);
	const cues = from && to ? cueFallout(from, to, old, action, flow) : null;
	if (cues) action = { ...action, cues: cues.cues };
	const settled = checked(flow, old, action, options);
	return settled.kind === 'blocked' ? settled : { ...settled, old, cues };
}

/**
 * 拖色條：把動作的開始移到 startSec（全域秒數）最近的那一格，留在原來那一段；拖過段尾就裁短到段尾。
 * 開始拖到段尾後面、段之前、撞到人就擋。要確認時（裁短切到拍點、環節）跟 updateAction 一樣。
 */
export function moveAction(
	flow: Flow,
	id: string,
	startSec: number,
	options: ConfirmOption = {}
): CommandResult {
	const at = unitAt(flow, id, startSec);
	const action = flow.actions.find((a) => a.id === id);
	if (at === null || !action) return blocked('找不到這個動作');
	const end = segmentEnd(flow, action);
	const length = at < end ? Math.min(action.length, end - at) : action.length;
	return updateAction(flow, id, { start: at, length }, options);
}

/** 拉色條右邊：把動作的結束改到 endSec（全域秒數）最近的那一格，拉過段尾就停在段尾；太短、撞到人就擋。會切到拍點時跟 updateAction 一樣先問。 */
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
		: updateAction(flow, id, { length: Math.min(at, segmentEnd(flow, action)) - action.start }, options);
}

/** 動作那一段的段尾（段內時間）。 */
function segmentEnd(flow: Flow, action: Action): number {
	return units(flow.segments.find((s) => s.id === action.segmentId)!);
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
	if (count && !answered(options)) return needsConfirm(`刪掉動作「${actionLabel(action)}」會清掉 ${count} 次紀錄${RECORDS_UNDOABLE}`, []);
	return ok({ ...flow, actions: flow.actions.filter((a) => a.id !== id) });
}

/**
 * 設組：給動作裡的隊員（可以一次好幾個）第幾組（1 起，照現在算的組號）；比現有的組多就是新的一組（發新的組 id）；null 是沒分組。
 * 一次給好幾個人也是一個指令（復原一步）。組空掉，後面的組號自然往前補，紀錄還是指到原來的組 id。
 * 有紀錄的組換了人，先問保留舊紀錄還是清掉重算；組裡的人都換走了，只問會清掉幾次（見 settle）。
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
	const own = squadsOf(action);
	const issued = squad === null || squad <= own.length ? null : freshIds('g', 1, flow.lastIds, allSquadIds(flow));
	const id = squad === null ? null : (own[squad - 1] ?? issued!.ids[0]);
	const members = action.members.map((m) => {
		if (!memberIds.includes(m.memberId)) return m;
		const { squad: _, ...rest } = m;
		return id === null ? rest : { ...rest, squad: id };
	});
	const settled = settle(issued ? { ...flow, lastIds: issued.lastIds } : flow, action, { ...action, members }, options);
	if (settled.kind === 'blocked') return settled;
	return (
		falloutQuestion(flow, action, settled.action, null, settled.fallout, options) ??
		ok(replaceAction(settled.flow, settled.action))
	);
}

/** 檢查動作、收尾：大類、段、時間、拍點先檢查，再收尾（成功率規則在裡面），最後檢查人。 */
function checked(flow: Flow, before: Action | undefined, action: Action, options: ConfirmOption): Settled {
	const shape = textProblem(before, action) ?? shapeProblem(flow, action);
	if (shape) return { kind: 'blocked', message: shape };
	const settled = settle(flow, before, action, options);
	if (settled.kind === 'blocked') return settled;
	const people = peopleProblem(flow, settled.action);
	return people ? { kind: 'blocked', message: people } : settled;
}

/** 名稱、備註太長；開檔進來就超過上限的照收，改了不能更長（N08）。 */
function textProblem(before: Action | undefined, action: Action): string | null {
	return tooLong('actionName', action.name, before?.name) ?? tooLong('note', action.note, before?.note);
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
	if (action.length < 1) {
		const max = lengthText(segment, Math.max(1, units(segment) - action.start));
		return `動作長度要在 ${lengthText(segment, 1)} 到 ${max} ${music ? '拍' : '秒'}之間`;
	}
	if (action.start >= units(segment)) return `動作的開始在段外：這段只有 ${sizeText(segment)}`;
	if (action.start + action.length > units(segment)) {
		// 最後一段後面沒有段可以拆：寫還剩多長。
		const room = units(segment) - action.start;
		if (flow.segments.at(-1) !== segment || room < 1) return '動作不能跨段，要跨就拆成兩個';
		return `超過這段的結尾，最多 ${lengthTextWithUnit(segment, room)}`;
	}
	if (action.members.length === 0) return '一個動作至少要有 1 個人';
	for (const cue of action.cues ?? []) {
		const problem = cueProblem(segment, action, cue);
		if (problem) return problem;
	}
	return null;
}

/**
 * 動作裡的人哪裡不行（找不到、重複、沒有這個任務角色、同一時間在別的動作裡）；沒問題是 null。
 * 重疊時寫撞到的動作在哪裡結束（在前面的）或從哪裡開始（在後面的），教練知道要挪到哪裡。
 */
function peopleProblem(flow: Flow, action: Action): string | null {
	const roles = roleGlossary(flow).map((r) => r.name);
	const seen = new Set<string>();
	for (const { memberId, role } of action.members) {
		if (!flow.members.some((m) => m.id === memberId)) return '找不到這個隊員';
		if (seen.has(memberId)) return '同一個人只能放一次';
		seen.add(memberId);
		if (role !== null && !roles.includes(role)) return `沒有「${role}」這個任務角色`;
	}
	// 列出所有重疊的人（照撞到的動作分開寫），教練一次改完。
	const clashes: string[] = [];
	for (const other of flow.actions) {
		if (other.id === action.id || !overlaps(other, action)) continue;
		const shared = action.members.filter((m) => other.members.some((o) => o.memberId === m.memberId));
		if (shared.length) {
			const names = shared.map((m) => memberName(flow, m.memberId)).join('、');
			clashes.push(`${names} 同一時間已經在「${actionLabel(other)}」裡：${whereOther(flow, other, action)}`);
		}
	}
	return clashes.length ? clashes.join('；') : null;
}

/** 撞到的動作 other 在 action 前面：「上一個動作在 3-1& 才結束」；在後面：「下一個動作從 4-1 就開始」。 */
function whereOther(flow: Flow, other: Action, action: Action): string {
	const segment = flow.segments.find((s) => s.id === other.segmentId)!;
	// 音樂段「2-1& 才結束」，口號段「3.5 秒 才結束」
	return other.start <= action.start
		? `上一個動作在 ${atTextWithUnit(segment, other.start + other.length)} 才結束`
		: `下一個動作從 ${atTextWithUnit(segment, other.start)} 就開始`;
}

/** 動作不能跨段，所以只有同一段、段內時間有交集才會重疊。 */
function overlaps(a: ActionSlot, b: ActionSlot): boolean {
	return a.segmentId === b.segmentId && a.start < b.start + b.length && b.start < a.start + a.length;
}

/** 動作佔的段和時間。 */
type ActionSlot = Pick<Action, 'segmentId' | 'start' | 'length'>;

/**
 * 這段時間裡已經在別的動作裡的人（選人時標出來、一次拿掉）：隊員 id → 他在的那個動作。
 * id 是正在改的動作自己，不算。
 */
export function busyMembers(flow: Flow, slot: ActionSlot & { id?: string }): Map<string, Action> {
	const busy = new Map<string, Action>();
	for (const other of flow.actions) {
		if (other.id === slot.id || !overlaps(other, slot)) continue;
		for (const m of other.members) if (!busy.has(m.memberId)) busy.set(m.memberId, other);
	}
	return busy;
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
