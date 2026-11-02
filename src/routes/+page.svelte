<script lang="ts">
	import {
		addSegment,
		deleteAction,
		deleteFormation,
		firstBeatPreview,
		formationAt,
		formationTimes,
		insertFormation,
		playbackPlan,
		positionText,
		positionsAt,
		raisedAt,
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
	import ActionForm from '#lib/components/ActionForm.svelte';
	import Field from '#lib/components/Field.svelte';
	import FlowSettings from '#lib/components/FlowSettings.svelte';
	import MemberPanel from '#lib/components/MemberPanel.svelte';
	import MemberPicker from '#lib/components/MemberPicker.svelte';
	import NewFlowForm from '#lib/components/NewFlowForm.svelte';
	import PrintSheet from '#lib/components/PrintSheet.svelte';
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
	/** 八拍表列印畫面開著：印的時候只印它，不印編輯畫面。 */
	let printOpen = $state(false);
	let notice = $state('');
	/** 選到的站位（點縮圖選）；按 Delete 刪掉它。 */
	let selectedFormationId = $state<string | null>(null);
	/** 選到的動作（點色條選）；按 Delete 刪掉它。跟站位一次只選一種。 */
	let selectedActionId = $state<string | null>(null);
	/** 選到的人（選人捷徑、點人、框選、點泳道名字）：新增動作用的人，也是場上整組拖的那一組。跟動作、站位的選取分開。 */
	let selectedMemberIds = $state<string[]>([]);

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
			if (r.kind !== 'ok') return void (notice = r.message);
			f = r.flow;
			message = '插了一張站位，大家的位置自動帶入';
		}
		const target = formationAt(f, playheadSec)!;
		const r = setPositions(f, target.id, moves);
		if (r.kind !== 'ok') return void (notice = r.message);
		flow = r.flow;
		notice = message;
		playheadSec = formationTimes(r.flow).find((t) => t.formation.id === target.id)!.sec;
	}

	function removeFormation(id: string) {
		if (!flow) return;
		const r = deleteFormation(flow, id);
		if (r.kind !== 'ok') return void (notice = r.message);
		flow = r.flow;
		notice = '';
		if (selectedFormationId === id) selectedFormationId = null;
	}

	function onkeydown(e: KeyboardEvent) {
		// 八拍表蓋在上面時，快捷鍵不動到底下的編輯畫面
		if (!flow || printOpen) return;
		if ((e.target as Element | null)?.closest?.('input, textarea, select, [contenteditable]')) return;
		if (e.key === ' ') {
			if (e.repeat) return;
			// 不讓焦點所在的按鈕也被空白鍵按到
			e.preventDefault();
			togglePlay(flow);
		} else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedFormationId) {
			e.preventDefault();
			removeFormation(selectedFormationId);
		} else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedActionId) {
			// Mac 的 delete 鍵送的是 Backspace
			e.preventDefault();
			removeAction(selectedActionId);
		} else if (e.key === 'Escape') {
			selectedFormationId = null;
			selectedActionId = null;
			selectedMemberIds = [];
		}
	}

	function removeAction(id: string) {
		if (!flow) return;
		const r = deleteAction(flow, id);
		if (r.kind === 'ok') flow = r.flow;
		selectedActionId = null;
	}

	function selectAction(id: string | null) {
		selectedActionId = id;
		if (id) selectedFormationId = null;
	}

	function selectMembers(ids: string[]) {
		selectedMemberIds = ids;
	}
</script>

<svelte:head>
	<title>{flow ? `${flow.name} — 流程編輯器` : '流程編輯器'}</title>
</svelte:head>
<svelte:window {onkeydown} />

{#if flow}
	<div class="editor" class:print-hidden={printOpen}>
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
			<button type="button" class="print" onclick={() => (printOpen = true)}>八拍表</button>
		</header>
		<main class="field-host">
			<Field
				field={flow.field}
				members={flow.members}
				positions={positionsAt(flow, playheadSec)}
				raised={raisedAt(flow, playheadSec)}
				selected={selectedMemberIds}
				onmove={move}
				onselect={selectMembers}
			/>
		</main>
		<aside class="inspector">
			<MemberPicker {flow} {playheadSec} selected={selectedMemberIds} onselect={selectMembers} />
			<ActionForm
				{flow}
				{playheadSec}
				actionId={selectedActionId}
				onchange={(f) => (flow = f)}
				onselect={selectAction}
				{selectedMemberIds}
				onselectmembers={selectMembers}
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
				{selectedFormationId}
				onselectformation={(id, sec) => {
					selectedFormationId = id;
					selectedActionId = null;
					if (flow) seek(flow, sec);
				}}
				ondeleteformation={removeFormation}
				{selectedActionId}
				onselectaction={selectAction}
				onchange={(f) => {
					flow = f;
					notice = '';
				}}
				onblocked={(message) => (notice = `${message}，已還原`)}
				{selectedMemberIds}
				onselectmembers={selectMembers}
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
	{#if printOpen}
		<PrintSheet {flow} onclose={() => (printOpen = false)} />
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
	.topbar .print {
		margin-left: 0;
	}
	@media print {
		.print-hidden {
			display: none;
		}
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
