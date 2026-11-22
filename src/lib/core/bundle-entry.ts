// 打包流程核心的入口（scripts/core-bundle.mjs）：伺服器用 QuickJS 跑這一包（ADR 0013）。
// 進出伺服器的都是 JSON 字串，所以多一個收 JSON、回 JSON 的版本。

import {
	amendRecords,
	applyRemoteChange,
	checkFlowDocument,
	checkRecord,
	flowProblem,
	putRecords,
	receiveRecords,
	remoteChange,
	runTogether,
	runViews,
	runCommands,
	runUndo,
	said,
	stepKeys,
	takeRecords,
	takeStep,
	type AmendAsk,
	type Command,
	type Flow,
	type RecordsAsk,
	type RemoteChange,
	type RunEvent,
	type RunsTogether,
	type StepAsk,
	type StoredAttempt
} from './index';

export * from './index';

/**
 * runCommands 的 JSON 版：flow 是流程（沒有開著的流程是 null）、commands 是指令串、stepId 是步驟 id（字串，不是 JSON），
 * 回結果的 JSON。
 */
export function runCommandsJson(flow: string, commands: string, stepId: string): string {
	return JSON.stringify(runCommands(JSON.parse(flow) as Flow | null, JSON.parse(commands) as Command[], stepId));
}

/** remoteChange 的 JSON 版：改之前、改之後的流程 → 要送給房間裡其他人的改動（#253）。 */
export function remoteChangeJson(before: string, after: string): string {
	return JSON.stringify(remoteChange(JSON.parse(before) as Flow, JSON.parse(after) as Flow));
}

/** applyRemoteChange 的 JSON 版（伺服器測試用：別人收到的改動套上去跟伺服器一樣）。 */
export function applyRemoteChangeJson(flow: string, change: string): string {
	return JSON.stringify(applyRemoteChange(JSON.parse(flow) as Flow, JSON.parse(change) as RemoteChange));
}

/**
 * 雲端流程跑一步（ADR 0011）：先把分開存的紀錄（records，StoredAttempt[] 的 JSON）放回編排，跑完再拿出來。
 * 成功時結果的 flow 是不帶紀錄的編排，多一個 records：跑完還在的紀錄（清掉的不在、記號可能少了），
 * 和 keys、watch：這一步記下的鍵、要查別的分頁改過沒有的鍵（stepKeys，#254）。
 * #351 以前伺服器的改、刪、救回每筆叫它一次；現在伺服器叫 amendRecordsJson，這個只留給伺服器量時間比以前的做法。
 */
export function runStepJson(flow: string, records: string, commands: string, stepId: string): string {
	const before = JSON.parse(flow) as Flow;
	const full = putRecords(before, JSON.parse(records) as StoredAttempt[]);
	const r = runCommands(full, JSON.parse(commands) as Command[], stepId);
	if (r.kind !== 'ok') return JSON.stringify(r);
	const taken = takeRecords(r.flow);
	return JSON.stringify({ ...r, flow: taken.flow, records: taken.records, ...stepKeys(before, taken.flow) });
}

/** 收一串紀錄（StoredAttempt[] 的 JSON）：每一次照「記一次」的規則檢查（checkRecord），回結果的 JSON（一樣的順序）。
 * #349 以前伺服器叫它；現在伺服器叫 receiveRecordsJson，這個只留給伺服器量時間比以前的做法。 */
export function checkRecordsJson(flow: string, records: string): string {
	const f = JSON.parse(flow) as Flow;
	return JSON.stringify((JSON.parse(records) as StoredAttempt[]).map((r) => checkRecord(f, r)));
}

/**
 * 傳上雲端（#259）：doc 是流程檔裡 flow.json 的內容（JSON 字串）。先「檢查一整支流程」（舊版升級、壞掉的不收），
 * 再「整份流程檢查」（傳上雲端沒有之前）。不收回 { kind: 'error', message }；收了回 { kind: 'ok', flow, records }：
 * 不帶紀錄的編排和拿出來的紀錄（伺服器分開存，ADR 0011）。
 */
