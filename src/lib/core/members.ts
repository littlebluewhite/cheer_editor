// 隊員名單：加隊員、改隊員、刪隊員。

import { actionLabel, type Action } from './actions';
import { dropOrphanCues } from './cues';
import { CELL_M, fieldGeometry, type FieldConfig } from './field';
import type { Flow } from './flow';
import { withWalks, type Position } from './formation';
import { answered, blocked, needsChoice, needsConfirm, ok, type CommandResult, type ConfirmOption } from './result';
import { fitRecords, memberRecords, recordItems, withoutRecords } from './success-rate';
import { atText, segmentSpans } from './time';

/** 一支流程最多幾個隊員。 */
export const MAX_MEMBERS = 40;

export type Gender = 'F' | 'M';
/** 全局角色：底層或上層，教練自己選，不依性別帶入。 */
export type GlobalRole = 'base' | 'top';

/** 性別，流程檔存英文代號。 */
export const GENDERS: { key: Gender; label: string }[] = [
	{ key: 'F', label: '女' },
	{ key: 'M', label: '男' }
];

/** 全局角色，流程檔存英文代號。 */
export const GLOBAL_ROLES: { key: GlobalRole; label: string }[] = [
	{ key: 'base', label: '底層' },
	{ key: 'top', label: '上層' }
];

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

/**
 * 改名字、性別或全局角色。id 不變，所以站位和動作都跟著這個人。
 * 改名字（候補上場）而他有紀錄：先問保留還是清掉。帶 { records: 'keep' } 只改名字（改錯字）；
 * 帶 { records: 'clear' } 是真的換人了，連他在的每一組的紀錄（騰翻、跳躍是他自己的）一起清掉。
 */
export function updateMember(
	flow: Flow,
	id: string,
	changes: MemberChanges,
	options: ConfirmOption = {}
): CommandResult {
	const member = flow.members.find((m) => m.id === id);
	if (!member) return blocked('找不到這個隊員');
	const updated = { ...member, ...changes, name: (changes.name ?? member.name).trim() };
	if (!updated.name) return blocked('請填隊員名字');
	const mine = updated.name === member.name ? [] : flow.actions.filter((a) => memberRecords(a, id).length);
	if (mine.length && !answered(options)) {
		const count = mine.reduce((n, a) => n + memberRecords(a, id).length, 0);
		return needsChoice(
			`${member.name} 改名成「${updated.name}」，他在的組和他自己有 ${count} 次紀錄：只是改錯字就保留舊紀錄，換了人就清掉重算`,
			mine.flatMap((a) => recordItems(flow, a, memberRecords(a, id), `動作「${actionLabel(a)}」`))
		);
	}
	const actions =
		options.records === 'clear' ? flow.actions.map((a) => withoutRecords(a, memberRecords(a, id))) : flow.actions;
	return ok({ ...flow, members: flow.members.map((m) => (m.id === id ? updated : m)), actions });
}

/**
 * 刪隊員。一定先回「要確認」：「他在 N 個動作裡，其中 M 個會被整個刪掉」（有拍點會拿掉——給他的、和只剩他是那個角色的——再加「會一起拿掉 K 個拍點」），清單是那 M 個動作；
 * 帶 { confirmed: true } 再送一次才刪：從名單、每張站位、每個動作拿掉他，沒人剩下的動作刪掉，
 * 給他的拍點（和動作裡已經沒人做的角色的拍點）也拿掉。刪隊員當成真的換人：他在的每一組和他自己的紀錄都清掉，
 * 確認訊息寫會清掉幾次。
 */
export function deleteMember(
	flow: Flow,
	id: string,
	{ confirmed = false }: ConfirmOption = {}
): CommandResult {
	const member = flow.members.find((m) => m.id === id);
	if (!member) return blocked('找不到這個隊員');
	const inActions = flow.actions.filter((a) => a.members.some((m) => m.memberId === id));
	const emptied = inActions.filter((a) => a.members.length === 1);
	const actions = flow.actions
		.filter((a) => !emptied.includes(a))
		.map((a) => {
			const left = withoutRecords(a, memberRecords(a, id));
			return fitRecords(dropOrphanCues({ ...left, members: a.members.filter((m) => m.memberId !== id) }));
		});
	if (!confirmed) {
		const spans = segmentSpans(flow);
		const cueCount = (list: Action[]) => list.reduce((n, a) => n + (a.cues?.length ?? 0), 0);
		const dropped = cueCount(flow.actions.filter((a) => !emptied.includes(a))) - cueCount(actions);
		const records = (list: Action[]) => list.reduce((n, a) => n + (a.successRate?.records.length ?? 0), 0);
		const cleared = records(flow.actions) - records(actions);
		return needsConfirm(
			`${member.name} 在 ${inActions.length} 個動作裡，其中 ${emptied.length} 個會被整個刪掉` +
				(dropped ? `，會一起拿掉 ${dropped} 個拍點` : '') +
				(cleared ? `，會清掉 ${cleared} 次紀錄` : ''),
			emptied.map((a) => {
				const span = spans.find((s) => s.segment.id === a.segmentId)!;
				return `動作「${actionLabel(a)}」（${span.label} ${atText(span.segment, a.start)} 起）`;
			})
		);
	}
	return ok({
		...flow,
		members: flow.members.filter((m) => m !== member),
		formations: flow.formations.map((f) => {
			const pos = { ...f.pos };
			delete pos[id];
			const { [id]: _, ...walks } = f.walks ?? {};
			return withWalks({ ...f, pos }, walks);
		}),
		actions
	});
}

