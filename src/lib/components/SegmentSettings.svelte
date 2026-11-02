<script lang="ts">
	// 段設定：音樂段（音樂檔、BPM、第一拍、波形、長度）或口號段（秒數）。
	// 每改一個欄位就送一個流程核心指令；被擋就顯示原因，流程不變。
	// 段縮短會刪掉動作或站位時，先顯示清單，按確定才改。
	import ConfirmList from './ConfirmList.svelte';
	import {
		MAX_BPM,
		MIN_BPM,
		beatLines,
		loadSegmentAudio,
		musicLength,
		musicLengthFromAudio,
		segmentSpans,
		updateSegment,
		type CommandResult,
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

	let error = $state('');
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

	function apply(r: CommandResult) {
		if (r.kind === 'ok') {
			error = '';
			onchange(r.flow);
		} else {
			error = r.message;
		}
	}

	/** 段縮短會刪掉東西時，等教練確認的改法和流程核心給的清單。 */
	let pending = $state<{ patch: SegmentPatch; message: string; items: string[] } | null>(null);
	/** 取消時換一個值，讓欄位照流程重畫，回到原本的值。 */
	let fieldsKey = $state(0);

	function update(patch: SegmentPatch) {
		const r = updateSegment(flow, segmentId, patch);
		if (r.kind === 'confirm') pending = { patch, message: r.message, items: r.items };
		else apply(r);
	}

	function confirmUpdate() {
		if (!pending) return;
		apply(updateSegment(flow, segmentId, pending.patch, { confirmed: true }));
		pending = null;
	}

	function cancelUpdate() {
		pending = null;
		fieldsKey += 1;
	}
	const num = (e: Event) => (e.currentTarget as HTMLInputElement).valueAsNumber;

	async function load(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		const check = loadSegmentAudio(flow, segmentId, file.name);
		if (check.kind === 'blocked') {
			error = check.message;
			return;
		}
		const bytes = await file.arrayBuffer();
		let decoded: DecodedAudio;
		try {
			decoded = await decode(bytes);
		} catch {
			error = '這個音樂檔讀不出來';
			return;
		}
		// 解碼要一點時間，用那時候的流程再送一次指令。
		const r = loadSegmentAudio(flow, segmentId, file.name);
		if (r.kind === 'ok') {
			const loaded = r.flow.segments.find((s) => s.id === segmentId);
			if (loaded?.kind === 'music' && loaded.audioId) {
				onaudioload(loaded.audioId, { bytes, ...decoded });
			}
		}
		apply(r);
	}

	function clickWave(e: MouseEvent) {
		// 點的精度到 0.01 秒就夠了，也比較好讀。
		update({ firstBeatSec: Math.round(waveXToSec(e) * 100) / 100 });
	}

	function fitToAudio() {
		if (!music || !audio) {
			error = '先載入音樂檔';
			return;
		}
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
	<div class="dialog" role="dialog" aria-label={`${span?.label ?? ''} 設定`}>
		<header>
			<b>{span?.label} 設定</b>
			{#if span}<span class="muted">共 {span.durationSec.toFixed(1)} 秒</span>{/if}
			<button type="button" onclick={onclose}>關閉</button>
		</header>

		{#key fieldsKey}
		{#if music && length}
			<div class="row">
				<label>載入音樂檔 <input type="file" accept=".mp3,.m4a,.wav" onchange={load} /></label>
				<span class="muted">
					{audioName
						? `${audioName}${audio ? `（${audio.durationSec.toFixed(1)} 秒）` : '（找不到音樂，請重新選檔）'}`
						: '還沒載入'}
				</span>
			</div>
			{#if otherAudio.length}
				<div class="row">
					<label>
						用已載入的音樂
						<select onchange={(e) => update({ audioId: e.currentTarget.value })}>
							<option value="" selected>選一個…</option>
							{#each otherAudio as a (a.id)}
								<option value={a.id}>{a.name}</option>
							{/each}
						</select>
					</label>
					<span class="muted">歌中途變速時，兩個音樂段用同一個檔</span>
				</div>
			{/if}
			<div class="row">
				<label>
					BPM
					<input type="number" min={MIN_BPM} max={MAX_BPM} value={music.bpm} onchange={(e) => update({ bpm: num(e) })} />
				</label>
				<span class="muted">{MIN_BPM}–{MAX_BPM}</span>
				<label>
					第一拍（秒）
					<input
						type="number"
						step="0.01"
						min="0"
						value={music.firstBeatSec}
						onchange={(e) => update({ firstBeatSec: num(e) })}
					/>
				</label>
				<button type="button" onclick={() => onpreview(segmentId)}>▶ 從第一拍聽 2 個八拍</button>
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
				<path class="peaks" d={wavePath} />
				{#each lines as line (line.sec)}
					<line class={line.kind} x1={line.sec} x2={line.sec} y1="0" y2="2" />
				{/each}
			</svg>
			<p class="muted hint">
				{audio ? '' : '沒有音樂檔：載入後會畫出波形。'}在波形上點一下＝把第一拍放在那裡。細線是照 BPM
				算的拍子，對準鼓點就對了。只顯示前 {WAVE_WINDOW_SEC} 秒。
			</p>
			<div class="row">
				<label>
					八拍數
					<input type="number" min="1" step="1" value={length.eights} onchange={(e) => update({ eights: num(e) })} />
				</label>
				<label>
					最後一個八拍有幾拍
					<input
						type="number"
						min="1"
						max="8"
						step="1"
						value={length.lastBeats}
						onchange={(e) => update({ lastBeats: num(e) })}
					/>
				</label>
				<button type="button" onclick={fitToAudio}>照音樂長度算</button>
			</div>
		{:else if segment?.kind === 'chant'}
			<div class="row">
				<label>
					長度（秒）
					<input
						type="number"
						step="0.1"
						min="0.1"
						value={segment.tenths / 10}
						onchange={(e) => update({ seconds: num(e) })}
					/>
				</label>
				<span class="muted">口號段只計秒數，最細 0.1 秒</span>
			</div>
		{/if}
		{/key}

		{#if pending}
			<ConfirmList
				message={pending.message}
				items={pending.items}
				onconfirm={confirmUpdate}
				oncancel={cancelUpdate}
			/>
		{/if}

		{#if error}<p class="error" role="alert">{error}</p>{/if}
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(15, 20, 35, 0.45);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 50;
	}
	.dialog {
		background: #fff;
		border-radius: 10px;
		padding: 12px 16px;
		width: min(640px, 94vw);
		display: grid;
		gap: 8px;
	}
	header {
		display: flex;
		gap: 10px;
		align-items: baseline;
	}
	header button {
		margin-left: auto;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		align-items: center;
	}
	.row label {
		display: flex;
		gap: 6px;
		align-items: center;
	}
	input[type='number'] {
		width: 6em;
	}
	.muted {
		color: #7a8296;
		font-size: 12px;
	}
	.hint {
		margin: 0;
	}
	.wave {
		width: 100%;
		height: 90px;
		background: #f6f7fa;
		border: 1px solid #c5cad6;
		border-radius: 6px;
		cursor: crosshair;
	}
	.peaks {
		fill: #7d8bb5;
	}
	line {
		vector-effect: non-scaling-stroke;
		stroke: rgba(29, 35, 48, 0.25);
		stroke-width: 1;
	}
	line.eight {
		stroke: #1d2330;
	}
	line.first {
		stroke: #e8452c;
		stroke-width: 2;
	}
	.error {
		margin: 0;
		color: #c0392b;
	}
</style>
