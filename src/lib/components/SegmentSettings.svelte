<script lang="ts">
	// 段設定：音樂段（音樂檔、BPM、第一拍、波形、長度）或口號段（秒數）。
	// 每改一個欄位就送一個流程核心指令；被擋就顯示原因，流程不變。
	// 段縮短會刪掉動作或站位時，先顯示清單，按確定才改。
	import ConfirmList from './ConfirmList.svelte';
	import Icon from './Icon.svelte';
	import { Ask } from './ask.svelte';
	import { numberValue } from './form';
	import {
		AUDIO_EXTENSIONS,
		MAX_BPM,
		MIN_BPM,
		beatLines,
		loadSegmentAudio,
		musicLength,
		musicLengthFromAudio,
		segmentSpans,
		updateSegment,
		type ConfirmOption,
		type Flow,
		type SegmentPatch
	} from '#lib/core';
	import {
		WAVE_WINDOW_SEC,
		decodeAudio,
		type DecodedAudio,
		type LoadedAudio
	} from '#lib/audio/decode.js';

	interface Props {
		flow: Flow;
		segmentId: string;
		/** 已經解碼的音樂檔，用 audioId 對應。位元組不放在流程裡。 */
		audios: Record<string, LoadedAudio>;
		onchange: (flow: Flow) => void;
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
		flow,
		segmentId,
		audios,
		onchange,
		onaudioload,
		onpreview,
		onclose,
		decode = decodeAudio,
		waveXToSec = defaultWaveXToSec
	}: Props = $props();

	function defaultWaveXToSec(e: MouseEvent): number {
		const r = (e.currentTarget as Element).getBoundingClientRect();
		return ((e.clientX - r.left) / r.width) * WAVE_WINDOW_SEC;
	}

	/** 被擋的原因，和段縮短會刪掉東西時等教練確認的清單（流程核心給的）。 */
	const ask = new Ask((f) => onchange(f), { confirmLabel: '確定刪除' });
	const span = $derived(segmentSpans(flow).find((s) => s.segment.id === segmentId));
	const segment = $derived(span?.segment);
	const music = $derived(segment?.kind === 'music' ? segment : null);
	const audio = $derived(music?.audioId ? audios[music.audioId] : undefined);
	const audioName = $derived(flow.audio.find((a) => a.id === music?.audioId)?.name);
	const otherAudio = $derived(flow.audio.filter((a) => a.id !== music?.audioId));
	const length = $derived(music && musicLength(music));
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

	/** 不是流程核心擋的（檔案讀不出來、還沒載入）：跟核心擋下來一樣，交給問教練留下原因。 */
	const blocked = (message: string) => void ask.send(() => ({ kind: 'blocked', message }) as const);

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

	function clickWave(e: MouseEvent) {
		update({ firstBeatSec: waveXToSec(e) });
	}

	function fitToAudio() {
		if (!music || !audio) return blocked('先載入音樂檔');
		update(
			musicLengthFromAudio({
				durationSec: audio.durationSec,
				firstBeatSec: music.firstBeatSec,
				bpm: music.bpm
			})
		);
	}
</script>

<div class="backdrop">
	<div class="dialog seg-dialog" role="dialog" aria-label={`${span?.label ?? ''} 設定`}>
		<header class="dialog-head">
			<h2>{span?.label} 設定</h2>
			{#if span}<span class="hint">共 {span.durationSec.toFixed(1)} 秒</span>{/if}
			<button type="button" class="ghost icon close" aria-label="關閉" onclick={onclose}><Icon name="close" /></button>
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
						<input type="number" min={MIN_BPM} max={MAX_BPM} value={music.bpm} onchange={(e) => update({ bpm: numberValue(e) })} />
					</label>
					<span class="hint">{MIN_BPM}–{MAX_BPM}</span>
					<label class="inline">
						第一拍（秒）
						<input
							type="number"
							step="0.01"
							min="0"
							value={music.firstBeatSec}
							onchange={(e) => update({ firstBeatSec: numberValue(e) })}
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
						<input type="number" min="1" step="1" value={length.eights} onchange={(e) => update({ eights: numberValue(e) })} />
					</label>
					<label class="inline">
						最後一個八拍有幾拍
						<input
							type="number"
							min="1"
							max="8"
							step="1"
							value={length.lastBeats}
							onchange={(e) => update({ lastBeats: numberValue(e) })}
						/>
					</label>
					<button type="button" onclick={fitToAudio}>照音樂長度算</button>
				</div>
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
							onchange={(e) => update({ seconds: numberValue(e) })}
						/>
					</label>
					<span class="hint">口號段只計秒數，最細 0.1 秒</span>
				</div>
			</section>
		{/if}
		{/key}

		{#if ask.question}<ConfirmList {ask} />{/if}

		{#if ask.error}<p class="error" role="alert">{ask.error}</p>{/if}
	</div>
</div>

<style>
	.seg-dialog {
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
