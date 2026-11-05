// 成功率：動作有環節（上法、中段…）就記成功率，動作裡的人分組。
// 設定存在動作裡（Action.successRate），組存在動作裡的人身上（ActionMember.squad，組 id）。
// 組號（第 n 組）不存：動作裡現在有人的組照 id 發出的先後排，第一個是第 1 組（見 squadsOf）。

import { ACTION_CATEGORIES, type Action, type ActionCategory, type ActionMember } from './action-types';
import { memberName, type Flow } from './flow';
import type { Segment } from './segment';
import { rangeProblem, type BeatRange } from './beat-range';
import { NO_SQUAD_COLOR, PHASE_COLORS, squadColor } from './colors';
import { PHASE_KINDS, type Phase } from './phase-types';

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
	/** 誰：組 id；騰翻、跳躍的動作是隊員 id。 */
	who: string;
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

/** 動作裡現在有人的組的 id，照 id 發出的先後排：第一個是第 1 組。 */
export function squadsOf(action: Action): string[] {
	const ids = new Set(action.members.flatMap((m) => (m.squad === undefined ? [] : [m.squad])));
	return [...ids].sort((a, b) => idNumber(a) - idNumber(b));
}

/** 這一組是第幾組（1 起），照 squadsOf 算；動作裡沒有人在這一組是 0。 */
export function squadNumber(action: Action, squad: string): number {
	return squadsOf(action).indexOf(squad) + 1;
}

/** 組的徽章：第幾組（沒分組是 0）、寫的字、顏色。 */
export interface SquadBadge {
	number: number;
	text: string;
	color: string;
}

/**
 * 動作裡一個人的組徽章：第幾組和那一組的顏色；沒分組（或帶的組不在這個動作裡）是灰色「?」。
 * 場上的組號小圓、動作設定的隊員清單的組標籤、分組浮動列的號碼都照這個。
 */
export function squadBadge(action: Action, member: Pick<ActionMember, 'squad'>): SquadBadge {
	const n = member.squad ? squadNumber(action, member.squad) : 0;
	return n ? { number: n, text: String(n), color: squadColor(n) } : { number: 0, text: '?', color: NO_SQUAD_COLOR };
}

/** 組 id 的寫法：g 加編號（g1、g2…），由流程的 id 發號，刪了不重用。 */
export function isSquadId(v: unknown): v is string {
	return typeof v === 'string' && /^g[1-9]\d*$/.test(v);
}

const idNumber = (id: string) => Number(String(id).slice(1));

