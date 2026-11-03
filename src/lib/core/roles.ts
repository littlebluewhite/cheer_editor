// 任務角色：隊員在某個動作裡要做的事。11 個固定的 ＋ 這支流程自己加的。
// 跟全局角色互不影響，所以這裡不看隊員的全局角色。

import type { Flow } from './flow';
import { blocked, ok, type CommandResult } from './result';
import { nextId } from './ids';

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
	if (roleGlossary(flow).some((r) => r.name === name)) return blocked(`已經有「${name}」這個任務角色了`);
	const id = nextId('r', flow.customRoles.map((r) => r.id));
	const role = { id, name, meaning: input.meaning.trim() };
	return ok({ ...flow, customRoles: [...flow.customRoles, role] });
}

/** 名詞對照表：固定的 11 個在前，這支流程的自訂角色接在後面。 */
export function roleGlossary(flow: Flow): RoleEntry[] {
	return [
		...FIXED_ROLES,
		...flow.customRoles.map((r) => ({ name: r.name, meaning: r.meaning, ruleName: '', custom: true }))
	];
}
