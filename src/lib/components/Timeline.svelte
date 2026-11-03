<script lang="ts">
	// 時間軸：段列（點段打開段設定、「＋」在最後加一段）、八拍尺（點或拖＝移動播放頭）、
	// 站位縮圖列、一人一條的泳道（Lanes）。段列和八拍尺捲動時固定在上面；可以放大縮小
	// （「−」「＋」以播放頭為準，Ctrl／⌘＋滾輪或觸控板捏合以滑鼠為準）。
	// 播放頭跑出看得到的範圍時（播放中），自動捲過去。
	import { tick, untrack } from 'svelte';
	import { rulerMarks, segmentSpans, totalSeconds, type Flow, type SegmentKind } from '#lib/core';
	import type { PendingConfirm } from './form';
	import FormationRow from './FormationRow.svelte';
	import Icon from './Icon.svelte';
	import Lanes from './Lanes.svelte';
	import { followPointer } from './pointer';

	interface Props {
		flow: Flow;
		/** 播放頭，全域秒數。 */
		playheadSec: number;
		/** 放大 ×1 時，時間軸 1 秒幾 px。 */
		pxPerSec?: number;
		onseek: (sec: number) => void;
		onaddsegment: (kind: SegmentKind) => void;
		onopensegment: (segmentId: string) => void;
		/** 找不到音樂檔的音樂段：標紅，點開段設定重新選檔。 */
		missingSegmentIds?: string[];
		/** 選到的站位。 */
		selectedFormationId?: string | null;
		/** 點縮圖：選這張站位，sec 是它的全域秒數。 */
		onselectformation?: (formationId: string, sec: number) => void;
		ondeleteformation?: (formationId: string) => void;
		selectedActionId?: string | null;
		onselectaction?: (actionId: string) => void;
		/** 拖色條改好的流程。 */
		onchange?: (flow: Flow) => void;
		/** 拖色條被擋（已還原）的原因。 */
		onblocked?: (message: string) => void;
		/** 拉色條會切到拍點，要教練確認。 */
		onconfirm?: (ask: PendingConfirm) => void;
		selectedMemberIds?: string[];
		onselectmembers?: (memberIds: string[]) => void;
	}

	let {
		flow,
		playheadSec,
		pxPerSec = 16,
		onseek,
		onaddsegment,
		onopensegment,
		missingSegmentIds = [],
		selectedFormationId = null,
		onselectformation = () => {},
		ondeleteformation = () => {},
		selectedActionId = null,
		onselectaction = () => {},
		onchange = () => {},
		onblocked = () => {},
		onconfirm = () => {},
		selectedMemberIds = [],
		onselectmembers = () => {}
	}: Props = $props();

	/** 左邊名字欄的寬度（px）；泳道和站位列用同一個 CSS 變數。 */
	const LABEL_W = 148;
	const ZOOMS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];
	/** 滾輪累積這麼多才算一格放大縮小（觸控板捏合一次會送很多小事件）。 */
	const WHEEL_STEP = 40;

	let menuOpen = $state(false);
	let zoomIndex = $state(ZOOMS.indexOf(1));
	let wheelAcc = 0;
	let scroller: HTMLDivElement;
	/** 正在八拍尺上拖：這時不自動捲（一捲尺就跟著跑，滑鼠換算的秒數會亂跳）。 */
	let scrubbing = false;
	const px = $derived(pxPerSec * ZOOMS[zoomIndex]);
	const spans = $derived(segmentSpans(flow));
	const marks = $derived(rulerMarks(flow));
	const width = $derived(totalSeconds(flow) * px);

	/** 放大縮小一格；anchor 是不動的那一點，離時間軸左緣幾 px（含名字欄）。 */
	async function zoomBy(step: number, anchor: number) {
		const next = Math.min(Math.max(zoomIndex + step, 0), ZOOMS.length - 1);
		if (next === zoomIndex) return;
		const sec = (scroller.scrollLeft + anchor - LABEL_W) / px;
		zoomIndex = next;
		await tick();
		scroller.scrollLeft = Math.max(0, LABEL_W + sec * px - anchor);
	}

	/** 按鈕：播放頭在畫面上就讓它不動，不在就以看得到的範圍中間為準。 */
	function zoomButton(step: number) {
		const head = LABEL_W + playheadSec * px - scroller.scrollLeft;
		const inView = head >= LABEL_W && head <= scroller.clientWidth;
		zoomBy(step, inView ? head : (LABEL_W + scroller.clientWidth) / 2);
	}

	function onwheel(e: WheelEvent) {
		if (!e.ctrlKey && !e.metaKey) return;
		e.preventDefault();
		wheelAcc += e.deltaY;
		if (Math.abs(wheelAcc) < WHEEL_STEP) return;
		const step = wheelAcc < 0 ? 1 : -1;
		wheelAcc = 0;
		zoomBy(step, e.clientX - scroller.getBoundingClientRect().left);
	}

	function add(kind: SegmentKind) {
		menuOpen = false;
		onaddsegment(kind);
	}

	function startSeek(e: PointerEvent) {
		if (e.button !== 0) return;
		const ruler = e.currentTarget as HTMLElement;
		const toSec = (ev: PointerEvent) => (ev.clientX - ruler.getBoundingClientRect().left) / px;
		scrubbing = true;
		onseek(toSec(e));
		followPointer(
			(ev) => onseek(toSec(ev)),
			() => (scrubbing = false)
		);
	}

	// 播放頭跑出畫面（播放中、或從別的地方跳過去）就捲過去，放在看得到的範圍的左邊四分之一。
	// 只跟著播放頭；放大縮小自己管捲動，不然用滾輪放大時會被拉回播放頭。
	$effect(() => {
		const x = playheadSec * untrack(() => px);
		if (scrubbing || !scroller || scroller.clientWidth === 0) return;
		const view = scroller.clientWidth - LABEL_W;
		const left = scroller.scrollLeft;
		if (x < left || x > left + view - 24) scroller.scrollLeft = Math.max(0, x - view / 4);
	});
