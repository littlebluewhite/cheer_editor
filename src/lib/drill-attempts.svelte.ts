// 分段練正在記的一次：記錄頁每張卡的「這次練」和點了還沒存的記號。編輯 session 握著一個（session.drill）。
// 管：每張卡（動作加組或隊員）的這次練（整個，或只練幾個環節、勾了哪些）；每張卡每一天點了還沒存的記號，
//   和只練幾個環節時最近一次到存的時機點的環節（跟記號放一起、一起清，換頁再回來還是等一樣的環節）；
//   點一顆記號之後的整串事（留哪些記號、要不要記時機點、現在要不要存）；存（送「記一次」）、「全部 ✓ 存」；
//   換整個／只練幾個環節、改勾的環節時把點到一半的清掉；換一支流程時全部清掉（session 叫 clear）。
// 回答：卡上亮哪些記號、哪些按不了、是不是跳過了前面的環節、在等哪些、這張卡這一天有沒有還沒存的。
// 不管：一次的規則（在流程核心，這裡只問它）；存好之外的提示、刪掉上一次、救回、這天每一次的那一排、改某一次（卡片管）；
//   練習的權限（送的 ask 自己擋）。不存進流程檔。
// 全上表（session.drill.runThrough → RunThroughTable）：這張表正在記的，只活在表開著的時候（表握著它，關掉就沒了）。
//   管點過的格子、按了沒做的動作、每一欄會存下來的樣子、有沒有改過、要存的是哪些；
//   不管一起記全上誰拿著哪幾組、存（表照舊用自己的 ask 送）。哪一欄是我記的由表告訴它（mine）。

import {
	attemptWhos,
	blankPhases,
	fillOk,
	keptAttempt,
	pickedAutoSave,
	recordableActions,
	type Action,
	type Flow,
	type Mark,
	type Phase,
	type RunThroughMarks
} from '#lib/core';
import type { Ask } from '#lib/ask.svelte.js';
import { m } from '#lib/paraglide/messages.js';

/** 這次練：whole 整個做，不是就只練 picked 這幾個環節。 */
interface Scope {
	whole: boolean;
	picked: string[];
}

/** 一張卡一天點了還沒存的：記號（環節 id → 記號），和最近一次到存的時機點的環節。 */
interface Pending {
	marks: Record<string, Mark>;
	trigger?: string;
}

const WHOLE: Scope = { whole: true, picked: [] };

export class DrillAttempts {
	readonly #store: Store;

	/** notify：寫提示（編輯器唯一的提示；空的是收掉）。 */
	constructor(notify: (text: string) => void) {
		this.#store = new Store(notify);
	}

