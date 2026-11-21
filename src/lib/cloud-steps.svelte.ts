// 雲端流程一步一步存（#248，ADR 0010、0014）：流程檔打開雲端流程時建一個，換流程就關掉。
// 連這支流程的房間，先打招呼（指紋、分頁 id、上次看到第幾步、在編輯還是檢視）。session 改好的一步交給它（session.onstep）：
// 畫面先改、不等伺服器；一次送一步，伺服器收了才送下一步。
// 被退回：還沒送的步一起不要，畫面換成伺服器的樣子，原因放進提示。指紋不一樣：有新版，請重新整理，先不能改。
// 權限（#250）：記錄者、檢視者只能看；被降級馬上換檢視模式、還沒送到的步不算並提示；被收回叫 onrevoked（回首頁）。
// 別人的改動（#253）：伺服器送來改好的東西，套在自己的畫面上（session.applyRemote），不關掉開著的表單。
// 誰開著（#253）：伺服器說的在場名單（自己不列）；換編輯、檢視模式就告訴伺服器（setEditing）。
// 擁有者刪了這支（#252）：叫 ondeleted（回首頁並說原因）。
// 改到同一個東西（#254）：被退回時伺服器說最後改到的人（by），提示寫「王教練剛改了同一個地方，你的「改流程名字」沒改成」，
// 被規則擋下再加上原因。
// 斷線（#255）：房間自己重連。斷線時不能改（跟檢視模式一樣），還沒送到的步只留在這個分頁；連上重新打招呼，
// 伺服器先補上斷線期間別人的改動（補不上就給現在的樣子），再說可以送步，這時把還沒送到的步再送（步驟 id 擋重複）。
// 每一步帶它做的時候看到第幾步：補上的別人的改動不會讓伺服器以為我看過了。
// 復原、重做（#256）：session 交來的復原也是一步（送要放回去的樣子），照順序送；被退回時伺服器說完整的原因
// （例：「王教練後來改過，這步不能復原」）。被退回、沒送到的步從復原、重做紀錄拿掉（session.dropSteps）。
// 成功率紀錄（#257，ADR 0011）：記一次（session 的「記」交給 onrecord）把新的那幾次送進同一個房間，不算一步。
// 伺服器回收了的（換成伺服器存的樣子）和沒存進去的（從畫面拿掉，列進紅條的表，按「知道了」才清）；
// 別人記的馬上放進畫面，記號後面寫名字。檢視者不能記。
// 練習的權限（#318，practice）是這裡的：能不能記、誰記的、只看自己的、沒存進去的、還沒傳的都在這裡改，打開時交給 session，關掉時換回都可以。
// 改、刪、救回（#258）也從這裡送；伺服器回那幾次現在的樣子（記錄者動別人的不算，換回來）。別人改的、刪的，
// 別人的一步跟著改、清掉的紀錄，馬上換掉。記錄者只能改、刪自己記的（練習的權限 ownRecordsOnly）。伺服器的樣子（退回、權限改了）不帶紀錄，換上時帶著現在的紀錄，沒算的步清掉的帶回來。
// 連上、連回來時（#255）伺服器也給現在的紀錄：拿流程之後、斷線時別人記的、改的、刪的換上，自己還沒傳到的照這邊的。
// 斷網時記的（#260）：房間斷了照記，還沒傳的（記了的、改了刪了的）存在這台（離線存放，撐得過重新整理），連上了打招呼、自動傳。
// 還沒送到伺服器的那一次直接改、刪（不用送）；送過的連上再送。斷著時說為什麼（link：斷網、伺服器沒回應、登入過期），
// 連上後傳的時候「傳中…（N 筆）」，傳完一下子「都傳上去了。」。被收回時還有沒傳的：unsentRows 列出來（擋住的框），forget 丟掉。
// iPhone、iPad 的 Safari（不是從主畫面打開的）打開這支後第一次記，提醒加到主畫面（homeHint）。
// 一起記全上（#262，ADR 0015）：伺服器說現在誰在記哪次全上、誰拿著哪幾組（runs，只有能記的人收得到）。
// 開、加入全上表（enterRun）把全上 id、日期、開的時間和拿著、點過的組報給伺服器，連上（斷線回來、伺服器重開）再報一次；
// 拿、放掉、點了一組也送（斷線時先記在這台）；拿不到、加入不了的放在 runRefused。存好、取消就離開（leaveRun）。
// 同一次全上的同一組別人先存了：沒存進去的那一列寫「王教練已經記了這次全上的第 2 組」。
// 自己的一步收了：伺服器也給它做出來的改動（跟送給別人的一樣）。伺服器跑出來的可能跟這邊畫面上的不一樣
// （例：兩個人同時加隊員，後到的被放在別的位置、排在後面），所以這裡記著伺服器的樣子（收了的、別人的改動照第幾步接上），
// 收了之後畫面換成伺服器的樣子再跑一次還沒收的步，復原紀錄裡那一步的重做也換成伺服器做出來的。房間不一定照第幾步的順序說（別人的步可能在我的「收了」之後才到），
// 接不上的先留著，接上了再換。

import {
	actionWhy,
	applyRemoteChange,
	attemptText,
	carryRecords,
	memberName,
	perPerson,
	putRecords,
	recordsPatch,
	runCommands,
	squadWhy,
	takeRecords,
	undone,
	undoRecords,
	type Flow,
	type RemoteChange,
	type StoredAttempt
} from '#lib/core';
import { CORE_FINGERPRINT } from '#lib/core-fingerprint.js';
import { joinSentences, type AlreadyRecorded, type CloudStep, type DroppedRecord, type EditorSession } from '#lib/editor-session.svelte.js';
import { canEdit, ROLE_NAMES } from '#lib/role-names.js';
import { m as t } from '#lib/paraglide/messages.js';
import { reasonText, whyText } from '#lib/reason-text.js';
import { Flash } from '#lib/flash.svelte.js';
import { ALL_ALLOWED, type PracticeRights } from '#lib/practice-rights.js';
import type { AmendRequest, OfflineStore, UnsentRecords } from '#lib/offline-store.js';
import type { CloudRecord, FlowRoom, Present, Role, RoomDown, RoomMessage, RoomRequest, RunView, SentBack } from '#lib/server-api.js';
import { runKey, runKeyLabel } from '#lib/run-keys.js';

