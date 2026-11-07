// 雲端流程的復原、重做（#256，ADR 0011）：不能整份換回去（會蓋掉別人的改動）。復原堆疊存每一步改到的東西
// 改之前、改之後的樣子（比對前後，diff.ts），復原是送改之前的樣子（重做送改之後的），用 applyRemoteChange 套上去。
// 伺服器放回去之後跑整份流程檢查（flowProblem），不合就擋下；那些東西後來有沒有被別的分頁改過由伺服器查。

import { flowProblem } from './flow-check';
import type { Flow } from './flow';
import { carryRecords } from './records';
import { applyRemoteChange, remoteChange, type RemoteChange } from './remote-change';
import { stepKeys } from './step-keys';
import { putRecords, takeRecords, type StoredAttempt } from './stored-records';

/** 復原堆疊的一步：undo 放回改之前的樣子，redo 放回改之後的樣子（都只有改到的東西）。 */
export interface UndoChanges {
	undo: RemoteChange;
	redo: RemoteChange;
}

/** 一步（改之前、改之後）的復原、重做要送的。 */
export function undoChanges(before: Flow, after: Flow): UndoChanges {
	return { undo: remoteChange(after, before), redo: remoteChange(before, after) };
}

/** 合成一步（方向鍵連按）：復原回到 older 之前，重做到 newer 之後。 */
export function joinUndo(older: UndoChanges, newer: UndoChanges): UndoChanges {
	return { undo: join(older.undo, newer.undo), redo: join(newer.redo, older.redo) };
}

/** 兩份改動合起來：同一個東西、同一個清單的順序，first 的算。 */
function join(first: RemoteChange, second: RemoteChange): RemoteChange {
	const keys = new Set(first.things.map((t) => t.key));
	return {
		things: [...first.things, ...second.things.filter((t) => !keys.has(t.key))],
		orders: { ...second.orders, ...first.orders }
	};
}

/** 把復原、重做的改動套上去：沒改到的保持現在的樣子，紀錄帶現在的（對不上的丟掉，跟本機的復原一樣）。 */
export function undone(flow: Flow, change: RemoteChange): Flow {
	return carryRecords(applyRemoteChange(flow, change), flow);
}

/** 伺服器跑復原、重做的結果：跟一般的一步一樣（runStepJson），不合規則是 blocked。 */
export type UndoOutcome =
	| { kind: 'ok'; flow: Flow; records: StoredAttempt[]; keys: string[]; watch: string[] }
	| { kind: 'blocked'; message: string };

/**
 * 伺服器跑復原、重做：flow 是現在的樣子（不帶紀錄）、records 是分開存的紀錄（ADR 0008）。
 * 套上去之後整份檢查（現在已經有的毛病不算）；合規則回不帶紀錄的流程、跑完還在的紀錄、這一步記下的鍵和要查的鍵。
 */
export function runUndo(flow: Flow, records: StoredAttempt[], change: RemoteChange): UndoOutcome {
	const now = putRecords(flow, records);
	const after = undone(now, change);
	const problem = flowProblem(after, now);
	if (problem) return { kind: 'blocked', message: problem };
	const taken = takeRecords(after);
	return { kind: 'ok', flow: taken.flow, records: taken.records, ...stepKeys(flow, taken.flow) };
}
