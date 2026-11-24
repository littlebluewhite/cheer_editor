// 網頁跑在哪裡（#373）：網頁版（瀏覽器）或 App（Swift 殼，ADR 0022）。兩邊不一樣、又不屬於編輯器的四樣收在這裡，換一處就全換：
// 小設定存在哪、網站網址、「問殼」、離線存放和草稿存放怎麼建、喇叭和延遲。
// 網頁版是 browserHost；App 一開始照殼塞的那份換上殼的版本（swapHost），測試用 #lib/test-fakes.js 的 fakeHost 換假的。
// 編輯器收的其他 adapter（連伺服器…）還是走 EditorAdapters；草稿存放由 browserAdapters 照這裡建。

import { createIndexedDbDraftStore, type DraftStore } from '#lib/file/draft.js';
import { createIndexedDbOfflineStore, type OfflineStore } from '#lib/offline-store.js';
import { browserSpeaker, type Speaker } from '#lib/speaker.svelte.js';

/** 小設定存放（#lib/local-settings.js 用）：一開始就要同步讀得到，改了馬上寫。存的是字串。 */
export interface SettingsStore {
	get(key: string): string | null;
	set(key: string, value: string): void;
	remove(key: string): void;
}

/** 「問殼」：在不在 App 裡、殼會不會某件事；跟殼說話（#lib/app-shell.js，說的話寫在 bridge-scenarios/）。 */
export interface Shell {
	readonly inApp: boolean;
	can(feature: string): boolean;
	/** 跟殼說一句，殼回的值。殼回錯誤（不認得是 'unknown'）或不在 App 裡時 reject。 */
	send(name: string, body?: unknown): Promise<unknown>;
	/** 聽殼主動說的話；回傳「不聽了」的函式。不在 App 裡永遠聽不到。 */
	on(name: string, listener: (body: unknown) => void): () => void;
}

export interface Host {
	/** 小設定（「我」、印誰、停下回起播點、圖例、分隔線大小、延遲校正）存在哪。 */
	settings: SettingsStore;
	/** 網站網址：分享連結、雲端流程的連線照這個網址做。 */
	siteUrl: () => string;
	/** 問殼。 */
	shell: Shell;
	/** 建一個離線存放（編輯器、登入頁、帳號頁各建一個）。 */
	createOfflineStore: () => OfflineStore;
	/** 建一個草稿存放（編輯器建一個）。 */
	createDraftStore: () => DraftStore;
	/** 喇叭和延遲：播放頭扣多少（播放建一個；App 裡每次都是同一個，殼一開始就在聽換喇叭）。 */
	speaker: () => Speaker;
}

/** 網頁版：瀏覽器的儲存（每次讀寫才碰 localStorage）、頁面自己的網址、不在 App 裡、IndexedDB（離線存放、草稿）。 */
export const browserHost: Host = {
	settings: {
		get: (key) => localStorage.getItem(key),
		set: (key, value) => localStorage.setItem(key, value),
		remove: (key) => localStorage.removeItem(key)
	},
	siteUrl: () => location.href,
	shell: {
		inApp: false,
		can: () => false,
		send: () => Promise.reject(new Error('不在 App 裡')),
		on: () => () => {}
	},
	createOfflineStore: createIndexedDbOfflineStore,
	createDraftStore: createIndexedDbDraftStore,
	speaker: () => browserSpeaker()
};

let current: Host = browserHost;

export function host(): Host {
	return current;
}

/** 換掉其中幾樣（App 一開始、測試）；回傳換回去的函式。 */
export function swapHost(changes: Partial<Host>): () => void {
	const before = current;
	current = { ...current, ...changes };
	return () => {
		current = before;
	};
}
