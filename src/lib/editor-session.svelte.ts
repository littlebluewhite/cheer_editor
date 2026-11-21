// 編輯 session：編輯頁的流程、復原、選取、提示、場上那一個問題、分組。編輯器 module（#lib/editor.svelte.js）建一個，
// 跟它一起放進 context 給元件；也可以單獨建來測。不碰瀏覽器（開檔、存檔、草稿在編輯器 module 的流程檔），所以在 Node 就測得到。
// 播放在編輯器 module：建 session 時接上（SessionPlayback），換了流程、改完要跳播放頭時 session 直接叫它。

import { createContext } from 'svelte';
import {
	actionWhy,
	applyRemoteChange,
	changeLabel,
	currentFormation,
	formationTimes,
	groupsPeople,
	joinUndo,
	lostBookmarks,
	redoRecords,
	sameFlow,
	squadsOf,
	timeWhy,
	travelChange,
	undoChanges,
	undone,
	undoRecords,
	type Action,
	type Command,
	type CommandName,
	type CommandOutcome,
	type Flow,
	type Mark,
	type MoveResult,
	type Period,
	type Position,
	type PracticeKind,
	type RemoteChange,
	type UndoChanges,
	type WhyParam
} from '#lib/core';
import { Ask, newStepId, type Handlers, type SentStep } from '#lib/ask.svelte.js';
import { Flash, UNDO_FLASH_MS } from '#lib/flash.svelte.js';
import { m } from '#lib/paraglide/messages.js';
import { ALL_ALLOWED, type PracticeRights } from '#lib/practice-rights.js';
import { whyText, joinText } from '#lib/reason-text.js';
import { both, KEYS } from '#lib/shortcuts.js';
import { BeatSelection } from './beat-selection.svelte.js';

const UNDO_LIMIT = 100;

/** 幾句提示接成一則（中文用「；」）。parts 不能是空的。 */
export const joinNotes = (parts: string[]): string => parts.reduceRight((rest, first) => m.session_notes({ first, rest }));

/** 幾個完整的句子接成一段（中文直接接，英文中間空一格）。parts 不能是空的。 */
export const joinSentences = (parts: string[]): string => parts.reduceRight((rest, first) => m.session_sentences({ first, rest }));

/** 沒存進去的一次（練習畫面紅條下面的表一列）：日期、動作、組（或隊員）、記號，全上記的標出來。 */
export interface DroppedRecord {
	id: string;
	date: string;
	action: string;
	who: string;
	marks: string;
	runThrough: boolean;
	/** 為什麼沒存進去（#262：「王教練已經記了這次全上的第 2 組」）；沒寫是教練改了流程。 */
	note?: string;
	/**
	 * 動作、組（或隊員）、原因的代號：畫面照現在的語言寫（droppedTexts，ADR 0017）。上面寫好的字（當時的語言）照樣存，
	 * 給還沒更新的分頁看；舊版存的沒有這一欄，照寫好的字。
	 */
	why?: { action: WhyParam; who: WhyParam; note?: AlreadyRecorded };
}

/** 同一次全上的同一組別人先存了：先記的人（null 是沒有名字的，寫「別人」）、哪一組（null 是「這一組」）。 */
export interface AlreadyRecorded {
	by: string | null;
	which: WhyParam | null;
}

/** 「只改這張」跟往後帶的那一步合成一步復原用的 key。 */
const ONLY_THIS = 'only-this';

/**
 * 復原、重做紀錄的一步：那一步改了什麼（例：「插入站位 3」）。
 * 本機流程存改之前的流程（flow）和改之後的流程（after）：復原時才算得出這一步清掉了哪些紀錄、加回去（ADR 0007）。
 * 雲端流程（#256）不存整份，存那一步改到的東西改之前、改之後的樣子（changes），和送出去的步驟 id（ids，方向鍵合成的有好幾個）；
 * 復原過的還存復原前畫面上的清單順序（shown，重做時加回來的照這裡的位置放）。
 */
type Step = { label: string } & (
	| { flow: Flow; after: Flow }
	| { ids: string[]; changes: UndoChanges; shown?: RemoteChange['orders'] }
);

/**
 * 本機流程復原、重做過的一步，改之前、改之後換成剛剛真的換上的兩份：中間用「記」刪掉、改過的紀錄，
 * 下次重做、復原照這兩份算，不會拿最早存的紀錄蓋回去（ADR 0007）。
 */
const replayed = (step: Step & { flow: Flow }, flow: Flow, after: Flow): Step => ({ ...step, flow, after });

/**
 * 雲端流程送伺服器的一步（交給 onstep）：一串指令，或復原、重做（#256）：
 * of 是要復原的那一步的步驟 id（重做是復原那一步的），change 是要放回去的樣子。
 */
export type CloudStep = SentStep | { id: string; undo: { of: string; redo: boolean; change: RemoteChange } };

/** 選得到的三種東西：站位、動作、人。 */
type PickKind = 'formation' | 'action' | 'member';


/** session 叫的播放（編輯器 module 建 session 時接上；session 單獨測的時候可以不接）。 */
export interface SessionPlayback {
	/** 換一支流程（開檔、新建、救回草稿、回首頁）。 */
	opened(): void;
	/** 換上改過、復原、重做的流程；before 是換之前的。 */
	changed(before: Flow): void;
	/** 改完要跳播放頭：跳到 sec；replay = 播放中從那裡重播。 */
	jump(sec: number, replay: boolean): void;
}

