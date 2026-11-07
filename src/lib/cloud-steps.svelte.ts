// 雲端流程一步一步存（#248，ADR 0007、0011）：流程檔打開雲端流程時建一個，換流程就關掉。
// 連這支流程的房間，先打招呼（指紋、分頁 id、上次看到第幾步、在編輯還是檢視）。session 改好的一步交給它（session.onstep）：
// 畫面先改、不等伺服器；一次送一步，伺服器收了才送下一步。
// 被退回：還沒送的步一起不要，畫面換成伺服器的樣子，原因放進提示。指紋不一樣：有新版，請重新整理，先不能改。
// 權限（#250）：記錄者、檢視者只能看；被降級馬上換檢視模式、還沒送到的步不算並提示；被收回叫 onrevoked（回首頁）。
// 別人的改動（#253）：伺服器送來改好的東西，套在自己的畫面上（session.applyRemote），不關掉開著的表單。
// 誰開著（#253）：伺服器說的在場名單（自己不列）；換編輯、檢視模式就告訴伺服器（setEditing）。
// 擁有者刪了這支（#252）：叫 ondeleted（回首頁並說原因）。
// 改到同一個東西（#254）：被退回時伺服器說最後改到的人（by），提示寫「王教練剛改了同一個地方，你的「改流程名字」沒改成」，
// 被規則擋下再加上原因。斷線在 #255。
// 成功率紀錄（#257，ADR 0008）：記一次（session 的「記」交給 onrecord）把新的那幾次送進同一個房間，不算一步。
// 伺服器回收了的（換成伺服器存的樣子）和沒存進去的（從畫面拿掉，列進紅條的表，按「知道了」才清）；
// 別人記的馬上放進畫面，記號後面寫名字。檢視者不能記。
// 改、刪、救回（#258）也從這裡送；伺服器回那幾次現在的樣子（記錄者動別人的不算，換回來）。別人改的、刪的，
// 別人的一步跟著改、清掉的紀錄，馬上換掉。記錄者只能改、刪自己記的（session.ownRecordsOnly）。伺服器的樣子（退回、權限改了）不帶紀錄，換上時帶著現在的紀錄。
// 斷網時記的（還沒傳的留在這台）在 #260。

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
import type { SentStep } from '#lib/ask.svelte.js';
import { CORE_FINGERPRINT } from '#lib/core-fingerprint.js';
import type { DroppedRecord, EditorSession } from '#lib/editor-session.svelte.js';
import { canEdit, ROLE_NAMES } from '#lib/role-names.js';
import type { CloudRecord, FlowRoom, Present, Role, RoomMessage, RoomRequest } from '#lib/server-api.js';

/** 有新版時不能改的原因。 */
export const NEW_VERSION = '有新版，請重新整理';
/** 記錄者、檢視者不能改的原因。 */
export const ONLY_VIEW = '你只能看這支流程';

/** 這個分頁的 id：伺服器記每一步是哪個分頁送的（同一個人的兩個分頁也算別人）。 */
const TAB_ID = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join('');

export class CloudSteps {
	readonly #room: FlowRoom;
	readonly #session: EditorSession;
	/** 還沒被伺服器收的步和它改了什麼（第一個送出去了，等它回答）。 */
	#queue = $state.raw<(SentStep & { label: string })[]>([]);
	/** 伺服器說可以送步了（指紋對）。 */
	#ready = false;
	/** 上次看到第幾步。 */
	#seen: number;
	/** 記了、伺服器還沒回答的那幾次：id → 送的那一次和沒存進去時表上那一列（記的當下的動作、組的名字）。 */
	#unsent = new Map<string, { record: StoredAttempt; row: DroppedRecord }>();
	/** 送出去、等回答的每一批（照送的先後，伺服器照順序回）。 */
	#batches: string[][] = [];
	/** 還沒連上時改、刪、救回的（連上就送）：那一批的 id 和要送的。 */
	#amends: { ids: string[]; request: RoomRequest }[] = [];
	/** 這個分頁刪掉的那幾次：又出現（救回）就送「救回」，不是新增。 */
	#deleted = new Set<string>();
	/** 指紋不一樣：有新版。 */
	newVersion = $state(false);
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

