// 流程檔：編輯器 module 握著（getEditor().file）。開檔、存檔、新建、回首頁、草稿、「沒存先問」都在這裡，頁面只照它的狀態畫對話框和提示。
// 管：這支流程在不在檔案裡、正在存、「還沒存」的問題、開檔錯誤、缺音樂的提示、
// 一支流程一個存檔薄層（記得存到哪個檔，換流程就丟掉）、草稿（每支流程一份，超過 5 支只自動丟沒改過的；停手 1 秒自動存，
// 從檔案開的、存好的沒改過也留一份；首頁列成「最近的流程」；另一個分頁正在編的流程不能打開，清掉草稿前先問別的分頁；
// 開檔時那個檔有改過沒存的草稿，先問要救回修改還是用檔案）。
// 雲端流程（新建時選存在雲端、首頁「我的流程」點的）也從這裡打開：它沒有草稿，不列在最近的流程（#247），
// 每一步送伺服器存（cloud，#248），沒有存檔。
// 用分享連結打開的（#251）：已經有權限的照自己的權限打開；沒有的只能看：不連房間、沒有草稿、沒有練習頁。
// 開著的流程從哪來（本機流程、雲端流程、分享連結、離線副本）是一個流程來源值（source，#322），能做什麼從它算（can，flow-source.ts）。
// 雲端流程這台還沒傳的成功率紀錄（#260）：打開時從離線存放拿出來放回流程、接著傳；被收回時還有沒傳的，先擋住列出來（lost），
// 按「知道了」才丟掉、回首頁。

import {
	audioExtension,
	FORMAT_VERSION,
	labelWhy,
	missingAudioNames,
	putRecords,
	readFlowFile,
	segmentSpans,
	takeRecords,
	writeFlowFile,
	type Attempt,
	type AudioBytes,
	type Flow
} from '#lib/core';
import { reasonText, whyText } from '#lib/reason-text.js';
import { CloudSteps, withUnsent } from '#lib/cloud-steps.svelte.js';
import { joinNotes, joinSentences } from '#lib/editor-session.svelte.js';
import type { DraftInfo } from '#lib/file/draft.js';
import { flowFileName, type FileSaver, type PickedFile, type SaveOutcome } from '#lib/file/save.js';
import type { Editor } from '#lib/editor.svelte.js';
import { MAX_CLOUD_AUDIO_BYTES, type MusicLibrary } from '#lib/music-library.svelte.js';
import { copiesToDrop, isEmptyUnsent, mergeUnsent, unsentCount, type OfflineCopy } from '#lib/offline-store.js';
import type { CloudFlow } from '#lib/server-api.js';
import { LOCAL, whatCanDo, type Abilities, type FlowSource } from '#lib/flow-source.js';
import type { DroppedRecord } from '#lib/practice-rights.js';
import type { TabChannel } from '#lib/tab-channel.js';
import { host } from '#lib/host.js';
import { loadLastFlow, saveLastFlow } from '#lib/local-settings.js';
import { SETTINGS_FEATURE } from '#lib/shell-settings.js';
import { OPEN_FILE_FEATURE, takeOpenedFile } from '#lib/shell-open-file.js';
import { m } from '#lib/paraglide/messages.js';

/** 被收回回首頁時，黃條說的。 */
const revokedText = (name: string) => m.file_revoked({ name });
/** 流程被擁有者刪了回首頁時，黃條說的（#252）。 */
const deletedText = (name: string) => m.file_deleted({ name });

/** 伺服器拿到的雲端流程存成離線副本的樣子（時間之後填）。 */
function copyOf(found: CloudFlow, name: string): Omit<OfflineCopy, 'savedAt' | 'openedAt'> {
	return { flowId: found.id, name, role: found.role, step: found.step, flow: found.flow, records: found.records };
}

