// 離線存放的 adapter（#260，ADR 0008）：雲端流程還沒傳的成功率紀錄、沒存進去的清單存在這台，撐得過重新整理和關掉網頁。
// 一支雲端流程一份（key 是流程的 id），帶著流程的名字（首頁、登出的框、登入頁列幾筆用）。
// 真的是 createIndexedDbOfflineStore（IndexedDB，跟草稿分開一個資料庫）；假的是 #lib/test-fakes.js 的 fakeOfflineStore。
// 存的樣子帶版號（v）：之後的新版用 readUnsent 讀得懂舊版存的（讀不懂的不算）。
// 這一層的 IndexedDB 不寫自動測試（jsdom 沒有 IndexedDB），改用手動檢查；存的樣子怎麼讀在 offline-store.test.ts。
// iPhone、iPad 的 Safari（不是從主畫面打開的）7 天沒打開這個網站就清掉網站存的資料：needsHomeScreen 說要不要提醒加到主畫面。

import type { StoredAttempt } from '#lib/core';
import type { DroppedRecord } from '#lib/editor-session.svelte.js';
import type { RoomRequest } from '#lib/server-api.js';

/** 改、刪、救回紀錄的那一種送進房間的（#258）。 */
export type AmendRequest = Extract<RoomRequest, { kind: 'changeRecords' | 'deleteRecords' | 'restoreRecords' }>;

/** 一支雲端流程在這台還沒傳的。 */
export interface UnsentRecords {
	flowId: string;
	/** 流程的名字（存的時候的）。 */
	flowName: string;
	/** 記了、還沒傳上去的那幾次，和沒存進去時表上那一列（記的當下的動作、組的名字）。 */
	records: { record: StoredAttempt; row: DroppedRecord }[];
	/** 改、刪、救回還沒送到的（照做的先後）：那一批的 id 和要送的。 */
	amends: { ids: string[]; request: AmendRequest }[];
	/** 沒存進去的清單（教練改了流程）：按「知道了」才清。 */
	dropped: DroppedRecord[];
}

export interface OfflineStore {
	/** 每支流程這台還沒傳的（和沒存進去的清單），不照順序。讀不到是空的。 */
	unsent(): Promise<UnsentRecords[]>;
	/** 存一支流程的，蓋掉舊的；都空了就刪掉那一份。 */
	saveUnsent(unsent: UnsentRecords): Promise<void>;
	/** 全部丟掉（登出時選「丟掉，登出」）。 */
	clearUnsent(): Promise<void>;
	/** 這台存的會被瀏覽器清掉（iPhone、iPad 的 Safari，不是從主畫面打開的），而且提醒還沒按過「知道了」。 */
	needsHomeScreen(): boolean;
	/** 加到主畫面的提醒按了「知道了」：以後不再提醒。 */
	homeScreenKnown(): void;
}

/** 現在存的樣子的版號。 */
const VERSION = 1;

/** 還有幾筆沒傳：記了沒傳的、改了刪了沒送到的（同一次只算一筆）。沒存進去的不算。 */
export function unsentCount(u: UnsentRecords): number {
	return new Set([...u.records.map((r) => r.record.attempt.id), ...u.amends.flatMap((a) => a.ids)]).size;
}

/** 什麼都沒有了（那一份可以刪掉）。 */
export function isEmptyUnsent(u: UnsentRecords): boolean {
	return !u.records.length && !u.amends.length && !u.dropped.length;
}

/** 存進去的樣子（帶版號）。 */
export function storedUnsent(u: UnsentRecords): unknown {
	return { v: VERSION, ...structuredClone(u) };
}

/** 存著的讀回來：認得的版號才讀（缺的欄位當空的）；讀不懂是 null。 */
export function readUnsent(value: unknown): UnsentRecords | null {
	const v = value as Partial<UnsentRecords> & { v?: unknown };
	if (!v || typeof v !== 'object' || v.v !== 1 || typeof v.flowId !== 'string') return null;
	const list = <T>(x: T[] | undefined) => (Array.isArray(x) ? x : []);
	return {
		flowId: v.flowId,
		flowName: typeof v.flowName === 'string' ? v.flowName : '',
		records: list(v.records),
		amends: list(v.amends),
		dropped: list(v.dropped)
	};
}

/**
 * 這個瀏覽器存的會被清掉：iPhone、iPad 的 Safari（iPad 的 Safari 說自己是 Mac，用觸控點分出來），
 * 不是從主畫面打開的。iOS 上的 Chrome、Firefox、Edge 不算。
 */
export function isVolatileSafari(userAgent: string, maxTouchPoints: number, standalone: boolean): boolean {
	const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
	const safari = /Safari\//.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent);
	return ios && safari && !standalone;
}

const DB_NAME = 'cheer-editor-offline';
const UNSENT = 'unsent';
const HOME_SCREEN_KEY = 'cheer-editor:homeScreenKnown';

/** 真的：IndexedDB（私密視窗、空間不夠、封鎖網站資料時讀寫失敗：讀當作沒有，寫吞掉）。 */
export function createIndexedDbOfflineStore(): OfflineStore {
	return {
		async unsent() {
			const found: UnsentRecords[] = [];
			try {
				await run('readonly', (s) => {
					const req = s.openCursor();
					req.onsuccess = () => {
						const cursor = req.result;
						if (!cursor) return;
						const u = readUnsent(cursor.value);
						if (u) found.push(u);
						cursor.continue();
					};
					return req;
				});
			} catch {
				return [];
			}
			return found;
		},
		async saveUnsent(u) {
			try {
				await run('readwrite', (s) => (isEmptyUnsent(u) ? s.delete(u.flowId) : s.put(storedUnsent(u), u.flowId)));
			} catch {
				// 存不了：只留在這個分頁
			}
		},
		async clearUnsent() {
			try {
				await run('readwrite', (s) => s.clear());
			} catch {
				// 清不了就算了
			}
		},
		needsHomeScreen() {
			if (typeof navigator === 'undefined') return false;
			const standalone =
				(navigator as { standalone?: boolean }).standalone === true ||
				(typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches);
			if (!isVolatileSafari(navigator.userAgent, navigator.maxTouchPoints ?? 0, standalone)) return false;
			try {
				return localStorage.getItem(HOME_SCREEN_KEY) !== '1';
			} catch {
				return true;
			}
		},
		homeScreenKnown() {
			try {
				localStorage.setItem(HOME_SCREEN_KEY, '1');
			} catch {
				// 存不了就只在這次不跳
			}
		}
	};
}

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = () => req.result.createObjectStore(UNSENT);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

/** 開一個交易做一件事，等交易寫完（不只是 request 成功）才算數。 */
async function run(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest): Promise<unknown> {
	const db = await openDb();
	try {
		return await new Promise((resolve, reject) => {
			const tx = db.transaction(UNSENT, mode);
			const req = op(tx.objectStore(UNSENT));
			tx.oncomplete = () => resolve(req.result);
			tx.onerror = tx.onabort = () => reject(tx.error);
		});
	} finally {
		db.close();
	}
}
