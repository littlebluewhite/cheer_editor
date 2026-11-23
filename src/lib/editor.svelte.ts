// 編輯器 module：編輯頁的所有狀態都收在這裡，一個編輯頁一個。頁面建一個（或從 prop 收測試建的），用 context 給元件；
// 元件從 context 拿要用的那一部分。它握著編輯 session 和碰瀏覽器的 adapter，所以頁面只剩畫面和接線，
// 規則在 Node 就測得到（測試用 #lib/test-fakes.js 的 testEditor 一行建好帶著假 adapter 的）。
//
// 每一部分是它的一個屬性（session、播放、流程檔、音樂檔庫、動作表單的草稿、右邊欄翻到哪一頁…）。
// 音樂檔庫一支流程一個：換流程時換一個新的（readMusic、switchMusic），所以元件每次用都從 editor.music 拿。
// 每個 adapter 都有真的（browserAdapters）和假的（testEditor）兩種；加一個 adapter 時兩邊都加。

import { createContext } from 'svelte';
import { createSubscriber } from 'svelte/reactivity';
import { actionSeconds, type AudioBytes, type Flow } from '#lib/core';
import { ActionDraft } from '#lib/action-draft.svelte.js';
import { decodeAudio, type DecodedAudio } from '#lib/audio/decode.js';
import { createWebAudioEngine, type AudioEngine } from '#lib/audio/engine.js';
import type { DraftStore } from '#lib/file/draft.js';
import { browserFilePicker, createBrowserSaver, downloadFile, saveVideo, type FileSaver, type PickedFile, type SaveOutcome } from '#lib/file/save.js';
import { EditorSession, setEditorSession, type UpdateReason } from '#lib/editor-session.svelte.js';
import { FlowFile } from '#lib/flow-file.svelte.js';
import { Home } from '#lib/home.svelte.js';
import { browserVideoEncoder, type VideoEncoderAdapter } from '#lib/video/encoder.js';
import { MusicLibrary } from '#lib/music-library.svelte.js';
import { domPendingInput, type PendingInput } from '#lib/pending-input.js';
import { animationFrame, Playback, type NextFrame } from '#lib/playback.svelte.js';
import { browserTabChannel, type OpenTabChannel } from '#lib/tab-channel.js';
import { httpServer, type ServerAdapter } from '#lib/server-api.js';
import type { OfflineStore } from '#lib/offline-store.js';
import { host } from '#lib/host.js';
import { OPEN_FILE_FEATURE, shellFilePicker } from '#lib/shell-open-file.js';
import { browserNetwork, type NetworkAdapter } from '#lib/network.js';

/** 編輯器 module 收的 adapter：碰瀏覽器的都在這裡。 */
export interface EditorAdapters {
	/** 音訊引擎；第一次播放時才建立。 */
	createEngine: (getBuffer: (audioId: string) => AudioBuffer | undefined) => AudioEngine;
	/** 存檔薄層，一支流程一個（記得存到哪個檔）。 */
	createSaver: () => FileSaver;
	/** 存成一個新的流程檔、不碰原本的檔（雲端流程「⤓ 下載」）：觸控螢幕開分享選單，其他下載。 */
	download: (bytes: Uint8Array, fileName: string) => Promise<SaveOutcome>;
	/** 選流程檔、拿到存回它的存檔薄層（Chrome、Edge；App 裡請殼叫出選檔畫面，#384）；null 是瀏覽器不能（照舊用選檔欄位）。 */
	pickFlowFile: (() => Promise<PickedFile | null>) | null;
	/** 解碼音樂檔。 */
	decode: (bytes: ArrayBuffer) => Promise<DecodedAudio>;
	/** 草稿存在哪裡。 */
	draftStore: DraftStore;
	/** 分頁頻道：問別的分頁有沒有在編草稿；null 是瀏覽器沒有（當作沒有別的分頁）。 */
	openTabChannel: OpenTabChannel | null;
	/** 欄位裡打了還沒送出的字。 */
	pendingInput: PendingInput;
	/** 畫面時鐘：播放時每一格畫面移一次播放頭。 */
	nextFrame: NextFrame;
	/** 連伺服器：登入、我是誰。 */
	server: ServerAdapter;
	/** 離線存放（#260）：雲端流程還沒傳的紀錄、沒存進去的清單存在這台。 */
	offline: OfflineStore;
	/** 有沒有網路（瀏覽器說的）：編輯器 module 的 online 從這裡來。 */
	network: NetworkAdapter;
	/** 流程影片：編碼，和存成 流程名.mp4（跟流程檔的存檔是兩套）。 */
	video: { encoder: VideoEncoderAdapter; save: (bytes: Uint8Array, fileName: string) => Promise<SaveOutcome> };
}

/** 真的 adapter：Web Audio、File System Access（沒有就下載、iPad 分享）、IndexedDB（草稿、離線存放）、BroadcastChannel、焦點所在的欄位、requestAnimationFrame、fetch、navigator.onLine。 */
export function browserAdapters(): EditorAdapters {
	const network = browserNetwork();
	return {
		createEngine: createWebAudioEngine,
		createSaver: () => createBrowserSaver(),
		download: downloadFile,
		pickFlowFile: host().shell.can(OPEN_FILE_FEATURE) ? shellFilePicker(host().shell, () => createBrowserSaver()) : browserFilePicker(),
		decode: decodeAudio,
		draftStore: host().createDraftStore(),
		openTabChannel: browserTabChannel(),
		pendingInput: domPendingInput,
		nextFrame: animationFrame,
		server: httpServer('', network),
		offline: host().createOfflineStore(),
		network,
		video: { encoder: browserVideoEncoder(), save: saveVideo }
	};
}

