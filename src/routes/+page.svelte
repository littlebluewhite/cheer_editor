<script lang="ts">
	import {
		addSegment,
		firstBeatPreview,
		playbackPlan,
		positionText,
		setPositions,
		timeRuleWarnings,
		totalSeconds,
		type Flow,
		type Position,
		type SegmentKind
	} from '#lib/core';
	import type { LoadedAudio } from '#lib/audio/decode.js';
	import { createWebAudioEngine, type AudioEngine } from '#lib/audio/engine.js';
	import { createPlayer, type Player } from '#lib/audio/player.js';
	import { loadLatencyMs, saveLatencyMs } from '#lib/local-settings.js';
	import Field from '#lib/components/Field.svelte';
	import FlowSettings from '#lib/components/FlowSettings.svelte';
	import MemberPanel from '#lib/components/MemberPanel.svelte';
	import NewFlowForm from '#lib/components/NewFlowForm.svelte';
	import SegmentSettings from '#lib/components/SegmentSettings.svelte';
	import Timeline from '#lib/components/Timeline.svelte';

	interface Props {
		/** 音訊引擎；測試換成假的（jsdom 沒有 Web Audio）。第一次播放時才建立。 */
		createEngine?: (getBuffer: (audioId: string) => AudioBuffer | undefined) => AudioEngine;
	}

	let { createEngine = createWebAudioEngine }: Props = $props();

	let flow = $state<Flow | null>(null);
	/** 解碼過的音樂檔，用 flow.audio 的 id 對應；位元組不放進流程。 */
	let audios = $state<Record<string, LoadedAudio>>({});
	/** 播放頭，全域秒數。 */
	let playheadSec = $state(0);
	let openSegmentId = $state<string | null>(null);
	let settingsOpen = $state(false);
	let notice = $state('');

	/** 開頭那張站位；站位與走位的票會換成播放頭那張。 */
	const formation = $derived(flow?.formations[0]);

	let playing = $state(false);
	let metronome = $state(true);
	/** 延遲校正（毫秒）：存在瀏覽器，不進流程檔。 */
	let latencyMs = $state(loadLatencyMs());
	let player: Player | null = null;

	function getPlayer(): Player {
		player ??= createPlayer(createEngine((id) => audios[id]?.buffer));
		return player;
	}

	function seek(f: Flow, sec: number) {
		playheadSec = Math.min(Math.max(sec, 0), totalSeconds(f));
		if (playing) play(f);
	}

	/** 從播放頭開始播；已經播完就從頭。一定由按鈕或空白鍵觸發。 */
	function play(f: Flow) {
		if (playheadSec >= totalSeconds(f) - 0.01) playheadSec = 0;
		getPlayer().start(playbackPlan(f, playheadSec), { fromSec: playheadSec, metronome });
		if (!playing) {
			playing = true;
			requestAnimationFrame(frame);
		}
	}

	function pause() {
		playing = false;
		player?.stop();
	}

	function togglePlay(f: Flow) {
		if (playing) pause();
		else play(f);
	}

	/** 每一格畫面：照喇叭正在播的時間移動播放頭；播完就停。 */
	function frame() {
		if (!playing || !player) return;
		playheadSec = player.tick(latencyMs);
		if (!player.playing) playing = false;
		else requestAnimationFrame(frame);
	}

	function preview(f: Flow, segmentId: string) {
		pause();
		getPlayer().start(firstBeatPreview(f, segmentId), { fromSec: 0, metronome: true });
	}

	function setMetronome(f: Flow, on: boolean) {
		metronome = on;
		if (playing) play(f);
	}

	function setLatency(ms: number) {
		if (!Number.isFinite(ms)) return;
		latencyMs = ms;
		saveLatencyMs(ms);
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key !== ' ' || e.repeat || !flow) return;
		if ((e.target as Element).closest?.('input, textarea, select, [contenteditable]')) return;
		// 不讓焦點所在的按鈕也被空白鍵按到
		e.preventDefault();
		togglePlay(flow);
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
</script>

<svelte:head>
	<title>{flow ? `${flow.name} — 流程編輯器` : '流程編輯器'}</title>
</svelte:head>

<svelte:window {onkeydown} />

{#if flow}
	<div class="editor">
		<header class="topbar">
			<b>{flow.name}</b>
			<button
				type="button"
				class="play"
				aria-label={playing ? '暫停' : '播放'}
				onclick={() => flow && togglePlay(flow)}>{playing ? '❚❚' : '▶'}</button
			>
			<span class="pos" aria-label="目前位置">{positionText(flow, playheadSec)}</span>
			<label>
				<input
					type="checkbox"
					checked={metronome}
					onchange={(e) => flow && setMetronome(flow, e.currentTarget.checked)}
				/>節拍器
			</label>
			<label title="用藍牙耳機時，畫面比聲音快就調大。存在這台電腦，不進流程檔。">
				延遲校正（毫秒）
				<input
					type="number"
					step="10"
					class="latency"
					value={latencyMs}
					onchange={(e) => setLatency(e.currentTarget.valueAsNumber)}
				/>
			</label>
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
			onpreview={(id) => flow && preview(flow, id)}
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
	.topbar .play {
		width: 40px;
		margin-left: 0;
	}
	.topbar label {
		display: flex;
		gap: 4px;
		align-items: center;
	}
	.latency {
		width: 5em;
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
