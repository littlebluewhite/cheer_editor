<script lang="ts">
	// 時間軸：段列（點段打開段設定；左邊「＋」在最後加一段，段旁的「＋」加在這段後面）、
	// 八拍尺（點或拖＝移動播放頭，先停站位再停整拍；點八拍數字停在那個八拍的 1；播放頭的線也能拖）、
	// 站位縮圖列、一人一條的泳道（Lanes）。段列和八拍尺捲動時固定在上面；可以放大縮小
	// （「−」「＋」以播放頭為準，Ctrl／⌘＋滾輪、觸控板或 iPad 兩指捏合以滑鼠、兩指中間為準），
	// 「符合寬度」讓整支流程剛好放滿現在的寬度（連最後一張站位的縮圖），換視窗大小也維持放滿，直到自己按「＋」「−」。
	// 流程比畫面短時，開檔、加段後自動放滿（比畫面長時維持 ×1，不自動縮小）。
	// 播放頭跑出看得到的範圍時（播放中），自動捲過去。
	// 「段」那一格的「插入八拍」：在播放頭空出幾個八拍（或幾拍，口號段幾秒），這段後面的東西一起往後延。
	// 流程從 session 拿；站位縮圖列、泳道也自己從 session 拿選取、送改動，時間軸不轉手。
	import { tick, untrack } from 'svelte';
	import {
		HALF_BEATS_PER_BEAT,
		HALF_BEATS_PER_EIGHT,
		addSegment,
		atTextWithUnit,
		formationTimes,
		insertBeats,
		lengthTextWithUnit,
		readLength,
		rulerMarks,
		segmentSpans,
		snapPlayhead,
		spacedLabels,
		toPosition,
		totalSeconds,
		type Clash,
		type SegmentKind
	} from '#lib/core';
	import { getEditor } from '#lib/editor.svelte.js';
	import { getEditorSession } from '#lib/editor-session.svelte.js';
	import { below, popover } from '#lib/popover.svelte.js';
	import FormationRow, { THUMB_W } from './FormationRow.svelte';
	import Icon from './Icon.svelte';
	import Lanes from './Lanes.svelte';
	import { followPointer } from './pointer';

	interface Props {
		/** 放大 ×1 時，時間軸 1 秒幾 px。 */
		pxPerSec?: number;
		/** 點段、加好一段：打開這一段的段設定。 */
		onopensegment: (segmentId: string) => void;
		/** 整個流程的撞位，交給泳道畫。 */
		clashes?: Clash[];
	}

	let { pxPerSec = 16, onopensegment, clashes = [] }: Props = $props();

	const session = getEditorSession();
	/** 找不到音樂檔的音樂段從音樂檔庫拿（editor.music，換流程會換一個）：標紅，點開段設定重新選檔。 */
	const editor = getEditor();
	/** 播放頭（全域秒數）從編輯器 module 的播放拿；點或拖八拍尺叫它跳過去。 */
	const { playback } = editor;
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
	/** 自己按「＋」「−」選的倍數（ZOOMS 其中一個）。 */
	let picked = $state(1);
	/**
	 * 放滿：auto = 開檔、加段後自動（流程比畫面長時用 ×1），fit = 按了「符合寬度」（再長也縮到放滿），
	 * null = 用自己選的倍數。
	 */
	let fill = $state<'auto' | 'fit' | null>('auto');
	/** 時間軸看得到的寬（px）：畫出來時量，換視窗大小、拖分界時重量。 */
	let viewW = $state(0);
	let wheelAcc = 0;
	let scroller: HTMLDivElement;
	let ruler: HTMLDivElement;
	/** 最後一張站位的時間（秒）：它的縮圖往右多佔 THUMB_W。 */
	const lastFormationSec = $derived(Math.max(0, ...formationTimes(flow).map((t) => t.sec)));
	/** 剛好放滿看得到的寬的倍數；量不到寬、沒有段時是 0。 */
	const fitZoom = $derived.by(() => {
		const total = totalSeconds(flow);
		const room = viewW - LABEL_W;
		if (!(total > 0) || room <= 0) return 0;
		const byEnd = (room - FIT_TAIL_PX) / (total * pxPerSec);
		const byThumb = lastFormationSec > 0 ? (room - THUMB_W) / (lastFormationSec * pxPerSec) : Infinity;
		return Math.max(0, Math.min(byEnd, byThumb));
	});
	/** 倍數：通常是自己選的；放滿時是剛好放滿的倍數。 */
	const zoom = $derived(
		fill && fitZoom > 0 ? (fill === 'fit' ? fitZoom : Math.max(1, fitZoom)) : picked
	);
	/** 現在剛好放滿（流程比畫面長、自動時用 ×1 的不算）：後面只留一點點空白。 */
	const fitted = $derived(!!fill && fitZoom > 0 && (fill === 'fit' || fitZoom >= 1));
	/** 正在八拍尺上拖：這時不自動捲（一捲尺就跟著跑，滑鼠換算的秒數會亂跳）。 */
	let scrubbing = false;
	const px = $derived(pxPerSec * zoom);
	const spans = $derived(segmentSpans(flow));
	const allMarks = $derived(rulerMarks(flow));
	/** 刻度字太密時跳著寫，段交界不疊在一起（spacedLabels）。 */
	const marks = $derived(spacedLabels(allMarks, px));
	/** 時間軸捲到哪裡（px）：段名跟著移到看得到的左邊。 */
	let scrollX = $state(0);
	/** 段名往右移時，段的右邊至少留這麼寬給段名（px）。 */
	const NAME_ROOM = 100;
	/** 段名要往右移多少（px），才在看得到的地方：最多移到段尾前 NAME_ROOM。 */
	const nameShift = (left: number, w: number) => Math.min(Math.max(0, scrollX - left), Math.max(0, w - NAME_ROOM));
	const width = $derived(totalSeconds(flow) * px);

	/** 放大縮小一格；anchor 是不動的那一點，離時間軸左緣幾 px（含名字欄）。 */
	async function zoomBy(step: number, anchor: number) {
		const next = step > 0 ? ZOOMS.find((z) => z > zoom + 1e-9) : ZOOMS.findLast((z) => z < zoom - 1e-9);
		if (next === undefined) return;
		const sec = (scroller.scrollLeft + anchor - LABEL_W) / px;
		picked = next;
		fill = null;
		await tick();
		scroller.scrollLeft = Math.max(0, LABEL_W + sec * px - anchor);
	}

	/** 符合寬度：整支流程剛好放滿看得到的寬度（很短、很長的流程可以超出「＋」「−」的最大、最小倍數）。 */
	function fitWidth() {
		viewW = scroller.clientWidth;
		fill = 'fit';
		scroller.scrollLeft = 0;
	}

	/** 量看得到的寬：畫出來時量一次，之後跟著 ResizeObserver（jsdom 沒有，測試裡自己給）。 */
	function measure(el: HTMLElement) {
		viewW = el.clientWidth;
		if (typeof ResizeObserver === 'undefined') return;
		const ro = new ResizeObserver(() => (viewW = el.clientWidth));
		ro.observe(el);
		return () => ro.disconnect();
	}

	// 換流程（換一個音樂檔庫）：回到自動放滿。
	$effect(() => {
		void editor.music;
		untrack(() => (fill = 'auto'));
	});

	/** 按鈕：播放頭在畫面上就讓它不動，不在就以看得到的範圍中間為準。 */
	function zoomButton(step: number) {
		const head = LABEL_W + playback.sec * px - scroller.scrollLeft;
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

	/** 收起加段選單；按 Esc 收的話焦點回到「＋」（不然掉回頁面最上面）。 */
	function closeMenu(by: 'outside' | 'escape') {
		const anchor = menu?.anchor;
		menu = null;
		if (by === 'escape') anchor?.focus();
	}

	/** 加段選單打開時焦點進第一項；上下鍵在幾項之間輪流換。 */
	function menuKeys(el: HTMLElement) {
		const items = () => [...el.querySelectorAll<HTMLElement>('[role="menuitem"]')];
		items()[0]?.focus();
		const keys = (e: KeyboardEvent) => {
			if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
			e.preventDefault();
			const all = items();
			const i = all.indexOf(document.activeElement as HTMLElement);
			all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length].focus();
		};
		el.addEventListener('keydown', keys);
		return () => el.removeEventListener('keydown', keys);
	}

	/** 加一段（加在選單的那一段後面，或加在最後），加好就打開它的段設定。 */
	function add(kind: SegmentKind) {
		const after = menu?.after ?? undefined;
		// 選單項目要不見了：焦點先回「＋」，段設定關掉時焦點才回得來（不掉回頁面最上面）。
		menu?.anchor.focus();
		menu = null;
		session.ask.send(() => addSegment(flow, kind, after), {
			done: (r) => {
				if (fill !== 'fit') fill = 'auto';
				onopensegment(r.id);
			}
		});
	}

	/** 插入八拍的小窗開著：anchor 是打開它的鈕。 */
	let inserting = $state<{ anchor: HTMLElement } | null>(null);
	let insertCount = $state('1');
	let insertUnit = $state<'eight' | 'beat'>('eight');
	/** 插入八拍被擋的原因畫在小窗裡。 */
	const insertAsk = session.changeAsk({ label: '插入八拍' });
	/** 播放頭在哪一段的哪一格（插在這裡）。 */
	const insertAt = $derived(toPosition(flow, playback.sec));
	const insertSpan = $derived(spans.find((s) => s.segment.id === insertAt?.segmentId));

	function toggleInsert(e: MouseEvent) {
		const anchor = e.currentTarget as HTMLElement;
		insertAsk.clear();
		inserting = inserting ? null : { anchor };
	}

	/** 插入：數字乘上單位換成段內的格數（音樂段半拍、口號段 0.1 秒），交給核心。 */
	function insert() {
		const at = insertAt;
		const span = insertSpan;
		if (!at || !span) return;
		const music = span.segment.kind === 'music';
		// 讀成幾拍（口號段幾秒）再換成格數；八拍是 8 拍
		const read = readLength(span.segment, insertCount);
		const scale = music && insertUnit === 'eight' ? HALF_BEATS_PER_EIGHT / HALF_BEATS_PER_BEAT : 1;
		const length = read.kind === 'ok' ? read.value * scale : 0;
		const amount = music && insertUnit === 'eight' ? `${length / HALF_BEATS_PER_EIGHT} 個八拍` : lengthTextWithUnit(span.segment, length);
		const before = session.flow;
		insertAsk.send(() => (read.kind === 'ok' ? insertBeats(flow, at, length) : read), {
			done: () => {
				inserting = null;
				const where = `${span.label} ${atTextWithUnit(span.segment, at.at)}`;
				// 後面沒有東西要往後延：流程沒變（不算一步），不說插入了
				session.notice =
					session.flow === before
						? `${where} 後面沒有站位或動作，沒有東西要往後延`
						: `在${where} 插入了 ${amount}，後面的站位和動作往後延`;
			}
		});
	}

	/** 在八拍尺上、或在播放頭那條線上按下去：點或拖移動播放頭。 */
	function startSeek(e: PointerEvent) {
		if (e.button !== 0) return;
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
		playback.seek(label ? Number(label.dataset.markSec) : toSec(e));
		followPointer(
			e,
			(ev) => playback.seek(toSec(ev)),
			() => (scrubbing = false),
			() => (scrubbing = false)
		);
	}

	// 播放頭跑出畫面（播放中、或從別的地方跳過去）就捲過去，放在看得到的範圍的左邊四分之一。
	// 只跟著播放頭；放大縮小自己管捲動，不然用滾輪放大時會被拉回播放頭。
	$effect(() => {
		const x = playback.sec * untrack(() => px);
		if (scrubbing || !scroller || scroller.clientWidth === 0) return;
		const view = scroller.clientWidth - LABEL_W;
		const left = scroller.scrollLeft;
		if (x < left || x > left + view - 24) scroller.scrollLeft = Math.max(0, x - view / 4);
	});
