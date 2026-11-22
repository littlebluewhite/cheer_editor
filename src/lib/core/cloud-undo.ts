// 雲端流程的復原、重做（#256，ADR 0014）：不能整份換回去（會蓋掉別人的改動）。復原堆疊存每一步改到的東西
// 改之前、改之後的樣子（比對前後，diff.ts），復原是送改之前的樣子（重做送改之後的），用 applyRemoteChange 套上去。
// 伺服器放回去之後跑整份流程檢查，不合就擋下（現在就有的、那一步治好的毛病不算，ADR 0020）；那些東西後來有沒有被別的分頁改過由伺服器查。

import { problemKeys, undoProblem } from './flow-check';
import type { Flow } from './flow';
import { sortFormations, withWalks, type Formation } from './formation';
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
 * 站位一律照時間排（ADR 0020）：放回去的站位不用找位置，本來就沒照時間排的（手改過的舊檔）也順便排好。
 * 開頭那張跟著第一段（#346）：放回去的段順序跟現在的站位對不上時，照調段順序的規則補。
 */
export function undone(flow: Flow, change: RemoteChange): Flow {
	return fitted(carryRecords(openingFollowsFirst(flow, sortFormations(applyRemoteChange(flow, change))), flow));
}

/** 這張站位在不在流程開頭（第一段的開頭；沒有段時是不在段裡的時間 0）。 */
const atStart = (flow: Flow, f: Formation | undefined) => f?.segmentId === (flow.segments[0]?.id ?? null) && f.at === 0;

/**
 * 放回去之後開頭那張不在流程開頭（例：復原調段順序時，原本的開頭那張被別的分頁刪了，#346）：
 * 第一段開頭有站位就由它接手，沒有就把現在（now）的開頭那張搬過去（整張搬，位置不變）；其他站位不刪、不搬，照時間排。
 * 現在就不在開頭的（手改過的舊檔）、一張都沒有的不動，留給整份檢查。
 */
function openingFollowsFirst(now: Flow, flow: Flow): Flow {
	if (!atStart(now, now.formations[0]) || !flow.formations.length || atStart(flow, flow.formations[0])) return flow;
	const pick =
		flow.formations.find((f) => atStart(flow, f)) ?? flow.formations.find((f) => f.id === now.formations[0].id) ?? flow.formations[0];
	const opening = { ...withWalks(pick, {}), segmentId: flow.segments[0]?.id ?? null, at: 0 };
	return sortFormations({ ...flow, formations: [opening, ...flow.formations.filter((f) => f !== pick)] });
}

/** 每個動作的紀錄對上它現在的環節、組（對不上的記號拿掉，拿光了整筆拿掉）。 */
function fitted(flow: Flow): Flow {
	const actions = flow.actions.map(fitRecords);
	return actions.every((a, i) => a === flow.actions[i]) ? flow : { ...flow, actions };
}

/**
 * 伺服器跑復原、重做的結果：跟一般的一步一樣（runStepJson），不合規則是 blocked。
 * 合規則多帶 held：放回去之後讓它留著的毛病的鍵（伺服器記著）；cured：這次治好的（現在有、放回去之後沒有的，ADR 0020）。
 */
export type UndoOutcome =
	| { kind: 'ok'; flow: Flow; records: StoredAttempt[]; keys: string[]; watch: string[]; held: string[]; cured: string[] }
	| ({ kind: 'blocked' } & Said);

/**
 * 伺服器跑復原、重做：flow 是現在的樣子（不帶紀錄）、records 是分開存的紀錄（ADR 0011）。
 * 套上去之後整份檢查：現在已經有的毛病、要復原的那一步治好的（cured，ADR 0020）不算；
 * 合規則回不帶紀錄的流程、跑完還在的紀錄、這一步記下的鍵和要查的鍵、放回去之後的毛病和這次治好的。
 */
export function runUndo(flow: Flow, records: StoredAttempt[], change: RemoteChange, cured: string[] = []): UndoOutcome {
	const now = putRecords(flow, records);
	// 現在放不進去的（動作不在、不記成功率了，例：伺服器加回來的刪動作清掉的紀錄）：放回去之後再放進復原回來的動作
	const placed = new Set(takeRecords(now).records.map((r) => r.attempt.id));
	const waiting = records.filter((r) => !placed.has(r.attempt.id));
	const back = undone(now, change);
	const after = waiting.length ? fitted(putRecords(back, [...takeRecords(back).records, ...waiting])) : back;
	const old = problemKeys(now);
	const { problem, keys } = undoProblem(after, old, cured);
	if (problem) return { kind: 'blocked', ...said(problem) };
	const held = new Set(keys);
	const taken = takeRecords(after);
	return { kind: 'ok', flow: taken.flow, records: taken.records, ...stepKeys(flow, taken.flow), held: keys, cured: old.filter((k) => !held.has(k)) };
}
