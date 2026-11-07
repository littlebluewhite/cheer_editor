// 草稿薄層：把正在編的流程存在瀏覽器的 IndexedDB 裡，當機或忘了存，下次打開可以救回。
// 存的就是流程檔的 zip 位元組（含音樂）和存的時間，救回時跟開檔走同一條路。每支流程一份，key 是流程的草稿 id
// （由流程檔決定，見 #lib/flow-file.svelte.js）；只留幾份由呼叫端管。舊版編輯器只有一份，key 是「current」，照樣列得出來、讀得到。
// 這一層不寫自動測試（jsdom 沒有 IndexedDB），改用手動檢查；頁面測試換成假的 DraftStore。
// 私密視窗、空間不夠、封鎖網站資料時可能讀寫失敗：呼叫端吞掉錯誤，當作沒有草稿。

export interface DraftInfo {
	/** 流程的草稿 id。 */
	id: string;
	/** 什麼時候存的；舊版編輯器存的草稿沒有記，是 null。 */
	savedAt: Date | null;
}

export interface Draft extends DraftInfo {
	bytes: Uint8Array;
}

export interface DraftStore {
	/** 這台電腦上所有的草稿（不照順序）。 */
	list(): Promise<DraftInfo[]>;
	/** 沒有這份草稿回 null。 */
	load(id: string): Promise<Draft | null>;
	/**
	 * 存這支流程的草稿，蓋掉它舊的那份；存的時間用現在。
	 * 要在呼叫當下就開始寫（不先等別的非同步步驟）：關分頁時呼叫完頁面就卸載了。
	 */
	save(id: string, bytes: Uint8Array): Promise<void>;
	/** 清掉這支流程的草稿。 */
	clear(id: string): Promise<void>;
}

const DB_NAME = 'cheer-editor';
const STORE = 'draft';

export function createIndexedDbDraftStore(): DraftStore {
	return {
		async list() {
			const found: DraftInfo[] = [];
			await run('readonly', (s) => {
				const req = s.openCursor();
				req.onsuccess = () => {
					const cursor = req.result;
					if (!cursor) return;
					const d = typeof cursor.key === 'string' ? toDraft(cursor.key, cursor.value) : null;
					if (d) found.push({ id: d.id, savedAt: d.savedAt });
					cursor.continue();
				};
				return req;
			});
			return found;
		},
		async load(id) {
			return toDraft(id, await run('readonly', (s) => s.get(id)));
		},
		async save(id, bytes) {
			await run('readwrite', (s) => s.put({ bytes, savedAt: Date.now() }, id));
		},
		async clear(id) {
			await run('readwrite', (s) => s.delete(id));
		}
	};
}

/** 存著的值讀成草稿：舊版編輯器只存位元組；不是草稿是 null。 */
function toDraft(id: string, value: unknown): Draft | null {
	if (value instanceof Uint8Array) return { id, bytes: value, savedAt: null };
	const v = value as { bytes?: unknown; savedAt?: unknown } | undefined;
	if (!(v?.bytes instanceof Uint8Array)) return null;
	return { id, bytes: v.bytes, savedAt: typeof v.savedAt === 'number' ? new Date(v.savedAt) : null };
}

/**
 * 連線開一次就一直留著：關分頁、重新整理時（pagehide）寫草稿要在當下就開好交易，
 * 每次先開資料庫再寫的話，頁面卸載前來不及開好，最後一筆修改就丟了（B02）。
 * 別的分頁要升級資料庫、瀏覽器關掉連線時丟掉，下次再開。
 */
let db: IDBDatabase | null = null;
let opening: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
	opening ??= new Promise<IDBDatabase>((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = () => req.result.createObjectStore(STORE);
		req.onsuccess = () => {
			const opened = req.result;
			opened.onversionchange = () => {
				opened.close();
				forget(opened);
			};
			opened.onclose = () => forget(opened);
			db = opened;
			resolve(opened);
		};
		req.onerror = () => {
			opening = null;
			reject(req.error);
		};
	});
	return opening;
}

function forget(closed: IDBDatabase) {
	if (db !== closed) return;
	db = null;
	opening = null;
}

/**
 * 開一個交易做一件事，等交易寫完（不只是 request 成功）才算數。
 * 連線已經開好時，交易在呼叫當下就開好、送出（不先等別的非同步步驟）。
 */
function run(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest): Promise<unknown> {
	return db ? inTransaction(db, mode, op) : openDb().then((opened) => inTransaction(opened, mode, op));
}

function inTransaction(
	opened: IDBDatabase,
	mode: IDBTransactionMode,
	op: (store: IDBObjectStore) => IDBRequest
): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const tx = opened.transaction(STORE, mode);
		const req = op(tx.objectStore(STORE));
		tx.oncomplete = () => resolve(req.result);
		tx.onerror = tx.onabort = () => reject(tx.error);
		// 寫的交易只有一個 request，馬上送出；讀的（list 的游標）還要繼續發 request，不能先送出
		if (mode === 'readwrite') tx.commit?.();
	});
}
