// 編輯 session：編輯頁的流程和復原。頁面建一個，用 context 給元件；測試可以自己建一個放進頁面。
// 不碰瀏覽器（開檔、存檔、草稿、播放留在頁面），所以在 Node 就測得到。

import { createContext } from 'svelte';
import { carryRecords, type Flow } from '#lib/core';

const UNDO_LIMIT = 100;

export class EditorSession {
	#flow = $state<Flow | null>(null);
	/** 上次存檔或開檔時的流程。指令都回傳新的流程，所以 flow 不是它就是有還沒存的修改。 */
	#saved = $state.raw<Flow | null>(null);
	/** 復原紀錄：改之前的流程（最舊的在前）。指令都回傳新的流程，所以存參照就好。不存進草稿或檔案。 */
	#undo = $state.raw<Flow[]>([]);
	/** 重做紀錄：復原掉的流程（最近復原的在後）。做了新的一步就清掉。 */
	#redo = $state.raw<Flow[]>([]);

	/** 給的流程算存過的（跟從檔案開的一樣）。 */
	constructor(flow: Flow | null = null) {
		this.open(flow, true);
	}

	get flow(): Flow | null {
		return this.#flow;
	}

	get unsaved(): boolean {
		return this.#flow !== null && this.#flow !== this.#saved;
	}

	get canUndo(): boolean {
		return this.#undo.length > 0;
	}

	get canRedo(): boolean {
		return this.#redo.length > 0;
	}

	/** 換一支流程（開檔、新建、救回草稿；null 是回到首頁）：清掉復原和重做。saved = 從檔案開的，算存過。 */
	open(flow: Flow | null, saved = false) {
		this.#flow = flow;
		this.#saved = saved ? this.#flow : null;
		this.#undo = [];
		this.#redo = [];
	}

	/** 存好了：存的是 flow 這一份。 */
	markSaved(flow: Flow) {
		this.#saved = flow;
	}

	/**
	 * 「改」：算復原的一步（拖人連帶插站位、往後帶也只呼叫一次）。同一個流程不算。清掉重做。
	 * 回傳有沒有換上新的流程。
	 */
	change(flow: Flow): boolean {
		if (!this.#flow || flow === this.#flow) return false;
		this.#undo = [...this.#undo, this.#flow].slice(-UNDO_LIMIT);
		this.#redo = [];
		this.#flow = flow;
		return true;
	}

	/**
	 * 「記」：紀錄改了（記一次、刪掉上一次、記一次全上）。不算復原的一步，不清重做。
	 * 復原、重做換上的流程都帶著現在的紀錄（carryRecords）。
	 */
	record(flow: Flow) {
		if (this.#flow) this.#flow = flow;
	}

	/** 復原：換上前一份編排，帶著現在的紀錄。回傳有沒有復原。 */
	undo(): boolean {
		const prev = this.#undo.at(-1);
		if (!this.#flow || !prev) return false;
		this.#redo = [...this.#redo, this.#flow];
		this.#undo = this.#undo.slice(0, -1);
		this.#flow = carryRecords(prev, this.#flow);
		return true;
	}

	/** 重做：換上復原掉的編排，帶著現在的紀錄。回傳有沒有重做。 */
	redo(): boolean {
		const next = this.#redo.at(-1);
		if (!this.#flow || !next) return false;
		this.#undo = [...this.#undo, this.#flow];
		this.#redo = this.#redo.slice(0, -1);
		this.#flow = carryRecords(next, this.#flow);
		return true;
	}
}

/** 頁面放進 context、元件拿出來用的 session。 */
export const [getEditorSession, setEditorSession] = createContext<EditorSession>();
