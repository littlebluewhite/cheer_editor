<script module lang="ts">
	/** 開著的對話框，最後一個在最上面：Esc、Tab 只歸它管。 */
	const stack: object[] = [];

	/** 有沒有對話框開著（編輯頁的快捷鍵用：開著就不動底下的畫面）。 */
	export function modalOpen(): boolean {
		return stack.length > 0;
	}
</script>

<script lang="ts">
	// 對話框的共用行為：流程設定、八拍表、段設定、名詞對照表都用它。
	// - 打開時焦點進去；Tab／Shift+Tab 只在裡面轉；關掉後焦點回到打開它的按鈕。
	// - Esc、×、點背景走同一條路 close()：先把還沒離開的欄位送出去（跟離開欄位一樣），
	//   這一下有欄位被擋（退回實際值、顯示原因）或要問教練，就先不關，讓教練看到是哪一格。
	// - 裡面有確認框時，Esc 只關確認框。
	import { composing } from '#lib/ime.js';
	import type { Snippet } from 'svelte';
	import { getEditor, hasEditor } from '#lib/editor.svelte.js';
	import { domPendingInput } from '#lib/pending-input.js';
	import type { Ask } from '#lib/ask.svelte.js';

	interface Props {
		label: string;
		/** 對話框本身的 class（例：'dialog flow-dialog'）。 */
		class: string;
		onclose: () => void;
		/** 這個對話框的問教練：看有沒有被擋、有沒有確認框。 */
		ask?: Ask;
		/** false：沒有背景那一層（八拍表自己蓋滿畫面）。 */
		backdrop?: boolean;
		children: Snippet<[close: () => void]>;
	}

	let { label, class: cls, onclose, ask, backdrop = true, children }: Props = $props();

	/** 沒送出的字：編輯頁用編輯器 module 的；沒有編輯器的地方（八拍表單獨畫）直接看焦點所在的欄位。 */
	const pendingInput = hasEditor() ? getEditor().adapters.pendingInput : domPendingInput;
	const me = {};
	let box: HTMLElement;
	/** 這一下（按鍵、按下滑鼠）開始時被擋了幾次：關之前比一比，就知道這一下有沒有被擋。 */
	let failuresAtGesture = 0;
	/** 按下滑鼠時在背景上：放開也在背景上才算點背景。 */
	let downOnBackdrop = false;

	const isTop = () => stack.at(-1) === me;

	function modal(el: HTMLElement) {
		box = el;
		const opener = document.activeElement as HTMLElement | null;
		stack.push(me);
		el.focus();
		return () => {
			stack.splice(stack.indexOf(me), 1);
			// 等頁面更新完（底下的編輯畫面不再 inert）才還焦點。
			queueMicrotask(() => {
				if (opener?.isConnected && opener !== document.body) opener.focus();
			});
		};
	}

	function mark() {
		failuresAtGesture = ask?.failures ?? 0;
	}

	function close() {
		if (ask?.question) ask.answer('cancel');
		pendingInput.flush();
		if (ask && ask.failures !== failuresAtGesture) return;
		onclose();
	}

	const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

	function trapTab(e: KeyboardEvent) {
		const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
			(el) => !(el as HTMLButtonElement).disabled && !el.closest('[inert]')
		);
		if (!items.length) return;
		const first = items[0];
		const last = items.at(-1)!;
		const active = document.activeElement;
		const inside = active instanceof HTMLElement && active !== box && box.contains(active);
		if (e.shiftKey && (!inside || active === first)) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && (!inside || active === last)) {
			e.preventDefault();
			first.focus();
		}
	}

	// 用捕獲階段先攔下來，底下的編輯畫面就不會把 Esc 當成「清除選取」。
	function onkeydown(e: KeyboardEvent) {
		if (!isTop()) return;
		mark();
		if (e.key === 'Tab') return trapTab(e);
		if (e.key !== 'Escape' || composing(e)) return;
		e.stopPropagation();
		e.preventDefault();
		if (ask?.question) ask.answer('cancel');
		else close();
	}

	function onpointerdown(e: PointerEvent) {
		if (!isTop()) return;
		mark();
		downOnBackdrop = e.target === e.currentTarget;
	}

	function onbackdropclick(e: MouseEvent) {
		if (e.target === e.currentTarget && downOnBackdrop) close();
		downOnBackdrop = false;
	}
</script>

<svelte:window onkeydowncapture={onkeydown} onpointerdowncapture={() => isTop() && mark()} />

{#snippet dialog()}
	<div class={cls} role="dialog" aria-label={label} aria-modal="true" tabindex="-1" {@attach modal}>
		{@render children(close)}
	</div>
{/snippet}

{#if backdrop}
	<!-- 點背景＝關掉；鍵盤用 Esc，所以不另外接鍵盤事件。 -->
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="backdrop" {onpointerdown} onclick={onbackdropclick}>
		{@render dialog()}
	</div>
{:else}
	{@render dialog()}
{/if}
