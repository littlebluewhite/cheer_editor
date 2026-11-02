// 隊員名單：加隊員、改隊員。

import { CELL_M, fieldGeometry, type FieldConfig } from './field';
import type { Flow } from './flow';
import type { Position } from './formation';
import { blocked, ok, type CommandResult } from './result';

/** 一支流程最多幾個隊員。 */
export const MAX_MEMBERS = 40;

export type Gender = 'F' | 'M';
/** 全局角色：底層或上層，教練自己選，不依性別帶入。 */
export type GlobalRole = 'base' | 'top';

export interface Member {
	id: string;
	/** 名字、暱稱或背號。候補上場就改名字。 */
	name: string;
	gender: Gender;
	globalRole: GlobalRole;
}

export interface NewMemberInput {
	name: string;
	/** 畫面上還沒選時是 null，由流程核心擋下。 */
	gender: Gender | null;
	globalRole: GlobalRole | null;
}

/** 一次加一個或多個隊員，排在名單最後。 */
export function addMembers(flow: Flow, inputs: NewMemberInput[]): CommandResult {
	if (flow.members.length + inputs.length > MAX_MEMBERS) {
		return blocked(`一支流程最多 ${MAX_MEMBERS} 人`);
	}
	const added: Member[] = [];
	let n = nextNumber(flow.members);
	for (const input of inputs) {
		const name = input.name.trim();
		const { gender, globalRole } = input;
		if (!name) return blocked('請填隊員名字');
		if (!gender) return blocked('請選性別');
		if (!globalRole) return blocked('請選全局角色');
		added.push({ id: `m${n++}`, name, gender, globalRole });
	}
	const spots = waitingSpots(flow.field);
	const formations = flow.formations.map((f) => {
		const pos = { ...f.pos };
		for (const m of added) pos[m.id] = freeSpot(spots, Object.values(pos));
		return { ...f, pos };
	});
	return ok({ ...flow, members: [...flow.members, ...added], formations });
}

export interface MemberChanges {
	name?: string;
	gender?: Gender;
	globalRole?: GlobalRole;
}

/** 改名字、性別或全局角色。id 不變，所以站位和動作都跟著這個人。 */
export function updateMember(flow: Flow, id: string, changes: MemberChanges): CommandResult {
	const member = flow.members.find((m) => m.id === id);
	if (!member) return blocked('找不到這個隊員');
	const updated = { ...member, ...changes, name: (changes.name ?? member.name).trim() };
	if (!updated.name) return blocked('請填隊員名字');
	return ok({ ...flow, members: flow.members.map((m) => (m.id === id ? updated : m)) });
}

/**
 * 新人等著被擺好的位置：正面那邊墊子外 1/4 格，從墊子左邊開始每半格一個，排成一排。
 * 都在吸附點上；半格（0.91 m）夠寬，點不會疊在一起。
 */
function waitingSpots(field: FieldConfig): Position[] {
	const { mat, cols } = fieldGeometry(field);
	const y = mat.y + mat.height + CELL_M / 4;
	return Array.from({ length: 2 * cols + 1 }, (_, j): Position => [mat.x + (j * CELL_M) / 2, y]);
}

/** 第一個沒人站的位置；全滿了就從頭疊上去。 */
function freeSpot(spots: Position[], taken: Position[]): Position {
	const free = spots.find((s) => !taken.some((t) => samePlace(s, t)));
	return free ?? spots[taken.length % spots.length];
}

function samePlace(a: Position, b: Position): boolean {
	return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
}

/** 下一個沒用過的 m 編號。 */
function nextNumber(members: Member[]): number {
	return Math.max(0, ...members.map((m) => Number(m.id.slice(1)) || 0)) + 1;
}