/** session 為什麼叫 updated：換了流程（open）、改（change）、記（record）、復原（undo）、重做（redo）、換了選取（select）。
 *  動作表單的草稿靠它分「復原掉剛新增的動作」和「剛新增的動作被刪掉」，不用猜（N20）。 */
export type UpdateReason = 'open' | 'change' | 'record' | 'undo' | 'redo' | 'select';

/**
 * 為什麼換上流程（#swap 的參數）：打開（open）、改（change）、記（record）、被退回（rejected）、別人改的（remote）、
 * 換成伺服器做出來的樣子（settle）、復原（undo）、重做（redo）。帶著只有那條路知道的（提示的字、是不是雲端的一步）。
 */
type Swap =
	| { why: 'open'; saved: boolean }
	| { why: 'change'; label: string }
	| { why: 'record' }
	| { why: 'rejected'; message: string }
	| { why: 'remote'; by: string }
	| { why: 'settle' }
	| { why: 'undo' | 'redo'; label: string; cloud: boolean };

/**
 * 跟著這支流程的畫面狀態：元件拆掉（切練習的頁、切編排和練習）再回來還在；換流程（open）整份重設。不存進流程檔。
 * 換流程就該重設的（時間軸、泳道的捲動、場地的放大）跟著編排區的 {#key} 重開；重開小窗就重設的由小窗打開時初始化。
 */
function freshView() {
	return {
		/** 練習畫面在哪一頁：記錄、總表。 */
		practicePage: 'record' as 'record' | 'summary',
		/** 記錄頁選到的動作；null（或它不在清單上了）是第一個。 */
		recordActionId: null as string | null,
		/** 總表的篩選：期間、練法、大字看成功率還是完成率。 */
		summary: { period: 'today' as Period, practice: 'all' as PracticeKind | 'all', rate: 'success' as 'success' | 'completion' },
		/** 記錄頁「每天的成功率」看哪一組（或人），key 是動作 id；沒有、空字串是全部。 */
		dailyWho: {} as Record<string, string>
	};
}

const NO_PLAYBACK: SessionPlayback = { opened() {}, changed() {}, jump() {} };

/** 提示旁邊的一個按鈕：label 是按鈕上的字，name 是唸給螢幕閱讀器的名字（沒給就是 label）；
 *  run 是按了做什麼，沒給就是按一次復原（頁面的復原，開著的段設定也跟著收）。 */
export interface NoticeButton {
	label: string;
	name?: string;
	run?: () => void;
}

export class EditorSession {
	readonly #playback: SessionPlayback;
	readonly #updated: (reason: UpdateReason) => void;
	#flow = $state.raw<Flow | null>(null);
	/** 上次存檔或開檔時的流程。指令都回傳新的流程，所以 flow 不是它就是有還沒存的修改。 */
	#saved = $state.raw<Flow | null>(null);
	/**
	 * 復原紀錄：每一步改之前、改之後的流程（最舊的在前）和那一步改了什麼（復原、重做的提示用）。
	 * 指令都回傳新的流程，所以存參照就好。不存進草稿或檔案。
	 */
	#undo = $state.raw<Step[]>([]);
	/** 重做紀錄：復原掉的那幾步（最近復原的在後）。做了新的一步就清掉。 */
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
	/** ⌘C 複製的站位（那時候大家的位置）；⌘V 貼到播放頭。不存進流程檔。 */
	#copied: Record<string, Position> | null = null;
	/**
	 * 檢視模式：只能看、只能播放。改流程的指令（場上、表單、Delete、復原、重做…）都擋下，說 session_view_only；
	 * 選取、播放照常。練習的紀錄（「記」）不算改編排，照記。
	 */
	viewing = $state(false);
	/**
	 * 畫面能不能出現改編排的控制項：檢視模式就不能。畫面只看這一個（不各自讀 viewing）：
	 * 只能編輯的控制項標 data-edit（編輯頁一條 CSS 藏起來），對話框給 readonly（內容整塊停用）。
	 */
	get editable(): boolean {
		return !this.viewing;
	}
	/**
	 * 記錄頁每張卡上次選的「這次練」，key 是「動作 id 組或隊員 id」：whole 整個做，不是就只練 picked 這幾個環節。
	 * 換動作、切頁（卡不見了）再回來還是它；換一支流程就清掉；不存進流程檔。
	 */
	drillScopes: Record<string, { whole: boolean; picked: string[] }> = $state({});
	/**
	 * 記錄頁每張卡點了還沒存的記號（環節 id → 記號），key 是 drillScopes 的 key 加上日期（一天一份）。
	 * 換動作、切頁再回來還在；換一支流程就清掉；不存進流程檔。
	 */
	drillMarks: Record<string, Record<string, Mark>> = $state({});
	/**
	 * 記錄頁一張卡（動作、組或隊員 who）這一天點了還沒存的記號：
	 * 不是這次要練的環節（在編排刪掉了、別天改成只練別的環節）的記號不算。卡上和左邊動作清單都看它標「還沒存」。
	 */
	unsavedMarks(action: Action, who: string, date: string): Record<string, Mark> {
		const scopeKey = `${action.id} ${who}`;
		const scope = this.drillScopes[scopeKey] ?? { whole: true, picked: [] };
		const phases = action.successRate?.phases ?? [];
		const whole = scope.whole || phases.length < 2;
		const planned = whole ? phases : phases.filter((p) => scope.picked.includes(p.id));
		const marks = this.drillMarks[`${scopeKey} ${date}`] ?? {};
		return Object.fromEntries(Object.entries(marks).filter(([id]) => planned.some((p) => p.id === id)));
	}
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
	/** 跟著這支流程的畫面狀態（freshView）。 */
	view = $state(freshView());
	/** 多選開著：場上點人、框選、點泳道名字、點動作表單裡的名字都是加進來或拿掉，跟按著 Shift 一樣（iPad 沒有 Shift）。 */
	multiSelect = $state(false);
	/**
	 * 雲端流程：改好的一步交給它送伺服器（#248），帶這一步改了什麼（changeLabel，被退回時的提示用，#254）
	 * 和改之前、改之後的流程（被退回時把這一步清掉的紀錄帶回來）。
	 * 復原、重做也交給它（#256）。接著它時不算未存，復原紀錄存改到的東西。本機流程是 null。
	 */
	onstep: ((step: CloudStep, label: string, before: Flow, after: Flow) => void) | null = null;
	/** 不能改的原因（例：有新版，請重新整理）：有的話改流程的指令都擋下說這句，比檢視模式優先。空字串是沒有。 */
	readOnly = $state('');
	/**
	 * 雲端流程：紀錄改了（記一次）交給它送伺服器（#257），給記之前、記之後的流程。本機流程是 null。
	 */
	onrecord: ((before: Flow, after: Flow) => void) | null = null;
	/** 練習的權限（能不能記、誰記的…）：本機流程都可以；雲端流程由 CloudSteps 給，換流程時換回都可以。 */
	practice = $state.raw<PracticeRights>(ALL_ALLOWED);
	/** 換上別的流程之後（開、改、記、復原、重做）叫：流程檔停手 1 秒存草稿。流程檔建好時接上。 */
	onflow: () => void = () => {};
	/** 拍點格子選的拍（選到的動作的）。 */
	readonly beats = new BeatSelection(() => this.selectedAction);

