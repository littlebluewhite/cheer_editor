<script lang="ts">
	import {
		addSegment,
		deleteAction,
		positionText,
		raisedAt,
		setPositions,
		timeRuleWarnings,
		totalSeconds,
		type Flow,
		type Position,
		type SegmentKind
	} from '#lib/core';
	import type { LoadedAudio } from '#lib/audio/decode.js';
	import ActionForm from '#lib/components/ActionForm.svelte';
	import Field from '#lib/components/Field.svelte';
	import FlowSettings from '#lib/components/FlowSettings.svelte';
	import MemberPanel from '#lib/components/MemberPanel.svelte';
	import NewFlowForm from '#lib/components/NewFlowForm.svelte';
	import SegmentSettings from '#lib/components/SegmentSettings.svelte';
	import Timeline from '#lib/components/Timeline.svelte';

	let flow = $state<Flow | null>(null);
	/** 解碼過的音樂檔，用 flow.audio 的 id 對應；位元組不放進流程。 */
	let audios = $state<Record<string, LoadedAudio>>({});
	/** 播放頭，全域秒數。 */
	let playheadSec = $state(0);
	let openSegmentId = $state<string | null>(null);
	let settingsOpen = $state(false);
	let notice = $state('');
	/** 選到的動作（Delete 刪掉、Esc 清除）。 */
	let selectedActionId = $state<string | null>(null);

	/** 開頭那張站位；站位與走位的票會換成播放頭那張。 */
	const formation = $derived(flow?.formations[0]);

	function seek(f: Flow, sec: number) {
		playheadSec = Math.min(Math.max(sec, 0), totalSeconds(f));
	}

	function add(f: Flow, kind: SegmentKind) {
		const r = addSegment(f, kind);
		if (r.kind !== 'ok') return;
		flow = r.flow;
		openSegmentId = r.flow.segments.at(-1)!.id;
	}

	function move(moves: Record<string, Position>) {
		if (!flow || !formation) return;
		const r = setPositions(flow, formation.id, moves);
		if (r.kind === 'ok') flow = r.flow;
		notice = r.kind === 'blocked' ? r.message : '';
	}

	/** Delete（Mac 的 delete 鍵是 Backspace）刪選到的動作；Esc 清除選取。在輸入框裡打字時不攔。 */
	function onkeydown(e: KeyboardEvent) {
		if (!flow) return;
		if (e.key === 'Escape') {
			selectedActionId = null;
			return;
		}
		if (e.key !== 'Delete' && e.key !== 'Backspace') return;
		const t = e.target as HTMLElement | null;
		if (t?.closest?.('input, textarea, select, [contenteditable]')) return;
		if (!selectedActionId) return;
		const r = deleteAction(flow, selectedActionId);
		if (r.kind === 'ok') flow = r.flow;
		selectedActionId = null;
		e.preventDefault();
	}
</script>

<svelte:window {onkeydown} />

<svelte:head>
	<title>{flow ? `${flow.name} — 流程編輯器` : '流程編輯器'}</title>
</svelte:head>

{#if flow}
	<div class="editor">
		<header class="topbar">
			<b>{flow.name}</b>
			<span class="pos" aria-label="目前位置">{positionText(flow, playheadSec)}</span>
			<span class="warn">
				{#each timeRuleWarnings(flow) as w (w)}<span>⚠ {w}</span>{/each}
			</span>
			{#if notice}<span class="notice" role="status">{notice}</span>{/if}
			<button type="button" onclick={() => (settingsOpen = true)}>流程設定</button>
		</header>
		<main class="field-host">
			<Field
				field={flow.field}
				members={flow.members}
				positions={formation?.pos}
				raised={raisedAt(flow, playheadSec)}
				onmove={move}
			/>
		</main>
		<aside class="inspector">
			<ActionForm
				{flow}
				{playheadSec}
				actionId={selectedActionId}
				onchange={(f) => (flow = f)}
				onselect={(id) => (selectedActionId = id)}
			/>
			<MemberPanel {flow} onchange={(f) => (flow = f)} />
		</aside>
		<div class="timeline-host">
			<Timeline
				{flow}
				{playheadSec}
				onseek={(sec) => flow && seek(flow, sec)}
				onaddsegment={(kind) => flow && add(flow, kind)}
				onopensegment={(id) => (openSegmentId = id)}
				{selectedActionId}
				onselectaction={(id) => (selectedActionId = id)}
			/>
		</div>
	</div>
	{#if openSegmentId}
		<SegmentSettings
			{flow}
			segmentId={openSegmentId}
			{audios}
			onchange={(f) => (flow = f)}
			onaudioload={(id, audio) => (audios[id] = audio)}
			onclose={() => (openSegmentId = null)}
		/>
	{/if}
	{#if settingsOpen}
		<FlowSettings {flow} onchange={(f) => (flow = f)} onclose={() => (settingsOpen = false)} />
	{/if}
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
		grid-template-rows: auto minmax(0, 1fr) 30vh;
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
	.pos {
		font-variant-numeric: tabular-nums;
		min-width: 9em;
	}
	.warn {
		display: flex;
		gap: 10px;
		color: #b5651d;
	}
	.notice {
		color: #c0392b;
	}
	.topbar button {
		margin-left: auto;
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
	/* 讓時間軸撐滿這一列、自己捲動。 */
	.timeline-host {
		grid-column: 1 / -1;
		min-height: 0;
		display: grid;
		grid-template-rows: minmax(0, 1fr);
	}
</style>