</script>

<div class="timeline" bind:this={scroller} style:--lab-w={`${LABEL_W}px`} {onwheel} {@attach pinchZoom} {@attach measure} onscroll={() => (scrollX = scroller.scrollLeft)}>
	<div
		class="inner"
		style:width={`${LABEL_W + (fitted ? Math.max(width + FIT_TAIL_PX, lastFormationSec * px + THUMB_W) : width + TAIL_PX)}px`}
	>
		<div class="row segs">
			<div class="lab">
				<span>段</span>
				<button
					type="button"
					class="insert"
					aria-expanded={!!inserting}
					disabled={spans.length === 0}
					title="在播放頭空出時間，這段後面的站位、動作一起往後延"
					onclick={toggleInsert}>插入八拍</button
				>
				<button
					type="button"
					class="add"
					aria-label="在最後加一段"
					aria-haspopup="menu"
					aria-expanded={!!menu && menu.after === null}
					onclick={(e) => toggleMenu(e, null)}><Icon name="plus" size={14} /></button
				>
			</div>
			<div class="trk" style:width={`${width}px`}>
				{#each spans as span (span.segment.id)}
					{@const missing = editor.music.missingSegmentIds.includes(span.segment.id)}
					{@const segW = Math.max(span.durationSec * px - 2, SEG_MIN_W)}
					{@const meta =
						span.segment.kind === 'music' ? `${span.segment.bpm} BPM` : `${span.durationSec.toFixed(1)} 秒`}
					<button
						type="button"
						class="seg {span.segment.kind}"
						class:missing
						class:short={span.durationSec * px - 2 < SEG_MIN_W}
						style:left={`${span.startSec * px}px`}
						style:width={`${segW}px`}
						style:padding-left={`${8 + nameShift(span.startSec * px, segW)}px`}
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
						aria-haspopup="menu"
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
						data-space-plays
						aria-label="時間軸縮小"
						disabled={zoom <= ZOOMS[0] + 1e-9}
						onclick={() => zoomButton(-1)}><Icon name="minus" size={13} /></button
					>
					<span class="zoom-val">×{zoom.toFixed(1)}</span>
					<button
						type="button"
						class="ghost"
						data-space-plays
						aria-label="時間軸放大"
						disabled={zoom >= ZOOMS.at(-1)! - 1e-9}
						onclick={() => zoomButton(1)}><Icon name="plus" size={13} /></button
					>
					<button
						type="button"
						class="ghost fit"
						data-space-plays
						aria-label="符合寬度"
						title="整支流程剛好放滿現在的寬度"
						disabled={spans.length === 0}
						onclick={fitWidth}><Icon name="fitWidth" size={13} /></button
					>
				</span>
			</div>
			<!-- 用滑鼠點或拖移動播放頭；鍵盤操作之後跟播放（空白鍵）一起做。 -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="trk ruler" data-ruler bind:this={ruler} style:width={`${width}px`} onpointerdown={startSeek}>
				{#each marks as mark (mark.sec)}
					<div class="tk" class:big={mark.major} style:left={`${mark.sec * px}px`}>
						{#if mark.label}<span data-mark-sec={mark.sec}>{mark.label}</span>{/if}
					</div>
				{/each}
				<div class="ph-head" style:left={`${playback.sec * px}px`}></div>
			</div>
		</div>
		<FormationRow pxPerSec={px} />
		<Lanes pxPerSec={px} {clashes} />
		{#if flow.members.length === 0}
			<div class="row lanes-empty">
				<div class="lab"></div>
				<span>還沒有隊員。到右邊的「隊員」加人，每個人會有一條自己的泳道。</span>
			</div>
		{/if}
		<!-- 播放頭的線本身也能拖（跟在八拍尺上拖一樣） -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="ph" data-playhead-line style:left={`${LABEL_W + playback.sec * px}px`} onpointerdown={startSeek}></div>
	</div>
</div>

{#if menu}
	{@const after = spans.find((s) => s.segment.id === menu?.after)}
	<!-- 選單放在「＋」下面、左邊對齊；點外面、按 Esc 就收（popover.svelte.ts） -->
	<div
		class="menu"
		role="menu"
		aria-labelledby="add-menu-title"
		{@attach popover({
			place: below(menu.anchor, { gap: 4, align: 'left', flip: false }),
			close: closeMenu,
			inside: [menu.anchor]
		})}
		{@attach menuKeys}
	>
		<span class="menu-title" id="add-menu-title">{after ? `加在${after.label} 後面` : '加在最後'}</span>
		<button type="button" role="menuitem" onclick={() => add('music')}>＋音樂段</button>
		<button type="button" role="menuitem" onclick={() => add('chant')}>＋口號段</button>
	</div>
{/if}

{#if inserting && insertSpan && insertAt}
	{@const music = insertSpan.segment.kind === 'music'}
	<!-- 插入八拍的小窗：放在鈕下面；點外面、按 Esc 就收 -->
	<form
		class="menu insert-pop"
		{@attach popover({
			place: below(inserting.anchor, { gap: 4, align: 'left', flip: false }),
			close: () => (inserting = null),
			inside: [inserting.anchor]
		})}
		onsubmit={(e) => {
			e.preventDefault();
			insert();
		}}
	>
		<span class="menu-title">在{insertSpan.label} {atTextWithUnit(insertSpan.segment, insertAt.at)} 插入</span>
		<div class="insert-row">
			<input aria-label="插入幾個" inputmode="decimal" bind:value={insertCount} />
			{#if music}
				<select aria-label="單位" bind:value={insertUnit}>
					<option value="eight">個八拍</option>
					<option value="beat">拍</option>
				</select>
			{:else}
				<span>秒</span>
			{/if}
			<button type="submit" class="primary">插入</button>
		</div>
		{#if insertAsk.error}<p class="error" role="alert">{insertAsk.error}</p>{/if}
	</form>
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
	/* 段列和八拍尺捲動時固定在上面；疊在泳道的名字欄（z 6）和播放頭（z 4）上面。 */
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
	.insert {
		margin-left: auto;
		height: 22px;
		padding: 0 6px;
		font-size: 11px;
	}
	.insert + .add {
		margin-left: 0;
	}
	.insert-pop {
		padding: 4px 8px 8px;
		max-width: 260px;
	}
	.insert-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.insert-row input {
		width: 48px;
	}
	.insert-pop .error {
		margin: 4px 2px 0;
		font-size: 12px;
		color: var(--danger, #c0392b);
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
		.insert,
		.zoom-btns button {
			position: relative;
		}
		/* 「插入八拍」夠寬，只往上下加高；跟「＋」一樣往下多一點，不超出段列 */
		.insert::after {
			content: '';
			position: absolute;
			inset: -6px 0 -10px;
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
		/* 在走位條（z 5）底下：播放頭停在走位條端點上時，按到的是端點 */
		z-index: 4;
		cursor: ew-resize;
	}
	/* 拖得到的範圍比線寬一點 */
	.ph::before {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		left: -3px;
		right: -3px;
	}
</style>
