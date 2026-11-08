// 隊員名單：加隊員、改隊員、排順序、刪隊員。

import { actionLabel, type Action } from './action-types';
import { dropOrphanCues } from './cues';
import { CELL_M, fieldGeometry, type FieldConfig } from './field';
import type { Flow } from './flow';
import { withWalks, type Position } from './formation';
import { RECORDS_GONE, answered, blocked, needsChoice, needsConfirm, ok, type CommandResult, type ConfirmOption } from './result';
import { FIXED_ROLES } from './roles';
import { CHANGED_SQUADS_QUESTION, settle } from './settle';
import { perPerson, recordCount, recordItems, squadNumber, type Attempt } from './success-rate';
import { charCount, firstChars, tooLong } from './text-length';
import { fromText, segmentSpans } from './time';

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

/** 一個要加的人：畫面上的字（rejected 用）、名字（錯的時候用它標是哪一個），和讀出來的人或錯誤。 */
interface Entry {
	text: string;
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
		inputs.map((input) => ({ text: input.name, name: input.name.trim(), input, problems: [] }))
	);
}

/**
 * 貼上的名單加隊員：每一行是「名字」（用表單選的性別、全局角色）或「名字、性別、全局角色」三欄。
 * 三欄用 Tab 或逗號隔開；用空白隔開時，最後兩段像性別或全局角色才當三欄（名字裡可以有空白）。
 * 性別認男、女、男生、女生、M、F；全局角色認底層、上層、base、top、飛人（英文不分大小寫）。
 * 全局角色寫成主底、後保這類任務角色：擋下並說明。三欄的行不用表單選的。空行、標題列（第一欄是「名字」「姓名」「name」）跳過。
 * 見 addEntries。
 */
export function addMemberLines(
	flow: Flow,
	text: string,
	defaults: { gender: Gender | null; globalRole: GlobalRole | null }
): CommandResult<AddMembersResult> {
	const entries = text.split('\n').flatMap((line): Entry[] => {
		if (!line.trim()) return [];
		const cols = columns(line);
		if (cols.length > 1 && NAME_HEADERS.has(cols[0].toLowerCase())) return [];
		const entry: Entry = { text: line, name: cols[0], input: null, problems: [] };
		if (cols.length === 1) entry.input = { name: cols[0], ...defaults };
		else if (cols.length !== 3) entry.problems.push('一行寫一個名字，或「名字、性別、全局角色」三欄（用 Tab、空白或逗號隔開）');
		else {
			const gender = genderOf(cols[1]);
			const globalRole = globalRoleOf(cols[2]);
			if (!gender) entry.problems.push('性別要寫「男」或「女」');
			if (!globalRole) {
				const task = FIXED_ROLES.some((r) => r.name === cols[2]) ? `「${cols[2]}」是任務角色（每個動作各自設），` : '';
				entry.problems.push(`${task}全局角色要寫「底層」或「上層」`);
			}
			if (gender && globalRole) entry.input = { name: cols[0], gender, globalRole };
		}
		return [entry];
	});
	return addEntries(flow, entries);
}

/** 貼上名單認得的性別寫法（英文比小寫）。 */
const GENDER_WORDS: Record<string, Gender> = { 女: 'F', 女生: 'F', f: 'F', 男: 'M', 男生: 'M', m: 'M' };
/** 貼上名單認得的全局角色寫法（英文比小寫）。 */
const GLOBAL_ROLE_WORDS: Record<string, GlobalRole> = { 底層: 'base', base: 'base', 上層: 'top', top: 'top', 飛人: 'top' };
/** 標題列的第一欄。 */
const NAME_HEADERS = new Set(['名字', '姓名', 'name']);

function genderOf(word: string): Gender | null {
	return Object.hasOwn(GENDER_WORDS, word.toLowerCase()) ? GENDER_WORDS[word.toLowerCase()] : null;
}

function globalRoleOf(word: string): GlobalRole | null {
	return Object.hasOwn(GLOBAL_ROLE_WORDS, word.toLowerCase()) ? GLOBAL_ROLE_WORDS[word.toLowerCase()] : null;
}

/**
 * 一行切成幾欄：有 Tab 用 Tab 切，有逗號用逗號切；只有空白時，至少三段、而且最後兩段像性別或全局角色
 * （或任務角色、標題列）才切成「名字、性別、全局角色」，不然整行是名字。
 */
function columns(line: string): string[] {
	if (line.includes('\t')) return line.split('\t').map((c) => c.trim());
	if (/[,，]/.test(line)) return line.split(/[,，]/).map((c) => c.trim());
	const words = line.trim().split(/\s+/);
	if (words.length < 3) return [line.trim()];
	const [gender, role] = words.slice(-2);
	const looksLike =
		genderOf(gender) ||
		globalRoleOf(role) ||
		FIXED_ROLES.some((r) => r.name === role) ||
		NAME_HEADERS.has(words[0].toLowerCase());
	return looksLike ? [words.slice(0, -2).join(' '), gender, role] : [line.trim()];
}

