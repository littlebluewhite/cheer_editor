// 鍵盤路由只有一份定義（G 群）：焦點所在的東西是不是打字的地方（isTextEntry），這個鍵是不是它自己要用的（ownsKey）。
// 編輯頁的快捷鍵（空白鍵播放、Home／End、方向鍵、Delete、數字鍵、⌘C／⌘V、Esc、按住 H 平移）先問 ownsKey，它要用就讓給它；
// 沒送出的字（pending-input）只看打字的欄位。
// 規則照 WAI-ARIA APG：checkbox 只用空白鍵、radio 用方向鍵，所以它們都不算打字的地方（N22）。

/** 不是打字的 input：按一下、勾、選檔、拉。 */
const NOT_TEXT = new Set(['checkbox', 'radio', 'file', 'button', 'submit', 'reset', 'image', 'color', 'range', 'hidden']);

const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

/** 對話框、選單裡按得下去、選得了的東西：空白鍵照瀏覽器原本的（按下、勾）。 */
const NATIVE_KEYS =
	'button, a[href], input, select, textarea, summary, [contenteditable]:not([contenteditable="false"]), ' +
	'[role="tab"], [role="checkbox"], [role="radio"], [role="switch"], [role="combobox"], [role="listbox"], [role="option"], [role="menuitem"]';
const IN_DIALOG = ':is(dialog, [role="dialog"], [role="alertdialog"])';

/** 打字的欄位：文字、數字、日期欄和多行欄（有 value 可以送出、退回的）。 */
export function isTextField(el: EventTarget | null): el is HTMLInputElement | HTMLTextAreaElement {
	return (el instanceof HTMLInputElement && !NOT_TEXT.has(el.type)) || el instanceof HTMLTextAreaElement;
}

/** 打字的地方：打字的欄位，或可以編輯的文字（contenteditable）。 */
export function isTextEntry(el: EventTarget | null): boolean {
	return isTextField(el) || (el instanceof Element && !!el.closest('[contenteditable]:not([contenteditable="false"])'));
}

/**
 * 焦點在 el 時，key（KeyboardEvent.key）是不是它自己要用的：是的話編輯頁的快捷鍵讓給它。
 * - 打字的地方：每個鍵都是它的（打字、移游標、刪字、⌘C／⌘V；Esc 是丟掉沒送出的字，見 pending-input）。
 * - 下拉選單：Esc 以外都是它的（方向鍵、Home／End、打字跳選項）。開著的選單瀏覽器自己收 Esc。
 * - radio、radiogroup：方向鍵換選項（radiogroup 也用 Home／End）。選檔的欄位：空白鍵打開選檔。
 * - 自己做的選單（combobox、listbox、option、menuitem）：方向鍵、Home／End、空白鍵、數字鍵。
 * - 對話框、確認框裡按得下去的東西：空白鍵是按下、勾。
 * - checkbox、按鈕：編輯頁不讓它們吃空白鍵（空白鍵一律播放／暫停），其他鍵也不用。
 */
export function ownsKey(el: EventTarget | null, key: string): boolean {
	if (!(el instanceof Element)) return false;
	if (isTextEntry(el)) return true;
	if (el instanceof HTMLSelectElement) return key !== 'Escape';
	if (el instanceof HTMLInputElement && el.type === 'radio' && ARROWS.has(key)) return true;
	if (el instanceof HTMLInputElement && el.type === 'file' && key === ' ') return true;
	const homeEnd = key === 'Home' || key === 'End';
	if (el.closest('[role="radiogroup"]') && (ARROWS.has(key) || homeEnd)) return true;
	const menu = el.closest('[role="combobox"], [role="listbox"], [role="option"], [role="menuitem"]');
	if (menu && (ARROWS.has(key) || homeEnd || key === ' ' || /^[0-9]$/.test(key))) return true;
	return key === ' ' && !!el.closest(`${IN_DIALOG} :is(${NATIVE_KEYS})`);
}
