// 任務角色：隊員在某個動作裡要做的事。13 個固定的 ＋ 這支流程自己加的。
// 跟全局角色互不影響；只有加人進動作時的預設值（defaultRoles）照全局角色先填。

import { actionLabel, type ActionCategory, type ActionMember } from './action-types';
import type { Flow } from './flow';
import { blocked, needsConfirm, ok, type CommandResult, type ConfirmOption } from './result';
import { newId } from './ids';
import type { GlobalRole } from './members';
import { tooLong } from './text-length';
import type { Why, WhyCode, WhyParam } from './why';

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
	/** 第幾群（選單裡群和群中間畫線）：0 撐人的、1 被撐的、2 保護的、3 其他，自訂角色是 4。 */
	group: number;
}

/** 任務角色選單裡的一項：多了快捷鍵（超過的角色是空字串）。 */
export interface PickableRole extends RoleEntry {
	key: string;
}

/**
 * 13 個固定任務角色，照規格（#15）的「任務角色名詞對照表」，分四群：撐人的、被撐的、保護的、其他。
 * 快捷鍵照這個順序，跟著角色固定（docs/superpowers/specs/2026-11-19-shoulder-base-people-list-design.md）。
 */
export const FIXED_ROLES: readonly RoleEntry[] = [
	[
		['底層', '在下面撐住別人的人。不想分主底、側底、肩底時用。', '底層人員'],
		['主底', '主要撐住上層腳的底層。單底層技巧的那位底層。', '底層人員（台灣規則沒有「主底」）'],
		['側底', '多底層技巧裡，在主底旁邊一起撐的底層。', '底層人員（台灣規則沒有「側底」）'],
		['肩底', '金字塔裡站在地上、讓中層站在自己肩上的底層。只有金字塔有。', '底層人員（規則沒有「肩底」）']
	],
	[
		['上層', '被底層撐起來、離開地面的人。只講「上層」時，指撐在底層上、沒有再撐別人的人。', '上層人員'],
		['中層', '金字塔裡站在底層身上、又撐住三層的人。', '中層人員'],
		['三層', '金字塔裡站在中層身上、最上面的人。只有金字塔有。', '3 層人員、3 層隊員'],
		['支撐', '金字塔裡自己也被撐著、伸手穩住別的上層的人。', '支撐者']
	],
	[
		['保護', '站在旁邊保護上層，可扶腳踝、小腿、膝蓋，不能撐腳底，不算底層。', '保護人員（保護員）'],
		['前保', '站在上層前方的保護。', '前方保護人員'],
		['後保', '站在上層背後的人，技巧和籃型拋投都是。', '輔助人員（籃型拋投）；金字塔轉接寫「後保」'],
		['接者', '接住落下或被拋的上層的人。', '接者']
	],
	[['騰翻', '做騰翻的人。', '騰翻人員']]
].flatMap((rows, group) => rows.map(([name, meaning, ruleName]) => ({ name, meaning, ruleName, custom: false, group })));

/** 固定任務角色的代號（流程檔存中文名，畫面照語言寫，見 why.ts）。 */
const FIXED_ROLE_CODES = new Map<string, WhyCode>([
	['底層', 'role_base'],
	['主底', 'role_main_base'],
	['側底', 'role_side_base'],
	['肩底', 'role_shoulder_base'],
	['上層', 'role_top'],
	['中層', 'role_middle'],
	['三層', 'role_third'],
	['支撐', 'role_bracer'],
	['保護', 'role_spotter'],
	['前保', 'role_front_spot'],
	['後保', 'role_back_spot'],
	['接者', 'role_catcher'],
	['騰翻', 'role_tumbler']
]);

/** 任務角色的名字放進原因：固定的送代號（畫面照語言寫），自訂的照教練取的名字。 */
export function roleWhy(name: string): WhyParam {
	const code = FIXED_ROLE_CODES.get(name);
	return code ? { code } : name;
}

/** 自訂任務角色的群：接在固定的後面。 */
const CUSTOM_GROUP = 4;

/** 任務角色的快捷鍵，照名詞對照表的順序；超過的角色沒有快捷鍵。 */
const ROLE_KEYS = '1234567890qwertyuiop';

