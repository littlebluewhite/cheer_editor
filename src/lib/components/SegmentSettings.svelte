<script lang="ts">
	// 段設定：音樂段（音樂檔、BPM、第一拍、波形、長度）或口號段（秒數）。
	// 每改一個欄位就送一個流程核心指令；被擋就顯示原因，流程不變。
	// 段縮短會刪掉動作或站位時，先顯示清單，按確定才改。
	import { getEditor } from '#lib/editor.svelte.js';
	import { getEditorSession } from '#lib/editor-session.svelte.js';
	import ConfirmList from './ConfirmList.svelte';
	import Icon from './Icon.svelte';
	import Modal from './Modal.svelte';
	import { tick, untrack } from 'svelte';
	import {
		AUDIO_EXTENSIONS,
		BROKEN_AUDIO,
		MAX_BPM,
		MAX_CHANT_SEC,
		MAX_EIGHTS,
		MIN_BPM,
		MIN_TAPS,
		audioOverlaps,
		beatLines,
		deleteSegment,
		fitSegmentToAudio,
		moveSegment,
		musicLength,
		musicOverrunSec,
		readSegmentNumber,
		segmentSpans,
		splitSegment,
		tapBpm,
		updateSegment,
		type ConfirmOption,
		type SegmentNumberField,
		type SegmentPatch
	} from '#lib/core';
	import { PEAKS_PER_SEC } from '#lib/audio/decode.js';

	interface Props {
		segmentId: string;
		onclose: () => void;
		/** 滑鼠在波形上的位置換成音樂檔的秒數（波形畫 wave.startSec 起的 wave.lengthSec 秒，就是整個音樂檔）；測試換成假的（jsdom 不算版面）。 */
		waveXToSec?: (e: MouseEvent, wave: { startSec: number; lengthSec: number }) => number;
	}

	let { segmentId, onclose, waveXToSec = defaultWaveXToSec }: Props = $props();

	const session = getEditorSession();
	const flow = $derived(session.flow!);
	/** 音樂檔（解碼好的、壞的、多長）從編輯器 module 的音樂檔庫拿：換流程會換一個，所以每次用都從 editor.music 拿。 */
	const editor = getEditor();
	/**
	 * 播放從編輯器 module 拿：「▶ 從第一拍聽 2 個八拍」試聽，響的時候按鈕換成「■ 停止試聽」；
	 * 正在播放時段設定蓋住上方列的暫停鈕，所以這裡也放一顆。
	 */
	const { playback } = editor;

	function defaultWaveXToSec(e: MouseEvent, wave: { startSec: number; lengthSec: number }): number {
		const r = (e.currentTarget as Element).getBoundingClientRect();
		return wave.startSec + ((e.clientX - r.left) / r.width) * wave.lengthSec;
	}

	/** 被擋的原因，和段縮短會刪掉東西時等教練確認的清單（流程核心給的）。 */
	const ask = session.changeAsk({ confirmLabel: '確定刪除' });
	const span = $derived(segmentSpans(flow).find((s) => s.segment.id === segmentId));
	const segment = $derived(span?.segment);
	const music = $derived(segment?.kind === 'music' ? segment : null);
	const loadedAudio = $derived(editor.music.get(music?.audioId));
	/** 音樂檔壞了（解不開）：不知道多長，不拿長度 0 去算、去提醒。 */
	const broken = $derived(!!loadedAudio?.broken);
	const audio = $derived(broken ? undefined : loadedAudio);
	const audioName = $derived(flow.audio.find((a) => a.id === music?.audioId)?.name);
	const otherAudio = $derived(flow.audio.filter((a) => a.id !== music?.audioId));
	const length = $derived(music && musicLength(music));
	/** 段比音樂檔長幾秒（從第一拍算）；還沒載入音樂是 0。 */
	const overrun = $derived(music && audio ? musicOverrunSec(music, audio.durationSec) : 0);
	/** 「照音樂長度算」按了也會被擋的原因（例如第一拍在音樂結束之後）：提醒就不叫人去按。 */
	const fitBlocked = $derived.by(() => {
		if (!overrun) return null;
		const r = fitSegmentToAudio(flow, segmentId, editor.music.lengths);
		return r.kind === 'blocked' ? r.message : null;
	});
	/** 這一段用到的那一截：音樂檔裡從第一拍到段尾（波形上標亮）。 */
	const used = $derived({ startSec: music?.firstBeatSec ?? 0, endSec: (music?.firstBeatSec ?? 0) + (span?.durationSec ?? 0) });
	/** 波形畫整個音樂檔（段比音樂長就畫到段尾），第一拍前面也點得到。 */
	const wave = $derived({ startSec: 0, lengthSec: Math.max(audio?.durationSec ?? 0, used.endSec) });
	const lines = $derived(music ? beatLines({ bpm: music.bpm, firstBeatSec: music.firstBeatSec, windowSec: used.endSec }) : []);
	const wavePath = $derived.by(() => {
		const peaks = audio?.peaks ?? [];
		const w = 1 / PEAKS_PER_SEC;
		let d = '';
		for (let i = 0; i < peaks.length; i++) d += `M${i * w} ${1 - peaks[i]}h${w}v${2 * peaks[i]}h${-w}z`;
		return d;
	});
	/** 跟這一段用同一個音樂檔、時間重疊的段：那一截會播兩次。 */
	const overlaps = $derived(music ? audioOverlaps(flow, segmentId) : []);

	/** 取消時換一個值，讓欄位照流程重畫，回到原本的值。 */
	let fieldsKey = $state(0);

	/** 新的改法取代還沒確認的舊清單。 */
	function update(patch: SegmentPatch) {
		ask.send((o: ConfirmOption = {}) => updateSegment(flow, segmentId, patch, o, editor.music.lengths), {
			cancel: () => (fieldsKey += 1)
		});
	}

	/**
	 * 一格數字欄位送出（key 是改段的哪個欄位）：打的字先由核心讀，讀得懂才改段。
	 * 看不懂或被擋就把那一格還原成實際的值（actual 照那時候的流程算），原因記在那一格。
	 */
	function updateField(input: HTMLInputElement, field: string, key: SegmentNumberField, actual: () => number | undefined) {
		const value = readSegmentNumber(key, input.value);
		ask.send((o: ConfirmOption = {}) => (value.kind === 'blocked' ? value : updateSegment(flow, segmentId, { [key]: value.value }, o, editor.music.lengths)), {
			field,
			revert: () => (input.value = String(actual() ?? '')),
			cancel: () => (fieldsKey += 1)
		});
	}

	/** 這一段排第幾（0 起）。 */
	const index = $derived(flow.segments.findIndex((s) => s.id === segmentId));

	/** 跟旁邊那段換位置；動作、站位跟著段走（見 segment-order.ts）。
	 *  按的那顆變灰（移到頭、尾）時，焦點換到另一顆，不掉出段設定。 */
	async function move(dir: -1 | 1, button: HTMLButtonElement) {
		ask.send(() => moveSegment(flow, segmentId, dir));
		await tick();
		if (!button.disabled) return;
		const other = [...(button.parentElement?.querySelectorAll('button') ?? [])].find((b) => b !== button && !b.disabled);
		(other ?? button.closest<HTMLElement>('[role="dialog"]'))?.focus();
	}

	/** 刪這一段：段裡有動作、站位時核心先問；刪好了關掉段設定。 */
	function remove() {
		ask.send((o: ConfirmOption = {}) => deleteSegment(flow, segmentId, o), { done: onclose });
	}

	// 段設定關了（可能換開了別段、別的流程）：還在解碼的音樂檔不要了。
	$effect(() => () => editor.music.cancelPicks());

	/** 選音樂檔：音樂檔庫解碼、跟核心拿 id；成功算一步，被擋的原因（格式不對、讀不出來）放在這裡。 */
	function load(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		// 清掉欄位：復原後再選同一個檔，瀏覽器才會再通知（值沒變就不送 change）。
		input.value = '';
		if (file) void editor.music.pick(segmentId, file, ask);
	}

	function clickWave(e: MouseEvent) {
		update({ firstBeatSec: waveXToSec(e, wave) });
	}

	/** 敲擊測速：每點一下記下時間（秒）；停超過 TAP_RESET_SEC 再點就重新算。 */
	const TAP_RESET_SEC = 2;
	let taps = $state<number[]>([]);
	const tapped = $derived(tapBpm(taps));
	/** 算出來的 BPM 超出範圍：不給套用，旁邊說為什麼。 */
	const tapOutOfRange = $derived(tapped !== null && (tapped < MIN_BPM || tapped > MAX_BPM));

	function tap() {
		const now = Date.now() / 1000;
		const last = taps.at(-1);
		taps = last !== undefined && now - last > TAP_RESET_SEC ? [now] : [...taps, now];
	}

	function applyTap() {
		const bpm = tapped;
		if (bpm === null || tapOutOfRange) return;
		taps = [];
		update({ bpm });
	}

	/** 打開段設定時的 BPM：改了以後 BPM 旁邊才出現「照音樂長度重算八拍數」（改 BPM 不自動改八拍數）。 */
	const openedBpm = untrack(() => music?.bpm);

	function fitToAudio() {
		const lengths = editor.music.lengths;
		ask.send((o: ConfirmOption = {}) => fitSegmentToAudio(flow, segmentId, lengths, o), {
			cancel: () => (fieldsKey += 1)
		});
	}
