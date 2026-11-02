<script lang="ts">
	import {
		addSegment,
		deleteFormation,
		formationAt,
		formationTimes,
		insertFormation,
		positionText,
		positionsAt,
		setPositions,
		timeRuleWarnings,
		totalSeconds,
		type Flow,
		type Position,
		type SegmentKind
	} from '#lib/core';
	import type { LoadedAudio } from '#lib/audio/decode.js';
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
	/** 選到的站位（點縮圖選）；按 Delete 刪掉它。 */
	let selectedFormationId = $state<string | null>(null);

	function seek(f: Flow, sec: number) {
		playheadSec = Math.min(Math.max(sec, 0), totalSeconds(f));
	}

	function add(f: Flow, kind: SegmentKind) {
		const r = addSegment(f, kind);
		if (r.kind !== 'ok') return;
		flow = r.flow;
		openSegmentId = r.flow.segments.at(-1)!.id;
	}

	/** 拖人：改播放頭所在那張站位；播放頭不在站位上就先在這一拍插一張。播放頭停到那張站位上。 */
	function move(moves: Record<string, Position>) {
		if (!flow) return;
		let f = flow;
		let message = '';
		if (!formationAt(f, playheadSec)) {
			const r = insertFormation(f, playheadSec);
			if (r.kind === 'blocked') return void (notice = r.message);
			f = r.flow;
			message = '插了一張站位，大家的位置自動帶入';
		}
		const target = formationAt(f, playheadSec)!;
		const r = setPositions(f, target.id, moves);
		if (r.kind === 'blocked') return void (notice = r.message);
		flow = r.flow;
		notice = message;
		playheadSec = formationTimes(r.flow).find((t) => t.formation.id === target.id)!.sec;
	}

	function removeFormation(id: string) {
		if (!flow) return;
		const r = deleteFormation(flow, id);
		if (r.kind === 'blocked') return void (notice = r.message);
		flow = r.flow;
		notice = '';
		if (selectedFormationId === id) selectedFormationId = null;
	}

	function onkeydown(e: KeyboardEvent) {
		if ((e.target as Element | null)?.closest?.('input, textarea, select, [contenteditable]')) return;
		if ((e.key === 'Delete' || e.key === 'Backspace') && selectedFormationId) {
			e.preventDefault();
			removeFormation(selectedFormationId);
		} else if (e.key === 'Escape') {
			selectedFormationId = null;
		}
	}
</script>

<svelte:head>
	<title>{flow ? `${flow.name} — 流程編輯器` : '流程編輯器'}</title>
</svelte:head>
<svelte:window {onkeydown} />

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
				positions={positionsAt(flow, playheadSec)}
				onmove={move}
			/>
		</main>
		<aside class="inspector">
			<MemberPanel {flow} onchange={(f) => (flow = f)} />
		</aside>
		<div class="timeline-host">
			<Timeline
				{flow}
				{playheadSec}
				onseek={(sec) => flow && seek(flow, sec)}
				onaddsegment={(kind) => flow && add(flow, kind)}
				onopensegment={(id) => (openSegmentId = id)}
				{selectedFormationId}
				onselectformation={(id, sec) => {
					selectedFormationId = id;
					playheadSec = sec;
				}}
				ondeleteformation={removeFormation}
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
