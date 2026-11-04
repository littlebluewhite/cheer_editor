// 成功率：動作打開「記成功率」後，分成幾個環節（上法、中段…），動作裡的人分組。
// 設定存在動作裡（Action.successRate），組存在動作裡的人身上（ActionMember.squad）。

import type { Action, ActionCategory } from './actions';
import type { Flow } from './flow';
import type { Segment } from './segment';
import { HALF_BEATS_PER_BEAT } from './time';
import { freshIds } from './ids';
import { blocked, ok, type CommandResult } from './result';

/** 環節的種類：上法、中段、轉接、下法、整體。流程檔存英文代號。 */
export type PhaseKind = 'load' | 'hold' | 'transition' | 'dismount' | 'whole';

export const PHASE_KINDS: { key: PhaseKind; label: string }[] = [
	{ key: 'load', label: '上法' },
	{ key: 'hold', label: '中段' },
	{ key: 'transition', label: '轉接' },
	{ key: 'dismount', label: '下法' },
	{ key: 'whole', label: '整體' }
];

/**
 * 種類的顏色（環節沒挑辨識色時用）：上法青、中段石板灰、轉接金、下法紫、整體灰。
 * 避開拍子 down 的藍（#1f5fbf）、up 的綠（#2b7a2f），環節和拍子畫在一起時才分得出來。
 */
export const PHASE_KIND_COLORS: Record<PhaseKind, string> = {
	load: '#00796b',
	hold: '#475569',
	transition: '#8d6200',
	dismount: '#7b1fa2',
	whole: '#6b7280'
};

/** 環節：動作裡要分開算成功率的一部分。 */
export interface Phase {
	/** 整個流程裡不重複，刪了也不重用（紀錄跨復原時靠 id 對回環節），例：p3。 */
	id: string;
	kind: PhaseKind;
	/** 教練取的名字，例：延伸；可以是空的。 */
	name: string;
	/** 辨識色（#rrggbb）；沒有就用種類的顏色。 */
	color?: string;
	/** 標的拍：跟拍點一樣，從動作開始算第幾個半拍、幾個半拍長。沒有就是沒標拍。 */
	beats?: { at: number; len: number };
}

/** 記號：成功 ✓、小失誤 △、失敗 ✗。流程檔就存這三個字。 */
export type Mark = '✓' | '△' | '✗';

export const MARKS: { key: Mark; label: string }[] = [
	{ key: '✓', label: '成功' },
	{ key: '△', label: '小失誤' },
	{ key: '✗', label: '失敗' }
];

/** 練法：分段練（drill）或全上（runThrough）。 */
export type PracticeKind = 'drill' | 'runThrough';

export const PRACTICE_KINDS: PracticeKind[] = ['drill', 'runThrough'];

/** 一次：一組（騰翻、跳躍的動作是一個人）把動作做一遍的紀錄。 */
export interface Attempt {
	/** 整個流程裡不重複，刪了也不重用，例：t3。 */
	id: string;
	/** 裝置的當地日期，例：2026-11-04。 */
	date: string;
	/** 誰：第幾組；騰翻、跳躍的動作是隊員 id。 */
	who: number | string;
	practice: PracticeKind;
	/** 全上才有：同一次全上記的都帶一樣的 id。 */
	runThroughId?: string;
	/** 整個做；false 是只練幾個環節。 */
	whole: boolean;
	/** 每個環節的記號，key 是環節 id；沒有就是空的（沒做到、沒練）。 */
	marks: Record<string, Mark>;
}

/** 記一次要給的東西（id 由指令發）。 */
export type NewAttempt = Omit<Attempt, 'id'>;

/** 動作的「記成功率」設定。動作沒有這個欄位就是沒打開。 */
export interface SuccessRate {
	/** 環節，有順序。 */
	phases: Phase[];
	/** 紀錄，一次一筆，照記的先後排。 */
	records: Attempt[];
}

/** 環節在畫面上的顏色：挑了辨識色用辨識色，沒有就用種類的顏色。 */
export function phaseColor(phase: Phase): string {
	return phase.color ?? PHASE_KIND_COLORS[phase.kind];
}

/** 騰翻、跳躍是自己做的：不分組，每個人自己算。值是大類的名字（給教練看的原因用）。 */
const PER_PERSON: Partial<Record<ActionCategory, string>> = { tumbling: '騰翻', jump: '跳躍' };

/** 這個大類的動作是不是每個人自己算（不分組）。 */
export function perPerson(category: ActionCategory): boolean {
	return category in PER_PERSON;
}

