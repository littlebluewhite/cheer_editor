// 按下之後跟著滑鼠或手指拖（拖出元素外也跟得到）。

/**
 * 在 window 上聽 pointermove 和 pointerup：移動時呼叫 onmove；放開時拿掉監聽，再呼叫 onup。
 * 也聽 pointercancel（觸控被系統打斷）：拿掉監聽，呼叫 oncancel，不呼叫 onup。
 * 只聽按下的那一根（down.pointerId）：拖的時候多放一根手指，不會把拖的東西搶走。
 */
export function followPointer(
	down: PointerEvent,
	onmove: (e: PointerEvent) => void,
	onup: () => void = () => {},
	oncancel: () => void = () => {}
) {
	const mine = (e: PointerEvent) => e.pointerId === down.pointerId;
	const stop = () => {
		window.removeEventListener('pointermove', move);
		window.removeEventListener('pointerup', up);
		window.removeEventListener('pointercancel', cancel);
	};
	const move = (e: PointerEvent) => {
		if (mine(e)) onmove(e);
	};
	const up = (e: PointerEvent) => {
		if (!mine(e)) return;
		stop();
		onup();
	};
	const cancel = (e: PointerEvent) => {
		if (!mine(e)) return;
		stop();
		oncancel();
	};
	window.addEventListener('pointermove', move);
	window.addEventListener('pointerup', up);
	window.addEventListener('pointercancel', cancel);
}

/** 手指按在還沒選中的東西上：不拖，讓畫面捲動；點一下會選中它，選中了才拖得動（docs/adr/0005-ipad-touch.md）。 */
export function touchOnUnpicked(e: PointerEvent, picked: boolean): boolean {
	return e.pointerType === 'touch' && !picked;
}
