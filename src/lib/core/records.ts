// 成功率的紀錄：記一次、刪掉上一次，和復原、重做時把現在的紀錄帶過去、這一步清掉的紀錄加回來或再清一次。
// 紀錄存在動作的成功率設定裡（Action.successRate.records），一次一筆，照記的先後排。

import { actionWhy, actionSeconds, replaceAction, type Action } from './action-types';
import type { Flow } from './flow';
import { isRandomId, newId } from './ids';
import { blocked, ok, type CommandResult } from './result';
import { settle } from './settle';
import {
	attemptProblem,
	changedAttempt,
	keptAttempt,
	perPerson,
	squadName,
	squadPeople,
	squadsOf,
	withoutBlanks,
	type Attempt,
	type Mark,
	type NewAttempt,
	type PracticeKind
} from './success-rate';
import type { Why } from './why';

/** 記一次：給動作、誰、日期、練法、整個做或只練幾個環節、記號（存成 keptAttempt 給的樣子）。回傳新的一次的 id。 */
export function recordAttempt(
	flow: Flow,
	actionId: string,
	input: NewAttempt
): CommandResult<{ id: string }> {
	const action = flow.actions.find((a) => a.id === actionId);
	if (!action) return blocked({ code: 'records_no_action' });
	if (!action.successRate) return blocked({ code: 'records_not_recorded' });
	const kept = { ...withoutBlanks(input), ...keptAttempt(action, input.whole, input.marks) };
	const problem = attemptProblem(action, kept);
	if (problem) return blocked(problem);
	const attempt = { id: newId('t', attemptIds(flow)), ...kept };
	const records = [...action.successRate.records, attempt];
	return { kind: 'ok', flow: withRecords(flow, action, records), id: attempt.id };
}

/** 記一次全上裡的一格：一個動作、一組（騰翻、跳躍是一個人）的記號。 */
export interface RunThroughMarks {
	actionId: string;
	who: string;
	marks: Record<string, Mark>;
}

/**
 * 記一次全上：給日期、開的時間（手機的時間，毫秒）和每個動作、每組的記號（按了「沒做」的動作不給），一次存成很多次，
 * 都標成全上、帶同一個全上 id 和開的時間、都是整個做。每一次照記一次的規則檢查，有一次不對就一次都不存。
 * 給了 id（雲端流程一起記全上，#262：開表時手機發的、加入的人用開的人的）就用它，沒給發一個新的。
 */
export function recordRunThrough(
	flow: Flow,
	date: string,
	startedAt: number,
	entries: RunThroughMarks[],
	id?: string
): CommandResult<{ runThroughId: string }> {
	if (entries.length === 0) return blocked({ code: 'records_run_through_empty' });
	const runIds = flow.actions.flatMap((a) => a.successRate?.records.flatMap((r) => r.runThroughId ?? []) ?? []);
	const runThroughId = id ?? newId('r', runIds);
	let next = flow;
	for (const { actionId, who, marks } of entries) {
		const action = next.actions.find((a) => a.id === actionId);
		if (!action) return blocked({ code: 'records_no_action' });
		const run = { practice: 'runThrough', runThroughId, runThroughStartedAt: startedAt } as const;
		const r = recordAttempt(next, actionId, { date, who, ...run, whole: true, marks });
		if (r.kind !== 'ok') return blocked({ code: 'records_in_action', action: actionWhy(action), reason: r.why ?? r.message });
		next = r.flow;
	}
	return { kind: 'ok', flow: next, runThroughId };
}

/**
 * 刪掉上一次：拿掉這組（騰翻、跳躍是這個人）在這一天、這種練法（分段練或全上）最後記的一次。
 * 回傳刪掉的那一次和它原本在紀錄裡排第幾，給「救回」用。
 */
export function deleteLastAttempt(
	flow: Flow,
	actionId: string,
	who: string,
	date: string,
	practice: PracticeKind
): CommandResult<{ attempt: Attempt; index: number }> {
	const action = flow.actions.find((a) => a.id === actionId);
	const records = action?.successRate?.records ?? [];
	const index = records.findLastIndex((r) => r.who === who && r.date === date && r.practice === practice);
	if (!action || index < 0) return blocked({ code: 'records_none_that_day' });
	return {
		kind: 'ok',
		flow: withRecords(flow, action, records.toSpliced(index, 1)),
		attempt: records[index],
		index
	};
}

