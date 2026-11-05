// 草稿薄層：把正在編的流程存在瀏覽器的 IndexedDB 裡，當機或忘了存，下次打開可以救回。
// 存的就是流程檔的 zip 位元組（含音樂）和存的時間，救回時跟開檔走同一條路。只有一份草稿，新的蓋掉舊的。
// 這一層不寫自動測試（jsdom 沒有 IndexedDB），改用手動檢查；頁面測試換成假的 DraftStore。
// 私密視窗、空間不夠、封鎖網站資料時可能讀寫失敗：呼叫端吞掉錯誤，當作沒有草稿。

export interface Draft {
	bytes: Uint8Array;
	/** 什麼時候存的；舊版編輯器存的草稿沒有記，是 null。 */
	savedAt: Date | null;
}

export interface DraftStore {
	/** 沒有草稿回 null。 */
	load(): Promise<Draft | null>;
	/** 存的時間用現在。 */
	save(bytes: Uint8Array): Promise<void>;
	clear(): Promise<void>;
}

const DB_NAME = 'cheer-editor';
const STORE = 'draft';
const KEY = 'current';

export function createIndexedDbDraftStore(): DraftStore {
	return {
		async load() {
			const value = await run('readonly', (s) => s.get(KEY));
			// 舊版編輯器只存位元組
			if (value instanceof Uint8Array) return { bytes: value, savedAt: null };
			const v = value as { bytes?: unknown; savedAt?: unknown } | undefined;
			if (!(v?.bytes instanceof Uint8Array)) return null;
			return { bytes: v.bytes, savedAt: typeof v.savedAt === 'number' ? new Date(v.savedAt) : null };
		},
		async save(bytes) {
			await run('readwrite', (s) => s.put({ bytes, savedAt: Date.now() }, KEY));
		},
		async clear() {
			await run('readwrite', (s) => s.delete(KEY));
		}
	};
}

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = () => req.result.createObjectStore(STORE);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

/** 開一個交易做一件事，等交易寫完（不只是 request 成功）才算數。 */
async function run(
	mode: IDBTransactionMode,
	op: (store: IDBObjectStore) => IDBRequest
): Promise<unknown> {
	const db = await openDb();
	try {
		return await new Promise((resolve, reject) => {
			const tx = db.transaction(STORE, mode);
			const req = op(tx.objectStore(STORE));
			tx.oncomplete = () => resolve(req.result);
			tx.onerror = tx.onabort = () => reject(tx.error);
		});
	} finally {
		db.close();
	}
}
