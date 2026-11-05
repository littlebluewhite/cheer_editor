<script lang="ts">
	// 段設定：音樂段（音樂檔、BPM、第一拍、波形、長度）或口號段（秒數）。
	// 每改一個欄位就送一個流程核心指令；被擋就顯示原因，流程不變。
	// 段縮短會刪掉動作或站位時，先顯示清單，按確定才改。
	import { getEditorSession } from '#lib/editor-session.svelte.js';
	import ConfirmList from './ConfirmList.svelte';
	import Icon from './Icon.svelte';
	import Modal from './Modal.svelte';
	import { Ask } from './ask.svelte';
	import { tick } from 'svelte';
	import {
		AUDIO_EXTENSIONS,
		MAX_BPM,
		MIN_BPM,
		beatLines,
		deleteSegment,
		loadSegmentAudio,
		moveSegment,
		musicLength,
		musicLengthFromAudio,
		musicOverrunSec,
		segmentSpans,
		updateSegment,
		type ConfirmOption,
		type SegmentPatch
	} from '#lib/core';
	import {
		WAVE_WINDOW_SEC,
		decodeAudio,
		type DecodedAudio,
		type LoadedAudio
	} from '#lib/audio/decode.js';

	interface Props {
		segmentId: string;
		/** 已經解碼的音樂檔，用 audioId 對應。位元組不放在流程裡。 */
		audios: Record<string, LoadedAudio>;
		onaudioload: (audioId: string, audio: LoadedAudio) => void;
		/** 「▶ 從第一拍聽 2 個八拍」：音訊在頁面那一層。 */
		onpreview: (segmentId: string) => void;
		onclose: () => void;
		/** 解碼音樂檔；測試換成假的（jsdom 沒有 Web Audio）。 */
		decode?: (bytes: ArrayBuffer) => Promise<DecodedAudio>;
		/** 滑鼠在波形上的位置換成音樂檔的秒數；測試換成假的（jsdom 不算版面）。 */
		waveXToSec?: (e: MouseEvent) => number;
	}

	let {
		segmentId,
		audios,
		onaudioload,
		onpreview,
		onclose,
		decode = decodeAudio,
		waveXToSec = defaultWaveXToSec
	}: Props = $props();

	const session = getEditorSession();
	const flow = $derived(session.flow!);

	function defaultWaveXToSec(e: MouseEvent): number {
		const r = (e.currentTarget as Element).getBoundingClientRect();
		return ((e.clientX - r.left) / r.width) * WAVE_WINDOW_SEC;
	}

	/** 被擋的原因，和段縮短會刪掉東西時等教練確認的清單（流程核心給的）。 */
	const ask = new Ask((f) => session.change(f), { confirmLabel: '確定刪除' });
	const span = $derived(segmentSpans(flow).find((s) => s.segment.id === segmentId));
	const segment = $derived(span?.segment);
	const music = $derived(segment?.kind === 'music' ? segment : null);
	const audio = $derived(music?.audioId ? audios[music.audioId] : undefined);
	const audioName = $derived(flow.audio.find((a) => a.id === music?.audioId)?.name);
	const otherAudio = $derived(flow.audio.filter((a) => a.id !== music?.audioId));
	const length = $derived(music && musicLength(music));
	/** 段比音樂檔長幾秒（從第一拍算）；還沒載入音樂是 0。 */
	const overrun = $derived(music && audio ? musicOverrunSec(music, audio.durationSec) : 0);
	const lines = $derived(
		music ? beatLines({ bpm: music.bpm, firstBeatSec: music.firstBeatSec, windowSec: WAVE_WINDOW_SEC }) : []
	);
	const wavePath = $derived.by(() => {
		const peaks = audio?.peaks ?? [];
		const w = WAVE_WINDOW_SEC / peaks.length;
		return peaks.map((p, i) => `M${i * w} ${1 - p}h${w}v${2 * p}h${-w}z`).join('');
	});

	/** 取消時換一個值，讓欄位照流程重畫，回到原本的值。 */
	let fieldsKey = $state(0);

	/** 新的改法取代還沒確認的舊清單。 */
	function update(patch: SegmentPatch) {
		ask.send((o: ConfirmOption = {}) => updateSegment(flow, segmentId, patch, o), {
			cancel: () => (fieldsKey += 1)
		});
	}

	/** 一格數字欄位送出：被擋就把那一格還原成實際的值（actual 照那時候的流程算），原因記在那一格。 */
	function updateField(input: HTMLInputElement, field: string, patch: SegmentPatch, actual: () => number | undefined) {
		ask.send((o: ConfirmOption = {}) => updateSegment(flow, segmentId, patch, o), {
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

	/** 不是流程核心擋的（檔案讀不出來、還沒載入）：跟核心擋下來一樣，交給問教練留下原因。 */
	const blocked = (message: string, handlers: { field?: string; revert?: () => void } = {}) =>
		void ask.send(() => ({ kind: 'blocked', message }) as const, handlers);

	/** 設定關掉了沒（音樂檔解碼完時用）。 */
	let closed = false;
	$effect(() => () => {
		closed = true;
	});

	async function load(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		const check = loadSegmentAudio(flow, segmentId, file.name, Object.keys(audios));
		if (check.kind === 'blocked') return blocked(check.message);
		const bytes = await file.arrayBuffer();
		let decoded: DecodedAudio;
		try {
			decoded = await decode(bytes);
		} catch {
			return blocked('這個音樂檔讀不出來');
		}
		// 解碼時設定已經關掉（可能換開了別段、別的流程）：這個檔不要了。
		if (closed) return;
		// 解碼要一點時間，用那時候的流程再送一次指令。
		ask.send(() => loadSegmentAudio(flow, segmentId, file.name, Object.keys(audios)), {
			done: (r) => onaudioload(r.audioId, { bytes, ...decoded })
		});
	}

	/** 有載入音樂時，第一拍要在音樂結束之前；不然擋下來（沒載入就不知道音樂多長，交給核心）。 */
	const pastEnd = (sec: number) =>
		audio && sec >= audio.durationSec ? `第一拍要在音樂結束（${audio.durationSec.toFixed(1)} 秒）之前` : null;

	function setFirstBeat(sec: number) {
		const problem = pastEnd(sec);
		if (problem) return blocked(problem);
		update({ firstBeatSec: sec });
	}

	/** 「第一拍（秒）」欄位：跟點波形一樣，但被擋時還原這一格、原因記在這一格。 */
	function typeFirstBeat(input: HTMLInputElement) {
		const field = '第一拍（秒）';
		const revert = () => (input.value = String(music?.firstBeatSec ?? ''));
		const problem = pastEnd(input.valueAsNumber);
		if (problem) return blocked(problem, { field, revert });
		updateField(input, field, { firstBeatSec: input.valueAsNumber }, () => music?.firstBeatSec);
	}

	function clickWave(e: MouseEvent) {
		setFirstBeat(waveXToSec(e));
	}

	function fitToAudio() {
		if (!music || !audio) return blocked('先載入音樂檔');
		const problem = pastEnd(music.firstBeatSec);
		if (problem) return blocked(problem);
		update(
			musicLengthFromAudio({
				durationSec: audio.durationSec,
				firstBeatSec: music.firstBeatSec,
				bpm: music.bpm
			})
		);
	}
</script>

<Modal label={`${span?.label ?? ''} 設定`} class="dialog seg-dialog" {ask} {onclose}>
	{#snippet children(close)}
		<header class="dialog-head">
			<h2>{span?.label} 設定</h2>
			{#if span}<span class="hint">共 {span.durationSec.toFixed(1)} 秒</span>{/if}
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
							? `${audioName}${audio ? `（${audio.durationSec.toFixed(1)} 秒）` : '（找不到音樂，請重新選檔）'}`
							: '還沒載入'}
					</span>
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
						<input type="number" min={MIN_BPM} max={MAX_BPM} value={music.bpm} onchange={(e) => updateField(e.currentTarget, 'BPM', { bpm: e.currentTarget.valueAsNumber }, () => music?.bpm)} />
					</label>
					<span class="hint">{MIN_BPM}–{MAX_BPM}</span>
					<label class="inline">
						第一拍（秒）
						<input
							type="number"
							step="0.01"
							min="0"
							value={music.firstBeatSec}
							onchange={(e) => typeFirstBeat(e.currentTarget)}
						/>
					</label>
					<button type="button" class="listen" onclick={() => onpreview(segmentId)}
						>▶ 從第一拍聽 2 個八拍</button
					>
				</div>
				<!-- 波形用滑鼠點；鍵盤用上面的「第一拍（秒）」欄位，所以不另外接鍵盤事件。 -->
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
				<svg
					class="wave"
					role="img"
					aria-label="波形"
					viewBox={`0 0 ${WAVE_WINDOW_SEC} 2`}
					preserveAspectRatio="none"
					onclick={clickWave}
				>
					<line class="mid" x1="0" x2={WAVE_WINDOW_SEC} y1="1" y2="1" />
					<path class="peaks" d={wavePath} />
					{#each lines as line (line.sec)}
						<line class={line.kind} x1={line.sec} x2={line.sec} y1="0" y2="2" />
					{/each}
				</svg>
				<p class="hint">
					{audio ? '' : '沒有音樂檔：載入後會畫出波形。'}在波形上點一下＝把第一拍放在那裡。細線是照 BPM
					算出的每一拍，對準鼓點就對了。只顯示前 {WAVE_WINDOW_SEC} 秒。
				</p>
			</section>

			<section>
				<h3>長度</h3>
				<div class="row">
					<label class="inline">
						八拍數
						<input type="number" min="1" step="1" value={length.eights} onchange={(e) => updateField(e.currentTarget, '八拍數', { eights: e.currentTarget.valueAsNumber }, () => length?.eights)} />
					</label>
					<label class="inline">
						最後一個八拍有幾拍
						<input
							type="number"
							min="1"
							max="8"
							step="1"
							value={length.lastBeats}
							onchange={(e) => updateField(e.currentTarget, '最後一個八拍有幾拍', { lastBeats: e.currentTarget.valueAsNumber }, () => length?.lastBeats)}
						/>
					</label>
					<button type="button" onclick={fitToAudio}>照音樂長度算</button>
				</div>
				{#if overrun > 0}
					<p class="hint-warn" role="note">
						這一段比音樂檔長 {overrun.toFixed(1)} 秒：最後那一段播放時沒有聲音。要剛好就按「照音樂長度算」。
					</p>
				{/if}
			</section>
		{:else if segment?.kind === 'chant'}
			<section>
				<div class="row">
					<label class="inline">
						長度（秒）
						<input
							type="number"
							step="0.1"
							min="0.1"
							value={span?.durationSec}
							onchange={(e) => updateField(e.currentTarget, '長度（秒）', { seconds: e.currentTarget.valueAsNumber }, () => span?.durationSec)}
						/>
					</label>
					<span class="hint">口號段只計秒數，最細 0.1 秒</span>
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
	input[type='number'] {
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
