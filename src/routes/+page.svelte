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
		readFlowFile,
		segmentsMissingAudio,
		setPositions,
		timeRuleWarnings,
		totalSeconds,
		writeFlowFile,
		type Flow,
		type Position,
		type SegmentKind
	} from '#lib/core';
	import { decodeAudio, type DecodedAudio, type LoadedAudio } from '#lib/audio/decode.js';
	import { createWebAudioEngine, type AudioEngine } from '#lib/audio/engine.js';
	import { createPlayer, type Player } from '#lib/audio/player.js';
	import { createIndexedDbDraftStore, type DraftStore } from '#lib/file/draft.js';
	import { createBrowserSaver, type FileSaver } from '#lib/file/save.js';
	import { onMount } from 'svelte';
	import { loadLatencyMs, saveLatencyMs } from '#lib/local-settings.js';
	import { setUnsavedChanges } from '#lib/unsaved.js';
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
		/** 存檔薄層，一支流程一個（記得存到哪個檔）；測試換成假的。 */
		createSaver?: () => FileSaver;
		/** 解碼音樂檔；測試換成假的（jsdom 沒有 Web Audio）。 */
		decode?: (bytes: ArrayBuffer) => Promise<DecodedAudio>;
		/** 草稿存在哪裡（預設 IndexedDB）；測試換成假的（jsdom 沒有 IndexedDB）。 */
		draftStore?: DraftStore;
	}

	let {
		createEngine = createWebAudioEngine,
		createSaver = createBrowserSaver,
		decode = decodeAudio,
		draftStore = createIndexedDbDraftStore()
	}: Props = $props();

	let flow = $state<Flow | null>(null);
	/** 上次存檔或開檔時的流程。指令都回傳新的流程，所以 flow 不是它就是有還沒存的修改。 */
	let savedFlow = $state.raw<Flow | null>(null);
	const unsaved = $derived(flow !== null && flow !== savedFlow);
	$effect(() => setUnsavedChanges(unsaved));
	let saver: FileSaver | null = null;
	let saving = false;
	/** 首頁開檔失敗的原因（編輯中失敗就放在上方列的 notice）。 */
	let openError = $state('');
	/** 打開時找到的草稿，等教練選救回或丟掉。 */
	let draftOffer = $state.raw<{ bytes: Uint8Array; name: string } | null>(null);

	/** 讀過草稿了：在這之前不自動存，免得蓋掉還沒問過的草稿。 */
	let draftChecked = $state(false);

	onMount(async () => {
		let bytes: Uint8Array | null = null;
		try {
			bytes = await draftStore.load();
		} catch {
			// 讀不到草稿就當作沒有
		}
		const r = bytes && readFlowFile(bytes);
		// 等讀草稿的時候教練已經開始編了：不打斷他
		if (bytes && r && r.kind === 'ok' && !flow) draftOffer = { bytes, name: r.flow.name };
		draftChecked = true;
	});

	/**
	 * 編輯時自動存草稿：停手 1 秒才存（整個 zip 含音樂，不要每一下都存）。
	 * 存成流程檔或剛開流程檔（沒有未存的修改）就丟掉草稿：檔案裡已經有了，下次打開不用問。
	 */
	const DRAFT_DELAY_MS = 1000;
	$effect(() => {
		if (!draftChecked || !flow) return;
		const f = flow;
		const keep = unsaved;
		const timer = setTimeout(() => {
			const done = keep ? draftStore.save(writeFlowFile(f, audioBytes(f))) : draftStore.clear();
			done.catch(() => {});
		}, DRAFT_DELAY_MS);
		return () => clearTimeout(timer);
	});

	async function restoreDraft(bytes: Uint8Array) {
		draftOffer = null;
		await openBytes(bytes, false);
	}

	function discardDraft() {
		draftOffer = null;
		draftStore.clear().catch(() => {});
	}
	/** 解碼過的音樂檔，用 flow.audio 的 id 對應；位元組不放進流程。 */
	let audios = $state<Record<string, LoadedAudio>>({});
	const missingSegmentIds = $derived(flow ? segmentsMissingAudio(flow, Object.keys(audios)) : []);
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


	function startFlow(f: Flow) {
		flow = f;
		saver = createSaver();
	}

	/** 流程用到、而且有載入的音樂檔位元組（存檔、草稿都用）。 */
	function audioBytes(f: Flow): Record<string, Uint8Array> {
		const audio: Record<string, Uint8Array> = {};
		for (const a of f.audio) if (audios[a.id]) audio[a.id] = new Uint8Array(audios[a.id].bytes);
		return audio;
	}

	/** 存成「流程名.zip」：Chrome、Edge 第一次跳存檔對話框、之後存回同一個檔；其他瀏覽器下載新檔。 */
	async function save() {
		if (!flow || !saver || saving) return;
		const f = flow;
		saving = true;
		try {
			const outcome = await saver.save(writeFlowFile(f, audioBytes(f)), `${f.name}.zip`);
			if (outcome === 'cancelled') return;
			savedFlow = f;
			notice =
				outcome === 'downloaded'
					? `這個瀏覽器不能存回原檔，所以下載了一個新的「${f.name}.zip」；用 Chrome 或 Edge 才能直接存回原檔。`
					: '';
		} catch {
			notice = '存檔失敗，請再試一次';
		} finally {
			saving = false;
		}
	}

	/** 開檔：四家瀏覽器都用選檔。缺的音樂照開，那一段標紅。 */
	async function open(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		await openBytes(new Uint8Array(await file.arrayBuffer()), true);
	}

	/** 打開流程檔的位元組。fromFile = 從檔案開（算已存）；草稿救回來的還算未存。 */
	async function openBytes(bytes: Uint8Array, fromFile: boolean) {
		const r = readFlowFile(bytes);
		if (r.kind === 'error') {
			if (flow) notice = r.message;
			else openError = r.message;
			return;
		}
		const loaded: Record<string, LoadedAudio> = {};
		let unreadable = false;
		for (const [id, bytes] of Object.entries(r.audio)) {
			const buffer = bytes.slice().buffer;
			try {
				loaded[id] = { bytes: buffer, ...(await decode(buffer)) };
			} catch {
				// 這個瀏覽器解不開（例：Firefox 沒有 AAC）：位元組留著，存檔時照樣存回去，只是不出聲。
				loaded[id] = { bytes: buffer, durationSec: 0, peaks: [] };
				unreadable = true;
			}
		}
		pause();
		openError = '';
		playheadSec = 0;
		openSegmentId = null;
		settingsOpen = false;
		printOpen = false;
		selectedFormationId = null;
		selectedActionId = null;
		audios = loaded;
		startFlow(r.flow);
		savedFlow = fromFile ? flow : null;
		notice = r.missingSegmentIds.length
			? '有段找不到音樂：點紅色的段重新選檔'
			: unreadable
				? '有音樂檔這個瀏覽器讀不出來，播放時會沒有聲音'
				: '';
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
		// Ctrl+S（Mac ⌘S）在輸入框裡也要能存，所以放在最前面；也擋掉瀏覽器的「另存網頁」。
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
			e.preventDefault();
			void save();
			return;
		}
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
			{#if unsaved}<span class="muted">未存</span>{/if}
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
			<button type="button" class="settings" onclick={() => (settingsOpen = true)}>流程設定</button>
			<button type="button" class="print" onclick={() => (printOpen = true)}>八拍表</button>
			<button type="button" onclick={save}>存檔</button>
			<label class="open">開啟<input type="file" accept=".zip" onchange={open} /></label>
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
				{missingSegmentIds}
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
			{decode}
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
{:else if draftOffer}
	<div class="draft-offer" role="alertdialog" aria-labelledby="draft-offer-text">
		<p id="draft-offer-text">上次編的「{draftOffer.name}」還沒存，要救回嗎？</p>
		<button type="button" onclick={() => draftOffer && restoreDraft(draftOffer.bytes)}>救回</button>
		<button type="button" onclick={discardDraft}>丟掉</button>
	</div>
{:else}
	<NewFlowForm oncreate={startFlow} />
	<p class="home-open">
		<label class="open">開啟流程檔<input type="file" accept=".zip" onchange={open} /></label>
		{#if openError}<span class="notice" role="alert">{openError}</span>{/if}
	</p>
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
	.topbar .settings {
		margin-left: auto;
	}
	.muted {
		color: #7a8296;
		font-size: 12px;
	}
	/* 選檔用的 input 藏起來，外面的 label 看起來像按鈕。 */
	.open {
		cursor: pointer;
		padding: 1px 6px;
		border: 1px solid #c5cad6;
		border-radius: 4px;
		background: #fff;
	}
	.open:focus-within {
		outline: 2px solid #5167a8;
	}
	.open input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
	}
	.home-open {
		text-align: center;
	}
	.draft-offer {
		max-width: 420px;
		margin: 80px auto;
		padding: 16px 20px;
		text-align: center;
		background: #fff;
		border: 1px solid #dde1ea;
		border-radius: 6px;
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
