// 雲端流程一步一步存（#248，ADR 0007、0011）：流程檔打開雲端流程時建一個，換流程就關掉。
// 連這支流程的房間，先打招呼（指紋、分頁 id、上次看到第幾步）。session 改好的一步交給它（session.onstep）：
// 畫面先改、不等伺服器；一次送一步，伺服器收了才送下一步。
// 被退回：還沒送的步一起不要，畫面換成伺服器的樣子，原因放進提示。指紋不一樣：有新版，請重新整理，先不能改。
// 權限（#250）：記錄者、檢視者只能看；被降級馬上換檢視模式、還沒送到的步不算並提示；被收回叫 onrevoked（回首頁）。
// 別人的改動、改到同一個東西在 #253、#254；斷線在 #255。
// 成功率紀錄（#257，ADR 0008）：記一次（session 的「記」交給 onrecord）把新的那幾次送進同一個房間，不算一步。
// 伺服器回收了的（換成伺服器存的樣子）和沒存進去的（從畫面拿掉，列進紅條的表，按「知道了」才清）；
// 別人記的馬上放進畫面，記號後面寫名字。檢視者不能記。伺服器的樣子（退回、權限改了）不帶紀錄，換上時帶著現在的紀錄。
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
	type StoredAttempt
} from '#lib/core';
import type { SentStep } from '#lib/ask.svelte.js';
import { CORE_FINGERPRINT } from '#lib/core-fingerprint.js';
import type { DroppedRecord, EditorSession } from '#lib/editor-session.svelte.js';
import { canEdit, ROLE_NAMES } from '#lib/role-names.js';
import type { CloudRecord, FlowRoom, Role, RoomMessage } from '#lib/server-api.js';

/** 有新版時不能改的原因。 */
export const NEW_VERSION = '有新版，請重新整理';
/** 記錄者、檢視者不能改的原因。 */
export const ONLY_VIEW = '你只能看這支流程';

/** 這個分頁的 id：伺服器記每一步是哪個分頁送的（同一個人的兩個分頁也算別人）。 */
const TAB_ID = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join('');

export class CloudSteps {
	readonly #room: FlowRoom;
	readonly #session: EditorSession;
	/** 還沒被伺服器收的步（第一個送出去了，等它回答）。 */
	#queue = $state.raw<SentStep[]>([]);
	/** 伺服器說可以送步了（指紋對）。 */
	#ready = false;
	/** 上次看到第幾步。 */
	#seen: number;
	/** 記了、伺服器還沒回答的那幾次：id → 送的那一次和沒存進去時表上那一列（記的當下的動作、組的名字）。 */
	#unsent = new Map<string, { record: StoredAttempt; row: DroppedRecord }>();
	/** 送出去、等回答的每一批（照送的先後，伺服器照順序回）。 */
	#batches: string[][] = [];
	/** 指紋不一樣：有新版。 */
	newVersion = $state(false);
	/** 我對這支流程的權限。 */
	role = $state<Role>('owner');
	/** 被收回了（或在別的分頁離開了）：流程檔接上（回首頁說原因）。 */
	onrevoked: () => void = () => {};

	/** 連 room（這支流程的房間），從第 step 步開始，我的權限是 role；session 改好的步交給它。 */
	constructor(room: FlowRoom, step: number, session: EditorSession, role: Role = 'owner') {
		this.#room = room;
		this.#session = session;
		this.#seen = step;
		this.role = role;
		this.#lock();
		room.onmessage = (m) => this.#heard(m);
		room.send({ kind: 'hello', fingerprint: CORE_FINGERPRINT, tabId: TAB_ID, seen: step });
		session.onstep = (s) => this.#push(s);
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

	/** 換流程：不再收發。 */
	close() {
		this.#room.onmessage = () => {};
		this.#room.close();
		this.#session.onstep = null;
		this.#session.onrecord = null;
		this.#session.readOnly = '';
		this.#session.cannotRecord = '';
	}

	/** 不能改的原因放進 session：有新版優先。 */
	#lock() {
		this.#session.readOnly = this.newVersion ? NEW_VERSION : canEdit(this.role) ? '' : ONLY_VIEW;
		this.#session.cannotRecord = this.newVersion ? NEW_VERSION : this.role === 'viewer' ? ONLY_VIEW : '';
	}

