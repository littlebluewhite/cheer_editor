// 編輯器 module：編輯頁的所有狀態都收在這裡，一個編輯頁一個。頁面建一個（或從 prop 收測試建的），用 context 給元件；
// 元件從 context 拿要用的那一部分。它握著編輯 session 和碰瀏覽器的 adapter，所以頁面只剩畫面和接線，
// 規則在 Node 就測得到（測試用 #lib/test-fakes.js 的 testEditor 一行建好帶著假 adapter 的）。
//
// 每一部分是它的一個屬性（session、右邊欄翻到哪一頁…），之後搬進來的播放、流程檔、音樂檔庫、新動作草稿也一樣。
// 每個 adapter 都有真的（browserAdapters）和假的（testEditor）兩種；加一個 adapter 時兩邊都加。

import { createContext } from 'svelte';
import type { Flow } from '#lib/core';
import { decodeAudio, type DecodedAudio } from '#lib/audio/decode.js';
import { createWebAudioEngine, type AudioEngine } from '#lib/audio/engine.js';
import { createIndexedDbDraftStore, type DraftStore } from '#lib/file/draft.js';
import { browserFilePicker, createBrowserSaver, type FileSaver, type PickedFile } from '#lib/file/save.js';
import { EditorSession, setEditorSession } from '#lib/editor-session.svelte.js';

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
}

/** 真的 adapter：Web Audio、File System Access（沒有就下載、iPad 分享）、IndexedDB。 */
export function browserAdapters(): EditorAdapters {
	return {
		createEngine: createWebAudioEngine,
		createSaver: () => createBrowserSaver(),
		pickFlowFile: browserFilePicker(),
		decode: decodeAudio,
		draftStore: createIndexedDbDraftStore()
	};
}

export class Editor {
	/** 編輯 session：流程、復原、選取、提示、場上那一個問題、分組。 */
	readonly session: EditorSession;
	/** 收著的 adapter。開檔、存檔、草稿、播放的規則還在頁面，頁面從這裡拿；規則搬進來以後就不用再對外。 */
	readonly adapters: EditorAdapters;
	/** 右邊欄翻到哪一頁：動作（選人＋動作表單）或隊員名單。 */
	inspectorTab = $state<'action' | 'members'>('action');

	/** 給的流程算存過的（跟從檔案開的一樣）。 */
	constructor(adapters: EditorAdapters, flow: Flow | null = null) {
		this.adapters = adapters;
		this.session = new EditorSession(flow);
	}

	/** 點時間軸的色條：選這個動作，右邊欄翻到「動作」（再點選著的那條也算）。 */
	pickAction(id: string) {
		this.session.selectAction(id);
		this.inspectorTab = 'action';
	}
}

// 元件用 getEditor() 拿編輯器 module，再拿要用的那一部分（例：getEditor().pickAction）。
const [getEditor, setEditorContext] = createContext<Editor>();
export { getEditor };

/** 頁面（和元件測試）放進 context：編輯器 module 和它的 session（元件照舊用 getEditorSession 拿 session）。 */
export function setEditor(editor: Editor) {
	setEditorContext(editor);
	setEditorSession(editor.session);
}
