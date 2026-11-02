// 動作：一組隊員在一個段裡一起做的一件事。時間存段 ＋ 段內整數時間
// （音樂段是第幾個半拍，口號段是第幾個 0.1 秒），不存全域秒數。

import type { Flow } from './flow';
import { blocked, ok, type CommandResult } from './result';
import { roleGlossary } from './roles';
import { nextId } from './segment';
import { toPosition, toSeconds, units } from './time';

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
}

export type NewActionInput = Omit<Action, 'id'>;

export function addAction(flow: Flow, input: NewActionInput): CommandResult {
	const action = normalize({ id: nextId('x', flow.actions.map((a) => a.id)), ...input });
	const problem = check(flow, action);
	if (problem) return blocked(problem);
	return ok({ ...flow, actions: [...flow.actions, action] });
}

/** 名稱去掉頭尾空白；人複製一份，不跟呼叫端共用物件。 */
function normalize(action: Action): Action {
	return { ...action, name: action.name.trim(), members: action.members.map((m) => ({ ...m })) };
}

/** 改動作的任何欄位（含換段、換人），照新增的規則檢查。 */
export function updateAction(
	flow: Flow,
	id: string,
	changes: Partial<NewActionInput>
): CommandResult {
	const old = flow.actions.find((a) => a.id === id);
	if (!old) return blocked('找不到這個動作');
	const action = normalize({ ...old, ...changes, id });
	const problem = check(flow, action);
	if (problem) return blocked(problem);
	return ok({ ...flow, actions: flow.actions.map((a) => (a.id === id ? action : a)) });
}

export function deleteAction(flow: Flow, id: string): CommandResult {
	if (!flow.actions.some((a) => a.id === id)) return blocked('找不到這個動作');
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
			const name = flow.members.find((m) => m.id === shared.memberId)?.name ?? shared.memberId;
			return `${name} 同一時間已經在「${actionLabel(other)}」裡`;
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
	const wanted = segment.kind === 'music' ? 16 : 30;
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

/** 場上要畫在最上面的任務角色。 */
const RAISED_ROLES = ['上層', '中層'];

/** 這一刻任務角色是上層或中層的隊員 id（場上畫在最上面），照名單順序。看任務角色，不看全局角色。 */
export function raisedAt(flow: Flow, sec: number): string[] {
	return flow.members
		.filter((m) => RAISED_ROLES.includes(memberActionAt(flow, m.id, sec)?.role ?? ''))
		.map((m) => m.id);
}

/** 給教練看的動作名字：「技巧·Lib」；沒取名就只有大類。 */
export function actionLabel(action: Action): string {
	const category = ACTION_CATEGORIES.find((c) => c.key === action.category)?.label ?? '';
	return action.name ? `${category}·${action.name}` : category;
}
