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
