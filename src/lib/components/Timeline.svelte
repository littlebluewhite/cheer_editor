<script lang="ts">
	// 時間軸：段列（點段打開段設定、「＋」在最後加一段）、八拍尺（點或拖＝移動播放頭）、
	// 站位縮圖列。泳道由之後的票加在下面。
	import { rulerMarks, segmentSpans, totalSeconds, type Flow, type SegmentKind } from '#lib/core';
	import FormationRow from './FormationRow.svelte';

	interface Props {
		flow: Flow;
		/** 播放頭，全域秒數。 */
		playheadSec: number;
		/** 時間軸 1 秒幾 px。 */
		pxPerSec?: number;
		onseek: (sec: number) => void;
		onaddsegment: (kind: SegmentKind) => void;
		onopensegment: (segmentId: string) => void;
		/** 選到的站位。 */
		selectedFormationId?: string | null;
		/** 點縮圖：選這張站位，sec 是它的全域秒數。 */
		onselectformation?: (formationId: string, sec: number) => void;
		ondeleteformation?: (formationId: string) => void;
	}

	let {
		flow,
		playheadSec,
		pxPerSec = 16,
		onseek,
		onaddsegment,
		onopensegment,
		selectedFormationId = null,
		onselectformation = () => {},
		ondeleteformation = () => {}
	}: Props = $props();

	let menuOpen = $state(false);
	const spans = $derived(segmentSpans(flow));
	const marks = $derived(rulerMarks(flow));
	const width = $derived(totalSeconds(flow) * pxPerSec);

	function add(kind: SegmentKind) {
		menuOpen = false;
		onaddsegment(kind);
	}

	function startSeek(e: PointerEvent) {
		if (e.button !== 0) return;
		const ruler = e.currentTarget as HTMLElement;
		const toSec = (ev: PointerEvent) =>
			(ev.clientX - ruler.getBoundingClientRect().left) / pxPerSec;
		onseek(toSec(e));
		const move = (ev: PointerEvent) => onseek(toSec(ev));
		const up = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}
</script>

<div class="timeline">
	<div class="inner" style:width={`${width + 200}px`}>
		<div class="row segs">
			<div class="lab">
				段
				<button type="button" aria-label="在最後加一段" onclick={() => (menuOpen = !menuOpen)}>＋</button>
				{#if menuOpen}
					<span class="menu">
						<button type="button" onclick={() => add('music')}>＋音樂段</button>
						<button type="button" onclick={() => add('chant')}>＋口號段</button>
					</span>
				{/if}
			</div>
			<div class="trk" style:width={`${width}px`}>
				{#each spans as span (span.segment.id)}
					<button
						type="button"
						class="seg {span.segment.kind}"
						style:left={`${span.startSec * pxPerSec}px`}
						style:width={`${Math.max(span.durationSec * pxPerSec - 2, 4)}px`}
						title="點一下設定"
						onclick={() => onopensegment(span.segment.id)}
					>
						{span.label} ·
						{span.segment.kind === 'music'
							? `${span.segment.bpm} BPM`
							: `${span.durationSec.toFixed(1)} 秒`}
					</button>
				{/each}
			</div>
		</div>
		<div class="row ruler-row">
			<div class="lab">八拍</div>
			<!-- 用滑鼠點或拖移動播放頭；鍵盤操作之後跟播放（空白鍵）一起做。 -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="trk ruler" data-ruler style:width={`${width}px`} onpointerdown={startSeek}>
				{#each marks as mark (mark.sec)}
					<div class="tk" class:big={mark.major} style:left={`${mark.sec * pxPerSec}px`}>
						{#if mark.label}<span>{mark.label}</span>{/if}
					</div>
				{/each}
			</div>
		</div>
		<FormationRow
			{flow}
			{pxPerSec}
			selectedId={selectedFormationId}
			onselect={onselectformation}
			ondelete={ondeleteformation}
		/>
		<div class="ph" style:left={`${120 + playheadSec * pxPerSec}px`}></div>
	</div>
</div>

<style>
	.timeline {
		overflow: auto;
		background: #fff;
		border-top: 2px solid #c5cad6;
		min-height: 0;
		font-size: 11px;
	}
	.inner {
		position: relative;
	}
	.row {
		display: flex;
		border-bottom: 1px solid #f0f1f5;
	}
	.segs {
		height: 24px;
	}
	.ruler-row {
		height: 20px;
	}
	.lab {
		position: sticky;
		left: 0;
		z-index: 3;
		width: 120px;
		flex: none;
		background: #fafbfd;
		border-right: 1px solid #dde1ea;
		padding: 0 4px;
		display: flex;
		align-items: center;
		gap: 4px;
		white-space: nowrap;
	}
	.lab button {
		padding: 0 5px;
		font-size: 11px;
		line-height: 14px;
	}
	.menu {
		position: absolute;
		left: 40px;
		top: 22px;
		display: flex;
		gap: 4px;
		background: #fff;
		border: 1px solid #c5cad6;
		border-radius: 6px;
		padding: 4px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
	}
	.trk {
		position: relative;
		flex: none;
		height: 100%;
	}
	.seg {
		position: absolute;
		top: 2px;
		bottom: 2px;
		border-radius: 4px;
		padding: 0 6px;
		font-size: 11px;
		color: #fff;
		overflow: hidden;
		white-space: nowrap;
		text-align: left;
		cursor: pointer;
		border: 1px solid rgba(0, 0, 0, 0.15);
	}
	.seg.music {
		background: #5167a8;
	}
	.seg.chant {
		background: #9a6b2f;
	}
	.ruler {
		cursor: ew-resize;
		touch-action: none;
		user-select: none;
	}
	.tk {
		position: absolute;
		bottom: 0;
		width: 1px;
		height: 5px;
		background: #b9bfcc;
	}
	.tk.big {
		height: 12px;
		background: #59627a;
	}
	.tk span {
		position: absolute;
		left: 2px;
		top: -4px;
		font-size: 10px;
		color: #3b4358;
	}
	.ph {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		background: #e8452c;
		z-index: 5;
		pointer-events: none;
	}
</style>
