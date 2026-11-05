// 一下子就收掉的提示（例：「已存」「已刪掉」）：show 之後過幾秒自己收掉；再 show 一次就換掉、重算。

/** 提示留幾毫秒（跟編排的提示泡泡一樣）。 */
export const FLASH_MS = 5000;

export class Flash<T> {
	value = $state<T | null>(null);
	#timer: ReturnType<typeof setTimeout> | undefined;

	show(value: T) {
		clearTimeout(this.#timer);
		this.value = value;
		this.#timer = setTimeout(() => (this.value = null), FLASH_MS);
	}

	clear() {
		clearTimeout(this.#timer);
		this.value = null;
	}
}