/** 標記用什麼：號碼（名單第幾個）或開頭字（名字的第一個字）。 */
export type MarkerStyle = 'number' | 'initial';

/** 換標記。 */
export function setMarkers(flow: Flow, markers: MarkerStyle): CommandResult {
	return ok({ ...flow, markers });
}

/** 每個隊員的標記（場上圓點、泳道、名單上寫的字）：隊員 id → 字。 */
export function memberMarkers(flow: Flow): Record<string, string> {
	if (flow.markers !== 'initial') {
		return Object.fromEntries(flow.members.map((m, i) => [m.id, String(i + 1)]));
	}
	// 名字是空的（手改過的檔案）就當成「?」，不讓畫面當掉。
	const chars = new Map(flow.members.map((m) => [m.id, Array.from(m.name.trim() || '?')]));
	const initial = (m: Member) => chars.get(m.id)![0].toUpperCase();
	const markers: Record<string, string> = {};
	for (const m of flow.members) {
		const group = flow.members.filter((o) => initial(o) === initial(m));
		if (group.length === 1) markers[m.id] = initial(m);
		else if (m === group[0]) Object.assign(markers, clashMarkers(group, chars));
	}
	return markers;
}

/**
 * 開頭字撞在一起的一群人：每人開頭字再帶名字後面第一個「群裡別人名字後面都沒有」的字
 * （王小明、王大華、王小美 → 王明、王大、王美），所以不會兩個人帶到同一個字。
 * 找不到（同名、名字只有一個字）就在開頭字後面加 1、2、3…，跳過已經被用掉的。
 */
function clashMarkers(group: Member[], chars: Map<string, string[]>): Record<string, string> {
	const head = chars.get(group[0].id)![0].toUpperCase();
	const rest = (m: Member) => chars.get(m.id)!.slice(1);
	const markers: Record<string, string> = {};
	const left: Member[] = [];
	for (const m of group) {
		const c = rest(m).find((c) => group.every((o) => o === m || !rest(o).includes(c)));
		if (c) markers[m.id] = head + c;
		else left.push(m);
	}
	const used = new Set(Object.values(markers));
	let n = 1;
	for (const m of left) {
		while (used.has(head + n)) n++;
		markers[m.id] = head + n++;
	}
	return markers;
}

/**
 * 新人等著被擺好的位置：墊子外半格、每 1/4 格一個，排成一排。從正面左邊的角開始往右排到墊子右邊外，
 * 排滿了從那個角沿著左邊往後排。都在吸附點上、在墊子外 1 m 以內。
 * 最小的場地（1 條）也有 4 ×（左右格數 ＋ 前後格數）＋ 9 = 41 個位置，比 40 人多，所以一定有空位。
 */
function waitingSpots(field: FieldConfig): Position[] {
	const { mat, cols, rows } = fieldGeometry(field);
	const step = CELL_M / 4;
	const left = mat.x - 2 * step;
	const front = mat.y + mat.height + 2 * step;
	const alongFront = Array.from({ length: 4 * cols + 5 }, (_, j): Position => [left + j * step, front]);
	const upLeft = Array.from({ length: 4 * rows + 4 }, (_, j): Position => [left, front - (j + 1) * step]);
	return [...alongFront, ...upLeft];
}

/** 第一個沒人站的位置。最多 40 人、位置至少 41 個，所以一定找得到。 */
function freeSpot(spots: Position[], taken: Position[]): Position {
	return spots.find((s) => !taken.some((t) => samePlace(s, t)))!;
}

function samePlace(a: Position, b: Position): boolean {
	return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
}

/** 下一個沒用過的 m 編號。 */
function nextNumber(members: Member[]): number {
	return Math.max(0, ...members.map((m) => Number(m.id.slice(1)) || 0)) + 1;
}