/** 流程裡全部的組 id（發新的組 id 時用）。 */
export function allSquadIds(flow: Flow): string[] {
	return flow.actions.flatMap((a) => squadsOf(a));
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

/** 拿掉動作裡的這幾次紀錄；沒有要拿就回傳原來的動作。 */
export function withoutRecords(action: Action, drop: Attempt[]): Action {
	if (!drop.length || !action.successRate) return action;
	const records = action.successRate.records.filter((r) => !drop.includes(r));
	return { ...action, successRate: { ...action.successRate, records } };
}

/** 紀錄照誰數幾次，給教練看：「第 1 組 小美：2 次」，騰翻、跳躍是「小美：1 次」；照第一次記的先後排，前面接 head。 */
export function recordItems(flow: Flow, action: Action, records: Attempt[], head = ''): string[] {
	const counts = new Map<string, number>();
	for (const r of records) counts.set(r.who, (counts.get(r.who) ?? 0) + 1);
	return [...counts].map(([who, n]) => {
		const name = perPerson(action.category) ? memberName(flow, who) : squadName(flow, action, who);
		return `${head}${name}：${n} 次`;
	});
}

const isSquad = (n: number) => Number.isInteger(n) && n >= 1;

/** 動作裡的人能不能放進第 squad 組（給教練看的原因）；可以是 null。 */
export function squadProblem(action: Action, squad: number): string | null {
	return isSquad(squad) ? groupingProblem(action) : '組要是正整數';
}

/** 動作能不能分組（給教練看的原因）；可以是 null。 */
function groupingProblem(action: Action): string | null {
	return action.successRate ? perPersonProblem(action) : '動作有環節才能分組';
}

/** 騰翻、跳躍的動作不分組（給教練看的原因）；其他大類是 null。 */
function perPersonProblem(action: Action): string | null {
	if (!perPerson(action.category)) return null;
	const label = ACTION_CATEGORIES.find((c) => c.key === action.category)?.label;
	return `${label}的動作不分組，每個人自己算`;
}

/**
 * 成功率規則（只有這一份）：動作的成功率設定、組和紀錄哪裡不守規則（給教練看的原因）；沒問題是 null。
 * 收尾最後照這個檢查，讀流程檔也照這個檢查。第 6 版就有的規則（v6RateProblem）再加：
 * 有成功率設定就至少一個環節；音樂段的環節一定有標的拍、照拍的先後排；組 id 是 g 加編號。
 * 只有組放寬（第 9 版起）：還沒有環節的動作也可以有組（從別的動作複製人帶來的，加第一個環節時照用），騰翻、跳躍還是不分組。
 */
export function successRateProblem(segment: Segment, action: Action): string | null {
	const grouped = action.members.some((m) => m.squad !== undefined);
	const problem = (grouped && perPersonProblem(action)) || phasesAndRecordsProblem(segment, action);
	if (problem) return problem;
	const phases = action.successRate?.phases;
	if (phases && !phases.length) return '記成功率的動作至少要有一個環節';
	if (segment.kind === 'music' && phases) {
		if (phases.some((p) => !p.beats)) return '音樂段的環節要選拍標';
		if (phases.some((p, i) => i > 0 && p.beats!.at < phases[i - 1].beats!.at)) return '環節要照標的拍的先後排';
	}
	if (action.members.some((m) => m.squad !== undefined && !isSquadId(m.squad))) return '組的 id 不對';
	return null;
}

/**
 * 第 6 版流程檔就有的成功率規則（成功率規則的一部分）。第 6 → 7 版整理舊檔前先看它：本來就不守的檔不整理。
 * 組只在分組的動作裡；環節的 id、種類、名字、顏色；標的拍是整拍、在動作裡、不重疊；紀錄的環節、誰都對得上。
 */
export function v6RateProblem(segment: Segment, action: Action): string | null {
	if (action.members.some((m) => m.squad !== undefined)) {
		const problem = groupingProblem(action);
		if (problem) return problem;
	}
	return phasesAndRecordsProblem(segment, action);
}

/** 第 6 版就有的規則裡組以外的：環節的 id、種類、名字、顏色；標的拍是整拍、在動作裡、不重疊；紀錄的環節、誰都對得上。 */
function phasesAndRecordsProblem(segment: Segment, action: Action): string | null {
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
function whoFits(action: Action, who: string): boolean {
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

/** 環節標的拍的規則：只有音樂段能標；其他（整拍、整數拍、在動作裡面）在 beat-range。 */
export function beatsProblem(segment: Segment, action: Action, beats: BeatRange): string | null {
	if (segment.kind !== 'music') return '口號段不數拍，不能標環節的拍';
	return rangeProblem('phase', action, beats);
}

/** 組的名字：「第 1 組 小美」，後面是組裡任務角色是上層的人（好幾個就用名單上第一個）；沒有上層就只叫「第 1 組」。 */
export function squadName(flow: Flow, action: Action, squad: string): string {
	const top = flow.members.find((member) =>
		action.members.some((m) => m.memberId === member.id && m.squad === squad && m.role === '上層')
	);
	const n = squadNumber(action, squad);
	return top ? `第 ${n} 組 ${top.name}` : `第 ${n} 組`;
}

/** 流程裡全部環節的 id（發新 id 時用）。 */
export function allPhaseIds(flow: Flow): string[] {
	return flow.actions.flatMap((a) => a.successRate?.phases.map((p) => p.id) ?? []);
}
