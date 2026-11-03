// 按下之後跟著滑鼠拖（拖出元素外也跟得到）。

/**
 * 在 window 上聽 pointermove 和 pointerup：移動時呼叫 onmove；放開時拿掉監聽，再呼叫 onup。
 * 有給 oncancel 時也聽 pointercancel（觸控被系統打斷）：拿掉監聽，呼叫 oncancel，不呼叫 onup。
 */
export function followPointer(
	onmove: (e: PointerEvent) => void,
	onup: () => void = () => {},
	oncancel?: () => void
) {
	const stop = () => {
		window.removeEventListener('pointermove', onmove);
		window.removeEventListener('pointerup', up);
		window.removeEventListener('pointercancel', cancel);
	};
	const up = () => {
		stop();
		onup();
	};
	const cancel = () => {
		stop();
		oncancel?.();
	};
	window.addEventListener('pointermove', onmove);
	window.addEventListener('pointerup', up);
	if (oncancel) window.addEventListener('pointercancel', cancel);
}