</script>

<Modal label={`${span?.label ?? ''} 設定`} class="dialog seg-dialog" {ask} {onclose}>
	{#snippet children(close)}
		<header class="dialog-head">
			<h2>{span?.label} 設定</h2>
			{#if span}<span class="hint">共 {span.durationSec.toFixed(1)} 秒</span>{/if}
			{#if playback.playing}
				<button type="button" class="pause" title="空白鍵也可以暫停" onclick={() => playback.pause()}><Icon name="pause" size={14} />暫停</button>
			{/if}
			<button type="button" class="ghost icon close" aria-label="關閉" onclick={close}><Icon name="close" /></button>
		</header>

		{#key fieldsKey}
		{#if music && length}
			<section>
				<h3>音樂檔</h3>
				<div class="row">
					<label class="file btn">
						載入音樂檔
						<input type="file" accept={AUDIO_EXTENSIONS.map((x) => `.${x}`).join(',')} onchange={load} />
					</label>
					<span class="audio" class:missing={audioName && !audio}>
						{audioName
							? `${audioName}${audio ? `（${audio.durationSec.toFixed(1)} 秒）` : broken ? `（${BROKEN_AUDIO}）` : '（找不到音樂，請重新選檔）'}`
							: '還沒載入'}
					</span>
					<!-- 段留著、變成沒有音樂檔的音樂段，播放只剩節拍器；算一步，可以復原。 -->
					{#if music.audioId !== null}
						<button type="button" onclick={() => update({ audioId: null })}>拿掉音樂</button>
					{/if}
				</div>
				{#if otherAudio.length}
					<div class="row">
						<label class="inline">
							用已載入的音樂
							<select onchange={(e) => update({ audioId: e.currentTarget.value })}>
								<option value="" selected>選一個…</option>
								{#each otherAudio as a (a.id)}
									<option value={a.id}>{a.name}</option>
								{/each}
							</select>
						</label>
						<span class="hint">音樂中途變速時，兩個音樂段用同一個檔</span>
					</div>
				{/if}
			</section>

			<section>
				<h3>速度和第一拍</h3>
				<div class="row">
					<label class="inline">
						BPM
						<input type="text" inputmode="decimal" value={music.bpm} onchange={(e) => updateField(e.currentTarget, 'BPM', 'bpm', () => music?.bpm)} />
					</label>
					<span class="hint">{MIN_BPM}–{MAX_BPM}</span>
					{#if music.bpm !== openedBpm}
						<button type="button" onclick={fitToAudio}>照音樂長度重算八拍數</button>
					{/if}
					<label class="inline">
						第一拍（秒）
						<input
							type="text"
							inputmode="decimal"
							value={music.firstBeatSec}
							onchange={(e) => updateField(e.currentTarget, '第一拍（秒）', 'firstBeatSec', () => music?.firstBeatSec)}
						/>
					</label>
					<!-- 同一顆按鈕換字：按了以後焦點留在上面，再按一次就停。 -->
					<button type="button" class="listen" onclick={() => (playback.previewing ? playback.stopPreview() : playback.preview(segmentId))}
						>{playback.previewing ? '■ 停止試聽' : '▶ 從第一拍聽 2 個八拍'}</button
					>
				</div>
				<div class="row">
					<button type="button" onclick={tap}>敲擊測速</button>
					<span class="hint" aria-live="polite">
						{tapped !== null
							? `點了 ${taps.length} 下，約 ${tapped} BPM${tapOutOfRange ? `：超出 ${MIN_BPM}–${MAX_BPM}，不能套用` : ''}`
							: taps.length
								? `再點 ${MIN_TAPS - taps.length} 下`
								: `跟著音樂的拍子連點 ${MIN_TAPS} 下以上；停 ${TAP_RESET_SEC} 秒再點就重新算`}
					</span>
					<button type="button" disabled={tapped === null || tapOutOfRange} onclick={applyTap}>套用{tapped !== null ? ` ${tapped} BPM` : ''}</button>
				</div>
				<!-- 波形用滑鼠點；鍵盤用上面的「第一拍（秒）」欄位，所以不另外接鍵盤事件。 -->
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
				<svg
					class="wave"
					role="img"
					aria-label="波形"
					viewBox={`${wave.startSec} 0 ${wave.lengthSec} 2`}
					preserveAspectRatio="none"
					onclick={clickWave}
				>
					<rect class="used" x={used.startSec} width={used.endSec - used.startSec} y="0" height="2" />
					<line class="mid" x1={wave.startSec} x2={wave.startSec + wave.lengthSec} y1="1" y2="1" />
					<path class="peaks" d={wavePath} />
					{#each lines as line (line.sec)}
						<line class={line.kind} x1={line.sec} x2={line.sec} y1="0" y2="2" />
					{/each}
				</svg>
				<p class="hint">
					{audio ? '' : '沒有音樂檔：載入後會畫出波形。'}在波形上點一下＝把第一拍放在那裡，第一拍前面也點得到。細線是照 BPM
					算出的每一拍，對準鼓點就對了。波形畫整個音樂檔，亮的那一截是這一段用到的：從第一拍到段尾。
				</p>
			</section>

			<section>
				<h3>長度</h3>
				<div class="row">
					<label class="inline">
						八拍數
						<input type="text" inputmode="numeric" value={length.eights} onchange={(e) => updateField(e.currentTarget, '八拍數', 'eights', () => length?.eights)} />
					</label>
					<label class="inline">
						最後一個八拍有幾拍
						<input
							type="text"
							inputmode="numeric"
							value={length.lastBeats}
							onchange={(e) => updateField(e.currentTarget, '最後一個八拍有幾拍', 'lastBeats', () => length?.lastBeats)}
						/>
					</label>
					<span class="hint">最多 {MAX_EIGHTS} 個八拍</span>
					<button type="button" onclick={fitToAudio}>照音樂長度算</button>
				</div>
				{#if overrun > 0}
					<p class="hint-warn" role="note">
						{#if overrun >= (span?.durationSec ?? 0) - 0.05}這一段整段都在音樂檔結尾之後：播放時沒有聲音。{:else}這一段比音樂檔長 {overrun.toFixed(1)} 秒：最後那一段播放時沒有聲音。{/if}{fitBlocked
							? `${fitBlocked}。`
							: '要剛好就按「照音樂長度算」。'}
					</p>
				{/if}
				<div class="row">
					<button type="button" onclick={() => ask.send(() => splitSegment(flow, segmentId, playback.sec))}>從播放頭這個八拍切成兩段</button>
					<span class="hint">切點在播放頭那個八拍的第 1 拍；後面的動作和站位搬到新的一段，BPM、第一拍接著算</span>
				</div>
				{#each overlaps as o (o.label)}
					<p class="hint-warn" role="note">
						跟{o.label} 用同一個音樂檔，有 {o.sec.toFixed(1)} 秒重疊：那一截音樂會播兩次。
					</p>
				{/each}
			</section>
		{:else if segment?.kind === 'chant'}
			<section>
				<div class="row">
					<label class="inline">
						長度（秒）
						<input
							type="text"
							inputmode="decimal"
							value={span?.durationSec}
							onchange={(e) => updateField(e.currentTarget, '長度（秒）', 'seconds', () => span?.durationSec)}
						/>
					</label>
					<span class="hint">口號段只計秒數，最細 0.1 秒，最長 {MAX_CHANT_SEC} 秒</span>
				</div>
			</section>
		{/if}
		{/key}

		<section class="order">
			<button type="button" disabled={index <= 0} onclick={(e) => move(-1, e.currentTarget)}>往前移</button>
			<button type="button" disabled={index >= flow.segments.length - 1} onclick={(e) => move(1, e.currentTarget)}>往後移</button>
			<button type="button" class="danger" onclick={remove}><Icon name="trash" size={14} />刪除這一段</button>
		</section>

		{#if ask.question}<ConfirmList {ask} />{/if}

		{#each Object.values(ask.fieldErrors) as error (error)}<p class="error" role="alert">{error}</p>{/each}
		{#if ask.error}<p class="error" role="alert">{ask.error}</p>{/if}
	{/snippet}
</Modal>

<style>
	/* 播放中才有的暫停鈕：靠右，緊挨著 × */
	.pause {
		margin-left: auto;
	}
	.pause + .close {
		margin-left: 0;
	}
	.order {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.order .danger {
		margin-left: auto;
	}
	:global(.seg-dialog) {
		width: min(680px, 100%);
	}
	section {
		display: grid;
		gap: 10px;
	}
	section + section {
		padding-top: 14px;
		border-top: 1px solid var(--line-soft, #e8ecf3);
	}
	h3 {
		margin: 0;
		font-size: 13px;
		font-weight: 700;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 10px 14px;
		align-items: center;
	}
	.inline {
		display: inline-flex;
		gap: 8px;
		align-items: center;
		font-size: 13px;
	}
	input[inputmode] {
		width: 6.5em;
		font-variant-numeric: tabular-nums;
	}
	.file {
		position: relative;
	}
	.file:focus-within {
		outline: 2px solid var(--sel, #19b4d8);
		outline-offset: 2px;
	}
	.file input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}
	.audio {
		font-size: 13px;
		color: var(--muted, #66718a);
	}
	.audio.missing {
		color: var(--danger, #c8372d);
	}
	.listen {
		margin-left: auto;
	}
	.hint {
		margin: 0;
	}
	.wave {
		width: 100%;
		height: 100px;
		background: #0f1830;
		border-radius: 8px;
		cursor: crosshair;
	}
	.peaks {
		fill: #6f97dc;
	}
	/* 這一段用到的那一截：底色亮一點 */
	.used {
		fill: rgba(255, 255, 255, 0.1);
	}
	line {
		vector-effect: non-scaling-stroke;
		stroke: rgba(255, 255, 255, 0.18);
		stroke-width: 1;
	}
	line.mid {
		stroke: rgba(255, 255, 255, 0.08);
	}
	line.eight {
		stroke: rgba(255, 255, 255, 0.6);
	}
	line.first {
		stroke: var(--now, #f2542d);
		stroke-width: 2;
	}
	.error {
		margin: 0;
		padding: 8px 10px;
		border-radius: 8px;
		background: var(--danger-soft, #fdecea);
		color: var(--danger, #c8372d);
	}
</style>
