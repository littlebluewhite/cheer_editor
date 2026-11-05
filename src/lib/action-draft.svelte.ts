// 動作表單的草稿：表單上還沒送出的動作。沒選動作時是新動作（新增），選了動作時是那個動作（改了馬上送出）。
// 編輯器 module 握著一個（getEditor().actionDraft）；動作表單只畫它、把欄位和按鈕接上來。
// 它要看 session 的選取和播放頭，所以放在編輯器 module：session 換了流程或選取、播放頭動了，都叫 follow()，草稿照規則跟上。
// 送出時開始、長度由核心讀（readStart、readLength），看不懂就是被擋，原因跟指令被擋一樣交給 ask。

import {
	actionSlotAt,
	addAction,
	atText,
	defaultRoles,
	lengthText,
	readLength,
	readStart,
	updateAction,
	type Action,
	type ActionCategory,
	type ActionMember,
	type ConfirmOption,
	type Flow,
	type NewActionInput,
	type ReadResult,
	type Segment
} from '#lib/core';
import type { Ask } from '#lib/ask.svelte.js';
import type { EditorSession } from '#lib/editor-session.svelte.js';

interface Draft {
	category: ActionCategory;
	name: string;
	startText: string;
	lengthText: string;
	note: string;
	members: ActionMember[];
	/** 辨識色；undefined = 用大類的顏色。 */
	color: string | undefined;
}

/** 上次跟上的：選到的動作（同一個 id 改過也是新的）、選人（session 每次選都換一個新的陣列）、播放頭那一格、自訂任務角色。 */
interface Seen {
	action: Action | null;
	selection: string[];
	slot: string;
	roles: Flow['customRoles'];
}

export class ActionDraft {
	readonly #session: EditorSession;
	readonly #playheadSec: () => number;
	#draft = $state<Draft>(blank([]));
	/** null：沒開流程（表單不在），開了流程就從頭建。 */
	#seen: Seen | null = null;

