<script lang="ts">
	// 名詞對照表：固定和自訂任務角色的名稱、意思、規則上的叫法；也在這裡加自訂角色。
	import { addCustomRole, roleGlossary, type Flow } from '#lib/core';

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
		const r = addCustomRole(flow, { name, meaning });
		if (r.kind === 'blocked') {
			error = r.message;
			return;
		}
		error = '';
		name = '';
		meaning = '';
		onchange(r.flow);
	}
</script>

<div class="backdrop">
	<div class="dialog" role="dialog" aria-label="名詞對照表">
		<header>
			<b>名詞對照表：任務角色</b>
			<button type="button" onclick={onclose}>關閉</button>
		</header>
		<table>
			<thead>
				<tr><th>名稱</th><th>意思</th><th>規則上的叫法</th></tr>
			</thead>
			<tbody>
				{#each roleGlossary(flow) as r (r.name)}
					<tr>
						<td><b>{r.name}</b>{#if r.custom}<small> 自訂</small>{/if}</td>
						<td>{r.meaning}</td>
						<td>{r.ruleName || '—'}</td>
					</tr>
				{/each}
			</tbody>
		</table>
		<!-- novalidate：名稱必填、不能重複由流程核心判斷 -->
		<form novalidate onsubmit={add}>
			<b>新增自訂角色</b>
			<label>角色名稱 <input bind:value={name} /></label>
			<label>意思 <input bind:value={meaning} /></label>
			<button type="submit">新增角色</button>
		</form>
		<p class="muted">自訂角色只存在這一支流程裡。</p>
		{#if error}<p class="error" role="alert">{error}</p>{/if}
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(15, 20, 35, 0.45);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 50;
	}
	.dialog {
		background: #fff;
		border-radius: 10px;
		padding: 12px 16px;
		max-width: 760px;
		max-height: 86vh;
		overflow: auto;
		display: grid;
		gap: 8px;
		font-size: 13px;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	table {
		border-collapse: collapse;
	}
	th,
	td {
		border: 1px solid #e3e6ee;
		padding: 4px 6px;
		text-align: left;
		vertical-align: top;
	}
	th {
		background: #f6f7fa;
	}
	small,
	.muted {
		color: #7a8296;
	}
	form {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
	}
	p {
		margin: 0;
	}
	.error {
		color: #c0392b;
	}
</style>
