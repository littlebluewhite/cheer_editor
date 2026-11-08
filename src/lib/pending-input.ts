// 沒送出的字：文字、數字欄位在 change（離開欄位、按 Enter）時才送進流程。這個 module 回答三件事：
// 有沒有打了還沒送出的字、現在送出（跟離開欄位一樣）、當作已經送出了（例：復原換上舊的流程）。
// 編輯器 module 收它（關分頁前的提醒、service worker 擋重新整理、存檔、欄位裡按 ⌘Z）；對話框關掉前也先送出。
// 真的（domPendingInput）看 DOM，假的（#lib/test-fakes.js 的 fakePendingInput）給 Node 測試用。
// 真的 pending 是畫面看得到的（上方列的「未存」一打字就出現）：焦點、打字、送出都通知在看它的地方。

import { createSubscriber } from 'svelte/reactivity';
import { composing } from '#lib/ime.js';
import { isTextField } from '#lib/key-owner.js';

export interface PendingInput {
	/** 焦點所在的欄位打了字還沒送出（打了又刪回原來的字也算）。 */
	readonly pending: boolean;
	/**
	 * 現在送出：欄位的值跟上次送出的不一樣，就跟離開欄位一樣發 change。之後就沒有沒送出的字。
	 * 中文輸入法還在選字時不送（不然注音、拼音會進流程），選完照樣算沒送出。
	 */
	flush(): void;
	/** 當作已經送出了：欄位被畫面改了值（例：復原換上舊的流程），現在的值不用再送。 */
	settle(): void;
}

type Field = HTMLInputElement | HTMLTextAreaElement;

/** 焦點所在的欄位、它上次送出時的值、之後教練有沒有在裡面打字（畫面自己改的值不算打字）、輸入法是不是還在選字。 */
let typing: { el: Field; value: string; typed: boolean; composing: boolean } | null = null;

/** 在看 pending 的地方（畫面）：焦點、打字、送出時通知它們重看。 */
const watchers = new Set<() => void>();
const subscribe = createSubscriber((update) => {
	watchers.add(update);
	return () => watchers.delete(update);
});
/**
 * 晚一點才通知：Chrome 拆掉有焦點的欄位時當下就發 change、blur、focusout（欄位是畫面換掉時才失去焦點），
 * 那一刻改狀態 Svelte 會丟 state_unsafe_mutation（B01）。pending 本來就看當下的焦點和字，晚通知不會看錯。
 */
function changed() {
	queueMicrotask(() => {
		for (const update of watchers) update();
	});
}

/** 送出了（或當作送出了）：現在的值算上次送出的。 */
function sent(t: NonNullable<typeof typing>) {
	t.value = t.el.value;
	t.typed = false;
	changed();
}

if (typeof window !== 'undefined') {
	window.addEventListener(
		'focusin',
		(e) => {
			typing = isTextField(e.target) ? { el: e.target, value: e.target.value, typed: false, composing: false } : null;
			changed();
		},
		true
	);
	window.addEventListener('focusout', changed, true);
	window.addEventListener(
		'input',
		(e) => {
			if (!typing || e.target !== typing.el) return;
			typing.typed = true;
			changed();
		},
		true
	);
	for (const [type, composing] of [['compositionstart', true], ['compositionend', false]] as const) {
		window.addEventListener(
			type,
			(e) => {
				if (typing && e.target === typing.el) typing.composing = composing;
			},
			true
		);
	}
	// 值跟上次送出的一樣（例：⌘Z 退回之後離開欄位）：不再送一次，免得多記一步。捕獲階段，比欄位自己的處理早。
	window.addEventListener(
		'change',
		(e) => {
			if (typing && e.target === typing.el && typing.el.value === typing.value) e.stopImmediatePropagation();
		},
		true
	);
	// Esc 是丟掉沒送出的字（Apple 的 abortEditing）：欄位退回上次送出的字，當作已經送出了。之後欄位被拆掉時 Chrome 發的 change
	// 值沒變，上面那條就吞掉，不會被當成送出（N06）。發 input 讓 bind:value 的狀態跟著退回。捕獲階段，比元件自己的 Esc 早。
	// 對話框裡不退：Esc 是關對話框，跟按 ×、點背景一樣送出（#93）。還沒送出的表單（新動作、加隊員）也不退：字不在流程裡。
	window.addEventListener(
		'keydown',
		(e) => {
			const t = typing;
			if (e.key !== 'Escape' || composing(e) || t?.composing) return;
			if (!t || e.target !== t.el || t.el.closest('[aria-modal="true"], dialog, [data-native-undo]')) return;
			if (t.el.value !== t.value) {
				t.el.value = t.value;
				t.el.dispatchEvent(new Event('input', { bubbles: true }));
			}
			sent(t);
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
		subscribe();
		return !!typing && typing.typed && document.activeElement === typing.el;
	},
	flush() {
		const t = typing;
		if (!t || document.activeElement !== t.el || t.composing) return;
		if (t.el.value !== t.value) t.el.dispatchEvent(new Event('change', { bubbles: true }));
		sent(t);
	},
	settle() {
		if (typing) sent(typing);
	}
};
