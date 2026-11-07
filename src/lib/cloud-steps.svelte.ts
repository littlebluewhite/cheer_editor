// 雲端流程一步一步存（#248，ADR 0007、0011）：流程檔打開雲端流程時建一個，換流程就關掉。
// 連這支流程的房間，先打招呼（指紋、分頁 id、上次看到第幾步、在編輯還是檢視）。session 改好的一步交給它（session.onstep）：
// 畫面先改、不等伺服器；一次送一步，伺服器收了才送下一步。
// 被退回：還沒送的步一起不要，畫面換成伺服器的樣子，原因放進提示。指紋不一樣：有新版，請重新整理，先不能改。
// 權限（#250）：記錄者、檢視者只能看；被降級馬上換檢視模式、還沒送到的步不算並提示；被收回叫 onrevoked（回首頁）。
// 別人的改動（#253）：伺服器送來改好的東西，套在自己的畫面上（session.applyRemote），不關掉開著的表單。
// 誰開著（#253）：伺服器說的在場名單（自己不列）；換編輯、檢視模式就告訴伺服器（setEditing）。
// 改到同一個東西在 #254；斷線在 #255。

import type { Flow, RemoteChange } from '#lib/core';
import type { SentStep } from '#lib/ask.svelte.js';
import { CORE_FINGERPRINT } from '#lib/core-fingerprint.js';
import type { EditorSession } from '#lib/editor-session.svelte.js';
import { canEdit, ROLE_NAMES } from '#lib/role-names.js';
import type { FlowRoom, Present, Role, RoomMessage } from '#lib/server-api.js';

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

	/** 連 room（這支流程的房間），從第 step 步開始，我的權限是 role；session 改好的步交給它。 */
	constructor(room: FlowRoom, step: number, session: EditorSession, role: Role = 'owner') {
		this.#room = room;
		this.#session = session;
		this.#seen = step;
		this.role = role;
		this.#lock();
		room.onmessage = (m) => this.#heard(m);
		this.#editing = !session.viewing && canEdit(role);
		room.send({ kind: 'hello', fingerprint: CORE_FINGERPRINT, tabId: TAB_ID, seen: step, editing: this.#editing });
		session.onstep = (s) => this.#push(s);
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
		this.#session.readOnly = '';
	}

	/** 不能改的原因放進 session：有新版優先。 */
	#lock() {
		this.#session.readOnly = this.newVersion ? NEW_VERSION : canEdit(this.role) ? '' : ONLY_VIEW;
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
		} else if (m.kind === 'newVersion') {
			this.newVersion = true;
			this.#lock();
		} else if (m.kind === 'revoked') {
			this.#queue = [];
			this.onrevoked();
		} else if (m.kind === 'roleChanged') {
			this.#roleChanged(m.role, m.flow as Flow, m.step);
		} else if (m.kind === 'present') {
			this.present = m.people;
		} else if (m.kind === 'changed') {
			this.#seen = Math.max(this.#seen, m.step);
			this.#session.applyRemote(m.change as RemoteChange, m.by);
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
			this.#session.reset(m.flow as Flow, m.message);
		}
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
		this.#session.reset(flow, `你現在是${ROLE_NAMES[role]}，只能看。${lost}`);
	}
}