/**
 * 改某一次的記號（點歷史裡的那一次）：還在原來的位置、id、日期、誰、練法都不變；只看那一次當時就有的環節、照記一次的規則留（changedAttempt），
 * 原本整個做、改了卻空了一格就變只練幾個環節。全上的一次一定整個做，該有記號的空了一格就擋下來（空著的環節不用有記號）。
 */
export function changeAttempt(
	flow: Flow,
	actionId: string,
	attemptId: string,
	marks: Record<string, Mark>
): CommandResult {
	const action = flow.actions.find((a) => a.id === actionId);
	const records = action?.successRate?.records ?? [];
	const index = records.findIndex((r) => r.id === attemptId);
	if (!action || index < 0) return blocked({ code: 'records_attempt_not_found' });
	const attempt = { ...withoutBlanks(records[index]), ...changedAttempt(action, records[index], marks) };
	if (attempt.practice === 'runThrough' && !attempt.whole && Object.keys(attempt.marks).length)
		return blocked({ code: 'records_run_through_marks' });
	const problem = attemptProblem(action, attempt);
	if (problem) return blocked(problem);
	return ok(withRecords(flow, action, records.toSpliced(index, 1, attempt)));
}

/** 刪掉某一次（點歷史裡的那一次，全上的也只刪這一次）。回傳刪掉的那一次和它原本排第幾，給「救回」用。 */
export function deleteAttempt(
	flow: Flow,
	actionId: string,
	attemptId: string
): CommandResult<{ attempt: Attempt; index: number }> {
	const action = flow.actions.find((a) => a.id === actionId);
	const records = action?.successRate?.records ?? [];
	const index = records.findIndex((r) => r.id === attemptId);
	if (!action || index < 0) return blocked({ code: 'records_attempt_not_found' });
	return { kind: 'ok', flow: withRecords(flow, action, records.toSpliced(index, 1)), attempt: records[index], index };
}

/** 救回剛刪掉的那一次：放回原本排第幾（之後又記的排在它後面），照記一次的規則檢查；已經在了就擋下來。 */
export function restoreAttempt(flow: Flow, actionId: string, attempt: Attempt, index: number): CommandResult {
	const action = flow.actions.find((a) => a.id === actionId);
	if (!action?.successRate) return blocked({ code: 'records_no_action' });
	if (attemptIds(flow).includes(attempt.id)) return blocked({ code: 'records_attempt_exists' });
	const problem = attemptProblem(action, attempt);
	if (problem) return blocked(problem);
	return ok(withRecords(flow, action, action.successRate.records.toSpliced(index, 0, attempt)));
}

/** 刪掉的一次全上：每一次記在哪個動作、原本排第幾（照排第幾由小到大），給「救回」用。 */
export type RemovedRunThrough = { actionId: string; attempt: Attempt; index: number }[];

/**
 * 這天的每次全上（全上 id），照第幾次排：照開的時間排；舊的沒有開的時間，照舊的號碼排（r2 在 r10 前面），
 * 排在有開的時間的前面。開的時間一樣的照號碼、再照 id 排，所以每台算出來一樣。
 */
export function runThroughsOn(flow: Flow, date: string): string[] {
	const runs = new Map<string, number | undefined>();
	for (const a of flow.actions) {
		for (const r of a.successRate?.records ?? []) {
			if (r.date === date && r.runThroughId !== undefined) runs.set(r.runThroughId, r.runThroughStartedAt);
		}
	}
	const legacyNumber = (id: string) => (isRandomId(id) ? 0 : Number(id.slice(1)) || 0);
	return [...runs]
		.sort(
			([a, at], [b, bt]) =>
				Number(at !== undefined) - Number(bt !== undefined) ||
				(at ?? 0) - (bt ?? 0) ||
				legacyNumber(a) - legacyNumber(b) ||
				(a < b ? -1 : a > b ? 1 : 0)
		)
		.map(([id]) => id);
}

/** 這天有沒有全上：有就回傳這天最後一次全上（照 runThroughsOn 排）的 id，沒有是 undefined。 */
export function lastRunThrough(flow: Flow, date: string): string | undefined {
	return runThroughsOn(flow, date).at(-1);
}

