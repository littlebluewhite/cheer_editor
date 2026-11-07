// 雲端流程一步一步存（#248，ADR 0007、0011）：流程檔打開雲端流程時建一個，換流程就關掉。
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
// 成功率紀錄（#257，ADR 0008）：記一次（session 的「記」交給 onrecord）把新的那幾次送進同一個房間，不算一步。
// 伺服器回收了的（換成伺服器存的樣子）和沒存進去的（從畫面拿掉，列進紅條的表，按「知道了」才清）；
// 別人記的馬上放進畫面，記號後面寫名字。檢視者不能記。
// 改、刪、救回（#258）也從這裡送；伺服器回那幾次現在的樣子（記錄者動別人的不算，換回來）。別人改的、刪的，
// 別人的一步跟著改、清掉的紀錄，馬上換掉。記錄者只能改、刪自己記的（session.ownRecordsOnly）。伺服器的樣子（退回、權限改了）不帶紀錄，換上時帶著現在的紀錄。
// 斷網時記的（#260）：房間斷了照記，還沒傳的（記了的、改了刪了的）存在這台（離線存放，撐得過重新整理），連上了打招呼、自動傳。
// 還沒送到伺服器的那一次直接改、刪（不用送）；送過的連上再送。斷著時說為什麼（link：斷網、伺服器沒回應、登入過期），
// 連上後傳的時候「傳中…（N 筆）」，傳完一下子「都傳上去了。」。被收回時還有沒傳的：unsentRows 列出來（擋住的框），forget 丟掉。
// iPhone、iPad 的 Safari（不是從主畫面打開的）打開這支後第一次記，提醒加到主畫面（homeHint）。

import {
	actionLabel,
	attemptText,
	carryRecords,
	memberName,
	perPerson,
	putRecords,
	squadName,
	takeRecords,
	type Flow,
	type RemoteChange,
	type StoredAttempt
} from '#lib/core';
import { CORE_FINGERPRINT } from '#lib/core-fingerprint.js';
import type { CloudStep, DroppedRecord, EditorSession } from '#lib/editor-session.svelte.js';
import { canEdit, ROLE_NAMES } from '#lib/role-names.js';
import { Flash } from '#lib/flash.svelte.js';
import type { AmendRequest, OfflineStore, UnsentRecords } from '#lib/offline-store.js';
import type { CloudRecord, FlowRoom, Present, Role, RoomDown, RoomMessage, RoomRequest } from '#lib/server-api.js';

/** 有新版時不能改的原因。 */
export const NEW_VERSION = '有新版，請重新整理';
/** 記錄者、檢視者不能改的原因。 */
export const ONLY_VIEW = '你只能看這支流程';
/** 斷線時不能改的原因。 */
export const OFFLINE = '斷線了，連上才能改';

/** 「都傳上去了。」留幾毫秒。 */
const SYNCED_MS = 3000;

/** 房間連得上嗎（#260）：連著、斷網、伺服器沒回應、登入超過 30 天。 */
export type RoomLink = 'online' | RoomDown;

/** 這台存著還沒傳的放在哪（#260）：這支流程的 id、離線存放，和打開時這台已經存著的。 */
export interface KeepUnsent {
	flowId: string;
	store: OfflineStore;
	saved?: UnsentRecords;
}

/** 這個分頁的 id：伺服器記每一步是哪個分頁送的（同一個人的兩個分頁也算別人）。 */
const TAB_ID = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join('');

export class CloudSteps {
	readonly #room: FlowRoom;
	readonly #session: EditorSession;
	/** 還沒被伺服器收的步和它改了什麼（第一個送出去了，等它回答）。 */
	#queue = $state.raw<(CloudStep & { label: string; seen: number })[]>([]);
	/** 伺服器說可以送步了（指紋對）。 */
	#ready = false;
	/** 上次看到第幾步。 */
	#seen: number;
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

