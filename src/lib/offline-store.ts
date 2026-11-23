// 離線存放的 adapter（#260，ADR 0011）：雲端流程還沒傳的成功率紀錄、沒存進去的清單存在這台，撐得過重新整理和關掉網頁。
// 一支雲端流程一份（key 是流程的 id），帶著流程的名字（首頁、登出的框、登入頁列幾筆用）。
// 真的是 createIndexedDbOfflineStore（IndexedDB，跟草稿分開一個資料庫）；假的是 #lib/test-fakes.js 的 fakeOfflineStore。
// 存的樣子帶版號（v）：之後的新版用 readUnsent 讀得懂舊版存的（讀不懂的不算）。
// 這一層的 IndexedDB 不寫自動測試（jsdom 沒有 IndexedDB），改用手動檢查；存的樣子怎麼讀在 offline-store.test.ts。
// iPhone、iPad 的 Safari（不是從主畫面打開的）7 天沒打開這個網站就清掉網站存的資料：needsHomeScreen 說要不要提醒加到主畫面。
// 離線副本（#261）也存在這裡：登入的人打開過的雲端流程留一份（編排、紀錄、音樂），斷網也打得開；
// 還有這台登入的是誰、上次看到幾支雲端流程（斷網時 me() 問不到，首頁照這個畫雲端那塊）。登出就清掉（clearCopies）。

import type { AudioBytes, StoredAttempt } from '#lib/core';
import type { DroppedRecord } from '#lib/practice-rights.js';
import type { CloudRecord, Me, Role, RoomRequest } from '#lib/server-api.js';

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

/** 一支雲端流程的離線副本（音樂另外存，copyAudio 拿）。 */
export interface OfflineCopy {
	flowId: string;
	name: string;
	/** 這台的是什麼時候的樣子（毫秒）：「這台的是 11/6 15:20 的樣子」。 */
	savedAt: number;
	/** 最近打開的時候（毫秒）：留最近打開的 5 支照這個。 */
	openedAt: number;
	/** 我的權限（存的時候的）。 */
	role: Role;
	/** 第幾步的樣子（連上時從這裡補上別人的改動）。 */
	step: number;
	/** 編排（不含紀錄）。 */
	flow: unknown;
	/** 成功率紀錄（伺服器上的，不含這台還沒傳的）。 */
	records: CloudRecord[];
}

/** 這台登入的是誰、上次看到的雲端流程（id）：斷網時首頁用。 */
export interface SignedInHere {
	me: Me;
	cloudIds: string[];
}

export interface OfflineStore {
	/** 每支流程這台還沒傳的（和沒存進去的清單），不照順序。讀不到是空的。 */
	unsent(): Promise<UnsentRecords[]>;
	/** 存一支流程的，蓋掉舊的；都空了就刪掉那一份。 */
	saveUnsent(unsent: UnsentRecords): Promise<void>;
	/** 一支流程的讀了改、存回去，中間別的分頁存不進來；沒存著的不叫 change。存不了吞掉。 */
	updateUnsent(flowId: string, change: (now: UnsentRecords) => UnsentRecords): Promise<void>;
	/** 全部丟掉（登出時選「丟掉，登出」）。 */
	clearUnsent(): Promise<void>;
	/** 這台存的會被瀏覽器清掉（iPhone、iPad 的 Safari，不是從主畫面打開的），而且提醒還沒按過「知道了」。 */
	needsHomeScreen(): boolean;
	/** 加到主畫面的提醒按了「知道了」：以後不再提醒。 */
	homeScreenKnown(): void;
	/** 離線副本（#261），不照順序、不帶音樂。讀不到是空的。 */
	copies(): Promise<OfflineCopy[]>;
	/** 一支離線副本的音樂（audio id → 位元組）。 */
	copyAudio(flowId: string): Promise<AudioBytes>;
	/** 存一支離線副本，蓋掉舊的；audio 沒給是音樂不動。 */
	saveCopy(copy: OfflineCopy, audio?: AudioBytes): Promise<void>;
	/** 刪掉一支離線副本（和它的音樂）。 */
	dropCopy(flowId: string): Promise<void>;
	/** 登出：離線副本、這台登入的是誰都清掉（還沒傳的紀錄不動）。 */
	clearCopies(): Promise<void>;
	/** 這台登入的是誰（斷網時首頁用）；沒有是 null。 */
	signedInHere(): Promise<SignedInHere | null>;
	/** 記下這台登入的是誰、看到的雲端流程。 */
	saveSignedInHere(here: SignedInHere): Promise<void>;
}

