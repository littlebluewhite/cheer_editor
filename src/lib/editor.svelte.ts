// 編輯器 module：編輯頁的所有狀態都收在這裡，一個編輯頁一個。頁面建一個（或從 prop 收測試建的），用 context 給元件；
// 元件從 context 拿要用的那一部分。它握著編輯 session 和碰瀏覽器的 adapter，所以頁面只剩畫面和接線，
// 規則在 Node 就測得到（測試用 #lib/test-fakes.js 的 testEditor 一行建好帶著假 adapter 的）。
//
// 每一部分是它的一個屬性（session、播放、流程檔、音樂檔庫、動作表單的草稿、右邊欄翻到哪一頁…）。
// 音樂檔庫一支流程一個：換流程時換一個新的（readMusic、switchMusic），所以元件每次用都從 editor.music 拿。
// 每個 adapter 都有真的（browserAdapters）和假的（testEditor）兩種；加一個 adapter 時兩邊都加。

import { createContext } from 'svelte';
import { actionSeconds, type AudioBytes, type Flow } from '#lib/core';
import { ActionDraft } from '#lib/action-draft.svelte.js';
import { decodeAudio, type DecodedAudio } from '#lib/audio/decode.js';
import { createWebAudioEngine, type AudioEngine } from '#lib/audio/engine.js';
import { createIndexedDbDraftStore, type DraftStore } from '#lib/file/draft.js';
import { browserFilePicker, createBrowserSaver, type FileSaver, type PickedFile } from '#lib/file/save.js';
import { EditorSession, setEditorSession } from '#lib/editor-session.svelte.js';
import { FlowFile } from '#lib/flow-file.svelte.js';
import { MusicLibrary } from '#lib/music-library.svelte.js';
import { domPendingInput, type PendingInput } from '#lib/pending-input.js';
import { animationFrame, Playback, type NextFrame } from '#lib/playback.svelte.js';
import { browserTabChannel, type OpenTabChannel } from '#lib/tab-channel.js';

/** 編輯器 module 收的 adapter：碰瀏覽器的都在這裡。 */
export interface EditorAdapters {
	/** 音訊引擎；第一次播放時才建立。 */
	createEngine: (getBuffer: (audioId: string) => AudioBuffer | undefined) => AudioEngine;
	/** 存檔薄層，一支流程一個（記得存到哪個檔）。 */
	createSaver: () => FileSaver;
	/** 選流程檔、拿到存回它的存檔薄層（Chrome、Edge）；null 是瀏覽器不能（照舊用選檔欄位）。 */
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
}

/** 真的 adapter：Web Audio、File System Access（沒有就下載、iPad 分享）、IndexedDB、BroadcastChannel、焦點所在的欄位、requestAnimationFrame。 */
export function browserAdapters(): EditorAdapters {
	return {
		createEngine: createWebAudioEngine,
		createSaver: () => createBrowserSaver(),
		pickFlowFile: browserFilePicker(),
		decode: decodeAudio,
		draftStore: createIndexedDbDraftStore(),
		openTabChannel: browserTabChannel(),
		pendingInput: domPendingInput,
		nextFrame: animationFrame
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
	#music: MusicLibrary;

	/** 給的流程算存過的（跟從檔案開的一樣）；它的音樂都還沒載入。 */
	constructor(adapters: EditorAdapters, flow: Flow | null = null) {
		this.adapters = adapters;
		// 建 session 時（開給的流程）草稿還沒建：它建好時自己跟上一次。
		const follow = () => this.actionDraft?.follow();
		this.playback = new Playback(
			() => this.session.flow,
			() => adapters.createEngine((id) => this.music.buffer(id)),
			adapters.nextFrame,
			follow,
			() => this.session.selectedAction
		);
		this.session = new EditorSession(flow, this.playback, follow);
		this.#music = $state.raw(this.#newMusic());
		this.file = new FlowFile(this);
		this.actionDraft = new ActionDraft(this.session, this.playback);
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
	 * 有沒有沒存的東西：沒存的改動，或欄位裡打了還沒送出的字（在首頁打的不算）。
	 * 關分頁前的提醒、service worker 擋重新整理都看這個。
	 */
	get hasUnsavedWork(): boolean {
		return this.session.unsaved || (!!this.session.flow && this.adapters.pendingInput.pending);
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
