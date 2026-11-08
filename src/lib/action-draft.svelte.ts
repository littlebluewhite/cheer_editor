// 動作表單的草稿：表單上還沒送出的動作。沒選動作時是新動作（新增），選了動作時是那個動作（改了馬上送出）。
// 編輯器 module 握著一個（getEditor().actionDraft）；動作表單只畫它、把欄位和按鈕接上來。
// 它要看 session 的選取和播放頭，所以放在編輯器 module：session 換了流程或選取、播放頭動了，都叫 follow()，草稿照規則跟上。
// 送出時開始、長度由核心讀（readStart、readLength），看不懂就是被擋，原因跟指令被擋一樣交給 ask。

import {
	actionLabel,
	actionSeconds,
	actionSlotAt,
	addAction,
	atText,
	busyMembers,
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
import type { EditorSession, UpdateReason } from '#lib/editor-session.svelte.js';

/** 播放頭（全域秒數）。 */
interface Playhead {
	readonly sec: number;
	seek(sec: number): void;
}

/** 跟著播放頭的兩個欄位。 */
type SlotField = 'startText' | 'lengthText';

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

/** 收起來的新動作草稿：欄位和打過字的開始、長度。 */
interface Kept {
	draft: Draft;
	typed: Set<SlotField>;
}

/** 上次跟上的：選到的動作（同一個 id 改過也是新的）、選人（session 每次選都換一個新的陣列）、播放頭那一格和它那段的種類、自訂任務角色。 */
interface Seen {
	action: Action | null;
	selection: string[];
	slot: string;
	kind: Segment['kind'] | undefined;
	roles: Flow['customRoles'];
}

export class ActionDraft {
	readonly #session: EditorSession;
	readonly #playhead: Playhead;
	#draft = $state<Draft>(blank([]));
	/** null：沒開流程（表單不在），開了流程就從頭建。 */
	#seen: Seen | null = null;
	/** 新增時開始、長度不再跟著播放頭的欄位：教練打過字的（換了草稿才放掉），和正有焦點的那一個。 */
	#typed = new Set<SlotField>();
	#focused: SlotField | null = null;
	/** 去選別的動作時收起來的新動作草稿：回到新增時拿回來。 */
	#kept: Kept | null = null;
	/** 換過大類的草稿（動作 id，新增是 ''）：換完還有人不是新大類的預設任務角色，就問要不要換（offerDefaultRoles）。 */
	#categoryChanged = $state<string | null>(null);
	/** 剛新增的動作和送出的草稿：復原掉這個動作、回到新增時拿回來。 */
	#added: { id: string; kept: Kept } | null = null;

	/** 選到的動作；null = 新增。 */
	readonly #action = $derived.by(() => this.#session.selectedAction);
	/** 新增時，播放頭那一格（新動作從這裡開始）。 */
	readonly #slot = $derived.by(() => {
		const flow = this.#session.flow;
		return flow && !this.#action ? actionSlotAt(flow, this.#playhead.sec) : null;
	});
	/** 草稿在哪一段：動作的段，或播放頭那一格的段；null = 還沒有段。 */
	readonly #segment = $derived.by(() => {
		const id = this.#action?.segmentId ?? this.#slot?.segmentId;
		return this.#session.flow?.segments.find((s) => s.id === id) ?? null;
	});

	/** 被擋的原因，和等教練回答的改動（會切短或拿掉拍點、會清掉紀錄；有紀錄的組換了人要選保留／清掉）。 */
	readonly ask: Ask;

	/** playhead：播放頭（新增後跳到新動作的結束）。 */
	constructor(session: EditorSession, playhead: Playhead) {
		this.#session = session;
		this.#playhead = playhead;
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
		this.#type('startText', text);
	}

	get lengthText(): string {
		return this.#draft.lengthText;
	}

	set lengthText(text: string) {
		this.#type('lengthText', text);
	}

	/** 開始或長度欄有焦點（null：離開了）：有焦點的欄位不跟著播放頭變，離開了沒打過字就再跟上。 */
	focusSlotField(field: SlotField | null) {
		this.#focused = field;
		if (!field && !this.#action) this.#toSlot();
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
		this.#categoryChanged = this.#action?.id ?? '';
	}

	/** 剛換過大類，有人的任務角色不是新大類的預設值：可以一次換成預設任務角色（useDefaultRoles）。 */
	get offerDefaultRoles(): boolean {
		if (this.#categoryChanged !== (this.#action?.id ?? '')) return false;
		const defaults = this.#defaultRoles();
		return this.#draft.members.some((m, i) => m.role !== defaults[i].role);
	}

	/** 每個人的任務角色都換成這個大類的預設值（照全局角色）。改動作時一樣要再叫 update() 送出。 */
	useDefaultRoles() {
		this.#set('members', this.#defaultRoles());
		this.#categoryChanged = null;
	}

	#defaultRoles(): ActionMember[] {
		const cleared = this.#draft.members.map((m) => ({ ...m, role: null }));
		return defaultRoles(this.#session.flow!, this.#draft.category, cleared);
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
		this.addMembers([memberId]);
	}

	/** 加好幾個人（「把選的 N 人加進來」）：任務角色照大類和全局角色先填。 */
	addMembers(memberIds: string[]) {
		const flow = this.#session.flow!;
		const added = memberIds.map((id) => newActionMember(flow, id, this.#draft.category));
		this.#setMembers([...this.#draft.members, ...added]);
	}

	/**
	 * 草稿這段時間裡已經在別的動作裡的人：隊員 id → 那個動作（表單標出來、「＋加人…」的選項也標）。
	 * 開始、長度看不懂時是空的。
	 */
	get busy(): Map<string, Action> {
		const segment = this.#segment;
		if (!segment) return new Map();
		const read = this.#read(segment);
		return read.kind === 'ok' ? busyMembers(this.#session.flow!, { ...read.value, id: this.#action?.id }) : new Map();
	}

	/** 拿掉草稿裡同一時間在別的動作裡的人（「拿掉這幾個人」）。 */
	dropBusy() {
		const busy = this.busy;
		this.#setMembers(this.#draft.members.filter((m) => !busy.has(m.memberId)));
	}

	/** 把第 i 個人移出。 */
	removeMember(i: number) {
		this.#setMembers(this.#draft.members.filter((_, j) => j !== i));
	}

	/**
	 * 「從別的動作複製人」：連任務角色和組一起換進來。改動作時馬上送出（整批取代不問，會動到紀錄才問），
	 * 換成功就提示「已取代…」，旁邊有「復原」。新增時只換草稿的人。
	 */
	copyMembers(source: Action) {
		this.#setMembers(source.members.map((m) => ({ ...m })));
		const before = this.#session.flow;
		this.update(() => {
			if (this.#session.flow === before) return;
			const text = `已取代：人換成「${actionLabel(source)}」的 ${source.members.length} 人`;
			this.#session.toast(text, { label: '復原', name: '復原取代的人' });
		});
	}

	/**
	 * 新增動作（「新增動作」鈕、在名稱、開始、長度欄按 Enter）：成功就選到新的動作，播放頭跳到它的結束（下一個動作從這裡接）。
	 * 選到的人清掉：下一次拖人不會整隊一起走。
	 */
	add() {
		const segment = this.#segment;
		if (this.#action || !segment) return;
		const input = this.#read(segment);
		const sent = this.#keep();
		this.ask.send(() => (input.kind === 'blocked' ? input : addAction(this.#session.flow!, input.value)), {
			done: (r) => {
				this.#session.selectAction(r.id);
				this.#session.selectMembers([]);
				const flow = this.#session.flow!;
				this.#playhead.seek(actionSeconds(flow, flow.actions.find((a) => a.id === r.id)!).endSec);
				this.#kept = null;
				this.#added = { id: r.id, kept: sent };
			}
		});
	}

	/**
	 * 「接下一個動作」（例如 Lib 轉接成金字塔）：開一張新動作表單，開始接在選到的動作的結束拍（播放頭跳過去），
	 * 大類、人、任務角色、組都帶過去。打到一半的新動作草稿換成這一張。
	 */
	next() {
		const action = this.#action;
		if (!action) return;
		const flow = this.#session.flow!;
		this.#kept = { draft: { ...blank(action.members.map((m) => ({ ...m }))), category: action.category }, typed: new Set() };
		this.#playhead.seek(actionSeconds(flow, action).endSec);
		// 先選人再回到新增：回到新增時草稿的人照選到的人，從收起來的草稿拿任務角色和組。
		this.#session.selectMembers(action.members.map((m) => m.memberId));
		this.#session.selectAction(null);
	}

	/** 改選到的動作：馬上送給流程核心；被擋（或問了按取消）就還原，成功就叫 done。新增時什麼都不做（等按「新增動作」）。 */
	update(done?: () => void) {
		const action = this.#action;
		const segment = this.#segment;
		if (!action || !segment) return;
		const id = action.id;
		const input = this.#read(segment);
		this.ask.send(
			(o: ConfirmOption = {}) =>
				input.kind === 'blocked' ? input : updateAction(this.#session.flow!, id, input.value, o),
			{ revert: () => this.#reset(), done }
		);
	}

	/** 換成另一支流程（開檔、救回草稿）：上一支沒送出的草稿、收起來的草稿都不要了，從空白的重來。 */
	restart() {
		this.#seen = null;
		this.#kept = this.#added = null;
		this.follow();
	}

	/**
	 * session 換了流程或選取、播放頭動了：草稿跟上。
	 * 換了選到的動作（或回到新增）：草稿照動作重設；紅字和問題收掉。
	 * 回到新增時拿回去選別的動作前收起來的草稿（復原掉剛新增的動作時，拿回送出的草稿），沒有就是空白的。
	 * reason：session 為什麼叫（播放頭動了是沒給）。只有復原（undo）才算「復原掉剛新增的動作」；
	 * 按刪除、段縮短刪掉它不算，表單不帶它的字（N20）。
	 * 新增時：自訂任務角色改名、刪掉，草稿裡的人跟著換名字、變成沒有任務；人跟著選的人；
	 * 開始和長度跟著播放頭那一格（打過字、正有焦點的欄位不跟；換到另一種段時打過字的也跟）。
	 * （改動作時草稿照動作重設：動作裡的人核心已經改好了。）
	 */
	follow(reason?: UpdateReason) {
		const flow = this.#session.flow;
		if (!flow) {
			this.#seen = null;
			this.#kept = this.#added = null;
			return;
		}
		const action = this.#action;
		const selection = this.#session.selectedMemberIds;
		const slot = this.#slot;
		const slotKey = slot ? `${slot.segmentId}:${slot.start}:${slot.length}` : '';
		const seen = this.#seen;
		const kind = this.#segment?.kind;
		this.#seen = { action, selection, slot: slotKey, kind, roles: flow.customRoles };
		if (!seen || action !== seen.action) {
			if (seen && !seen.action) this.#kept = this.#keep();
			if (action?.id !== seen?.action?.id) this.#categoryChanged = null;
			const undone = reason === 'undo' && seen?.action && this.#added?.id === seen.action.id && !flow.actions.some((a) => a.id === seen.action!.id);
			// 復原掉剛新增的動作：新增時清掉的人也選回來（草稿的人跟著選取）
			if (undone) this.#session.selectMembers(this.#added!.kept.draft.members.map((m) => m.memberId));
			this.#reset(undone ? this.#added!.kept : this.#kept);
			this.ask.clear();
			return;
		}
		if (action) return;
		if (flow.customRoles !== seen.roles) this.#renameRoles(seen.roles, flow.customRoles);
		if (selection !== seen.selection) {
			this.#set('members', this.#fromSelection(this.#draft.members, this.#draft.category));
		}
		// 播放頭換到另一種段（音樂段八拍、口號段秒）：打過的開始、長度是舊段的寫法，看不懂，改回跟著播放頭。
		if (kind !== seen.kind) this.#typed.clear();
		if (slotKey !== seen.slot) this.#toSlot();
	}

	/**
	 * 草稿照選到的動作重設。新增時拿回收起來的草稿（kept），沒有就是空白的：人是選到的人（收起來的人保留任務角色），
	 * 沒打過字的開始和長度是播放頭那一格。
	 */
	#reset(kept: Kept | null = null) {
		const action = this.#action;
		if (action) {
			this.#draft = fromAction(this.#session.flow!, action);
			return;
		}
		const draft = kept ? { ...kept.draft } : blank([]);
		this.#draft = { ...draft, members: this.#fromSelection(draft.members, draft.category) };
		this.#typed = new Set(kept?.typed);
		this.#toSlot();
	}

	/** 新動作草稿收起來的樣子（復原、回到新增時拿回來）。 */
	#keep(): Kept {
		return { draft: { ...this.#draft, members: this.#draft.members.map((m) => ({ ...m })) }, typed: new Set(this.#typed) };
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

	/** 開始和長度改成播放頭那一格（沒有段時不動）；打過字、正有焦點的欄位不動。 */
	#toSlot() {
		const slot = this.#slot;
		const segment = this.#segment;
		if (!slot || !segment) return;
		const follows = (field: SlotField) => !this.#typed.has(field) && this.#focused !== field;
		if (follows('startText')) this.#set('startText', atText(segment, slot.start));
		if (follows('lengthText')) this.#set('lengthText', lengthText(segment, slot.length));
	}

	/** 教練在開始或長度欄打字：新增時這一欄不再跟著播放頭。 */
	#type(field: SlotField, text: string) {
		if (!this.#action && this.#draft[field] !== text) this.#typed.add(field);
		this.#set(field, text);
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