/** 刪掉上一次全上：拿掉這一天最後存的那次全上（lastRunThrough），整次一起拿（每個動作、每組的都拿掉，不拆開）。 */
export function deleteLastRunThrough(flow: Flow, date: string): CommandResult<{ removed: RemovedRunThrough }> {
	const last = lastRunThrough(flow, date);
	if (last === undefined) return blocked({ code: 'records_no_run_through_that_day' });
	const removed: RemovedRunThrough = [];
	let next = flow;
	for (const action of flow.actions) {
		const records = action.successRate?.records ?? [];
		if (!records.some((r) => r.runThroughId === last)) continue;
		records.forEach((attempt, index) => {
			if (attempt.runThroughId === last) removed.push({ actionId: action.id, attempt, index });
		});
		next = withRecords(next, action, records.filter((r) => r.runThroughId !== last));
	}
	return { kind: 'ok', flow: next, removed };
}

/**
 * 刪掉這幾次（雲端流程記錄者的「刪掉我上一次全上記的」：只刪自己在那次記的組）。
 * 回傳刪掉的每一次和原本排第幾，給「救回」（restoreRunThrough）用。
 */
export function deleteAttempts(flow: Flow, ids: string[]): CommandResult<{ removed: RemovedRunThrough }> {
	const removed: RemovedRunThrough = [];
	let next = flow;
	for (const action of flow.actions) {
		const records = action.successRate?.records ?? [];
		if (!records.some((r) => ids.includes(r.id))) continue;
		records.forEach((attempt, index) => {
			if (ids.includes(attempt.id)) removed.push({ actionId: action.id, attempt, index });
		});
		next = withRecords(next, action, records.filter((r) => !ids.includes(r.id)));
	}
	if (removed.length === 0) return blocked({ code: 'records_attempts_not_found' });
	return { kind: 'ok', flow: next, removed };
}

/** 救回剛刪掉的那次全上：整次放回原本排第幾，每一次照記一次的規則檢查；有一次放不回去就一次都不放。 */
export function restoreRunThrough(flow: Flow, removed: RemovedRunThrough): CommandResult {
	const ids = attemptIds(flow);
	if (removed.some((r) => ids.includes(r.attempt.id))) return blocked({ code: 'records_run_through_exists' });
	let next = flow;
	for (const { actionId, attempt, index } of removed) {
		const r = restoreAttempt(next, actionId, attempt, index);
		if (r.kind !== 'ok') return r;
		next = r.flow;
	}
	return ok(next);
}

/**
 * 把現在的紀錄帶到這份流程上：復原、重做換上 next 時用。紀錄不算復原的一步，所以每個動作的紀錄用 current 的；
 * 指到 next 裡已經不在的動作、環節、組 id、隊員的紀錄或記號丟掉，丟到一個記號都沒有的那一次整筆拿掉。
 * 那一步自己清掉的紀錄由 undoRecords 加回來、redoRecords 再清一次（ADR 0007）。
 * 沒有東西要帶就回傳 next 本身。
 */
export function carryRecords(next: Flow, current: Flow): Flow {
	let changed = false;
	const actions = next.actions.map((a) => {
		if (!a.successRate) return a;
		const from = current.actions.find((c) => c.id === a.id);
		const records = from?.successRate?.records ?? [];
		const own = a.successRate.records;
		if (records === own || (records.length === 0 && own.length === 0)) return a;
		changed = true;
		// 照組 id 帶，不問、不換組：組裡的人變了紀錄還是留在那個組 id 上；組 id 不在了等對不上的由收尾拿掉。
		const settled = settle(next, a, { ...a, successRate: { ...a.successRate, records } }, { records: 'keep' });
		return settled.kind === 'ok' ? settled.action : a;
	});
	return changed ? { ...next, actions } : next;
}

/**
 * 一步改動拿掉的紀錄（ADR 0007）：每個動作改之前、改之後的紀錄，只放有拿掉東西的動作
 * （整筆拿掉的一次，或還在但少了記號、空著的環節的一次）。
 */
export type RecordsPatch = { actionId: string; before: Attempt[]; after: Attempt[] }[];

/** 從改之前、改之後的流程算出這一步拿掉了哪些紀錄：有一次整筆不見、少了記號或空著的環節的動作。 */
export function recordsPatch(before: Flow, after: Flow): RecordsPatch {
	return before.actions.flatMap((action) => {
		const beforeRecords = action.successRate?.records ?? [];
		const afterRecords = after.actions.find((a) => a.id === action.id)?.successRate?.records ?? [];
		const afterById = byId(afterRecords);
		const lost = beforeRecords.some((beforeRec) => {
			const afterRec = afterById.get(beforeRec.id);
			return !afterRec || lostMarks(beforeRec, afterRec).length > 0 || lostBlanks(beforeRec, afterRec).length > 0;
		});
		return lost ? [{ actionId: action.id, before: beforeRecords, after: afterRecords }] : [];
	});
}

