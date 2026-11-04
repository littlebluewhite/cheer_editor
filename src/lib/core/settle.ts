// 成功率收尾：一個動作改了之後，它的環節、組、紀錄怎麼收。
// 順序固定在這裡：拿掉對不上的紀錄 → 算要問什麼 → 照回答清掉 → 換上新的環節 → 組的規則 → 成功率規則檢查。
// 指令只給改之前、改好的動作和教練的回答，拿回收好的動作和有結構的後果；要問的話由 falloutQuestion 組字。

import { ACTION_CATEGORIES, actionLabel, type Action } from './action-types';
import type { Flow } from './flow';
import { phaseFallout, phaseFalloutText, type PhaseFallout } from './phase-beats';
import { answered, needsChoice, needsConfirm, type CommandResult, type ConfirmOption } from './result';
import type { Segment } from './segment';
import {
	compactSquads,
	fitRecords,
	groupsPeople,
	perPerson,
	recordItems,
	squadsOf,
	replacePhases,
	successRateProblem,
	withoutRecords,
	type Attempt
} from './success-rate';

/** 改動作的後果（給 falloutQuestion 組字）。 */
export interface Fallout {
	/** 標的拍：切短、刪掉的環節；沒動到是 null。 */
	phases: PhaseFallout | null;
	/** 一定清掉的紀錄：組沒人了、騰翻跳躍的人移出、算法從一組一起變成每個人自己算或反過來。 */
	lost: Attempt[];
	/** 有紀錄的組換了人：要選保留舊紀錄還是清掉重算的那些紀錄（照改好的動作算）。 */
	changed: Attempt[];
}

/** 改動作的拍點後果（見 cueFallout）。 */
export interface CueFallout {
	removed: number;
	cut: number;
	orphaned: number;
	items: string[];
}

export type Settled = { kind: 'ok'; action: Action; fallout: Fallout } | { kind: 'blocked'; message: string };

/**
 * 收尾：before 是改之前的動作（加動作時沒有），after 是指令改好的動作（人、大類、段、拍點都改好了）。
 * 照回答清掉換了人的組的紀錄（選了清掉才清；一定清掉的不管回答都拿掉）；動作變短、拖到半拍、換段時標的拍跟著切短或刪掉；
 * 開始分組時全部的人進第 1 組，只有一組時新進、沒帶組的人進那一組（見 squadRules）；
 * 不分組的動作（沒有環節、騰翻、跳躍）人身上的組拿掉；組號補成 1、2、3 不跳號，紀錄跟著換號。
 * 回收好的動作和後果；不守成功率規則就擋。要不要問、怎麼問由 falloutQuestion 決定。
 */
export function settle(flow: Flow, before: Action | undefined, after: Action, answer: ConfirmOption = {}): Settled {
	const to = flow.segments.find((s) => s.id === after.segmentId);
	if (!to) return { kind: 'blocked', message: '找不到這一段' };
	const from = before && flow.segments.find((s) => s.id === before.segmentId);
	const fitted = fitRecords(squadRules(before, after));
	const { lost, changed } = before ? recordsFallout(before, fitted) : { lost: [], changed: [] };
	const settled = answer.records === 'clear' ? withoutRecords(fitted, changed) : fitted;
	const phases = before && from ? phaseFallout(from, to, before, settled) : null;
	const grouped = ungroup(phases ? replacePhases(settled, phases.phases) : settled);
	// 補號之前檢查：0、負數、小數的組號要擋，不能被補號蓋掉。合法的組號補完還是合法。
	const problem = successRateProblem(to, grouped);
	if (problem) return { kind: 'blocked', message: problem };
	return { kind: 'ok', action: compactSquads(grouped), fallout: { phases, lost, changed } };
}

/**
 * 組的規則（先放好組，再算紀錄的後果，所以換了人的組照樣會問）：
 * 開始分組（改之前不分組、改之後分組：加了第一個環節，或大類從騰翻、跳躍換成要分組的）時，動作裡的人全部進第 1 組；
 * 新進動作、沒帶組的人，動作只有一組就進那一組，有好幾組或還沒有組就沒有組。帶著組進來的人照號碼對（補號時跟著補）。
 */
function squadRules(before: Action | undefined, after: Action): Action {
	if (!groupsPeople(after)) return after;
	if (before && !groupsPeople(before)) {
		return { ...after, members: after.members.map((m) => ({ ...m, squad: 1 })) };
	}
	const squads = squadsOf(after);
	const isNew = (memberId: string) => !before?.members.some((m) => m.memberId === memberId);
	if (squads.length !== 1 || !after.members.some((m) => m.squad === undefined && isNew(m.memberId))) return after;
	const members = after.members.map((m) => (m.squad === undefined && isNew(m.memberId) ? { ...m, squad: squads[0] } : m));
	return { ...after, members };
}

/** 不分組的動作（沒有環節、騰翻、跳躍）人身上的組拿掉（例：從別的動作複製人、大類換成騰翻）。 */
function ungroup(action: Action): Action {
	if (groupsPeople(action) || action.members.every((m) => m.squad === undefined)) return action;
	return { ...action, members: action.members.map(({ squad: _, ...m }) => m) };
}

