// 編輯 session：編輯頁的流程、復原、選取、提示、場上那一個問題、分組。編輯器 module（#lib/editor.svelte.js）建一個，
// 跟它一起放進 context 給元件；也可以單獨建來測。不碰瀏覽器（開檔、存檔、草稿在編輯器 module 的流程檔），所以在 Node 就測得到。
// 播放在編輯器 module：建 session 時接上（SessionPlayback），換了流程、改完要跳播放頭時 session 直接叫它。

import { createContext } from 'svelte';
import {
	actionLabel,
	carryRecords,
	changeLabel,
	currentFormation,
	deleteAction,
	deleteFormation,
	formationTimes,
	groupsPeople,
	setSquad,
	squadsOf,
	timeTextWithUnit,
	type Action,
	type CommandResult,
	type ConfirmOption,
	type Flow,
	type Mark,
	type MoveResult
} from '#lib/core';
import { Ask, type Handlers } from '#lib/ask.svelte.js';
import { Flash, UNDO_FLASH_MS } from '#lib/flash.svelte.js';
import { BeatSelection } from './beat-selection.svelte.js';

const UNDO_LIMIT = 100;

/** 復原、重做紀錄的一步：要換上的流程、那一步改了什麼（例：「插入站位 3」）。 */
interface Step {
	flow: Flow;
	label: string;
}

/** 選得到的三種東西：站位、動作、人。 */
type PickKind = 'formation' | 'action' | 'member';

/** 檢視模式下改流程被擋的原因。 */
export const VIEW_ONLY = '檢視模式只能看、只能播放；要改先按上方列的「編輯」';

/** 拖過頭（走位條、縮圖、場上的人）停在最遠的合法位置時的提示。 */
export const AT_EDGE = '已靠到邊界';

