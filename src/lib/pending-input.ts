// 還沒送出的欄位：文字、數字欄位在 change（離開欄位、按 Enter）時才送進流程。
// 記下焦點所在的欄位和它上次送出時的值，不一樣就是還沒送出。
// 對話框關掉前、輸入框裡按 ⌘Z 前，先送出去（跟離開欄位一樣）。

type Field = HTMLInputElement | HTMLTextAreaElement;

let typing: { el: Field; value: string } | null = null;

function isTextField(el: EventTarget | null): el is Field {
	return (
		(el instanceof HTMLInputElement && !['checkbox', 'radio', 'file', 'button', 'submit', 'reset'].includes(el.type)) ||
		el instanceof HTMLTextAreaElement
	);
}

if (typeof window !== 'undefined') {
	window.addEventListener(
		'focusin',
		(e) => (typing = isTextField(e.target) ? { el: e.target, value: e.target.value } : null),
		true
	);
	// 值跟上次送出的一樣（例：⌘Z 退回之後離開欄位）：不再送一次，免得多記一步。捕獲階段，比欄位自己的處理早。
	window.addEventListener(
		'change',
		(e) => {
			if (typing && e.target === typing.el && typing.el.value === typing.value) e.stopImmediatePropagation();
		},
		true
	);
	// 掛在 window 的冒泡階段，比欄位自己的處理晚：送出、處理完之後才記下現在的值。
	window.addEventListener('change', (e) => {
		if (typing && e.target === typing.el) typing.value = typing.el.value;
	});
}

/** 焦點所在的欄位還有沒送出的字：跟離開欄位一樣送出去。 */
export function flushPendingInput(): void {
	const t = typing;
	if (!t || document.activeElement !== t.el || t.el.value === t.value) return;
	t.el.dispatchEvent(new Event('change', { bubbles: true }));
	t.value = t.el.value;
}

/** 欄位被畫面改了值（例：復原換上舊的流程）：現在的值算已經送出。 */
export function settlePendingInput(): void {
	if (typing) typing.value = typing.el.value;
}
