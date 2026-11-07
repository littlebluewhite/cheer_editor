// 流程檔：編輯器 module 握著（getEditor().file）。開檔、存檔、新建、回首頁、草稿、「沒存先問」都在這裡，頁面只照它的狀態畫對話框和提示。
// 管：這支流程在不在檔案裡、正在存、「還沒存」的問題、開檔錯誤、缺音樂的提示、
// 一支流程一個存檔薄層（記得存到哪個檔，換流程就丟掉）、草稿（每支流程一份，只留最近編過的 5 支；停手 1 秒自動存，
// 從檔案開的、存好的沒改過也留一份；首頁列成「最近的流程」；另一個分頁正在編的流程不能打開，清掉草稿前先問別的分頁；
// 開檔時那個檔有改過沒存的草稿，先問要救回修改還是用檔案）。
// 雲端流程（新建時選存在雲端、首頁「我的流程」點的）也從這裡打開：它沒有草稿，不列在最近的流程（#247），
// 每一步送伺服器存（cloud，#248），沒有存檔。
// 用分享連結打開的（#251）：已經有權限的照自己的權限打開；沒有的只能看（linkOnly）：不連房間、沒有草稿、沒有練習頁。
// 雲端流程這台還沒傳的成功率紀錄（#260）：打開時從離線存放拿出來放回流程、接著傳；被收回時還有沒傳的，先擋住列出來（lost），
// 按「知道了」才丟掉、回首頁。

