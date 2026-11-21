// 首頁和帳號：編輯器 module 握著（getEditor().home），用同一套 adapter（server、offline）。頁面只照它的狀態畫。
// 管：登入的是誰（斷網時用這台記著的，#261）、首頁「雲端」的「我的流程」「分享給我的」（連不上伺服器是 cloudError）、
// 這台每支雲端流程還沒傳的紀錄有幾筆（#260）、這台的離線副本（#261）、斷網時上次看到的雲端流程、
// 登出（這台還有沒傳的先問；登出時清掉離線副本，選「丟掉，登出」再清掉沒傳的）。
// 不管：有沒有網路（頁面聽瀏覽器的 online、offline，叫的時候給）；最近的流程、打開、新建、被收回的離線副本（流程檔 module）；
// 我的帳號頁（它自己連伺服器）。

import type { Editor } from '#lib/editor.svelte.js';
import { unsentCount, unsentFlows, type OfflineCopy, type UnsentRecords } from '#lib/offline-store.js';
import type { Me, MyFlows } from '#lib/server-api.js';

export class Home {
	readonly #editor: Editor;
	/** 登入的是誰：還沒問到是 undefined（右上角先不放「登入」，免得閃一下），沒登入是 null。 */
	#account = $state.raw<Me | null | undefined>(undefined);
	#myFlows = $state.raw<MyFlows | null>(null);
	#cloudError = $state(false);
	#unsentByFlow = $state.raw<Record<string, number>>({});
	#copies = $state.raw<OfflineCopy[]>([]);
	#knownCloudIds = $state.raw<string[]>([]);
	#copyIds = $derived(new Set(this.#copies.map((c) => c.flowId)));
	#unsentAtLogout = $state.raw<UnsentRecords[] | null>(null);

	constructor(editor: Editor) {
		this.#editor = editor;
	}

	/** 登入的是誰：還沒問到是 undefined，沒登入是 null。 */
	get account(): Me | null | undefined {
		return this.#account;
	}
	/** 首頁「雲端」的「我的流程」「分享給我的」：還沒拿到是 null。 */
	get myFlows(): MyFlows | null {
		return this.#myFlows;
	}
	/** 上次跟伺服器拿「我的流程」連不上。 */
	get cloudError(): boolean {
		return this.#cloudError;
	}
	/** 這台還沒傳的成功率紀錄（#260）：雲端流程 id → 幾筆（列的右邊「N 筆沒傳」）。 */
	get unsentByFlow(): Record<string, number> {
		return this.#unsentByFlow;
	}
	/** 這台的離線副本（#261）：有網路時列的右邊「離線可開」，斷網時只列這些。 */
	get copies(): OfflineCopy[] {
		return this.#copies;
	}
	/** 有離線副本的雲端流程（「離線可開」）。 */
	get copyIds(): Set<string> {
		return this.#copyIds;
	}
	/** 斷網時：上次看到的雲端流程（「還有 N 支雲端流程，連上網路才看得到。」）。 */
	get knownCloudIds(): string[] {
		return this.#knownCloudIds;
	}
	/** 登出前發現這台還有沒傳的紀錄（#260）：小框列每支流程幾筆；沒有是 null。 */
	get unsentAtLogout(): UnsentRecords[] | null {
		return this.#unsentAtLogout;
	}

	/** 問伺服器登入的是誰。斷網時（問完時 online() 是 false）伺服器問不到：用這台記著的，首頁照樣列離線副本。 */
	async load(online: () => boolean) {
		const { server, offline } = this.#editor.adapters;
		const me = await server.me();
		this.#account = me ?? (online() ? null : ((await offline.signedInHere())?.me ?? null));
	}

	/**
	 * 在首頁（登入著、沒開流程）時拿首頁要列的：這台沒傳的紀錄、離線副本；有網路再跟伺服器拿「我的流程」
	 * （拿到了記下這台登入的是誰、看到哪些雲端流程，被收回、被刪掉的離線副本刪掉），斷網拿上次看到的雲端流程。
	 * 回一個函式：離開首頁時叫它，之後才回來的不算。
	 */
	refresh(online: boolean): () => void {
		const me = this.#account;
		if (!me) return () => {};
		const { offline, server } = this.#editor.adapters;
		let stale = false;
		const readLocal = async () => {
			const [list, kept] = await Promise.all([offline.unsent(), offline.copies()]);
			if (stale) return;
			this.#unsentByFlow = Object.fromEntries(list.map((u) => [u.flowId, unsentCount(u)]));
			this.#copies = kept;
		};
		void readLocal();
		if (!online) {
			offline.signedInHere().then((here) => {
				if (!stale) this.#knownCloudIds = here?.cloudIds ?? [];
			});
			return () => (stale = true);
		}
		server.myFlows().then(
			async (list) => {
				if (stale) return;
				this.#myFlows = list;
				this.#cloudError = false;
				const ids = [...list.mine, ...list.shared].map((c) => c.id);
				void offline.saveSignedInHere({ me, cloudIds: ids });
				// 被收回、被刪掉的：這台的離線副本刪掉（還沒傳的先擋住列出來，#260）
				await this.#editor.file.dropGoneCopies(ids, list.deleted);
				await readLocal();
			},
			() => {
				if (!stale) this.#cloudError = true;
			}
		);
		return () => (stale = true);
	}

	/** 按登出：這台還有沒傳的紀錄就先問（unsentAtLogout），沒有就登出。 */
	async logout() {
		const left = await unsentFlows(this.#editor.adapters.offline);
		if (left.length) this.#unsentAtLogout = left;
		else await this.signOut();
	}

	/** 登出前的小框選「先不要登出」。 */
	stay() {
		this.#unsentAtLogout = null;
	}

	/** 登出這台裝置（discard：先丟掉這台沒傳的紀錄）。連不上伺服器時還是登入著（選單留著，可以再按一次）。 */
	async signOut(discard = false) {
		this.#unsentAtLogout = null;
		const { server, offline } = this.#editor.adapters;
		try {
			await server.logout();
			if (discard) await offline.clearUnsent();
			// 離線副本跟著帳號：登出就清掉（#261）；草稿不屬於哪個帳號，留著
			await offline.clearCopies();
			this.#account = null;
		} catch {
			// 沒登出成功：什麼都不變
		}
	}
}