/** 打開記成功率時先填的環節（照大類）。 */
const PREFILL: Record<ActionCategory, { kind: PhaseKind; name: string }[]> = {
	stunt: [
		{ kind: 'load', name: '' },
		{ kind: 'hold', name: '' },
		{ kind: 'dismount', name: '' }
	],
	pyramid: [
		{ kind: 'load', name: '' },
		{ kind: 'dismount', name: '' }
	],
	toss: [{ kind: 'whole', name: '拋投' }],
	tumbling: [{ kind: 'whole', name: '騰翻' }],
	jump: [],
	dance: [],
	other: []
};

/** 打開記成功率：照大類先填環節；金字塔通常整個一起算，所以全部的人先放第 1 組。已經打開就不動。 */
export function enableSuccessRate(flow: Flow, actionId: string): CommandResult {
	const action = flow.actions.find((a) => a.id === actionId);
	if (!action) return blocked('找不到這個動作');
	if (action.successRate) return ok(flow);
	const prefill = PREFILL[action.category];
	const issued = freshIds('p', prefill.length, flow.lastIds, phaseIds(flow));
	const phases = prefill.map((p, i) => ({ id: issued.ids[i], ...p }));
	const members =
		action.category === 'pyramid' ? action.members.map((m) => ({ ...m, squad: 1 })) : action.members;
	return withAction(
		{ ...flow, lastIds: issued.lastIds },
		{ ...action, members, successRate: { phases, records: [] } }
	);
}

/** 關掉記成功率：環節、組、紀錄都拿掉。 */
export function disableSuccessRate(flow: Flow, actionId: string): CommandResult {
	const action = flow.actions.find((a) => a.id === actionId);
	if (!action) return blocked('找不到這個動作');
	const { successRate: _, ...rest } = action;
	return withAction(flow, { ...rest, members: action.members.map(({ squad: _, ...m }) => m) });
}

/** 設組：給動作裡一個隊員第幾組（1 起）；null 是沒分組。組裡的人都換走了，那組的紀錄拿掉。 */
export function setSquad(
	flow: Flow,
	actionId: string,
	memberId: string,
	squad: number | null
): CommandResult {
	const action = flow.actions.find((a) => a.id === actionId);
	const segment = action && flow.segments.find((s) => s.id === action.segmentId);
	if (!action || !segment) return blocked('找不到這個動作');
	if (!action.members.some((m) => m.memberId === memberId)) return blocked('這個隊員不在動作裡');
	const members = action.members.map((m) => {
		if (m.memberId !== memberId) return m;
		const { squad: _, ...rest } = m;
		return squad === null ? rest : { ...rest, squad };
	});
	// 組沒人了，那組的紀錄拿掉
	const changed = fitRecords({ ...action, members });
	const problem = successRateProblem(segment, changed);
	return problem ? blocked(problem) : withAction(flow, changed);
}

const isSquad = (n: number) => Number.isInteger(n) && n >= 1;

/** 動作的成功率設定、組和紀錄哪裡不守規則（給教練看的原因）；沒問題是 null。指令和讀流程檔都照這個檢查。 */
export function successRateProblem(segment: Segment, action: Action): string | null {
	for (const { squad } of action.members) {
		if (squad === undefined) continue;
		if (!isSquad(squad)) return '組要是正整數';
		if (!action.successRate) return '先打開記成功率才能分組';
		const label = PER_PERSON[action.category];
		if (label) return `${label}的動作不分組，每個人自己算`;
	}
	const phases = action.successRate?.phases ?? [];
	if (new Set(phases.map((p) => p.id)).size !== phases.length) return '環節的 id 重複了';
	for (const p of phases) {
		if (!PHASE_KINDS.some((k) => k.key === p.kind)) return '沒有這種環節';
		const problem = p.beats ? beatsProblem(segment, action, p.beats) : null;
		if (problem) return problem;
	}
	const marked = phases.flatMap((p) => (p.beats ? [p.beats] : [])).sort((a, b) => a.at - b.at);
	if (marked.some((b, i) => i > 0 && b.at < marked[i - 1].at + marked[i - 1].len)) {
		return '環節標的拍不能重疊';
	}
	const records = action.successRate?.records ?? [];
	if (new Set(records.map((r) => r.id)).size !== records.length) return '一次的 id 重複了';
	for (const r of records) {
		const problem = attemptProblem(action, r);
		if (problem) return problem;
	}
	return null;
}

