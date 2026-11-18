<script lang="ts">
	// 輸出影片（流程影片）的對話框：準備（影片多長、放不下的八拍、沒聲音的段）→ 輸出中（進度、取消）→ 做好了（存檔）／失敗（再試一次）。
	// 瀏覽器做不做得出來，打開時當場問編碼器：做不出來就不給「開始」。
	// 按「開始」那一刻的流程存一份，整支用它（流程改了，影片不會一半新一半舊）。
	// 取消、Esc、點背景都走 Modal 的關閉：中止編碼、丟掉做到一半的。
	import { onDestroy } from 'svelte';
	import { VIDEO_FPS, missingAudioNames, segmentSpans, videoDurationSec, videoFrame, type Flow, type GlobalRole } from '#lib/core';
	import { getEditor } from '#lib/editor.svelte.js';
	import { videoFileName } from '#lib/file/save.js';
	import { canvasMeasure, drawFrame } from '#lib/video/draw.js';
	import { layoutFrame, overflowEights, type Measure } from '#lib/video/layout.js';
	import { mixClips, renderSoundtrack } from '#lib/video/soundtrack.js';
	import Modal from './Modal.svelte';

	interface Props {
		flow: Flow;
		/** 量字（ADR 0002）：預設用 OffscreenCanvas 量；jsdom 沒有 Canvas，測試換成假的。 */
		measure?: Measure;
		onclose: () => void;
	}

	let { flow, measure: given, onclose }: Props = $props();

	const editor = getEditor();
	const { encoder, save } = editor.adapters.video;
	// 對話框打開才建量字的 Canvas：編輯器打開時不用
	const measure = $derived(given ?? canvasMeasure());

	type Step =
		| { kind: 'checking' }
		| { kind: 'ready' }
		| { kind: 'unsupported' }
		| { kind: 'encoding'; frames: number }
		| { kind: 'done'; bytes: Uint8Array; fileName: string }
		| { kind: 'failed'; reason: string };
	let step = $state<Step>({ kind: 'checking' });
	/** 輸出中：已經編好幾格。 */
	let done = $state(0);
	let saveError = $state('');
	/** 現在這一次輸出；關掉、再試一次時換掉，舊的那次回來的結果就不算。 */
	let controller: AbortController | null = null;

	void encoder.supported().then((ok) => {
		if (step.kind === 'checking') step = { kind: ok ? 'ready' : 'unsupported' };
	});

	/** 影片長「m:ss」。 */
	const duration = $derived.by(() => {
		const sec = Math.round(videoDurationSec(flow));
		return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
	});
	const overflow = $derived(overflowEights(flow, measure));
	/** 找不到音樂的段：寫音樂檔名；音樂段根本還沒選音樂，沒有檔名，寫段名。 */
	const silent = $derived.by(() => {
		const ids = mixClips(flow, (id) => editor.music.buffer(id) !== undefined).silentSegments;
		const unpicked = segmentSpans(flow)
			.filter(({ segment }) => ids.includes(segment.id) && segment.kind === 'music' && segment.audioId === null)
			.map(({ label }) => `${label}（還沒選音樂）`);
		return [...missingAudioNames(flow, ids).map((n) => `「${n}」`), ...unpicked];
	});

	const reasonOf = (e: unknown) => (e instanceof Error && e.message) || String(e) || '不知道為什麼';

	async function start() {
		const snapshot = flow;
		const m = measure;
		const music = editor.music;
		const getBuffer = (id: string) => music.buffer(id);
		const frames = Math.round(videoDurationSec(snapshot) * VIDEO_FPS);
		// 圓點的顏色看底層、上層：沒給的話全部畫成底層
		const roles: Record<string, GlobalRole> = Object.fromEntries(snapshot.members.map((x) => [x.id, x.globalRole]));
		const run = new AbortController();
		controller?.abort();
		controller = run;
		done = 0;
		step = { kind: 'encoding', frames };
		let ctx: CanvasRenderingContext2D | null = null;
		try {
			const bytes = await encoder.encode({
				frames,
				draw: (i, canvas) => {
					// OffscreenCanvas 的 2D 跟 <canvas> 的畫法一樣，drawFrame 用到的都有
					ctx ??= canvas.getContext('2d') as CanvasRenderingContext2D;
					const frame = videoFrame(snapshot, i / VIDEO_FPS);
					drawFrame(ctx, snapshot.field, frame, layoutFrame(snapshot.field, frame, m), roles);
				},
				// 整支都沒有音樂：沒有聲音軌
				audio: async () =>
					mixClips(snapshot, (id) => getBuffer(id) !== undefined).clips.length ? renderSoundtrack(snapshot, getBuffer) : null,
				onProgress: (n) => {
					if (controller === run) done = n;
				},
				signal: run.signal
			});
			if (controller !== run) return;
			step = { kind: 'done', bytes, fileName: videoFileName(snapshot.name) };
		} catch (e) {
			if (controller !== run || run.signal.aborted) return;
			step = { kind: 'failed', reason: reasonOf(e) };
		}
	}

	/** 存檔要使用者剛按過按鈕才叫得出存檔對話框，所以做好了再按「存檔」才存。存好就關；在存檔對話框按取消就留著。 */
	async function saveFile(bytes: Uint8Array, fileName: string) {
		saveError = '';
		try {
			if ((await save(bytes, fileName)) !== 'cancelled') onclose();
		} catch (e) {
			saveError = `沒存成：${reasonOf(e)}`;
		}
	}

	function close() {
		controller?.abort();
		controller = null;
		onclose();
	}

	onDestroy(() => controller?.abort());