/** 上次那支是雲端流程時，記的是這個加流程的 id（#383；草稿 id 不會有冒號）。 */
const CLOUD_LAST = 'cloud:';

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
	/** 等教練回答「還沒存」：確定就做這件事（換流程）。open = 問的是要開別的流程檔。 */
	#asking = $state.raw<{ then: () => void; open: boolean } | null>(null);
	/** 開檔時那個檔有改過沒存的草稿：等教練回答救回修改、用檔案、取消（answerDraft）。 */
	#draftAsk = $state.raw<(DraftAsk & { resolve: (choice: DraftChoice) => void }) | null>(null);
	/** 按「開啟」時已經答應丟掉還沒存的修改：選到的檔打開時不再問。又改了流程就不算。 */
	#openApproved = false;
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
	/** 開著的流程從哪來（本機流程、雲端流程、分享連結、離線副本）；在首頁是本機。 */
	#source = $state.raw<FlowSource>(LOCAL);
	/** 正在傳上雲端：傳好之前再按不算。 */
	#uploading = false;
	/** 傳上雲端時有音樂檔太大：跳框寫是哪一段、幾 MB（按「知道了」清掉）。 */
	#tooBig = $state.raw<AudioTooBig | null>(null);
	/** 跟別的分頁說過「正在編」的草稿 id（沒開流程是 null）：換了就先說「不編了」。 */
	#announced: string | null = null;
	/** App 打開時正在回上次那支（#378）：還沒開好、也還沒確定不見了之前，頁面不先畫首頁。殼會存小設定才回（網頁版不回）。 */
	#reopening = $state(host().shell.can(SETTINGS_FEATURE) && loadLastFlow() !== '');

	/** 給編輯器的流程算從檔案開的。 */
	constructor(editor: Editor) {
		this.#editor = editor;
		this.#onDisk = !!editor.session.flow;
		editor.session.onflow = () => {
			this.#openApproved = false;
			this.#saveDraftLater();
			this.#saveCopyLater();
			this.#dropMissingNotice();
			this.#announce();
			this.#rememberLast();
			if (!editor.session.flow) {
				this.#closeCloud();
				void this.#readRecent();
			}
		};
	}

	/**
	 * 頁面打開了：開分頁頻道（別的分頁來問，這個分頁開著的就是那支流程，就回答「正在編」），讀草稿；
	 * App 裡聽殼說要切到背景（WKWebView 不一定發 visibilitychange），跟分頁藏起來一樣馬上存（#377），
	 * 也再記一次上次那支（#378；打開、離開流程時就記了，見 #rememberLast）。
	 * reopen：App 換上新網頁回來要打開的雲端流程（網址 ?cloud=，#394）：開它，不回上次那支（兩個一起開，後開好的會蓋掉）。
	 * App 裡只有一個視窗，不會有別的分頁：不開分頁頻道，「另一個分頁正在編」不會出現（#392）。
	 * 回傳頁面關掉時要做的：關掉分頁頻道、不聽殼了、還在等停手 1 秒的草稿不存了。
	 */
	connect(reopen: string | null = null): () => void {
		const channel = host().shell.inApp ? null : (this.#editor.adapters.openTabChannel?.() ?? null);
		this.#channel = channel;
		channel?.listen((message) => {
			if (message.kind === 'editing?' && this.#editor.session.flow && message.id === this.#draftId) {
				channel.post({ kind: 'editing', id: message.id });
			}
			// 別的分頁打開、離開一支流程：首頁的「另一個分頁正在編」跟著改
			if (message.kind === 'editing' || message.kind === 'released') {
				const busy = message.kind === 'editing';
				if (this.#recent.some((f) => f.id === message.id && f.busy !== busy)) {
					this.#recent = this.#recent.map((f) => (f.id === message.id ? { ...f, busy } : f));
				}
			}
		});
		this.#announce();
		void this.#checkDraft(reopen);
		const stopHearing = host().shell.on('background', () => {
			this.pageHidden();
			this.#rememberLast();
		});
		// 從「檔案」、分享選單交給開著的 App 的流程檔（#384）：殼說一聲，拿來照開檔的規則打開（有沒存的修改先問）
		const stopFiles = host().shell.on('fileOpened', () => void this.#openHandedFile());
		return () => {
			stopHearing();
			stopFiles();
			this.pageClosed();
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
		// 雲端流程每一步都存了，沒有存檔（要流程檔用 download）
		if (!session.flow || this.#saving || this.#source.kind !== 'local') return;
		// 名字、備註這類欄位在失去焦點時才送進流程；先送出，存的才有剛打的字（iPad 點按鈕不一定會讓輸入框失去焦點）。
		adapters.pendingInput.flush();
		const f = session.flow;
		this.#saving = true;
		// 第一次存（這支流程還沒有存檔薄層）：下載新檔時多說一句這個瀏覽器怎麼存；原本在不在檔案裡（從檔案開的）
		const first = !this.#saver;
		const hadFile = this.#onDisk;
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
			this.#announce();
			this.#saveDraftLater();
			// App 裡沒有電腦的 Chrome、Edge 可以換（接了觸控板的 iPad 也是），跟觸控螢幕一樣只說原本的檔沒改（#392）
			const saved = savedText(outcome, this.#saver.fileName ?? fileName, first, hadFile, !!this.#saver.touch || host().shell.inApp);
			session.notice = missing
				? joinNotes([saved, (missing === 1 ? m.file_saved_missing_audio_one : m.file_saved_missing_audio)({ count: missing })])
				: saved;
			if (missing) this.#noteMissing();
		} catch {
			session.notice = m.file_save_failed();
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
	async #openBytes(bytes: Uint8Array, fileName: string | null, saver: FileSaver | null = null, draftId = fileDraftId(bytes)): Promise<void> {
		const session = this.#editor.session;
		const r = readFlowFile(bytes);
		const cannotOpen = (reason: string) => {
			const message = m.file_cannot_open({ name: fileName ?? (r.kind === 'ok' ? r.flow.name : m.file_draft()), reason });
			if (session.flow) session.notice = message;
			else this.#openError = message;
		};
		if (r.kind === 'error') {
			if (!fileName || !audioExtension(fileName)) return cannotOpen(reasonText(r));
			// 拿音樂檔來開：說音樂要去段設定載入（首頁還沒有段，先建流程）
			return cannotOpen(session.flow ? m.file_is_audio_editing() : m.file_is_audio_home());
		}
		if (await this.#otherTabEditing(draftId)) return cannotOpen(m.file_other_tab());
		// 從檔案開的、這台電腦上有這個檔改過沒存的草稿（不是這個分頁正開著的）：先問，不蓋掉修改
		if (fileName !== null && !(session.flow && draftId === this.#draftId)) {
			const changed = await this.#changedDraft(draftId);
			if (changed) {
				const choice = await new Promise<DraftChoice>((resolve) => {
					this.#draftAsk = { name: r.flow.name, savedAt: changed.savedAt, resolve };
				});
				this.#draftAsk = null;
				if (choice === 'cancel') return;
				if (choice === 'draft') return this.#openBytes(changed.bytes, null, null, draftId);
			}
		}
		// 檔案裡的音樂解碼好（這個瀏覽器解不開的標成壞的），換流程時換上
		const music = await this.#editor.readMusic(r.audio);
		const approved = this.#openApproved;
		this.#openApproved = false;
		this.#unlessUnsaved(true, approved, () => {
			this.#start(r.flow, fileName === null ? 'draft' : 'file', draftId, music, saver);
			// 從檔案開的：當下就把這個檔存成草稿，重新整理後首頁的最近的流程裡有它
			if (fileName !== null) {
				this.#fileBytes = bytes;
				if (this.#draftChecked) void this.#saveDraft(bytes);
			}
			// 開好了寫檔名（草稿救回來的不是檔，不寫）；缺音樂的提示本來就有檔名。開檔時拿掉的書籤、排好的站位（手改過的檔）接在後面說
			const parts: (string | false)[] = r.missingSegmentIds.length
				? [missingAudioText(fileName ?? m.file_draft(), missingAudioNames(r.flow, r.missingSegmentIds))]
				: [fileName !== null && m.file_opened({ name: fileName }), music.hasBroken && (host().shell.inApp ? m.file_broken_audio_app() : m.file_broken_audio())];
			if (r.droppedBookmarks.length) parts.push(droppedBookmarksText(r.droppedBookmarks));
			if (r.sortedFormations) parts.push(m.file_sorted_formations());
			const said = parts.filter((x): x is string => !!x);
			session.notice = said.length ? joinNotes(said) : '';
			if (r.missingSegmentIds.length) this.#noteMissing();
		});
	}

	/** 新建流程表單建好了：換上它。剛建好的當下就存一次草稿，不等停手 1 秒：手機上建好不能編，按「回首頁」也不會丟。 */
	create(flow: Flow) {
		this.#start(flow, 'new', newDraftId());
		if (this.#draftChecked) this.#saveDraft(writeFlowFile(flow, {}));
	}

	/** 開著的流程從哪來（本機流程、雲端流程、分享連結、離線副本）；在首頁是本機。 */
	get source(): FlowSource {
		return this.#source;
	}

	/** 這支流程能做什麼（每一項附原因）：選單、上方列照這個畫。signedIn：登入了沒。 */
	can(signedIn: boolean): Abilities {
		return whatCanDo(this.#source, signedIn, this.#editor.hasUnsavedWork, this.#editor.session.practice);
	}

	/** 開著的雲端流程（含分享連結、離線副本）在伺服器上的 id；開著本機流程、在首頁是 null。 */
	get cloudId(): string | null {
		return this.#source.kind === 'local' ? null : this.#source.id;
	}

	/** 開著的雲端流程（含離線副本）的一步一步存（名字旁「存中…」「✓ 已存」、有新版）；本機流程、分享連結、在首頁是 null。 */
	get cloud(): CloudSteps | null {
		return 'steps' in this.#source ? this.#source.steps : null;
	}

	#closeCloud() {
		this.cloud?.close();
		clearTimeout(this.#copyTimer);
		if (this.#source.kind === 'link') this.#editor.session.readOnly = '';
		this.#source = LOCAL;
	}

	/** 新建表單選了存在雲端：伺服器照表單的名字、場地建一支，再打開它（沒有草稿）。 */
	async createCloud(flow: Flow) {
		let made;
		try {
			made = await this.#editor.adapters.server.createFlow({ name: flow.name, field: flow.field });
		} catch {
			this.#openError = m.file_cloud_create_unreachable();
			return;
		}
		await this.openCloud(made.id);
	}

	/**
	 * 打開一支雲端流程：從伺服器拿編排，連它的房間，每一步送伺服器存；沒有草稿。
	 * 打開了就在這台留一份離線副本（#261，含音樂），只留最近打開的 5 支。連不上伺服器、這台有離線副本：打開那份
	 * （斷線的樣子：只能看、能記），連上了就換成最新的（refresh：換的時候不關練習畫面、對話框）。
	 * still：拿完了要換上之前再問一次還要不要（傳上雲端時又改了就不換）。
	 * first：先開這份離線副本，不先問伺服器（App 打開上次那支，#383）：先當斷著（只能看、能記），連上了就換成最新的。
	 */
	async openCloud(id: string, refresh = false, still = () => true, first: OfflineCopy | null = null) {
		const { server, offline: store } = this.#editor.adapters;
		let found: CloudFlow | null = null;
		let copy: OfflineCopy | null = first;
		try {
			if (!copy) found = await server.cloudFlow(id);
		} catch {
			copy = (await store.copies()).find((c) => c.flowId === id) ?? null;
			if (!copy) {
				if (!refresh) this.#openError = m.file_cloud_open_unreachable();
				return;
			}
		}
		if (copy) found = { id, flow: copy.flow, step: copy.step, updatedAt: '', role: copy.role, records: copy.records };
		if (!found) {
			this.#openError = m.file_cloud_gone();
			return;
		}
		// 紀錄跟編排分開存（ADR 0011）：放回流程；別人記的記下名字（記號後面寫）。這台還沒傳的也放回去（#260）。
		const records = found.records.map((r) => ({ actionId: r.actionId, attempt: r.attempt as Attempt }));
		const fromServer = putRecords(found.flow as Flow, records);
		// 從離線副本換成最新的（#383 每次打開 App 都會）：手上已經有的音樂不再下載（音樂 id 換了檔就換）
		const shown = this.#editor.session.flow;
		const fromCopy = refresh && this.#source.kind === 'offline' && this.#source.id === id && shown;
		const have = fromCopy ? this.#editor.music.bytes(shown) : {};
		const audio = copy
			? await store.copyAudio(id)
			: await this.#cloudAudio(fromServer, (audioId) => (have[audioId] ? Promise.resolve(have[audioId]) : server.audioBytes(id, audioId)));
		// 音樂跟離線副本存著的一樣：存離線副本時音樂不動
		const sameAudio =
			!!fromCopy && !copy && fromServer.audio.length === Object.keys(have).length && fromServer.audio.every((a) => a.id in have);
		const music = await this.#editor.readMusic(audio);
		// 讀完音樂才讀這台存著的：等的時候別的分頁記的也拿到
		const stored = (await store.unsent()).find((u) => u.flowId === id);
		if (!still()) return;
		// 換成最新的（同一支）：沒傳的照開著的那支現在的，等音樂時記的、改的不會丟；這台存著的（別的分頁記的）也合進來
		const old = this.#source;
		const kept = 'steps' in old && old.id === id ? old.steps.keptUnsent : null;
		const saved = kept && !isEmptyUnsent(kept) ? (stored ? mergeUnsent(kept, stored) : kept) : stored;
		const flow = saved ? withUnsent(fromServer, saved) : fromServer;
		// 被新版擋住後換成最新的（#368）：換上的那支打招呼回答前也照樣擋住
		const newVersion = this.cloud?.newVersion ?? false;
		music.upload = (audioId, file) => this.#editor.adapters.server.uploadAudio(id, audioId, file);
		this.#start(flow, 'cloud', newDraftId(), music, null, !refresh);
		const room = server.openRoom(id);
		const cloud = new CloudSteps(room, found.step, this.#editor.session, found.role, { flowId: id, store, saved }, !!first);
		if (newVersion) cloud.knownNewVersion();
		this.#source = copy ? { kind: 'offline', id, steps: cloud, savedAt: copy.savedAt } : { kind: 'cloud', id, steps: cloud };
		this.#rememberLast();
		cloud.practice.recordedBy = Object.fromEntries(
			found.records.flatMap((r) => (r.mine ? [] : [[(r.attempt as Attempt).id, r.by ?? '']]))
		);
		// 傳不上去了：這台存著的（沒傳的、離線副本）丟掉，回首頁說原因
		const goneHome = (why: (name: string) => string) => () => {
			const name = this.#editor.session.flow?.name ?? '';
			cloud.forget();
			void store.dropCopy(id);
			this.#editor.session.open(null);
			this.#revoked = joinSentences([why(name), m.file_copy_dropped()]);
		};
		const revoked = goneHome(revokedText);
		// 被收回時還有沒傳的：先擋住列出來，按「知道了」才丟掉、回首頁
		cloud.onrevoked = () => {
			const rows = cloud.unsentRows;
			if (rows.length) this.#lost = { rows, then: revoked };
			else revoked();
		};
		const deleted = goneHome(deletedText);
		// 被刪掉時還有沒傳的：一樣先擋住列出來（框寫被刪掉了）
		cloud.ondeleted = () => {
			const rows = cloud.unsentRows;
			if (rows.length) this.#lost = { rows, then: deleted, deleted: this.#editor.session.flow?.name ?? '' };
			else deleted();
		};
		// 從離線副本打開的：連上了就換成最新的
		// 換上之前再問一次還開著這支（等的時候回首頁了就不換）
		const stillOpen = () => this.cloud === cloud;
		cloud.onback = () => {
			if (this.#source.kind === 'offline' && this.cloud === cloud) void this.openCloud(id, true, stillOpen);
		};
		// 斷線連回來才知道有新版、或伺服器回答前改了（#368）：照樣換成最新的（換上的那支打招呼也被擋，但沒斷過線、沒有沒送的步，不會再換）
		cloud.onstale = async (lost) => {
			if (this.cloud !== cloud) return;
			await this.openCloud(id, true, stillOpen);
			// 換上了才說（等的時候回首頁、開了別的就不說）
			const now = this.#source;
			if (lost && 'steps' in now && now.id === id && now.steps !== cloud) this.#editor.session.notice = (lost === 1 ? m.cloud_replaced_lost_one : m.cloud_replaced_lost)({ count: lost });
		};
		await this.#keepCopy(
			copy ?? { ...copyOf(found, flow.name), savedAt: Date.now(), openedAt: 0 },
			copy || sameAudio ? undefined : audio,
			stillOpen
		);
		if (sameAudio) this.#copyAudioIds = Object.keys(audio).sort().join();
	}

	/** 離線副本存進這台（打開時、開著時換成最新的）時，存的那幾個音樂檔：換了才再存音樂。 */
	#copyAudioIds = '';
	/** 開著時換成最新的：停手 1 秒才存。 */
	#copyTimer: ReturnType<typeof setTimeout> | undefined;

	/**
	 * 存一份離線副本（這次打開：最近打開的時間換成現在），再刪掉超過 5 支的（有沒傳紀錄的不刪）。
	 * still：讀完這台的離線副本後還開著它（剛打開就被收回、被刪掉回首頁時，刪掉的那份不再存回來）。
	 */
	async #keepCopy(copy: OfflineCopy, audio: AudioBytes | undefined, still: () => boolean) {
		const store = this.#editor.adapters.offline;
		const copies = await store.copies();
		if (!still()) return;
		const openedAt = Math.max(Date.now(), ...copies.filter((c) => c.flowId !== copy.flowId).map((c) => c.openedAt + 1));
		await store.saveCopy({ ...copy, openedAt }, audio);
		if (audio) this.#copyAudioIds = Object.keys(audio).sort().join();
		const all = [...copies.filter((c) => c.flowId !== copy.flowId), { ...copy, openedAt }];
		for (const drop of copiesToDrop(all, await store.unsent())) await store.dropCopy(drop);
	}

	/** 開著的雲端流程改了（自己、別人的改動、紀錄）：停手 1 秒後把離線副本換成現在的樣子。 */
	#saveCopyLater() {
		clearTimeout(this.#copyTimer);
		if (!this.cloud) return;
		this.#copyTimer = setTimeout(() => void this.#saveCopyNow(), DRAFT_DELAY_MS);
	}

	/**
	 * 離線副本換成現在的樣子：只在連著、沒有還沒送到的步時（不然記的第幾步對不上）；這台還沒傳的紀錄不放進去（另外存）。
	 * 已經被擠掉的不再放回來。
	 */
	async #saveCopyNow() {
		const { session, adapters, music } = this.#editor;
		const source = this.#source;
		if (source.kind !== 'cloud' || !session.flow || source.steps.offline || source.steps.unsent) return;
		const { id, steps: cloud } = source;
		const old = (await adapters.offline.copies()).find((c) => c.flowId === id);
		if (!old || this.cloud !== cloud) return;
		const { flow, records } = takeRecords(session.flow);
		const unsent = new Set(cloud.unsentIds);
		const by = cloud.practice.recordedBy;
		const audioIds = flow.audio.map((a) => a.id).sort().join();
		const audio = audioIds !== this.#copyAudioIds ? music.bytes(flow) : undefined;
		await adapters.offline.saveCopy(
			{
				...old,
				name: flow.name,
				savedAt: Date.now(),
				role: cloud.role,
				step: cloud.seen,
				flow,
				records: records
					.filter((r) => !unsent.has(r.attempt.id))
					.map((r) => ({ ...r, by: by[r.attempt.id] || null, mine: !(r.attempt.id in by) }))
			},
			audio
		);
		if (audio) this.#copyAudioIds = audioIds;
	}

	/**
	 * 用分享連結打開（網址 #share=…）：已經登入、有權限的人照自己的權限打開（跟從首頁點的一樣）；
	 * 沒有權限的只拿到編排（沒有紀錄），只能看：不連房間、沒有草稿。連結關了、換了，首頁說打不開。
	 */
	async openLink(token: string) {
		const server = this.#editor.adapters.server;
		let found;
		try {
			found = await server.linkedFlow(token);
		} catch {
			this.#openError = m.file_link_unreachable();
			return;
		}
		if (!found) {
			this.#openError = m.file_link_dead();
			return;
		}
		if (found.role) return this.openCloud(found.id);
		const flow = found.flow as Flow;
		const music = await this.#editor.readMusic(await this.#cloudAudio(flow, (audioId) => server.linkAudioBytes(token, audioId)));
		this.#start(flow, 'cloud', newDraftId(), music);
		this.#source = { kind: 'link', id: found.id };
		this.#rememberLast();
		this.#editor.session.readOnly = m.cloud_only_view();
	}

	/**
	 * 被收回、流程被刪了時還沒傳的（#260）：擋住畫面的框列出來；按「知道了」（lostKnown）才丟掉、回首頁。沒有是 null。
	 * deleted：流程被擁有者刪了（那支的名字，框寫被刪掉了）；被收回是 undefined。
	 */
	#lost = $state.raw<{ rows: DroppedRecord[]; then: () => void; deleted?: string } | null>(null);
	get lost(): { rows: DroppedRecord[]; deleted?: string } | null {
		const lost = this.#lost;
		return lost && { rows: lost.rows, deleted: lost.deleted };
	}
	/** 被收回的框按「知道了」：沒傳的丟掉，回首頁。 */
	lostKnown() {
		const then = this.#lost?.then;
		this.#lost = null;
		then?.();
	}

	/**
	 * 首頁連上網路、拿到雲端流程的清單（cloudIds：我還打得開的）：不在裡面的（被收回、被刪掉）離線副本刪掉（#261），
	 * 首頁最上面黃的那條說哪幾支（deletedIds 裡的是被擁有者刪掉的，寫被刪掉了）。
	 * 還有紀錄沒傳的照 #260 先擋住列出來，按「知道了」才刪（一支一支來）。
	 */
	async dropGoneCopies(cloudIds: string[], deletedIds: string[] = []) {
		const store = this.#editor.adapters.offline;
		const open = new Set(cloudIds);
		const gone = (await store.copies()).filter((c) => !open.has(c.flowId));
		if (!gone.length) return;
		const unsent = await store.unsent();
		const names: string[] = [];
		const queue: { rows: DroppedRecord[]; then: () => void }[] = [];
		const next = () => {
			const lost = queue.shift();
			if (lost) this.#lost = lost;
		};
		const deleted = new Set(deletedIds);
		const tell = (name: string, flowId: string) => {
			names.push(deleted.has(flowId) ? deletedText(name) : revokedText(name));
			this.#revoked = joinSentences([...names, m.file_copy_dropped()]);
		};
		for (const c of gone) {
			const u = unsent.find((x) => x.flowId === c.flowId);
			if (u && unsentCount(u) > 0) {
				queue.push({
					rows: u.records.map((r) => r.row),
					then: () => {
						void store.saveUnsent({ ...u, records: [], amends: [], dropped: [] });
						void store.dropCopy(c.flowId);
						tell(c.name, c.flowId);
						next();
					},
					...(deleted.has(c.flowId) && { deleted: c.name })
				});
			} else {
				await store.dropCopy(c.flowId);
				tell(c.name, c.flowId);
			}
		}
		next();
	}

	/** 被收回、被刪掉回首頁時，首頁最上面黃的那條（「你已經不能打開「…」。」）；沒有是空字串。 */
	#revoked = $state('');
	get revoked(): string {
		return this.#revoked;
	}
	/** 黃條右邊的 ×。 */
	dismissRevoked() {
		this.#revoked = '';
	}

	/** 分享對話框的「離開這支流程」（確認過了）：伺服器拿掉我的權限，回首頁。連不上伺服器丟錯。 */
	async leaveCloud() {
		const id = this.cloudId;
		const cloud = this.cloud;
		if (!id || !cloud) return;
		// 自己離開的：房間說「被收回」時直接回首頁，不寫「你已經不能打開」
		const revoked = cloud.onrevoked;
		cloud.onrevoked = () => this.#editor.session.open(null);
		// 自己離開的：這台的離線副本先刪（#261），回首頁時才不當作被收回寫黃條；沒離開成，下次打開會再留一份
		await this.#editor.adapters.offline.dropCopy(id);
		try {
			await this.#editor.adapters.server.leave(id);
		} catch (e) {
			cloud.onrevoked = revoked;
			throw e;
		}
		if (this.cloudId === id) this.#editor.session.open(null);
	}

	/** 分享對話框的「刪掉這支流程」（擁有者，確認過了，#252）：伺服器刪掉，回首頁。連不上伺服器丟錯。 */
	async deleteCloud() {
		const id = this.cloudId;
		const cloud = this.cloud;
		if (!id || !cloud) return;
		// 自己刪的：房間說「被刪掉了」時直接回首頁，不寫黃條
		const deleted = cloud.ondeleted;
		cloud.ondeleted = () => this.#editor.session.open(null);
		// 自己刪的：這台的離線副本先刪（#261），理由同上
		await this.#editor.adapters.offline.dropCopy(id);
		try {
			await this.#editor.adapters.server.deleteFlow(id);
		} catch (e) {
			cloud.ondeleted = deleted;
			throw e;
		}
		if (this.cloudId === id) this.#editor.session.open(null);
	}

	/**
	 * 本機流程「☁ 傳上雲端」（#259，登入時）：搬過去。有音樂檔超過 60 MB 先擋（跳框，tooBig）；
	 * 送流程（帶紀錄），伺服器檢查整支流程、建一支新的雲端流程，再把音樂檔一個一個傳上去。
	 * 傳好打開雲端那支、丟掉這台的草稿（資料夾裡的流程檔不動）。音樂沒傳上去就把建好的那支刪掉，還是本機流程。
	 * 傳的時候又改了、換了流程：雲端那支留著，開著的不換、草稿不丟，說一聲（UPLOAD_CHANGED）。
	 */
	async upload() {
		const { session, adapters, music } = this.#editor;
		if (!session.flow || this.#source.kind !== 'local' || this.#uploading) return;
		adapters.pendingInput.flush();
		const flow = session.flow;
		const draftId = this.#draftId;
		const audio = music.bytes(flow);
		const big = flow.audio.find((a) => (audio[a.id]?.length ?? 0) > MAX_CLOUD_AUDIO_BYTES);
		if (big) return void (this.#tooBig = tooBig(flow, big.id, audio[big.id].length));
		const server = adapters.server;
		this.#uploading = true;
		session.notice = m.file_uploading();
		let id: string | null = null;
		try {
			const made = await server.uploadFlow({ formatVersion: FORMAT_VERSION, flow });
			if ('message' in made) return void (session.notice = m.file_upload_refused({ reason: reasonText(made) }));
			id = made.id;
			for (const ref of flow.audio) {
				if (!audio[ref.id]) continue;
				const file = new File([audio[ref.id] as Uint8Array<ArrayBuffer>], ref.file);
				if ((await server.uploadAudio(id, ref.id, file)) === 'tooBig') {
					session.notice = '';
					this.#tooBig = tooBig(flow, ref.id, file.size);
					return void server.deleteFlow(id).catch(() => {});
				}
			}
		} catch {
			session.notice = m.file_upload_unreachable();
			if (id) void server.deleteFlow(id).catch(() => {});
			return;
		} finally {
			this.#uploading = false;
		}
		// 打開雲端那支要等：那時候在欄位裡打的字也算改了（先送出；輸入法還在選字送不出去，也算改了）
		const unchanged = () => {
			adapters.pendingInput.flush();
			return !adapters.pendingInput.pending && this.#editor.session.flow === flow && this.#draftId === draftId;
		};
		if (!unchanged()) return void (session.notice = m.file_upload_changed());
		await this.openCloud(id, false, unchanged);
		if (this.cloudId !== id) {
			session.notice = unchanged() ? m.file_uploaded_not_opened() : m.file_upload_changed();
			return;
		}
		this.#clearDraft(draftId);
		session.notice = m.file_uploaded();
	}

	/** 傳上雲端時太大的音樂檔（跳框）；沒有是 null。 */
	get tooBig(): AudioTooBig | null {
		return this.#tooBig;
	}
	/** 太大的框按「知道了」。 */
	dismissTooBig() {
		this.#tooBig = null;
	}

	/**
	 * 雲端流程「⤓ 下載」（#259，擁有者、編輯者）：跟伺服器拿流程和紀錄，加上手上的音樂，包成流程檔存下來（每次一個新檔）。
	 * 手上沒有的音樂檔（別人換的）跟雲端拿；雲端上沒有的不放，拿不到（連不上）就不存。
	 * 帶紀錄、不帶記的人；擁有者、權限、分享連結本來就不在流程裡。下載的那份跟雲端流程不再有關係。
	 */
	async download() {
		const { session, adapters, music } = this.#editor;
		const id = this.cloudId;
		// 下載只有雲端流程有，權限決定，跟登入沒關係（signedIn 只影響本機流程的傳上雲端、「這台」）
		const signedIn = true;
		if (!id || !this.can(signedIn).download.ok || !session.flow) return;
		const fileName = flowFileName(session.flow.name);
		let found;
		try {
			found = await adapters.server.cloudFlow(id);
		} catch {
			found = null;
		}
		if (!found) return void (session.notice = m.file_download_unreachable());
		const records = found.records.map((r) => ({ actionId: r.actionId, attempt: r.attempt as Attempt }));
		const flow = putRecords(found.flow as Flow, records);
		const audio = { ...music.bytes(flow) };
		try {
			for (const a of flow.audio) {
				if (audio[a.id]) continue;
				const bytes = await adapters.server.audioBytes(id, a.id);
				if (bytes) audio[a.id] = bytes;
			}
		} catch {
			return void (session.notice = m.file_download_unreachable());
		}
		try {
			const outcome = await adapters.download(writeFlowFile(flow, audio), fileName);
			if (outcome !== 'cancelled') session.notice = savedText(outcome, fileName, false, false, false);
		} catch {
			session.notice = m.file_download_failed();
		}
	}

	/** 雲端流程用到的音樂檔，從雲端拿下來（#249；get 拿一個）。雲端上沒有、拿不到的不放：那段標「找不到音樂」。 */
	async #cloudAudio(flow: Flow, get: (audioId: string) => Promise<Uint8Array | null>): Promise<AudioBytes> {
		const audio: AudioBytes = {};
		await Promise.all(
			flow.audio.map(async (a) => {
				const bytes = await get(a.id).catch(() => null);
				if (bytes) audio[a.id] = bytes;
			})
		);
		return audio;
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
		if (this.#openApproved || !this.#editor.session.unsavedOrAsking) return true;
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
	 * 窄螢幕上方列的「回首頁」：有還沒存的修改就跟「新建」一樣先問。
	 * 沒有就直接回去；這個分頁的流程（剛建好）留在草稿裡，列在首頁的最近的流程。
	 */
	async leaveToHome() {
		const { session, music } = this.#editor;
		if (session.unsavedOrAsking) return this.startNew();
		const f = session.flow;
		const bytes = f && this.ownsDraft ? writeFlowFile(f, music.bytes(f)) : null;
		session.open(null);
		if (bytes) await this.#saveDraft(bytes);
	}

	/**
	 * 換成另一支流程（新建、開檔、救回草稿）。選取、提示由 session 清掉。
	 * draftId：這支流程的草稿 id。music：這支流程的音樂檔庫（開檔、救回草稿時解碼好的；沒給是空的）。
	 */
	#start(
		flow: Flow,
		from: 'file' | 'draft' | 'new' | 'cloud',
		draftId: string,
		music?: MusicLibrary,
		saver: FileSaver | null = null,
		switching = true
	) {
		const editor = this.#editor;
		// 剛建好的不算未存（沒改過就換別的不用問），但不在檔案裡，照樣存草稿
		// 草稿 id 先換：session 換流程時就跟別的分頁說正在編的是這支
		this.#draftId = draftId;
		// 先收掉上一支的雲端：session 換上、通知頁面（onswap）時，頁面看到的不是上一支的雲端
		this.#closeCloud();
		// 從離線副本換成最新的（同一支流程，switching = false）：頁面不重開練習畫面、對話框
		editor.session.open(flow, from !== 'draft', switching);
		editor.actionDraft.restart();
		this.#onDisk = from === 'file';
		this.#fileBytes = null;
		editor.adapters.pendingInput.settle();
		this.#saver = saver;
		editor.switchMusic(music);
		this.#openError = '';
		this.#revoked = '';
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
	 * 還有問題等教練回答（例：改名後還沒選保留或清掉）時先存檔不存也不換：存了也沒有那個修改，換掉就不見了；收掉這個問題，提示先回答。
	 */
	async answer(choice: 'save' | 'discard' | 'cancel') {
		const then = this.#asking?.then;
		if (!then) return;
		if (choice === 'cancel') {
			this.#asking = null;
			return;
		}
		if (choice === 'save') {
			if (this.#editor.session.questionOpen) {
				this.#asking = null;
				this.#editor.session.notice = m.file_unanswered();
				return;
			}
			await this.save();
			if (this.#editor.session.unsaved || !this.#asking) return;
		}
		this.#asking = null;
		then();
	}

	/** 開檔時那個檔有改過沒存的草稿：問教練的那支流程（名字、草稿什麼時候存的）。沒在問是 null。 */
	get draftAsk(): DraftAsk | null {
		const ask = this.#draftAsk;
		return ask && { name: ask.name, savedAt: ask.savedAt };
	}

	/** 回答「有改過沒存的草稿」：draft＝救回修改（開草稿）；file＝用檔案（草稿換成檔案，修改丟掉）；cancel＝都不開。 */
	answerDraft(choice: DraftChoice) {
		this.#draftAsk?.resolve(choice);
	}

	/** 會換掉現在的流程（open：開檔；不然是新建、回首頁）：有還沒存的修改、又還沒答應過（approved）就先問，確定才做。 */
	#unlessUnsaved(open: boolean, approved: boolean, then: () => void) {
		// 換掉的流程是這個分頁放在草稿裡的：它的草稿跟著丟掉（「不存了，繼續」、剛建好沒改就新建），重新整理不會又問要不要救回。
		// 只丟這支流程的，別支流程的草稿不動。
		const go = () => {
			if (this.ownsDraft) void this.#dropDraft(this.#draftId);
			then();
		};
		if (this.#editor.session.unsavedOrAsking && !approved) this.#asking = { then: go, open };
		else go();
	}

	// ---------- 草稿 ----------

	/** 首頁列的最近的流程：有草稿的那幾支，最近的在前。 */
	get recent(): RecentFlow[] {
		return this.#recent;
	}

	/** 改過沒存的草稿超過 5 支時，是幾支（首頁提醒教練自己丟）；沒超過是 0。 */
	get unsavedOverLimit(): number {
		const n = this.#recent.filter((f) => f.unsaved).length;
		return n > MAX_DRAFTS ? n : 0;
	}

	/**
	 * 打開最近的流程裡的一支：有沒存的修改的，跟救回草稿一樣（還算未存，不在檔案裡）；沒改過的，跟開那個檔一樣。
	 * 另一個分頁正在編它就不開，首頁說原因。
	 */
	async openRecent(id: string) {
		if (!(await this.#openDraft(id))) this.#openError = m.file_draft_unreadable();
	}

	/** 打開一份草稿（openRecent 那樣）；草稿沒了、打不開回 false。 */
	async #openDraft(id: string): Promise<boolean> {
		let draft = null;
		try {
			draft = await this.#editor.adapters.draftStore.load(id);
		} catch {
			// 讀不到就當作沒有
		}
		const r = draft && readFlowFile(draft.bytes);
		if (!draft || !r || r.kind !== 'ok') return false;
		const unchanged = fileDraftId(draft.bytes) === id;
		await this.#openBytes(draft.bytes, unchanged ? flowFileName(r.flow.name) : null, null, id);
		return true;
	}

	/**
	 * 記下上次那支（#378）：開著本機流程、雲端流程（含離線副本，#383）就是它，在首頁、分享連結（沒有權限）就清掉。
	 * 打開、離開流程時就記（不只切到背景）：殼每次重新載入（在首頁換上新網頁 #393、退回舊網頁）都照這個開，要跟教練在哪一樣。
	 */
	#rememberLast() {
		if (host().shell.can(SETTINGS_FEATURE)) saveLastFlow(this.#lastFlow());
	}

	/** 離開 App 時要記的上次那支：本機流程是草稿 id，雲端流程（含離線副本）是 CLOUD_LAST 加流程 id，在首頁、分享連結是空的。 */
	#lastFlow(): string {
		if (!this.#editor.session.flow) return '';
		const source = this.#source;
		if (source.kind === 'local') return this.#draftId;
		return source.kind === 'link' ? '' : CLOUD_LAST + source.id;
	}

	/**
	 * App 打開時回上次那支雲端流程（#383）：這台有離線副本就先開它（只能看、能記），房間連上了自動換成最新的；
	 * 被收回、被刪掉照房間說的回首頁。沒有離線副本就照現在等伺服器（等的時候先畫首頁，不藏著）。
	 */
	async #reopenCloud(id: string) {
		const copy = (await this.#editor.adapters.offline.copies()).find((c) => c.flowId === id);
		if (copy) return this.openCloud(id, false, () => true, copy);
		this.#reopening = false;
		await this.openCloud(id);
	}

	/**
	 * 打開殼收著的流程檔（從「檔案」、分享選單交給 App 的，#384）：照開檔的規則（拆兩層、錯誤訊息、有沒存的修改先問）。
	 * 殼不會、沒有檔回 false。拿到了就不再藏著首頁：開檔可能要先問（有沒存的修改、那個檔有改過的草稿），問的框要看得到。
	 */
	async #openHandedFile(): Promise<boolean> {
		if (!host().shell.can(OPEN_FILE_FEATURE)) return false;
		const file = await takeOpenedFile(host().shell);
		if (!file) return false;
		this.#reopening = false;
		await this.open(file);
		return true;
	}

	/** App 打開時正在回上次那支（還沒開好、還沒確定不見了）。 */
	get reopening(): boolean {
		return this.#reopening;
	}

	/**
	 * 丟掉最近的流程裡的一支（頁面先問過教練了）：先問別的分頁有沒有在編它，有就不丟，標成正在編。
	 * 回傳丟掉了沒（頁面照這個說「已丟掉」或為什麼沒丟）：dropped 丟掉了；busy 另一個分頁正在編；failed 瀏覽器刪不掉。
	 */
	async discardRecent(id: string): Promise<'dropped' | 'busy' | 'failed'> {
		if (await this.#otherTabEditing(id)) {
			this.#recent = this.#recent.map((f) => (f.id === id ? { ...f, busy: true } : f));
			return 'busy';
		}
		try {
			await this.#editor.adapters.draftStore.clear(id);
		} catch {
			return 'failed';
		}
		this.#draftsChanged();
		return 'dropped';
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

	/**
	 * 打開時讀草稿，列成最近的流程；App 裡記著上次那支就直接開它（#378），不先讀每份草稿列最近的流程（要 1 秒內看到場地）。
	 * 那支不見了（草稿沒了、打不開）就停在首頁，不說錯。讀完了才開始自動存。
	 */
	async #checkDraft(reopen: string | null) {
		const last = this.#reopening ? loadLastFlow() : '';
		if (reopen) await this.openCloud(reopen);
		// 點流程檔打開 App（#384）：開那個檔，不開上次那支。殼不會就不多等一下（網頁版照舊）
		else if (host().shell.can(OPEN_FILE_FEATURE) && (await this.#openHandedFile())) {
			// 開了交來的檔
		}
		else if (last.startsWith(CLOUD_LAST)) await this.#reopenCloud(last.slice(CLOUD_LAST.length));
		else if (last) await this.#openDraft(last);
		if (!this.#editor.session.flow) await this.#readRecent();
		this.#reopening = false;
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
	 * 現在存草稿（停手 1 秒到了、分頁藏起來了）：只存已經送出的流程。欄位裡打到一半的字不送出（N01）：
	 * 自動存不是教練說「好了」，送出會改流程、多一步復原、還可能跳確認框（Apple NSDocument 自動存也不送出）。
	 */
	#saveDraftNow() {
		const { session, music } = this.#editor;
		clearTimeout(this.#draftTimer);
		this.#draftTimer = undefined;
		const f = session.flow;
		if (!f || this.#source.kind !== 'local') return;
		if (this.ownsDraft) void this.#saveDraft(writeFlowFile(f, music.bytes(f)));
		else if (this.#fileBytes) void this.#saveDraft(this.#fileBytes);
	}

	/** 跟別的分頁說現在正在編哪支流程：跟上次說的不一樣，先說上一支「不編了」。 */
	#announce() {
		const id = this.#editor.session.flow ? this.#draftId : null;
		if (id === this.#announced) return;
		if (this.#announced) this.#channel?.post({ kind: 'released', id: this.#announced });
		if (id) this.#channel?.post({ kind: 'editing', id });
		this.#announced = id;
	}

	/** 分頁要關了（pagehide、頁面拆掉）：跟別的分頁說這支流程不編了，首頁不用等重新整理就點得開。 */
	pageClosed() {
		if (this.#announced) this.#channel?.post({ kind: 'released', id: this.#announced });
		this.#announced = null;
	}

	/** 分頁從上一頁快取回來（pageshow persisted）：又在編這支流程，再跟別的分頁說一聲。 */
	pageShown() {
		this.#announce();
	}

	/**
	 * 分頁藏起來了、要關了（pagehide、visibilitychange 變 hidden）：還沒進草稿的改動現在就存，不等停手 1 秒
	 * （iPad 收掉分頁不會問 beforeunload）。欄位裡打到一半的字跟停手 1 秒一樣不送出（N01）。
	 */
	pageHidden() {
		if (!this.#editor.session.flow) return;
		if (this.#draftTimer !== undefined) this.#saveDraftNow();
	}

	/**
	 * 存這支流程的草稿。存不了（例：私密視窗）就算了，草稿只是保險。
	 * 這份草稿第一次存：草稿超過 5 支流程的，丟跟檔案一樣（沒改過）的、舊的先丟；改過沒存的不丟（首頁提醒，教練自己丟）。
	 */
	async #saveDraft(bytes: Uint8Array): Promise<void> {
		const id = this.#draftId;
		const store = this.#editor.adapters.draftStore;
		try {
			await store.save(id, bytes);
			this.#draftsChanged();
			if (this.#countedDraftId === id) return;
			this.#countedDraftId = id;
			const oldestFirst = newestFirst((await store.list()).filter((d) => d.id !== id)).reverse();
			const extra = oldestFirst.length - (MAX_DRAFTS - 1);
			if (extra <= 0) return;
			const loaded = await Promise.all(oldestFirst.map((d) => store.load(d.id)));
			// 讀不出來的也算沒改過（反正打不開）
			const unchanged = oldestFirst.filter((d, i) => !loaded[i] || fileDraftId(loaded[i].bytes) === d.id);
			for (const old of unchanged.slice(0, extra)) void this.#dropDraft(old.id);
		} catch {
			// 草稿只是保險
		}
	}

	/** 這支流程（草稿 id）有改過沒存的草稿（跟檔案不一樣、打得開）就給它，沒有是 null。讀不到就當作沒有。 */
	async #changedDraft(id: string) {
		try {
			const d = await this.#editor.adapters.draftStore.load(id);
			if (d && fileDraftId(d.bytes) !== id && readFlowFile(d.bytes).kind === 'ok') return d;
		} catch {
			// 草稿只是保險
		}
		return null;
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

	/** 這個分頁的流程要不要放在草稿裡：開著本機流程，有未存的修改或不在檔案裡。雲端流程沒有草稿。 */
	get ownsDraft(): boolean {
		const { session } = this.#editor;
		return !!session.flow && this.#source.kind === 'local' && (session.unsaved || !this.#onDisk);
	}
}

/** 開檔時那個檔有改過沒存的草稿：問的是哪支流程。 */
export interface DraftAsk {
	name: string;
	/** 草稿什麼時候存的；舊版編輯器存的是 null。 */
	savedAt: Date | null;
}

/** 傳上雲端時太大的音樂檔：哪一段（例：「音樂 1」）、幾 MB（無條件進位）。 */
export interface AudioTooBig {
	segment: string;
	mb: number;
}

function tooBig(flow: Flow, audioId: string, bytes: number): AudioTooBig {
	const span = segmentSpans(flow).find(({ segment: s }) => s.kind === 'music' && s.audioId === audioId);
	const name = (span && whyText(labelWhy(span))) ?? flow.audio.find((a) => a.id === audioId)?.name ?? '';
	return { segment: name, mb: Math.ceil(bytes / 1024 / 1024) };
}

/** 回答「有改過沒存的草稿」：救回修改、用檔案（丟掉修改）、取消。 */
export type DraftChoice = 'draft' | 'file' | 'cancel';

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

/**
 * 存好了的提示，寫出檔名。下載新檔（Safari、Firefox）第一次存時多說一句：從檔案開的，說原本的檔沒改，
 * 在電腦上叫教練改用 Chrome、Edge 才能存回原檔；新的流程本來就沒有原檔，只說每次存都下載一個新檔。
 */
function savedText(outcome: SaveOutcome, name: string, first: boolean, hadFile: boolean, touch: boolean): string {
	if (outcome === 'saved') return m.file_saved_to({ name });
	if (outcome === 'shared') return m.file_shared({ name });
	if (!first) return (hadFile ? m.file_downloaded_new : m.file_downloaded)({ name });
	if (!hadFile) return m.file_downloaded_first({ name });
	return touch ? m.file_downloaded_touch({ name }) : m.file_downloaded_desktop({ name });
}

/** 開檔時缺音樂檔的提示：寫出流程檔（或草稿）的名字和缺的音樂檔。 */
/** 開檔時拿掉的書籤（放不下的，手改過的檔才會有）。 */
function droppedBookmarksText(names: string[]): string {
	const quoted = names.map((n) => m.file_quoted({ name: n })).reduceRight((rest, first) => m.file_quoted_list({ first, rest }));
	return (names.length === 1 ? m.file_dropped_bookmarks_one : m.file_dropped_bookmarks)({ names: quoted });
}

function missingAudioText(name: string, files: string[]): string {
	const quoted = files.map((f) => m.file_quoted({ name: f })).reduceRight((rest, first) => m.file_quoted_list({ first, rest }));
	return (files.length === 1 ? m.file_opened_missing_audio_one : m.file_opened_missing_audio)({ name, files: quoted });
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

/** 草稿存的時間寫成「11/5 14:03」；seconds 是寫到秒（「11/5 14:03:27」）。 */
export function draftTime(d: Date, seconds = false): string {
	const two = (n: number) => String(n).padStart(2, '0');
	return `${d.getMonth() + 1}/${d.getDate()} ${two(d.getHours())}:${two(d.getMinutes())}${seconds ? `:${two(d.getSeconds())}` : ''}`;
}