/** 離線副本留最近打開的幾支（跟草稿的 5 支分開算）。 */
export const MAX_COPIES = 5;

/**
 * 離線副本要刪掉哪幾支：照最近打開的留 MAX_COPIES 支，再舊的刪掉，但這台還有紀錄沒傳的那支不刪。
 */
export function copiesToDrop(copies: OfflineCopy[], unsent: UnsentRecords[]): string[] {
	const keep = new Set(unsent.filter((u) => unsentCount(u) > 0).map((u) => u.flowId));
	return [...copies]
		.sort((a, b) => b.openedAt - a.openedAt)
		.slice(MAX_COPIES)
		.filter((c) => !keep.has(c.flowId))
		.map((c) => c.flowId);
}

/** 存進去的離線副本（帶版號）。 */
export function storedCopy(c: OfflineCopy): unknown {
	return { v: VERSION, ...structuredClone(c) };
}

/** 存著的離線副本讀回來：認得的版號才讀；讀不懂是 null。 */
export function readCopy(value: unknown): OfflineCopy | null {
	const v = value as Partial<OfflineCopy> & { v?: unknown };
	if (!v || typeof v !== 'object' || v.v !== 1 || typeof v.flowId !== 'string' || !v.flow) return null;
	return {
		flowId: v.flowId,
		name: typeof v.name === 'string' ? v.name : '',
		savedAt: typeof v.savedAt === 'number' ? v.savedAt : 0,
		openedAt: typeof v.openedAt === 'number' ? v.openedAt : 0,
		role: v.role ?? 'viewer',
		step: typeof v.step === 'number' ? v.step : 0,
		flow: v.flow,
		records: Array.isArray(v.records) ? v.records : []
	};
}

/** 現在存的樣子的版號。 */
const VERSION = 1;

/** 還有幾筆沒傳：記了沒傳的、改了刪了沒送到的（同一次只算一筆）。沒存進去的不算。 */
export function unsentCount(u: UnsentRecords): number {
	return new Set([...u.records.map((r) => r.record.attempt.id), ...u.amends.flatMap((a) => a.ids)]).size;
}

/** 這台還有沒傳的紀錄的那幾支流程（登出前看；讀不到當作沒有）。 */
export async function unsentFlows(store: OfflineStore): Promise<UnsentRecords[]> {
	return (await store.unsent().catch(() => [])).filter((u) => unsentCount(u) > 0);
}

/** 什麼都沒有了（那一份可以刪掉）。 */
export function isEmptyUnsent(u: UnsentRecords): boolean {
	return !u.records.length && !u.amends.length && !u.dropped.length;
}

/**
 * 這個分頁的和這台存著的（別的分頁可能也存了）照那一次的 id 合起來：這個分頁記過、改過、刪過、救回過的那一次
 * 照這個分頁的，存著的只接上其他次的（記的、改刪救回的、沒存進去的）。
 */
