<script lang="ts">
	import { setPositions, type Flow, type Position } from '#lib/core';
	import Field from '#lib/components/Field.svelte';
	import MemberPanel from '#lib/components/MemberPanel.svelte';
	import NewFlowForm from '#lib/components/NewFlowForm.svelte';

	let flow = $state<Flow | null>(null);
	let notice = $state('');

	/** 開頭那張站位；站位與走位的票會換成播放頭那張。 */
	const formation = $derived(flow?.formations[0]);

	function move(moves: Record<string, Position>) {
		if (!flow || !formation) return;
		const r = setPositions(flow, formation.id, moves);
		if (r.kind === 'ok') flow = r.flow;
		notice = r.kind === 'blocked' ? r.message : '';
	}
</script>

<svelte:head>
	<title>{flow ? `${flow.name} — 流程編輯器` : '流程編輯器'}</title>
</svelte:head>

{#if flow}
	<div class="editor">
		<header class="topbar">
			<b>{flow.name}</b>
			{#if notice}<span class="notice" role="status">{notice}</span>{/if}
		</header>
		<main class="field-host">
			<Field
				field={flow.field}
				members={flow.members}
				positions={formation?.pos}
				onmove={move}
			/>
		</main>
		<aside class="inspector">
			<MemberPanel {flow} onchange={(f) => (flow = f)} />
		</aside>
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
		grid-template-columns: minmax(0, 1fr) 340px;
	}
	.topbar {
		grid-column: 1 / -1;
		display: flex;
		gap: 12px;
		align-items: center;
		padding: 6px 12px;
		background: #fff;
		border-bottom: 1px solid #dde1ea;
	}
	.notice {
		color: #c0392b;
	}
	.field-host {
		min-height: 0;
		background: #dfe3ea;
		padding: 8px;
	}
	.inspector {
		min-height: 0;
		overflow-y: auto;
		padding: 10px 12px;
		background: #fff;
		border-left: 1px solid #dde1ea;
	}
</style>