/**
 * 有錯的人（沒名字、名字太長、沒選性別或全局角色、認不得的行）不加，所有錯一次列在 errors，其他人照加；
 * 一個都加不了就擋下，原因是所有錯（一行一個）。錯誤用名字標是哪一個（不寫第幾行：沒加的行留在框裡，行號會對不上），
 * 名字太長只寫前 ERROR_NAME_CHARS 個字；一樣的錯合成一行，名字列在一起（「小A」、「小B」：請選性別），每個人都一樣（含只有一個人）就不標。
 * 加了會超過 MAX_MEMBERS 人就一個都不加，原因寫還能加幾人。
 * 新人在每一張站位各自排進那一張最靠近場地中間的空格點（不跟那一張現有的人疊到）；格點都有人了才排場外。
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
	// 一樣的錯寫一次：名字列在一起；每個人都一樣（或沒名字）就不寫名字。
	// 不用 Map.groupBy：舊一點的 iPad Safari 沒有。
	const same = new Map<string, Entry[]>();
	for (const e of bad) {
		const problem = e.problems.join('；');
		same.set(problem, [...(same.get(problem) ?? []), e]);
	}
	const errors = [...same].map(([problem, group]) => {
		const named = group.filter((e) => e.name);
		return group.length === entries.length || named.length < group.length
			? problem
			: `${named.map((e) => `「${shortName(e.name)}」`).join('、')}：${problem}`;
	});
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
	const grid = gridPoints(flow.field);
	const spots = waitingSpots(flow.field);
	const formations = flow.formations.map((f) => ({ ...f, pos: { ...f.pos } }));
	for (const m of added) {
		const taken = formations.map((f) => Object.values(f.pos));
		const free = (g: Position, i: number) => !taken[i].some((t) => overlaps(g, t));
		// 先找每張站位都空著的格點：新人每張站同一點，不會冒出走太快、很喘；找不到才每張各自找
		const everywhere = grid.find((g) => taken.every((_, i) => free(g, i)));
		formations.forEach((f, i) => {
			f.pos[m.id] = everywhere ?? grid.find((g) => free(g, i)) ?? freeSpot(spots, taken[i]);
		});
	}
	return ok({ ...flow, members: [...flow.members, ...added], formations }, { errors, rejected: bad.map((e) => e.text) });
}

/** 錯誤裡的名字最多寫幾個字。 */
const ERROR_NAME_CHARS = 10;

