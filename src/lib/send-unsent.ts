// 要求刪除帳號前，把這台還沒傳的成功率紀錄傳上去（#370）。紀錄只從流程的房間送（ADR 0011），平常是打開那支流程時
// CloudSteps 連上就傳；帳號頁沒有打開的流程，所以這裡一支一支連房間：打招呼（不在編輯、不要紀錄），可以送了就送
// 記的那幾次、再照先後送改、刪、救回（跟 CloudSteps 連上時一樣），伺服器回答了才算傳了。
// 傳不上去就留在這台：斷線、有新版、被收回、流程被刪了都不再等；伺服器沒收的那幾次（例：動作被刪了）、沒照做的刪和救回（例：記錄者刪別人記的）也留著。
// 傳完從這台現在存著的拿掉伺服器回答了的（傳的時候別的分頁又記的留著），帳號頁再讀一次還剩幾筆。

import { CORE_FINGERPRINT } from '#lib/core-fingerprint.js';
import { unsentFlows, type OfflineStore, type UnsentRecords } from '#lib/offline-store.js';
import type { CloudRecord, FlowRoom, ServerAdapter } from '#lib/server-api.js';

/** 這台每支流程還沒傳的都試著傳一次；傳不上去的留在這台。 */
export async function sendUnsent(server: Pick<ServerAdapter, 'openRoom'>, store: OfflineStore): Promise<void> {
	for (const u of await unsentFlows(store)) {
		const answered = await sendFlow(server.openRoom(u.flowId), u);
		await store.updateUnsent(u.flowId, (now) => withoutSent(now, u, answered));
	}
}

type Amend = UnsentRecords['amends'][number];

/** 伺服器回答了的：記的收了的 id；改、刪、救回（sent.amends 的第幾批）照做了是 null，只照做一部分是剩下沒照做的那一批。 */
interface Answered {
	recorded: Set<string>;
	amends: Map<number, Amend | null>;
}

/**
 * 這台現在存著的（now）拿掉送了的（sent）裡伺服器回答了的。
 * 記的伺服器收了就拿掉，傳的時候別的分頁改了記號的變成「改」留著；改、刪、救回一個回答只動一個（同樣的又做了一次：留著），
 * 只照做一部分的換成剩下的那幾次。
 */
function withoutSent(now: UnsentRecords, sent: UnsentRecords, answered: Answered): UnsentRecords {
	const acked = sent.records.filter((r) => answered.recorded.has(r.record.attempt.id));
	const done = new Set(acked.map((r) => JSON.stringify(r.record)));
	const ackedIds = new Set(acked.map((r) => r.record.attempt.id));
	// 伺服器已經有那一次（再記一次不會換）：改過記號的變成「改」，下次送
	const changed = now.records.filter((r) => ackedIds.has(r.record.attempt.id) && !done.has(JSON.stringify(r.record)));
	const changes = changed.map((r) => ({ ids: [r.record.attempt.id], request: { kind: 'changeRecords' as const, attempts: [r.record] } }));
	const key = (a: Amend) => JSON.stringify(a);
	const doneAmends = [...answered.amends].map(([i, rest]) => ({ key: key(sent.amends[i]), rest }));
	return {
		...now,
		records: now.records.filter((r) => !ackedIds.has(r.record.attempt.id)),
		amends: [
			...now.amends.flatMap((a) => {
				const i = doneAmends.findIndex((d) => d.key === key(a));
				if (i < 0) return [a];
				const [{ rest: left }] = doneAmends.splice(i, 1);
				return left ? [left] : [];
			}),
			...changes
		]
	};
}

/** 一支流程：連上送完，回伺服器回答了的（沒回答的、沒收的、沒照做的留在這台）。 */
function sendFlow(room: FlowRoom, u: UnsentRecords): Promise<Answered> {
	const answered: Answered = { recorded: new Set(), amends: new Map() };
	/** 送出去、等回答的（伺服器照順序回）：記的那一批是 'record'，改、刪、救回是第幾批。 */
	const waiting: ('record' | number)[] = [];
	return new Promise((resolve) => {
		const finish = () => {
			room.onmessage = () => {};
			room.onconnection = () => {};
			room.close();
			resolve(answered);
		};
		room.onconnection = (connected) => {
			if (!connected) finish();
		};
		room.onmessage = (m) => {
			if (m.kind === 'ready') {
				if (u.records.length) {
					waiting.push('record');
					room.send({ kind: 'record', attempts: u.records.map((r) => r.record) });
				}
				u.amends.forEach((a, i) => {
					waiting.push(i);
					room.send(a.request);
				});
				if (!waiting.length) finish();
			} else if (m.kind === 'recordsSaved') {
				const batch = waiting.shift();
				const saved = new Set(m.saved.map((r: CloudRecord) => (r.attempt as { id: string }).id));
				if (batch === 'record') for (const id of saved) answered.recorded.add(id);
				else if (batch !== undefined) answered.amends.set(batch, rest(u.amends[batch], saved));
				if (!waiting.length) finish();
			} else if (m.kind === 'newVersion' || m.kind === 'revoked' || m.kind === 'deleted') finish();
		};
		const tabId = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join('');
		room.send({ kind: 'hello', fingerprint: CORE_FINGERPRINT, tabId, seen: 0, editing: false, records: false });
	});
}

/**
 * 伺服器沒照做的那幾次（都照做了是 null）：回答的是這幾次現在在伺服器上的樣子（saved，還在的 id），不能動的不算、不退回（records.rs 的 amend）。
 * 刪的還在、救回的不在算沒照做；改的都算照做了（記號照規則可能被改過，比不出來；那一次被別人刪了也拿掉，跟開著流程時 CloudSteps 一樣）。
 */
function rest(amend: Amend, saved: Set<string>): Amend | null {
	const { request } = amend;
	if (request.kind === 'changeRecords') return null;
	const ids = request.ids.filter((id) => saved.has(id) === (request.kind === 'deleteRecords'));
	if (!ids.length) return null;
	return ids.length === request.ids.length ? amend : { ids, request: { ...request, ids } };
}
