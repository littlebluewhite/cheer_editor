// 右邊欄很長時，問句和被擋的原因常在看得到的範圍下面，按了像沒反應：出現時捲過去。
// 等下一格才捲：按 Tab 送出時，瀏覽器會在同一格把焦點的下一個欄位捲進來，先捲的會被蓋掉。

/**
 * attachment：出現後的下一格把它捲進看得到的範圍。
 * again 每次變了也再捲一次（例：原因還在，又被擋一次）：`{@attach reveal(ask.failures)}`。
 */
export function reveal(again?: unknown) {
	void again;
	return (el: Element) => {
		const id = requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest' }));
		return () => cancelAnimationFrame(id);
	};
}

/**
 * attachment：被擋下的原因、錯誤訊息。標成 role="alert"（報讀器念出來），出現時跟 reveal 一樣捲進看得到的範圍：
 * `<p class="error" {@attach revealAlert(ask.failures)}>`。畫面上的 role="alert" 都走這裡（source-guards.test.ts 擋），
 * 新寫的錯誤訊息不會漏了捲出來。
 */
export function revealAlert(again?: unknown) {
	const show = reveal(again);
	return (el: Element) => {
		el.setAttribute('role', 'alert');
		return show(el);
	};
}

/**
 * attachment：黏在捲動容器底部的那一條（position: sticky; bottom: 0）。量自己多高，寫進最近的捲動容器的 --sticky-bottom；
 * 容器用 `scroll-padding-bottom: var(--sticky-bottom)` 告訴瀏覽器下面這一塊被蓋住（WCAG 2.4.11 的 C43）：
 * Tab 聚焦、reveal()、錯誤訊息捲進來時都停在它上面，不用每個欄位自己留 scroll-margin。
 * 要量版面（jsdom 沒有 ResizeObserver），由 scripts/check-layout.mjs 的遮擋掃描檢查。
 */
export function stickyBottom(el: HTMLElement) {
	if (typeof ResizeObserver === 'undefined') return;
	let scroller = el.parentElement;
	while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
	if (!scroller) return;
	const box = scroller;
	// 黏住時離容器底部還隔著容器的下內距（sticky 黏在扣掉內距的範圍裡），一起算進被蓋住的那一塊
	const covered = () => box.style.setProperty('--sticky-bottom', `${el.offsetHeight + parseFloat(getComputedStyle(box).paddingBottom)}px`);
	// 一出現就先量一次：同時出現的 reveal() 在下一格捲，那時 ResizeObserver 還沒回報
	covered();
	const ro = new ResizeObserver(covered);
	ro.observe(el);
	return () => {
		ro.disconnect();
		box.style.removeProperty('--sticky-bottom');
	};
}