	/** 編輯器唯一的提示（編排、練習共用）：同時只有一則，新的取代舊的。 */
	#notice = new Flash<{ text: string; button?: NoticeButton }>();

	/** 提示（存檔、開檔的結果、被擋的原因、已存…），浮在場地或練習畫面上；過幾秒（換了一句就重算）或頁面看到下一個操作就收掉。 */
	get notice(): string {
		return this.#notice.value?.text ?? '';
	}

	set notice(text: string) {
		if (!text) this.#notice.clear();
		else if (text !== this.#notice.value?.text || this.#notice.value.button) this.#notice.show({ text });
	}

	/** 提示旁邊的按鈕（「復原」「救回」）；沒有是 null。換了提示就沒有。 */
	get noticeButton(): NoticeButton | null {
		return this.#notice.value?.button ?? null;
	}

	/** 「已做了・復原」：提示帶一個按鈕，留久一點（UNDO_FLASH_MS）。取代現在那一則。 */
	toast(text: string, button: NoticeButton) {
		this.#notice.show({ text, button }, UNDO_FLASH_MS);
	}

	/**
	 * 剛改的那一步要說的：change 換上 flow 時記下 label，提示「已＋label」，旁邊有「復原」（F 群）。
	 * 各處用 noteChange 補一句（例：往後帶了幾張）或換掉按鈕；流程又換了就不再補到它身上。
	 */
	#said: { flow: Flow; before: Flow; label: string; extra: string[]; button: NoticeButton } | null = null;

	/** 剛改的那一步的提示：「已＋label」加上補的話，旁邊是它的按鈕（預設「復原」）。 */
	#showSaid() {
		const { label, extra, button } = this.#said!;
		this.toast(joinNotes([m.session_done({ step: label }), ...extra]), button);
	}

	/**
	 * 剛改完那一步（還沒有別的改動）要多說一句：接在「已＋label」後面，button 換掉「復原」。
	 * 沒有剛改的那一步（例：拖 0 距離只碰到邊界）就只提示 text。
	 */
	noteChange(text: string, button?: NoticeButton) {
		const said = this.#said;
		if (!said || said.flow !== this.#flow) {
			if (text) this.notice = text;
			return;
		}
		if (text) said.extra.push(text);
		if (button) said.button = button;
		this.#showSaid();
	}

	/** 滑鼠在提示上：先不收（停住倒數）；移開了把剩下的時間走完。 */
	holdNotice(on: boolean) {
		this.#notice.hold(on);
	}

