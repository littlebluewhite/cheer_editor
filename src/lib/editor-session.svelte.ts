// 編輯 session：編輯頁的流程、復原、選取、提示、場上那一個問題、分組。編輯器 module（#lib/editor.svelte.js）建一個，
// 跟它一起放進 context 給元件；也可以單獨建來測。不碰瀏覽器（開檔、存檔、草稿留在頁面），所以在 Node 就測得到。
// 播放在編輯器 module：建 session 時接上（SessionPlayback），換了流程、改完要跳播放頭時 session 直接叫它。

import { createContext } from 'svelte';
import {
	carryRecords,
	currentFormation,
	deleteFormation,
	groupsPeople,
	setSquad,
	squadsOf,
	type Action,
	type CommandResult,
	type ConfirmOption,
	type Flow,
	type MoveResult
} from '#lib/core';
import { Ask, type Handlers } from '#lib/ask.svelte.js';
import { Flash } from '#lib/flash.svelte.js';
import { BeatSelection } from './beat-selection.svelte.js';

const UNDO_LIMIT = 100;

/** session 叫的播放（編輯器 module 建 session 時接上；session 單獨測的時候可以不接）。 */
export interface SessionPlayback {
	/** 換一支流程（開檔、新建、救回草稿、回首頁）。 */
	opened(): void;
	/** 換上改過、復原、重做的流程；before 是換之前的。 */
	changed(before: Flow): void;
	/** 改完要跳播放頭：跳到 sec；replay = 播放中從那裡重播。 */
	jump(sec: number, replay: boolean): void;
}

const NO_PLAYBACK: SessionPlayback = { opened() {}, changed() {}, jump() {} };

export class EditorSession {
	readonly #playback: SessionPlayback;
	readonly #updated: () => void;
	#flow = $state.raw<Flow | null>(null);
	/** 上次存檔或開檔時的流程。指令都回傳新的流程，所以 flow 不是它就是有還沒存的修改。 */
	#saved = $state.raw<Flow | null>(null);
	/** 復原紀錄：改之前的流程（最舊的在前）。指令都回傳新的流程，所以存參照就好。不存進草稿或檔案。 */
	#undo = $state.raw<Flow[]>([]);
	/** 重做紀錄：復原掉的流程（最近復原的在後）。做了新的一步就清掉。 */
	#redo = $state.raw<Flow[]>([]);

	/** 上一步可以接著合的：哪一種（key）、合完的流程。流程換了（中間有別的改動）就接不上。 */
	#joinable: { key: string; flow: Flow } | null = null;
	/** nudge 送出時的 key：ask 成功時交給 change。 */
	#joining: string | null = null;

