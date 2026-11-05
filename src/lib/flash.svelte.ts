// 一下子就收掉的提示（例：「已存」「已刪掉」）：show 之後過幾秒自己收掉；再 show 一次就換掉、重算。
// 滑鼠在提示上時停住倒數（hold），免得要按的「復原」「救回」在手底下消失。

/** 提示留幾毫秒（跟編排的提示泡泡一樣）。 */
export const FLASH_MS = 5000;
/** 有反悔按鈕（「復原」「救回」）的提示留幾毫秒：要看完畫面再決定，留久一點。 */
export const UNDO_FLASH_MS = 10_000;

export class Flash<T> {
	value = $state<T | null>(null);
	#timer: ReturnType<typeof setTimeout> | undefined;
	/** 倒數到什麼時候（Date.now()）。 */
	#ends = 0;
	/** 停住時還剩幾毫秒；沒停住是 null。 */
	#left: number | null = null;

	show(value: T, ms = FLASH_MS) {
		this.clear();
		this.value = value;
		this.#count(ms);
	}

	/** on：停住倒數；off：把剩下的時間走完。 */
	hold(on: boolean) {
		if (this.value === null || on === (this.#left !== null)) return;
		if (on) {
			clearTimeout(this.#timer);
			this.#left = Math.max(0, this.#ends - Date.now());
		} else {
			const left = this.#left!;
			this.#left = null;
			this.#count(left);
		}
	}

	clear() {
		clearTimeout(this.#timer);
		this.#left = null;
		this.value = null;
	}

	#count(ms: number) {
		this.#ends = Date.now() + ms;
		this.#timer = setTimeout(() => (this.value = null), ms);
	}
}
