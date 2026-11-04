// 成功率的紀錄：記一次、刪掉上一次，和復原、重做時把現在的紀錄帶過去。
// 紀錄存在動作的成功率設定裡（Action.successRate.records），一次一筆，照記的先後排。

import { actionLabel, actionSeconds, replaceAction, type Action } from './actions';
import type { Flow } from './flow';
import { freshIds } from './ids';
import { blocked, ok, type CommandResult } from './result';
import {
	attemptProblem,
	fitRecords,
	perPerson,
	squadName,
	type Attempt,
	type Mark,
	type NewAttempt
} from './success-rate';

/** 記一次：給動作、誰、日期、練法、整個做或只練幾個環節、記號。回傳新的一次的 id。 */
export function recordAttempt(
	flow: Flow,
	actionId: string,
	input: NewAttempt
): CommandResult<{ id: string }> {
	const action = flow.actions.find((a) => a.id === actionId);
	if (!action) return blocked('找不到這個動作');
	if (!action.successRate) return blocked('這個動作沒有記成功率');
	const problem = attemptProblem(action, input);
	if (problem) return blocked(problem);
	const issued = freshIds('t', 1, flow.lastIds, attemptIds(flow));
	const attempt = { id: issued.ids[0], ...input };
	const records = [...action.successRate.records, attempt];
	return { kind: 'ok', flow: withRecords({ ...flow, lastIds: issued.lastIds }, action, records), id: attempt.id };
}

/** 記一次全上裡的一格：一個動作、一組（騰翻、跳躍是一個人）的記號。 */
export interface RunThroughMarks {
	actionId: string;
	who: number | string;
	marks: Record<string, Mark>;
}

/**
 * 記一次全上：給日期和每個動作、每組的記號（按了「沒做」的動作不給），一次存成很多次，
 * 都標成全上、帶同一個全上 id（刪了也不重用，例：r2）、都是整個做。每一次照記一次的規則檢查，有一次不對就一次都不存。
 */
export function recordRunThrough(
	flow: Flow,
	date: string,
	entries: RunThroughMarks[]
): CommandResult<{ runThroughId: string }> {
	if (entries.length === 0) return blocked('每個動作都沒做，沒有要存的');
	const runIds = flow.actions.flatMap((a) => a.successRate?.records.flatMap((r) => r.runThroughId ?? []) ?? []);
	const run = freshIds('r', 1, flow.lastIds, runIds);
	const runThroughId = run.ids[0];
	let next: Flow = { ...flow, lastIds: run.lastIds };
	for (const { actionId, who, marks } of entries) {
		const action = next.actions.find((a) => a.id === actionId);
		if (!action) return blocked('找不到這個動作');
		const r = recordAttempt(next, actionId, { date, who, practice: 'runThrough', runThroughId, whole: true, marks });
		if (r.kind !== 'ok') return blocked(`${actionLabel(action)}：${r.message}`);
		next = r.flow;
	}
	return { kind: 'ok', flow: next, runThroughId };
}

/** 刪掉上一次：拿掉這組（騰翻、跳躍是這個人）在這一天最後記的一次。 */
export function deleteLastAttempt(
	flow: Flow,
	actionId: string,
	who: number | string,
	date: string
): CommandResult {
	const action = flow.actions.find((a) => a.id === actionId);
	const records = action?.successRate?.records ?? [];
	const last = records.findLast((r) => r.who === who && r.date === date);
	if (!action || !last) return blocked('這一天還沒有紀錄');
	return ok(withRecords(flow, action, records.filter((r) => r !== last)));
}

/**
 * 把現在的紀錄帶到這份流程上：復原、重做換上 next 時用。紀錄不算復原的一步，所以每個動作的紀錄用 current 的；
 * 指到 next 裡已經不在的動作、環節、組、隊員的紀錄或記號丟掉，丟到一個記號都沒有的那一次整筆拿掉（重做也救不回）。
 * 發過的 id 號碼也帶過來，免得換上舊的流程後又發一次。沒有東西要帶就回傳 next 本身。
 */
export function carryRecords(next: Flow, current: Flow): Flow {
	const lastIds = higherIds(next.lastIds, current.lastIds);
	let changed = lastIds !== next.lastIds;
	const actions = next.actions.map((a) => {
		if (!a.successRate) return a;
		const records = current.actions.find((c) => c.id === a.id)?.successRate?.records ?? [];
		const own = a.successRate.records;
		if (records === own || (records.length === 0 && own.length === 0)) return a;
		changed = true;
		return fitRecords({ ...a, successRate: { ...a.successRate, records } });
	});
	return changed ? { ...next, actions, ...(lastIds && { lastIds }) } : next;
}

/** 兩份「id 發到第幾號」取大的；跟 a 一樣就回傳 a。 */
function higherIds(
	a: Record<string, number> | undefined,
	b: Record<string, number> | undefined
): Record<string, number> | undefined {
	const higher = Object.entries(b ?? {}).filter(([k, n]) => n > (a?.[k] ?? 0));
	return higher.length ? { ...a, ...Object.fromEntries(higher) } : a;
}

/** 練習畫面要記的動作：有打開記成功率、而且至少有一個環節的，照流程順序（開始的時間）排。 */
export function recordableActions(flow: Flow): Action[] {
	return flow.actions
		.filter((a) => a.successRate?.phases.length)
		.map((action) => ({ action, ...actionSeconds(flow, action) }))
		.sort((a, b) => a.startSec - b.startSec)
		.map((a) => a.action);
}

/**
 * 動作裡記一次的「誰」，一個一張卡：分組的動作是現在有人的組，照號碼排，名字是「第 1 組 小美」；
 * 騰翻、跳躍是動作裡的每個人，照名單順序。沒分到組的人不算。
 */
export function attemptWhos(flow: Flow, action: Action): { who: number | string; name: string }[] {
	if (perPerson(action.category)) {
		return flow.members
			.filter((m) => action.members.some((am) => am.memberId === m.id))
			.map((m) => ({ who: m.id, name: m.name }));
	}
	const squads = [...new Set(action.members.flatMap((m) => (m.squad === undefined ? [] : [m.squad])))];
	return squads.sort((a, b) => a - b).map((squad) => ({ who: squad, name: squadName(flow, action, squad) }));
}

/** 一次寫成一排記號，照環節順序，空的寫「·」，例：✓✓△、✗··。 */
export function attemptText(action: Action, attempt: Attempt): string {
	return (action.successRate?.phases ?? []).map((p) => attempt.marks[p.id] ?? '·').join('');
}

/** 換掉一個動作的紀錄（動作一定有記成功率）。 */
function withRecords(flow: Flow, action: Action, records: Attempt[]): Flow {
	const changed = { ...action, successRate: { ...action.successRate!, records } };
	return replaceAction(flow, changed);
}

/** 流程裡全部一次的 id。 */
function attemptIds(flow: Flow): string[] {
	return flow.actions.flatMap((a) => a.successRate?.records.map((r) => r.id) ?? []);
}