/**
 * 一個動作的紀錄從 was 變成 now 清掉了什麼（確認框寫的次數）：整筆不見的（removed），
 * 和還在但少了記號的（stripped，改之前的樣子）。只少了空著的環節的不算，成功率不會變。
 */
export function recordsLoss(was: Attempt[], now: Attempt[]): { removed: Attempt[]; stripped: Attempt[] } {
	const after = new Map(now.map((r) => [r.id, r]));
	const removed = was.filter((r) => !after.has(r.id));
	const stripped = was.filter((r) => {
		const a = after.get(r.id);
		return a && lostMarks(r, a).length > 0;
	});
	return { removed, stripped };
}

/**
 * 確認框裡清掉多少紀錄：「一起清掉 2 次紀錄和 1 次的記號」「清掉 1 次的記號」；沒有清掉是 null。
 * 包在別的原因裡（英文是小寫開頭的一句「clears 2 reps…」），次數英文分一次、好幾次。
 */
export function recordsLossText(records: number, marks: number): Why | null {
	const reps: Why = { code: records === 1 ? 'records_reps_one' : 'records_reps', n: records };
	const marked: Why = { code: marks === 1 ? 'records_marks_one' : 'records_marks', n: marks };
	if (records) return marks ? { code: 'records_loss_both', reps, marks: marked } : { code: 'records_loss_reps', reps };
	return marks ? { code: 'records_loss_marks', marks: marked } : null;
}

/**
 * 復原一步：換上改之前的流程（before），帶著現在的紀錄（carryRecords），再把這一步（before → after）拿掉的紀錄加回去。
 * 加回去的照原本的先後排，之後才記的排在後面；這一步之後用「記」刪掉的不加回。
 */
export function undoRecords(before: Flow, after: Flow, current: Flow): Flow {
	return replayRecords(before, before, after, current, (action, currentRecords, lost) => {
		const currentById = byId(currentRecords);
		const afterById = byId(lost.after);
		const restored = lost.before.flatMap((beforeRec) => {
			const currentRec = currentById.get(beforeRec.id);
			const afterRec = afterById.get(beforeRec.id);
			if (!currentRec) return afterRec ? [] : [beforeRec];
			if (!afterRec || sameAttempt(currentRec, afterRec)) return [afterRec ? beforeRec : currentRec];
			return [putBack(action, beforeRec, afterRec, currentRec)];
		});
		const later = currentRecords.filter((r) => !lost.before.some((beforeRec) => beforeRec.id === r.id));
		return [...restored, ...later];
	});
}

/** 重做一步：換上改之後的流程（after），帶著現在的紀錄，再把這一步（before → after）拿掉的紀錄拿掉一次。 */
export function redoRecords(before: Flow, after: Flow, current: Flow): Flow {
	return replayRecords(after, before, after, current, (_action, currentRecords, lost) => {
		const beforeById = byId(lost.before);
		const afterById = byId(lost.after);
		return currentRecords.flatMap((currentRec) => {
			const beforeRec = beforeById.get(currentRec.id);
			const afterRec = afterById.get(currentRec.id);
			if (!beforeRec) return [currentRec];
			if (!afterRec) return [];
			if (sameAttempt(currentRec, beforeRec) || sameAttempt(currentRec, afterRec)) return [afterRec];
			return stripAgain(currentRec, beforeRec, afterRec);
		});
	});
}

/**
 * 復原、重做共用的骨架：換上 base（復原是 before、重做是 after），帶著現在的紀錄；
 * 這一步（before → after）拿掉紀錄的每個動作，紀錄換成 fix 給的（傳入那個動作現在的紀錄和這一步拿掉了什麼）。
 */
function replayRecords(
	base: Flow,
	before: Flow,
	after: Flow,
	current: Flow,
	fix: (action: Action, currentRecords: Attempt[], lost: RecordsPatch[number]) => Attempt[]
): Flow {
	let flow = carryRecords(base, current);
	for (const lost of recordsPatch(before, after)) {
		const action = flow.actions.find((a) => a.id === lost.actionId);
		if (!action?.successRate) continue;
		flow = withRecords(flow, action, fix(action, action.successRate.records, lost));
	}
	return flow;
}

