// 要求刪除帳號前，把這台還沒傳的成功率紀錄傳上去（#370）。紀錄只從流程的房間送（ADR 0011），平常是打開那支流程時
// CloudSteps 連上就傳；帳號頁沒有打開的流程，所以這裡一支一支連房間：打招呼（不在編輯、不要紀錄），可以送了就送
// 記的那幾次、再照先後送改、刪、救回（跟 CloudSteps 連上時一樣），伺服器回答了才算傳了。
// 傳不上去就留在這台：斷線、有新版、被收回、流程被刪了都不再等；伺服器沒收的那幾次（例：動作被刪了）、沒照做的刪和救回（例：記錄者刪別人記的）也留著。
// 傳完從這台現在存著的拿掉伺服器回答了的（傳的時候別的分頁又記的留著），帳號頁再讀一次還剩幾筆。

import { CORE_FINGERPRINT } from '#lib/core-fingerprint.js';
import { unsentFlows, type AmendRequest, type OfflineStore, type UnsentRecords } from '#lib/offline-store.js';
import type { CloudRecord, FlowRoom, ServerAdapter } from '#lib/server-api.js';

/** 這台每支流程還沒傳的都試著傳一次；傳不上去的留在這台。 */
export async function sendUnsent(server: Pick<ServerAdapter, 'openRoom'>, store: OfflineStore): Promise<void> {
	for (const u of await unsentFlows(store)) {
		const left = await sendFlow(server.openRoom(u.flowId), u);
		await store.updateUnsent(u.flowId, (now) => withoutSent(now, u, left));
	}
}

/**
 * 這台現在存著的（now）拿掉送了的（sent）裡伺服器回答了的（不在 left 裡的）。
 * 記的伺服器回答了就拿掉，傳的時候別的分頁改了記號的變成「改」留著；改、刪、救回一個回答只拿掉一個（同樣的又做了一次：留著）。
 */
function withoutSent(now: UnsentRecords, sent: UnsentRecords, left: UnsentRecords): UnsentRecords {
	const kept = new Set(left.records.map((r) => r.record.attempt.id));
	const acked = sent.records.filter((r) => !kept.has(r.record.attempt.id));
	const done = new Set(acked.map((r) => JSON.stringify(r.record)));
	const ackedIds = new Set(acked.map((r) => r.record.attempt.id));
	// 伺服器已經有那一次（再記一次不會換）：改過記號的變成「改」，下次送
	const changed = now.records.filter((r) => ackedIds.has(r.record.attempt.id) && !done.has(JSON.stringify(r.record)));
	const changes = changed.map((r) => ({ ids: [r.record.attempt.id], request: { kind: 'changeRecords' as const, attempts: [r.record] } }));
	const key = (a: UnsentRecords['amends'][number]) => JSON.stringify(a);
	const doneAmends = sent.amends.map(key);
	for (const k of left.amends.map(key)) doneAmends.splice(doneAmends.indexOf(k), 1);
	return {
		...now,
		records: now.records.filter((r) => !ackedIds.has(r.record.attempt.id)),
		amends: [
			...now.amends.filter((a) => {
				const i = doneAmends.indexOf(key(a));
				if (i < 0) return true;
				doneAmends.splice(i, 1);
				return false;
			}),
			...changes
		]
	};
}

/** 一支流程：連上送完，回這支還剩下的（傳不上去的）。 */
function sendFlow(room: FlowRoom, u: UnsentRecords): Promise<UnsentRecords> {
	const left = structuredClone(u);
	/** 送出去、等回答的（伺服器照順序回）：記的那一批是 'record'，改、刪、救回是那一批本身。 */
	const waiting: ('record' | UnsentRecords['amends'][number])[] = [];
	return new Promise((resolve) => {
		const finish = () => {
			room.onmessage = () => {};
			room.onconnection = () => {};
			room.close();
			resolve(left);
		};
		room.onconnection = (connected) => {
			if (!connected) finish();
		};
		room.onmessage = (m) => {
			if (m.kind === 'ready') {
				if (left.records.length) {
					waiting.push('record');
					room.send({ kind: 'record', attempts: left.records.map((r) => r.record) });
				}
				for (const a of left.amends) {
					waiting.push(a);
					room.send(a.request);
				}
				if (!waiting.length) finish();
			} else if (m.kind === 'recordsSaved') {
				const batch = waiting.shift();
				const saved = new Set(m.saved.map((r: CloudRecord) => (r.attempt as { id: string }).id));
				if (batch === 'record') left.records = left.records.filter((r) => !saved.has(r.record.attempt.id));
				else if (batch && carriedOut(batch.request, saved)) left.amends = left.amends.filter((a) => a !== batch);
				if (!waiting.length) finish();
			} else if (m.kind === 'newVersion' || m.kind === 'revoked' || m.kind === 'deleted') finish();
		};
		const tabId = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join('');
		room.send({ kind: 'hello', fingerprint: CORE_FINGERPRINT, tabId, seen: 0, editing: false, records: false });
	});
}

/**
 * 伺服器照做了嗎：回答的是這幾次現在在伺服器上的樣子（saved，還在的 id），不能動的不算、不退回（records.rs 的 amend）。
 * 刪的不在了、救回的都在才算；改的還在就算（記號照規則可能被改過，比不出來有沒有照做）。
 */
function carriedOut(request: AmendRequest, saved: Set<string>): boolean {
	if (request.kind === 'deleteRecords') return request.ids.every((id) => !saved.has(id));
	if (request.kind === 'restoreRecords') return request.ids.every((id) => saved.has(id));
	return true;
}