/** 紀錄的後果：next 是已經拿掉對不上的紀錄（fitRecords）的動作，拿掉的那些是 lost；組還有人但換了人的組的紀錄是 changed。 */
function recordsFallout(old: Action, next: Action): { lost: Attempt[]; changed: Attempt[] } {
	const kept = new Set(next.successRate?.records.map((r) => r.id));
	const lost = (old.successRate?.records ?? []).filter((r) => !kept.has(r.id));
	const changed = perPerson(next.category)
		? []
		: (next.successRate?.records ?? []).filter((r) => !sameSquad(old, next, r.who));
	return { lost, changed };
}

/** 這一組在改之前、改之後是不是同一群人。 */
function sameSquad(old: Action, next: Action, who: number | string): boolean {
	const ids = (a: Action) =>
		a.members
			.filter((m) => m.squad === who)
			.map((m) => m.memberId)
			.sort()
			.join();
	return ids(old) === ids(next);
}

/**
 * 改動作的後果要先問教練時的問題；回答過了、或沒有要問的是 null。拍點、標的拍、紀錄的後果都在這裡拼成給教練看的句子：
 * 有紀錄會動到時跟拍點、標的拍一起問（換了人的組要選保留或清掉，其他是要確認）；只動到拍點或標的拍是要確認。
 * after 是收好的動作。
 */
export function falloutQuestion(
	flow: Flow,
	before: Action,
	after: Action,
	cues: CueFallout | null,
	{ phases, lost, changed }: Fallout,
	answer: ConfirmOption
): CommandResult | null {
	if (answered(answer)) return null;
	// 只挪半拍、沒切到的標的拍不用問；換到口號段拿掉標的拍也不用問。
	const marked = phases?.items.length ? phases : null;
	const from = flow.segments.find((s) => s.id === before.segmentId);
	const to = flow.segments.find((s) => s.id === after.segmentId);
	const asked = (cues || marked) && from && to ? falloutMessage(before, after, from, to, cues, marked) : null;
	const items = [...(cues?.items ?? []), ...(marked?.items ?? [])];
	if (lost.length || changed.length) {
		const head = asked ? `${asked}；` : `動作「${actionLabel(before)}」`;
		const message = head + recordsMessage(before, after, lost, changed);
		const records = [...recordItems(flow, before, lost), ...recordItems(flow, before, changed)];
		return (changed.length ? needsChoice : needsConfirm)(message, [...items, ...records]);
	}
	return asked ? needsConfirm(asked, items) : null;
}

/** 「換了人，會清掉 2 次紀錄；有紀錄的組換了人：保留舊紀錄，還是清掉重算？」；換了算法是「換成騰翻，變成每個人自己算，會清掉…」。 */
function recordsMessage(old: Action, next: Action, lost: Attempt[], changed: Attempt[]): string {
	const category = ACTION_CATEGORIES.find((c) => c.key === next.category)?.label ?? '';
	const why =
		perPerson(old.category) === perPerson(next.category)
			? '換了人'
			: `換成${category}，變成${perPerson(next.category) ? '每個人自己算' : '一組一起算'}`;
	return [
		lost.length ? `${why}，會清掉 ${lost.length} 次紀錄` : '',
		changed.length ? '有紀錄的組換了人：保留舊紀錄，還是清掉重算？' : ''
	]
		.filter(Boolean)
		.join('；');
}

/**
 * 「動作「技巧·Lib」變短，會拿掉 1 個、切短 1 個拍點」；換了人或任務角色是「…換了人或任務角色，會拿掉 N 個拍點」，
 * 兩個都有就「…變短、換了人或任務角色，…」；換到口號段是「…換到口號段，會拿掉 N 個拍點」。
 * 也動到環節標的拍時接在後面：「…拍點，刪掉 1 個環節」；只動到標的拍是「…變短，會切短 1 個環節標的拍」，
 * 拖到半拍上、標的拍對齊整拍時切到是「…拖到半拍上，會切短 1 個環節標的拍」。
 */
function falloutMessage(
	old: Action,
	action: Action,
	from: Segment,
	to: Segment,
	cues: CueFallout | null,
	phases: PhaseFallout | null
): string {
	const label = `動作「${actionLabel(action)}」`;
	const shorter = action.length < old.length ? '變短' : '';
	const offBeat = phases?.shifted ? '拖到半拍上' : '';
	if (!cues) {
		const why =
			to.kind !== 'music'
				? '換到口號段'
				: from.kind !== 'music'
					? '換到音樂段'
					: [shorter, offBeat].filter(Boolean).join('、');
		return `${label}${why}，會${phaseFalloutText(phases!)}`;
	}
	const more = phases ? `，${phaseFalloutText(phases)}` : '';
	if (to.kind !== 'music') return `${label}換到口號段，會拿掉 ${cues.removed} 個拍點${more}`;
	const why = [shorter, cues.orphaned ? '換了人或任務角色' : '', offBeat].filter(Boolean);
	const parts = [cues.removed ? `拿掉 ${cues.removed} 個` : '', cues.cut ? `切短 ${cues.cut} 個` : ''].filter(Boolean);
	return `${label}${why.join('、')}，會${parts.join('、')}拍點${more}`;
}
