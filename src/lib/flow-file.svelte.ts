// 流程檔：編輯器 module 握著（getEditor().file）。開檔、存檔、新建、回首頁、草稿、「沒存先問」都在這裡，頁面只照它的狀態畫對話框和提示。
// 管：這支流程在不在檔案裡、正在存、「還沒存」的問題、開檔錯誤、缺音樂的提示、
// 一支流程一個存檔薄層（記得存到哪個檔，換流程就丟掉）、草稿（每支流程一份，只留最近編過的 5 支；停手 1 秒自動存，
// 從檔案開的、存好的沒改過也留一份；首頁列成「最近的流程」；另一個分頁正在編的流程不能打開，清掉草稿前先問別的分頁）。

import { missingAudioNames, readFlowFile, writeFlowFile, type Flow } from '#lib/core';
import type { DraftInfo } from '#lib/file/draft.js';
import { flowFileName, type FileSaver, type PickedFile } from '#lib/file/save.js';
import type { Editor } from '#lib/editor.svelte.js';
import type { MusicLibrary } from '#lib/music-library.svelte.js';
import type { TabChannel } from '#lib/tab-channel.js';

/** 停手多久才存草稿。 */
const DRAFT_DELAY_MS = 1000;
/** 問別的分頁有沒有在編一支流程，等它回答多久。 */
const OTHER_TAB_WAIT_MS = 300;
/** 草稿最多留幾支流程的。 */
const MAX_DRAFTS = 5;

export class FlowFile {
	readonly #editor: Editor;
	/** 這支流程在檔案裡（從檔案開的、存過檔）：沒有未存的修改就不用草稿。剛建好、救回草稿的不在檔案裡。 */
	#onDisk = $state(false);
	/** 存檔薄層，一支流程一個（記得存到哪個檔）：第一次存檔才建，換流程就丟掉。 */
	#saver: FileSaver | null = null;
	/** 正在存：存好之前再按存檔不算。 */
	#saving = false;
	#openError = $state('');
	/** 等教練回答「還沒存」：確定就做這件事（換流程）。 */
	#asking = $state.raw<(() => void) | null>(null);
	/** 說「有段找不到音樂」的那則提示（開檔、存檔時給的）。 */
	#missingNotice = '';
	/** 讀過草稿了：在這之前不自動存，免得蓋掉還沒問過的草稿。 */
	#draftChecked = false;
	/**
	 * 這支流程的草稿 id：從流程檔開的、存成流程檔的是那個檔的位元組算出來的（別的分頁開同一個檔，算出來一樣），
	 * 剛建好的是新的，救回草稿的是那份草稿的。
	 */
	#draftId = newDraftId();
	/** 存過這份草稿、看過草稿有沒有超過 5 支了（每份草稿第一次存時看一次）。 */
	#countedDraftId: string | null = null;
	/** 這支流程在檔案裡時，那個檔的位元組（從檔案開的、存好的）：沒改過時草稿就存它，重新整理後從最近的流程打開還是那個檔。 */
	#fileBytes: Uint8Array | null = null;
	/** 首頁列的最近的流程（有草稿的那幾支，最近的在前）。 */
	#recent = $state.raw<RecentFlow[]>([]);
	/** 讀最近的流程讀到第幾次：慢的舊結果不蓋掉新的。 */
	#recentRead = 0;
	/** 停手 1 秒後存草稿的計時器。 */
	#draftTimer: ReturnType<typeof setTimeout> | undefined;
	/** 分頁頻道：頁面打開時開。沒有（瀏覽器沒有 BroadcastChannel、頁面還沒打開）就當作沒有別的分頁。 */
	#channel: TabChannel | null = null;

	/**
	 * 換成另一支流程（新建、開檔、救回草稿）時頁面要做的事：練習畫面重開、對話框都關掉。頁面建好時接上。
	 * 播放停下、回到開頭由播放做（session.open 叫它）。
	 */
	onswitch: () => void = () => {};

	/** 給編輯器的流程算從檔案開的。 */
	constructor(editor: Editor) {
		this.#editor = editor;
		this.#onDisk = !!editor.session.flow;
		editor.session.onflow = () => {
			this.#saveDraftLater();
			this.#dropMissingNotice();
			if (!editor.session.flow) void this.#readRecent();
		};
	}

