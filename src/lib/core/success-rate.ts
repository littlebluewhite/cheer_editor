// 成功率：動作有環節（上法、中段…）就記成功率，動作裡的人分組。
// 設定存在動作裡（Action.successRate），組存在動作裡的人身上（ActionMember.squad）。

import {
	ACTION_CATEGORIES,
	type Action,
	type ActionCategory,
	type ActionMember
} from './action-types';
import { memberName, type Flow } from './flow';
import type { Segment } from './segment';
import { HALF_BEATS_PER_BEAT } from './time';
import { PHASE_COLORS } from './colors';

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

/** 動作的成功率設定。動作有環節才有這個欄位（至少一個環節）；沒有就是不記成功率。 */
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

/** 騰翻、跳躍是自己做的：不分組，每個人自己算。 */
const PER_PERSON = new Set<ActionCategory>(['tumbling', 'jump']);

/** 這個大類的動作是不是每個人自己算（不分組）。 */
export function perPerson(category: ActionCategory): boolean {
	return PER_PERSON.has(category);
}

/** 這個動作要分組：有環節，而且不是騰翻、跳躍。 */
export function groupsPeople(action: Action): boolean {
	return !!action.successRate?.phases.length && !perPerson(action.category);
}

/** 動作加第一個環節（開始記成功率）時：分組的大類把動作裡的人全部放進第 1 組；騰翻、跳躍不分組。已經記成功率的動作不動。 */
export function firstSquad(action: Action): Action {
	return action.successRate || perPerson(action.category) ? action : { ...action, members: action.members.map((m) => ({ ...m, squad: 1 })) };
}

/** 動作裡現在有人的組，照號碼排。 */
export function squadsOf(action: Action): number[] {
	return [...new Set(action.members.flatMap((m) => (m.squad === undefined ? [] : [m.squad])))].sort((a, b) => a - b);
}

/**
 * 換掉動作的環節清單，紀錄裡對不上的記號跟著拿掉（記號清光的那一次整筆拿掉）。
 * 一個環節都不剩就不記成功率：成功率設定和每個人的組一起拿掉。
 */
export function replacePhases(action: Action, phases: Phase[]): Action {
	if (!phases.length) {
		const { successRate: _, ...rest } = action;
		return { ...rest, members: action.members.map(({ squad: _, ...m }) => m) };
	}
	return fitRecords({ ...action, successRate: { records: action.successRate?.records ?? [], phases } });
}

/** 有幾次打了這些環節的記號。 */
export function markedCount(action: Action, phases: Phase[]): number {
	return (action.successRate?.records ?? []).filter((r) => phases.some((p) => p.id in r.marks)).length;
}

/**
 * 組號補成 1、2、3 不跳號：空掉的組拿掉，後面的組照原來的先後往前補；那一組的紀錄跟著換成新的號碼。
 * 先拿掉對不上的紀錄（fitRecords）、問完紀錄（見 settle.ts，照舊的號碼比）再補號。沒得補就回傳原來的動作。
 */
export function compactSquads(action: Action): Action {
	// 不是正整數的組號不動，留給成功率規則擋。
	const renumber = new Map(squadsOf(action).filter(isSquad).map((n, i) => [n, i + 1]));
	if ([...renumber].every(([from, to]) => from === to)) return action;
	const members = action.members.map((m) => (m.squad === undefined ? m : { ...m, squad: renumber.get(m.squad) ?? m.squad }));
	const rate = action.successRate;
	const records = rate?.records.map((r) => (typeof r.who === 'number' ? { ...r, who: renumber.get(r.who) ?? r.who } : r));
	return { ...action, members, ...(rate && { successRate: { ...rate, records: records! } }) };
}

/** 動作後來加進來的人（「＋加人…」）：有環節的分組動作只有一組，就進第 1 組；有好幾組（或還沒分組）就先沒有組。 */
export function newActionMember(action: Action, memberId: string): ActionMember {
	return squadsOf(action).length === 1 ? { memberId, role: null, squad: 1 } : { memberId, role: null };
}

/** 拿掉動作裡的這幾次紀錄；沒有要拿就回傳原來的動作。 */
export function withoutRecords(action: Action, drop: Attempt[]): Action {
	if (!drop.length || !action.successRate) return action;
	const records = action.successRate.records.filter((r) => !drop.includes(r));
	return { ...action, successRate: { ...action.successRate, records } };
}

/** 紀錄照誰數幾次，給教練看：「第 1 組 小美：2 次」，騰翻、跳躍是「小美：1 次」；照第一次記的先後排，前面接 head。 */
export function recordItems(flow: Flow, action: Action, records: Attempt[], head = ''): string[] {
	const counts = new Map<number | string, number>();
	for (const r of records) counts.set(r.who, (counts.get(r.who) ?? 0) + 1);
	return [...counts].map(([who, n]) => {
		const name = typeof who === 'number' ? squadName(flow, action, who) : memberName(flow, who);
		return `${head}${name}：${n} 次`;
	});
}

