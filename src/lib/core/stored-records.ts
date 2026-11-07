// 雲端流程的紀錄跟編排分開存，一次一筆（ADR 0008）。伺服器和前端都用這裡：
// 把分開存的紀錄放回流程（打開時、伺服器跑一步之前）、跑完再拿出來（伺服器照結果清掉、改掉該改的），
// 和伺服器收一次時「記一次」的檢查（教練可能在手機記的時候改了流程）。

import type { Action } from './action-types';
import type { Flow } from './flow';
import { isRandomId } from './ids';
import { attemptProblem, perPerson, type Attempt } from './success-rate';

/** 分開存的一次：記在哪個動作、那一次。 */
export interface StoredAttempt {
	actionId: string;
	attempt: Attempt;
}

/** 檢查的結果：照收（記號可能丟掉幾個），或整筆不存和原因。 */
export type CheckedAttempt = { kind: 'ok'; record: StoredAttempt } | { kind: 'dropped'; message: string };

/**
 * 把分開存的紀錄放回流程：每個記成功率的動作的紀錄換成給的那些（照給的順序）。
 * 指到不在的動作、不記成功率的動作的不放（存的時候就照規則檢查過，跑步時也跟著清）。
 */
export function putRecords(flow: Flow, records: StoredAttempt[]): Flow {
	const byAction = new Map<string, Attempt[]>();
	for (const { actionId, attempt } of records) byAction.set(actionId, [...(byAction.get(actionId) ?? []), attempt]);
	let changed = false;
	const actions = flow.actions.map((a) => {
		if (!a.successRate) return a;
		const own = byAction.get(a.id) ?? [];
		if (own.length === 0 && a.successRate.records.length === 0) return a;
		changed = true;
		return { ...a, successRate: { ...a.successRate, records: own } };
	});
	return changed ? { ...flow, actions } : flow;
}

/** 把紀錄拿出來：流程（每個動作的紀錄清空）和紀錄（照動作、照記的先後）。 */
export function takeRecords(flow: Flow): { flow: Flow; records: StoredAttempt[] } {
	const records = flow.actions.flatMap((a) => (a.successRate?.records ?? []).map((attempt) => ({ actionId: a.id, attempt })));
	return { flow: putRecords(flow, []), records };
}

/**
 * 伺服器收一次時的檢查（照記一次的規則）：打在不在的環節上的記號丟掉；丟光了、或動作、組、隊員不在了，整筆不存。
 * 一次的 id、全上 id 是手機發的亂數（ADR 0008、0011）。
 */
export function checkRecord(flow: Flow, record: StoredAttempt): CheckedAttempt {
	const dropped = (message: string): CheckedAttempt => ({ kind: 'dropped', message });
	const { actionId, attempt } = record;
	if (!isRandomId(attempt.id) || (attempt.runThroughId !== undefined && !isRandomId(attempt.runThroughId)))
		return dropped('一次的 id 不對');
	const action = flow.actions.find((a) => a.id === actionId);
	if (!action) return dropped('這個動作被刪掉了');
	if (!action.successRate) return dropped('這個動作不記成功率了');
	const fits = whoProblem(action, attempt.who);
	if (fits) return dropped(fits);
	const phaseIds = new Set(action.successRate.phases.map((p) => p.id));
	const marks = Object.entries(attempt.marks ?? {}).filter(([id]) => phaseIds.has(id));
	if (marks.length === 0 && Object.keys(attempt.marks ?? {}).length > 0) return dropped('記號打的環節都被刪掉了');
	const kept = marks.length === Object.keys(attempt.marks).length ? attempt : { ...attempt, marks: Object.fromEntries(marks) };
	const problem = attemptProblem(action, kept);
	if (problem) return dropped(problem);
	return { kind: 'ok', record: kept === attempt ? record : { actionId, attempt: kept } };
}

/** 誰對不上這個動作的原因；對得上是 null。 */
function whoProblem(action: Action, who: string): string | null {
	if (perPerson(action.category)) return action.members.some((m) => m.memberId === who) ? null : '這個隊員不在動作裡';
	return action.members.some((m) => m.squad === who) ? null : '這一組沒有人了';
}