	/** 一張卡（動作、組或隊員 who、哪一天）；存的時候用 ask 送（被擋的原因留在 ask 上）。動作改了要重拿一張。 */
	card(action: Action, who: string, date: string, ask: Ask): DrillCard {
		return new DrillCard(this.#store, action, who, date, ask);
	}

	/** 這張卡這一天有沒有點了還沒存的（不是這次要練的環節的記號不算）。左邊動作清單也問它。 */
	hasUnsaved(action: Action, who: string, date: string): boolean {
		return Object.keys(this.#store.unsaved(action, who, date)).length > 0;
	}

	/** 一張新的全上表：flow 拿現在的流程，mine 說哪一欄是我記的。每次拿都是空的（表握著它）。 */
	runThrough(flow: () => Flow, mine: (action: Action, who: string) => boolean): RunThroughTable {
		return new RunThroughTable(flow, mine);
	}

	/** 換一支流程：全部清掉（id 會跟上一支重複）。 */
	clear() {
		this.#store.clear();
	}
}

/** 握著的狀態（不給 module 外面）：每張卡的這次練、每張卡每一天點了還沒存的。 */
class Store {
	/** 每張卡上次選的這次練，key 是「動作 id 組或隊員 id」。換動作、切頁再回來還是它。 */
	#scopes = $state<Record<string, Scope>>({});
	/** 每張卡每一天點了還沒存的，key 是這次練的 key 加上日期。換動作、切頁再回來還在。 */
	#pending = $state<Record<string, Pending>>({});
	readonly notify: (text: string) => void;

	constructor(notify: (text: string) => void) {
		this.notify = notify;
	}

	clear() {
		this.#scopes = {};
		this.#pending = {};
	}

	scope(action: Action, who: string): Scope {
		return this.#scopes[`${action.id} ${who}`] ?? WHOLE;
	}

	/** 換這次練：這一天點到一半的清掉。 */
	setScope(action: Action, who: string, date: string, scope: Scope) {
		this.#scopes[`${action.id} ${who}`] = scope;
		this.setPending(action, who, date, { marks: {} });
	}

	pending(action: Action, who: string, date: string): Pending {
		return this.#pending[`${action.id} ${who} ${date}`] ?? { marks: {} };
	}

	/** 記號清空時時機點也清掉。 */
	setPending(action: Action, who: string, date: string, next: Pending) {
		this.#pending[`${action.id} ${who} ${date}`] = Object.keys(next.marks).length ? next : { marks: {} };
	}

	/** 點了還沒存的記號，只算這次要練的環節（在編排刪掉了、別天改成只練別的環節的不算）。 */
	unsaved(action: Action, who: string, date: string): Record<string, Mark> {
		const planned = plannedPhases(action, this.scope(action, who));
		const { marks } = this.pending(action, who, date);
		return Object.fromEntries(Object.entries(marks).filter(([id]) => planned.some((p) => p.id === id)));
	}
}

/** 只有一個環節就是整個做（之前選的不算）。 */
const isWhole = (action: Action, scope: Scope) => scope.whole || (action.successRate?.phases.length ?? 0) < 2;
/** 這一次要練的環節，照順序。 */
function plannedPhases(action: Action, scope: Scope): Phase[] {
	const phases = action.successRate?.phases ?? [];
	return isWhole(action, scope) ? phases : phases.filter((p) => scope.picked.includes(p.id));
}

/** 記錄頁一張卡正在記的一次：卡片只畫它、把點的傳進來。 */
export class DrillCard {
	readonly #all: Store;
	readonly #action: Action;
	readonly #who: string;
	readonly #date: string;
	readonly #ask: Ask;

	constructor(all: Store, action: Action, who: string, date: string, ask: Ask) {
		this.#all = all;
		this.#action = action;
		this.#who = who;
		this.#date = date;
		this.#ask = ask;
	}

	get #phases(): Phase[] {
		return this.#action.successRate?.phases ?? [];
	}
	/** 整個做（只有一個環節也是）。 */
	get whole(): boolean {
		return isWhole(this.#action, this.#all.scope(this.#action, this.#who));
	}
	/** 只練幾個環節時勾的環節 id。 */
	get picked(): string[] {
		return this.#all.scope(this.#action, this.#who).picked;
	}
	/** 這一次要練的環節，照順序。 */
	get planned(): Phase[] {
		return plannedPhases(this.#action, this.#all.scope(this.#action, this.#who));
	}
	/** 點了還沒存的記號（只算這次要練的環節）。 */
	get marks(): Record<string, Mark> {
		return this.#all.unsaved(this.#action, this.#who, this.#date);
	}
	/** 這一天有點了還沒存的。 */
	get unsaved(): boolean {
		return Object.keys(this.marks).length > 0;
	}
	get #kept() {
		return blankPhases(this.#action, this.whole, this.marks);
	}
	/** 卡上亮的記號（核心決定留哪些）。 */
	get shown(): Record<string, Mark> {
		return this.#kept.marks;
	}
	/** 按不了的環節：✗ 做完之後才開始的。 */
	get shut(): string[] {
		return this.#kept.shut;
	}
	/** 選「整個」卻跳過了前面的環節。 */
	get skipping(): boolean {
		return this.#kept.skipped.length > 0;
	}
	/** 只練幾個環節、到了存的時機，還在等的環節（同時在做、還沒打的）；不在等是空的。 */
	get waiting(): string[] {
		if (this.whole) return [];
		const { trigger } = this.#all.pending(this.#action, this.#who, this.#date);
		return pickedAutoSave(this.#action, this.picked, this.shown, trigger).waiting;
	}

	/** 選整個做或只練幾個環節：點到一半的清掉。 */
	setWhole(whole: boolean) {
		this.#all.setScope(this.#action, this.#who, this.#date, { whole, picked: this.picked });
	}

	/** 勾或不勾一個要練的環節：點到一半的清掉。 */
	pick(id: string, on: boolean) {
		const picked = on ? [...this.picked, id] : this.picked.filter((p) => p !== id);
		this.#all.setScope(this.#action, this.#who, this.#date, { whole: this.whole, picked });
	}

	/**
	 * 點一個記號；再點一次點著的那顆就取消。只有一個環節、或只練幾個環節時點到最後一個要練的環節、點了 ✗，就存
	 * （只練幾個環節還有同時在做的沒打就先等，記住這次到存的時機點的環節）。
	 * 只留會存下來的記號：「整個」點了 ✗，後面點過的就丟掉，取消 ✗ 也不會再冒出來。
	 */
	tap(phaseId: string, mark: Mark) {
		this.#all.notify('');
		const shown = this.shown;
		const { trigger } = this.#all.pending(this.#action, this.#who, this.#date);
		if (shown[phaseId] === mark) {
			const { [phaseId]: _, ...rest } = shown;
			return this.#set({ marks: rest, trigger });
		}
		const marks = keptAttempt(this.#action, this.whole, { ...shown, [phaseId]: mark }).marks;
		if (this.#phases.length === 1) return this.#send(marks);
		if (this.whole) return this.#set({ marks });
		const next = mark === '✗' || phaseId === this.planned.at(-1)?.id ? phaseId : trigger;
		this.#set({ marks, trigger: next });
		const due = pickedAutoSave(this.#action, this.picked, { ...shown, [phaseId]: mark }, next);
		if (due.due && !due.waiting.length) this.save();
	}

	/** 存這一次：照點了的存（留哪些記號、算不算整個做由核心決定）。 */
	save() {
		this.#send(this.marks);
	}

	/** 「全部 ✓ 存」：已點的照點的，還能打、沒打的補 ✓。 */
	saveAllOk() {
		this.#send(fillOk(this.#action, this.shown));
	}

	#set(next: Pending) {
		this.#all.setPending(this.#action, this.#who, this.#date, next);
	}

	#send(marks: Record<string, Mark>) {
		this.#set({ marks: {} });
		const attempt = { date: this.#date, who: this.#who, practice: 'drill', whole: this.whole, marks } as const;
		this.#ask.send({ name: 'recordAttempt', args: [this.#action.id, attempt] }, { done: () => this.#all.notify(m.practice_saved()) });
	}
}

const NEXT: Record<Mark, Mark> = { '✓': '△', '△': '✗', '✗': '✓' };

/**
 * 全上表正在記的：每格先是 ✓，點一格 ✓ → △ → ✗ → ✓；一格變 ✗，同一組按不了的環節（✗ 做完之後才開始的）點過的清掉，
 * 佔同樣拍的留著，改回來是 ✓。「這個沒做」整個動作不存；「後面都沒做」這個和後面的都不存，再按一次都回來。
 */
export class RunThroughTable {
	readonly #flow: () => Flow;
	readonly #mine: (action: Action, who: string) => boolean;
	/** 點過的格子（key：動作|誰|環節）；沒點過的是 ✓。 */
	#picked = $state<Record<string, Mark>>({});
	/** 按了「這個沒做」的動作 id。 */
	#skipped = $state<string[]>([]);

	constructor(flow: () => Flow, mine: (action: Action, who: string) => boolean) {
		this.#flow = flow;
		this.#mine = mine;
	}

	/** 要記的動作照流程順序，每個動作的每一欄（組或隊員）。 */
	get blocks(): { action: Action; whos: ReturnType<typeof attemptWhos> }[] {
		const flow = this.#flow();
		return recordableActions(flow).map((action) => ({ action, whos: attemptWhos(flow, action) }));
	}

	/** 一欄每個環節點的記號（沒點過的是 ✓）。 */
	#tapped(action: Action, who: string): Record<string, Mark> {
		return Object.fromEntries(action.successRate!.phases.map((p) => [p.id, this.#picked[`${action.id}|${who}|${p.id}`] ?? '✓']));
	}

	/** 一欄照環節順序，是會存下來的樣子：按不了的環節、沒做的動作是空的（null）。 */
	column(action: Action, who: string): (Mark | null)[] {
		const ids = action.successRate!.phases.map((p) => p.id);
		if (this.skipped(action.id)) return ids.map(() => null);
		const kept = keptAttempt(action, true, this.#tapped(action, who)).marks;
		return ids.map((id) => kept[id] ?? null);
	}

	/** 點一格換下一個記號（空的格子點了沒用）；變 ✗ 就把同一組按不了的環節點過的清掉。 */
	tap(action: Action, who: string, phaseId: string) {
		const i = action.successRate!.phases.findIndex((p) => p.id === phaseId);
		const mark = this.column(action, who)[i];
		if (!mark) return;
		const next = NEXT[mark];
		this.#picked[`${action.id}|${who}|${phaseId}`] = next;
		if (next !== '✗') return;
		for (const id of blankPhases(action, true, this.#tapped(action, who)).shut) delete this.#picked[`${action.id}|${who}|${id}`];
	}

	/** 這個動作按了沒做。 */
	skipped(actionId: string): boolean {
		return this.#skipped.includes(actionId);
	}

	/** 「這個沒做」：按一次沒做，再按一次回來。 */
	toggleSkip(actionId: string) {
		this.#skipped = this.skipped(actionId) ? this.#skipped.filter((id) => id !== actionId) : [...this.#skipped, actionId];
	}

	/** 這個和後面的動作 id。 */
	#rest(actionId: string): string[] {
		const ids = this.blocks.map((b) => b.action.id);
		return ids.slice(ids.indexOf(actionId));
	}

	/** 這個和後面的動作都按了沒做。 */
	restSkipped(actionId: string): boolean {
		return this.#rest(actionId).every((id) => this.skipped(id));
	}

	/** 「後面都沒做」：這個和後面的都變沒做；已經都沒做就都回來。 */
	toggleRest(actionId: string) {
		const rest = this.#rest(actionId);
		this.#skipped = this.restSkipped(actionId)
			? this.#skipped.filter((id) => !rest.includes(id))
			: [...this.#skipped, ...rest.filter((id) => !this.#skipped.includes(id))];
	}

	/** 改過格子、按過沒做：取消、切頁要先問。 */
	get dirty(): boolean {
		return this.#skipped.length > 0 || Object.values(this.#picked).some((m) => m !== '✓');
	}

	/** 要存的：沒按沒做的動作裡、我記的欄。 */
	get entries(): RunThroughMarks[] {
		return this.blocks
			.filter(({ action }) => !this.skipped(action.id))
			.flatMap(({ action, whos }) =>
				whos.filter(({ who }) => this.#mine(action, who)).map(({ who }) => ({ actionId: action.id, who, marks: this.#tapped(action, who) }))
			);
	}
}