	/**
	 * 連 room（這支流程的房間），從第 step 步開始，我的權限是 role；session 改好的步交給它。
	 * keep：還沒傳的存在這台（打開時這台已經存著的接著傳；流程裡已經放進去了，見 withUnsent）。
	 */
	constructor(room: FlowRoom, step: number, session: EditorSession, role: Role = 'owner', keep: KeepUnsent | null = null) {
		this.#room = room;
		this.#session = session;
		this.#seen = step;
		this.role = role;
		this.#keep = keep;
		session.sharedRecords = true;
		this.#lock();
		if (keep?.saved) {
			for (const u of keep.saved.records) this.#unsent.set(u.record.attempt.id, u);
			this.#amends = [...keep.saved.amends];
			for (const a of this.#amends) if (a.request.kind === 'deleteRecords') for (const id of a.ids) this.#deleted.add(id);
			session.droppedRecords = [...keep.saved.dropped];
			this.#touch(false);
		}
		room.onmessage = (m) => this.#heard(m);
		room.onconnection = (connected, why) => (connected ? this.#hello() : this.#lost(why ?? 'offline'));
		this.#editing = !session.viewing && canEdit(role);
		this.#hello();
		session.onstep = (s, label) => this.#push({ ...s, label, seen: this.#seen });
		session.onrecord = (before, after) => this.#recorded(before, after);
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
		this.#session.droppedRecords = [];
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

	/** 這支流程這台存著的都丟掉（被收回、流程被刪了：傳不上去了）。 */
	forget() {
		this.#unsent.clear();
		this.#amends = [];
		this.#batches = [];
		this.#session.droppedRecords = [];
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
		this.#room.onmessage = () => {};
		this.#room.onconnection = () => {};
		this.#room.close();
		this.#session.onstep = null;
		this.#session.onrecord = null;
		this.#session.readOnly = '';
		this.#session.cannotRecord = '';
		this.#session.sharedRecords = false;
		this.#session.ownRecordsOnly = false;
		this.#session.unsentRecords = new Set();
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
		this.#session.unsentRecords = new Set(ids.filter((id) => !this.#inFlight(id)));
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
			dropped: this.#session.droppedRecords
		});
	}

	/** 不能改的原因放進 session：有新版優先，再來是斷線。記錄者只能改、刪自己記的。 */
	#lock() {
		this.#session.readOnly = this.newVersion ? NEW_VERSION : this.offline ? OFFLINE : canEdit(this.role) ? '' : ONLY_VIEW;
		this.#session.cannotRecord = this.newVersion ? NEW_VERSION : this.role === 'viewer' ? ONLY_VIEW : '';
		this.#session.ownRecordsOnly = this.role === 'recorder';
	}