/** 加一個自訂任務角色。名稱不能空、不能跟固定或自訂角色重複、不能跟隊員同名。 */
export function addCustomRole(flow: Flow, input: { name: string; meaning: string }): CommandResult {
	const name = input.name.trim();
	if (!name) return blocked({ code: 'roles_no_name' });
	const tooLongName = tooLong('roleName', name);
	if (tooLongName) return blocked(tooLongName);
	if (roleGlossary(flow).some((r) => r.name === name)) return blocked({ code: 'roles_name_taken', name });
	if (isMemberName(flow, name)) return blocked(memberNameTaken(name));
	const id = newId('r', flow.customRoles.map((r) => r.id));
	const role = { id, name, meaning: input.meaning.trim() };
	return ok({ ...flow, customRoles: [...flow.customRoles, role] });
}

/**
 * 改自訂任務角色的名稱、意思。名稱規則跟新增一樣（跟自己原本的名字一樣可以，開檔進來就跟隊員同名的也留著）。
 * 動作裡的人、給這個角色的拍點存的是名稱，一起改成新的。
 */
export function updateCustomRole(flow: Flow, id: string, input: { name: string; meaning: string }): CommandResult {
	const old = flow.customRoles.find((r) => r.id === id);
	if (!old) return blocked({ code: 'roles_not_found' });
	const name = input.name.trim();
	if (!name) return blocked({ code: 'roles_no_name' });
	const tooLongName = tooLong('roleName', name, old.name);
	if (tooLongName) return blocked(tooLongName);
	if (name !== old.name && roleGlossary(flow).some((r) => r.name === name)) {
		return blocked({ code: 'roles_name_taken', name });
	}
	if (name !== old.name && isMemberName(flow, name)) return blocked(memberNameTaken(name));
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
	if (!role) return blocked({ code: 'roles_not_found' });
	const using = flow.actions.filter((a) => a.members.some((m) => m.role === role.name));
	if (using.length && !option.confirmed) {
		const code = using.length === 1 ? 'roles_delete_used_one' : 'roles_delete_used';
		return needsConfirm({ code, name: role.name, count: using.length }, using.map(actionLabel));
	}
	const actions = flow.actions.map((a) => ({
		...a,
		members: a.members.map((m) => (m.role === role.name ? { ...m, role: null } : m)),
		...(a.cues && { cues: a.cues.filter((c) => !(c.who && 'role' in c.who && c.who.role === role.name)) })
	}));
	return ok({ ...flow, customRoles: flow.customRoles.filter((r) => r.id !== id), actions });
}

/** 有隊員叫這個名字：拍點的「給誰」會有兩個一樣的選項，分不出是角色還是人。 */
function isMemberName(flow: Flow, name: string): boolean {
	return flow.members.some((m) => m.name === name);
}

function memberNameTaken(name: string): Why {
	return { code: 'roles_member_name_taken', name };
}

/** 名詞對照表：固定的 13 個在前，這支流程的自訂角色接在後面。 */
export function roleGlossary(flow: Flow): RoleEntry[] {
	return [
		...FIXED_ROLES,
		...flow.customRoles.map((r) => ({ name: r.name, meaning: r.meaning, ruleName: '', custom: true, group: CUSTOM_GROUP }))
	];
}

/** 只有金字塔有的任務角色。 */
const PYRAMID_ONLY = new Set(['三層', '肩底']);

/**
 * 任務角色選單裡的角色：名詞對照表，三層、肩底只有金字塔有。
 * used（這個人現在的任務角色）是三層、肩底時照列：換了大類，他自己的選單看得到、選得回來。
 * 快捷鍵照名詞對照表的位置給，不照選單：每個大類同一個鍵都是同一個角色。
 */
export function pickableRoles(flow: Flow, category: ActionCategory, used: (string | null)[]): PickableRole[] {
	return roleGlossary(flow)
		.map((r, i) => ({ ...r, key: ROLE_KEYS[i] ?? '' }))
		.filter((r) => r.custom || !PYRAMID_ONLY.has(r.name) || category === 'pyramid' || used.includes(r.name));
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
