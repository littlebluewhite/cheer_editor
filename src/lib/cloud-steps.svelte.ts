// 雲端流程一步一步存（#248，ADR 0007、0011）：流程檔打開雲端流程時建一個，換流程就關掉。
// 連這支流程的房間，先打招呼（指紋、分頁 id、上次看到第幾步）。session 改好的一步交給它（session.onstep）：
// 畫面先改、不等伺服器；一次送一步，伺服器收了才送下一步。
// 被退回：還沒送的步一起不要，畫面換成伺服器的樣子，原因放進提示。指紋不一樣：有新版，請重新整理，先不能改。
// 別人的改動、改到同一個東西在 #253、#254；斷線在 #255。

import type { Flow } from '#lib/core';
import type { SentStep } from '#lib/ask.svelte.js';
import { CORE_FINGERPRINT } from '#lib/core-fingerprint.js';
import type { EditorSession } from '#lib/editor-session.svelte.js';
import type { FlowRoom, RoomMessage } from '#lib/server-api.js';

/** 有新版時不能改的原因。 */
export const NEW_VERSION = '有新版，請重新整理';

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

	/** 連 room（這支流程的房間），從第 step 步開始；session 改好的步交給它。 */
	constructor(room: FlowRoom, step: number, session: EditorSession) {
		this.#room = room;
		this.#session = session;
		this.#seen = step;
		room.onmessage = (m) => this.#heard(m);
		room.send({ kind: 'hello', fingerprint: CORE_FINGERPRINT, tabId: TAB_ID, seen: step });
		session.onstep = (s) => this.#push(s);
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
		this.#session.readOnly = '';
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
			this.#session.readOnly = NEW_VERSION;
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
}
