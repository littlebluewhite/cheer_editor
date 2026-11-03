<script lang="ts">
	// 名詞對照表：固定和自訂任務角色的名稱、意思、規則上的叫法；也在這裡加自訂角色。
	import { addCustomRole, roleGlossary, type Flow } from '#lib/core';
	import { applyResult } from './form';
	import Icon from './Icon.svelte';

	interface Props {
		flow: Flow;
		onchange: (flow: Flow) => void;
		onclose: () => void;
	}

	let { flow, onchange, onclose }: Props = $props();

	let name = $state('');
	let meaning = $state('');
	let error = $state('');

	function add(e: SubmitEvent) {
		e.preventDefault();
		error = applyResult(addCustomRole(flow, { name, meaning }), onchange);
		if (error) return;
		name = '';
		meaning = '';
	}

	// Esc 關掉對照表。用捕獲階段先攔下來，底下的編輯畫面就不會把 Esc 當成「清除選取」。
	function onkeydown(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		e.stopPropagation();
		onclose();
	}
</script>

<svelte:window onkeydowncapture={onkeydown} />

<div class="backdrop">
	<div class="dialog glossary" role="dialog" aria-label="名詞對照表">
		<header class="dialog-head">
			<h2>名詞對照表：任務角色</h2>
			<button type="button" class="ghost icon close" aria-label="關閉" onclick={onclose}><Icon name="close" /></button>
		</header>
		<table>
			<thead>
				<tr><th>名稱</th><th>意思</th><th>規則上的叫法</th></tr>
			</thead>
			<tbody>
				{#each roleGlossary(flow) as r (r.name)}
					<tr>
						<td><b>{r.name}</b>{#if r.custom}<small class="tag">自訂</small>{/if}</td>
						<td>{r.meaning}</td>
						<td>{r.ruleName || '—'}</td>
					</tr>
				{/each}
			</tbody>
		</table>
		<!-- novalidate：名稱必填、不能重複由流程核心判斷 -->
		<form novalidate onsubmit={add}>
			<b>新增自訂任務角色</b>
			<div class="fields">
				<label>任務角色名稱 <input bind:value={name} /></label>
				<label>意思 <input bind:value={meaning} /></label>
				<button type="submit" class="primary">新增任務角色</button>
			</div>
			<p class="muted">自訂任務角色只存在這一支流程裡。</p>
		</form>
		{#if error}<p class="error" role="alert">{error}</p>{/if}
	</div>
</div>

<style>
	.glossary {
		width: min(760px, 100%);
		font-size: 13px;
	}
	table {
		border-collapse: collapse;
		width: 100%;
	}
	th,
	td {
		border-bottom: 1px solid var(--line-soft, #e8ecf3);
		padding: 7px 8px;
		text-align: left;
		vertical-align: top;
	}
	th {
		font-size: 12px;
		font-weight: 600;
		color: var(--muted, #66718a);
		border-bottom-color: var(--line, #d8dee9);
	}
	td:first-child {
		white-space: nowrap;
	}
	.tag {
		margin-left: 6px;
		padding: 1px 5px;
		border-radius: 4px;
		background: var(--mat-soft, #e3ecf9);
		color: var(--mat, #2f66b8);
		font-size: 11px;
	}
	form {
		display: grid;
		gap: 8px;
		padding: 12px 14px;
		border-radius: 10px;
		background: var(--surface-2, #f6f8fb);
	}
	.fields {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		align-items: center;
	}
	.fields label {
		display: inline-flex;
		gap: 6px;
		align-items: center;
	}
	.muted {
		color: var(--muted, #66718a);
		font-size: 12px;
	}
	p {
		margin: 0;
	}
	.error {
		color: var(--danger, #c8372d);
	}
</style>
