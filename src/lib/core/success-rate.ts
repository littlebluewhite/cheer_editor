// 成功率：動作有環節（上法、中段…）就記成功率，動作裡的人分組。
// 設定存在動作裡（Action.successRate），組存在動作裡的人身上（ActionMember.squad，組 id）。
// 組號（第 n 組）不存：動作裡現在有人的組照 id 發出的先後排，第一個是第 1 組（見 squadsOf）。

import { categoryWhy, type Action, type ActionCategory, type ActionMember } from './action-types';
import { memberName, type Flow } from './flow';
import { isRandomId } from './ids';
import type { Segment } from './segment';
import { phasesOverlap, phasesShareBeats, rangeProblem, type BeatRange } from './beat-range';
import { NO_SQUAD_COLOR, PHASE_COLORS, squadColor } from './colors';
import { fitPhaseKind, phaseKindsFor, phaseKindWhy, PHASE_KINDS, phasesMayShareBeats, V10_PHASE_KINDS, type Phase } from './phase-types';
import type { Member } from './members';
import { joined, zh, type Why, type WhyParam } from './why';

/** 記號：成功 ✓、小失誤 △、失敗 ✗。流程檔就存這三個字。 */
export type Mark = '✓' | '△' | '✗';

export const MARKS: { key: Mark; label: Why }[] = [
	{ key: '✓', label: { code: 'success_rate_hit' } },
	{ key: '△', label: { code: 'success_rate_bobble' } },
	{ key: '✗', label: { code: 'success_rate_fall' } }
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
	/** 全上才有：這次全上開的時間（手機的時間，毫秒），一天裡的全上照它排第幾次。第 15 版以前的全上沒有。 */
	runThroughStartedAt?: number;
	/** 整個做；false 是只練幾個環節。 */
	whole: boolean;
	/** 每個環節的記號，key 是環節 id；沒有就是空的（沒做到、沒練）。 */
	marks: Record<string, Mark>;
	/**
	 * 整個做、中途 ✗ 時，那時就有、空著的環節 id（✗ 做完之後才開始的，和跟 ✗ 佔同樣的拍、沒打的；見 blankPhases）；沒有就不寫。
	 * 整次成功率靠它分出「那一次當時就有」：之後刪掉 ✗ 的環節，空著的還在就不算成功。
	 */
	blanks?: string[];
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

/**
 * 動作裡現在有人的組的 id，照 id 發出的先後排：第一個是第 1 組。
 * 舊的組 id（g1、g2…）照號碼排、排在前面；新的（亂數）照動作記的發出先後（squadOrder），沒記到的排最後、照 id 排。
 */
export function squadsOf(action: Action): string[] {
	const ids = new Set(action.members.flatMap((m) => (m.squad === undefined ? [] : [m.squad])));
	const order = action.squadOrder ?? [];
	const key = (id: string): [number, number] =>
		isRandomId(id) ? [1, order.includes(id) ? order.indexOf(id) : order.length] : [0, idNumber(id)];
	return [...ids].sort((a, b) => {
		const [ka, kb] = [key(a), key(b)];
		return ka[0] - kb[0] || ka[1] - kb[1] || (a < b ? -1 : a > b ? 1 : 0);
	});
}

/** 發了新的組 id 之後，動作記下發出的先後：squadOrder 只留現在有人的新寫法組 id，沒有就拿掉欄位。 */
export function withSquadOrder(action: Action, issued: string[] = []): Action {
	const { squadOrder: old, ...rest } = action;
	const used = new Set(action.members.map((m) => m.squad));
	const order = [...(old ?? []), ...issued].filter((id) => isRandomId(id) && used.has(id));
	if (order.length === (old ?? []).length && order.every((id, i) => id === old![i])) return action;
	return order.length ? { ...rest, squadOrder: order } : rest;
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

/** 組 id 的寫法：g 加 12 個字的亂數，或舊的 g 加編號（g1、g2…）。刪了不重用。 */
export function isSquadId(v: unknown): v is string {
	return typeof v === 'string' && (/^g[1-9]\d*$/.test(v) || (v.startsWith('g') && isRandomId(v)));
}

const idNumber = (id: string) => Number(String(id).slice(1));

/** 流程裡全部的組 id（發新的組 id 時用）。 */
export function allSquadIds(flow: Flow): string[] {
	return flow.actions.flatMap((a) => squadsOf(a));
}

/**
 * 換掉動作的環節清單，紀錄裡對不上的記號和空著的環節跟著拿掉（兩個都清光的那一次整筆拿掉）。
 * 一個環節都不剩就不記成功率：成功率設定和每個人的組一起拿掉。
 */
export function replacePhases(action: Action, phases: Phase[]): Action {
	if (!phases.length) {
		const { successRate: _, ...rest } = action;
		return { ...rest, members: action.members.map(({ squad: _, ...m }) => m) };
	}
	return fitRecords({ ...action, successRate: { records: action.successRate?.records ?? [], phases } });
}

/** 這些動作加起來有幾次紀錄。 */
export function recordCount(actions: readonly Action[]): number {
	return actions.reduce((n, a) => n + (a.successRate?.records.length ?? 0), 0);
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

/** 紀錄照誰數幾次，給教練看：「第 1 組 小美：2 次」，騰翻、跳躍是「小美：1 次」；照第一次記的先後排，前面接 head（沒有是空的）。 */
export function recordItems(flow: Flow, action: Action, records: Attempt[], head: WhyParam = ''): Why[] {
	const counts = new Map<string, number>();
	for (const r of records) counts.set(r.who, (counts.get(r.who) ?? 0) + 1);
	return [...counts].map(([who, n]): Why => {
		const name = perPerson(action.category) ? memberName(flow, who) : squadWhy(flow, action, who);
		if (head === '') return { code: n === 1 ? 'success_rate_records_one' : 'success_rate_records', name, n };
		return { code: n === 1 ? 'success_rate_records_in_one' : 'success_rate_records_in', head, name, n };
	});
}

const isSquad = (n: number) => Number.isInteger(n) && n >= 1;

/** 動作裡的人能不能放進第 squad 組（給教練看的原因）；可以是 null。 */
export function squadProblem(action: Action, squad: number): Why | null {
	return isSquad(squad) ? groupingProblem(action) : { code: 'success_rate_squad_number' };
}

/** 動作能不能分組（給教練看的原因）；可以是 null。 */
function groupingProblem(action: Action): Why | null {
	return action.successRate ? perPersonProblem(action) : { code: 'success_rate_needs_phases_to_group' };
}

/** 騰翻、跳躍的動作不分組（給教練看的原因）；其他大類是 null。 */
function perPersonProblem(action: Action): Why | null {
	if (!perPerson(action.category)) return null;
	return { code: 'success_rate_per_person', category: categoryWhy(action.category) };
}

/**
 * 成功率規則（只有這一份）：動作的成功率設定、組和紀錄哪裡不守規則（給教練看的原因）；沒問題是 null。
 * 收尾最後照這個檢查，讀流程檔也照這個檢查。第 6 版就有的規則（v6RateProblem）再加：
 * 有成功率設定就至少一個環節；環節的種類是動作的大類能用的（第 11 版起，見 phaseKindsFor）；音樂段的環節一定有標的拍、照拍的先後排；組 id 是 g 加編號。
 * 只有組放寬（第 9 版起）：還沒有環節的動作也可以有組（從別的動作複製人帶來的，加第一個環節時照用），騰翻、跳躍還是不分組。
 */
export function successRateProblem(segment: Segment, action: Action): Why | null {
	const keys = PHASE_KINDS.map((k) => k.key as string);
	return rateProblem(segment, action, keys) || kindsProblem(action) || laterRateProblem(segment, action);
}

/** 第 10 版流程檔的成功率規則：跟現在一樣，只是種類是第 10 版那五種、哪個大類都能用。第 10 → 11 版換種類前先看它：本來就不守的檔不換。 */
export function v10RateProblem(segment: Segment, action: Action): Why | null {
	return rateProblem(segment, action, V10_PHASE_KINDS) || laterRateProblem(segment, action);
}

function rateProblem(segment: Segment, action: Action, kinds: string[]): Why | null {
	const grouped = action.members.some((m) => m.squad !== undefined);
	return (grouped && perPersonProblem(action)) || phasesAndRecordsProblem(segment, action, kinds);
}

/** 第 7 版起加的規則。 */
function laterRateProblem(segment: Segment, action: Action): Why | null {
	const phases = action.successRate?.phases;
	if (phases && !phases.length) return { code: 'success_rate_no_phases' };
	if (segment.kind === 'music' && phases) {
		if (phases.some((p) => !p.beats)) return { code: 'success_rate_music_needs_beats' };
		if (phases.some((p, i) => i > 0 && p.beats!.at < phases[i - 1].beats!.at)) return { code: 'success_rate_phase_order' };
	}
	if (action.members.some((m) => m.squad !== undefined && !isSquadId(m.squad))) return { code: 'success_rate_squad_id' };
	return null;
}

/**
 * 第 6 版流程檔就有的成功率規則（成功率規則的一部分）。第 6 → 7 版整理舊檔前先看它：本來就不守的檔不整理。
 * 組只在分組的動作裡；環節的 id、種類、名字、顏色；標的拍是整拍、在動作裡、不重疊；紀錄的環節、誰都對得上。
 */
export function v6RateProblem(segment: Segment, action: Action): Why | null {
	if (action.members.some((m) => m.squad !== undefined)) {
		const problem = groupingProblem(action);
		if (problem) return problem;
	}
	return phasesAndRecordsProblem(segment, action, V10_PHASE_KINDS);
}

/** 環節的種類要是這個大類能用的（見 phaseKindsFor）：舞蹈、其他不記成功率，拋投只用拋法…（給教練看的原因）。 */
function kindsProblem(action: Action): Why | null {
	for (const p of action.successRate?.phases ?? []) {
		const problem = phaseKindProblem(action.category, p.kind);
		if (problem) return problem;
	}
	return null;
}

/** 這個大類的動作能不能用這種環節：「舞蹈的動作不記成功率」「拋投的環節只能用拋法」；能用是 null。加環節、改環節也照這個擋。 */
export function phaseKindProblem(category: ActionCategory, kind: string): Why | null {
	const kinds = phaseKindsFor(category);
	if ((kinds as string[]).includes(kind)) return null;
	if (!kinds.length) return { code: 'success_rate_no_rate', category: categoryWhy(category) };
	return { code: 'success_rate_kinds_only', category: categoryWhy(category), kinds: joined('members_list', kinds.map(phaseKindWhy)) };
}

/**
 * 環節的種類換成動作的大類能用的（見 fitPhaseKind），名字、id、紀錄照留；大類是舞蹈、其他就拿掉環節，
 * 不記成功率，組也拿掉。換大類時收尾用，升級舊檔也用。
 */
export function fitPhaseKinds(action: Action): Action {
	const rate = action.successRate;
	if (!rate) return action;
	if (!phaseKindsFor(action.category).length) return replacePhases(action, []);
	if (rate.phases.every((p) => fitPhaseKind(action.category, p.kind) === p.kind)) return action;
	const phases = rate.phases.map((p) => ({ ...p, kind: fitPhaseKind(action.category, p.kind)! }));
	return { ...action, successRate: { ...rate, phases } };
}

/** 第 6 版就有的規則裡組以外的：環節的 id、種類、名字、顏色；標的拍是整拍、在動作裡、不重疊（金字塔除外）；紀錄的環節、誰都對得上。 */
function phasesAndRecordsProblem(segment: Segment, action: Action, kinds: string[]): Why | null {
	const phases = action.successRate?.phases ?? [];
	if (new Set(phases.map((p) => p.id)).size !== phases.length) return { code: 'success_rate_phase_id_taken' };
	for (const p of phases) {
		if (!kinds.includes(p.kind)) return { code: 'success_rate_no_such_kind' };
		if (p.name !== p.name.trim()) return { code: 'success_rate_phase_name_spaces' };
		if (p.color !== undefined && !PHASE_COLORS.some((c) => c.value === p.color)) {
			return { code: 'success_rate_phase_color' };
		}
		const problem = p.beats ? beatsProblem(segment, action, p.beats) : null;
		if (problem) return problem;
	}
	// 金字塔的環節可以佔同樣的拍（docs/adr/0009）。
	if (!phasesMayShareBeats(action.category) && phasesOverlap(phases)) return { code: 'success_rate_phases_overlap' };
	const records = action.successRate?.records ?? [];
	if (new Set(records.map((r) => r.id)).size !== records.length) return { code: 'success_rate_attempt_id_taken' };
	for (const r of records) {
		const problem = attemptProblem(action, r);
		if (problem) return problem;
	}
	return null;
}

/**
 * 一次哪裡不守規則（給教練看的原因）；沒問題是 null。記一次和讀流程檔都照這個檢查。
 * 記號只能打在動作現在的環節上、只能是 ✓ △ ✗、至少一個（✗ 的環節刪掉後只剩空著的環節也可以）；誰要對得上：分組的動作是現在有人的組，騰翻、跳躍是動作裡的隊員。
 */
export function attemptProblem(action: Action, attempt: NewAttempt): Why | null {
	const phaseIds = new Set(action.successRate?.phases.map((p) => p.id));
	const marks = Object.entries(attempt.marks);
	if (marks.some(([id]) => !phaseIds.has(id))) return { code: 'success_rate_mark_phase' };
	if (marks.some(([, mark]) => !MARKS.some((m) => m.key === mark))) return { code: 'success_rate_mark_kind' };
	if (marks.length === 0 && !attempt.blanks?.length) return { code: 'success_rate_no_marks' };
	if (attempt.blanks && !blanksFit(attempt, phaseIds)) return { code: 'success_rate_blanks' };
	if (!whoFits(action, attempt.who)) {
		return { code: perPerson(action.category) ? 'success_rate_member_not_in_action' : 'success_rate_empty_squad' };
	}
	if (!isDate(attempt.date)) return { code: 'success_rate_date' };
	if (!PRACTICE_KINDS.includes(attempt.practice)) return { code: 'success_rate_no_such_practice' };
	if ((attempt.practice === 'runThrough') !== (attempt.runThroughId !== undefined)) return { code: 'success_rate_run_through_id' };
	const at = attempt.runThroughStartedAt;
	if (at !== undefined && (attempt.practice !== 'runThrough' || !Number.isSafeInteger(at) || at < 0))
		return { code: 'success_rate_run_through_started' };
	if (attempt.practice === 'runThrough' && !attempt.whole) return { code: 'success_rate_run_through_whole' };
	return null;
}

/**
 * 打 ✗ 之後哪些環節空著：給動作、整個做（要練全部環節）或只練幾個環節、點了的記號，回
 * 會留下來的記號（按不了的環節點過的不留）、算不算整個做、按不了的環節（shut）、
 * 空著的環節（blanks：按不了的，加上跟 ✗ 佔同樣的拍、沒打的；整個做時存成那一次的 blanks）、
 * 跳過了前面的環節（skipped：選整個做時，排在最後一個留下來的記號前面、沒打、不是跟 ✗ 佔同樣拍的；沒選整個做是空的）。
 * 練習的卡、全上的表、記一次、改一次都問這裡，不自己算。哪些按不了只在 shutAfterFail 算。
 */
export function blankPhases(
	action: Action,
	whole: boolean,
	marks: Record<string, Mark>
): { whole: boolean; marks: Record<string, Mark>; shut: string[]; blanks: string[]; skipped: string[] } {
	const phases = action.successRate?.phases ?? [];
	const shut = shutAfterFail(phases, marks);
	const open = phases.filter((p) => !shut.includes(p.id));
	const kept = Object.fromEntries(Object.entries(marks).filter(([id]) => !shut.includes(id)));
	const fails = open.filter((p) => kept[p.id] === '✗');
	/** 跟留下來的 ✗ 佔同樣的拍、沒打的：可以打，不打就空著，不害這一次變成只練幾個環節。 */
	const sharing = new Set(
		open.filter((p) => !kept[p.id] && fails.some((f) => phasesShareBeats(p, f))).map((p) => p.id)
	);
	const blanks = phases.filter((p) => shut.includes(p.id) || sharing.has(p.id)).map((p) => p.id);
	const needed = open.map((p) => p.id).filter((id) => !sharing.has(id));
	const last = needed.findLastIndex((id) => kept[id]);
	return {
		whole: whole && needed.every((id) => kept[id]),
		marks: kept,
		shut,
		blanks,
		skipped: whole ? needed.slice(0, Math.max(last, 0)).filter((id) => !kept[id]) : []
	};
}

/**
 * 按不了的環節（規則只在這裡）：打 ✗ 的環節裡最早做完的那一個，它做完之後才開始的（剛好接著開始的也算）。沒有 ✗ 就沒有。
 * 環節沒標拍（口號段）：照清單的先後，第一個 ✗ 後面的都按不了。環節沒有疊時兩個算法一樣。
 */
function shutAfterFail(phases: readonly Phase[], marks: Record<string, Mark>): string[] {
	const fails = phases.filter((p) => marks[p.id] === '✗');
	if (!fails.length) return [];
	if (phases.some((p) => !p.beats)) return phases.slice(phases.indexOf(fails[0]) + 1).map((p) => p.id);
	const end = Math.min(...fails.map((p) => p.beats!.at + p.beats!.len));
	return phases.filter((p) => p.beats!.at >= end).map((p) => p.id);
}

/**
 * 只練幾個環節時什麼時候自動存：給動作、勾的環節、點了的記號，回到了沒（due）、還在等哪些環節（waiting）。
 * 到了：勾的環節點了 ✗，或最後一個勾的環節有記號（勾的環節裡還能打的都打了，一定是這兩個之一）。
 * 等：勾了、還沒打、還能打、跟 ✗ 或最後一個勾的環節佔同樣的拍的。到了、沒有在等的才存；環節沒有疊就不會等。
 * 給了最近一次到存的時機時點的環節（trigger，✗ 或最後一個勾的環節），它還是：只等跟它佔同樣拍的；之後點了別的環節也不變。
 */
export function pickedAutoSave(
	action: Action,
	picked: readonly string[],
	marks: Record<string, Mark>,
	trigger?: string
): { due: boolean; waiting: string[] } {
	const planned = (action.successRate?.phases ?? []).filter((p) => picked.includes(p.id));
	const { marks: kept, shut } = blankPhases(action, false, marks);
	const last = planned.at(-1);
	const anchors = planned.filter((p) => kept[p.id] === '✗' || (p === last && kept[p.id]));
	const just = anchors.find((p) => p.id === trigger);
	const waiting = planned.filter(
		(p) => !shut.includes(p.id) && !kept[p.id] && (just ? [just] : anchors).some((a) => phasesShareBeats(p, a))
	);
	return { due: anchors.length > 0, waiting: waiting.map((p) => p.id) };
}

/**
 * 記一次會存下來的樣子：給動作、整個做（要練全部環節）或只練幾個環節、點了的記號，回會存的記號和算不算整個做（照 blankPhases）。
 * 整個做、有空著的環節（✗ 做完之後才開始的、跟 ✗ 佔同樣的拍沒打的）時，那些環節記成空著的（blanks）。
 * 只在記的時候套，讀流程檔不檢查：之後才加的環節、標拍換了順序，會讓舊的一次看起來不合。不是環節的記號原樣留著，交給 attemptProblem 擋。
 */
export function keptAttempt(
	action: Action,
	whole: boolean,
	marks: Record<string, Mark>
): { whole: boolean; marks: Record<string, Mark>; blanks?: string[] } {
	const kept = blankPhases(action, whole, marks);
	const saved = { whole: kept.whole, marks: kept.marks };
	return saved.whole && kept.blanks.length ? { ...saved, blanks: kept.blanks } : saved;
}

/** 「全部 ✓ 存」要存的記號：已點的照點的（△、✗ 不蓋掉），沒打的環節補 ✓。存的時候一樣照 keptAttempt 留：按不了的不存，跟 ✗ 佔同樣拍的存 ✓。 */
export function fillOk(action: Action, marks: Record<string, Mark>): Record<string, Mark> {
	const phases = action.successRate?.phases ?? [];
	return { ...Object.fromEntries(phases.map((p) => [p.id, '✓' as Mark])), ...marks };
}

/**
 * 改一次會存下來的樣子：給動作、原本的那一次、改好的記號。只練幾個環節的照記一次的規則留（keptAttempt）。
 * 整個做的只看那一次當時就有、現在還在的環節（打了記號的加上空著的）：之後才加的環節不變成空著的，打了記號也不存。
 * ✗ 的環節已經刪掉了，原本空著的照樣空著（打了記號也不存），前面的都有記號就還是整個做。
 * 刪掉別的環節後，原本空著的不再跟 ✗ 佔同樣的拍：這次也沒打就照樣空著，不害這一次變成只練幾個環節。
 */
export function changedAttempt(
	action: Action,
	attempt: Attempt,
	marks: Record<string, Mark>
): { whole: boolean; marks: Record<string, Mark>; blanks?: string[] } {
	const rate = action.successRate;
	if (!attempt.whole || !rate) return keptAttempt(action, attempt.whole, marks);
	const blanks = attempt.blanks ?? [];
	const phasesThen = rate.phases.filter((p) => attempt.marks[p.id] || blanks.includes(p.id));
	const failGone = blanks.length > 0 && !phasesThen.some((p) => attempt.marks[p.id] === '✗');
	const explained = blankPhases({ ...action, successRate: { ...rate, phases: phasesThen } }, true, attempt.marks).blanks;
	/** 現在的環節照原本的記號算已經不空著的（刪掉別的環節後拍不再疊）：原本空著、這次也沒打的照樣空著。 */
	const orphans = blanks.filter((id) => !explained.includes(id) && !marks[id]);
	const stillBlank = failGone ? blanks : orphans;
	const open = phasesThen.filter((p) => !stillBlank.includes(p.id));
	const shut = new Set(rate.phases.filter((p) => !open.includes(p)).map((p) => p.id));
	const kept = keptAttempt(
		{ ...action, successRate: { ...rate, phases: open } },
		true,
		Object.fromEntries(Object.entries(marks).filter(([id]) => !shut.has(id)))
	);
	if (!stillBlank.length || !kept.whole) return kept;
	const empty = phasesThen.filter((p) => stillBlank.includes(p.id) || kept.blanks?.includes(p.id)).map((p) => p.id);
	return { ...kept, blanks: empty };
}

/**
 * 動作的紀錄裡對不上現在的環節、組、隊員的拿掉：指到不在的環節的記號和空著的環節丟掉，丟到記號和空著的環節都沒有的那一次整筆拿掉
 * （當時就有的環節全被刪光）；
 * 誰對不上（組沒人了、人不在動作裡、大類換成騰翻或換掉騰翻）的那一次也拿掉。都對得上就回傳原來的動作。
 */
export function fitRecords(action: Action): Action {
	const rate = action.successRate;
	if (!rate) return action;
	const phaseIds = new Set(rate.phases.map((p) => p.id));
	const records = rate.records.flatMap((r) => {
		if (!whoFits(action, r.who)) return [];
		const marks = Object.entries(r.marks).filter(([id]) => phaseIds.has(id));
		const blanks = r.blanks?.filter((id) => phaseIds.has(id));
		if (marks.length === Object.keys(r.marks).length && blanks?.length === r.blanks?.length) return [r];
		if (!marks.length && !blanks?.length) return [];
		return [{ ...withoutBlanks(r), marks: Object.fromEntries(marks), ...(blanks?.length && { blanks }) }];
	});
	const same = records.length === rate.records.length && records.every((r, i) => r === rate.records[i]);
	return same ? action : { ...action, successRate: { ...rate, records } };
}

/** 拿掉空著的環節（blanks），換上新的記號時用：新的空著的由算的人給，沒給就是沒有。 */
export function withoutBlanks<T extends { blanks?: string[] }>(attempt: T): Omit<T, 'blanks'> {
	const { blanks: _blanks, ...rest } = attempt;
	return rest;
}

/**
 * 空著的環節（blanks）對得上：整個做，至少一個、不重複，是現在的環節而且沒有記號。
 * 不要求還有 ✗：✗ 的那個環節刪掉以後，空著的照樣留著。
 */
function blanksFit(attempt: NewAttempt, phaseIds: Set<string>): boolean {
	const blanks = attempt.blanks ?? [];
	return (
		attempt.whole &&
		blanks.length > 0 &&
		new Set(blanks).size === blanks.length &&
		blanks.every((id) => phaseIds.has(id) && !attempt.marks[id])
	);
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
export function beatsProblem(segment: Segment, action: Action, beats: BeatRange): Why | null {
	if (segment.kind !== 'music') return { code: 'success_rate_chant_beats' };
	return rangeProblem('phase', action, beats);
}

/** 一組裡的人，照名單順序。 */
export function squadPeople(flow: Flow, action: Action, squad: string): Member[] {
	return flow.members.filter((member) => action.members.some((m) => m.memberId === member.id && m.squad === squad));
}

/**
 * 組的名字：「第 1 組 小美」，後面是組裡任務角色是上層的人；沒有上層用主底，也沒有主底就用組裡第一個人
 * （好幾個都照名單順序用第一個）。組裡沒有人就只叫「第 1 組」。
 */
export function squadName(flow: Flow, action: Action, squad: string): string {
	return zh(squadWhy(flow, action, squad));
}

/** squadName 的代號（畫面照語言寫）：組號和組裡那個人的名字（名字照教練取的）。 */
export function squadWhy(flow: Flow, action: Action, squad: string): Why {
	const people = squadPeople(flow, action, squad);
	const withRole = (role: string) =>
		people.find((member) => action.members.some((m) => m.memberId === member.id && m.squad === squad && m.role === role));
	const who = withRole('上層') ?? withRole('主底') ?? people[0];
	const n = squadNumber(action, squad);
	return who ? { code: 'success_rate_squad_named', n, name: who.name } : { code: 'success_rate_squad', n };
}

/** 流程裡全部環節的 id（發新 id 時用）。 */
export function allPhaseIds(flow: Flow): string[] {
	return flow.actions.flatMap((a) => a.successRate?.phases.map((p) => p.id) ?? []);
}