	/**
	 * 場上那一個問題：拖色條、走位條、挪站位、Delete 刪動作都送到這裡。要問就畫在場上，
	 * 被擋的原因（拖的加「，已還原」）放進提示。成功就算一步（提示換成「已…」，改成一樣的就收掉）。
	 */
	readonly ask = new Ask(
		(f, step) => {
			if (!this.change(f, this.#joining ?? undefined, undefined, step)) this.notice = '';
		},
		{
			confirmLabel: m.session_confirm(),
			onfail: (error) => (this.notice = error),
			locked: () => this.#locked(),
			flow: () => this.#flow
		}
	);

	/** 分組浮動列的問題（換組會動到紀錄時）：畫在浮動列上。數字鍵也送到這裡。 */
	readonly squadAsk = new Ask((f, step) => this.change(f, undefined, undefined, step), { locked: () => this.#locked(), flow: () => this.#flow });

	/** 改流程鎖著的原因：不能改的原因（readOnly）、檢視模式是 session_view_only，編輯是空字串。 */
	#locked(): string {
		return this.readOnly || (this.viewing ? m.session_view_only() : '');
	}

	/**
	 * 給的流程算存過的（跟從檔案開的一樣）。playback：改完要叫的播放。
	 * updated：換了流程或選取之後要叫的，帶著為什麼（編輯器 module 接上：動作表單的草稿跟上）。
	 */
	constructor(
		flow: Flow | null = null,
		playback: SessionPlayback = NO_PLAYBACK,
		updated: (reason: UpdateReason) => void = () => {}
	) {
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

	/** 按復原會退的那一步改了什麼（例：「插入站位 2」）；沒有可以復原的是空字串。 */
	get undoLabel(): string {
		return this.#undo.at(-1)?.label ?? '';
	}

	/** 按重做會做回的那一步改了什麼；沒有可以重做的是空字串。 */
	get redoLabel(): string {
		return this.#redo.at(-1)?.label ?? '';
	}

	/**
	 * 換一支流程（開檔、新建、救回草稿；null 是回到首頁）：清掉復原和重做、選取、提示、問題。
	 * id 會跟上一支重複，所以選取和複製的站位全部清掉。saved = 從檔案開的，算存過。
	 */
	open(flow: Flow | null, saved = false) {
		this.#swap(flow, { why: 'open', saved });
	}

	/** 存好了：存的是 flow 這一份。 */
	markSaved(flow: Flow) {
		this.#saved = flow;
	}

	/**
	 * 「改」：算復原的一步（拖人連帶插站位、往後帶也只呼叫一次）。清掉重做。
	 * 改之前和改之後內容一樣（例：拖 0 距離、在段尾插入八拍）不算：不換流程、不清重做。
	 * 給了 join：上一步也是同一個 join、中間沒有別的改動，就跟上一步合成一步。
	 * label：復原、重做提示寫的（例：「插入八拍」）；沒給就比對改了什麼（changeLabel）。
	 * 換上了就提示「已＋label」，旁邊有「復原」：能復原的都有提示，各處只用 noteChange 補話（F 群）。
	 * 回傳有沒有換上新的流程。step：這一步送了什麼（雲端流程交給 onstep 送伺服器）。
	 */
	change(flow: Flow, join?: string, label?: string, step?: SentStep): boolean {
		if (!this.#flow || sameFlow(flow, this.#flow)) return false;
		const before = this.#flow;
		const joined = join !== undefined && this.#joinable?.key === join && this.#joinable.flow === this.#flow;
		const last = joined ? this.#undo.at(-1) : undefined;
		let undoStep: Step | null = null;
		if (this.onstep) {
			// 雲端流程：送伺服器（存好了由它說）；復原紀錄存改到的東西（#256），合成一步的照第一步之前到現在
			const said = label ?? whyText(changeLabel(before, flow));
			if (step) this.onstep(step, said, before, flow);
			const changes = undoChanges(before, flow);
			if (step && last && 'ids' in last) undoStep = { label: said, ids: [...last.ids, step.id], changes: joinUndo(last.changes, changes) };
			else if (step) undoStep = { label: said, ids: [step.id], changes };
		} else {
			// 合成一步的：說的是從合之前到現在改了什麼
			const from = last && 'flow' in last ? last.flow : before;
			undoStep = { flow: from, after: flow, label: label ?? whyText(changeLabel(from, flow)) };
		}
		if (undoStep) {
			this.#undo = (last ? [...this.#undo.slice(0, -1), undoStep] : [...this.#undo, undoStep]).slice(-UNDO_LIMIT);
			this.#joinable = join !== undefined ? { key: join, flow } : null;
			this.#redo = [];
		}
		this.#swap(flow, { why: 'change', label: undoStep?.label ?? label ?? whyText(changeLabel(before, flow)) });
		return true;
	}

	/**
	 * 「記」：紀錄改了（記一次、刪掉上一次、記一次全上）。不算復原的一步，不清重做。
	 * 復原、重做換上的流程都帶著現在的紀錄（本機流程：undoRecords、redoRecords）。雲端流程交給 onrecord 送伺服器。
	 */
	record(flow: Flow) {
		const before = this.#flow;
		if (!before) return;
		this.serverRecords(flow);
		this.onrecord?.(before, flow);
	}

	/** 換上伺服器送來的紀錄（雲端流程：別人記的、伺服器存的樣子、沒存進去的拿掉）：跟「記」一樣不算一步，不再送伺服器。 */
	serverRecords(flow: Flow) {
		if (!this.#flow) return;
		this.#swap(flow, { why: 'record' });
	}

	/**
	 * 給元件一個「改」的問題：成功就交給 change（算一步）。onfail：沒成功之後（例：原因放進提示）。
	 * label：這個問題改的，復原、重做提示都寫它（例：「插入八拍」）；沒給就比對改了什麼。
	 */
	changeAsk({ label, ...options }: { confirmLabel?: string; onfail?: (error: string) => void; label?: string } = {}): Ask {
		const ask = new Ask((f, step) => this.change(f, undefined, label, step), {
			...options,
			locked: () => this.#locked(),
			flow: () => this.#flow
		});
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

	/**
	 * 頁面按 Esc：開著的「改」的問題都按取消（跟在確認框裡按 Esc 一樣，會還原的照樣還原）。回傳有沒有收掉問題
	 * （有的話這一下 Esc 就用掉了，不再清選取，N18）。
	 */
	cancelQuestion(): boolean {
		const asks = [this.ask, this.squadAsk, ...[...this.#changeAsks].map((ref) => ref.deref())];
		const open = asks.filter((ask) => !!ask?.question);
		for (const ask of open) ask!.answer('cancel');
		return open.length > 0;
	}

	/** 換掉流程、關分頁就會不見的：有還沒存的修改，或改了還在等教練回答（例：改名後還沒選保留或清掉）。 */
	get unsavedOrAsking(): boolean {
		return this.unsaved || this.questionOpen;
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
		return new Ask((f) => this.record(f), { locked: () => this.practice.cannotRecord, flow: () => this.#flow });
	}

	/**
	 * 換成伺服器上的樣子（雲端流程的一步被退回）：不算一步，選取修剪、問題收掉，原因放進提示
	 * （改段連帶拿掉了書籤，接在原因後面說）。
	 */
	reset(flow: Flow, message: string) {
		if (!this.#flow) return;
		this.#swap(flow, { why: 'rejected', message });
	}

	/**
	 * 套上別人的改動（雲端流程，#253）：by 是改的人的名字。不算一步，開著的表單、問題都不收；
	 * 選著的東西被刪了就不再選著；在改的動作（動作表單開著的）被刪了，表單回到新增並說原因。
	 */
	applyRemote(change: RemoteChange, by: string) {
		if (!this.#flow) return;
		this.#swap(applyRemoteChange(this.#flow, change), { why: 'remote', by });
	}

	/**
	 * 換上伺服器做出來的樣子（雲端流程自己的一步收了，伺服器跑出來的跟這邊不一樣，例：兩個人同時加隊員，
	 * 後到的被放在別的位置）：跟 applyRemote 一樣不算一步，開著的表單、問題都不收。一樣的不換。
	 * 改段連帶拿掉了書籤就說拿掉了哪個。
	 */
	settle(flow: Flow) {
		if (!this.#flow || sameFlow(flow, this.#flow)) return;
		this.#swap(flow, { why: 'settle' });
	}

	/**
	 * 雲端流程自己的一步收了：復原紀錄裡那一步的重做換成伺服器做出來的改動（change），不是這邊畫面上的
	 * （例：兩個人同時加隊員，後到的被放在別的位置；照畫面上的重做會跟別人加的人疊在一起）。合成一步的，最後一步收了才換。
	 * 順序照畫面上的：伺服器的順序裡有別人加的，照它重做會把別人後來調的順序調回去。
	 */
	acceptedAs(stepId: string, change: RemoteChange) {
		const redo = { things: change.things, orders: {} };
		const fix = (s: Step): Step =>
			'ids' in s && s.ids.at(-1) === stepId
				? { ...s, changes: joinUndo(s.changes, { undo: { things: [], orders: {} }, redo }) }
				: s;
		this.#undo = this.#undo.map(fix);
	}

	/** 套上別人的改動之後叫（頁面接上：開著的段設定指到被刪掉的段就關掉）。回傳要說的原因，跟書籤的提示併在一起。 */
	onremote: (flow: Flow, by: string) => string | void = () => {};

	/**
	 * 復原：換上前一份編排，帶著現在的紀錄，這一步清掉的紀錄加回來（本機流程，ADR 0007），提示「已復原：…」。
	 * 回傳有沒有復原（檢視模式擋下，說原因）。
	 */
	undo(): boolean {
		return this.#travel(false);
	}

	/**
	 * 重做：換上復原掉的編排，帶著現在的紀錄，這一步清掉的紀錄再清一次，提示「已重做：…」。
	 * 回傳有沒有重做（檢視模式擋下，說原因）。
	 */
	redo(): boolean {
		return this.#travel(true);
	}

	/**
	 * 復原（redo 是重做）：拿走這一邊最後一步、放進另一邊。本機流程換上存著的流程。
	 * 雲端流程（#256）把那一步改到的東西放回改之前（重做是改之後）的樣子，畫面先改，再當成新的一步送伺服器
	 * （of 是那一步的步驟 id，方向鍵合成的是第一個）；另一邊記下這次送的步驟 id。
	 */
	#travel(redo: boolean): boolean {
		if (this.#blocked()) return false;
		const from = redo ? this.#redo : this.#undo;
		const step = from.at(-1);
		if (!this.#flow || !step) return false;
		const before = this.#flow;
		let back: Step;
		let flow: Flow;
		if ('flow' in step) {
			// 本機流程：換上改之前（重做是改之後）的編排，帶著現在的紀錄；這一步清掉的紀錄加回來，重做再清一次（ADR 0007）
			flow = redo ? redoRecords(step.flow, step.after, before) : undoRecords(step.flow, step.after, before);
			back = redo ? replayed(step, before, flow) : replayed(step, flow, before);
		} else {
			const id = newStepId();
			const { undo, redo: again } = step.changes;
			const change = travelChange(before, step.changes, redo, redo ? (step.shown ?? again.orders) : undo.orders);
			back = { label: step.label, ids: [id], changes: step.changes };
			// 復原：記下復原前畫面上的順序（重做時加回來的照這裡的位置放）
			if (!redo) back.shown = Object.fromEntries(Object.keys(again.orders).map((list) => [list, idsOf(before, list)]));
			flow = undone(before, change);
			this.onstep?.({ id, undo: { of: step.ids[0], redo, change } }, step.label, before, flow);
		}
		const to = [...(redo ? this.#undo : this.#redo), back];
		if (redo) [this.#undo, this.#redo] = [to, from.slice(0, -1)];
		else [this.#undo, this.#redo] = [from.slice(0, -1), to];
		this.#swap(flow, { why: redo ? 'redo' : 'undo', label: step.label, cloud: !('flow' in step) });
		return true;
	}

	/** 雲端流程的步被退回（#256）：那幾步（步驟 id）不算，從復原、重做紀錄拿掉。 */
	dropSteps(ids: string[]) {
		const dropped = (s: Step) => 'ids' in s && s.ids.some((id) => ids.includes(id));
		this.#undo = this.#undo.filter((s) => !dropped(s));
		this.#redo = this.#redo.filter((s) => !dropped(s));
		this.#joinable = null;
	}

	/** 鎖著（檢視模式）：原因放進提示，回傳 true。 */
	#blocked(): boolean {
		const locked = this.#locked();
		if (locked) this.notice = locked;
		return !!locked;
	}

	/**
	 * 方向鍵移人：跟場上的問題一樣送出去（指令名字＋參數），成功時連續同一個 key（同一批人、同一拍）、
	 * 中間沒有別的改動，就合成復原的一步。
	 */
	nudge<N extends CommandName>(key: string, command: Command<N>, handlers?: Handlers<CommandOutcome<N>>): CommandOutcome<N> {
		this.#joining = key;
		try {
			return this.ask.send(command, handlers);
		} finally {
			this.#joining = null;
		}
	}

	/**
	 * 換上流程只有這一個出口（#308 階段 1）。七條路（打開、改、記、被退回、別人改的、換成伺服器的樣子、復原／重做）
	 * 做完自己那條的事（復原紀錄、送伺服器）就交給它換上；後果在這裡一次算完：算不算存過、選取修剪、問題收不收、
	 * 播放要不要重排、在改的動作被刪了沒、哪些書籤因為段改了而不見，提示在這裡組一次。
	 * 不管：復原紀錄怎麼記、送不送伺服器（各條路叫它之前自己做完）。
	 */
	#swap(flow: Flow | null, swap: Swap) {
		const before = this.#flow;
		const editing = this.selectedAction;
		const { why } = swap;
		this.#flow = flow;
		if (why === 'open') {
			// 換一支流程：跟上一支有關的全部清掉（id 會跟上一支重複）；從檔案開的算存過
			this.#saved = swap.saved ? flow : null;
			this.#undo = [];
			this.#redo = [];
			this.#joinable = null;
			this.practice = ALL_ALLOWED;
			this.#copied = null;
			this.clearSelection();
			this.drillMarks = {};
			this.drillScopes = {};
			this.view = freshView();
			this.notice = '';
			this.#clearAsks();
			this.#playback.opened();
			this.onflow();
			this.#updated('open');
			return;
		}
		if (!before || !flow) return;
		// 雲端流程換上的都存在伺服器（記的紀錄、改、復原重做看是不是雲端的）：不算還沒存
		const stored =
			why === 'record' ? this.practice.sharedRecords : why === 'change' ? !!this.onstep : why === 'undo' || why === 'redo' ? swap.cloud : true;
		if (stored) this.#saved = flow;
		if (why === 'record') {
			// 記：只換紀錄，選取、問題、播放、提示都不動
			this.onflow();
			this.#updated('record');
			return;
		}

		const restored = why === 'rejected' || why === 'undo' || why === 'redo';
		if (restored) {
			this.#joinable = null;
			this.#carriedInsertId = null;
		}
		this.#trim(flow);
		// 問題：改只收場上那一個；被退回、復原、重做全收（問的是換掉之前的流程）；別人改的、伺服器的樣子不收
		if (why === 'change') this.ask.clear();
		else if (restored) {
			this.#clearAsks();
			// 先收掉：下面說的跟現在的一樣也重新算時間
			this.notice = '';
		}
		this.#playback.changed(before);
		if (restored) {
			// 選到的站位還在、站位時間換了（復原、重做挪站位）：播放頭跟到它的時間，接著拖人才不會多插一張
			const sec = (f: Flow) => formationTimes(f).find((t) => t.formation.id === this.#formationId)?.sec;
			const now = sec(flow);
			if (now !== undefined && now !== sec(before)) this.#playback.jump(now, false);
		}
		this.onflow();
		this.#updated(why === 'undo' || why === 'redo' ? why : 'change');

		// 提示：改段連帶拿掉的書籤每條路都說（不會悄悄不見）
		const lost = lostText(before, flow);
		if (why === 'change') {
			this.#said = {
				flow,
				before,
				label: swap.label,
				extra: lost ? [lost] : [],
				button: { label: m.session_undo(), name: m.session_undo_step({ step: swap.label }) }
			};
			this.#showSaid();
		} else if (why === 'undo' || why === 'redo') {
			this.notice = joinNotes([(why === 'redo' ? m.session_redid : m.session_undid)({ step: swap.label }), ...(lost ? [lost] : [])]);
		} else if (why === 'rejected') {
			// 退回原因在前（補不上時是原本的提示，可能是空的），書籤那句在後
			const said = [swap.message, lost].filter((t): t is string => !!t);
			this.notice = said.length ? joinNotes(said) : '';
		} else if (why === 'remote') {
			const { by } = swap;
			const closed = this.onremote(flow, by);
			// 頁面關掉的東西、在改的動作被刪了、改段連帶拿掉了書籤：都要說
			const said = [
				closed || null,
				editing && !this.#actionId ? m.session_remote_deleted_action({ by, action: whyText(actionWhy(editing)) }) : null,
				lost ? m.session_remote_changed_segments({ by, what: lost }) : null
			].filter((t) => t !== null);
			if (said.length) this.notice = joinNotes(said);
		} else if (lost) {
			// 換成伺服器做出來的樣子：只說書籤那句
			this.notice = lost;
		}
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
	 * 拖人、選人工具列、貼上站位改好了（送到 ask 的 done）：「已插入站位 N」「已改站位 N」後面補插了站位的位置從哪來、
	 * 往後帶了幾張，播放頭停到改的那張。有往後帶：提示旁邊放「只改這張」（見 #onlyThis）。
	 * 選項 atEdge：拖過頭停在邊界，多一句「已靠到邊界」。pasted：⌘V 貼上的（插的站位是貼上的位置，不是自動帶入，N46）。
	 */
	moved(r: MoveResult, { atEdge = false, pasted = false }: { atEdge?: boolean; pasted?: boolean } = {}) {
		const parts: (string | false | 0)[] = [
			pasted ? m.session_pasted() : r.inserted && m.session_auto_inserted(),
			r.carried > 0 && (r.carried === 1 ? m.session_carried_one : m.session_carried)({ count: r.carried }),
			atEdge && m.session_at_edge()
		];
		const said = parts.filter((x): x is string => !!x);
		const text = said.length ? joinNotes(said) : '';
		const after = this.#flow;
		const before = this.#said?.flow === after ? this.#said.before : null;
		const onlyThis =
			r.carried > 0 && after && before ? { label: m.session_only_this(), run: () => this.#onlyThis(after, before, r.sec) } : undefined;
		this.noteChange(text, onlyThis);
		this.#carriedInsertId =
			r.inserted && r.carried > 0 && this.#flow ? currentFormation(this.#flow, r.sec).formation.id : null;
		// 選著的縮圖不是剛改的那張：選取清掉，不然 Delete 會刪到眼睛沒在看的那張
		if (this.#formationId && this.#flow && this.#formationId !== currentFormation(this.#flow, r.sec).formation.id) {
			this.#formationId = null;
		}
		this.#playback.jump(r.sec, false);
	}

	/**
	 * 「只改這張」：剛才往後帶改到的站位（sec 那張之後的）改回這一步之前（before）的位置，跟那一步合成一步復原。
	 * after 是往後帶完的流程；流程已經換了（中間有別的改動）就不做。送的是指令（setPositions），雲端流程照樣送伺服器。
	 */
	#onlyThis(after: Flow, before: Flow, sec: number) {
		if (this.#blocked() || this.#flow !== after) return;
		const at = after.formations.indexOf(currentFormation(after, sec).formation);
		const commands: Command<'setPositions'>[] = after.formations.flatMap((f, i) => {
			const old = i > at && before.formations.find((b) => b.id === f.id);
			return old && old.pos !== f.pos ? [{ name: 'setPositions' as const, args: [f.id, old.pos] as [string, Record<string, Position>] }] : [];
		});
		if (!commands.length) return;
		this.#joinable = { key: ONLY_THIS, flow: after };
		this.#joining = ONLY_THIS;
		try {
			this.ask.send(commands, {
				done: () => {
					this.#carriedInsertId = null;
					this.noteChange(m.session_only_this_done());
				}
			});
		} finally {
			this.#joining = null;
		}
	}

	/**
	 * 挪好站位了（拖縮圖、打站位時間，送到 ask 的 done）：「已改站位 N」後面補改到哪和走位被壓短的人，
	 * 選著這張，播放頭跳到新的站位時間。atEdge = 拖過頭停在邊界，提示多一句「已靠到邊界」。
	 */
	formationMoved(formationId: string, r: { sec: number; squeezed: string[] }, atEdge = false) {
		const flow = this.#flow;
		const index = flow?.formations.findIndex((f) => f.id === formationId) ?? -1;
		if (!flow || index < 1) return;
		const f = flow.formations[index];
		const names = r.squeezed.map((id) => flow.members.find((m) => m.id === id)?.name);
		const parts: (string | false | 0)[] = [
			m.session_moved_to({ at: whyText(timeWhy(flow, f.segmentId!, { segmentId: f.segmentId!, at: f.at })) }),
			names.length && m.session_squeezed({ names: joinText(names.map((n) => n ?? '')) }),
			atEdge && m.session_at_edge()
		];
		const said = parts.filter((x): x is string => !!x);
		this.noteChange(joinNotes(said));
		this.selectFormation(formationId);
		this.#playback.jump(r.sec, true);
	}

	/** 刪一張站位（縮圖的 ✕、Delete）：不問，提示「已刪站位 N」，旁邊有「復原」。 */
	removeFormation(formationId: string) {
		const flow = this.#flow;
		if (!flow) return;
		this.ask.send({ name: 'deleteFormation', args: [formationId] }, {
			done: () => {
				if (formationId === this.#carriedInsertId) this.noteChange(m.session_carried_kept());
			}
		});
	}

	/**
	 * 刪一個動作（Delete、表單的「刪除動作」）：有紀錄時 ask 先問（預設在場上問），確定才刪；
	 * 刪了提示「已刪動作 …」，旁邊有「復原」；清掉了紀錄就寫幾次、按復原會回來（N25）。
	 */
	removeAction(actionId: string, ask: Ask = this.ask) {
		const flow = this.#flow;
		const action = flow?.actions.find((a) => a.id === actionId);
		if (!flow || !action) return;
		// 按確定時用那時候的流程再送一次。
		ask.send({ name: 'deleteAction', args: [actionId] }, {
			done: () => {
				// 刪之前（這一步的改之前）那個動作的紀錄
				const was = this.#said?.before.actions.find((a) => a.id === actionId);
				const records = was?.successRate?.records.length ?? 0;
				this.selectAction(null);
				if (records) this.noteChange((records === 1 ? m.session_records_cleared_one : m.session_records_cleared)({ count: records }));
			}
		});
	}

	/**
	 * Delete／Backspace：只刪最後點的那一個（站位或動作）。最後點的是人時不刪，提示 Delete 不刪人、要刪的先點；
	 * 點了人又把人取消掉（最後點的沒了，之前選的動作還亮著）也一樣不刪、提示。
	 * 回傳有沒有處理（頁面拿來 preventDefault）。
	 */
	deleteKey(): boolean {
		if (this.#picked === 'formation' && this.#formationId) this.removeFormation(this.#formationId);
		else if (this.#picked === 'action' && this.#actionId) this.removeAction(this.#actionId);
		else if (this.#memberIds.length || this.#actionId || this.#formationId) this.notice = m.session_pick_to_delete();
		else return false;
		return true;
	}

	/** ⌘C：最後點的是站位卡片就複製它（大家的位置），提示怎麼貼。回傳有沒有處理。 */
	copyFormation(): boolean {
		const index = this.#flow?.formations.findIndex((f) => f.id === this.#formationId) ?? -1;
		if (this.#picked !== 'formation' || index < 0) return false;
		this.#copied = this.#flow!.formations[index].pos;
		this.notice = m.session_copied({ n: index + 1, keys: both(KEYS.paste) });
		return true;
	}

	/**
	 * ⌘V：播放頭（sec）那一拍的站位改成複製的那張，沒有站位就插一張；跟拖人一樣往後帶、算一步復原（moveGroup）。
	 * 複製之後才加的人沒有位置，不動；複製的人都刪掉了就不貼，提示一聲。回傳有沒有處理（沒複製過就沒有）。
	 */
	pasteFormation(sec: number): boolean {
		const copied = this.#copied;
		const flow = this.#flow;
		if (!copied || !flow) return false;
		const ids = flow.members.map((m) => m.id).filter((id) => copied[id]);
		if (!ids.length) {
			this.notice = m.session_paste_gone();
			return true;
		}
		this.ask.send({ name: 'moveGroup', args: [sec, Object.fromEntries(ids.map((id) => [id, copied[id]]))] }, {
			done: (r) => this.moved(r, { pasted: true })
		});
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
		this.#updated('select');
	}

	/** 選動作：站位的選取清掉。換了動作，選的拍從頭來。 */
	selectAction(id: string | null) {
		const changed = id !== this.#actionId;
		this.#actionId = id;
		if (id) this.#formationId = null;
		this.#pick('action', !!id);
		if (changed) this.beats.reset();
		this.#updated('select');
	}

	selectMembers(ids: string[]) {
		this.#memberIds = ids;
		this.#pick('member', ids.length > 0);
		this.#updated('select');
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
		this.#updated('select');
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
		this.squadAsk.send({ name: 'setSquad', args: [action.id, ids, n === 0 ? null : n] });
		return true;
	}
}

/** 改段（刪段、換順序、縮短…）連帶拿掉的書籤（流程核心 lostBookmarks），提示要說的那一句；沒有是 null。 */
function lostText(before: Flow, after: Flow): string | null {
	const lost = lostBookmarks(before, after);
	if (!lost.length) return null;
	const names = lost.map((b) => m.session_quoted({ name: b.name })).reduceRight((rest, first) => m.session_quoted_list({ first, rest }));
	return (lost.length === 1 ? m.session_lost_bookmarks_one : m.session_lost_bookmarks)({ names });
}

/** 清單的 id 順序。 */
const idsOf = (flow: Flow, list: string) => (flow[list as keyof RemoteChange['orders']] as { id: string }[]).map((x) => x.id);

/** 頁面放進 context、元件拿出來用的 session。has：有沒有放（場地在八拍表上只畫、不編）。 */
export const [getEditorSession, setEditorSession, hasEditorSession] = createContext<EditorSession>();