	/**
	 * 頁面打開了：開分頁頻道（別的分頁來問，這個分頁開著的就是那支流程，就回答「正在編」），讀草稿。
	 * 回傳頁面關掉時要做的：關掉分頁頻道、還在等停手 1 秒的草稿不存了。
	 */
	connect(): () => void {
		const channel = this.#editor.adapters.openTabChannel?.() ?? null;
		this.#channel = channel;
		channel?.listen((message) => {
			if (message.kind === 'editing?' && this.#editor.session.flow && message.id === this.#draftId) {
				channel.post({ kind: 'editing', id: message.id });
			}
		});
		void this.#checkDraft();
		return () => {
			channel?.close();
			this.#channel = null;
			clearTimeout(this.#draftTimer);
		};
	}

	/** 首頁開檔失敗的原因（編輯中失敗就放在提示）。 */
	get openError(): string {
		return this.#openError;
	}

	/**
	 * 存成「流程名.zip」（Ctrl+S、存檔鈕）：Chrome、Edge 第一次跳存檔對話框、之後存回同一個檔；
	 * iPad 開分享選單；其他瀏覽器下載新檔。
	 */
	async save() {
		const { session, adapters, music } = this.#editor;
		if (!session.flow || this.#saving) return;
		// 名字、備註這類欄位在失去焦點時才送進流程；先送出，存的才有剛打的字（iPad 點按鈕不一定會讓輸入框失去焦點）。
		adapters.pendingInput.flush();
		const f = session.flow;
		this.#saving = true;
		this.#saver ??= adapters.createSaver();
		// 存的這支流程有幾段找不到音樂（存的時候手上的音樂）
		const missing = music.missingSegmentIds.length;
		try {
			const fileName = flowFileName(f.name);
			const bytes = writeFlowFile(f, music.bytes(f));
			const outcome = await this.#saver.save(bytes, fileName);
			if (outcome === 'cancelled') return;
			session.markSaved(f);
			this.#onDisk = true;
			this.#fileBytes = bytes;
			// 這支流程現在就是這個檔：草稿 id 換成檔案的，別的分頁開這個檔才知道它正在被編。舊 id 的草稿清掉。
			const oldId = this.#draftId;
			this.#draftId = fileDraftId(bytes);
			if (oldId !== this.#draftId) void this.#dropDraft(oldId);
			this.#saveDraftLater();
			session.notice = [
				outcome === 'downloaded'
					? `這個瀏覽器不能存回原檔，所以下載了一個新的「${fileName}」；用 Chrome 或 Edge 才能直接存回原檔。`
					: '',
				missing
					? `存好了，但有 ${missing} 段找不到音樂，存出來的檔裡沒有這些音樂：點紅色的段重新選檔，再存一次`
					: ''
			]
				.filter(Boolean)
				.join('；');
			if (missing) this.#noteMissing();
		} catch {
			session.notice = '存檔失敗，請再試一次';
		} finally {
			this.#saving = false;
		}
	}

	/** 開檔：選檔欄位選到的流程檔（Safari、iPad、Firefox）。缺的音樂照開，那一段標紅。 */
	async open(file: File) {
		await this.#openBytes(new Uint8Array(await file.arrayBuffer()), file.name);
	}

	/** 瀏覽器能用選檔視窗開檔、拿到存回那個檔的存檔薄層（Chrome、Edge）：選檔欄位改叫 pick。 */
	get canPick(): boolean {
		return this.#editor.adapters.pickFlowFile !== null;
	}

	/** 開檔：Chrome、Edge 不跳選檔欄位，改用選檔視窗，拿到存回那個檔的存檔薄層。按取消、選檔出錯都當作沒選。 */
	async pick() {
		const pickFlowFile = this.#editor.adapters.pickFlowFile;
		if (!pickFlowFile) return;
		let picked: PickedFile | null;
		try {
			picked = await pickFlowFile();
		} catch {
			picked = null;
		}
		if (picked) await this.#openBytes(new Uint8Array(await picked.file.arrayBuffer()), picked.file.name, picked.saver);
	}

	/**
	 * 打開流程檔的位元組。fileName = 從哪個檔開的（算已存）；null 是草稿救回來的，還算未存。
	 * saver：存回那個檔的存檔薄層（沒有就第一次存檔時再建）。draftId：這支流程的草稿 id（沒給就照檔案算）。
	 * 另一個分頁正在編這支流程就不開，說原因。
	 */
	async #openBytes(bytes: Uint8Array, fileName: string | null, saver: FileSaver | null = null, draftId = fileDraftId(bytes)) {
		const session = this.#editor.session;
		const r = readFlowFile(bytes);
		const cannotOpen = (reason: string) => {
			const message = `打不開「${fileName ?? (r.kind === 'ok' ? r.flow.name : '草稿')}」：${reason}`;
			if (session.flow) session.notice = message;
			else this.#openError = message;
		};
		if (r.kind === 'error') return cannotOpen(r.message);
		if (await this.#otherTabEditing(draftId)) return cannotOpen('另一個分頁正在編這支流程');
		// 檔案裡的音樂解碼好（這個瀏覽器解不開的標成壞的），換流程時換上
		const music = await this.#editor.readMusic(r.audio);
		this.#unlessUnsaved(() => {
			this.#start(r.flow, fileName === null ? 'draft' : 'file', draftId, music, saver);
			// 從檔案開的：當下就把這個檔存成草稿，重新整理後首頁的最近的流程裡有它
			if (fileName !== null) {
				this.#fileBytes = bytes;
				if (this.#draftChecked) void this.#saveDraft(bytes);
			}
			session.notice = r.missingSegmentIds.length
				? `「${fileName ?? '草稿'}」裡少了音樂檔${missingAudioNames(r.flow, r.missingSegmentIds).map((n) => `「${n}」`).join('')}：點紅色的段重新選檔`
				: music.hasBroken
					? '有音樂檔這個瀏覽器讀不出來，播放時會沒有聲音'
					: '';
			if (r.missingSegmentIds.length) this.#noteMissing();
		});
	}

	/** 新建流程表單建好了：換上它。剛建好的當下就存一次草稿，不等停手 1 秒：手機上建好就被「視窗太窄」擋住，也不會丟。 */
	create(flow: Flow) {
		this.#start(flow, 'new', newDraftId());
		if (this.#draftChecked) this.#saveDraft(writeFlowFile(flow, {}));
	}

	/** 上方列「新建」：回到新建流程的畫面。 */
	startNew() {
		this.#unlessUnsaved(() => this.#editor.session.open(null));
	}

	/** 「視窗太窄」提示上的「回首頁」：不問，這個分頁的流程（剛建好、有改動）留在草稿裡，列在首頁的最近的流程。 */
	async leaveToHome() {
		const { session, music } = this.#editor;
		const f = session.flow;
		const bytes = f && this.ownsDraft ? writeFlowFile(f, music.bytes(f)) : null;
		session.open(null);
		if (bytes) await this.#saveDraft(bytes);
	}

	/**
	 * 換成另一支流程（新建、開檔、救回草稿）。選取、提示由 session 清掉。
	 * draftId：這支流程的草稿 id。music：這支流程的音樂檔庫（開檔、救回草稿時解碼好的；沒給是空的）。
	 */
	#start(flow: Flow, from: 'file' | 'draft' | 'new', draftId: string, music?: MusicLibrary, saver: FileSaver | null = null) {
		const editor = this.#editor;
		// 剛建好的不算未存（沒改過就換別的不用問），但不在檔案裡，照樣存草稿
		editor.session.open(flow, from !== 'draft');
		this.#onDisk = from === 'file';
		this.#draftId = draftId;
		this.#fileBytes = null;
		editor.adapters.pendingInput.settle();
		this.onswitch();
		this.#saver = saver;
		editor.switchMusic(music);
		this.#openError = '';
		// 還沒有隊員的流程先開名單，有人了才開動作
		editor.inspectorTab = flow.members.length ? 'action' : 'members';
	}

	// ---------- 缺音樂的提示 ----------

	/** 現在的提示是「有段找不到音樂」那一則（開檔、存檔時給的）：記下來，缺的音樂都補好了就收掉。 */
	#noteMissing() {
		this.#missingNotice = this.#editor.session.notice;
		this.#dropMissingNotice();
	}

	/** 流程換了（session 叫：選了音樂檔、刪了段、復原…）：「有段找不到音樂」的提示還在、缺的音樂都沒了，就收掉它。 */
	#dropMissingNotice() {
		const { session, music } = this.#editor;
		if (this.#missingNotice && session.notice === this.#missingNotice && !music.missingSegmentIds.length) {
			session.notice = '';
		}
	}

