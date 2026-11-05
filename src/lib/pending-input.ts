// 沒送出的字：文字、數字欄位在 change（離開欄位、按 Enter）時才送進流程。這個 module 回答三件事：
// 有沒有打了還沒送出的字、現在送出（跟離開欄位一樣）、當作已經送出了（例：復原換上舊的流程）。
// 編輯器 module 收它（關分頁前的提醒、service worker 擋重新整理、存檔、欄位裡按 ⌘Z）；對話框關掉前也先送出。
// 真的（domPendingInput）看 DOM，假的（#lib/test-fakes.js 的 fakePendingInput）給 Node 測試用。

export interface PendingInput {
	/** 焦點所在的欄位打了字還沒送出（打了又刪回原來的字也算）。 */
	readonly pending: boolean;
	/** 現在送出：欄位的值跟上次送出的不一樣，就跟離開欄位一樣發 change。之後就沒有沒送出的字。 */
	flush(): void;
	/** 當作已經送出了：欄位被畫面改了值（例：復原換上舊的流程），現在的值不用再送。 */
	settle(): void;
}

type Field = HTMLInputElement | HTMLTextAreaElement;

/** 焦點所在的欄位、它上次送出時的值、之後教練有沒有在裡面打字（畫面自己改的值不算打字）。 */
let typing: { el: Field; value: string; typed: boolean } | null = null;

function isTextField(el: EventTarget | null): el is Field {
	return (
		(el instanceof HTMLInputElement && !['checkbox', 'radio', 'file', 'button', 'submit', 'reset'].includes(el.type)) ||
		el instanceof HTMLTextAreaElement
	);
}

/** 送出了（或當作送出了）：現在的值算上次送出的。 */
function sent(t: NonNullable<typeof typing>) {
	t.value = t.el.value;
	t.typed = false;
}

if (typeof window !== 'undefined') {
	window.addEventListener(
		'focusin',
		(e) => (typing = isTextField(e.target) ? { el: e.target, value: e.target.value, typed: false } : null),
		true
	);
	window.addEventListener(
		'input',
		(e) => {
			if (typing && e.target === typing.el) typing.typed = true;
		},
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
		if (typing && e.target === typing.el) sent(typing);
	});
}

/** 真的：看焦點所在的欄位（瀏覽器、jsdom）。 */
export const domPendingInput: PendingInput = {
	get pending() {
		return !!typing && typing.typed && document.activeElement === typing.el;
	},
	flush() {
		const t = typing;
		if (!t || document.activeElement !== t.el) return;
		if (t.el.value !== t.value) t.el.dispatchEvent(new Event('change', { bubbles: true }));
		sent(t);
	},
	settle() {
		if (typing) sent(typing);
	}
};