/** 還沒被伺服器收的一步：送的、這一步改了什麼（提示用）、做的時候看到第幾步、改之前、改之後的流程。 */
type Queued = CloudStep & { label: string; seen: number; before: Flow; after: Flow };

/** 「都傳上去了。」留幾毫秒。 */
const SYNCED_MS = 3000;

/** 雲端流程的練習的權限（#318）：CloudSteps 跟著權限、房間改，畫面從 session.practice 讀。打開時是能記、共用紀錄。 */
class CloudPractice implements PracticeRights {
	cannotRecord = $state('');
	recordedBy = $state.raw<Record<string, string>>({});
	readonly sharedRecords = true;
	ownRecordsOnly = $state(false);
	droppedRecords = $state.raw<DroppedRecord[]>([]);
	unsentRecords = $state.raw<ReadonlySet<string>>(new Set());
}

/** 房間連得上嗎（#260）：連著、斷網、伺服器沒回應、登入超過 30 天。 */
export type RoomLink = 'online' | RoomDown;

/** 這台存著還沒傳的放在哪（#260）：這支流程的 id、離線存放，和打開時這台已經存著的。 */
export interface KeepUnsent {
	flowId: string;
	store: OfflineStore;
	saved?: UnsentRecords;
}

/** 我在的那次全上（#262）：id、日期、開的時間、拿著的組、點過的組。 */
export interface MyRun {
	id: string;
	date: string;
	startedAt: number;
	keys: string[];
	touched: string[];
}

/** 拿不到一組（拿著的人、他點過了沒），或那次全上的人都離開了、加入不了（'closed'）。 */
export type RunRefused = { key: string; by: string; touched: boolean } | 'closed';

/** 這個分頁的 id：伺服器記每一步是哪個分頁送的（同一個人的兩個分頁也算別人）。 */
const TAB_ID = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join('');

export class CloudSteps {
	readonly #room: FlowRoom;
	readonly #session: EditorSession;
	/** 這支流程的練習的權限（打開時交給 session）。 */
	readonly practice = new CloudPractice();
	/** 還沒被伺服器收的步和它改了什麼、改之前、改之後（第一個送出去了，等它回答）。 */
	#queue = $state.raw<Queued[]>([]);
	/** 伺服器說可以送步了（指紋對）。 */
	#ready = false;
	/** 上次看到第幾步。 */
	#seen: number;
	/** 伺服器的樣子（照第幾步接上收了的步）；我的步收了卻沒帶改動，就不知道了（null，照以前只改畫面）。 */
	#server: { flow: Flow; step: number } | null;
	/** 比伺服器的樣子新、還接不上的改動：第幾步 → 改動。 */
	#later = new Map<number, RemoteChange>();
	/**
	 * 有還沒收的步時，別人改了、刪了，卻不在畫面上的那幾次（例：我刪了動作還沒收，別人刪了它的一次）：
	 * id → 伺服器現在的樣子（刪了是 null）。那一步被退回、紀錄帶回來時照這個；步都收了就清掉。
	 */
	#hidden = new Map<string, StoredAttempt | null>();
	/** 我的步收了，畫面還沒換成伺服器做出來的樣子（等接上）。 */
	#settle = false;
	/** 記了、伺服器還沒回答的那幾次：id → 送的那一次和沒存進去時表上那一列（記的當下的動作、組的名字）。 */
	#unsent = new Map<string, { record: StoredAttempt; row: DroppedRecord }>();
	/** 送出去、等回答的每一批（照送的先後，伺服器照順序回）：那一批的 id 和送的。 */
	#batches: { ids: string[]; request: RoomRequest }[] = [];
	/** 還沒連上時改、刪、救回的（連上就送）：那一批的 id 和要送的。 */
	#amends: { ids: string[]; request: AmendRequest }[] = [];
	/** 存在這台（#260）；沒給是不存。 */
	readonly #keep: KeepUnsent | null;
	/** 這次打開記過了（加到主畫面的提醒只在第一次記之後看一次）。 */
	#recordedOnce = false;
	/** 房間連得上嗎（#260）。 */
	link = $state<RoomLink>('online');
	/** 還沒傳上去的那幾次（記了的、改了刪了的）的 id。 */
	unsentIds = $state.raw<string[]>([]);
	/** 連上後在傳這台存著的（「傳中…（N 筆）」）。 */
	syncing = $state(false);
	/** 傳完了：一下子「都傳上去了。」。 */
	readonly synced = new Flash<true>();
	/** 提醒加到主畫面（iPhone、iPad 的 Safari，這次打開第一次記之後）。 */
	homeHint = $state(false);
	/** 這個分頁刪掉的那幾次：又出現（救回）就送「救回」，不是新增。 */
	#deleted = new Set<string>();
	/** 指紋不一樣：有新版。 */
	newVersion = $state(false);
	/** 斷線了，還沒連回來（連回來是伺服器說可以送步的時候）。 */
	offline = $state(false);
	/** 連回來時補不上、換成伺服器的樣子：沒存進去的步的提示，跟「連上了。」一起說。 */
	#lostOnReconnect = '';
	/** 我對這支流程的權限。 */
	role = $state<Role>('owner');
	/** 現在還有誰開著（自己不列），照進來的先後。 */
	present = $state.raw<Present[]>([]);
	/** 上次告訴伺服器我在編輯（不是檢視模式）。 */
	#editing: boolean;
	/** 被收回了（或在別的分頁離開了）：流程檔接上（回首頁說原因）。 */
	onrevoked: () => void = () => {};
	/** 擁有者刪了這支流程（#252）：流程檔接上（回首頁說原因）。 */
	ondeleted: () => void = () => {};
	/** 現在有人在記的全上（#262，伺服器說的）。 */
	runs = $state.raw<RunView[]>([]);
	/** 我在的那次全上（開著全上表）；連上時再報。 */
	myRun = $state.raw<MyRun | null>(null);
	/** 還沒報給伺服器的加入（加入不了要說）。 */
	#joining = false;
	/** 拿不到一組、加入不了（全上表上的提示）。 */
	runRefused = $state.raw<RunRefused | null>(null);
	/** 斷線後又連上了（伺服器說可以送步，#261）：從離線副本打開的，流程檔接上換成最新的。 */
	onback: () => void = () => {};

