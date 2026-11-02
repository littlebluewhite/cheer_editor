<script lang="ts">
	import type { Flow } from '#lib/core';
	import Field from '#lib/components/Field.svelte';
	import NewFlowForm from '#lib/components/NewFlowForm.svelte';

	let flow = $state<Flow | null>(null);
</script>

<svelte:head>
	<title>{flow ? `${flow.name} — 流程編輯器` : '流程編輯器'}</title>
</svelte:head>

{#if flow}
	<div class="editor">
		<header class="topbar">
			<b>{flow.name}</b>
		</header>
		<main class="field-host">
			<Field field={flow.field} />
		</main>
	</div>
{:else}
	<NewFlowForm oncreate={(f) => (flow = f)} />
{/if}

<style>
	:global(body) {
		margin: 0;
		font-family: system-ui, -apple-system, 'PingFang TC', 'Microsoft JhengHei', sans-serif;
		color: #1d2330;
		background: #f2f4f8;
	}
	.editor {
		height: 100vh;
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
	}
	.topbar {
		display: flex;
		gap: 12px;
		align-items: center;
		padding: 6px 12px;
		background: #fff;
		border-bottom: 1px solid #dde1ea;
	}
	.field-host {
		min-height: 0;
		background: #dfe3ea;
		padding: 8px;
	}
</style>
