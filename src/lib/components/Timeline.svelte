<script lang="ts">
	// 時間軸：段列（點段打開段設定；左邊「＋」在最後加一段，段旁的「＋」加在這段後面）、
	// 八拍尺（點或拖＝移動播放頭，先停站位再停整拍；點八拍數字停在那個八拍的 1）、
	// 站位縮圖列、一人一條的泳道（Lanes）。段列和八拍尺捲動時固定在上面；可以放大縮小
	// （「−」「＋」以播放頭為準，Ctrl／⌘＋滾輪、觸控板或 iPad 兩指捏合以滑鼠、兩指中間為準），
	// 「符合寬度」讓整支流程剛好放滿現在的寬度。
	// 播放頭跑出看得到的範圍時（播放中），自動捲過去。
	// 流程從 session 拿；站位縮圖列、泳道也自己從 session 拿選取、送改動，時間軸不轉手。
	import { composing } from '#lib/ime.js';
	import { tick, untrack } from 'svelte';
	import { addSegment, rulerMarks, segmentSpans, snapPlayhead, totalSeconds, type SegmentKind } from '#lib/core';
	import { getEditorSession } from '#lib/editor-session.svelte.js';
	import FormationRow from './FormationRow.svelte';
	import Icon from './Icon.svelte';
	import Lanes from './Lanes.svelte';
	import { followPointer } from './pointer';

	interface Props {
		/** 播放頭，全域秒數。 */
		playheadSec: number;
		/** 放大 ×1 時，時間軸 1 秒幾 px。 */
		pxPerSec?: number;
		/** 點或拖八拍尺、點站位縮圖：播放頭移到這裡。 */
		onseek: (sec: number) => void;
		/** 點段、加好一段：打開這一段的段設定。 */
		onopensegment: (segmentId: string) => void;
		/** 找不到音樂檔的音樂段：標紅，點開段設定重新選檔。 */
		missingSegmentIds?: string[];
	}

	let { playheadSec, pxPerSec = 16, onseek, onopensegment, missingSegmentIds = [] }: Props = $props();

	const session = getEditorSession();
	// 頁面只在有流程時畫時間軸。
	const flow = $derived(session.flow!);

	/** 左邊名字欄的寬度（px）；泳道和站位列用同一個 CSS 變數。 */
	const LABEL_W = 148;
	const ZOOMS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];
	/** 很短的段（0.1 秒的口號段、縮到很小時）在段列上最少這麼寬，才點得到。 */
	const SEG_MIN_W = 16;
	/** 滾輪累積這麼多才算一格放大縮小（觸控板捏合一次會送很多小事件）。 */
	const WHEEL_STEP = 40;

	/** 尺上點到站位這麼近（px）就停到站位。 */
	const NEAR_FORMATION_PX = 8;
	/** 時間軸最後面多留的空白（px）；「符合寬度」時只留一點點，不出現橫向捲軸。 */
	const TAIL_PX = 200;
	const FIT_TAIL_PX = 16;

	/** 加段選單開著：after 是要加在哪一段後面（null：加在最後）；anchor 是打開它的「＋」。 */
	let menu = $state<{ after: string | null; anchor: HTMLElement } | null>(null);
	let menuEl = $state<HTMLElement>();
	let menuPos = $state({ top: 0, left: 0 });
	/** 倍數：通常是 ZOOMS 其中一個；「符合寬度」時是剛好放滿的倍數。 */
	let zoom = $state(1);
	let fitted = $state(false);
	let wheelAcc = 0;
	let scroller: HTMLDivElement;
	/** 正在八拍尺上拖：這時不自動捲（一捲尺就跟著跑，滑鼠換算的秒數會亂跳）。 */
	let scrubbing = false;
	const px = $derived(pxPerSec * zoom);
	const spans = $derived(segmentSpans(flow));
	const marks = $derived(rulerMarks(flow));
	const width = $derived(totalSeconds(flow) * px);

	/** 放大縮小一格；anchor 是不動的那一點，離時間軸左緣幾 px（含名字欄）。 */
	async function zoomBy(step: number, anchor: number) {
		const next = step > 0 ? ZOOMS.find((z) => z > zoom + 1e-9) : ZOOMS.findLast((z) => z < zoom - 1e-9);
		if (next === undefined) return;
		const sec = (scroller.scrollLeft + anchor - LABEL_W) / px;
		zoom = next;
		fitted = false;
		await tick();
		scroller.scrollLeft = Math.max(0, LABEL_W + sec * px - anchor);
	}

	/** 符合寬度：整支流程剛好放滿看得到的寬度（很短、很長的流程可以超出「＋」「−」的最大、最小倍數）。 */
	function fitWidth() {
		const total = totalSeconds(flow);
		const fit = (scroller.clientWidth - LABEL_W - FIT_TAIL_PX) / (total * pxPerSec);
		if (!(fit > 0)) return;
		zoom = fit;
		fitted = true;
		scroller.scrollLeft = 0;
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

	/** 捏合一次放大到這麼多倍（或縮到幾分之一）才算一格。 */
	const PINCH_STEP = 1.3;

	/**
	 * iPad 兩指捏合：Safari 送 gesturechange（scale 是跟開始時比），只放大縮小時間軸，不放大整頁。
	 * 以兩指中間為準，跟 Ctrl＋滾輪一樣。
	 */
	function pinchZoom(el: HTMLElement) {
		type Gesture = Event & { scale: number; clientX: number };
		let last = 1;
		const start = (e: Event) => {
			e.preventDefault();
			last = 1;
		};
		const change = (e: Event) => {
			e.preventDefault();
			const { scale, clientX } = e as Gesture;
			const ratio = scale / last;
			if (ratio < PINCH_STEP && ratio > 1 / PINCH_STEP) return;
			last = scale;
			zoomBy(ratio > 1 ? 1 : -1, clientX - el.getBoundingClientRect().left);
		};
		el.addEventListener('gesturestart', start);
		el.addEventListener('gesturechange', change);
		return () => {
			el.removeEventListener('gesturestart', start);
			el.removeEventListener('gesturechange', change);
		};
	}

	/** 打開、收起加段選單（再點同一個「＋」就收起來）。 */
	function toggleMenu(e: MouseEvent, after: string | null) {
		const anchor = e.currentTarget as HTMLElement;
		menu = menu?.anchor === anchor ? null : { after, anchor };
	}

	/** 加一段（加在選單的那一段後面，或加在最後），加好就打開它的段設定。 */
	function add(kind: SegmentKind) {
		const after = menu?.after ?? undefined;
		menu = null;
		session.ask.send(() => addSegment(flow, kind, after), { done: (r) => onopensegment(r.id) });
	}

	/** 選單放在「＋」下面，不超出畫面左右。 */
	function placeMenu() {
		if (!menu || !menuEl) return;
		const b = menu.anchor.getBoundingClientRect();
		const M = 8;
		menuPos = {
			top: b.bottom + 4,
			left: Math.max(M, Math.min(b.left, innerWidth - M - menuEl.offsetWidth))
		};
	}

	$effect(() => {
		if (!menu || !menuEl) return;
		const el = menuEl;
		// 選單開在最上層（popover）：時間軸捲動容器裁不到它。jsdom 沒有 popover，所以在這裡才加屬性。
		if (el.showPopover && !el.matches(':popover-open')) {
			el.popover = 'manual';
			el.showPopover();
		}
		placeMenu();
		addEventListener('scroll', placeMenu, true);
		addEventListener('resize', placeMenu);
		return () => {
			removeEventListener('scroll', placeMenu, true);
			removeEventListener('resize', placeMenu);
			if (el.popover) el.hidePopover();
		};
	});

	/** 加段選單：點外面就收起來。 */
	function menuOutside(e: PointerEvent) {
		const t = e.target as Node;
		if (menu && !menuEl?.contains(t) && !menu.anchor.contains(t)) menu = null;
	}

	/** 加段選單：Esc 只收選單（不讓編輯頁把動作也取消選）。中文輸入法選字時的 Esc 不算。 */
	function menuKeys(e: KeyboardEvent) {
		if (!menu || e.key !== 'Escape' || composing(e)) return;
		e.stopPropagation();
		menu = null;
	}

	function startSeek(e: PointerEvent) {
		if (e.button !== 0) return;
		const ruler = e.currentTarget as HTMLElement;
		// 先停站位（差不到幾 px），再吸到整拍（口號段 0.1 秒）：點八拍尺要停在「4-1」，不要一不小心停在「4-1&」。
		// 按著 Option／Alt 吸到半拍。
		const toSec = (ev: PointerEvent) =>
			snapPlayhead(
				flow,
				(ev.clientX - ruler.getBoundingClientRect().left) / px,
				NEAR_FORMATION_PX / px,
				ev.altKey
			);
		scrubbing = true;
		// 點在八拍數字上：停在那個八拍的第 1 拍（數字寫在刻度右邊，照位置算會停到後面一兩拍）
		const label = (e.target as HTMLElement).closest<HTMLElement>('[data-mark-sec]');
		onseek(label ? Number(label.dataset.markSec) : toSec(e));
		followPointer(
			e,
			(ev) => onseek(toSec(ev)),
			() => (scrubbing = false),
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

<svelte:window onpointerdown={menuOutside} onkeydowncapture={menuKeys} />

<div class="timeline" bind:this={scroller} style:--lab-w={`${LABEL_W}px`} {onwheel} {@attach pinchZoom}>
	<div class="inner" style:width={`${width + LABEL_W + (fitted ? FIT_TAIL_PX : TAIL_PX)}px`}>
		<div class="row segs">
			<div class="lab">
				<span>段</span>
				<button
					type="button"
					class="add"
					aria-label="在最後加一段"
					aria-expanded={!!menu && menu.after === null}
					onclick={(e) => toggleMenu(e, null)}><Icon name="plus" size={14} /></button
				>
			</div>
			<div class="trk" style:width={`${width}px`}>
				{#each spans as span (span.segment.id)}
					{@const missing = missingSegmentIds.includes(span.segment.id)}
					{@const meta =
						span.segment.kind === 'music' ? `${span.segment.bpm} BPM` : `${span.durationSec.toFixed(1)} 秒`}
					<button
						type="button"
						class="seg {span.segment.kind}"
						class:missing
						class:short={span.durationSec * px - 2 < SEG_MIN_W}
						style:left={`${span.startSec * px}px`}
						style:width={`${Math.max(span.durationSec * px - 2, SEG_MIN_W)}px`}
						title="{span.label}　{meta}{missing ? '　找不到音樂' : ''}：點一下設定"
						onclick={() => onopensegment(span.segment.id)}
					>
						<b>{span.label}</b>
						{#if missing}<span class="flag">找不到音樂</span>{/if}
						<span class="meta">{meta}</span>
					</button>
					<button
						type="button"
						class="add-after"
						style:left={`${(span.startSec + span.durationSec) * px - 13}px`}
						aria-label="在這段後面加一段"
						title={`加在${span.label} 後面`}
						aria-expanded={menu?.after === span.segment.id}
						onclick={(e) => toggleMenu(e, span.segment.id)}><Icon name="plus" size={12} /></button
					>
				{/each}
				{#if spans.length === 0}
					<span class="empty">按左邊的 ＋ 加第一段：跟著音樂的「音樂段」，或喊口號的「口號段」。</span>
				{/if}
			</div>
		</div>
		<div class="row ruler-row">
			<div class="lab zoom">
				<span>八拍</span>
				<span class="zoom-btns" title="Ctrl／⌘＋滾輪、觸控板或 iPad 兩指捏合，也可以放大縮小">
					<button
						type="button"
						class="ghost"
						aria-label="時間軸縮小"
						disabled={zoom <= ZOOMS[0] + 1e-9}
						onclick={() => zoomButton(-1)}><Icon name="minus" size={13} /></button
					>
					<span class="zoom-val">×{Number(zoom.toFixed(2))}</span>
					<button
						type="button"
						class="ghost"
						aria-label="時間軸放大"
						disabled={zoom >= ZOOMS.at(-1)! - 1e-9}
						onclick={() => zoomButton(1)}><Icon name="plus" size={13} /></button
					>
					<button
						type="button"
						class="ghost fit"
						aria-label="符合寬度"
						title="整支流程剛好放滿現在的寬度"
						disabled={spans.length === 0}
						onclick={fitWidth}><Icon name="fitWidth" size={13} /></button
					>
				</span>
			</div>
			<!-- 用滑鼠點或拖移動播放頭；鍵盤操作之後跟播放（空白鍵）一起做。 -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="trk ruler" data-ruler style:width={`${width}px`} onpointerdown={startSeek}>
				{#each marks as mark (mark.sec)}
					<div class="tk" class:big={mark.major} style:left={`${mark.sec * px}px`}>
						{#if mark.label}<span data-mark-sec={mark.sec}>{mark.label}</span>{/if}
					</div>
				{/each}
				<div class="ph-head" style:left={`${playheadSec * px}px`}></div>
			</div>
		</div>
		<FormationRow pxPerSec={px} {onseek} />
		<Lanes {playheadSec} pxPerSec={px} />
		{#if flow.members.length === 0}
			<div class="row lanes-empty">
				<div class="lab"></div>
				<span>還沒有隊員。到右邊的「隊員」加人，每個人會有一條自己的泳道。</span>
			</div>
		{/if}
		<div class="ph" style:left={`${LABEL_W + playheadSec * px}px`}></div>
	</div>
</div>

{#if menu}
	{@const after = spans.find((s) => s.segment.id === menu?.after)}
	<div class="menu" bind:this={menuEl} style:top={`${menuPos.top}px`} style:left={`${menuPos.left}px`}>
		<span class="menu-title">{after ? `加在${after.label} 後面` : '加在最後'}</span>
		<button type="button" onclick={() => add('music')}>＋音樂段</button>
		<button type="button" onclick={() => add('chant')}>＋口號段</button>
	</div>
{/if}

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
		/* 開在最上層（popover）：蓋掉瀏覽器給 popover 的置中、框線、顏色 */
		position: fixed;
		inset: auto;
		margin: 0;
		color: inherit;
		z-index: 30;
		display: grid;
		gap: 2px;
		min-width: 130px;
		background: var(--surface, #fff);
		border: 1px solid var(--line, #d8dee9);
		border-radius: 10px;
		padding: 4px;
		box-shadow: var(--shadow-pop);
	}
	.menu-title {
		padding: 4px 10px 2px;
		font-size: 11px;
		font-weight: 600;
		color: var(--muted, #66718a);
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
	/* 段旁的「＋」：段右端的小圓鈕，加在這段後面（段的字留出位置，不被它蓋住）。 */
	.add-after {
		position: absolute;
		top: 50%;
		z-index: 1;
		width: 18px;
		height: 18px;
		margin: -9px 0 0 -9px;
		padding: 0;
		border-radius: 50%;
		border: 1px solid var(--line, #d8dee9);
		background: var(--surface, #fff);
		color: var(--mat, #2f66b8);
		box-shadow: 0 1px 2px rgba(22, 33, 58, 0.15);
	}
	/* 手指：段列和八拍尺高一點，「＋」和放大縮小點得到的範圍（32px）放得進去，看起來不變。 */
	@media (pointer: coarse) {
		.segs {
			height: 44px;
		}
		.ruler-row {
			top: 44px;
			height: 34px;
		}
		.add,
		.zoom-btns button {
			position: relative;
		}
		.add-after::after {
			content: '';
			position: absolute;
			inset: -7px;
		}
		.add::after,
		.zoom-btns button::after {
			content: '';
			position: absolute;
			inset: -6px;
		}
		/* 段列最上面幾 px 是場地和時間軸分界的把手：「＋」點得到的範圍往下多一點，不超出段列 */
		.add::after {
			bottom: -10px;
		}
		.add-after::after {
			inset: -8px -8px -12px;
		}
		/* 「符合寬度」緊貼著「＋」：它點得到的範圍不往左蓋到「＋」，往右多一點；倍數、間隔窄一點讓出縫 */
		.lab.zoom {
			gap: 4px;
		}
		.zoom-val {
			min-width: 22px;
		}
		.zoom-btns .fit {
			margin-left: 8px;
		}
		.zoom-btns .fit::after {
			left: -2px;
			right: -10px;
		}
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
		padding: 0 24px 0 8px;
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
	/* 很短的段撐到最小寬度，會疊到下一段的開頭：疊在上面，才點得到。 */
	.seg.short {
		z-index: 1;
	}
	/* 字放不下用「…」（完整的字在 title）：先縮 BPM／秒數，再縮段名。 */
	.seg > * {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.seg > b {
		flex: none;
		max-width: 100%;
	}
	.seg .meta {
		flex: 0 100 auto;
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