/** 一次一次照 id 找。 */
const byId = (records: Attempt[]) => new Map(records.map((r) => [r.id, r]));

/** b 有、a 沒有的記號（環節 id）。 */
const lostMarks = (b: Attempt, a: Attempt) => Object.keys(b.marks).filter((id) => !(id in a.marks));
/** b 有、a 沒有的空著的環節。 */
const lostBlanks = (b: Attempt, a: Attempt) => (b.blanks ?? []).filter((id) => !a.blanks?.includes(id));

const sameAttempt = (x: Attempt, y: Attempt) => x === y || JSON.stringify(x) === JSON.stringify(y);

/**
 * 這一步之後用「記」改過的一次（c）：把這一步拿掉的記號、空著的環節（b 有、a 沒有）加回去。
 * 加回去不守記一次的規則（例：改成只練幾個環節了）就照 c 留著。
 */
function putBack(action: Action, b: Attempt, a: Attempt, c: Attempt): Attempt {
	const marks = { ...c.marks, ...Object.fromEntries(lostMarks(b, a).map((id) => [id, b.marks[id]])) };
	const blanks = [...(c.blanks ?? []), ...lostBlanks(b, a)];
	const merged = { ...withoutBlanks(c), marks, ...(blanks.length && { blanks }) };
	return attemptProblem(action, merged) ? c : merged;
}

/** 復原之後用「記」改過的一次（r）：再拿掉一次這一步拿掉的記號、空著的環節；拿到都沒有就整筆拿掉。 */
function stripAgain(r: Attempt, b: Attempt, a: Attempt): Attempt[] {
	const marks = lostMarks(b, a);
	const blanks = lostBlanks(b, a);
	const kept = Object.entries(r.marks).filter(([id]) => !marks.includes(id));
	const left = r.blanks?.filter((id) => !blanks.includes(id)) ?? [];
	if (!kept.length && !left.length) return [];
	return [{ ...withoutBlanks(r), marks: Object.fromEntries(kept), ...(left.length && { blanks: left }) }];
}

/** 練習畫面要記的動作：有環節的，照流程順序（開始的時間）排。 */
export function recordableActions(flow: Flow): Action[] {
	return flow.actions
		.filter((a) => a.successRate?.phases.length)
		.map((action) => ({ action, ...actionSeconds(flow, action) }))
		.sort((a, b) => a.startSec - b.startSec)
		.map((a) => a.action);
}

/**
 * 動作裡記一次的「誰」，一個一張卡：分組的動作是現在有人的組（who 是組 id），照組號排，名字是「第 1 組 小美」；
 * people 是全組的名字（照名單順序）；騰翻、跳躍是動作裡的每個人，照名單順序，沒有 people。沒分到組的人不算。
 */
export function attemptWhos(flow: Flow, action: Action): { who: string; name: string; people?: string[] }[] {
	if (perPerson(action.category)) {
		return flow.members
			.filter((m) => action.members.some((am) => am.memberId === m.id))
			.map((m) => ({ who: m.id, name: m.name }));
	}
	return squadsOf(action).map((squad) => ({
		who: squad,
		name: squadName(flow, action, squad),
		people: squadPeople(flow, action, squad).map((m) => m.name)
	}));
}

/** 整個做的一次，碰到那一次之後才加的環節寫這個（跟成功率表沒紀錄的「—」一樣），不寫像空著、像沒成功的「·」。 */
export const NOT_YET_MARK = '—';
/** 一次的記號裡有 NOT_YET_MARK 時，滑鼠移上去看到的說明。 */
export const NOT_YET_TITLE: Why = { code: 'records_not_yet' };

/**
 * 一次寫成一排記號，照環節順序，空的寫「·」，例：✓✓△、✗··。
 * 整個做的一次，那時還沒有的環節（沒記號、也不是空著的 blanks）寫 NOT_YET_MARK，例：✓✓—。
 */
export function attemptText(action: Action, attempt: Attempt): string {
	const notYet = (id: string) => attempt.whole && !attempt.blanks?.includes(id);
	return (action.successRate?.phases ?? [])
		.map((p) => attempt.marks[p.id] ?? (notYet(p.id) ? NOT_YET_MARK : '·'))
		.join('');
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