	/** 打招呼（連上、連回來）：上次看到第幾步，伺服器先補上之後別人的改動。 */
	#hello() {
		this.#room.send({ kind: 'hello', fingerprint: CORE_FINGERPRINT, tabId: TAB_ID, seen: this.#seen, editing: this.#editing });
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
		this.#session.notice = `${OFFLINE}。還沒送出的步，連上後會再送。`;
		this.#touch();
	}

	#push(step: CloudStep & { label: string; seen: number }) {
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
			if (this.offline) {
				this.offline = false;
				this.#lock();
				this.#session.notice = `連上了。${this.#lostOnReconnect}`;
				this.#lostOnReconnect = '';
			}
			this.#sendHead();
			this.syncing = this.unsentIds.length > 0;
			this.#sendRecords([...this.#unsent.keys()]);
			for (const { ids, request } of this.#amends.splice(0)) this.#send(ids, request);
			this.#touch();
		} else if (m.kind === 'newVersion') {
			this.newVersion = true;
			this.offline = false;
			this.#lock();
			// 伺服器不收步了：不再重連
			this.#room.close();
		} else if (m.kind === 'current') {
			// 補不上（斷線太久）：換成伺服器的樣子，還沒送到的步不算；連回來時跟「連上了。」一起說
			const unsent = this.#queue.length;
			this.#dropQueue();
			this.#seen = m.step;
			const lost = unsent ? `換成伺服器現在的樣子，還沒送到的 ${unsent} 步沒存進去。` : '';
			if (this.offline) this.#lostOnReconnect = lost;
			this.#reset(m.flow as Flow, this.offline || !lost ? this.#session.notice : lost);
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
			this.#seen = Math.max(this.#seen, m.step);
			this.#session.applyRemote(m.change as RemoteChange, m.by);
		} else if (m.kind === 'recordsSaved') {
			this.#saved(m.saved, m.dropped);
		} else if (m.kind === 'newRecords') {
			this.#others(m.records, []);
		} else if (m.kind === 'recordsChanged') {
			this.#others(m.changed, m.deleted);
		} else if (m.stepId !== this.#queue[0]?.id) {
			return;
		} else if (m.kind === 'accepted') {
			// 連回來時補上的別人的步可能比我這一步新
			this.#seen = Math.max(this.#seen, m.step);
			this.#queue = this.#queue.slice(1);
			this.#sendHead();
		} else {
			// 退回：這一步和後面還沒送的一起不要，換成伺服器的樣子
			const label = this.#queue[0].label;
			this.#seen = m.step;
			this.#dropQueue();
			this.#reset(m.flow as Flow, m.by === undefined ? m.message : sentBack(m.by, label, m.message));
		}
	}

	/** 還沒被伺服器收的步都不算：清掉，也從復原、重做紀錄拿掉。 */
	#dropQueue() {
		this.#session.dropSteps(this.#queue.map((s) => s.id));
		this.#queue = [];
	}

	/** 換成伺服器的樣子（不帶紀錄）：帶著現在的紀錄（對不上的丟掉，跟復原一樣）。 */
	#reset(flow: Flow, message: string) {
		const now = this.#session.flow;
		this.#session.reset(now ? carryRecords(flow, now) : flow, message);
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
	#saved(saved: CloudRecord[], dropped: { id: string }[]) {
		const batch = new Set(this.#batches.shift()?.ids ?? []);
		const later = new Set(this.#batches.flatMap((b) => b.ids));
		const kept = new Map(saved.map((r) => [attemptOf(r).id, r]));
		const rows = dropped.flatMap((d) => this.#unsent.get(d.id)?.row ?? []);
		for (const id of batch) this.#unsent.delete(id);
		const flow = this.#session.flow;
		if (!flow) return this.#touch();
		const records = takeRecords(flow).records.flatMap((r) => {
			const server = kept.get(r.attempt.id);
			if (later.has(r.attempt.id)) return [r];
			if (server) return [stored(server)];
			return batch.has(r.attempt.id) ? [] : [r];
		});
		const have = new Set(records.map((r) => r.attempt.id));
		const back = saved.filter((r) => !have.has(attemptOf(r).id) && !later.has(attemptOf(r).id));
		this.#session.serverRecords(putRecords(flow, [...records, ...back.map(stored)]));
		if (rows.length) this.#session.droppedRecords = [...this.#session.droppedRecords, ...rows];
		this.#touch();
	}

	/**
	 * 別人（或我在別的分頁）記的、改的、刪的，或別人的一步跟著改、清掉的（#258）：
	 * 有的換成伺服器的樣子，沒有的放進畫面，刪掉的拿掉；不是自己記的記下名字。
	 */
	#others(incoming: CloudRecord[], deleted: string[]) {
		const flow = this.#session.flow;
		if (!flow) return;
		const gone = new Set(deleted);
		const fresh = new Map(incoming.map((r) => [attemptOf(r).id, r]));
		const records = takeRecords(flow).records.flatMap((r) => {
			if (gone.has(r.attempt.id)) return [];
			const server = fresh.get(r.attempt.id);
			fresh.delete(r.attempt.id);
			return [server ? stored(server) : r];
		});
		const names = Object.fromEntries(incoming.flatMap((r) => (r.mine ? [] : [[attemptOf(r).id, r.by ?? '']])));
		this.#session.recordedBy = { ...this.#session.recordedBy, ...names };
		this.#session.serverRecords(putRecords(flow, [...records, ...[...fresh.values()].map(stored)]));
	}

	/** 擁有者改了我的權限。降成記錄者、檢視者：還沒送到的步不算，換成伺服器的樣子並提示。 */
	#roleChanged(role: Role, flow: Flow, step: number) {
		const could = canEdit(this.role);
		this.role = role;
		this.#lock();
		if (canEdit(role)) {
			// 移交（#252）：擁有者、編輯者之間換，本來就能改
			this.#session.notice = could ? `你現在是${ROLE_NAMES[role]}。` : `你現在是${ROLE_NAMES[role]}，可以改了。`;
			return;
		}
		const unsent = this.#queue.length;
		this.#dropQueue();
		this.#seen = step;
		const lost = unsent ? `還沒送到的 ${unsent} 步沒存進去。` : '';
		this.#reset(flow, `你現在是${ROLE_NAMES[role]}，只能看。${lost}`);
	}
}

/** 別人在我上次看到之後改過，我的一步被退回的提示：by 是最後改的人，reason 是被規則擋下的原因（改到同一個東西是空的）。 */
function sentBack(by: string, label: string, reason: string): string {
	return reason ? `${by}剛改了流程，你的「${label}」沒改成：${reason}` : `${by}剛改了同一個地方，你的「${label}」沒改成`;
}

/** 伺服器送來的一次（流程核心的 Attempt）。 */
const attemptOf = (r: CloudRecord) => r.attempt as StoredAttempt['attempt'];
/** 伺服器送來的一次放回流程的樣子。 */
const stored = (r: CloudRecord): StoredAttempt => ({ actionId: r.actionId, attempt: attemptOf(r) });

/** 沒存進去時表上那一列：記的當下的日期、動作、組（或隊員）、記號（之後動作、組可能被刪掉，名字先記下來）。 */
function droppedRow(flow: Flow, { actionId, attempt }: StoredAttempt): DroppedRecord {
	const action = flow.actions.find((a) => a.id === actionId)!;
	const who = perPerson(action.category) ? memberName(flow, attempt.who) : squadName(flow, action, attempt.who);
	return {
		id: attempt.id,
		date: attempt.date,
		action: actionLabel(action),
		who,
		marks: attemptText(action, attempt),
		runThrough: attempt.practice === 'runThrough'
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
