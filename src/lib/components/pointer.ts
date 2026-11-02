// 按下之後跟著滑鼠拖（拖出元素外也跟得到）。

/** 在 window 上聽 pointermove 和 pointerup：移動時呼叫 onmove；放開時拿掉監聽，再呼叫 onup。 */
export function followPointer(onmove: (e: PointerEvent) => void, onup: () => void = () => {}) {
	const up = () => {
		window.removeEventListener('pointermove', onmove);
		window.removeEventListener('pointerup', up);
		onup();
	};
	window.addEventListener('pointermove', onmove);
	window.addEventListener('pointerup', up);
}