export class Editor {
	/** 編輯 session：流程、復原、選取、提示、場上那一個問題、分組。 */
	readonly session: EditorSession;
	/** 收著的 adapter。頁面從這裡拿沒送出的字（⌘Z 前後送出）。 */
	readonly adapters: EditorAdapters;
	/** 播放：播放頭、在不在播、節拍器、延遲校正、試聽。 */
	readonly playback: Playback;
	/** 動作表單的草稿：跟著選的人、播放頭、自訂任務角色。 */
	readonly actionDraft: ActionDraft;
	/** 右邊欄翻到哪一頁：動作（選人＋動作表單）或隊員名單。 */
	inspectorTab = $state<'action' | 'members'>('action');
	/** 流程檔：開檔、存檔、新建、回首頁、草稿、「沒存先問」。 */
	readonly file: FlowFile;
	/** 首頁和帳號：登入的是誰、我的流程、還沒傳的紀錄、離線副本、登出。 */
	readonly home: Home;
	#music: MusicLibrary;
	/** 畫面讀 online 時才聽網路變了沒（沒人在看就不聽）。 */
	readonly #watchNetwork = createSubscriber((update) => this.adapters.network.onChange(update));

	/** 給的流程算存過的（跟從檔案開的一樣）；它的音樂都還沒載入。 */
	constructor(adapters: EditorAdapters, flow: Flow | null = null) {
		this.adapters = adapters;
		// 建 session 時（開給的流程）草稿還沒建：它建好時自己跟上一次。
		const follow = (reason?: UpdateReason) => this.actionDraft?.follow(reason);
		this.playback = new Playback(
			() => this.session.flow,
			() => adapters.createEngine((id) => this.music.buffer(id)),
			adapters.nextFrame,
			() => follow(),
			() => this.session.selectedAction
		);
		this.session = new EditorSession(flow, this.playback, follow);
		this.#music = $state.raw(this.#newMusic());
		this.file = new FlowFile(this);
		this.home = new Home(this);
		this.actionDraft = new ActionDraft(this.session, this.playback);
	}

	/** 有沒有網路（瀏覽器說的）：每次讀都是現在的；畫面讀它，網路變了就跟著畫。 */
	get online(): boolean {
		this.#watchNetwork();
		return this.adapters.network.online();
	}

	/** 音樂檔庫：這支流程用到的音樂檔。一支流程一個，換流程就換一個新的（switchMusic）。 */
	get music(): MusicLibrary {
		return this.#music;
	}

	/** 開檔、救回草稿：檔案裡的音樂解碼好，建一個新的音樂檔庫（還沒換上：確定換流程時交給 switchMusic）。 */
	async readMusic(audio: AudioBytes): Promise<MusicLibrary> {
		const music = this.#newMusic();
		await music.load(audio);
		return music;
	}

	/** 換流程：換上這支流程的音樂檔庫（沒給是空的：新建的流程）；舊的還在解碼的選檔不要了。 */
	switchMusic(music = this.#newMusic()) {
		this.#music.cancelPicks();
		this.#music = music;
	}

	/** 空的音樂檔庫。 */
	#newMusic(): MusicLibrary {
		return new MusicLibrary(this.session, this.adapters.decode);
	}

	/**
	 * 有沒有沒存的東西：沒存的改動、改了還在等教練回答的、欄位裡打了還沒送出的字（在首頁打的不算），或雲端流程還沒送到伺服器的步。
	 * 關分頁前的提醒、service worker 擋重新整理都看這個。
	 */
	get hasUnsavedWork(): boolean {
		return (
			this.session.unsavedOrAsking ||
			(!!this.session.flow && this.adapters.pendingInput.pending) ||
			!!this.file.cloud?.unsent
		);
	}

	/** 點時間軸的色條：選這個動作，右邊欄翻到「動作」（再點選著的那條也算）。 */
	pickAction(id: string) {
		this.session.selectAction(id);
		this.inspectorTab = 'action';
	}

	/** 雙擊色條、動作表單的「跳到開始」：播放頭跳到這個動作開始。 */
	seekToAction(id: string) {
		const flow = this.session.flow;
		const action = flow?.actions.find((a) => a.id === id);
		if (flow && action) this.playback.seek(actionSeconds(flow, action).startSec);
	}
}

// 元件用 getEditor() 拿編輯器 module，再拿要用的那一部分（例：getEditor().pickAction）。hasEditor：有沒有放（八拍表單獨畫時沒有）。
const [getEditor, setEditorContext, hasEditor] = createContext<Editor>();
export { getEditor, hasEditor };

/** 頁面（和元件測試）放進 context：編輯器 module 和它的 session（元件照舊用 getEditorSession 拿 session）。 */
export function setEditor(editor: Editor) {
	setEditorContext(editor);
	setEditorSession(editor.session);
}