export function uploadFlowJson(doc: string): string {
	const checked = checkFlowDocument(JSON.parse(doc));
	if (checked.kind === 'error') return JSON.stringify(checked);
	const problem = flowProblem(checked.flow);
	if (problem) return JSON.stringify({ kind: 'error', ...said(problem) });
	return JSON.stringify({ kind: 'ok', ...takeRecords(checked.flow) });
}

/**
 * 雲端流程的復原、重做（#256）：flow 是現在的樣子、records 是分開存的紀錄（StoredAttempt[] 的 JSON）、
 * change 是要放回去的樣子（RemoteChange 的 JSON）。回 runUndo 的結果的 JSON（跟 runStepJson 一樣的樣子）。
 * 伺服器收步改叫 takeStepJson 之後（ADR 0018）只剩 flow_core.rs 的 room_step_timing 用它量 #323 以前的做法。
 */
export function runUndoJson(flow: string, records: string, change: string): string {
	return JSON.stringify(
		runUndo(JSON.parse(flow) as Flow, JSON.parse(records) as StoredAttempt[], JSON.parse(change) as RemoteChange)
	);
}

/**
 * 這一步收不收（#315）：ask 是 StepAsk 的 JSON（現在的編排、第幾步、紀錄、步驟紀錄、現在、送的人、送來的步），
 * 回 takeStep 的結果（StepVerdict）的 JSON。
 */
export function takeStepJson(ask: string): string {
	return JSON.stringify(takeStep(JSON.parse(ask) as StepAsk));
}

/**
 * 這串紀錄收不收（#348）：flow 是現在的編排的 JSON（伺服器存的原樣；整批都收過時是 null），ask 是 RecordsAsk 其他欄位的 JSON
 * （送的人能不能記、名字、送來的一串、有關的紀錄），回 receiveRecords 的結果（RecordVerdict[]）的 JSON。
 * 編排分開傳：Rust 不用為了包進 ask 先檢查一遍約 140 KB 的 JSON（#349 量過，一次送 1 筆時看得出來）。
 */
export function receiveRecordsJson(flow: string, ask: string): string {
	return JSON.stringify(receiveRecords({ ...(JSON.parse(ask) as Omit<RecordsAsk, 'flow'>), flow: JSON.parse(flow) as Flow }));
}

/**
 * 改、刪、救回（#350、#351）：flow 是現在的編排的 JSON（伺服器存著的原樣，另外一個參數，跟 receiveRecordsJson 一樣），
 * ask 是 AmendAsk 其他欄位的 JSON（第幾步、送的人的權限、他是誰、要改刪救回的、伺服器上那幾次），
 * 回 amendRecords 的結果（AmendOutcome）的 JSON。
 */
export function amendRecordsJson(flow: string, ask: string): string {
	return JSON.stringify(amendRecords({ ...(JSON.parse(ask) as Omit<AmendAsk, 'flow'>), flow: JSON.parse(flow) as Flow }));
}

/**
 * 一起記全上的表（#352，ADR 0020）：runs 是現在的表（RunsTogether 的 JSON，沒有就是 []），event 是 RunEvent 的 JSON
 * 多帶 now（毫秒）和 viewers（要給哪些人看的使用者 id）。一次回 runTogether 的結果，加上 views：照 viewers 的順序，
 * 每個人看到的每次全上（runViews）。一次進出 QuickJS 就做完一件事和給大家看的樣子。
 */
export function runTogetherJson(runs: string, event: string): string {
	const { now, viewers, ...e } = JSON.parse(event) as RunEvent & { now: number; viewers: number[] };
	const out = runTogether(JSON.parse(runs) as RunsTogether, e as RunEvent, now);
	return JSON.stringify({ ...out, views: viewers.map((v) => runViews(out.runs, v, now)) });
}

/**
 * 只要樣子、沒有事的時候（#353：打招呼時先給一次、斷線 1 分鐘後再說一次）：runs 同 runTogetherJson，
 * ask 是 { now, viewers } 的 JSON。回照 viewers 的順序、每個人看到的每次全上（runViews）的 JSON。
 */
export function runViewsJson(runs: string, ask: string): string {
	const { now, viewers } = JSON.parse(ask) as { now: number; viewers: number[] };
	const table = JSON.parse(runs) as RunsTogether;
	return JSON.stringify(viewers.map((v) => runViews(table, v, now)));
}
