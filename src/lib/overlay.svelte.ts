// 蓋住編輯畫面的東西：對話框（Modal：流程設定、段設定、八拍表、輸出影片、「還沒存」這些確認框…）、找書籤的框、小窗（popover）
// 打開時都在這裡登記（attachment `layer`），疊的順序就是登記的順序。
// 管：
// - 編輯頁有沒有被蓋住（covered：快捷鍵不動底下的畫面；小窗不算）、底下的編輯畫面要不要 inert（covers）。
// - Esc 只給最上面那一層：一次關一層，也不往下傳（不讓編輯頁把選取也清掉）；中文輸入法選字時的 Esc 不算。
// - 'box'（不擋畫面的框，例：找書籤）：框裡的鍵不給底下的編輯頁，⌘S／Ctrl+S 照樣給；焦點跑到框外就關；
//   打開時先收小窗（小窗在瀏覽器的最上層，會蓋住框）。
// - 誰是最上面的對話框（Modal 的 Tab 只在它裡面轉）。
// 不管：快捷鍵做什麼、⌘S 怎麼存（編輯頁）；打字欄位吃自己的鍵（key-owner.ts）；
// 對話框關之前送出欄位、確認框先取消（Modal 給的 close 自己決定關不關）；小窗放哪裡、點外面就關（popover.svelte.ts）。
import { untrack } from 'svelte';
import type { Attachment } from 'svelte/attachments';
import { composing } from '#lib/ime.js';

/**
 * - dialog：對話框，擋住整個畫面（有背景、Tab 只在裡面轉）。
 * - box：不擋畫面的框（找書籤）：擋快捷鍵，焦點跑出去就關。
 * - pop：小窗：不擋快捷鍵，只收 Esc。
 */
export type LayerKind = 'dialog' | 'box' | 'pop';

export interface LayerOptions {
	kind: LayerKind;
	/** 關這一層：在最上面時按 Esc（escape），或 box 的焦點跑出去、box 打開時收小窗（outside）。關不關由它決定。 */
	close: (by: 'escape' | 'outside') => void;
}

type Layer = LayerOptions & { el: HTMLElement };

/** 開著的，最後一個在最上面。 */
let layers = $state.raw<Layer[]>([]);

/** ⌘S／Ctrl+S：存檔，蓋著、打字時也要給頁面。 */
export const saveKey = (e: KeyboardEvent) => (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's';

/** 有東西擋著編輯頁的快捷鍵（對話框、找書籤的框；小窗不算）。 */
export function covered(): boolean {
	return layers.some((l) => l.kind !== 'pop');
}

/** el（編輯畫面）被它外面的對話框蓋住：底下點不到、Tab 不到（inert）。放在 el 裡面的對話框（例：名詞對照表）不算。 */
export function covers(el: Element): boolean {
	return layers.some((l) => l.kind === 'dialog' && !el.contains(l.el));
}

/** el 是最上面的對話框（上面可以有小窗）。 */
export function topDialog(el: Element): boolean {
	return layers.findLast((l) => l.kind === 'dialog')?.el === el;
}

function escape(e: KeyboardEvent) {
	const top = layers.at(-1);
	if (!top || e.key !== 'Escape' || composing(e)) return;
	e.stopPropagation();
	e.preventDefault();
	top.close('escape');
}

/** attachment：這一層開著時掛在它的外框上（只在開著時才畫）。 */
export function layer(o: LayerOptions): Attachment<HTMLElement> {
	// 登記本身不跟著 layers 重跑（它自己會改 layers）
	return (el) => untrack(() => open(o, el));
}

function open(o: LayerOptions, el: HTMLElement): () => void {
	const me: Layer = { ...o, el };
	if (o.kind === 'box') for (const l of layers) if (l.kind === 'pop') l.close('outside');
	// 用捕獲階段先攔下來：底下的編輯畫面、打字的欄位都收不到這個 Esc
	if (!layers.length) addEventListener('keydown', escape, true);
	layers = [...layers, me];
	const keys = (e: KeyboardEvent) => {
		if (!saveKey(e)) e.stopPropagation();
	};
	// 點東西時焦點沒去哪（relatedTarget 空的，Safari 點按鈕不給焦點）不算跑出去
	const leave = (e: FocusEvent) => {
		const to = e.relatedTarget as Node | null;
		if (to && !el.contains(to)) o.close('outside');
	};
	if (o.kind === 'box') {
		el.addEventListener('keydown', keys);
		el.addEventListener('focusout', leave);
	}
	return () => {
		layers = layers.filter((l) => l !== me);
		if (!layers.length) removeEventListener('keydown', escape, true);
		el.removeEventListener('keydown', keys);
		el.removeEventListener('focusout', leave);
	};
}
