// 隊員名單：加隊員、改隊員、排順序、刪隊員。

import { actionLabel, type Action } from './action-types';
import { dropOrphanCues } from './cues';
import { CELL_M, fieldGeometry, type FieldConfig } from './field';
import type { Flow } from './flow';
import { withWalks, type Position } from './formation';
import { answered, blocked, needsChoice, needsConfirm, ok, type CommandResult, type ConfirmOption } from './result';
import { settle } from './settle';
import { perPerson, recordItems, type Attempt } from './success-rate';
import { tooLong } from './text-length';
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

/** 加隊員多帶的結果：沒加進去的那幾行的原因，和那幾行原本的字（畫面留在輸入框給教練改）。 */
export interface AddMembersResult {
	errors: string[];
	rejected: string[];
}

/** 一個要加的人：畫面上的字（rejected 用）、錯的時候寫在哪（「第 2 行」），和讀出來的人或錯誤。 */
interface Entry {
	text: string;
	where: string;
	name: string;
	input: NewMemberInput | null;
	problems: string[];
}

/**
 * 一次加一個或多個隊員，排在名單最後。見 addEntries。
 */
export function addMembers(flow: Flow, inputs: NewMemberInput[]): CommandResult<AddMembersResult> {
	return addEntries(
		flow,
		inputs.map((input, i) => ({ text: input.name, where: `第 ${i + 1} 個`, name: input.name.trim(), input, problems: [] }))
	);
}

/**
 * 貼上的名單加隊員：每一行是「名字」（用表單選的性別、全局角色）或「名字<Tab>性別<Tab>全局角色」
 * （性別認男、女；全局角色認底層、上層）。空行跳過。見 addEntries。
 */
export function addMemberLines(
	flow: Flow,
	text: string,
	defaults: { gender: Gender | null; globalRole: GlobalRole | null }
): CommandResult<AddMembersResult> {
	const entries = text.split('\n').flatMap((line, i): Entry[] => {
		if (!line.trim()) return [];
		const cols = line.split('\t').map((c) => c.trim());
		const entry: Entry = { text: line, where: `第 ${i + 1} 行`, name: cols[0], input: null, problems: [] };
		if (cols.length === 1) entry.input = { name: cols[0], ...defaults };
		else if (cols.length !== 3) entry.problems.push('一行寫一個名字，或「名字、性別、全局角色」三欄（用 Tab 隔開）');
		else {
			const gender = GENDERS.find((g) => g.label === cols[1])?.key ?? null;
			const globalRole = GLOBAL_ROLES.find((r) => r.label === cols[2])?.key ?? null;
			if (!gender) entry.problems.push('性別要寫「男」或「女」');
			if (!globalRole) entry.problems.push('全局角色要寫「底層」或「上層」');
			if (gender && globalRole) entry.input = { name: cols[0], gender, globalRole };
		}
		return [entry];
	});
	return addEntries(flow, entries);
}

/**
 * 有錯的人（沒名字、名字太長、沒選性別或全局角色、認不得的行）不加，所有錯一次列在 errors，其他人照加；
 * 一個都加不了就擋下，原因是所有錯（一行一個）。只有一個人時錯誤不寫第幾個。
 * 加了會超過 MAX_MEMBERS 人就一個都不加，原因寫還能加幾人。
 * 新人排進開頭那張站位最靠近場地中間的空格點（不跟現有的人疊到），後面的站位用同一個位置；格點都有人了才排場外。
 */
