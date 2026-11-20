// 雲端流程的復原、重做（#256，ADR 0014）：不能整份換回去（會蓋掉別人的改動）。復原堆疊存每一步改到的東西
// 改之前、改之後的樣子（比對前後，diff.ts），復原是送改之前的樣子（重做送改之後的），用 applyRemoteChange 套上去。
// 伺服器放回去之後跑整份流程檢查（flowProblem），不合就擋下；那些東西後來有沒有被別的分頁改過由伺服器查。

import { flowProblem } from './flow-check';
import type { Flow } from './flow';
import { formationSec } from './formation';
import { carryRecords } from './records';
import { applyRemoteChange, remoteChange, type RemoteChange } from './remote-change';
import { stepKeys } from './step-keys';
import { putRecords, takeRecords, type StoredAttempt } from './stored-records';
import { fitRecords } from './success-rate';
import { said, type Said } from './why';

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

/**
 * 把復原、重做的改動套上去：沒改到的保持現在的樣子，紀錄帶現在的（對不上的丟掉，跟本機的復原一樣）。
 * 記號打在不在的環節上的拿掉、拿光了整筆拿掉（例：重做刪環節，復原時加回來的記號再清一次，ADR 0007）。
 */
export function undone(flow: Flow, change: RemoteChange): Flow {
	const after = applyRemoteChange(flow, change);
	return fitted(carryRecords(inTimeOrder(flow) ? byTime(after) : unsorted(after, flow), flow));
}

/** 沒照時間排的流程：放在原來的位置沒冒出新的毛病就放那裡，不然把放回去的站位挪過擋住它的。 */
const unsorted = (after: Flow, flow: Flow) => (flowProblem(after, flow) ? pastEarlier(after, flow) : after);

const inTimeOrder = (flow: Flow) =>
	flow.formations.every((f, i) => i === 0 || formationSec(flow, f) >= formationSec(flow, flow.formations[i - 1]));

/**
 * 站位照時間排：放回去的站位接在它前一個的後面，別人後來在中間加了站位就排錯了。
 * 本來就沒照時間排的（匯入的舊檔）不排，排了會冒出新的毛病、整步被擋。
 */
function byTime(flow: Flow): Flow {
	const sorted = [...flow.formations].sort((a, b) => formationSec(flow, a) - formationSec(flow, b));
	return sorted.every((f, i) => f === flow.formations[i]) ? flow : { ...flow, formations: sorted };
}

/**
 * 放回去的站位往後挪過後面時間比它早的（例：0、16、8 加回 32，別人後來加了 24，32 放 24 後面），
 * 往前挪過前面時間比它晚的（例：0、8、32、24 加回 16，別人把 8 挪到 20，16 放 20 前面），
 * 不然放回去的那張和旁邊那張多一個新的毛病、整步被擋；其他站位照現在的順序不動。
 */
function pastEarlier(after: Flow, flow: Flow): Flow {
	const had = new Set(flow.formations.map((f) => f.id));
	const list = [...after.formations];
	const sec = (k: number) => formationSec(after, list[k]);
	const swap = (k: number) => ([list[k], list[k + 1]] = [list[k + 1], list[k]]);
	for (const back of after.formations.filter((f) => !had.has(f.id)).reverse()) {
		let j = list.indexOf(back);
		while (j + 1 < list.length && sec(j + 1) < sec(j)) swap(j++);
		while (j > 0 && sec(j - 1) > sec(j)) swap(--j);
	}
	return list.every((f, i) => f === after.formations[i]) ? after : { ...after, formations: list };
}

/** 每個動作的紀錄對上它現在的環節、組（對不上的記號拿掉，拿光了整筆拿掉）。 */
function fitted(flow: Flow): Flow {
	const actions = flow.actions.map(fitRecords);
	return actions.every((a, i) => a === flow.actions[i]) ? flow : { ...flow, actions };
}

/** 伺服器跑復原、重做的結果：跟一般的一步一樣（runStepJson），不合規則是 blocked。 */
export type UndoOutcome =
	| { kind: 'ok'; flow: Flow; records: StoredAttempt[]; keys: string[]; watch: string[] }
	| ({ kind: 'blocked' } & Said);

/**
 * 伺服器跑復原、重做：flow 是現在的樣子（不帶紀錄）、records 是分開存的紀錄（ADR 0011）。
 * 套上去之後整份檢查（現在已經有的毛病不算）；合規則回不帶紀錄的流程、跑完還在的紀錄、這一步記下的鍵和要查的鍵。
 */
export function runUndo(flow: Flow, records: StoredAttempt[], change: RemoteChange): UndoOutcome {
	const now = putRecords(flow, records);
	// 現在放不進去的（動作不在、不記成功率了，例：伺服器加回來的刪動作清掉的紀錄）：放回去之後再放進復原回來的動作
	const placed = new Set(takeRecords(now).records.map((r) => r.attempt.id));
	const waiting = records.filter((r) => !placed.has(r.attempt.id));
	const back = undone(now, change);
	const after = waiting.length ? fitted(putRecords(back, [...takeRecords(back).records, ...waiting])) : back;
	const problem = flowProblem(after, now);
	if (problem) return { kind: 'blocked', ...said(problem) };
	const taken = takeRecords(after);
	return { kind: 'ok', flow: taken.flow, records: taken.records, ...stepKeys(flow, taken.flow) };
}