	// ---------- 沒存先問 ----------

	/** 「還沒存」的問題開著：等教練回答先存檔、丟掉、取消（answer）。 */
	get asking(): boolean {
		return this.#asking !== null;
	}

	/**
	 * 回答「還沒存」：丟掉就接著換流程；取消就留著；先存檔要存好了（沒有未存的修改）才接著換，
	 * 在存檔視窗按取消或存失敗，就留在問的畫面。
	 */
	async answer(choice: 'save' | 'discard' | 'cancel') {
		const then = this.#asking;
		if (!then) return;
		if (choice === 'cancel') {
			this.#asking = null;
			return;
		}
		if (choice === 'save') {
			await this.save();
			if (this.#editor.session.unsaved || !this.#asking) return;
		}
		this.#asking = null;
		then();
	}

	/** 會換掉現在的流程（開檔、新建）：有還沒存的修改就先問，確定才做。 */
	#unlessUnsaved(then: () => void) {
		// 換掉的流程是這個分頁放在草稿裡的：它的草稿跟著丟掉（「不存了，繼續」、剛建好沒改就新建），重新整理不會又問要不要救回。
		// 只丟這支流程的，別支流程的草稿不動。
		const go = () => {
			if (this.ownsDraft) void this.#dropDraft(this.#draftId);
			then();
		};
		if (this.#editor.session.unsaved) this.#asking = go;
		else go();
	}

	// ---------- 草稿 ----------

	/** 首頁列的最近的流程：有草稿的那幾支，最近的在前。 */
	get recent(): RecentFlow[] {
		return this.#recent;
	}

	/**
	 * 打開最近的流程裡的一支：有沒存的修改的，跟救回草稿一樣（還算未存，不在檔案裡）；沒改過的，跟開那個檔一樣。
	 * 另一個分頁正在編它就不開，首頁說原因。
	 */
	async openRecent(id: string) {
		let draft = null;
		try {
			draft = await this.#editor.adapters.draftStore.load(id);
		} catch {
			// 讀不到就當作沒有
		}
		const r = draft && readFlowFile(draft.bytes);
		if (!draft || !r || r.kind !== 'ok') {
			this.#openError = '這份草稿讀不出來';
			return;
		}
		const unchanged = fileDraftId(draft.bytes) === id;
		await this.#openBytes(draft.bytes, unchanged ? flowFileName(r.flow.name) : null, null, id);
	}

	/** 丟掉最近的流程裡的一支（頁面先問過教練了）：先問別的分頁有沒有在編它，有就不丟，標成正在編。 */
	async discardRecent(id: string) {
		if (await this.#otherTabEditing(id)) {
			this.#recent = this.#recent.map((f) => (f.id === id ? { ...f, busy: true } : f));
			return;
		}
		this.#clearDraft(id);
	}

	/** 另一個分頁回答它正在編這支流程（草稿 id）嗎（等一下下，沒人回就是沒有）。 */
	#otherTabEditing(id: string): Promise<boolean> {
		const channel = this.#channel;
		if (!channel) return Promise.resolve(false);
		return new Promise((resolve) => {
			const stop = channel.listen((message) => message.kind === 'editing' && message.id === id && done(true));
			const timer = setTimeout(() => done(false), OTHER_TAB_WAIT_MS);
			function done(editing: boolean) {
				clearTimeout(timer);
				stop();
				resolve(editing);
			}
			channel.post({ kind: 'editing?', id });
		});
	}