/** 最後點的是人時按 Delete 的提示：不刪任何東西。 */
export const PICK_ACTION_FIRST = '要刪動作，先點動作';

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
	/**
	 * 復原紀錄：改之前的流程（最舊的在前）和那一步改了什麼（復原、重做的提示用）。
	 * 指令都回傳新的流程，所以存參照就好。不存進草稿或檔案。
	 */
	#undo = $state.raw<Step[]>([]);
	/** 重做紀錄：復原掉的流程（最近復原的在後）和那一步改了什麼。做了新的一步就清掉。 */
	#redo = $state.raw<Step[]>([]);

	/** 上一步可以接著合的：哪一種（key）、合完的流程。流程換了（中間有別的改動）就接不上。 */
	#joinable: { key: string; flow: Flow } | null = null;
	/** nudge 送出時的 key：ask 成功時交給 change。 */
	#joining: string | null = null;

	/** 選到的站位（點縮圖選）；按 Delete 刪掉它。 */
	#formationId = $state<string | null>(null);
	/** 最近一次拖人自動插入、又往後帶改了後面站位的那張站位：刪它時提示後面的改動還在。 */
	#carriedInsertId: string | null = null;
	/** 選到的動作（點色條選）；按 Delete 刪掉它。跟站位一次只選一種。 */
	#actionId = $state<string | null>(null);
	/** 選到的人（選人捷徑、點人、框選、點泳道名字）：新增動作用的人，也是場上整組拖的那一組。跟動作、站位的選取分開。 */
	#memberIds = $state.raw<string[]>([]);
	/** 最後點的是哪一種：Delete／Backspace 只看它（點了人以後，之前選的站位、動作還在，但不刪）。 */
	#picked: PickKind | null = null;
	/**
	 * 檢視模式：只能看、只能播放。改流程的指令（場上、表單、Delete、復原、重做…）都擋下，說 VIEW_ONLY；
	 * 選取、播放照常。練習的紀錄（「記」）不算改編排，照記。
	 */
	viewing = $state(false);
	/**
	 * 記錄頁每張卡上次選的「這次練」，key 是「動作 id 組或隊員 id」：whole 整個做，不是就只練 picked 這幾個環節。
	 * 換動作、切頁（卡不見了）再回來還是它；不存進流程檔。
	 */
	readonly drillScopes: Record<string, { whole: boolean; picked: string[] }> = $state({});
	/**
	 * 記錄頁每張卡點了還沒存的記號（環節 id → 記號），key 是 drillScopes 的 key 加上日期（一天一份）。
	 * 換動作、切頁再回來還在；換一支流程就清掉；不存進流程檔。
	 */
	drillMarks: Record<string, Record<string, Mark>> = $state({});
	/**
	 * 練習畫面切頁（記錄、總表、編排）之前要先問的：全上表改過格子時由它接上，問了、教練選丟掉才 go()。沒有就直接切。
	 * 不存進流程檔。
	 */
	practiceLeave: ((go: () => void) => void) | null = $state.raw(null);

	/** 離開練習畫面的這一頁：有要先問的就交給它，沒有就直接 go()。 */
	leavePracticePage(go: () => void) {
		if (this.practiceLeave) this.practiceLeave(go);
		else go();
	}
	/** 多選開著：場上點人、框選、點泳道名字都是加進來或拿掉，跟按著 Shift 一樣（iPad 沒有 Shift）。 */
	multiSelect = $state(false);
	/** 換上別的流程之後（開、改、記、復原、重做）叫：流程檔停手 1 秒存草稿。流程檔建好時接上。 */
	onflow: () => void = () => {};
	/** 拍點格子選的拍（選到的動作的）。 */
	readonly beats = new BeatSelection(() => this.selectedAction);

	#notice = new Flash<string>();
	/** 提示旁邊「復原」的名字（剛刪掉站位、動作，例：「復原刪掉的站位」）；沒有是空字串。換了提示就沒有。 */
	#noticeUndo = $state('');

	/** 提示（存檔、開檔的結果、被擋的原因…），浮在場地或練習畫面上；過幾秒（換了一句就重算）或頁面看到下一個操作就收掉。 */
	get notice(): string {
		return this.#notice.value ?? '';
	}

	set notice(text: string) {
		if (!text) this.#notice.clear();
		else if (text !== this.#notice.value) this.#notice.show(text);
		this.#noticeUndo = '';
	}

	/** 提示旁邊「復原」的名字（空字串是沒有「復原」）：按了等於按一次復原。 */
	get noticeUndo(): string {
		return this.#noticeUndo;
	}

	/** 剛刪掉東西：提示旁邊放「復原」（undoLabel 是它的名字），留久一點（UNDO_FLASH_MS）。 */
	#undoNotice(text: string, undoLabel: string) {
		this.#notice.show(text, UNDO_FLASH_MS);
		this.#noticeUndo = undoLabel;
	}

	/** 滑鼠在提示上：先不收（停住倒數）；移開了把剩下的時間走完。 */
	holdNotice(on: boolean) {
		this.#notice.hold(on);
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
		{ confirmLabel: '確定', onfail: (error) => (this.notice = error), locked: () => this.#locked() }
	);

	/** 分組浮動列的問題（換組會動到紀錄時）：畫在浮動列上。數字鍵也送到這裡。 */
	readonly squadAsk = new Ask((f) => this.change(f), { locked: () => this.#locked() });

	/** 改流程鎖著的原因：檢視模式是 VIEW_ONLY，編輯是空字串。 */
	#locked(): string {
		return this.viewing ? VIEW_ONLY : '';
	}

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
		this.drillMarks = {};
		this.notice = '';
		this.ask.clear();
		this.squadAsk.clear();
		this.#playback.opened();
		this.onflow();
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
		// 合成一步的：說的是從合之前到現在改了什麼
		const from = joined ? this.#undo.at(-1)!.flow : this.#flow;
		const step = { flow: from, label: changeLabel(from, flow) };
		this.#undo = (joined ? [...this.#undo.slice(0, -1), step] : [...this.#undo, step]).slice(-UNDO_LIMIT);
		this.#joinable = join !== undefined ? { key: join, flow } : null;
		this.#redo = [];
		this.#flow = flow;
		this.ask.clear();
		this.#trim(flow);
		this.#playback.changed(before);
		this.onflow();
		this.#updated();
		return true;
	}

	/**
	 * 「記」：紀錄改了（記一次、刪掉上一次、記一次全上）。不算復原的一步，不清重做。
	 * 復原、重做換上的流程都帶著現在的紀錄（carryRecords）。
	 */
	record(flow: Flow) {
		if (!this.#flow) return;
		this.#flow = flow;
		this.onflow();
		this.#updated();
	}

	/** 給元件一個「改」的問題：成功就交給 change（算一步）。onfail：沒成功之後（例：原因放進提示）。 */
	changeAsk(options: { confirmLabel?: string; onfail?: (error: string) => void } = {}): Ask {
		const ask = new Ask((f) => this.change(f), { ...options, locked: () => this.#locked() });
		this.#changeAsks.add(new WeakRef(ask));
		return ask;
	}

	/** 給元件的「改」的問題（changeAsk）：復原、重做時一起收掉。元件拆掉了就放掉（WeakRef）。 */
	#changeAsks = new Set<WeakRef<Ask>>();

	/** 有「改」的問題等教練回答（例：改了有紀錄的人的名字，還沒選保留或清掉）：答了才會改進流程。 */
	get questionOpen(): boolean {
		if (this.ask.question || this.squadAsk.question) return true;
		return [...this.#changeAsks].some((ref) => !!ref.deref()?.question);
	}

	/** 問題都收掉：問的是換掉之前的流程，留著會冒出舊內容，按下去還會清掉重做。 */
	#clearAsks() {
		this.ask.clear();
		this.squadAsk.clear();
		for (const ref of this.#changeAsks) {
			const ask = ref.deref();
			if (ask) ask.clear();
			else this.#changeAsks.delete(ref);
		}
	}

	/** 給元件一個「記」的問題：成功就交給 record（不算一步、不清重做）。 */
	recordAsk(): Ask {
		return new Ask((f) => this.record(f));
	}

	/** 復原：換上前一份編排，帶著現在的紀錄，提示「已復原：…」。回傳有沒有復原（檢視模式擋下，說原因）。 */
	undo(): boolean {
		if (this.#blocked()) return false;
		const prev = this.#undo.at(-1);
		if (!this.#flow || !prev) return false;
		const before = this.#flow;
		this.#redo = [...this.#redo, { flow: this.#flow, label: prev.label }];
		this.#undo = this.#undo.slice(0, -1);
		this.#flow = carryRecords(prev.flow, this.#flow);
		this.#restored(this.#flow, before);
		this.notice = `已復原：${prev.label}`;
		return true;
	}

	/** 重做：換上復原掉的編排，帶著現在的紀錄，提示「已重做：…」。回傳有沒有重做（檢視模式擋下，說原因）。 */
	redo(): boolean {
		if (this.#blocked()) return false;
		const next = this.#redo.at(-1);
		if (!this.#flow || !next) return false;
		const before = this.#flow;
		this.#undo = [...this.#undo, { flow: this.#flow, label: next.label }];
		this.#redo = this.#redo.slice(0, -1);
		this.#flow = carryRecords(next.flow, this.#flow);
		this.#restored(this.#flow, before);
		this.notice = `已重做：${next.label}`;
		return true;
	}

	/** 鎖著（檢視模式）：原因放進提示，回傳 true。 */
	#blocked(): boolean {
		const locked = this.#locked();
		if (locked) this.notice = locked;
		return !!locked;
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

	/** 復原、重做換上的流程：提示、場上和元件的問題收掉，選取修剪，播放頭夾回流程。 */
	#restored(flow: Flow, before: Flow) {
		this.#joinable = null;
		this.#carriedInsertId = null;
		this.#trim(flow);
		this.#clearAsks();
		this.notice = '';
		this.#playback.changed(before);
		// 選到的站位還在、站位時間換了（復原、重做挪站位）：播放頭跟到它的時間，接著拖人才不會多插一張
		const sec = (f: Flow) => formationTimes(f).find((t) => t.formation.id === this.#formationId)?.sec;
		const now = sec(flow);
		if (now !== undefined && now !== sec(before)) this.#playback.jump(now, false);
		this.onflow();
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

	/**
	 * 拖人、跟上一張一樣改好了（送到 ask 的 done）：說插了站位或往後帶了幾張，播放頭停到改的那張。
	 * atEdge = 拖過頭停在邊界，多一句「已靠到邊界」。
	 */
	moved(r: MoveResult, atEdge = false) {
		const said = [
			r.inserted && '插了一張站位，大家的位置自動帶入',
			r.carried > 0 && `後面 ${r.carried} 張站位也跟著改了`,
			atEdge && AT_EDGE
		];
		this.notice = said.filter(Boolean).join('；');
		this.#carriedInsertId =
			r.inserted && r.carried > 0 && this.#flow ? currentFormation(this.#flow, r.sec).formation.id : null;
		// 選著的縮圖不是剛改的那張：選取清掉，不然 Delete 會刪到眼睛沒在看的那張
		if (this.#formationId && this.#flow && this.#formationId !== currentFormation(this.#flow, r.sec).formation.id) {
			this.#formationId = null;
		}
		this.#playback.jump(r.sec, false);
	}

	/**
	 * 挪好站位了（拖縮圖、打站位時間，送到 ask 的 done）：提示改到哪（旁邊有「復原」）和走位被壓短的人，
	 * 選著這張，播放頭跳到新的站位時間。atEdge = 拖過頭停在邊界，提示多一句「已靠到邊界」。
	 */
	formationMoved(formationId: string, r: { sec: number; squeezed: string[] }, atEdge = false) {
		const flow = this.#flow;
		const index = flow?.formations.findIndex((f) => f.id === formationId) ?? -1;
		if (!flow || index < 1) return;
		const f = flow.formations[index];
		const names = r.squeezed.map((id) => flow.members.find((m) => m.id === id)?.name);
		const said = [
			`站位 ${index + 1} 改到 ${timeTextWithUnit(flow, f.segmentId!, { segmentId: f.segmentId!, at: f.at })}`,
			names.length && `走位被壓短：${names.join('、')}`,
			atEdge && AT_EDGE
		];
		this.#undoNotice(said.filter(Boolean).join('；'), '復原改站位時間');
		this.selectFormation(formationId);
		this.#playback.jump(r.sec, true);
	}

	/** 刪一張站位（縮圖的 ✕、Delete）：不問，提示「已刪掉站位 N」，旁邊有「復原」。 */
	removeFormation(formationId: string) {
		const flow = this.#flow;
		if (!flow) return;
		const number = flow.formations.findIndex((f) => f.id === formationId) + 1;
		this.ask.send(() => deleteFormation(flow, formationId), {
			done: () =>
				this.#undoNotice(
					formationId === this.#carriedInsertId
						? `已刪掉站位 ${number}；後面站位的改動還在，要整個還原按復原`
						: `已刪掉站位 ${number}`,
					'復原刪掉的站位'
				)
		});
	}

	/**
	 * 刪一個動作（Delete、表單的「刪除動作」）：有紀錄時 ask 先問（預設在場上問），確定才刪；
	 * 刪了提示「已刪掉動作 …」，旁邊有「復原」。
	 */
	removeAction(actionId: string, ask: Ask = this.ask) {
		const flow = this.#flow;
		const action = flow?.actions.find((a) => a.id === actionId);
		if (!flow || !action) return;
		// 按確定時用那時候的流程再送一次。
		ask.send((o: ConfirmOption = {}) => deleteAction(this.#flow ?? flow, actionId, o), {
			done: () => {
				this.selectAction(null);
				this.#undoNotice(`已刪掉動作 ${actionLabel(action)}`, '復原刪掉的動作');
			}
		});
	}

	/**
	 * Delete／Backspace：只刪最後點的那一個（站位或動作）。最後點的是人時不刪，提示要刪動作先點動作；
	 * 點了人又把人取消掉（最後點的沒了，之前選的動作還亮著）也一樣不刪、提示。
	 * 回傳有沒有處理（頁面拿來 preventDefault）。
	 */
	deleteKey(): boolean {
		if (this.#picked === 'formation' && this.#formationId) this.removeFormation(this.#formationId);
		else if (this.#picked === 'action' && this.#actionId) this.removeAction(this.#actionId);
		else if (this.#memberIds.length || this.#actionId || this.#formationId) this.notice = PICK_ACTION_FIRST;
		else return false;
		return true;
	}

	// ---------- 選取 ----------

	get selectedFormationId(): string | null {
		return this.#formationId;
	}

	get selectedActionId(): string | null {
		return this.#actionId;
	}

	/** 選到的動作；沒選是 null。 */
	get selectedAction(): Action | null {
		return (this.#actionId && this.#flow?.actions.find((a) => a.id === this.#actionId)) || null;
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
		this.#pick('formation', !!id);
		this.#updated();
	}

	/** 選動作：站位的選取清掉。換了動作，選的拍從頭來。 */
	selectAction(id: string | null) {
		const changed = id !== this.#actionId;
		this.#actionId = id;
		if (id) this.#formationId = null;
		this.#pick('action', !!id);
		if (changed) this.beats.reset();
		this.#updated();
	}

	selectMembers(ids: string[]) {
		this.#memberIds = ids;
		this.#pick('member', ids.length > 0);
		this.#updated();
	}

	/** 選了（on）就記成最後點的這一種；清掉的剛好是最後點的那一種，就變成沒有。 */
	#pick(kind: PickKind, on: boolean) {
		if (on) this.#picked = kind;
		else if (this.#picked === kind) this.#picked = null;
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
		this.#picked = null;
		this.#updated();
	}

	// ---------- 分組 ----------

	/** 選到的動作有環節、要分組（騰翻、跳躍以外）：場上出現組號小圓和分組浮動列。 */
	get groupingAction(): Action | null {
		const a = this.selectedAction;
		return a && groupsPeople(a) ? a : null;
	}

	/** 選到的人裡、在分組動作裡的。 */
	get squadPicked(): string[] {
		const action = this.groupingAction;
		return action ? this.#memberIds.filter((id) => action.members.some((m) => m.memberId === id)) : [];
	}

	/**
	 * 把選的人放進第 n 組（最多到新的一組），0 移出組；數字鍵和分組浮動列的號碼、「＋」「✕」都叫它。
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
