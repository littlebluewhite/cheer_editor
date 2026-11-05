// 流程檔：編輯器 module 握著（getEditor().file）。開檔、存檔、新建、回首頁、草稿、「沒存先問」都在這裡，頁面只照它的狀態畫對話框和提示。
// 管：這支流程在不在檔案裡、正在存、「還沒存」的問題、開檔錯誤、缺音樂的提示、
// 一支流程一個存檔薄層（記得存到哪個檔，換流程就丟掉）、草稿（停手 1 秒自動存、打開時問要不要救回、丟掉前先問別的分頁）。

import { missingAudioNames, readFlowFile, writeFlowFile, type Flow } from '#lib/core';
import type { Draft } from '#lib/file/draft.js';
import { flowFileName, type FileSaver, type PickedFile } from '#lib/file/save.js';
import type { Editor } from '#lib/editor.svelte.js';
import type { MusicLibrary } from '#lib/music-library.svelte.js';
import type { TabChannel } from '#lib/tab-channel.js';

/** 停手多久才存草稿。 */
const DRAFT_DELAY_MS = 1000;
/** 丟掉草稿前等別的分頁回答多久。 */
const OTHER_TAB_WAIT_MS = 300;

export class FlowFile {
	readonly #editor: Editor;
	/** 這支流程在檔案裡（從檔案開的、存過檔）：沒有未存的修改就不用草稿。剛建好、救回草稿的不在檔案裡。 */
	#onDisk = $state(false);
	/** 存檔薄層，一支流程一個（記得存到哪個檔）：第一次存檔才建，換流程就丟掉。 */
	#saver: FileSaver | null = null;
	/** 正在存：存好之前再按存檔不算。 */
	#saving = false;
	#openError = $state('');
	/** 等教練回答「還沒存」：確定就做這件事（換流程）。open = 問的是要開別的流程檔。 */
	#asking = $state.raw<{ then: () => void; open: boolean } | null>(null);
	/** 按「開啟」時已經答應丟掉還沒存的修改：選到的檔打開時不再問。又改了流程就不算。 */
	#openApproved = false;
	/** 說「有段找不到音樂」的那則提示（開檔、存檔時給的）。 */
	#missingNotice = '';
	/** 讀過草稿了：在這之前不自動存，免得蓋掉還沒問過的草稿。 */
	#draftChecked = false;
	/** 打開時找到的草稿，等教練選救回或丟掉。busy = 按了丟掉，但另一個分頁正在編輯它。 */
	#offer = $state.raw<{ bytes: Uint8Array; name: string; savedAt: Date | null; busy?: boolean } | null>(null);
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
			this.#openApproved = false;
			this.#saveDraftLater();
			this.#dropMissingNotice();
		};
	}

	/**
	 * 頁面打開了：開分頁頻道（別的分頁來問，這個分頁的草稿是它的就回答「正在編」），讀草稿。
	 * 回傳頁面關掉時要做的：關掉分頁頻道、還在等停手 1 秒的草稿不存了。
	 */
	connect(): () => void {
		const channel = this.#editor.adapters.openTabChannel?.() ?? null;
		this.#channel = channel;
		channel?.listen((message) => {
			if (message === 'editing?' && this.ownsDraft) channel.post('editing');
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
			const outcome = await this.#saver.save(writeFlowFile(f, music.bytes(f)), fileName);
			if (outcome === 'cancelled') return;
			session.markSaved(f);
			this.#onDisk = true;
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
	 * saver：存回那個檔的存檔薄層（沒有就第一次存檔時再建）。
	 */
	async #openBytes(bytes: Uint8Array, fileName: string | null, saver: FileSaver | null = null) {
		const session = this.#editor.session;
		const r = readFlowFile(bytes);
		if (r.kind === 'error') {
			const message = `打不開「${fileName}」：${r.message}`;
			if (session.flow) session.notice = message;
			else this.#openError = message;
			return;
		}
		// 檔案裡的音樂解碼好（這個瀏覽器解不開的標成壞的），換流程時換上
		const music = await this.#editor.readMusic(r.audio);
		const approved = this.#openApproved;
		this.#openApproved = false;
		this.#unlessUnsaved(true, approved, () => {
			this.#start(r.flow, fileName === null ? 'draft' : 'file', music, saver);
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
		this.#start(flow, 'new');
		if (this.#draftChecked) this.#saveDraft(writeFlowFile(flow, {}));
	}

	/** 上方列「新建」：回到新建流程的畫面。 */
	startNew() {
		this.#unlessUnsaved(false, false, () => this.#editor.session.open(null));
	}

	/**
	 * 上方列「開啟」：有還沒存的修改就先問「要開別的流程檔」，答應了才選檔（choose：跳選檔視窗或選檔欄位），選到的檔打開時不再問。
	 * 回傳現在就能選檔（沒有未存的修改、剛答應過）。
	 */
	mayChoose(choose: () => void): boolean {
		if (this.#openApproved || !this.#editor.session.unsaved) return true;
		this.#asking = {
			open: true,
			then: () => {
				this.#openApproved = true;
				choose();
			}
		};
		return false;
	}

	/**
	 * 「視窗太窄」提示上的「回首頁」：有還沒存的修改就跟「新建」一樣先問。
	 * 沒有就直接回去；剛建好、沒改過的流程留在草稿裡，首頁問要不要救回。
	 */
	async leaveToHome() {
		const { session, music } = this.#editor;
		if (session.unsaved) return this.startNew();
		const f = session.flow;
		const bytes = f && this.ownsDraft ? writeFlowFile(f, music.bytes(f)) : null;
		session.open(null);
		if (!f || !bytes) return;
		await this.#saveDraft(bytes);
		this.#offer = { bytes, name: f.name, savedAt: new Date() };
	}

	/**
	 * 換成另一支流程（新建、開檔、救回草稿）。選取、提示由 session 清掉。
	 * music：這支流程的音樂檔庫（開檔、救回草稿時解碼好的；沒給是空的）。
	 */
	#start(flow: Flow, from: 'file' | 'draft' | 'new', music?: MusicLibrary, saver: FileSaver | null = null) {
		const editor = this.#editor;
		// 剛建好的不算未存（沒改過就換別的不用問），但不在檔案裡，照樣存草稿
		editor.session.open(flow, from !== 'draft');
		this.#onDisk = from === 'file';
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

	/** 問的是要開別的流程檔（不是新建、回首頁）。 */
	get askingToOpen(): boolean {
		return !!this.#asking?.open;
	}

	/**
	 * 回答「還沒存」：丟掉就接著換流程；取消就留著；先存檔要存好了（沒有未存的修改）才接著換，
	 * 在存檔視窗按取消或存失敗，就留在問的畫面。
	 */
	async answer(choice: 'save' | 'discard' | 'cancel') {
		const then = this.#asking?.then;
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

	/** 會換掉現在的流程（open：開檔；不然是新建、回首頁）：有還沒存的修改、又還沒答應過（approved）就先問，確定才做。 */
	#unlessUnsaved(open: boolean, approved: boolean, then: () => void) {
		// 換掉的流程是這個分頁放在草稿裡的：草稿跟著丟掉（「不存了，繼續」、剛建好沒改就新建），重新整理不會又問要不要救回。
		const go = () => {
			if (this.ownsDraft) this.#dropDraft();
			then();
		};
		if (this.#editor.session.unsaved && !approved) this.#asking = { then: go, open };
		else go();
	}

	// ---------- 草稿 ----------

	/** 打開時找到草稿：問要不要救回（text），丟不掉時說為什麼（error）。沒有草稿、教練已經開始編了就是 null。 */
	get draftOffer(): { text: string; error: string } | null {
		const offer = this.#offer;
		if (!offer) return null;
		return {
			text: `上次編的「${offer.name}」還沒存，要救回嗎？${offer.savedAt ? `（${draftTime(offer.savedAt)} 存的草稿）` : ''}`,
			error: offer.busy ? '另一個分頁正在編輯這份草稿，所以沒有丟掉。' : ''
		};
	}

	/** 救回草稿：換上草稿的流程（還算未存，不在檔案裡）。 */
	async restoreDraft() {
		const offer = this.#offer;
		if (!offer) return;
		this.#offer = null;
		await this.#openBytes(offer.bytes, null);
	}

	/** 丟掉草稿：先問別的分頁有沒有在編它，有就不丟，提示裡說它正在被編。 */
	async discardDraft() {
		const offer = this.#offer;
		if (!offer) return;
		if (await this.#otherTabEditing()) {
			if (this.#offer === offer) this.#offer = { ...offer, busy: true };
			return;
		}
		this.#offer = null;
		this.#dropDraft();
	}

	/** 另一個分頁回答它正在編輯草稿嗎（等一下下，沒人回就是沒有）。 */
	#otherTabEditing(): Promise<boolean> {
		const channel = this.#channel;
		if (!channel) return Promise.resolve(false);
		return new Promise((resolve) => {
			const stop = channel.listen((message) => message === 'editing' && done(true));
			const timer = setTimeout(() => done(false), OTHER_TAB_WAIT_MS);
			function done(editing: boolean) {
				clearTimeout(timer);
				stop();
				resolve(editing);
			}
			channel.post('editing?');
		});
	}

	/** 打開時讀草稿：讀得到、打得開，教練又還沒開始編，就問要不要救回。讀完了才開始自動存。 */
	async #checkDraft() {
		let draft: Draft | null = null;
		try {
			draft = await this.#editor.adapters.draftStore.load();
		} catch {
			// 讀不到草稿就當作沒有
		}
		const r = draft && readFlowFile(draft.bytes);
		// 等讀草稿的時候教練已經開始編了：不打斷他
		if (draft && r && r.kind === 'ok' && !this.#editor.session.flow) this.#offer = { ...draft, name: r.flow.name };
		this.#draftChecked = true;
		this.#saveDraftLater();
	}

	/**
	 * 編輯時自動存草稿：停手 1 秒才存（整個 zip 含音樂，不要每一下都存）。剛建好、還沒改的流程也存，重新整理救得回來。
	 * 存成流程檔或剛開流程檔（在檔案裡、沒有未存的修改）就丟掉草稿：檔案裡已經有了，下次打開不用問。
	 * 流程換了（session 叫）、存好了、讀過草稿了都從頭算 1 秒。
	 */
	#saveDraftLater() {
		clearTimeout(this.#draftTimer);
		const f = this.#editor.session.flow;
		if (!this.#draftChecked || !f) return;
		this.#draftTimer = setTimeout(() => {
			if (this.ownsDraft) this.#saveDraft(writeFlowFile(f, this.#editor.music.bytes(f)));
			else this.#dropDraft();
		}, DRAFT_DELAY_MS);
	}

	/** 存草稿。存不了（例：私密視窗）就算了，草稿只是保險。 */
	#saveDraft(bytes: Uint8Array): Promise<void> {
		return this.#editor.adapters.draftStore.save(bytes).catch(() => {});
	}

	/** 丟掉草稿。丟不了就算了。 */
	#dropDraft() {
		this.#editor.adapters.draftStore.clear().catch(() => {});
	}

	/** 這個分頁的流程要不要放在草稿裡：開著流程，有未存的修改或不在檔案裡。 */
	get ownsDraft(): boolean {
		const { session } = this.#editor;
		return !!session.flow && (session.unsaved || !this.#onDisk);
	}
}

/** 草稿存的時間寫成「11/5 14:03」。 */
function draftTime(d: Date): string {
	return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