	/** 打開時讀草稿，列成最近的流程。讀完了才開始自動存。 */
	async #checkDraft() {
		await this.#readRecent();
		this.#draftChecked = true;
		this.#saveDraftLater();
	}

	/**
	 * 讀最近的流程（在首頁時：打開時、回到首頁、草稿存了或清了）：每份草稿打開看名字（打不開的不列），
	 * 改過沒存的標出來（沒改過的草稿就是那個檔，位元組算出來的 id 跟草稿 id 一樣）。讀不到草稿（例：私密視窗）就當作沒有。
	 * 列好了才問別的分頁有沒有在編（不等回答就先列出來；還沒回答前點了，打開時照樣會擋）。
	 */
	async #readRecent() {
		const read = ++this.#recentRead;
		const store = this.#editor.adapters.draftStore;
		let found: RecentFlow[] = [];
		try {
			const drafts = await Promise.all(newestFirst(await store.list()).map((d) => store.load(d.id)));
			for (const d of drafts) {
				const r = d && readFlowFile(d.bytes);
				if (!d || !r || r.kind !== 'ok') continue;
				found.push({ id: d.id, name: r.flow.name, savedAt: d.savedAt, unsaved: fileDraftId(d.bytes) !== d.id, busy: false });
			}
		} catch {
			found = [];
		}
		if (read !== this.#recentRead) return;
		this.#recent = found;
		for (const f of found) {
			void this.#otherTabEditing(f.id).then((busy) => {
				if (busy && read === this.#recentRead) this.#recent = this.#recent.map((g) => (g.id === f.id ? { ...g, busy } : g));
			});
		}
	}

	/**
	 * 編輯時自動存草稿：停手 1 秒才存（整個 zip 含音樂，不要每一下都存）。剛建好、還沒改的流程也存，重新整理救得回來。
	 * 在檔案裡、沒有未存的修改（存好了、改回原樣）：草稿換回那個檔，首頁的最近的流程打開是沒改過的。
	 * 流程換了（session 叫）、存好了、讀過草稿了都從頭算 1 秒。
	 */
	#saveDraftLater() {
		clearTimeout(this.#draftTimer);
		this.#draftTimer = undefined;
		if (!this.#draftChecked || !this.#editor.session.flow) return;
		this.#draftTimer = setTimeout(() => this.#saveDraftNow(), DRAFT_DELAY_MS);
	}

	/**
	 * 現在存草稿（停手 1 秒到了、分頁藏起來了）：先送出欄位裡打到一半的字，草稿才有剛打的字
	 * （送出會改流程、又排一次 1 秒後存，這裡一起存掉）。
	 */
	#saveDraftNow() {
		const { session, adapters, music } = this.#editor;
		adapters.pendingInput.flush();
		clearTimeout(this.#draftTimer);
		this.#draftTimer = undefined;
		const f = session.flow;
		if (!f) return;
		if (this.ownsDraft) void this.#saveDraft(writeFlowFile(f, music.bytes(f)));
		else if (this.#fileBytes) void this.#saveDraft(this.#fileBytes);
	}

	/**
	 * 分頁藏起來了、要關了（pagehide、visibilitychange 變 hidden）：送出欄位裡打到一半的字，
	 * 還沒進草稿的改動現在就存，不等停手 1 秒（iPad 收掉分頁不會問 beforeunload）。
	 */
	pageHidden() {
		if (!this.#editor.session.flow) return;
		this.#editor.adapters.pendingInput.flush();
		if (this.#draftTimer !== undefined) this.#saveDraftNow();
	}

	/**
	 * 存這支流程的草稿。存不了（例：私密視窗）就算了，草稿只是保險。
	 * 這份草稿第一次存：草稿超過 5 支流程的，就丟掉最舊的。
	 */
	async #saveDraft(bytes: Uint8Array): Promise<void> {
		const id = this.#draftId;
		const store = this.#editor.adapters.draftStore;
		try {
			await store.save(id, bytes);
			this.#draftsChanged();
			if (this.#countedDraftId === id) return;
			this.#countedDraftId = id;
			const others = newestFirst((await store.list()).filter((d) => d.id !== id));
			for (const old of others.slice(MAX_DRAFTS - 1)) void this.#dropDraft(old.id);
		} catch {
			// 草稿只是保險
		}
	}

	/** 丟掉一支流程的草稿：先問別的分頁，有分頁正在編它就不丟。 */
	async #dropDraft(id: string) {
		if (!(await this.#otherTabEditing(id))) this.#clearDraft(id);
	}

	/** 清掉一支流程的草稿（不問）。清不了就算了。 */
	#clearDraft(id: string) {
		this.#editor.adapters.draftStore
			.clear(id)
			.then(() => this.#draftsChanged())
			.catch(() => {});
	}

	/** 草稿存了或清了：在首頁就重讀最近的流程。 */
	#draftsChanged() {
		if (!this.#editor.session.flow) void this.#readRecent();
	}

	/** 這個分頁的流程要不要放在草稿裡：開著流程，有未存的修改或不在檔案裡。 */
	get ownsDraft(): boolean {
		const { session } = this.#editor;
		return !!session.flow && (session.unsaved || !this.#onDisk);
	}
}

/** 首頁列的最近的流程裡的一支。 */
export interface RecentFlow {
	/** 草稿 id。 */
	id: string;
	name: string;
	/** 草稿什麼時候存的；舊版編輯器存的是 null。 */
	savedAt: Date | null;
	/** 有沒存的修改（不是剛開、剛存好的那個檔）。 */
	unsaved: boolean;
	/** 另一個分頁正在編它：不能打開、不能丟掉。 */
	busy: boolean;
}

/** 剛建好的流程的草稿 id：每次都不一樣。 */
function newDraftId(): string {
	return `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** 從流程檔開的、存成流程檔的草稿 id：照檔案的位元組算（FNV-1a），同一個檔算出來一樣。 */
function fileDraftId(bytes: Uint8Array): string {
	let hash = 0x811c9dc5;
	for (const b of bytes) hash = Math.imul(hash ^ b, 0x01000193);
	return `f${bytes.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}

/** 草稿照存的時間排，最近的在前；沒記時間的（舊版編輯器存的）最舊。 */
function newestFirst(drafts: DraftInfo[]): DraftInfo[] {
	return [...drafts].sort((a, b) => (b.savedAt?.getTime() ?? -Infinity) - (a.savedAt?.getTime() ?? -Infinity));
}

/** 草稿存的時間寫成「11/5 14:03」。 */
export function draftTime(d: Date): string {
	return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