	/**
	 * 連 room（這支流程的房間），從第 step 步開始，我的權限是 role；session 改好的步交給它。
	 * keep：還沒傳的存在這台（打開時這台已經存著的接著傳；流程裡已經放進去了，見 withUnsent）。
	 */
	constructor(room: FlowRoom, step: number, session: EditorSession, role: Role = 'owner', keep: KeepUnsent | null = null) {
		this.#room = room;
		this.#session = session;
		this.#seen = step;
		this.#server = session.flow ? { flow: session.flow, step } : null;
		this.role = role;
		this.#keep = keep;
		session.practice = this.practice;
		this.#lock();
		if (keep?.saved) {
			for (const u of keep.saved.records) this.#unsent.set(u.record.attempt.id, u);
			this.#amends = [...keep.saved.amends];
			for (const a of this.#amends) if (a.request.kind === 'deleteRecords') for (const id of a.ids) this.#deleted.add(id);
			this.practice.droppedRecords = [...keep.saved.dropped];
			this.#touch(false);
		}
		room.onmessage = (m) => this.#heard(m);
		room.onconnection = (connected, why) => (connected ? this.#hello() : this.#lost(why ?? 'offline'));
		this.#editing = !session.viewing && canEdit(role);
		this.#hello();
		// 指令裡可能有畫面上的狀態（例：動作表單的人）：排進去時拿掉 $state，收了前一步重跑時 structuredClone 才不會出錯
		session.onstep = (s, label, before, after) =>
			this.#push({ ...($state.snapshot(s) as CloudStep), label, seen: this.#seen, before, after });
		session.onrecord = (before, after) => this.#recorded(before, after);
	}

	/** 上次看到第幾步（離線副本記著，連上時從這裡補，#261）。 */
	get seen(): number {
		return this.#seen;
	}

	/** 還有幾筆沒傳。 */
	get unsentCount(): number {
		return this.unsentIds.length;
	}

	/** 「現在再試」：馬上再連一次。 */
	retry() {
		this.#room.retry();
	}

	/** 沒存進去的紅條按「知道了」：清掉（這台存的也清）。 */
	dismissDropped() {
		this.practice.droppedRecords = [];
		this.#touch();
	}

	/** 加到主畫面的提醒：「知道了」以後不跳；「下次再說」下次打開這支、記第一次再跳。 */
	closeHomeHint(forever: boolean) {
		if (forever) this.#keep?.store.homeScreenKnown();
		this.homeHint = false;
	}

	/**
	 * 還沒傳上去的那幾次（被收回時擋住的框列出來）：記了的、改了的（表上那一列；改的照現在的動作、組的名字）。刪的不列。
	 */
	get unsentRows(): DroppedRecord[] {
		const flow = this.#session.flow;
		const rows = [...this.#unsent.values()].map((u) => u.row);
		const listed = new Set(rows.map((r) => r.id));
		for (const { request } of this.#pendingAmends()) {
			if (request.kind !== 'changeRecords' || !flow) continue;
			for (const a of request.attempts as StoredAttempt[]) {
				if (listed.has(a.attempt.id) || !flow.actions.some((x) => x.id === a.actionId)) continue;
				listed.add(a.attempt.id);
				rows.push(droppedRow(flow, a));
			}
		}
		return rows;
	}

	/**
	 * 開、加入全上表（#262）：報給伺服器這次全上和要拿的組（開的是全部的組，加入的是沒人拿著的）。
	 * 斷線時先記著，連上再報。
	 */
	enterRun(run: { id: string; date: string; startedAt: number }, keys: string[], joining: boolean) {
		this.myRun = { ...run, keys, touched: [] };
		this.#joining = joining;
		this.runRefused = null;
		this.#reportRun();
	}

	/** 拿一組（或接手）：from 是我看到拿著的人（沒人拿著是 null）。斷線時先當成我的。 */
	claim(key: string, from: number | null) {
		const run = this.myRun;
		if (!run) return;
		this.runRefused = null;
		if (this.#ready) this.#room.send({ kind: 'claim', run: run.id, key, from });
		else this.myRun = { ...run, keys: [...run.keys, key] };
	}

	/** 放掉一組。 */
	release(key: string) {
		const run = this.myRun;
		if (!run) return;
		this.myRun = { ...run, keys: run.keys.filter((k) => k !== key) };
		if (this.#ready) this.#room.send({ kind: 'release', run: run.id, key });
	}

	/** 一欄第一次點記號：送一次「我點了這一組」（斷線時點的連上再報）。 */
	touch(key: string) {
		const run = this.myRun;
		if (!run || run.touched.includes(key)) return;
		this.myRun = { ...run, touched: [...run.touched, key] };
		if (this.#ready) this.#room.send({ kind: 'touch', run: run.id, key });
	}

	/** 存好、取消：離開這次全上，拿著的組放掉。 */
	leaveRun() {
		const run = this.myRun;
		if (!run) return;
		this.myRun = null;
		this.runRefused = null;
		if (this.#ready) this.#room.send({ kind: 'leaveRun', run: run.id });
	}

	/** 報我在的那次全上（連上了才報；加入只報一次，之後是重報）。 */
	#reportRun() {
		const run = this.myRun;
		if (!run || !this.#ready) return;
		const { id, date, startedAt, keys, touched } = run;
		this.#room.send({ kind: 'runThrough', id, date, startedAt, keys, touched, joining: this.#joining });
		this.#joining = false;
	}

	/** 伺服器說的全上：我在的那次換成伺服器說我拿著的組、點過的組。 */
	#heardRuns(runs: RunView[]) {
		this.runs = runs;
		const run = this.myRun;
		const mine = runs.find((r) => r.id === run?.id)?.keys.filter((k) => k.mine);
		if (!run || !mine) return;
		const touched = mine.filter((k) => k.touched).map((k) => k.key);
		this.myRun = {
			...run,
			keys: mine.map((k) => k.key),
			touched: [...new Set([...run.touched.filter((k) => mine.some((m) => m.key === k)), ...touched])]
		};
	}

	/** 這支流程這台存著的都丟掉（被收回、流程被刪了：傳不上去了）。 */
	forget() {
		this.#unsent.clear();
		this.#amends = [];
		this.#batches = [];
		this.practice.droppedRecords = [];
		this.#touch();
	}

	/** 只能看（有新版、斷線了，或我是記錄者、檢視者）：一律檢視模式，「編輯」按不了。 */
	get viewOnly(): boolean {
		return this.newVersion || this.offline || !canEdit(this.role);
	}

	/** 還沒送到伺服器的步有幾步（送出去還沒收到回答的也算）：離開時問、關分頁時讓瀏覽器問。 */
	get unsent(): number {
		return this.#queue.length;
	}

	/** 還有步在送（名字旁「存中…」）。 */
	get saving(): boolean {
		return this.#queue.length > 0;
	}

	/** 換成編輯或檢視模式：跟上次說的不一樣才告訴伺服器（在場名單用）。 */
	setEditing(editing: boolean) {
		if (editing === this.#editing) return;
		this.#editing = editing;
		// 斷線時不說：連回來打招呼時帶著
		if (!this.offline) this.#room.send({ kind: 'mode', editing });
	}

	/** 換流程：不再收發。 */
	close() {
		this.leaveRun();
		this.#room.onmessage = () => {};
		this.#room.onconnection = () => {};
		this.#room.close();
		this.#session.onstep = null;
		this.#session.onrecord = null;
		this.#session.readOnly = '';
		if (this.#session.practice === this.practice) this.#session.practice = ALL_ALLOWED;
		this.synced.clear();
	}

	/** 還沒送到的改、刪、救回：送出去等回答的、還沒送的，照做的先後。 */
	#pendingAmends(): { ids: string[]; request: AmendRequest }[] {
		const sent = this.#batches.filter((b): b is { ids: string[]; request: AmendRequest } => b.request.kind !== 'record');
		return [...sent, ...this.#amends];
	}

	/** 這一次送出去了、在等伺服器回答。 */
	#inFlight(id: string): boolean {
		return this.#batches.some((b) => b.ids.includes(id));
	}

	/**
	 * 沒傳的改了：算一次還有哪幾筆、卡片上哪幾次寫「沒傳」（送出去等回答的不寫），存進這台（save）；
	 * 在傳這台存著的、都傳完了，就說「都傳上去了。」。
	 */
	#touch(save = true) {
		const amends = this.#pendingAmends();
		const ids = [...new Set([...this.#unsent.keys(), ...amends.flatMap((a) => a.ids)])];
		this.unsentIds = ids;
		this.practice.unsentRecords = new Set(ids.filter((id) => !this.#inFlight(id)));
		if (this.syncing && !ids.length) {
			this.syncing = false;
			this.synced.show(true, SYNCED_MS);
		}
		const keep = this.#keep;
		if (!keep || !save) return;
		void keep.store.saveUnsent({
			flowId: keep.flowId,
			flowName: this.#session.flow?.name ?? keep.saved?.flowName ?? '',
			records: [...this.#unsent.values()],
			amends,
			dropped: this.practice.droppedRecords
		});
	}

	/** 不能改的原因放進 session、不能記的原因放進練習的權限：有新版優先，再來是斷線。記錄者只能改、刪自己記的。 */
	#lock() {
		const newVersion = t.cloud_new_version();
		this.#session.readOnly = this.newVersion ? newVersion : this.offline ? t.cloud_offline() : canEdit(this.role) ? '' : t.cloud_only_view();
		this.practice.cannotRecord = this.newVersion ? newVersion : this.role === 'viewer' ? t.cloud_only_view() : '';
		this.practice.ownRecordsOnly = this.role === 'recorder';
	}

	/**
	 * 打招呼（連上、連回來）：上次看到第幾步，伺服器先補上之後別人的改動。
	 * 都要現在的紀錄：第一次是拿流程之後、進房間之前別人記的、改的、刪的；連回來是斷線時的。
	 */
	#hello() {
		this.#room.send({ kind: 'hello', fingerprint: CORE_FINGERPRINT, tabId: TAB_ID, seen: this.#seen, editing: this.#editing, records: true });
	}

	/**
	 * 斷線了（why：斷網、伺服器沒回應、登入過期，#260）：不能改，等房間連回來；送出去還沒回答的紀錄連回來再送
	 * （記的從 #unsent 送，改、刪、救回放回 #amends）。已經斷著、只是原因變了：只換原因。
	 */
	#lost(why: RoomDown) {
		this.link = why;
		if (this.offline) return;
		this.#ready = false;
		this.syncing = false;
		this.#amends = [...this.#pendingAmends()];
		this.#batches = [];
		this.offline = true;
		this.#lock();
		this.#session.notice = t.cloud_offline_notice();
		this.#touch();
	}

	#push(step: Queued) {
		this.#queue = [...this.#queue, step];
		if (this.#queue.length === 1) this.#sendHead();
	}

	#sendHead() {
		const head = this.#queue[0];
		if (!head || !this.#ready) return;
		if ('undo' in head) this.#room.send({ kind: 'undo', stepId: head.id, seen: head.seen, ...head.undo });
		else this.#room.send({ kind: 'step', stepId: head.id, seen: head.seen, commands: head.commands });
	}

	#heard(m: RoomMessage) {
		if (m.kind === 'ready') {
			this.#ready = true;
			this.link = 'online';
			const back = this.offline;
			if (this.offline) {
				this.offline = false;
				this.#lock();
				this.#session.notice = this.#lostOnReconnect ? joinSentences([t.cloud_back(), this.#lostOnReconnect]) : t.cloud_back();
				this.#lostOnReconnect = '';
			}
			this.#sendHead();
			this.#reportRun();
			this.syncing = this.unsentIds.length > 0;
			this.#sendRecords([...this.#unsent.keys()]);
			for (const { ids, request } of this.#amends.splice(0)) this.#send(ids, request);
			this.#touch();
			if (back) this.onback();
		} else if (m.kind === 'newVersion') {
			this.newVersion = true;
			this.offline = false;
			this.#lock();
			// 伺服器不收步了：不再重連
			this.#room.close();
		} else if (m.kind === 'current') {
			// 補不上（斷線太久）：換成伺服器的樣子，還沒送到的步不算；連回來時跟「連上了。」一起說
			const dropped = this.#dropQueue();
			this.#seen = m.step;
			const lost = dropped.length ? (dropped.length === 1 ? t.cloud_replaced_lost_one : t.cloud_replaced_lost)({ count: dropped.length }) : '';
			if (this.offline) this.#lostOnReconnect = lost;
			this.#reset(m.flow as Flow, this.offline || !lost ? this.#session.notice : lost, dropped);
		} else if (m.kind === 'revoked') {
			this.#queue = [];
			this.onrevoked();
		} else if (m.kind === 'deleted') {
			this.#queue = [];
			this.ondeleted();
		} else if (m.kind === 'roleChanged') {
			this.#roleChanged(m.role, m.flow as Flow, m.step);
		} else if (m.kind === 'present') {
			this.present = m.people;
		} else if (m.kind === 'changed') {
			this.#session.applyRemote(m.change as RemoteChange, m.by);
			this.#heardChange(m.step, m.change as RemoteChange);
			this.#saw(m.step);
			this.#settleScreen();
		} else if (m.kind === 'recordsSaved') {
			this.#saved(m.saved, m.dropped);
		} else if (m.kind === 'newRecords') {
			this.#others(m.records, []);
		} else if (m.kind === 'recordsChanged') {
			this.#others(m.changed, m.deleted);
		} else if (m.kind === 'records') {
			this.#caughtUp(m.records);
		} else if (m.kind === 'runThroughs') {
			this.#heardRuns(m.runs);
		} else if (m.kind === 'claimRefused') {
			if (m.run === this.myRun?.id) this.runRefused = { key: m.key, by: m.by, touched: m.touched };
		} else if (m.kind === 'runClosed') {
			if (m.run === this.myRun?.id) this.runRefused = 'closed';
		} else if (m.stepId !== this.#queue[0]?.id) {
			return;
		} else if (m.kind === 'accepted') {
			if (m.change === undefined) this.#server = null;
			else {
				this.#heardChange(m.step, m.change as RemoteChange);
				this.#session.acceptedAs(m.stepId, m.change as RemoteChange);
				this.#settle = true;
			}
			this.#saw(m.step);
			this.#queue = this.#queue.slice(1);
			if (!this.#queue.length) this.#hidden.clear();
			this.#settleScreen();
			this.#sendHead();
		} else {
			// 退回：這一步和後面還沒送的一起不要，換成伺服器的樣子
			const label = this.#queue[0].label;
			this.#seen = m.step;
			const dropped = this.#dropQueue();
			this.#reset(m.flow as Flow, sentBack(m, label), dropped);
		}
	}

	/**
	 * 聽到第 step 步（別人的、我的收了）之後，上次看到第幾步：照順序接上的那一步。前面的步還沒到（例：我的第 2 步收了，
	 * 別人的第 1 步還在路上）不算看過，斷線重連才會從那裡補。不知道伺服器的樣子時照聽到最新的
	 * （連回來時補上的別人的步可能比我這一步新）。
	 */
	#saw(step: number) {
		this.#seen = this.#server ? this.#server.step : Math.max(this.#seen, step);
	}

	/** 伺服器收了第 step 步、做出來的改動：接得上就接到伺服器的樣子上（接上之後留著的也接），接不上先留著。 */
	#heardChange(step: number, change: RemoteChange) {
		const server = this.#server;
		if (!server || step <= server.step) return;
		this.#later.set(step, change);
		let { flow, step: at } = server;
		for (let next = this.#later.get(at + 1); next; next = this.#later.get(at + 1)) {
			this.#later.delete(at + 1);
			flow = applyRemoteChange(flow, next);
			at++;
		}
		this.#server = { flow, step: at };
	}

	/**
	 * 我的步收了、伺服器的樣子都接上了：畫面換成伺服器的樣子，再跑一次還沒收的步（同一個步驟 id，新東西的 id 一樣），
	 * 帶著現在的紀錄。還沒收的步跑不過（被擋、要問）就先不換：伺服器會退回它，那時換成伺服器的樣子。
	 */
	#settleScreen() {
		const server = this.#server;
		const now = this.#session.flow;
		if (!this.#settle || !server || this.#later.size || !now) return;
		this.#settle = false;
		let flow = carryRecords(server.flow, now);
		for (const step of this.#queue) {
			if ('undo' in step) {
				flow = undone(flow, step.undo.change);
				continue;
			}
			const r = runCommands(flow, structuredClone(step.commands), step.id);
			if (r.kind !== 'ok') return;
			flow = r.flow;
		}
		this.#session.settle(flow);
	}

	/** 還沒被伺服器收的步都不算：清掉，也從復原、重做紀錄拿掉。回傳清掉的步。 */
	#dropQueue(): Queued[] {
		const dropped = this.#queue;
		this.#session.dropSteps(dropped.map((s) => s.id));
		this.#queue = [];
		return dropped;
	}

	/**
	 * 換成伺服器的樣子（不帶紀錄）：帶著現在的紀錄（對不上的丟掉，跟復原一樣）。
	 * 沒算的步（dropped）清掉的紀錄伺服器還留著：那幾個動作從最後一步往前，像復原一樣帶回來（例：刪動作被退回，它的紀錄也回來）；
	 * 其他動作照現在的（之後才有的動作、組、環節的紀錄不丟）。帶回來的那幾次在等的時候別人改了、刪了，照伺服器現在的樣子。
	 */
	#reset(flow: Flow, message: string, dropped: Queued[]) {
		this.#server = { flow, step: this.#seen };
		for (const step of this.#later.keys()) if (step <= this.#seen) this.#later.delete(step);
		this.#settle = false;
		const now = this.#session.flow;
		if (!now) return this.#session.reset(flow, message);
		const patched = new Set(dropped.flatMap((s) => recordsPatch(s.before, s.after).map((p) => p.actionId)));
		let back = now;
		// 照伺服器的樣子帶回來（不是那一步之前的）：別人後來加回來的環節、組上的記號不會被拿掉
		for (const step of [...dropped].reverse()) back = undoRecords(putRecords(flow, takeRecords(step.before).records), step.after, back);
		const shown = new Set(takeRecords(now).records.map((r) => r.attempt.id));
		const records = [
			...takeRecords(now).records.filter((r) => !patched.has(r.actionId)),
			...takeRecords(back)
				.records.filter((r) => patched.has(r.actionId))
				.flatMap((r) => {
					// 帶回來的（不在畫面上的）別人後來改了、刪了：照伺服器現在的樣子
					const hidden = shown.has(r.attempt.id) ? undefined : this.#hidden.get(r.attempt.id);
					return hidden === undefined ? [r] : hidden ? [hidden] : [];
				})
		];
		this.#hidden.clear();
		this.#session.reset(carryRecords(flow, putRecords(flow, records)), message);
	}

	/**
	 * 記了：比對記之前、之後，新的那幾次送「記」，改了記號的送「改」，不見的送「刪」，
	 * 這個分頁刪過又出現的（救回）送「救回」（#258）。
	 * 還沒送到伺服器的那一次（斷網時記的，#260）改了、刪了直接改這台的，不用送。
	 */
	#recorded(before: Flow, after: Flow) {
		const old = new Map(takeRecords(before).records.map((r) => [r.attempt.id, r]));
		const now = takeRecords(after).records;
		const ids = new Set(now.map((r) => r.attempt.id));
		/** 伺服器還不知道這一次（沒傳、也不在路上）。 */
		const local = (id: string) => this.#unsent.has(id) && !this.#inFlight(id);
		const added = now.filter((r) => !old.has(r.attempt.id) && !this.#deleted.has(r.attempt.id));
		const restored = now.filter((r) => !old.has(r.attempt.id) && this.#deleted.has(r.attempt.id)).map((r) => r.attempt.id);
		const changed = now.filter((r) => old.has(r.attempt.id) && old.get(r.attempt.id)!.attempt !== r.attempt);
		const removed = [...old.keys()].filter((id) => !ids.has(id));
		const sentChanged = changed.filter((r) => !local(r.attempt.id));
		const sentRemoved = removed.filter((id) => !local(id));
		for (const r of changed.filter((r) => local(r.attempt.id))) this.#unsent.set(r.attempt.id, { record: r, row: droppedRow(after, r) });
		for (const record of added) this.#unsent.set(record.attempt.id, { record, row: droppedRow(after, record) });
		if (this.#ready) this.#sendRecords(added.map((r) => r.attempt.id));
		for (const id of restored) this.#deleted.delete(id);
		for (const id of removed) if (local(id)) this.#unsent.delete(id);
		for (const id of sentRemoved) this.#deleted.add(id);
		if (sentChanged.length) this.#send(sentChanged.map((r) => r.attempt.id), { kind: 'changeRecords', attempts: sentChanged });
		if (sentRemoved.length) this.#send(sentRemoved, { kind: 'deleteRecords', ids: sentRemoved });
		if (restored.length) this.#send(restored, { kind: 'restoreRecords', ids: restored });
		if (added.length && !this.#recordedOnce) {
			this.#recordedOnce = true;
			if (this.#keep?.store.needsHomeScreen()) this.homeHint = true;
		}
		this.#touch();
	}

	#sendRecords(ids: string[]) {
		if (!ids.length) return;
		this.#send(ids, { kind: 'record', attempts: ids.map((id) => this.#unsent.get(id)!.record) });
	}

	/** 送一批紀錄（ids 是這一批的那幾次，等伺服器照順序回）；還沒連上就先留著（新記的本來就在沒傳的裡面），連上再送。 */
	#send(ids: string[], request: RoomRequest) {
		if (!this.#ready) {
			if (request.kind !== 'record') this.#amends.push({ ids, request: request as AmendRequest });
			return;
		}
		this.#batches.push({ ids, request });
		this.#room.send(request);
	}

	/**
	 * 伺服器回我送的那一批：收了的換成伺服器存的樣子，沒存進去的拿掉、列進紅條；收過又被清掉的也拿掉。
	 * 改、刪、救回：伺服器上還在的換成它的樣子（刪不掉的放回來），不在的拿掉。後面還有一批在等的那幾次先不動（等那一批的回答）。
	 */
	#saved(saved: CloudRecord[], dropped: { id: string; by?: string; someone?: boolean }[]) {
		const batch = new Set(this.#batches.shift()?.ids ?? []);
		const later = new Set(this.#batches.flatMap((b) => b.ids));
		const kept = new Map(saved.map((r) => [attemptOf(r).id, r]));
		const rows = dropped.flatMap((d) => {
			const u = this.#unsent.get(d.id);
			if (!u) return [];
			if (d.by === undefined) return [u.row];
			const note = alreadyRecorded(this.#session.flow, u.record, d.someone ? null : d.by);
			return [{ ...u.row, note: droppedNote(note), why: u.row.why && { ...u.row.why, note } }];
		});
		for (const id of batch) this.#unsent.delete(id);
		const flow = this.#session.flow;
		if (!flow) return this.#touch();
		if (this.#queue.length) {
			// 不在畫面上的（還沒收的步清掉的）：記下伺服器的樣子，那一步退回時照這個帶回來
			const shown = new Set(takeRecords(flow).records.map((r) => r.attempt.id));
			for (const id of batch) {
				const server = kept.get(id);
				if (!shown.has(id) && !later.has(id)) this.#hidden.set(id, server ? stored(server) : null);
			}
		}
		const records = takeRecords(flow).records.flatMap((r) => {
			const server = kept.get(r.attempt.id);
			if (later.has(r.attempt.id)) return [r];
			if (server) return [stored(server)];
			return batch.has(r.attempt.id) ? [] : [r];
		});
		const have = new Set(records.map((r) => r.attempt.id));
		const back = saved.filter((r) => !have.has(attemptOf(r).id) && !later.has(attemptOf(r).id));
		this.#session.serverRecords(putRecords(flow, [...records, ...back.map(stored)]));
		if (rows.length) this.practice.droppedRecords = [...this.practice.droppedRecords, ...rows];
		this.#touch();
	}

	/**
	 * 別人（或我在別的分頁）記的、改的、刪的，或一步跟著改、清掉的（#258）：
	 * 有的換成伺服器的樣子，沒有的放進畫面，刪掉的拿掉；不是自己記的記下名字。
	 * 我改了、還在等回答的那幾次先不動（伺服器的樣子比我的改動舊，等那一批的回答）。
	 */
	#others(incoming: CloudRecord[], deleted: string[]) {
		const flow = this.#session.flow;
		if (!flow) return;
		const pending = new Set(this.#pendingAmends().flatMap((a) => a.ids));
		const gone = new Set(deleted.filter((id) => !pending.has(id)));
		const fresh = new Map(incoming.flatMap((r) => (pending.has(attemptOf(r).id) ? [] : [[attemptOf(r).id, r] as const])));
		if (this.#queue.length) {
			const shown = new Set(takeRecords(flow).records.map((r) => r.attempt.id));
			for (const id of deleted) if (!shown.has(id)) this.#hidden.set(id, null);
			for (const [id, r] of fresh) if (!shown.has(id)) this.#hidden.set(id, stored(r));
		}
		const records = takeRecords(flow).records.flatMap((r) => {
			if (gone.has(r.attempt.id)) return [];
			const server = fresh.get(r.attempt.id);
			fresh.delete(r.attempt.id);
			return [server ? stored(server) : r];
		});
		const names = Object.fromEntries(incoming.flatMap((r) => (r.mine ? [] : [[attemptOf(r).id, r.by ?? '']])));
		this.practice.recordedBy = { ...this.practice.recordedBy, ...names };
		this.#session.serverRecords(putRecords(flow, [...records, ...[...fresh.values()].map(stored)]));
	}

	/**
	 * 伺服器現在的紀錄（連上、連回來時，#255）：換成這一份（拿流程之後、斷線時別人記的放進來、刪的拿掉）；
	 * 我還沒傳到的（記了的、改了刪了救回的）照我這邊的，連上後再送。
	 */
	#caughtUp(server: CloudRecord[]) {
		const flow = this.#session.flow;
		if (!flow) return;
		const pending = new Set([...this.#unsent.keys(), ...this.#pendingAmends().flatMap((a) => a.ids)]);
		const local = new Map(takeRecords(flow).records.map((r) => [r.attempt.id, r]));
		const records = server.flatMap((r) => {
			const id = attemptOf(r).id;
			if (!pending.has(id)) return [stored(r)];
			const mine = local.get(id);
			return mine ? [mine] : [];
		});
		const listed = new Set(records.map((r) => r.attempt.id));
		for (const [id, r] of local) if (pending.has(id) && !listed.has(id)) records.push(r);
		// 還沒收的步清掉的（不在畫面上）：退回時照伺服器現在的帶回來，不在了（別人刪了）就不帶
		const now = new Map(server.map((r) => [attemptOf(r).id, stored(r)]));
		for (const lost of this.#queue.flatMap((s) => recordsPatch(s.before, s.after))) {
			for (const { id } of lost.before) if (!local.has(id)) this.#hidden.set(id, now.get(id) ?? null);
		}
		const names = Object.fromEntries(server.flatMap((r) => (r.mine ? [] : [[attemptOf(r).id, r.by ?? '']])));
		this.practice.recordedBy = { ...this.practice.recordedBy, ...names };
		this.#session.serverRecords(putRecords(flow, records));
	}

	/** 擁有者改了我的權限。降成記錄者、檢視者：還沒送到的步不算，換成伺服器的樣子並提示。 */
	#roleChanged(role: Role, flow: Flow, step: number) {
		const could = canEdit(this.role);
		this.role = role;
		this.#lock();
		if (canEdit(role)) {
			// 移交（#252）：擁有者、編輯者之間換，本來就能改
			this.#session.notice = (could ? t.cloud_role_now : t.cloud_role_now_edit)({ role: ROLE_NAMES[role] });
			return;
		}
		const dropped = this.#dropQueue();
		this.#seen = step;
		const now = t.cloud_role_now_view({ role: ROLE_NAMES[role] });
		const lost = dropped.length ? (dropped.length === 1 ? t.cloud_lost_one : t.cloud_lost)({ count: dropped.length }) : '';
		this.#reset(flow, lost ? joinSentences([now, lost]) : now, dropped);
	}
}

/** 一步退回。why 可能沒有：還沒更新的伺服器（部署、退版時）不送。 */
export type Rejected = Omit<Extract<RoomMessage, { kind: 'rejected' }>, 'why'> & { why?: SentBack };

/**
 * 我的一步被退回的提示：伺服器送原因的代號（why），這裡照使用者的語言寫成句子（ADR 0017）。label 是那一步的名字；
 * by 是在我上次看到之後最後改的人（別人改了同一個地方、或改了流程之後被規則擋下）。
 */
export function sentBack({ why, by, message }: Rejected, label: string): string {
	switch (why?.code) {
		case 'viewOnly':
			return t.rejected_view_only();
		case 'afterSentBack':
			return t.rejected_after_sent_back();
		case 'tooOld':
			return t.rejected_too_old();
		case 'notUnderstood':
			return t.rejected_not_understood();
		case 'blocked':
			if (by === undefined) return (why.ask ? t.rejected_asked : t.rejected_blocked)({ reason: reasonText(why.reason) });
			return (why.ask ? t.rejected_asked_by : t.rejected_blocked_by)({ by, label, reason: reasonText(why.reason) });
		case 'sameThing':
			return t.rejected_same_thing({ by: by!, label });
		case 'undoTooOld':
			return why.redo ? t.redo_too_old() : t.undo_too_old();
		case 'undoChangedLater':
			return (why.redo ? t.redo_changed_later : t.undo_changed_later)({ by: why.by });
		case 'undoBlocked':
			return (why.redo ? t.redo_blocked : t.undo_blocked)({ reason: reasonText(why.reason) });
		default:
			// 沒有代號（還沒更新的伺服器）、還不認得的代號（伺服器比這個分頁新）：照它寫的中文。有 by 時 message 是被規則擋下的原因，
			// 改到同一個東西是空的
			if (by === undefined) return message;
			return message ? t.rejected_blocked_by({ by, label, reason: message }) : t.rejected_same_thing({ by, label });
	}
}

/** 同一次全上的同一組別人先存了（#262）：誰、哪一組（畫面用 droppedNote 寫成「王教練已經記了這次全上的第 2 組」）。 */
function alreadyRecorded(flow: Flow | null, { actionId, attempt }: StoredAttempt, by: string | null): AlreadyRecorded {
	const action = flow?.actions.find((a) => a.id === actionId);
	return { by, which: flow && action ? runKeyLabel(flow, runKey(action, attempt.who)) : null };
}

/** 「王教練已經記了這次全上的第 2 組」照現在的語言寫；先記的人沒有名字寫「別人」。 */
function droppedNote(note: AlreadyRecorded): string {
	const which = note.which === null ? t.cloud_this_squad() : whyText(note.which);
	return t.cloud_already_recorded({ by: note.by ?? t.cloud_someone_else(), which });
}

/** 沒存進去那一列的動作、組、原因照現在的語言寫；舊版存的（沒有代號）照當時寫好的字。 */
export function droppedTexts({ action, who, note, why }: DroppedRecord): { action: string; who: string; note: string } {
	if (!why) return { action, who, note: note ?? '' };
	return { action: whyText(why.action), who: whyText(why.who), note: why.note ? droppedNote(why.note) : (note ?? '') };
}

/** 伺服器送來的一次（流程核心的 Attempt）。 */
const attemptOf = (r: CloudRecord) => r.attempt as StoredAttempt['attempt'];
/** 伺服器送來的一次放回流程的樣子。 */
const stored = (r: CloudRecord): StoredAttempt => ({ actionId: r.actionId, attempt: attemptOf(r) });

/** 沒存進去時表上那一列：記的當下的日期、動作、組（或隊員）、記號（之後動作、組可能被刪掉，名字先記下來）。 */
function droppedRow(flow: Flow, { actionId, attempt }: StoredAttempt): DroppedRecord {
	const action = flow.actions.find((a) => a.id === actionId)!;
	const why = { action: actionWhy(action), who: perPerson(action.category) ? memberName(flow, attempt.who) : squadWhy(flow, action, attempt.who) };
	return {
		id: attempt.id,
		date: attempt.date,
		action: whyText(why.action),
		who: whyText(why.who),
		marks: attemptText(action, attempt),
		runThrough: attempt.practice === 'runThrough',
		why
	};
}

/**
 * 打開雲端流程時，把這台還沒傳的（#260）放回伺服器給的流程：新記的加上（伺服器已經有的不重複），
 * 改了的換成改好的，刪了的拿掉（救回的等伺服器回答再放回來）。
 */
export function withUnsent(flow: Flow, saved: UnsentRecords): Flow {
	const byId = new Map(takeRecords(flow).records.map((r) => [r.attempt.id, r]));
	for (const { record } of saved.records) if (!byId.has(record.attempt.id)) byId.set(record.attempt.id, record);
	for (const { request } of saved.amends) {
		if (request.kind === 'changeRecords') {
			for (const a of request.attempts as StoredAttempt[]) if (byId.has(a.attempt.id)) byId.set(a.attempt.id, a);
		} else if (request.kind === 'deleteRecords') {
			for (const id of request.ids) byId.delete(id);
		}
	}
	return putRecords(flow, [...byId.values()]);
}