	/** 連 room（這支流程的房間），從第 step 步開始，我的權限是 role；session 改好的步交給它。 */
	constructor(room: FlowRoom, step: number, session: EditorSession, role: Role = 'owner') {
		this.#room = room;
		this.#session = session;
		this.#seen = step;
		this.role = role;
		session.sharedRecords = true;
		this.#lock();
		room.onmessage = (m) => this.#heard(m);
		this.#editing = !session.viewing && canEdit(role);
		room.send({ kind: 'hello', fingerprint: CORE_FINGERPRINT, tabId: TAB_ID, seen: step, editing: this.#editing });
		session.onstep = (s, label) => this.#push({ ...s, label });
		session.onrecord = (before, after) => this.#recorded(before, after);
	}

	/** 只能看（有新版，或我是記錄者、檢視者）：一律檢視模式，「編輯」按不了。 */
	get viewOnly(): boolean {
		return this.newVersion || !canEdit(this.role);
	}

	/** 還有步在送（名字旁「存中…」）。 */
	get saving(): boolean {
		return this.#queue.length > 0;
	}

	/** 換成編輯或檢視模式：跟上次說的不一樣才告訴伺服器（在場名單用）。 */
	setEditing(editing: boolean) {
		if (editing === this.#editing) return;
		this.#editing = editing;
		this.#room.send({ kind: 'mode', editing });
	}

	/** 換流程：不再收發。 */
	close() {
		this.#room.onmessage = () => {};
		this.#room.close();
		this.#session.onstep = null;
		this.#session.onrecord = null;
		this.#session.readOnly = '';
		this.#session.cannotRecord = '';
		this.#session.sharedRecords = false;
		this.#session.ownRecordsOnly = false;
	}

	/** 不能改的原因放進 session：有新版優先。記錄者只能改、刪自己記的。 */
	#lock() {
		this.#session.readOnly = this.newVersion ? NEW_VERSION : canEdit(this.role) ? '' : ONLY_VIEW;
		this.#session.cannotRecord = this.newVersion ? NEW_VERSION : this.role === 'viewer' ? ONLY_VIEW : '';
		this.#session.ownRecordsOnly = this.role === 'recorder';
	}

	#push(step: SentStep & { label: string }) {
		this.#queue = [...this.#queue, step];
		if (this.#queue.length === 1) this.#sendHead();
	}

	#sendHead() {
		const head = this.#queue[0];
		if (!head || !this.#ready) return;
		this.#room.send({ kind: 'step', stepId: head.id, seen: this.#seen, commands: head.commands });
	}

	#heard(m: RoomMessage) {
		if (m.kind === 'ready') {
			this.#ready = true;
			this.#sendHead();
			this.#sendRecords([...this.#unsent.keys()]);
			for (const { ids, request } of this.#amends.splice(0)) this.#send(ids, request);
		} else if (m.kind === 'newVersion') {
			this.newVersion = true;
			this.#lock();
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
			this.#seen = m.step;
			this.#queue = this.#queue.slice(1);
			this.#sendHead();
		} else {
			// 退回：這一步和後面還沒送的一起不要，換成伺服器的樣子
			const label = this.#queue[0].label;
			this.#seen = m.step;
			this.#queue = [];
			this.#reset(m.flow as Flow, m.by === undefined ? m.message : sentBack(m.by, label, m.message));
		}
	}

	/** 換成伺服器的樣子（不帶紀錄）：帶著現在的紀錄（對不上的丟掉，跟復原一樣）。 */
	#reset(flow: Flow, message: string) {
		const now = this.#session.flow;
		this.#session.reset(now ? carryRecords(flow, now) : flow, message);
	}

	/**
	 * 記了：比對記之前、之後，新的那幾次送「記」，改了記號的送「改」，不見的送「刪」，
	 * 這個分頁刪過又出現的（救回）送「救回」（#258）。
	 */
	#recorded(before: Flow, after: Flow) {
		const old = new Map(takeRecords(before).records.map((r) => [r.attempt.id, r]));
		const now = takeRecords(after).records;
		const ids = new Set(now.map((r) => r.attempt.id));
		const added = now.filter((r) => !old.has(r.attempt.id) && !this.#deleted.has(r.attempt.id));
		const restored = now.filter((r) => !old.has(r.attempt.id) && this.#deleted.has(r.attempt.id)).map((r) => r.attempt.id);
		const changed = now.filter((r) => old.has(r.attempt.id) && old.get(r.attempt.id)!.attempt !== r.attempt);
		const removed = [...old.keys()].filter((id) => !ids.has(id));
		for (const record of added) this.#unsent.set(record.attempt.id, { record, row: droppedRow(after, record) });
		if (this.#ready) this.#sendRecords(added.map((r) => r.attempt.id));
		for (const id of restored) this.#deleted.delete(id);
		for (const id of removed) this.#deleted.add(id);
		if (changed.length) this.#send(changed.map((r) => r.attempt.id), { kind: 'changeRecords', attempts: changed });
		if (removed.length) this.#send(removed, { kind: 'deleteRecords', ids: removed });
		if (restored.length) this.#send(restored, { kind: 'restoreRecords', ids: restored });
	}

	#sendRecords(ids: string[]) {
		if (!ids.length) return;
		this.#send(ids, { kind: 'record', attempts: ids.map((id) => this.#unsent.get(id)!.record) });
	}

	/** 送一批紀錄（ids 是這一批的那幾次，等伺服器照順序回）；還沒連上就先留著，連上再送。 */
	#send(ids: string[], request: RoomRequest) {
		if (!this.#ready) {
			if (request.kind !== 'record') this.#amends.push({ ids, request });
			return;
		}
		this.#batches.push(ids);
		this.#room.send(request);
	}

	/**
	 * 伺服器回我送的那一批：收了的換成伺服器存的樣子，沒存進去的拿掉、列進紅條；收過又被清掉的也拿掉。
	 * 改、刪、救回：伺服器上還在的換成它的樣子（刪不掉的放回來），不在的拿掉。後面還有一批在等的那幾次先不動（等那一批的回答）。
	 */
	#saved(saved: CloudRecord[], dropped: { id: string }[]) {
		const batch = new Set(this.#batches.shift() ?? []);
		const later = new Set(this.#batches.flat());
		const kept = new Map(saved.map((r) => [attemptOf(r).id, r]));
		const rows = dropped.flatMap((d) => this.#unsent.get(d.id)?.row ?? []);
		for (const id of batch) this.#unsent.delete(id);
		const flow = this.#session.flow;
		if (!flow) return;
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
		this.#queue = [];
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
