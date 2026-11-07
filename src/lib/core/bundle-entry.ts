// 打包流程核心的入口（scripts/core-bundle.mjs）：伺服器用 QuickJS 跑這一包（ADR 0010）。
// 進出伺服器的都是 JSON 字串，所以多一個收 JSON、回 JSON 的版本。

import {
	applyRemoteChange,
	checkRecord,
	putRecords,
	remoteChange,
	runCommands,
	runUndo,
	stepKeys,
	takeRecords,
	type Command,
	type Flow,
	type RemoteChange,
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
 * 雲端流程跑一步（ADR 0008）：先把分開存的紀錄（records，StoredAttempt[] 的 JSON）放回編排，跑完再拿出來。
 * 成功時結果的 flow 是不帶紀錄的編排，多一個 records：跑完還在的紀錄（清掉的不在、記號可能少了），
 * 和 keys、watch：這一步記下的鍵、要查別的分頁改過沒有的鍵（stepKeys，#254）。
 */
export function runStepJson(flow: string, records: string, commands: string, stepId: string): string {
	const before = JSON.parse(flow) as Flow;
	const full = putRecords(before, JSON.parse(records) as StoredAttempt[]);
	const r = runCommands(full, JSON.parse(commands) as Command[], stepId);
	if (r.kind !== 'ok') return JSON.stringify(r);
	const taken = takeRecords(r.flow);
	return JSON.stringify({ ...r, flow: taken.flow, records: taken.records, ...stepKeys(before, taken.flow) });
}

/** 伺服器收一串紀錄（StoredAttempt[] 的 JSON）：每一次照「記一次」的規則檢查（checkRecord），回結果的 JSON（一樣的順序）。 */
export function checkRecordsJson(flow: string, records: string): string {
	const f = JSON.parse(flow) as Flow;
	return JSON.stringify((JSON.parse(records) as StoredAttempt[]).map((r) => checkRecord(f, r)));
}

/**
 * 雲端流程的復原、重做（#256）：flow 是現在的樣子、records 是分開存的紀錄（StoredAttempt[] 的 JSON）、
 * change 是要放回去的樣子（RemoteChange 的 JSON）。回 runUndo 的結果的 JSON（跟 runStepJson 一樣的樣子）。
 */
export function runUndoJson(flow: string, records: string, change: string): string {
	return JSON.stringify(
		runUndo(JSON.parse(flow) as Flow, JSON.parse(records) as StoredAttempt[], JSON.parse(change) as RemoteChange)
	);
}