import {
	audioExtension,
	FORMAT_VERSION,
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
import { CloudSteps, ONLY_VIEW, withUnsent } from '#lib/cloud-steps.svelte.js';
import type { DroppedRecord } from '#lib/editor-session.svelte.js';
import type { DraftInfo } from '#lib/file/draft.js';
import { flowFileName, type FileSaver, type PickedFile, type SaveOutcome } from '#lib/file/save.js';
import type { Editor } from '#lib/editor.svelte.js';
import { MAX_CLOUD_AUDIO_BYTES, type MusicLibrary } from '#lib/music-library.svelte.js';
import { copiesToDrop, unsentCount, type OfflineCopy } from '#lib/offline-store.js';
import { canEdit } from '#lib/role-names.js';
import type { CloudFlow } from '#lib/server-api.js';
import type { TabChannel } from '#lib/tab-channel.js';

/** 傳上雲端傳好的提示。 */
export const UPLOADED = '傳上雲端了：現在開的是雲端那支，可以分享了。這台的草稿丟掉了，資料夾裡的流程檔沒動。';
const UPLOAD_UNREACHABLE = '連不上伺服器，沒傳上雲端';
/** 被收回、被刪掉回首頁時，黃條後面加的（離線副本一起刪了，#261）。 */
const COPY_DROPPED = '這台留著的那份也刪掉了。';

/** 伺服器拿到的雲端流程存成離線副本的樣子（時間之後填）。 */
function copyOf(found: CloudFlow, name: string): Omit<OfflineCopy, 'savedAt' | 'openedAt'> {
	return { flowId: found.id, name, role: found.role, step: found.step, flow: found.flow, records: found.records };
}

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
	/** 開著的是雲端流程：它在伺服器上的 id；本機流程、在首頁是 null。 */
	#cloudId = $state<string | null>(null);
	/** 開著的雲端流程一步一步送伺服器存；本機流程、在首頁是 null。 */
	#cloud = $state.raw<CloudSteps | null>(null);
	/** 開著的雲端流程是用分享連結看的（沒有權限）：只能看，重新整理才看到新的。 */
	#linkOnly = $state(false);
	/** 正在傳上雲端：傳好之前再按不算。 */
	#uploading = false;
	/** 傳上雲端時有音樂檔太大：跳框寫是哪一段、幾 MB（按「知道了」清掉）。 */
	#tooBig = $state.raw<AudioTooBig | null>(null);

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
			this.#saveCopyLater();
			this.#dropMissingNotice();
			if (!editor.session.flow) {
				this.#closeCloud();
				void this.#readRecent();
			}
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
		// 雲端流程每一步都存了，沒有存檔（要流程檔用 download）
		if (!session.flow || this.#saving || this.#cloudId) return;
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
			this.#saveDraftLater();
			session.notice = [
				savedText(outcome, this.#saver.fileName ?? fileName, first, hadFile, !!this.#saver.touch),
				missing ? `有 ${missing} 段找不到音樂，存出來的檔裡沒有這些音樂：點紅色的段重新選檔，再存一次` : ''
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
	async #openBytes(bytes: Uint8Array, fileName: string | null, saver: FileSaver | null = null, draftId = fileDraftId(bytes)): Promise<void> {
		const session = this.#editor.session;
		const r = readFlowFile(bytes);
		const cannotOpen = (reason: string) => {
			const message = `打不開「${fileName ?? (r.kind === 'ok' ? r.flow.name : '草稿')}」：${reason}`;
			if (session.flow) session.notice = message;
			else this.#openError = message;
		};
		if (r.kind === 'error') {
			if (!fileName || !audioExtension(fileName)) return cannotOpen(r.message);
			// 拿音樂檔來開：說音樂要去段設定載入（首頁還沒有段，先建流程）
			const where = session.flow ? '音樂要點段列上的段' : '先建好流程，再點段列上的段';
			return cannotOpen(`這是音樂檔，不是流程檔。${where}，在段設定按「載入音樂檔」`);
		}
		if (await this.#otherTabEditing(draftId)) return cannotOpen('另一個分頁正在編這支流程');
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
			// 開好了寫檔名（草稿救回來的不是檔，不寫）；缺音樂的提示本來就有檔名
			session.notice = r.missingSegmentIds.length
				? `「${fileName ?? '草稿'}」裡少了音樂檔${missingAudioNames(r.flow, r.missingSegmentIds).map((n) => `「${n}」`).join('')}：點紅色的段重新選檔`
				: [fileName !== null ? `已開啟「${fileName}」` : '', music.hasBroken ? '有音樂檔這個瀏覽器讀不出來，播放時會沒有聲音' : '']
						.filter(Boolean)
						.join('；');
			if (r.missingSegmentIds.length) this.#noteMissing();
		});
	}

	/** 新建流程表單建好了：換上它。剛建好的當下就存一次草稿，不等停手 1 秒：手機上建好不能編，按「回首頁」也不會丟。 */
	create(flow: Flow) {
		this.#start(flow, 'new', newDraftId());
		if (this.#draftChecked) this.#saveDraft(writeFlowFile(flow, {}));
	}

	/** 開著的雲端流程在伺服器上的 id；開著本機流程、在首頁是 null。 */
	get cloudId(): string | null {
		return this.#cloudId;
	}

	/** 開著的雲端流程的一步一步存（名字旁「存中…」「✓ 已存」、有新版）；本機流程、在首頁是 null。 */
	get cloud(): CloudSteps | null {
		return this.#cloud;
	}

	/** 開著的雲端流程是用分享連結看的（沒有權限）：只能看、沒有練習頁、分享。 */
	get linkOnly(): boolean {
		return this.#linkOnly;
	}

	#closeCloud() {
		this.#cloud?.close();
		this.#cloud = null;
		this.#cloudId = null;
		this.#offlineAt = null;
		clearTimeout(this.#copyTimer);
		if (this.#linkOnly) this.#editor.session.readOnly = '';
		this.#linkOnly = false;
	}

	/** 新建表單選了存在雲端：伺服器照表單的名字、場地建一支，再打開它（沒有草稿）。 */
	async createCloud(flow: Flow) {
		let made;
		try {
			made = await this.#editor.adapters.server.createFlow({ name: flow.name, field: flow.field });
		} catch {
			this.#openError = '連不上伺服器，沒存到雲端：再試一次，或選存在這台';
			return;
		}
		await this.openCloud(made.id);
	}

	/**
	 * 打開一支雲端流程：從伺服器拿編排，連它的房間，每一步送伺服器存；沒有草稿。
	 * 打開了就在這台留一份離線副本（#261，含音樂），只留最近打開的 5 支。連不上伺服器、這台有離線副本：打開那份
	 * （斷線的樣子：只能看、能記），連上了就換成最新的（refresh：換的時候不關練習畫面、對話框）。
	 */
	async openCloud(id: string, refresh = false) {
		const { server, offline: store } = this.#editor.adapters;
		let found: CloudFlow | null;
		let copy: OfflineCopy | null = null;
		try {
			found = await server.cloudFlow(id);
		} catch {
			copy = (await store.copies()).find((c) => c.flowId === id) ?? null;
			if (!copy) {
				if (!refresh) this.#openError = '連不上伺服器，打不開雲端的流程';
				return;
			}
			found = { id, flow: copy.flow, step: copy.step, updatedAt: '', role: copy.role, records: copy.records };
		}
		if (!found) {
			this.#openError = '這支流程打不開了';
			return;
		}
		// 紀錄跟編排分開存（ADR 0008）：放回流程；別人記的記下名字（記號後面寫）。這台還沒傳的也放回去（#260）。
		const records = found.records.map((r) => ({ actionId: r.actionId, attempt: r.attempt as Attempt }));
		const saved = (await store.unsent()).find((u) => u.flowId === id);
		const fromServer = putRecords(found.flow as Flow, records);
		const flow = saved ? withUnsent(fromServer, saved) : fromServer;
		const audio = copy ? await store.copyAudio(id) : await this.#cloudAudio(flow, (audioId) => server.audioBytes(id, audioId));
		const music = await this.#editor.readMusic(audio);
		music.upload = (audioId, file) => this.#editor.adapters.server.uploadAudio(id, audioId, file);
		this.#start(flow, 'cloud', newDraftId(), music, null, !refresh);
		this.#cloudId = id;
		this.#offlineAt = copy?.savedAt ?? null;
		this.#editor.session.recordedBy = Object.fromEntries(
			found.records.flatMap((r) => (r.mine ? [] : [[(r.attempt as Attempt).id, r.by ?? '']]))
		);
		const room = server.openRoom(id);
		const cloud = new CloudSteps(room, found.step, this.#editor.session, found.role, { flowId: id, store, saved });
		// 傳不上去了：這台存著的（沒傳的、離線副本）丟掉，回首頁說原因
		const goneHome = (why: (name: string) => string) => () => {
			const name = this.#editor.session.flow?.name ?? '';
			cloud.forget();
			void store.dropCopy(id);
			this.#editor.session.open(null);
			this.#revoked = `${why(name)}${COPY_DROPPED}`;
		};
		const revoked = goneHome((name) => `你已經不能打開「${name}」。`);
		// 被收回時還有沒傳的：先擋住列出來，按「知道了」才丟掉、回首頁
		cloud.onrevoked = () => {
			const rows = cloud.unsentRows;
			if (rows.length) this.#lost = { rows, then: revoked };
			else revoked();
		};
		cloud.ondeleted = goneHome((name) => `「${name}」被擁有者刪掉了。`);
		// 從離線副本打開的：連上了就換成最新的
		cloud.onback = () => {
			if (this.#offlineAt !== null && this.#cloud === cloud) void this.openCloud(id, true);
		};
		this.#cloud = cloud;
		await this.#keepCopy(copy ?? { ...copyOf(found, flow.name), savedAt: Date.now(), openedAt: 0 }, copy ? undefined : audio);
	}

	/** 開著的是從離線副本打開的（斷網）：那份是什麼時候的樣子（毫秒）；不是是 null。 */
	#offlineAt = $state<number | null>(null);
	get offlineAt(): number | null {
		return this.#offlineAt;
	}

	/** 離線副本存進這台（打開時、開著時換成最新的）時，存的那幾個音樂檔：換了才再存音樂。 */
	#copyAudioIds = '';
	/** 開著時換成最新的：停手 1 秒才存。 */
	#copyTimer: ReturnType<typeof setTimeout> | undefined;

	/** 存一份離線副本（這次打開：最近打開的時間換成現在），再刪掉超過 5 支的（有沒傳紀錄的不刪）。 */
	async #keepCopy(copy: OfflineCopy, audio?: AudioBytes) {
		const store = this.#editor.adapters.offline;
		const copies = await store.copies();
		const openedAt = Math.max(Date.now(), ...copies.filter((c) => c.flowId !== copy.flowId).map((c) => c.openedAt + 1));
		await store.saveCopy({ ...copy, openedAt }, audio);
		if (audio) this.#copyAudioIds = Object.keys(audio).sort().join();
		const all = [...copies.filter((c) => c.flowId !== copy.flowId), { ...copy, openedAt }];
		for (const drop of copiesToDrop(all, await store.unsent())) await store.dropCopy(drop);
	}

	/** 開著的雲端流程改了（自己、別人的改動、紀錄）：停手 1 秒後把離線副本換成現在的樣子。 */
	#saveCopyLater() {
		clearTimeout(this.#copyTimer);
		if (!this.#cloud) return;
		this.#copyTimer = setTimeout(() => void this.#saveCopyNow(), DRAFT_DELAY_MS);
	}

	/**
	 * 離線副本換成現在的樣子：只在連著、沒有還沒送到的步時（不然記的第幾步對不上）；這台還沒傳的紀錄不放進去（另外存）。
	 * 已經被擠掉的不再放回來。
	 */
	async #saveCopyNow() {
		const { session, adapters, music } = this.#editor;
		const cloud = this.#cloud;
		const id = this.#cloudId;
		if (!cloud || !id || !session.flow || cloud.offline || cloud.unsent || this.#offlineAt !== null) return;
		const old = (await adapters.offline.copies()).find((c) => c.flowId === id);
		if (!old || this.#cloud !== cloud) return;
		const { flow, records } = takeRecords(session.flow);
		const unsent = new Set(cloud.unsentIds);
		const by = session.recordedBy;
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
			this.#openError = '連不上伺服器，打不開分享連結';
			return;
		}
		if (!found) {
			this.#openError = '這個分享連結不能用了：可能已經關掉，或換了一條新的。';
			return;
		}
		if (found.role) return this.openCloud(found.id);
		const flow = found.flow as Flow;
		const music = await this.#editor.readMusic(await this.#cloudAudio(flow, (audioId) => server.linkAudioBytes(token, audioId)));
		this.#start(flow, 'cloud', newDraftId(), music);
		this.#cloudId = found.id;
		this.#linkOnly = true;
		this.#editor.session.readOnly = ONLY_VIEW;
	}

	/** 被收回時還沒傳的（#260）：擋住畫面的框列出來；按「知道了」（lostKnown）才丟掉、回首頁。沒有是 null。 */
	#lost = $state.raw<{ rows: DroppedRecord[]; then: () => void } | null>(null);
	get lost(): DroppedRecord[] | null {
		return this.#lost?.rows ?? null;
	}
	/** 被收回的框按「知道了」：沒傳的丟掉，回首頁。 */
	lostKnown() {
		const then = this.#lost?.then;
		this.#lost = null;
		then?.();
	}

	/**
	 * 首頁連上網路、拿到雲端流程的清單（cloudIds：我還打得開的）：不在裡面的（被收回、被刪掉）離線副本刪掉（#261），
	 * 首頁最上面黃的那條說哪幾支。還有紀錄沒傳的照 #260 先擋住列出來，按「知道了」才刪（一支一支來）。
	 */
	async dropGoneCopies(cloudIds: string[]) {
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
		const tell = (name: string) => {
			names.push(name);
			this.#revoked = `${names.map((n) => `你已經不能打開「${n}」。`).join('')}${COPY_DROPPED}`;
		};
		for (const c of gone) {
			const u = unsent.find((x) => x.flowId === c.flowId);
			if (u && unsentCount(u) > 0) {
				queue.push({
					rows: u.records.map((r) => r.row),
					then: () => {
						void store.saveUnsent({ ...u, records: [], amends: [], dropped: [] });
						void store.dropCopy(c.flowId);
						tell(c.name);
						next();
					}
				});
			} else {
				await store.dropCopy(c.flowId);
				tell(c.name);
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
		const id = this.#cloudId;
		const cloud = this.#cloud;
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
		if (this.#cloudId === id) this.#editor.session.open(null);
	}

	/** 分享對話框的「刪掉這支流程」（擁有者，確認過了，#252）：伺服器刪掉，回首頁。連不上伺服器丟錯。 */
	async deleteCloud() {
		const id = this.#cloudId;
		const cloud = this.#cloud;
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
		if (this.#cloudId === id) this.#editor.session.open(null);
	}

	/**
	 * 本機流程「☁ 傳上雲端」（#259，登入時）：搬過去。有音樂檔超過 60 MB 先擋（跳框，tooBig）；
	 * 送流程（帶紀錄），伺服器檢查整支流程、建一支新的雲端流程，再把音樂檔一個一個傳上去。
	 * 傳好打開雲端那支、丟掉這台的草稿（資料夾裡的流程檔不動）。音樂沒傳上去就把建好的那支刪掉，還是本機流程。
	 */
	async upload() {
		const { session, adapters, music } = this.#editor;
		if (!session.flow || this.#cloudId || this.#uploading) return;
		adapters.pendingInput.flush();
		const flow = session.flow;
		const audio = music.bytes(flow);
		const big = flow.audio.find((a) => (audio[a.id]?.length ?? 0) > MAX_CLOUD_AUDIO_BYTES);
		if (big) return void (this.#tooBig = tooBig(flow, big.id, audio[big.id].length));
		const server = adapters.server;
		this.#uploading = true;
		session.notice = '傳上雲端中…';
		let id: string | null = null;
		try {
			const made = await server.uploadFlow({ formatVersion: FORMAT_VERSION, flow });
			if ('message' in made) return void (session.notice = `傳不上去：${made.message}`);
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
			session.notice = UPLOAD_UNREACHABLE;
			if (id) void server.deleteFlow(id).catch(() => {});
			return;
		} finally {
			this.#uploading = false;
		}
		const draftId = this.#draftId;
		await this.openCloud(id);
		if (this.#cloudId !== id) {
			session.notice = '傳上雲端了，但打不開雲端那支：回首頁從「我的流程」打開';
			return;
		}
		this.#clearDraft(draftId);
		session.notice = UPLOADED;
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
	 * 帶紀錄、不帶記的人；擁有者、權限、分享連結本來就不在流程裡。下載的那份跟雲端流程不再有關係。
	 */
	async download() {
		const { session, adapters, music } = this.#editor;
		const id = this.#cloudId;
		if (!id || !this.#cloud || !canEdit(this.#cloud.role)) return;
		let found;
		try {
			found = await adapters.server.cloudFlow(id);
		} catch {
			found = null;
		}
		if (!found) return void (session.notice = '連不上伺服器，沒下載');
		const records = found.records.map((r) => ({ actionId: r.actionId, attempt: r.attempt as Attempt }));
		const flow = putRecords(found.flow as Flow, records);
		const fileName = flowFileName(flow.name);
		const saver = adapters.createSaver();
		try {
			const outcome = await saver.save(writeFlowFile(flow, music.bytes(flow)), fileName);
			if (outcome !== 'cancelled') session.notice = savedText(outcome, saver.fileName ?? fileName, false, false, !!saver.touch);
		} catch {
			session.notice = '下載失敗，請再試一次';
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
	 * 窄螢幕上方列的「回首頁」：有還沒存的修改就跟「新建」一樣先問。
	 * 沒有就直接回去；這個分頁的流程（剛建好）留在草稿裡，列在首頁的最近的流程。
	 */
	async leaveToHome() {
		const { session, music } = this.#editor;
		if (session.unsaved) return this.startNew();
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
		editor.session.open(flow, from !== 'draft');
		this.#closeCloud();
		this.#onDisk = from === 'file';
		this.#draftId = draftId;
		this.#fileBytes = null;
		editor.adapters.pendingInput.settle();
		// 從離線副本換成最新的（同一支流程）：練習畫面、對話框不關
		if (switching) this.onswitch();
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
		if (this.#editor.session.unsaved && !approved) this.#asking = { then: go, open };
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
		if (!f || this.#cloudId) return;
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
	 * 這份草稿第一次存：草稿超過 5 支流程的，先丟跟檔案一樣（沒改過）的、舊的先丟；都丟了還超過，才丟改過沒存的最舊那份。
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
			const unchanged = (i: number) => !loaded[i] || fileDraftId(loaded[i].bytes) === oldestFirst[i].id;
			const order = [...oldestFirst.filter((_, i) => unchanged(i)), ...oldestFirst.filter((_, i) => !unchanged(i))];
			for (const old of order.slice(0, extra)) void this.#dropDraft(old.id);
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
		return !!session.flow && !this.#cloudId && (session.unsaved || !this.#onDisk);
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
	const name = span?.label ?? flow.audio.find((a) => a.id === audioId)?.name ?? '';
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
function savedText(outcome: SaveOutcome, fileName: string, first: boolean, hadFile: boolean, touch: boolean): string {
	if (outcome === 'saved') return `已存到「${fileName}」`;
	if (outcome === 'shared') return `已分享「${fileName}」`;
	if (!first) return `已下載${hadFile ? '新的' : ''}「${fileName}」`;
	if (!hadFile) return `已下載「${fileName}」；這個瀏覽器每次存檔都下載一個新檔`;
	return touch
		? `已下載新的「${fileName}」；原本開的檔沒有改`
		: `已下載新的「${fileName}」；這個瀏覽器不能改原本開的檔，用電腦上的 Chrome 或 Edge 開檔，存檔才會存回原檔`;
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
