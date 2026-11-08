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
	// - 打開時焦點進去（裡面標了 data-autofocus 的就放那裡）；Tab／Shift+Tab 只在裡面轉；關掉後焦點回到打開它的按鈕。
	// - Esc、×、點背景走同一條路 close()：先把還沒離開的欄位送出去（跟離開欄位一樣），
	//   這一下有欄位被擋（退回實際值、顯示原因）或要問教練，就先不關，讓教練看到是哪一格。
	// - 裡面有確認框時，Esc 只關確認框。
	// - readonly（檢視模式）：內容包在 <fieldset disabled> 裡，欄位、按鈕整塊停用；head（標題列的 ×、試聽）放在外面照樣能按。
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
		/** 對話框裡別的、只會開確認框的問題（例：流程設定的調整場地）：Esc 先關它的確認框，× 當取消再關。 */
		confirms?: Ask[];
		/** false：沒有背景那一層（八拍表自己蓋滿畫面）。 */
		backdrop?: boolean;
		/** 關之前再送出對話框自己的東西（例：流程設定還沒按「調整場地」的場地）；回 false 就先不關。 */
		beforeclose?: () => boolean;
		/** 只能看：內容（children）整塊停用；head 不停用。 */
		readonly?: boolean;
		/** 放在內容前面、readonly 也照樣能按的（標題列：×、試聽）。 */
		head?: Snippet<[close: () => void]>;
		children: Snippet<[close: () => void]>;
	}

	let { label, class: cls, onclose, ask, confirms = [], backdrop = true, beforeclose, readonly = false, head, children }: Props = $props();

	/** 開著的確認框都按取消；回傳有沒有。 */
	function cancelQuestions(): boolean {
		const open = [ask, ...confirms].filter((a) => a?.question);
		for (const a of open) a!.answer('cancel');
		return open.length > 0;
	}

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
		// 裡面有指定一打開就放焦點的（例：「還沒存」的「取消」）就放那裡，不然放在對話框本身
		(el.querySelector<HTMLElement>('[data-autofocus]') ?? el).focus();
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

	/** 確認框開著時按 ×、點背景：當作取消，照樣關（N39）。 */
	function close() {
		cancelQuestions();
		pendingInput.flush();
		if (ask && ask.failures !== failuresAtGesture) return;
		if (beforeclose && !beforeclose()) return;
		onclose();
	}

	const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

	function trapTab(e: KeyboardEvent) {
		const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
			(el) => !el.matches(':disabled') && !el.closest('[inert]')
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
		if (!cancelQuestions()) close();
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
		{@render head?.(close)}
		{#if readonly}
			<fieldset class="readonly" disabled>{@render children(close)}</fieldset>
		{:else}
			{@render children(close)}
		{/if}
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

<style>
	/* 只是停用用的：不加框、不佔一層版面，裡面的段落照樣是對話框的格子 */
	.readonly {
		display: contents;
	}
</style>
