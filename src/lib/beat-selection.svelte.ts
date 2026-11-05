// 拍點格子選的拍：選的範圍、固定的那一端（pivot）、放拍點時給誰。編輯 session 握著一個，跟著選到的動作。
// 拍點格子只管指標（點一下還是拖）、焦點和畫格子；選拍的規則都在這裡，在 Node 就測得到。
// 拍都是「從動作開始算的半拍」。格子對齊音樂的整拍：動作從 & 開始時，第一格是 1。

import { HALF_BEATS_PER_BEAT as BEAT, type Action, type Who } from '#lib/core';

/** 動作裡第一格（整拍）從動作開始算第幾個半拍；動作從 & 開始時是 1。拍點格子也用。 */
export const firstCell = (a: Action) => a.start % BEAT;
/** 動作裡最後一格。 */
const lastCell = (a: Action) => firstCell(a) + (Math.floor((a.length - firstCell(a)) / BEAT) - 1) * BEAT;
/** 這一格（從 at 開始的一拍）整個在動作裡。拍點格子也用。 */
export const fits = (a: Action, at: number) => at >= 0 && at + BEAT <= a.length;
/** 半拍 at 所在那一格的開頭。拍點格子也用。 */
export const cellIn = (a: Action, at: number) => at - ((((a.start + at) % BEAT) + BEAT) % BEAT);
/** 半拍 at 所在那一格，夾在動作的第一格和最後一格之間。 */
const snap = (a: Action, at: number) => Math.min(Math.max(cellIn(a, at), firstCell(a)), lastCell(a));
/** 給誰還在動作裡：全部，或動作裡的任務角色、隊員。 */
const whoIn = (a: Action, who: Who) =>
	who === null || a.members.some((m) => ('member' in who ? m.memberId === who.member : m.role === who.role));

export class BeatSelection {
	readonly #action: () => Action | null;
	/** 選到的拍：從 from 那一拍到 to 那一拍（各佔一拍）。平常是格子開頭；點從 & 開始的拍點時落在 &。 */
	#from = $state(0);
	#to = $state(0);
	/** 選取固定的那一端：上次沒按 Shift 點的那一格；拖的時候從這一格拖（錨點）。 */
	#pivot = 0;
	/** 上次看到的動作的第一格和長度：動作移到半拍上或變短時，才檢查選取。 */
	#shape = { first: 0, length: 0 };

	/** 放拍點時給誰；預設全部。 */
	who = $state<Who>(null);

	/** action：現在選到的動作（沒選是 null）。 */
	constructor(action: () => Action | null) {
		this.#action = action;
	}

	get from(): number {
		return this.#from;
	}

	get to(): number {
		return this.#to;
	}

	/** 選了幾個半拍。 */
	get len(): number {
		return this.#to - this.#from + BEAT;
	}

	/** 第 h 個半拍有沒有選到。 */
	covers(h: number): boolean {
		return h >= this.#from && h < this.#to + BEAT;
	}

	/**
	 * 點一格選一拍；按住 Shift 點，就從上次點的那一格選到這一格。
	 * 選取被別的地方換掉了（放完拍子跳下一拍、點拍點），Shift 就從選取的開頭算；
	 * 選取從 & 開始（點了這種拍點）時，從它所在的那一格算。
	 */
	click(at: number, shift = false) {
		const a = this.#action();
		if (!a) return;
		const keep = snap(a, !shift ? at : this.#from === this.#pivot || this.#to === this.#pivot ? this.#pivot : this.#from);
		at = snap(a, at);
		this.#pivot = keep;
		this.#from = Math.min(keep, at);
		this.#to = Math.max(keep, at);
	}

	/** 拖到一格：從按下的那一格（上次點的那一格）選到這一格；拖到動作外面停在動作的第一拍或最後一拍。 */
	dragTo(at: number) {
		const a = this.#action();
		if (!a) return;
		at = snap(a, at);
		this.#from = Math.min(this.#pivot, at);
		this.#to = Math.max(this.#pivot, at);
	}

	/**
	 * 方向鍵：左右移選取（選一拍）；加 Shift 從固定的那一端延長或縮短。
	 * 回動的那一端（焦點跟著它）；到動作頭尾就不動，回 null。
	 */
	arrow(dir: 1 | -1, shift: boolean): number | null {
		const a = this.#action();
		if (!a) return null;
		// 動的那一端：Shift 時是不固定的那一端；沒 Shift 時往右從最後一格、往左從第一格（從 & 開始的取它碰到的那一格）。
		const end = shift
			? snap(a, this.#from === this.#pivot ? this.#to : this.#from)
			: cellIn(a, (dir > 0 ? this.#to : this.#from) + 1);
		const to = end + dir * BEAT;
		if (!fits(a, to)) return null;
		this.click(to, shift);
		return to;
	}

	/** 點一個拍點或環節：選回它原本的範圍（從 & 開始的也照實）；拍點的給誰也換成它的。 */
	pick({ at, len }: { at: number; len: number }, who?: Who) {
		this.#from = at;
		this.#to = at + len - BEAT;
		this.#pivot = at;
		if (who !== undefined) this.who = who;
	}

	/** ＋、－：多選或少選一拍（動最後一拍）；最少一拍，不超出動作。 */
	grow(step: 1 | -1) {
		const a = this.#action();
		const to = this.#to + step * BEAT;
		if (a && to >= this.#from && fits(a, to)) this.#to = to;
	}

	/** 選下一拍（放完拍子）：選取後面那一拍；動作裡沒有就不動。回有沒有選。 */
	next(): boolean {
		const a = this.#action();
		const at = this.#to + BEAT;
		if (!a || !fits(a, at)) return false;
		this.#from = this.#to = at;
		return true;
	}

	/** 換了動作（session 叫）：從第一拍開始，給誰回到全部。 */
	reset() {
		const a = this.#action();
		if (!a) return;
		this.#from = this.#to = this.#pivot = firstCell(a);
		this.who = null;
		this.#shape = { first: firstCell(a), length: a.length };
	}

	/**
	 * 換上流程了（改的、復原、重做；session 叫）：給的人或角色不在動作裡了，給誰回到全部；
	 * 動作移到半拍上或變短，選取跑到外面或不在整拍上，就從第一拍開始。
	 */
	fit() {
		const a = this.#action();
		if (!a) return;
		if (!whoIn(a, this.who)) this.who = null;
		const first = firstCell(a);
		if (first === this.#shape.first && a.length === this.#shape.length) return;
		this.#shape = { first, length: a.length };
		if (!fits(a, this.#from) || !fits(a, this.#to) || (this.#from - first) % BEAT !== 0) {
			this.#from = this.#to = this.#pivot = first;
		}
	}
}
