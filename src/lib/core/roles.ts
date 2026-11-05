// 任務角色：隊員在某個動作裡要做的事。11 個固定的 ＋ 這支流程自己加的。
// 跟全局角色互不影響；只有加人進動作時的預設值（defaultRoles）照全局角色先填。

import { actionLabel, type ActionCategory, type ActionMember } from './action-types';
import type { Flow } from './flow';
import { blocked, needsConfirm, ok, type CommandResult, type ConfirmOption } from './result';
import { nextId } from './ids';
import type { GlobalRole } from './members';
import { tooLong } from './text-length';

/** 教練自己加的任務角色，只存在這支流程裡。 */
export interface CustomRole {
	id: string;
	name: string;
	meaning: string;
}

/** 名詞對照表的一列。 */
export interface RoleEntry {
	name: string;
	meaning: string;
	/** 規則上的叫法；自訂角色是空字串。 */
	ruleName: string;
	custom: boolean;
}

/** 11 個固定任務角色，照規格（#15）的「任務角色名詞對照表」。 */
export const FIXED_ROLES: readonly RoleEntry[] = [
	['底層', '在下面撐住別人的人。不分主底、側底時用。', '底層人員'],
	['主底', '主要撐住上層腳的底層。單底層技巧的那位底層。', '底層人員（台灣規則沒有「主底」）'],
	['側底', '多底層技巧裡，在主底旁邊一起撐的底層。', '底層人員（台灣規則沒有「側底」）'],
	['上層', '被撐在最上面的人。', '上層人員'],
	['中層', '金字塔裡站在底層身上、又撐住上面的人的人。', '中層人員'],
	['保護', '站在旁邊保護上層，可扶腳踝、小腿、膝蓋，不能撐腳底，不算底層。', '保護人員（保護員）'],
	['前保', '站在上層前方的保護。', '前方保護人員'],
	['後保', '站在上層背後的人，技巧和籃型拋投都是。', '輔助人員（籃型拋投）；金字塔轉接寫「後保」'],
	['接者', '接住落下或被拋的上層的人。', '接者'],
	['支撐', '金字塔裡穩住別的上層的人。', '支撐者'],
	['騰翻', '做騰翻的人。', '騰翻人員']
].map(([name, meaning, ruleName]) => ({ name, meaning, ruleName, custom: false }));

/** 加一個自訂任務角色。名稱不能空、不能跟固定或自訂角色重複。 */
export function addCustomRole(flow: Flow, input: { name: string; meaning: string }): CommandResult {
	const name = input.name.trim();
	if (!name) return blocked('請填任務角色名稱');
	const tooLongName = tooLong('roleName', name);
	if (tooLongName) return blocked(tooLongName);
	if (roleGlossary(flow).some((r) => r.name === name)) return blocked(`已經有「${name}」這個任務角色了`);
	const id = nextId('r', flow.customRoles.map((r) => r.id));
	const role = { id, name, meaning: input.meaning.trim() };
	return ok({ ...flow, customRoles: [...flow.customRoles, role] });
}

/**
 * 改自訂任務角色的名稱、意思。名稱規則跟新增一樣（跟自己原本的名字一樣可以）。
 * 動作裡的人、給這個角色的拍點存的是名稱，一起改成新的。
 */
export function updateCustomRole(flow: Flow, id: string, input: { name: string; meaning: string }): CommandResult {
	const old = flow.customRoles.find((r) => r.id === id);
	if (!old) return blocked('找不到這個任務角色');
	const name = input.name.trim();
	if (!name) return blocked('請填任務角色名稱');
	const tooLongName = name !== old.name ? tooLong('roleName', name) : null;
	if (tooLongName) return blocked(tooLongName);
	if (name !== old.name && roleGlossary(flow).some((r) => r.name === name)) {
		return blocked(`已經有「${name}」這個任務角色了`);
	}
	const role = { id, name, meaning: input.meaning.trim() };
	const actions = flow.actions.map((a) => ({
		...a,
		members: a.members.map((m) => (m.role === old.name ? { ...m, role: name } : m)),
		...(a.cues && {
			cues: a.cues.map((c) => (c.who && 'role' in c.who && c.who.role === old.name ? { ...c, who: { role: name } } : c))
		})
	}));
	return ok({ ...flow, customRoles: flow.customRoles.map((r) => (r.id === id ? role : r)), actions });
}

/**
 * 刪自訂任務角色。有動作用到時先問（列出動作）；確定後那些人變成沒有任務，給這個角色的拍點刪掉。
 */
export function deleteCustomRole(flow: Flow, id: string, option: ConfirmOption = {}): CommandResult {
	const role = flow.customRoles.find((r) => r.id === id);
	if (!role) return blocked('找不到這個任務角色');
	const using = flow.actions.filter((a) => a.members.some((m) => m.role === role.name));
	if (using.length && !option.confirmed) {
		return needsConfirm(
			`「${role.name}」用在 ${using.length} 個動作裡：刪掉後那些人變成沒有任務，給「${role.name}」的拍點也會刪掉`,
			using.map(actionLabel)
		);
	}
	const actions = flow.actions.map((a) => ({
		...a,
		members: a.members.map((m) => (m.role === role.name ? { ...m, role: null } : m)),
		...(a.cues && { cues: a.cues.filter((c) => !(c.who && 'role' in c.who && c.who.role === role.name)) })
	}));
	return ok({ ...flow, customRoles: flow.customRoles.filter((r) => r.id !== id), actions });
}

/** 名詞對照表：固定的 11 個在前，這支流程的自訂角色接在後面。 */
export function roleGlossary(flow: Flow): RoleEntry[] {
	return [
		...FIXED_ROLES,
		...flow.customRoles.map((r) => ({ name: r.name, meaning: r.meaning, ruleName: '', custom: true }))
	];
}

/** 這個大類裡，全局角色是 globalRole 的人先填哪個任務角色；null 是不填。 */
function defaultRole(category: ActionCategory, globalRole: GlobalRole | undefined): string | null {
	if (category === 'tumbling') return '騰翻';
	if (category !== 'stunt' && category !== 'pyramid' && category !== 'toss') return null;
	if (!globalRole) return null;
	return globalRole === 'top' ? '上層' : '底層';
}

/**
 * 加人進動作時先填任務角色：技巧、金字塔、拋投照全局角色填底層或上層；騰翻填騰翻；跳躍、舞蹈、其他不填。
 * 沒有任務的人才填，已經指定的不動。
 * 給了 from（換大類）：還是 from 預設值的人（教練沒改過）換成這個大類的預設值，其他不動。
 */
export function defaultRoles<M extends ActionMember>(
	flow: Flow,
	category: ActionCategory,
	members: M[],
	from?: ActionCategory
): M[] {
	return members.map((m) => {
		const globalRole = flow.members.find((p) => p.id === m.memberId)?.globalRole;
		const untouched = from === undefined ? m.role === null : m.role === defaultRole(from, globalRole);
		return untouched ? { ...m, role: defaultRole(category, globalRole) } : m;
	});
}