</script>

<Modal label="輸出影片" class="dialog video-dialog" onclose={close}>
	{#snippet children(close)}
		<header class="dialog-head"><h2>輸出影片</h2></header>
		{#if step.kind === 'checking'}
			<p class="hint">看看這個瀏覽器能不能輸出影片⋯</p>
			<div class="buttons"><button type="button" onclick={close}>取消</button></div>
		{:else if step.kind === 'unsupported'}
			<p>這個瀏覽器不能輸出影片，請用電腦的 Chrome 或 Edge</p>
			<div class="buttons"><button type="button" onclick={close}>關閉</button></div>
		{:else if step.kind === 'ready'}
			<p>影片長 {duration}</p>
			{#if overflow.length}<p class="warn">這幾個八拍有東西放不下，會縮成一行或拿掉：{overflow.join('、')}</p>{/if}
			{#if silent.length}<p class="warn">這幾段找不到音樂，影片裡沒有聲音：{silent.join('、')}</p>{/if}
			<div class="buttons">
				<button type="button" onclick={close}>取消</button>
				<button type="button" class="primary" onclick={start}>開始</button>
			</div>
		{:else if step.kind === 'encoding'}
			<progress max={step.frames} value={done}></progress>
			<p>做到第 {done} 格／一共 {step.frames} 格</p>
			<div class="buttons"><button type="button" onclick={close}>取消</button></div>
		{:else if step.kind === 'done'}
			{@const { bytes, fileName } = step}
			<p>做好了，{(bytes.length / 1024 / 1024).toFixed(1)} MB</p>
			{#if saveError}<p class="error">{saveError}</p>{/if}
			<div class="buttons">
				<button type="button" onclick={close}>關閉</button>
				<button type="button" class="primary" onclick={() => saveFile(bytes, fileName)}>存檔</button>
			</div>
		{:else}
			<p class="error">沒做成：{step.reason}</p>
			<div class="buttons">
				<button type="button" onclick={close}>關閉</button>
				<button type="button" class="primary" onclick={start}>再試一次</button>
			</div>
		{/if}
	{/snippet}
</Modal>

<style>
	:global(.video-dialog) {
		width: min(480px, 100%);
		font-size: 14px;
	}
	progress {
		width: 100%;
	}
	.warn {
		color: var(--muted);
		font-size: 13px;
	}
	.buttons {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
</style>
