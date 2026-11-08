<script lang="ts">
	// 問教練 module 的畫法：給 ask（一個問題實例）就畫它的問題。要確認是「確定／取消」，
	// 要選是「保留舊紀錄／清掉重算／取消」；按了交給 ask 帶著回答再送一次。
	// 「還沒存，要丟掉嗎」不是流程核心的問題：直接給 message、items、確定鈕的字、onconfirm、oncancel。
	// 問題出現時焦點進來，放在取消（最不會出事的那顆，APG 的 alertdialog）；Enter 不會刪掉東西，Esc 就是取消。
	// 答完問題收起來時焦點還在框裡，就還給問之前有焦點的地方。對話框裡的（focusCancel）由對話框放焦點。
	import { untrack } from 'svelte';
	import { composing } from '#lib/ime.js';
	import type { Ask } from '#lib/ask.svelte.js';

	type Props =
		| { ask: Ask }
		| {
				ask?: undefined;
				message: string;
				items: string[];
				onconfirm: () => void;
				oncancel: () => void;
				confirmLabel: string;
				/** 取消鈕的字，預設「取消」。 */
				cancelLabel?: string;
				/** 確定鈕前面多一個鈕（例：「先存檔」）。 */
				extra?: { label: string; onclick: () => void };
				/** 放在對話框裡：打開時焦點放在取消鈕，按 Enter 不會丟掉東西。 */
				focusCancel?: boolean;
			};

	let props: Props = $props();
	const id = $props.id();

	const view = $derived.by(() => {
		if (!props.ask) return { cancelLabel: '取消', focusCancel: false, ...props, onkeep: undefined };
		const ask = props.ask;
		const q = ask.question;
		return {
			message: q?.message ?? '',
			items: q?.items ?? [],
			confirmLabel: q?.choose ? '清掉重算' : ask.confirmLabel,
			onconfirm: () => ask.answer(q?.choose ? 'clear' : 'confirm'),
			onkeep: q?.choose ? () => ask.answer('keep') : undefined,
			oncancel: () => ask.answer('cancel'),
			cancelLabel: '取消',
			extra: undefined,
			focusCancel: false
		};
	});

	/** 問題出現：焦點放到取消（最後一顆鈕）；收起來時焦點還給原本的地方。 */
	function takeFocus(box: HTMLElement) {
		if (untrack(() => view.focusCancel)) return;
		const before = document.activeElement as HTMLElement | null;
		box.querySelector<HTMLButtonElement>('.buttons button:last-child')?.focus();
		return () => {
			const had = box.contains(document.activeElement);
			queueMicrotask(() => {
				const lost = had || document.activeElement === document.body || !document.activeElement;
				if (lost && before?.isConnected && before !== document.body) before.focus();
			});
		};
	}
</script>

<!-- 焦點在問句裡按 Esc＝取消（跟對話框一樣） -->
<div
	class="confirm"
	role="alertdialog"
	aria-labelledby="{id}-q"
	tabindex="-1"
	{@attach takeFocus}
	onkeydown={(e) => {
		if (e.key !== 'Escape' || composing(e)) return;
		e.stopPropagation();
		view.oncancel();
	}}
>
	<p id="{id}-q">{view.message}</p>
	{#if view.items.length}
		<ul>
			{#each view.items as item (item)}<li>{item}</li>{/each}
		</ul>
	{/if}
	<div class="buttons">
		{#if view.onkeep}<button type="button" onclick={view.onkeep}>保留舊紀錄</button>{/if}
		{#if view.extra}<button type="button" class="primary" onclick={view.extra.onclick}>{view.extra.label}</button>{/if}
		<button type="button" class="confirm-btn" onclick={view.onconfirm}>{view.confirmLabel}</button>
		<button type="button" onclick={view.oncancel} data-autofocus={view.focusCancel || undefined}>{view.cancelLabel}</button>
	</div>
</div>

<style>
	.confirm {
		border: 1px solid #efc7c1;
		background: #fff7f5;
		border-radius: 10px;
		padding: 12px 14px;
		display: grid;
		gap: 10px;
		font-size: 13px;
	}
	p,
	ul {
		margin: 0;
	}
	p {
		font-weight: 600;
	}
	ul {
		padding-left: 1.2em;
		color: var(--text, #1a2238);
	}
	.buttons {
		display: flex;
		gap: 8px;
	}
	.confirm-btn {
		color: #fff;
		background: var(--danger, #c8372d);
		border-color: var(--danger, #c8372d);
		font-weight: 600;
	}
	.confirm-btn:hover {
		background: #a92c23;
		border-color: #a92c23;
	}
</style>