function addEntries(flow: Flow, entries: Entry[]): CommandResult<AddMembersResult> {
	if (!entries.length) return blocked('請填隊員名字');
	for (const e of entries) {
		if (!e.input) continue;
		const { name, gender, globalRole } = e.input;
		const problem = memberNameProblem(name.trim());
		if (problem) e.problems.push(problem);
		if (!gender) e.problems.push('請選性別');
		if (!globalRole) e.problems.push('請選全局角色');
	}
	const bad = entries.filter((e) => e.problems.length);
	const errors = bad.map((e) =>
		entries.length === 1 ? e.problems.join('；') : `${e.where}「${e.name}」：${e.problems.join('；')}`
	);
	const left = MAX_MEMBERS - flow.members.length;
	if (entries.length > left) {
		errors.push(
			left ? `一支流程最多 ${MAX_MEMBERS} 人，這次加 ${entries.length} 人，只能再加 ${left} 人` : `一支流程最多 ${MAX_MEMBERS} 人，已經滿了`
		);
	}
	if (bad.length === entries.length || entries.length > left) return blocked(errors.join('\n'));

	const added: Member[] = [];
	let n = nextNumber(flow.members);
	for (const e of entries) {
		if (e.problems.length) continue;
		const { name, gender, globalRole } = e.input!;
		added.push({ id: `m${n++}`, name: name.trim(), gender: gender!, globalRole: globalRole! });
	}
	const opening = { ...flow.formations[0].pos };
	const grid = gridPoints(flow.field);
	const spots = waitingSpots(flow.field);
	for (const m of added) {
		const taken = Object.values(opening);
		opening[m.id] = grid.find((g) => !taken.some((t) => overlaps(g, t))) ?? freeSpot(spots, taken);
	}
	// 後面的站位沒有新人的位置：用開頭那張的。
	const formations = flow.formations.map((f) => {
		const pos = { ...f.pos };
		for (const m of added) pos[m.id] = opening[m.id];
		return { ...f, pos };
	});
	return ok({ ...flow, members: [...flow.members, ...added], formations }, { errors, rejected: bad.map((e) => e.text) });
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
	// 名字有改才檢查：開檔進來名字太長的人還是可以改性別和全局角色。
	const problem = updated.name === member.name ? null : memberNameProblem(updated.name);
	if (problem) return blocked(problem);
	// 改名字當成可能換了人：先照「換人」走收尾，看會動到哪些紀錄（他在的組的、他自己的）。
	const swapped = updated.name === member.name ? [] : flow.actions.map((a) => replaced(flow, a, id));
	const mine = swapped.filter((s) => s.records.length);
	if (mine.length && !answered(options)) {
		const count = mine.reduce((n, s) => n + s.records.length, 0);
		return needsChoice(
			`${member.name} 改名成「${updated.name}」，他在的組和他自己有 ${count} 次紀錄：只是改錯字就保留舊紀錄，換了人就清掉重算`,
			mine.flatMap((s) => recordItems(flow, s.before, s.records, `動作「${actionLabel(s.before)}」`))
		);
	}
	const actions = options.records === 'clear' && mine.length ? swapped.map((s) => s.action) : flow.actions;
	return ok({ ...flow, members: flow.members.map((m) => (m.id === id ? updated : m)), actions });
}

/**
 * 動作裡的這個人換成別人（同一個位置、任務角色、組）走收尾，回答是清掉重算：
 * records 是會清掉的紀錄（他在的組的、騰翻跳躍是他自己的），action 是清掉之後（換回他的 id）。
 */
function replaced(flow: Flow, before: Action, id: string): { before: Action; action: Action; records: Attempt[] } {
	// 不在動作裡、或在分組的動作裡沒分到組：沒有他的紀錄（換成別人也不能讓收尾當成新進的人放進組）。
	const member = before.members.find((m) => m.memberId === id);
	if (!member || (member.squad === undefined && !perPerson(before.category))) return { before, action: before, records: [] };
	const stranger = `${id}?`;
	const swap = (a: Action, from: string, to: string) => ({
		...a,
		members: a.members.map((m) => (m.memberId === from ? { ...m, memberId: to } : m))
	});
	const settled = settle(flow, before, swap(before, id, stranger), { records: 'clear' });
	if (settled.kind !== 'ok') return { before, action: before, records: [] };
	const { lost, changed } = settled.fallout;
	return { before, action: swap(settled.action, stranger, id), records: [...lost, ...changed] };
}

/**
 * 排順序：把這個人移到名單上第 to 個（0 起），其他人依序補上。名單順序就是號碼和泳道順序，
 * 站位、動作都記 id，不用動。移到原本的位置：流程不變。
 */
export function moveMember(flow: Flow, id: string, to: number): CommandResult {
	const from = flow.members.findIndex((m) => m.id === id);
	if (from === -1) return blocked('找不到這個隊員');
	if (to < 0) return blocked('已經是第一個了');
	if (to >= flow.members.length) return blocked('已經是最後一個了');
	if (to === from) return ok(flow);
	return ok({ ...flow, members: flow.members.toSpliced(from, 1).toSpliced(to, 0, flow.members[from]) });
}

/**
 * 刪隊員。一定先回「要確認」：「刪掉隊員「名字」（標記、全局角色）：他在 N 個動作裡，其中 M 個會被整個刪掉」
 * （不在動作裡寫「他不在任何動作裡」，沒有動作會被整個刪掉就不寫「其中」那句；有拍點會拿掉——給他的、和只剩他是那個角色的——再加「會一起拿掉 K 個拍點」），清單是那 M 個動作；
 * 帶 { confirmed: true } 再送一次才刪：從名單、每張站位、每個動作拿掉他，沒人剩下的動作刪掉，
 * 給他的拍點（和動作裡已經沒人做的角色的拍點）也拿掉。刪隊員當成真的換人：他在的每一組和他自己的紀錄都清掉，
 * 確認訊息寫會清掉幾次。他走了空掉的組拿掉，後面的組往前補號。
 */