	/** 選到的動作；null = 新增。 */
	readonly #action = $derived.by(() => this.#session.selectedAction);
	/** 新增時，播放頭那一格（新動作從這裡開始）。 */
	readonly #slot = $derived.by(() => {
		const flow = this.#session.flow;
		return flow && !this.#action ? actionSlotAt(flow, this.#playheadSec()) : null;
	});
	/** 草稿在哪一段：動作的段，或播放頭那一格的段；null = 還沒有段。 */
	readonly #segment = $derived.by(() => {
		const id = this.#action?.segmentId ?? this.#slot?.segmentId;
		return this.#session.flow?.segments.find((s) => s.id === id) ?? null;
	});

	/** 被擋的原因，和等教練回答的改動（會切短或拿掉拍點、會清掉紀錄；有紀錄的組換了人要選保留／清掉）。 */
	readonly ask: Ask;

	/** playheadSec：播放頭（全域秒數）。 */
	constructor(session: EditorSession, playheadSec: () => number) {
		this.#session = session;
		this.#playheadSec = playheadSec;
		this.ask = session.changeAsk();
		this.follow();
	}

	/** 選到的動作；null = 新增。 */
	get action(): Action | null {
		return this.#action;
	}

	/** 草稿在哪一段：動作的段，或新增時播放頭那一格的段；null = 還沒有段（不能加動作）。 */
	get segment(): Segment | null {
		return this.#segment;
	}

	get category(): ActionCategory {
		return this.#draft.category;
	}

	get members(): ActionMember[] {
		return this.#draft.members;
	}

	get color(): string | undefined {
		return this.#draft.color;
	}

	// 打的字（名稱、開始、長度、備註）：表單 bind 到這裡，改動作時要再叫 update() 送出。

	get name(): string {
		return this.#draft.name;
	}

	set name(text: string) {
		this.#set('name', text);
	}

	get startText(): string {
		return this.#draft.startText;
	}

	set startText(text: string) {
		this.#set('startText', text);
	}

	get lengthText(): string {
		return this.#draft.lengthText;
	}

	set lengthText(text: string) {
		this.#set('lengthText', text);
	}

	get note(): string {
		return this.#draft.note;
	}

	set note(text: string) {
		this.#set('note', text);
	}

	// 其他欄位：改動作時一樣要再叫 update() 送出。

	/** 換大類；新增時任務角色還是舊大類預設值的人跟著換（照全局角色重填），改過的不動。 */
	setCategory(category: ActionCategory) {
		const { members, category: from } = this.#draft;
		if (!this.#action) this.#set('members', defaultRoles(this.#session.flow!, category, members, from));
		this.#set('category', category);
	}

	/** 挑辨識色；undefined = 用大類的顏色。 */
	setColor(color: string | undefined) {
		this.#set('color', color);
	}

	/** 第 i 個人的任務角色（null 是沒有任務）。 */
	setRole(i: number, role: string | null) {
		const member = this.#draft.members[i];
		if (member.role === role) return;
		member.role = role;
		this.#edited();
	}

	/** 加一個人（「＋加人…」）：任務角色照大類和全局角色先填。 */
	addMember(memberId: string) {
		this.#setMembers([...this.#draft.members, newActionMember(this.#session.flow!, memberId, this.#draft.category)]);
	}

	/** 把第 i 個人移出。 */
	removeMember(i: number) {
		this.#setMembers(this.#draft.members.filter((_, j) => j !== i));
	}

	/** 「從別的動作複製人」：連任務角色和組一起換進來。 */
	copyMembers(source: Action) {
		this.#setMembers(source.members.map((m) => ({ ...m })));
	}

	/** 新增動作（「新增動作」鈕）：成功就選到新的動作。 */
	add() {
		const segment = this.#segment;
		if (this.#action || !segment) return;
		const input = this.#read(segment);
		this.ask.send(() => (input.kind === 'blocked' ? input : addAction(this.#session.flow!, input.value)), {
			done: (r) => this.#session.selectAction(r.id)
		});
	}

	/** 改選到的動作：馬上送給流程核心；被擋（或問了按取消）就還原。新增時什麼都不做（等按「新增動作」）。 */
	update() {
		const action = this.#action;
		const segment = this.#segment;
		if (!action || !segment) return;
		const id = action.id;
		const input = this.#read(segment);
		this.ask.send(
			(o: ConfirmOption = {}) =>
				input.kind === 'blocked' ? input : updateAction(this.#session.flow!, id, input.value, o),
			{ revert: () => this.#reset() }
		);
	}

	/**
	 * session 換了流程或選取、播放頭動了：草稿跟上。
	 * 換了選到的動作（或回到新增）：草稿照動作重設，新增是空白的；紅字和問題收掉。
	 * 新增時：自訂任務角色改名、刪掉，草稿裡的人跟著換名字、變成沒有任務；人跟著選的人；開始和長度跟著播放頭那一格。
	 * （改動作時草稿照動作重設：動作裡的人核心已經改好了。）
	 */
	follow() {
		const flow = this.#session.flow;
		if (!flow) {
			this.#seen = null;
			return;
		}
		const action = this.#action;
		const selection = this.#session.selectedMemberIds;
		const slot = this.#slot;
		const slotKey = slot ? `${slot.segmentId}:${slot.start}:${slot.length}` : '';
		const seen = this.#seen;
		this.#seen = { action, selection, slot: slotKey, roles: flow.customRoles };
		if (!seen || action !== seen.action) {
			this.#reset();
			this.ask.clear();
			return;
		}
		if (action) return;
		if (flow.customRoles !== seen.roles) this.#renameRoles(seen.roles, flow.customRoles);
		if (selection !== seen.selection) {
			this.#set('members', this.#fromSelection(this.#draft.members, this.#draft.category));
		}
		if (slotKey !== seen.slot) this.#toSlot();
	}

	/** 草稿照選到的動作重設；新增是空白的：人是選到的人，開始和長度是播放頭那一格。 */
	#reset() {
		const action = this.#action;
		if (action) {
			this.#draft = fromAction(this.#session.flow!, action);
			return;
		}
		this.#draft = blank(this.#fromSelection([], 'stunt'));
		this.#toSlot();
	}

	/** 改草稿的一格。真的變了，而且是新增：告訴 ask，收掉上次被擋的原因（可能已經不對了，按新增會再檢查一次）。 */
	#set<K extends keyof Draft>(key: K, value: Draft[K]) {
		if (this.#draft[key] === value) return;
		this.#draft[key] = value;
		this.#edited();
	}

	/** 草稿改了。改動作時不說：改了馬上送出，原因是那一下被擋、已還原的說明。 */
	#edited() {
		if (!this.#action) this.ask.edited();
	}

	/** 人改了。新增時人就是選到的人，所以也改選取（草稿再跟著選取）。 */
	#setMembers(members: ActionMember[]) {
		this.#set('members', members);
		if (!this.#action) this.#session.selectMembers(members.map((m) => m.memberId));
	}

	/** 選到的人當新動作的人；已經在表單裡的人保留任務角色，新來的照大類先填。 */
	#fromSelection(current: ActionMember[], category: ActionCategory): ActionMember[] {
		const flow = this.#session.flow!;
		return this.#session.selectedMemberIds
			.filter((id) => flow.members.some((m) => m.id === id))
			.map((id) => current.find((m) => m.memberId === id) ?? newActionMember(flow, id, category));
	}

	/** 自訂任務角色從 before 換成 now：改了名的換成新名字，刪掉的變成沒有任務。 */
	#renameRoles(before: Flow['customRoles'], now: Flow['customRoles']) {
		const renamed = new Map<string, string | null>();
		for (const r of before) {
			const name = now.find((x) => x.id === r.id)?.name ?? null;
			if (name !== r.name) renamed.set(r.name, name);
		}
		if (!renamed.size) return;
		const members = this.#draft.members.map((m) =>
			m.role !== null && renamed.has(m.role) ? { ...m, role: renamed.get(m.role)! } : m
		);
		this.#set('members', members);
	}

	/** 開始和長度改成播放頭那一格（沒有段時不動）。 */
	#toSlot() {
		const slot = this.#slot;
		const segment = this.#segment;
		if (!slot || !segment) return;
		this.#set('startText', atText(segment, slot.start));
		this.#set('lengthText', lengthText(segment, slot.length));
	}

	/** 草稿讀成動作：開始、長度由核心讀，看不懂就是被擋（原因交給 ask）。 */
	#read(segment: Segment): ReadResult<NewActionInput> {
		const start = readStart(segment, this.#draft.startText);
		if (start.kind === 'blocked') return start;
		const length = readLength(segment, this.#draft.lengthText);
		if (length.kind === 'blocked') return length;
		const { category, name, note, members, color } = this.#draft;
		const value = { segmentId: segment.id, category, name, start: start.value, length: length.value, note, members, color };
		return { kind: 'ok', value };
	}
}

/** 新增的空白草稿（技巧，沒填開始和長度）。 */
function blank(members: ActionMember[]): Draft {
	return { category: 'stunt', name: '', startText: '', lengthText: '', note: '', members, color: undefined };
}

/** 照動作填的草稿。 */
function fromAction(flow: Flow, a: Action): Draft {
	const seg = flow.segments.find((s) => s.id === a.segmentId)!;
	return {
		category: a.category,
		name: a.name,
		startText: atText(seg, a.start),
		lengthText: lengthText(seg, a.length),
		note: a.note,
		members: a.members.map((m) => ({ ...m })),
		color: a.color
	};
}

/** 剛加進動作的人：任務角色照大類和全局角色先填。 */
function newActionMember(flow: Flow, memberId: string, category: ActionCategory): ActionMember {
	return defaultRoles(flow, category, [{ memberId, role: null }])[0];
}
