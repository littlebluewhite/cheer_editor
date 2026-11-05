// 流程檔：編輯器 module 握著（getEditor().file）。開檔、存檔、新建、「沒存先問」都在這裡，頁面只照它的狀態畫對話框和提示。
// 管：這支流程在不在檔案裡、正在存、「還沒存」的問題、開檔錯誤、缺音樂的提示、
// 一支流程一個存檔薄層（記得存到哪個檔，換流程就丟掉）。草稿的自動存、讀、丟掉還在頁面。

import { missingAudioNames, readFlowFile, writeFlowFile, type Flow } from '#lib/core';
import { flowFileName, type FileSaver, type PickedFile } from '#lib/file/save.js';
import type { Editor } from '#lib/editor.svelte.js';
import type { MusicLibrary } from '#lib/music-library.svelte.js';

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

	/**
	 * 換成另一支流程（新建、開檔、救回草稿）時頁面要做的事：練習畫面重開、對話框都關掉。頁面建好時接上。
	 * 播放停下、回到開頭由播放做（session.open 叫它）。
	 */
	onswitch: () => void = () => {};

	/** 給編輯器的流程算從檔案開的。 */
	constructor(editor: Editor) {
		this.#editor = editor;
		this.#onDisk = !!editor.session.flow;
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
		this.#unlessUnsaved(() => {
			this.#start(r.flow, fileName === null ? 'draft' : 'file', music, saver);
			session.notice = r.missingSegmentIds.length
				? `「${fileName ?? '草稿'}」裡少了音樂檔${missingAudioNames(r.flow, r.missingSegmentIds).map((n) => `「${n}」`).join('')}：點紅色的段重新選檔`
				: music.hasBroken
					? '有音樂檔這個瀏覽器讀不出來，播放時會沒有聲音'
					: '';
			if (r.missingSegmentIds.length) this.#noteMissing();
		});
	}

	/** 救回草稿：換上草稿的流程（還算未存，不在檔案裡）。 */
	async openDraft(bytes: Uint8Array) {
		await this.#openBytes(bytes, null);
	}

	/** 新建流程表單建好了：換上它。 */
	create(flow: Flow) {
		this.#start(flow, 'new');
	}

	/** 上方列「新建」：回到新建流程的畫面。 */
	startNew() {
		this.#unlessUnsaved(() => this.#editor.session.open(null));
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
		this.picked();
	}

	/** 給一段選好了音樂檔（音樂檔庫叫的）：「有段找不到音樂」的提示還在、缺的音樂都補好了，就收掉它。 */
	picked() {
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
		// 換掉的流程是這個分頁放在草稿裡的：草稿跟著丟掉（「不存了，繼續」、剛建好沒改就新建），重新整理不會又問要不要救回。
		const go = () => {
			if (this.ownsDraft) this.#editor.adapters.draftStore.clear().catch(() => {});
			then();
		};
		if (this.#editor.session.unsaved) this.#asking = go;
		else go();
	}

	/** 這個分頁的流程要不要放在草稿裡：開著流程，有未存的修改或不在檔案裡。 */
	get ownsDraft(): boolean {
		const { session } = this.#editor;
		return !!session.flow && (session.unsaved || !this.#onDisk);
	}
}
