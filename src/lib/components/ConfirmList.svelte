<script lang="ts">
	// 問教練 module 的畫法：給 ask（一個問題實例）就畫它的問題。要確認是「確定／取消」，
	// 要選是「保留舊紀錄／清掉重算／取消」；按了交給 ask 帶著回答再送一次。
	// 還沒換上問教練的地方（和「還沒存，要丟掉嗎」：清單是空的，確定鈕換字）先用舊的寫法：
	// 給 message、items、onconfirm、oncancel，給了 onkeep 就是兩個選擇的確認。
	import type { Ask } from './ask.svelte';

	type Props =
		| { ask: Ask }
		| {
				ask?: undefined;
				message: string;
				items: string[];
				onconfirm: () => void;
				oncancel: () => void;
				confirmLabel?: string;
				onkeep?: () => void;
			};

	let props: Props = $props();

	const view = $derived.by(() => {
		if (!props.ask) return { ...props, confirmLabel: props.confirmLabel ?? '確定刪除' };
		const ask = props.ask;
		const q = ask.question;
		return {
			message: q?.message ?? '',
			items: q?.items ?? [],
			confirmLabel: q?.choose ? '清掉重算' : ask.confirmLabel,
			onconfirm: () => ask.answer(q?.choose ? 'clear' : 'confirm'),
			onkeep: q?.choose ? () => ask.answer('keep') : undefined,
			oncancel: () => ask.answer('cancel')
		};
	});
</script>

<div class="confirm" role="alertdialog" aria-label={view.confirmLabel}>
	<p>{view.message}</p>
	{#if view.items.length}
		<ul>
			{#each view.items as item (item)}<li>{item}</li>{/each}
		</ul>
	{/if}
	<div class="buttons">
		{#if view.onkeep}<button type="button" onclick={view.onkeep}>保留舊紀錄</button>{/if}
		<button type="button" class="confirm-btn" onclick={view.onconfirm}>{view.confirmLabel}</button>
		<button type="button" onclick={view.oncancel}>取消</button>
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
