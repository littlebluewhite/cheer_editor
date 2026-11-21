// 復原紀錄（#308 階段 2）：編輯 session 跟復原、重做說話只用這幾件事：記一步、復原、重做、按鈕上的字、清掉。
// 後面有兩個 adapter，兩種做法不合併：本機流程的在這裡（LocalUndo，ADR 0007：整份流程的前後，復原帶回這一步清掉的紀錄）；
// 雲端流程的歸 CloudSteps（CloudUndo，ADR 0014：改動＋步驟 id，復原、重做送成一步）。
// 管：一步記什麼、復原重做換上哪一份流程、合成一步、最多幾步。
// 不管：什麼時候算合成一步（session 看 join 決定，傳 joined）、換上流程之後的事（選取、提示、播放都在 session 的 #swap）、
// 鎖著不能改（session 先擋）。

import { changeLabel, redoRecords, undoRecords, type Flow } from '#lib/core';
import type { SentStep } from '#lib/ask.svelte.js';
import { whyText } from '#lib/reason-text.js';

/** 復原最多幾步。 */
export const UNDO_LIMIT = 100;

/** 記一步：改之前、改之後的流程，label（沒給就比對改了什麼），送了什麼（雲端流程送伺服器），跟上一步合成一步（joined）。 */
export interface NewStep {
	before: Flow;
	after: Flow;
	label?: string;
	sent?: SentStep;
	joined: boolean;
}

/** 復原、重做換上的流程和那一步改了什麼（提示「已復原：…」）。 */
export interface Travel {
	flow: Flow;
	label: string;
}

export interface UndoLog {
	readonly canUndo: boolean;
	readonly canRedo: boolean;
	/** 按復原會退的那一步改了什麼（例：「插入站位 2」）；沒有是空字串。 */
	readonly undoLabel: string;
	/** 按重做會做回的那一步改了什麼；沒有是空字串。 */
	readonly redoLabel: string;
	/** 改、復原、重做換上的流程存在別處（雲端流程：伺服器）：換上了不算還沒存。 */
	readonly stored: boolean;
	/** 記一步，清掉重做。回傳這一步的 label；沒記（雲端流程沒送出去的）是 null，重做也不清。 */
	record(step: NewStep): string | null;
	/** 復原：flow 是現在的流程；回傳要換上的。沒有可以復原的是 null。 */
	undo(flow: Flow): Travel | null;
	/** 重做：跟復原一樣。 */
	redo(flow: Flow): Travel | null;
	/** 清掉復原和重做。 */
	clear(): void;
}

/** 本機流程的一步：改之前（flow）、改之後（after）的整份流程（復原時才算得出這一步清掉了哪些紀錄、加回去，ADR 0007）。 */
type LocalStep = { label: string; flow: Flow; after: Flow };

/** 本機流程（ADR 0007）：復原換上改之前的整份編排，帶著現在的紀錄，這一步清掉的紀錄加回來；重做再清一次。 */
export class LocalUndo implements UndoLog {
	readonly stored = false;
	/** 最舊的在前。指令都回傳新的流程，所以存參照就好。不存進草稿或檔案。 */
	#undo = $state.raw<LocalStep[]>([]);
	/** 復原掉的那幾步（最近復原的在後）。 */
	#redo = $state.raw<LocalStep[]>([]);

	get canUndo(): boolean {
		return this.#undo.length > 0;
	}

	get canRedo(): boolean {
		return this.#redo.length > 0;
	}

	get undoLabel(): string {
		return this.#undo.at(-1)?.label ?? '';
	}

	get redoLabel(): string {
		return this.#redo.at(-1)?.label ?? '';
	}

	record({ before, after, label, joined }: NewStep): string {
		const last = joined ? this.#undo.at(-1) : undefined;
		// 合成一步的：說的是從合之前到現在改了什麼
		const from = last ? last.flow : before;
		const step = { flow: from, after, label: label ?? whyText(changeLabel(from, after)) };
		this.#undo = (last ? [...this.#undo.slice(0, -1), step] : [...this.#undo, step]).slice(-UNDO_LIMIT);
		this.#redo = [];
		return step.label;
	}

	undo(flow: Flow): Travel | null {
		return this.#travel(flow, false);
	}

	redo(flow: Flow): Travel | null {
		return this.#travel(flow, true);
	}

	clear() {
		this.#undo = [];
		this.#redo = [];
	}

	/**
	 * 拿走這一邊最後一步、放進另一邊。放進去的改之前、改之後換成剛剛真的換上的兩份：中間用「記」刪掉、改過的紀錄，
	 * 下次重做、復原照這兩份算，不會拿最早存的紀錄蓋回去。
	 */
	#travel(now: Flow, redo: boolean): Travel | null {
		const from = redo ? this.#redo : this.#undo;
		const step = from.at(-1);
		if (!step) return null;
		const flow = redo ? redoRecords(step.flow, step.after, now) : undoRecords(step.flow, step.after, now);
		const back = redo ? { ...step, flow: now, after: flow } : { ...step, flow, after: now };
		const to = [...(redo ? this.#undo : this.#redo), back];
		if (redo) [this.#undo, this.#redo] = [to, from.slice(0, -1)];
		else [this.#undo, this.#redo] = [from.slice(0, -1), to];
		return { flow, label: step.label };
	}
}
