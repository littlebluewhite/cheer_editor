<script lang="ts">
	import {
		addSegment,
		positionText,
		timeRuleWarnings,
		totalSeconds,
		type Flow,
		type SegmentKind
	} from '#lib/core';
	import type { LoadedAudio } from '#lib/audio/decode.js';
	import Field from '#lib/components/Field.svelte';
	import FlowSettings from '#lib/components/FlowSettings.svelte';
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

	function seek(f: Flow, sec: number) {
		playheadSec = Math.min(Math.max(sec, 0), totalSeconds(f));
	}

	function add(f: Flow, kind: SegmentKind) {
		const r = addSegment(f, kind);
		if (r.kind !== 'ok') return;
		flow = r.flow;
		openSegmentId = r.flow.segments.at(-1)!.id;
	}
</script>

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
			<button type="button" onclick={() => (settingsOpen = true)}>流程設定</button>
		</header>
		<main class="field-host">
			<Field field={flow.field} />
		</main>
		<Timeline
			{flow}
			{playheadSec}
			onseek={(sec) => flow && seek(flow, sec)}
			onaddsegment={(kind) => flow && add(flow, kind)}
			onopensegment={(id) => (openSegmentId = id)}
		/>
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
	}
	.topbar {
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
	.topbar button {
		margin-left: auto;
	}
	.field-host {
		min-height: 0;
		background: #dfe3ea;
		padding: 8px;
	}
</style>