</script>

<div class="timeline" bind:this={scroller} style:--lab-w={`${LABEL_W}px`} {onwheel}>
	<div class="inner" style:width={`${width + LABEL_W + 200}px`}>
		<div class="row segs">
			<div class="lab">
				<span>段</span>
				<button
					type="button"
					class="add"
					aria-label="在最後加一段"
					aria-expanded={menuOpen}
					onclick={() => (menuOpen = !menuOpen)}><Icon name="plus" size={14} /></button
				>
				{#if menuOpen}
					<span class="menu">
						<button type="button" onclick={() => add('music')}>＋音樂段</button>
						<button type="button" onclick={() => add('chant')}>＋口號段</button>
					</span>
				{/if}
			</div>
			<div class="trk" style:width={`${width}px`}>
				{#each spans as span (span.segment.id)}
					{@const missing = missingSegmentIds.includes(span.segment.id)}
					<button
						type="button"
						class="seg {span.segment.kind}"
						class:missing
						style:left={`${span.startSec * px}px`}
						style:width={`${Math.max(span.durationSec * px - 2, 4)}px`}
						title="點一下設定"
						onclick={() => onopensegment(span.segment.id)}
					>
						<b>{span.label}</b>
						{#if missing}<span class="flag">找不到音樂</span>{/if}
						<span class="meta"
							>{span.segment.kind === 'music'
								? `${span.segment.bpm} BPM`
								: `${span.durationSec.toFixed(1)} 秒`}</span
						>
					</button>
				{/each}
				{#if spans.length === 0}
					<span class="empty">按左邊的 ＋ 加第一段：跟著音樂的「音樂段」，或喊口號的「口號段」。</span>
				{/if}
			</div>
		</div>
		<div class="row ruler-row">
			<div class="lab zoom">
				<span>八拍</span>
				<span class="zoom-btns" title="Ctrl／⌘＋滾輪、或觸控板兩指捏合，也可以放大縮小">
					<button
						type="button"
						class="ghost"
						aria-label="時間軸縮小"
						disabled={zoomIndex === 0}
						onclick={() => zoomButton(-1)}><Icon name="minus" size={13} /></button
					>
					<span class="zoom-val">×{ZOOMS[zoomIndex]}</span>
					<button
						type="button"
						class="ghost"
						aria-label="時間軸放大"
						disabled={zoomIndex === ZOOMS.length - 1}
						onclick={() => zoomButton(1)}><Icon name="plus" size={13} /></button
					>
				</span>
			</div>
			<!-- 用滑鼠點或拖移動播放頭；鍵盤操作之後跟播放（空白鍵）一起做。 -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="trk ruler" data-ruler style:width={`${width}px`} onpointerdown={startSeek}>
				{#each marks as mark (mark.sec)}
					<div class="tk" class:big={mark.major} style:left={`${mark.sec * px}px`}>
						{#if mark.label}<span>{mark.label}</span>{/if}
					</div>
				{/each}
				<div class="ph-head" style:left={`${playheadSec * px}px`}></div>
			</div>
		</div>
		<FormationRow
			{flow}
			pxPerSec={px}
			selectedId={selectedFormationId}
			onselect={onselectformation}
			ondelete={ondeleteformation}
		/>
		<Lanes
			{flow}
			{playheadSec}
			pxPerSec={px}
			{selectedActionId}
			{onselectaction}
			{onchange}
			{onblocked}
			{onconfirm}
			{selectedMemberIds}
			{onselectmembers}
		/>
		{#if flow.members.length === 0}
			<div class="row lanes-empty">
				<div class="lab"></div>
				<span>還沒有隊員。到右邊的「隊員」加人，每個人會有一條自己的泳道。</span>
			</div>
		{/if}
		<div class="ph" style:left={`${LABEL_W + playheadSec * px}px`}></div>
	</div>
</div>

<style>
	.timeline {
		overflow: auto;
		background: var(--surface, #fff);
		border-top: 1px solid var(--line, #d8dee9);
		box-shadow: 0 -1px 0 rgba(22, 33, 58, 0.03);
		min-height: 0;
		font-size: 12px;
	}
	.inner {
		position: relative;
		min-height: 100%;
	}
	.row {
		display: flex;
		border-bottom: 1px solid var(--line-soft, #e8ecf3);
	}
	/* 段列和八拍尺捲動時固定在上面；疊在泳道的名字欄（z 6）和播放頭（z 5）上面。 */
	.segs,
	.ruler-row {
		position: sticky;
		z-index: 7;
		background: var(--surface, #fff);
	}
	.segs {
		top: 0;
		height: 32px;
		z-index: 8;
	}
	.ruler-row {
		top: 32px;
		height: 26px;
	}
	.lab {
		position: sticky;
		left: 0;
		z-index: 3;
		width: var(--lab-w);
		flex: none;
		background: var(--surface-2, #f6f8fb);
		border-right: 1px solid var(--line, #d8dee9);
		padding: 0 8px 0 12px;
		display: flex;
		align-items: center;
		gap: 6px;
		white-space: nowrap;
		font-weight: 600;
		color: var(--muted, #66718a);
	}
	.add {
		margin-left: auto;
		width: 24px;
		height: 22px;
		padding: 0;
		color: var(--mat, #2f66b8);
	}
	.menu {
		position: absolute;
		left: 12px;
		top: 30px;
		display: grid;
		gap: 2px;
		min-width: 130px;
		background: var(--surface, #fff);
		border: 1px solid var(--line, #d8dee9);
		border-radius: 10px;
		padding: 4px;
		box-shadow: var(--shadow-pop);
	}
	.menu button {
		justify-content: flex-start;
		border: none;
		padding: 6px 10px;
	}
	.zoom-btns {
		margin-left: auto;
		display: flex;
		align-items: center;
	}
	.zoom-val {
		min-width: 30px;
		text-align: center;
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}
	.zoom-btns button {
		width: 22px;
		height: 22px;
		padding: 0;
		color: var(--muted, #66718a);
	}
	.trk {
		position: relative;
		flex: none;
		height: 100%;
	}
	.seg {
		position: absolute;
		top: 4px;
		bottom: 4px;
		border-radius: 6px;
		padding: 0 8px;
		justify-content: flex-start;
		gap: 8px;
		font-size: 12px;
		line-height: 1;
		color: #fff;
		overflow: hidden;
		white-space: nowrap;
		border: none;
		box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.15);
	}
	.seg .meta {
		opacity: 0.8;
		font-variant-numeric: tabular-nums;
	}
	.seg.music {
		background: var(--mat, #2f66b8);
	}
	.seg.music:hover {
		background: var(--mat-deep, #1d4489);
	}
	.seg.chant {
		background: #a26a22;
	}
	.seg.chant:hover {
		background: #87581a;
	}
	.seg.missing,
	.seg.missing:hover {
		background: var(--danger, #c8372d);
	}
	.flag {
		padding: 1px 5px;
		border-radius: 4px;
		background: #fff;
		color: var(--danger, #c8372d);
		font-weight: 700;
		font-size: 11px;
	}
	.empty,
	.lanes-empty span {
		position: absolute;
		left: 12px;
		top: 50%;
		transform: translateY(-50%);
		white-space: nowrap;
		color: var(--muted, #66718a);
	}
	.lanes-empty {
		position: relative;
		height: 44px;
		border-bottom: none;
	}
	.lanes-empty span {
		left: calc(var(--lab-w) + 12px);
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
		background: #c3cad7;
	}
	.tk.big {
		height: 14px;
		background: #4a5675;
	}
	.tk span {
		position: absolute;
		left: 4px;
		top: -7px;
		font-size: 11px;
		font-weight: 700;
		color: var(--text, #1a2238);
		font-variant-numeric: tabular-nums;
	}
	/* 播放頭：八拍尺上的三角形，和往下貫穿整個時間軸的線。 */
	.ph-head {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		margin-left: -1px;
		background: var(--now, #f2542d);
		pointer-events: none;
	}
	.ph-head::before {
		content: '';
		position: absolute;
		top: 0;
		left: -5px;
		border: 6px solid transparent;
		border-top: 8px solid var(--now, #f2542d);
		border-bottom: none;
	}
	.ph {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		margin-left: -1px;
		background: var(--now, #f2542d);
		z-index: 5;
		pointer-events: none;
	}
</style>