/**
 * 一次哪裡不守規則（給教練看的原因）；沒問題是 null。記一次和讀流程檔都照這個檢查。
 * 記號只能打在動作現在的環節上、只能是 ✓ △ ✗、至少一個；誰要對得上：分組的動作是現在有人的組，騰翻、跳躍是動作裡的隊員。
 */
export function attemptProblem(action: Action, attempt: NewAttempt): string | null {
	const phaseIds = new Set(action.successRate?.phases.map((p) => p.id));
	const marks = Object.entries(attempt.marks);
	if (marks.some(([id]) => !phaseIds.has(id))) return '記號要打在這個動作的環節上';
	if (marks.some(([, mark]) => !MARKS.some((m) => m.key === mark))) return '記號只能是 ✓、△、✗';
	if (marks.length === 0) return '一次至少要有一個記號';
	if (!whoFits(action, attempt.who)) return perPerson(action.category) ? '這個隊員不在動作裡' : '這一組沒有人';
	if (!isDate(attempt.date)) return '日期要寫成 2026-11-04 這樣';
	if (!PRACTICE_KINDS.includes(attempt.practice)) return '沒有這種練法';
	if ((attempt.practice === 'runThrough') !== (attempt.runThroughId !== undefined)) return '全上要帶同一次全上的 id';
	return null;
}

/**
 * 動作的紀錄裡對不上現在的環節、組、隊員的拿掉：指到不在的環節的記號丟掉，丟到一個記號都沒有的那一次整筆拿掉；
 * 誰對不上（組沒人了、人不在動作裡、大類換成騰翻或換掉騰翻）的那一次也拿掉。都對得上就回傳原來的動作。
 */
export function fitRecords(action: Action): Action {
	const rate = action.successRate;
	if (!rate) return action;
	const phaseIds = new Set(rate.phases.map((p) => p.id));
	const records = rate.records.flatMap((r) => {
		if (!whoFits(action, r.who)) return [];
		const marks = Object.entries(r.marks).filter(([id]) => phaseIds.has(id));
		if (marks.length === Object.keys(r.marks).length) return [r];
		return marks.length ? [{ ...r, marks: Object.fromEntries(marks) }] : [];
	});
	const same = records.length === rate.records.length && records.every((r, i) => r === rate.records[i]);
	return same ? action : { ...action, successRate: { ...rate, records } };
}

/** 誰對得上這個動作：分組的動作是現在有人的組，騰翻、跳躍是動作裡的隊員。 */
function whoFits(action: Action, who: number | string): boolean {
	return perPerson(action.category)
		? action.members.some((m) => m.memberId === who)
		: action.members.some((m) => m.squad === who);
}

/** 真的有這一天的「2026-11-04」。 */
function isDate(text: string): boolean {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
	if (!m) return false;
	const [y, mo, d] = m.slice(1).map(Number);
	const date = new Date(y, mo - 1, d);
	return date.getMonth() === mo - 1 && date.getDate() === d;
}

/** 環節標的拍守拍點的規則：只有音樂段能標、佔整數拍（至少 1 拍）、在動作裡面。開始不用在整拍上（動作被拖半拍時跟著落在 &）。 */
function beatsProblem(segment: Segment, action: Action, { at, len }: { at: number; len: number }): string | null {
	if (segment.kind !== 'music') return '口號段不數拍，不能標環節的拍';
	if (!Number.isInteger(at) || !Number.isInteger(len)) return '環節要落在半拍上';
	if (len < HALF_BEATS_PER_BEAT || len % HALF_BEATS_PER_BEAT !== 0) return '環節要佔整數拍，至少 1 拍';
	if (at < 0 || at + len > action.length) return '環節要在動作裡面';
	return null;
}

/** 組的名字：「第 1 組 小美」，後面是組裡任務角色是上層的人（好幾個就用名單上第一個）；沒有上層就只叫「第 1 組」。 */
export function squadName(flow: Flow, action: Action, squad: number): string {
	const top = flow.members.find((member) =>
		action.members.some((m) => m.memberId === member.id && m.squad === squad && m.role === '上層')
	);
	return top ? `第 ${squad} 組 ${top.name}` : `第 ${squad} 組`;
}

/** 流程裡全部環節的 id。 */
function phaseIds(flow: Flow): string[] {
	return flow.actions.flatMap((a) => a.successRate?.phases.map((p) => p.id) ?? []);
}

function withAction(flow: Flow, action: Action): CommandResult {
	return ok({ ...flow, actions: flow.actions.map((a) => (a.id === action.id ? action : a)) });
}
