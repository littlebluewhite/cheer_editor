<script lang="ts">
	// 流程核心回「要確認」時顯示的說明和會被刪掉的清單；按確定由呼叫端帶 confirmed 再送一次指令。
	// 也用在「還沒存，要丟掉嗎」（清單是空的，確定鈕換字）。
	// 給了 onkeep 就是兩個選擇的確認：多一個「保留舊紀錄」，確定鈕當「清掉重算」。
	interface Props {
		message: string;
		items: string[];
		onconfirm: () => void;
		oncancel: () => void;
		confirmLabel?: string;
		onkeep?: () => void;
	}

	let { message, items, onconfirm, oncancel, confirmLabel = '確定刪除', onkeep }: Props = $props();
</script>

<div class="confirm" role="alertdialog" aria-label={confirmLabel}>
	<p>{message}</p>
	{#if items.length}
		<ul>
			{#each items as item (item)}<li>{item}</li>{/each}
		</ul>
	{/if}
	<div class="buttons">
		{#if onkeep}<button type="button" onclick={onkeep}>保留舊紀錄</button>{/if}
		<button type="button" class="confirm-btn" onclick={onconfirm}>{confirmLabel}</button>
		<button type="button" onclick={oncancel}>取消</button>
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