/** 錯誤裡的名字：太長就截斷加「…」。 */
function shortName(name: string): string {
	return charCount(name) > ERROR_NAME_CHARS ? `${firstChars(name, ERROR_NAME_CHARS)}…` : name;
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
			`${member.name} 改名成「${updated.name}」，他在的組和他自己有 ${count} 次紀錄：只是改錯字就保留舊紀錄，換了人就清掉重算${RECORDS_GONE}`,
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
 * （不在動作裡寫「他不在任何動作裡」，沒有動作會被整個刪掉就不寫「其中」那句；有拍點會拿掉——給他的、和只剩他是那個角色的——再加「會一起拿掉 K 個拍點」；
 * 留下來的動作沒有別人是他的任務角色就寫「「技巧·Lib」會沒有上層」，見 lostRole；標記是號碼、他後面還有人就寫號碼會往前遞補），
 * 清單是他在的每個動作：他的任務角色（第幾組的），或「只有他，會整個刪掉」；
 * 帶 { confirmed: true } 再送一次才刪：從名單、每張站位、每個動作拿掉他，沒人剩下的動作刪掉，
 * 給他的拍點（和動作裡已經沒人做的角色的拍點）也拿掉。他自己的紀錄（騰翻、跳躍）和整個刪掉的動作的紀錄一定清掉，確認訊息寫會清掉幾次；
 * 他在的組還有別人、那一組有紀錄：跟在動作裡移人一樣改回「要選」，帶 { records: 'keep' } 留著那一組的紀錄，
 * { records: 'clear' }（或只帶 { confirmed: true }）清掉。他走了空掉的組拿掉，後面的組往前補號。
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
	// 刪隊員跟在動作裡移人一樣：每個留下來的動作走收尾；他在的組還有人，那一組的紀錄照回答保留或清掉（只按確定是清掉）。
	let changed = 0;
	const actions = flow.actions
		.filter((a) => !emptied.includes(a))
		.map((a) => {
			const after = dropOrphanCues({ ...a, members: a.members.filter((m) => m.memberId !== id) });
			const settled = settle(flow, a, after, { records: options.records ?? 'clear' });
			if (settled.kind !== 'ok') return after;
			changed += settled.fallout.changed.length;
			return settled.action;
		});
	if (!answered(options)) {
		const spans = segmentSpans(flow);
		const cueCount = (list: Action[]) => list.reduce((n, a) => n + (a.cues?.length ?? 0), 0);
		const dropped = cueCount(flow.actions.filter((a) => !emptied.includes(a))) - cueCount(actions);
		// 一定清掉的（他自己的、整個刪掉的動作的）；換了人的組要問，不算在這裡。
		const cleared = recordCount(flow.actions) - recordCount(actions) - changed;
		const role = GLOBAL_ROLES.find((r) => r.key === member.globalRole)?.label;
		const where = !inActions.length
			? '他不在任何動作裡'
			: `他在 ${inActions.length} 個動作裡` + (emptied.length ? `，其中 ${emptied.length} 個會被整個刪掉` : '');
		const lost = inActions.flatMap((a) => (emptied.includes(a) ? [] : lostRole(a, id)));
		const after = flow.members.length - 1 - flow.members.indexOf(member);
		return (changed ? needsChoice : needsConfirm)(
			`刪掉隊員「${member.name}」（標記 ${memberMarkers(flow)[id]}、${role}）：${where}` +
				(dropped ? `，會一起拿掉 ${dropped} 個拍點` : '') +
				(cleared ? `，會清掉 ${cleared} 次紀錄${RECORDS_GONE}` : '') +
				(lost.length ? `，${lost.join('、')}` : '') +
				(after && flow.markers !== 'initial' ? `；後面 ${after} 個人的號碼會往前遞補` : '') +
				// 清掉重算也救不回來：前面寫過了就不重複
				(changed ? `；${CHANGED_SQUADS_QUESTION}${cleared ? '' : RECORDS_GONE}` : ''),
			inActions.map((a) => {
				const span = spans.find((s) => s.segment.id === a.segmentId)!;
				const mine = a.members.find((m) => m.memberId === id)!;
				const what = emptied.includes(a)
					? '：只有他，會整個刪掉'
					: mine.role
						? `：他是${mine.squad === undefined ? '' : `第 ${squadNumber(a, mine.squad)} 組的`}${mine.role}`
						: '';
				return `動作「${actionLabel(a)}」（${span.label} ${fromText(span.segment, a.start)}）${what}`;
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

/**
 * 他走了，動作（分組的看他那一組）裡沒有別人是他的任務角色：「「技巧·Lib」第 1 組會沒有上層」；
 * 沒有任務、還有別人是那個角色、那一組只剩他（組會整個拿掉）：沒有。
 */
function lostRole(action: Action, id: string): string[] {
	const mine = action.members.find((m) => m.memberId === id)!;
	if (!mine.role) return [];
	const mates = action.members.filter((m) => m.memberId !== id && m.squad === mine.squad);
	if (!mates.length || mates.some((m) => m.role === mine.role)) return [];
	const squad = mine.squad === undefined ? '' : `第 ${squadNumber(action, mine.squad)} 組`;
	return [`「${actionLabel(action)}」${squad}會沒有${mine.role}`];
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
 * 新人排進場的格點：墊子上每一格的正中間（不在格線、接縫或墊子邊上），一格一個。
 * 照離場地中心多近排；一樣近時先排靠正面的，再先排左邊的。
 */
function gridPoints(field: FieldConfig): Position[] {
	const { mat, cols, rows } = fieldGeometry(field);
	const points = Array.from({ length: cols }, (_, i) =>
		Array.from({ length: rows }, (_, j): Position => [mat.x + (i + 0.5) * CELL_M, mat.y + (j + 0.5) * CELL_M])
	).flat();
	const near = (p: Position) => Math.round(Math.hypot(p[0], p[1]) * 1e6);
	return points.sort((a, b) => near(a) - near(b) || b[1] - a[1] || a[0] - b[0]);
}

/** 兩個圓點疊到：中心距離不到半格。 */
function overlaps(a: Position, b: Position): boolean {
	return Math.hypot(a[0] - b[0], a[1] - b[1]) < CELL_M / 2 - 1e-6;
}

/**
 * 場地放滿時，新人等著被擺好的位置：墊子外 3/8 格（0.69 m），每 1/2 格一個（圓點不會疊在一起），繞著場地排一圈。
 * 圓點（半徑 0.3 m）整個在墊子外、也整個在外圍 1 m 以內，不壓到墊子邊和外圍框線。
 * 先在正面外從左到右排成一列（左右各超出墊子 1/4 格），再沿著左邊往後，再沿著右邊往後，最後排後面。
 * 都在吸附點上（放大後的 1/8 格）。
 * 一共 4 ×（左右格數 ＋ 前後格數）＋ 4 個位置；最小的場地（1 條，7 格）有 36 個，加上 7 格一定放得下 40 人。
 */
function waitingSpots(field: FieldConfig): Position[] {
	const { mat, cols, rows } = fieldGeometry(field);
	const step = CELL_M / 2;
	const out = (CELL_M * 3) / 8;
	const front = mat.y + mat.height + out;
	const back = mat.y - out;
	const row = (y: number) => Array.from({ length: 2 * cols + 2 }, (_, j): Position => [mat.x - CELL_M / 4 + j * step, y]);
	const side = (x: number) =>
		Array.from({ length: 2 * rows }, (_, j): Position => [x, mat.y + mat.height - CELL_M / 4 - j * step]);
	return [...row(front), ...side(mat.x - out), ...side(mat.x + mat.width + out), ...row(back)];
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