	#push(step: SentStep) {
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
		} else if (m.kind === 'newVersion') {
			this.newVersion = true;
			this.#lock();
		} else if (m.kind === 'revoked') {
			this.#queue = [];
			this.onrevoked();
		} else if (m.kind === 'roleChanged') {
			this.#roleChanged(m.role, m.flow as Flow, m.step);
		} else if (m.kind === 'recordsSaved') {
			this.#saved(m.saved, m.dropped);
		} else if (m.kind === 'newRecords') {
			this.#others(m.records);
		} else if (m.stepId !== this.#queue[0]?.id) {
			return;
		} else if (m.kind === 'accepted') {
			this.#seen = m.step;
			this.#queue = this.#queue.slice(1);
			this.#sendHead();
		} else {
			// 退回：這一步和後面還沒送的一起不要，換成伺服器的樣子
			this.#seen = m.step;
			this.#queue = [];
			this.#reset(m.flow as Flow, m.message);
		}
	}

	/** 換成伺服器的樣子（不帶紀錄）：帶著現在的紀錄（對不上的丟掉，跟復原一樣）。 */
	#reset(flow: Flow, message: string) {
		const now = this.#session.flow;
		this.#session.reset(now ? carryRecords(flow, now) : flow, message);
	}

	/** 記了：新的那幾次（id 不在記之前的）送伺服器。刪、改在 #258。 */
	#recorded(before: Flow, after: Flow) {
		const had = new Set(takeRecords(before).records.map((r) => r.attempt.id));
		const added = takeRecords(after).records.filter((r) => !had.has(r.attempt.id));
		for (const record of added) this.#unsent.set(record.attempt.id, { record, row: droppedRow(after, record) });
		if (this.#ready) this.#sendRecords(added.map((r) => r.attempt.id));
	}

	#sendRecords(ids: string[]) {
		if (!ids.length) return;
		this.#batches.push(ids);
		this.#room.send({ kind: 'record', attempts: ids.map((id) => this.#unsent.get(id)!.record) });
	}

	/** 伺服器回我送的那一批：收了的換成伺服器存的樣子，沒存進去的拿掉、列進紅條；收過又被清掉的也拿掉。 */
	#saved(saved: CloudRecord[], dropped: { id: string }[]) {
		const batch = new Set(this.#batches.shift() ?? []);
		const kept = new Map(saved.map((r) => [attemptOf(r).id, r]));
		const rows = dropped.flatMap((d) => this.#unsent.get(d.id)?.row ?? []);
		for (const id of batch) this.#unsent.delete(id);
		const flow = this.#session.flow;
		if (!flow) return;
		const records = takeRecords(flow).records.flatMap((r) => {
			const server = kept.get(r.attempt.id);
			if (server) return [{ actionId: server.actionId, attempt: attemptOf(server) }];
			return batch.has(r.attempt.id) ? [] : [r];
		});
		this.#session.serverRecords(putRecords(flow, records));
		if (rows.length) this.#session.droppedRecords = [...this.#session.droppedRecords, ...rows];
	}

	/** 別人（或我在別的分頁）記的：放進畫面（已經有的不重複），別人記的記下名字。 */
	#others(incoming: CloudRecord[]) {
		const flow = this.#session.flow;
		if (!flow) return;
		const { records } = takeRecords(flow);
		const have = new Set(records.map((r) => r.attempt.id));
		const added = incoming.filter((r) => !have.has(attemptOf(r).id));
		if (!added.length) return;
		const names = Object.fromEntries(added.flatMap((r) => (r.by ? [[attemptOf(r).id, r.by]] : [])));
		this.#session.recordedBy = { ...this.#session.recordedBy, ...names };
		const more = added.map((r) => ({ actionId: r.actionId, attempt: attemptOf(r) }));
		this.#session.serverRecords(putRecords(flow, [...records, ...more]));
	}

	/** 擁有者改了我的權限。降成記錄者、檢視者：還沒送到的步不算，換成伺服器的樣子並提示。 */
	#roleChanged(role: Role, flow: Flow, step: number) {
		this.role = role;
		this.#lock();
		if (canEdit(role)) {
			this.#session.notice = `你現在是${ROLE_NAMES[role]}，可以改了。`;
			return;
		}
		const unsent = this.#queue.length;
		this.#queue = [];
		this.#seen = step;
		const lost = unsent ? `還沒送到的 ${unsent} 步沒存進去。` : '';
		this.#reset(flow, `你現在是${ROLE_NAMES[role]}，只能看。${lost}`);
	}
}

/** 伺服器送來的一次（流程核心的 Attempt）。 */
const attemptOf = (r: CloudRecord) => r.attempt as StoredAttempt['attempt'];

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
