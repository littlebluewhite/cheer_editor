// 字放不下被截短（「…」或輸入框裝不下）時，title 寫整段字，滑鼠移上去看得到（N42）；放得下就不留 title。
// 只用在自己沒有 title 的東西上：title 由這裡管，會被換掉、拿掉。

/** attachment：`<input {@attach truncate} />`、`<span class="name" {@attach truncate}>`。 */
export function truncate(el: HTMLElement) {
	const update = () => {
		const full = (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : (el.textContent ?? '')).trim();
		if (full && el.scrollWidth > el.clientWidth + 1) el.title = full;
		else el.removeAttribute('title');
	};
	update();
	// 打字、字換了、框變窄都重算；程式改了欄位的值不會有事件，滑鼠移上去、聚焦時再算一次
	const events = ['input', 'pointerenter', 'focus'] as const;
	for (const e of events) el.addEventListener(e, update);
	const mo = new MutationObserver(update);
	mo.observe(el, { characterData: true, childList: true, subtree: true });
	const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
	ro?.observe(el);
	return () => {
		for (const e of events) el.removeEventListener(e, update);
		mo.disconnect();
		ro?.disconnect();
	};
}