export function mergeUnsent(mine: UnsentRecords, stored: UnsentRecords): UnsentRecords {
	const touched = new Set([...mine.records.map((r) => r.record.attempt.id), ...mine.amends.flatMap((a) => a.ids)]);
	const droppedIds = new Set(mine.dropped.map((d) => d.id));
	const others = (ids: string[]) => ids.filter((id) => !touched.has(id));
	const amends = stored.amends.flatMap(({ ids, request }) => {
		const left = others(ids);
		if (!left.length) return [];
		if (left.length === ids.length) return [{ ids, request }];
		const kept: AmendRequest =
			request.kind === 'changeRecords'
				? { kind: 'changeRecords', attempts: (request.attempts as StoredAttempt[]).filter((a) => !touched.has(a.attempt.id)) }
				: { kind: request.kind, ids: others(request.ids) };
		return [{ ids: left, request: kept }];
	});
	return {
		...mine,
		records: [...mine.records, ...stored.records.filter((r) => !touched.has(r.record.attempt.id))],
		amends: [...mine.amends, ...amends],
		dropped: [...mine.dropped, ...stored.dropped.filter((d) => !droppedIds.has(d.id))]
	};
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
const COPIES = 'copies';
const COPY_AUDIO = 'copyAudio';
const META = 'meta';
const SIGNED_IN = 'signedIn';
const HOME_SCREEN_KEY = 'cheer-editor:homeScreenKnown';

/** 真的：IndexedDB（私密視窗、空間不夠、封鎖網站資料時讀寫失敗：讀當作沒有，寫吞掉）。 */
export function createIndexedDbOfflineStore(): OfflineStore {
	return {
		async unsent() {
			const found: UnsentRecords[] = [];
			try {
				await run(UNSENT, 'readonly', (s) => {
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
				await run(UNSENT, 'readwrite', (s) => (isEmptyUnsent(u) ? s.delete(u.flowId) : s.put(storedUnsent(u), u.flowId)));
			} catch {
				// 存不了：只留在這個分頁
			}
		},
		async updateUnsent(flowId, change) {
			try {
				await run(UNSENT, 'readwrite', (s) => {
					const req = s.get(flowId);
					req.onsuccess = () => {
						const now = readUnsent(req.result);
						if (!now) return;
						const u = change(now);
						if (isEmptyUnsent(u)) s.delete(flowId);
						else s.put(storedUnsent(u), flowId);
					};
					return req;
				});
			} catch {
				// 存不了：這台存著的不變
			}
		},
		async clearUnsent() {
			try {
				await run(UNSENT, 'readwrite', (s) => s.clear());
			} catch {
				// 清不了就算了
			}
		},
		async copies() {
			try {
				const all = (await run(COPIES, 'readonly', (s) => s.getAll())) as unknown[];
				return all.flatMap((v) => readCopy(v) ?? []);
			} catch {
				return [];
			}
		},
		async copyAudio(flowId) {
			try {
				return ((await run(COPY_AUDIO, 'readonly', (s) => s.get(flowId))) as AudioBytes | undefined) ?? {};
			} catch {
				return {};
			}
		},
		async saveCopy(copy, audio) {
			try {
				await run(COPIES, 'readwrite', (s) => s.put(storedCopy(copy), copy.flowId));
				if (audio) await run(COPY_AUDIO, 'readwrite', (s) => s.put(audio, copy.flowId));
			} catch {
				// 存不了（空間不夠）：這支就沒有離線副本
			}
		},
		async dropCopy(flowId) {
			try {
				await run(COPIES, 'readwrite', (s) => s.delete(flowId));
				await run(COPY_AUDIO, 'readwrite', (s) => s.delete(flowId));
			} catch {
				// 刪不了就算了
			}
		},
		async clearCopies() {
			try {
				for (const name of [COPIES, COPY_AUDIO, META]) await run(name, 'readwrite', (s) => s.clear());
			} catch {
				// 清不了就算了
			}
		},
		async signedInHere() {
			try {
				const v = (await run(META, 'readonly', (s) => s.get(SIGNED_IN))) as SignedInHere | undefined;
				return v?.me ? v : null;
			} catch {
				return null;
			}
		},
		async saveSignedInHere(here) {
			try {
				await run(META, 'readwrite', (s) => s.put(structuredClone(here), SIGNED_IN));
			} catch {
				// 存不了：斷網時首頁當作沒登入
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
		// 第 2 版多了離線副本（#261）：舊的資料庫只補上沒有的
		const req = indexedDB.open(DB_NAME, 2);
		req.onupgradeneeded = () => {
			for (const name of [UNSENT, COPIES, COPY_AUDIO, META]) {
				if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

/** 開一個交易做一件事，等交易寫完（不只是 request 成功）才算數。 */
async function run(name: string, mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest): Promise<unknown> {
	const db = await openDb();
	try {
		return await new Promise((resolve, reject) => {
			const tx = db.transaction(name, mode);
			const req = op(tx.objectStore(name));
			tx.oncomplete = () => resolve(req.result);
			tx.onerror = tx.onabort = () => reject(tx.error);
		});
	} finally {
		db.close();
	}
}
