// 雲端流程的復原紀錄（#256，ADR 0014；#308 階段 2 從編輯 session 搬出來）：復原紀錄的雲端 adapter，歸 CloudSteps
// （CloudSteps 建一個、打開時交給 session.undoLog，關掉時換回本機的）。
// 管：一步存那一步改到的東西改之前、改之後的樣子（改動）和送出去的步驟 id（方向鍵合成的有好幾個）；復原、重做當成新的一步
// 送出去（send，CloudSteps 排隊送伺服器），清單順序照流程核心的 travelChange；一步收了，重做換成伺服器做出來的改動
// （acceptedAs）；被退回、沒送到的步拿掉（drop）。
// 不管：送伺服器、排隊、退回時換上什麼流程（CloudSteps）；換上流程之後的事（session）；本機流程的復原（LocalUndo）。

import { changeLabel, joinUndo, travelChange, undoChanges, undone, type Flow, type RemoteChange, type UndoChanges } from '#lib/core';
import { newStepId, type SentStep } from '#lib/ask.svelte.js';
import { whyText } from '#lib/reason-text.js';
import { UNDO_LIMIT, type NewStep, type Travel, type UndoLog } from '#lib/undo-log.svelte.js';

/**
 * 雲端流程送伺服器的一步：一串指令，或復原、重做（#256）：
 * of 是要復原的那一步的步驟 id（重做是復原那一步的），change 是要放回去的樣子。
 */
export type CloudStep = SentStep | { id: string; undo: { of: string; redo: boolean; change: RemoteChange } };

/**
 * 雲端流程的一步：那一步改到的東西改之前、改之後的樣子（changes）和送出去的步驟 id（ids）；
 * 復原過的還存復原前畫面上的清單順序（shown，重做時加回來的照這裡的位置放）。
 */
type CloudUndoStep = { label: string; ids: string[]; changes: UndoChanges; shown?: RemoteChange['orders'] };

/** 清單的 id 順序。 */
const idsOf = (flow: Flow, list: string) => (flow[list as keyof RemoteChange['orders']] as { id: string }[]).map((x) => x.id);

export class CloudUndo implements UndoLog {
	readonly stored = true;
	readonly #send: (step: CloudStep, label: string, before: Flow, after: Flow) => void;
	#undo = $state.raw<CloudUndoStep[]>([]);
	#redo = $state.raw<CloudUndoStep[]>([]);

	/** send：一步（改的、復原、重做）交給它送伺服器，帶這一步改了什麼（被退回時的提示用）和改之前、改之後的流程。 */
	constructor(send: (step: CloudStep, label: string, before: Flow, after: Flow) => void) {
		this.#send = send;
	}

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

	/** 送伺服器（存好了由 CloudSteps 說）；沒送的不記。合成一步的改動照第一步之前到現在。 */
	record({ before, after, label, sent, joined }: NewStep): string | null {
		if (!sent) return null;
		const said = label ?? whyText(changeLabel(before, after));
		this.#send(sent, said, before, after);
		const changes = undoChanges(before, after);
		const last = joined ? this.#undo.at(-1) : undefined;
		const step = last
			? { label: said, ids: [...last.ids, sent.id], changes: joinUndo(last.changes, changes) }
			: { label: said, ids: [sent.id], changes };
		this.#undo = (last ? [...this.#undo.slice(0, -1), step] : [...this.#undo, step]).slice(-UNDO_LIMIT);
		this.#redo = [];
		return said;
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
	 * 把那一步改到的東西放回改之前（重做是改之後）的樣子，畫面先改，再當成新的一步送伺服器
	 * （of 是那一步的步驟 id，方向鍵合成的是第一個）；另一邊記下這次送的步驟 id。
	 */
	#travel(before: Flow, redo: boolean): Travel | null {
		const from = redo ? this.#redo : this.#undo;
		const step = from.at(-1);
		if (!step) return null;
		const id = newStepId();
		const { undo, redo: again } = step.changes;
		const change = travelChange(before, step.changes, redo, redo ? (step.shown ?? again.orders) : undo.orders);
		const back: CloudUndoStep = { label: step.label, ids: [id], changes: step.changes };
		// 復原：記下復原前畫面上的順序（重做時加回來的照這裡的位置放）
		if (!redo) back.shown = Object.fromEntries(Object.keys(again.orders).map((list) => [list, idsOf(before, list)]));
		const flow = undone(before, change);
		this.#send({ id, undo: { of: step.ids[0], redo, change } }, step.label, before, flow);
		const to = [...(redo ? this.#undo : this.#redo), back];
		if (redo) [this.#undo, this.#redo] = [to, from.slice(0, -1)];
		else [this.#undo, this.#redo] = [from.slice(0, -1), to];
		return { flow, label: step.label };
	}

	/**
	 * 自己的一步收了：那一步的重做換成伺服器做出來的改動（change），不是這邊畫面上的
	 * （例：兩個人同時加隊員，後到的被放在別的位置；照畫面上的重做會跟別人加的人疊在一起）。合成一步的，最後一步收了才換。
	 * 順序照畫面上的：伺服器的順序裡有別人加的，照它重做會把別人後來調的順序調回去。
	 */
	acceptedAs(stepId: string, change: RemoteChange) {
		const redo = { things: change.things, orders: {} };
		this.#undo = this.#undo.map((s) =>
			s.ids.at(-1) === stepId ? { ...s, changes: joinUndo(s.changes, { undo: { things: [], orders: {} }, redo }) } : s
		);
	}

	/** 被退回、沒送到的步（步驟 id）不算：從復原、重做拿掉。 */
	drop(ids: string[]) {
		const dropped = (s: CloudUndoStep) => s.ids.some((id) => ids.includes(id));
		this.#undo = this.#undo.filter((s) => !dropped(s));
		this.#redo = this.#redo.filter((s) => !dropped(s));
	}
}
