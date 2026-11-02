<script lang="ts">
	// 流程核心回「要確認」時顯示的說明和會被刪掉的清單；按確定由呼叫端帶 confirmed 再送一次指令。
	interface Props {
		message: string;
		items: string[];
		onconfirm: () => void;
		oncancel: () => void;
	}

	let { message, items, onconfirm, oncancel }: Props = $props();
</script>

<div class="confirm" role="alertdialog" aria-label="確認刪除">
	<p>{message}</p>
	{#if items.length}
		<ul>
			{#each items as item (item)}<li>{item}</li>{/each}
		</ul>
	{/if}
	<div class="buttons">
		<button type="button" class="danger" onclick={onconfirm}>確定刪除</button>
		<button type="button" onclick={oncancel}>取消</button>
	</div>
</div>

<style>
	.confirm {
		border: 1px solid #e0a39b;
		background: #fdf3f1;
		border-radius: 6px;
		padding: 8px 10px;
		display: grid;
		gap: 6px;
	}
	p,
	ul {
		margin: 0;
	}
	ul {
		padding-left: 1.2em;
	}
	.buttons {
		display: flex;
		gap: 6px;
	}
	.danger {
		color: #fff;
		background: #c0392b;
		border: 1px solid #a93226;
		border-radius: 4px;
	}
</style>