const isSquad = (n: number) => Number.isInteger(n) && n >= 1;

/** 動作裡的人能不能在第 squad 組（給教練看的原因）；可以是 null。 */
export function squadProblem(action: Action, squad: number): string | null {
	if (!isSquad(squad)) return '組要是正整數';
	if (!action.successRate) return '動作有環節才能分組';
	if (perPerson(action.category)) {
		const label = ACTION_CATEGORIES.find((c) => c.key === action.category)?.label;
		return `${label}的動作不分組，每個人自己算`;
	}
	return null;
}

/**
 * 成功率規則（只有這一份）：動作的成功率設定、組和紀錄哪裡不守規則（給教練看的原因）；沒問題是 null。
 * 收尾最後照這個檢查，讀流程檔也照這個檢查。第 6 版就有的規則（v6RateProblem）再加：
 * 有成功率設定就至少一個環節；音樂段的環節一定有標的拍、照拍的先後排；組號從 1 連續。
 */
export function successRateProblem(segment: Segment, action: Action): string | null {
	const problem = v6RateProblem(segment, action);
	if (problem) return problem;
	const phases = action.successRate?.phases;
	if (phases && !phases.length) return '記成功率的動作至少要有一個環節';
	if (segment.kind === 'music' && phases) {
		if (phases.some((p) => !p.beats)) return '音樂段的環節要選拍標';
		if (phases.some((p, i) => i > 0 && p.beats!.at < phases[i - 1].beats!.at)) return '環節要照標的拍的先後排';
	}
	const squads = squadsOf(action);
	if (squads.some((n, i) => n !== i + 1)) return '組號要從 1 連續';
	return null;
}

/**
 * 第 6 版流程檔就有的成功率規則（成功率規則的一部分）。第 6 → 7 版整理舊檔前先看它：本來就不守的檔不整理。
 * 組號是正整數、只在分組的動作裡；環節的 id、種類、名字、顏色；標的拍是整拍、在動作裡、不重疊；紀錄的環節、誰都對得上。
 */
export function v6RateProblem(segment: Segment, action: Action): string | null {
	for (const { squad } of action.members) {
		const problem = squad === undefined ? null : squadProblem(action, squad);
		if (problem) return problem;
	}
	const phases = action.successRate?.phases ?? [];
	if (new Set(phases.map((p) => p.id)).size !== phases.length) return '環節的 id 重複了';
	for (const p of phases) {
		if (!PHASE_KINDS.some((k) => k.key === p.kind)) return '沒有這種環節';
		if (p.name !== p.name.trim()) return '環節的名字頭尾不能有空白';
		if (p.color !== undefined && !PHASE_COLORS.some((c) => c.value === p.color)) {
			return '環節的顏色只能挑辨識色或石板灰';
		}
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
	if (attempt.practice === 'runThrough' && !attempt.whole) return '全上記的每一次都算整個做';
	return null;
}

/**
 * 記一次會存下來的樣子：給動作、整個做（要練全部環節）或只練幾個環節、點了的記號，回會存的記號和算不算整個做。
 * 照環節的順序，第一個 ✗ 後面的記號不存；整個做卻有環節沒點（有 ✗ 時看 ✗ 和它前面的，沒有 ✗ 時看全部），算只練幾個環節。
 * 只在記的時候套，讀流程檔不檢查：之後才加的環節、標拍換了順序，會讓舊的一次看起來不合。不是環節的記號原樣留著，交給 attemptProblem 擋。
 */
export function keptAttempt(
	action: Action,
	whole: boolean,
	marks: Record<string, Mark>
): { whole: boolean; marks: Record<string, Mark> } {
	const phaseIds = action.successRate?.phases.map((p) => p.id) ?? [];
	const fail = phaseIds.findIndex((id) => marks[id] === '✗');
	const after = new Set(fail < 0 ? [] : phaseIds.slice(fail + 1));
	const counted = fail < 0 ? phaseIds : phaseIds.slice(0, fail + 1);
	return {
		whole: whole && counted.every((id) => marks[id]),
		marks: Object.fromEntries(Object.entries(marks).filter(([id]) => !after.has(id)))
	};
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

/** 環節標的拍的規則：只有音樂段能標、從音樂的整拍開始、佔整數拍（至少 1 拍）、在動作裡面（動作被拖半拍時，標的拍跟著挪去對齊整拍）。 */
function beatsProblem(segment: Segment, action: Action, { at, len }: { at: number; len: number }): string | null {
	if (segment.kind !== 'music') return '口號段不數拍，不能標環節的拍';
	if (!Number.isInteger(at) || !Number.isInteger(len)) return '環節要落在半拍上';
	if ((action.start + at) % HALF_BEATS_PER_BEAT !== 0) return '環節要標在整拍上';
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

/** 流程裡全部環節的 id（發新 id 時用）。 */
export function allPhaseIds(flow: Flow): string[] {
	return flow.actions.flatMap((a) => a.successRate?.phases.map((p) => p.id) ?? []);
}