export function deleteMember(
	flow: Flow,
	id: string,
	options: ConfirmOption = {}
): CommandResult {
	const member = flow.members.find((m) => m.id === id);
	if (!member) return blocked('找不到這個隊員');
	const inActions = flow.actions.filter((a) => a.members.some((m) => m.memberId === id));
	const emptied = inActions.filter((a) => a.members.length === 1);
	// 刪隊員當成真的換人：每個留下來的動作走收尾，回答固定是清掉重算。
	const actions = flow.actions
		.filter((a) => !emptied.includes(a))
		.map((a) => {
			const after = dropOrphanCues({ ...a, members: a.members.filter((m) => m.memberId !== id) });
			const settled = settle(flow, a, after, { records: 'clear' });
			return settled.kind === 'ok' ? settled.action : after;
		});
	if (!answered(options)) {
		const spans = segmentSpans(flow);
		const cueCount = (list: Action[]) => list.reduce((n, a) => n + (a.cues?.length ?? 0), 0);
		const dropped = cueCount(flow.actions.filter((a) => !emptied.includes(a))) - cueCount(actions);
		const records = (list: Action[]) => list.reduce((n, a) => n + (a.successRate?.records.length ?? 0), 0);
		const cleared = records(flow.actions) - records(actions);
		const role = GLOBAL_ROLES.find((r) => r.key === member.globalRole)?.label;
		const where = !inActions.length
			? '他不在任何動作裡'
			: `他在 ${inActions.length} 個動作裡` + (emptied.length ? `，其中 ${emptied.length} 個會被整個刪掉` : '');
		return needsConfirm(
			`刪掉隊員「${member.name}」（標記 ${memberMarkers(flow)[id]}、${role}）：${where}` +
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
 * 連在一起的數字整串算一個字（新人1、新人10 → 新1、新10）。
 * 找不到（同名、名字只有一個字）就在開頭字後面加 1、2、3…，跳過已經被用掉的和群裡別人的名字
 * （甲10 在名單裡，甲11 就不會寫成「甲10」）。
 */
function clashMarkers(group: Member[], chars: Map<string, string[]>): Record<string, string> {
	const head = chars.get(group[0].id)![0].toUpperCase();
	const rest = (m: Member): string[] => chars.get(m.id)!.slice(1).join('').match(/\d+|./gu) ?? [];
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
		const taken = (marker: string) =>
			used.has(marker) || group.some((o) => o !== m && chars.get(o.id)!.join('').toUpperCase() === marker);
		while (taken(head + n)) n++;
		markers[m.id] = head + n++;
	}
	return markers;
}

/**
 * 新人排進場的格點：墊子上格線的交點（含墊子的邊），一格一個。
 * 照離場地中心多近排；一樣近時先排靠正面的，再先排左邊的。
 */
function gridPoints(field: FieldConfig): Position[] {
	const { mat, cols, rows } = fieldGeometry(field);
	const points = Array.from({ length: cols + 1 }, (_, i) =>
		Array.from({ length: rows + 1 }, (_, j): Position => [mat.x + i * CELL_M, mat.y + j * CELL_M])
	).flat();
	const near = (p: Position) => Math.round(Math.hypot(p[0], p[1]) * 1e6);
	return points.sort((a, b) => near(a) - near(b) || b[1] - a[1] || a[0] - b[0]);
}

/** 兩個圓點疊到：中心距離不到半格。 */
function overlaps(a: Position, b: Position): boolean {
	return Math.hypot(a[0] - b[0], a[1] - b[1]) < CELL_M / 2 - 1e-6;
}

/**
 * 場地放滿時，新人等著被擺好的位置：場地外半格、每 1/2 格一個（圓點不會疊在一起），繞著場地排一圈。
 * 從正面左邊的角開始往右排到場地右邊外，再從那個角沿著左邊往後，再沿著右邊往後，最後排後面。
 * 都在吸附點上、在場地外 1 m 以內。
 * 一共 4 ×（左右格數 ＋ 前後格數）＋ 8 個位置；最小的場地（1 條，1 × 7 格）剛好 40 個，所以一定有空位。
 */
function waitingSpots(field: FieldConfig): Position[] {
	const { mat, cols, rows } = fieldGeometry(field);
	const step = CELL_M / 2;
	const left = mat.x - step;
	const right = mat.x + mat.width + step;
	const front = mat.y + mat.height + step;
	const back = mat.y - step;
	const alongFront = Array.from({ length: 2 * cols + 3 }, (_, j): Position => [left + j * step, front]);
	const side = (x: number) => Array.from({ length: 2 * rows + 2 }, (_, j): Position => [x, front - (j + 1) * step]);
	const alongBack = Array.from({ length: 2 * cols + 1 }, (_, j): Position => [left + (j + 1) * step, back]);
	return [...alongFront, ...side(left), ...side(right), ...alongBack];
}

/** 第一個沒人站的位置。最多 40 人、位置至少 40 個，所以一定找得到。 */
function freeSpot(spots: Position[], taken: Position[]): Position {
	return spots.find((s) => !taken.some((t) => samePlace(s, t)))!;
}

function samePlace(a: Position, b: Position): boolean {
	return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
}

/** 名字的毛病：空的、太長；沒問題是 null。名字先去掉前後空白再傳進來。 */
function memberNameProblem(name: string): string | null {
	if (!name) return '請填隊員名字';
	return tooLong('memberName', name);
}

/** 下一個沒用過的 m 編號。 */
function nextNumber(members: Member[]): number {
	return Math.max(0, ...members.map((m) => Number(m.id.slice(1)) || 0)) + 1;
}