	/** 選到的站位（點縮圖選）；按 Delete 刪掉它。 */
	#formationId = $state<string | null>(null);
	/** 選到的動作（點色條選）；按 Delete 刪掉它。跟站位一次只選一種。 */
	#actionId = $state<string | null>(null);
	/** 選到的人（選人捷徑、點人、框選、點泳道名字）：新增動作用的人，也是場上整組拖的那一組。跟動作、站位的選取分開。 */
	#memberIds = $state.raw<string[]>([]);
	/** 多選開著：場上點人、框選、點泳道名字都是加進來或拿掉，跟按著 Shift 一樣（iPad 沒有 Shift）。 */
	multiSelect = $state(false);
	/** 拍點格子選的拍（選到的動作的）。 */
	readonly beats = new BeatSelection(() => this.#flow?.actions.find((a) => a.id === this.#actionId) ?? null);

	#notice = new Flash<string>();
	/** 提示旁邊有「復原」（剛刪掉站位）。換了提示就沒有。 */
	#noticeUndo = $state(false);

	/** 提示（存檔、開檔的結果、被擋的原因…），浮在場地或練習畫面上；過幾秒（換了一句就重算）或頁面看到下一個操作就收掉。 */
	get notice(): string {
		return this.#notice.value ?? '';
	}

	set notice(text: string) {
		if (!text) this.#notice.clear();
		else if (text !== this.#notice.value) this.#notice.show(text);
		this.#noticeUndo = false;
	}

	/** 提示旁邊要不要放「復原」：按了等於按一次復原。 */
	get noticeUndo(): boolean {
		return this.#noticeUndo;
	}

	/**
	 * 場上那一個問題：拖色條、走位條、挪站位、Delete 刪動作都送到這裡。要問就畫在場上，
	 * 被擋的原因（拖的加「，已還原」）放進提示。成功就算一步、提示收掉。
	 */
	readonly ask = new Ask(
		(f) => {
			this.change(f, this.#joining ?? undefined);
			this.notice = '';
		},
		{ confirmLabel: '確定', onfail: (error) => (this.notice = error) }
	);

	/** 分組浮動列的問題（換組會動到紀錄時）：畫在浮動列上。數字鍵也送到這裡。 */
	readonly squadAsk = new Ask((f) => this.change(f));

	/**
	 * 給的流程算存過的（跟從檔案開的一樣）。playback：改完要叫的播放。
	 * updated：換了流程或選取之後要叫的（編輯器 module 接上：動作表單的草稿跟上）。
	 */
	constructor(flow: Flow | null = null, playback: SessionPlayback = NO_PLAYBACK, updated: () => void = () => {}) {
		this.#playback = playback;
		this.#updated = updated;
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

	/**
	 * 換一支流程（開檔、新建、救回草稿；null 是回到首頁）：清掉復原和重做、選取、提示、問題。
	 * id 會跟上一支重複，所以選取全部清掉。saved = 從檔案開的，算存過。
	 */
	open(flow: Flow | null, saved = false) {
		this.#flow = flow;
		this.#saved = saved ? this.#flow : null;
		this.#undo = [];
		this.#redo = [];
		this.#joinable = null;
		this.clearSelection();
		this.notice = '';
		this.ask.clear();
		this.squadAsk.clear();
		this.#playback.opened();
		this.#updated();
	}

	/** 存好了：存的是 flow 這一份。 */
	markSaved(flow: Flow) {
		this.#saved = flow;
	}

	/**
	 * 「改」：算復原的一步（拖人連帶插站位、往後帶也只呼叫一次）。同一個流程不算。清掉重做。
	 * 給了 join：上一步也是同一個 join、中間沒有別的改動，就跟上一步合成一步。
	 * 回傳有沒有換上新的流程。
	 */
	change(flow: Flow, join?: string): boolean {
		if (!this.#flow || flow === this.#flow) return false;
		const before = this.#flow;
		const joined = join !== undefined && this.#joinable?.key === join && this.#joinable.flow === this.#flow;
		if (!joined) this.#undo = [...this.#undo, this.#flow].slice(-UNDO_LIMIT);
		this.#joinable = join !== undefined ? { key: join, flow } : null;
		this.#redo = [];
		this.#flow = flow;
		this.ask.clear();
		this.#trim(flow);
		this.#playback.changed(before);
		this.#updated();
		return true;
	}

	/**
	 * 「記」：紀錄改了（記一次、刪掉上一次、記一次全上）。不算復原的一步，不清重做。
	 * 復原、重做換上的流程都帶著現在的紀錄（carryRecords）。
	 */
	record(flow: Flow) {
		if (this.#flow) this.#flow = flow;
		this.#updated();
	}

	/** 給元件一個「改」的問題：成功就交給 change（算一步）。 */
	changeAsk(options: { confirmLabel?: string } = {}): Ask {
		return new Ask((f) => this.change(f), options);
	}

	/** 給元件一個「記」的問題：成功就交給 record（不算一步、不清重做）。 */
	recordAsk(): Ask {
		return new Ask((f) => this.record(f));
	}

	/** 復原：換上前一份編排，帶著現在的紀錄。回傳有沒有復原。 */
	undo(): boolean {
		const prev = this.#undo.at(-1);
		if (!this.#flow || !prev) return false;
		const before = this.#flow;
		this.#redo = [...this.#redo, this.#flow];
		this.#undo = this.#undo.slice(0, -1);
		this.#flow = carryRecords(prev, this.#flow);
		this.#restored(this.#flow, before);
		return true;
	}

	/** 重做：換上復原掉的編排，帶著現在的紀錄。回傳有沒有重做。 */
	redo(): boolean {
		const next = this.#redo.at(-1);
		if (!this.#flow || !next) return false;
		const before = this.#flow;
		this.#undo = [...this.#undo, this.#flow];
		this.#redo = this.#redo.slice(0, -1);
		this.#flow = carryRecords(next, this.#flow);
		this.#restored(this.#flow, before);
		return true;
	}

	/**
	 * 方向鍵移人：跟場上的問題一樣送出去，成功時連續同一個 key（同一批人、同一拍）、
	 * 中間沒有別的改動，就合成復原的一步。
	 */
	nudge<R extends CommandResult>(key: string, send: () => R, handlers: Handlers<R> = {}): R {
		this.#joining = key;
		try {
			return this.ask.send(send, handlers);
		} finally {
			this.#joining = null;
		}
	}

	/** 復原、重做換上的流程：提示、場上的問題收掉，選取修剪，播放頭夾回流程。 */
	#restored(flow: Flow, before: Flow) {
		this.#joinable = null;
		this.#trim(flow);
		this.ask.clear();
		this.notice = '';
		this.#playback.changed(before);
		this.#updated();
	}

	/** 換上流程（改的、復原、重做）。被刪掉（含連帶刪掉）的人、動作、站位從選取拿掉，免得之後重用的 id 被選到。 */
	#trim(f: Flow) {
		if (this.#formationId && !f.formations.some((x) => x.id === this.#formationId)) this.#formationId = null;
		if (this.#actionId && !f.actions.some((a) => a.id === this.#actionId)) this.#actionId = null;
		if (this.#memberIds.some((id) => !f.members.some((m) => m.id === id))) {
			this.#memberIds = this.#memberIds.filter((id) => f.members.some((m) => m.id === id));
		}
		this.beats.fit();
	}

	// ---------- 改完跳播放頭 ----------

	/** 拖人、跟上一張一樣改好了（送到 ask 的 done）：說插了站位或往後帶了幾張，播放頭停到改的那張。 */
	moved(r: MoveResult) {
		const said = [
			r.inserted && '插了一張站位，大家的位置自動帶入',
			r.carried > 0 && `後面 ${r.carried} 張站位也跟著改了`
		];
		this.notice = said.filter(Boolean).join('；');
		// 選著的縮圖不是剛改的那張：選取清掉，不然 Delete 會刪到眼睛沒在看的那張
		if (this.#formationId && this.#flow && this.#formationId !== currentFormation(this.#flow, r.sec).formation.id) {
			this.#formationId = null;
		}
		this.#playback.jump(r.sec, false);
	}

	/**
	 * 挪好站位了（拖縮圖、打站位時間，送到 ask 的 done）：提示走位被壓短的人，
	 * 選著這張，播放頭跳到新的站位時間。
	 */
	formationMoved(formationId: string, r: { sec: number; squeezed: string[] }) {
		const names = r.squeezed.map((id) => this.#flow?.members.find((m) => m.id === id)?.name);
		this.notice = names.length ? `走位被壓短：${names.join('、')}` : '';
		this.selectFormation(formationId);
		this.#playback.jump(r.sec, true);
	}

	/** 刪一張站位（縮圖的 ✕、Delete）：不問，提示「已刪掉站位 N」，旁邊有「復原」。 */
	removeFormation(formationId: string) {
		const flow = this.#flow;
		if (!flow) return;
		const number = flow.formations.findIndex((f) => f.id === formationId) + 1;
		this.ask.send(() => deleteFormation(flow, formationId), {
			done: () => {
				this.notice = `已刪掉站位 ${number}`;
				this.#noticeUndo = true;
			}
		});
	}

	// ---------- 選取 ----------

	get selectedFormationId(): string | null {
		return this.#formationId;
	}

	get selectedActionId(): string | null {
		return this.#actionId;
	}

	get selectedMemberIds(): string[] {
		return this.#memberIds;
	}

	get anySelected(): boolean {
		return !!this.#formationId || !!this.#actionId || this.#memberIds.length > 0;
	}

	/** 選站位：動作的選取清掉。 */
	selectFormation(id: string | null) {
		this.#formationId = id;
		if (id) this.#actionId = null;
		this.#updated();
	}

	/** 選動作：站位的選取清掉。換了動作，選的拍從頭來。 */
	selectAction(id: string | null) {
		const changed = id !== this.#actionId;
		this.#actionId = id;
		if (id) this.#formationId = null;
		if (changed) this.beats.reset();
		this.#updated();
	}

	selectMembers(ids: string[]) {
		this.#memberIds = ids;
		this.#updated();
	}

	/** 點人（場地、泳道名字）：只選他；Shift 或多選開著是加進來或拿掉。 */
	pickMember(id: string, shift: boolean) {
		if (!shift && !this.multiSelect) return this.selectMembers([id]);
		const ids = this.#memberIds;
		this.selectMembers(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
	}

	/** 站位、動作、人的選取都清掉（Esc 或「取消選取」）。 */
	clearSelection() {
		this.#formationId = null;
		this.#actionId = null;
		this.#memberIds = [];
		this.#updated();
	}

	// ---------- 分組 ----------

	/** 選到的動作有環節、要分組（騰翻、跳躍以外）：場上出現組號小圓和分組浮動列。 */
	get groupingAction(): Action | null {
		const a = this.#actionId ? this.#flow?.actions.find((x) => x.id === this.#actionId) : undefined;
		return a && groupsPeople(a) ? a : null;
	}

	/** 選到的人裡、在分組動作裡的。 */
	get squadPicked(): string[] {
		const action = this.groupingAction;
		return action ? this.#memberIds.filter((id) => action.members.some((m) => m.memberId === id)) : [];
	}

	/**
	 * 把選的人放進第 n 組（最多到新的一組），0 拿出組；數字鍵和分組浮動列的號碼、「＋」「✕」都叫它。
	 * 沒選要分組的動作、沒選動作裡的人、超過新的一組不算。回傳有沒有送出去。
	 */
	squadKey(n: number): boolean {
		const action = this.groupingAction;
		const ids = this.squadPicked;
		if (!action || !ids.length || n > squadsOf(action).length + 1) return false;
		// 按回答時用那時候的流程再送一次。
		this.squadAsk.send((o: ConfirmOption = {}) => setSquad(this.#flow!, action.id, ids, n === 0 ? null : n, o));
		return true;
	}
}

/** 頁面放進 context、元件拿出來用的 session。has：有沒有放（場地在八拍表上只畫、不編）。 */
export const [getEditorSession, setEditorSession, hasEditorSession] = createContext<EditorSession>();
