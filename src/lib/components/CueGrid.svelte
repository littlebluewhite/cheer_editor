<script lang="ts">
	// 拍點格子：像紙本八拍表，動作碰到的每個八拍一排 8 個數字格，下面是拍子、步驟、手位三條。
	// 點一格選一拍；按住 Shift 點另一格選一段；也可以在數字格或拍點條的空格上按住拖過幾拍。
	// 選好就在選的拍旁邊跳出拍點小窗，裡面有給誰、＋、－ 和三種拍點的按鈕。
	// 點 down、up 就放滿選到的拍，選取跳到下一拍。
	// 步驟放滿選到的拍，手位只放在選到的第一拍；兩條都可以自己打字，這支流程用過的字變成按鈕。
	// 格子對齊音樂的整拍（動作從 & 開始也一樣），動作外面的格子變淡、不能選。
	// 一格分前後兩個半格：從 & 開始或結束的拍點只塗半格；點這種拍點，選回它原本的範圍（也從 & 開始）。
	// 現在播到的那一拍有標記。格子上按方向鍵左右移選取，加 Shift 延長選取。
	// 放之前選「給誰」：全部、動作裡的任務角色或隊員。給不同人的拍點疊在同一拍時，那一條往下多開一軌。
	// 規則（在動作裡、整數拍、只有 down／up、給的人在動作裡）都交給流程核心；被擋就顯示原因。
	// 選的拍和給誰放在編輯 session（session.beats，選拍的規則在那裡）；這裡只管選拍的指標、焦點和畫格子。
	// 拍子那條上面一直有一條「環節」（環節的顏色，寫種類和名字），標了拍的範圍從上到下鋪同色淡底、左右畫線；
	// 小窗也有一列「環節」：現有環節的按鈕（把選的拍標給它）、種類、名字、加入、清掉。
	// 還沒記成功率的動作加第一個環節，就開始記成功率；拍清光的環節自動刪掉，有記號時小窗裡先問（規則在流程核心）。
	// 選的拍剛好是一個環節的拍（例：點環節的色條）時，環節列多出改它名字、種類、顏色的地方。
	// 口號段不數拍、沒有格子：直接一列「環節」，環節按鈕照加的先後排、種類、名字、加入；
	// 點一個環節選它，可以改名字、種類、顏色，或按清掉刪掉它（有記號先問）。
	import { composing } from '#lib/ime.js';
	import { untrack } from 'svelte';
	import { GAP, placeCuePop } from '#lib/cue-pop.js';
	import { getEditorSession } from '#lib/editor-session.svelte.js';
	import ConfirmList from './ConfirmList.svelte';
	import { Ask } from './ask.svelte';
	import { touchOnUnpicked } from './pointer';
	import {
		COUNT_WORDS,
		CUE_KIND_LABELS,
		CUE_KINDS,
		HALF_BEATS_PER_BEAT as BEAT,
		MOTION_WORDS,
		PHASE_COLORS,
		PHASE_KINDS,
		phaseLabel,
		STEP_WORDS,
		actionEights,
		addPhase,
		toPosition,
		atText,
		clearCues,
		clearPhaseBeats,
		cueText,
		deletePhase,
		markPhaseBeats,
		memberName,
		phaseColor,
		placeCue,
		sameWho,
		updatePhase,
		usedWords,
		whoName,
		type Action,
		type CommandResult,
		type ConfirmOption,
		type Cue,
		type CueKind,
		type Flow,
		type Phase,
		type PhaseChange,
		type PhaseKind,
		type Who
	} from '#lib/core';

	interface Props {
		/** 選到的動作（session 選的那個；選的拍跟著它）。 */
		action: Action;
		/** 播放頭（全域秒數）；標出現在播到的那一拍。 */
		playheadSec?: number;
		/** 指標位置 → 對到的格子（身上有 data-at）。預設照格子在畫面上的範圍找最近的；jsdom 算不了版面，測試換掉（ADR 0002）。 */
		cellAt?: (sheet: HTMLElement, x: number, y: number) => HTMLElement;
	}

	let { action, playheadSec, cellAt = nearestCell }: Props = $props();

	const session = getEditorSession();
	const flow = $derived(session.flow!);

	const cols = Array.from({ length: 8 }, (_, c) => c);
	/** 三條由上往下，排在每個八拍的數字格下面。 */
	const LANES = CUE_KINDS.map((kind) => ({ kind, label: CUE_KIND_LABELS[kind] }));

	const segment = $derived(flow.segments.find((s) => s.id === action.segmentId) ?? null);
	/** 步驟、手位的按鈕：內建的字，加上這支流程用過的字（打開別人的流程檔也看得到）。 */
	const wordRows = $derived.by(() => {
		const used = usedWords(flow);
		return [
			{ kind: 'step' as const, label: CUE_KIND_LABELS.step, words: [...STEP_WORDS, ...used.step], tip: '自己打，例：抬腳' },
			{ kind: 'motion' as const, label: CUE_KIND_LABELS.motion, words: [...MOTION_WORDS, ...used.motion], tip: '自己打，例：拳頭' }
		];
	});
	/** 「給誰」的按鈕：全部、動作裡出現的任務角色、動作裡的隊員。 */
	const whoOptions = $derived.by(() => {
		const roles = [...new Set(action.members.flatMap((m) => (m.role === null ? [] : [m.role])))];
		return [
			{ label: '全部', who: null as Who },
			...roles.map((role) => ({ label: role, who: { role } as Who })),
			...action.members.map((m) => ({ label: memberName(flow, m.memberId), who: { member: m.memberId } as Who }))
		];
	});
	const phases = $derived(action.successRate?.phases ?? []);
	/** 小窗裡加新環節的種類和名字。 */
	let phaseKind = $state<PhaseKind>('load');
	let phaseName = $state('');
	/** 口號段點選的環節 id。 */
	let chosen = $state<string | null>(null);

	/** 自己打的字，步驟和手位各一格。 */
	let custom = $state({ step: '', motion: '' });
	/** 動作碰到的每個八拍，和切進去的拍點、環節（切法在流程核心）。 */
	const slices = $derived(actionEights(action));
	/** 動作碰到的八拍（從 0 起）。 */
	const eights = $derived(slices.map((s) => s.eight));
	/** 動作裡第一格（整拍）從動作開始算第幾個半拍；動作從 & 開始時是 1。 */
	const firstCell = $derived(action.start % BEAT);

	/** 選到的拍、給誰（session 管）：選的拍從 from 那一拍到 to 那一拍（從動作開始算的半拍，各佔一拍）。 */
	const beats = session.beats;
	const sel = $derived({ from: beats.from, to: beats.to });
	/** 被擋的原因，和等教練回答的環節改動（會刪掉有記號的環節）。 */
	const ask = new Ask(
		(f) => {
			hold = pop;
			session.change(f);
		},
		{ confirmLabel: '確定刪除' }
	);

	/** 拍點小窗開著沒；拖的時候先收起來，放開才跳出來。 */
	let pop = $state(false);
	let dragging = $state(false);
	let wrapEl = $state<HTMLElement>();
	let popEl = $state<HTMLElement>();
	let popPos = $state({ top: 0, left: 0, arrow: 0, above: false });
	/** 格子框在畫面上的左上角：小窗開在最上層（popover），用畫面座標放（popPos 是格子框裡的座標）。 */
	let origin = $state({ x: 0, y: 0 });
	/** 格子下面一直留著的空位（小窗最高那次的高度）：只長不縮，關掉小窗時捲動長度不會變短，畫面不會跳。 */
	let reserve = $state(0);
	/** 放完 down／up 自動跳到下一拍時才可以捲；自己點選的時候畫面不動。 */
	let follow = false;
	/** 按的是小窗裡的按鈕（＋－、放拍點）：小窗留在原地，按鈕不會從滑鼠下面跑掉。 */
	let hold = false;
	/** 視窗多寬；變了小窗就重新放。 */
	let winW = $state(0);
	const whoIndex = $derived(Math.max(0, whoOptions.findIndex((o) => sameWho(o.who, beats.who))));

	/** 這一格（從 at 開始的一拍）整個在動作裡。 */
	const inAction = (at: number) => at >= 0 && at + BEAT <= action.length;
	const hasCells = $derived(inAction(firstCell));
	/** 第 h 個半拍有沒有選到。 */
	const covered = (h: number) => beats.covers(h);
	/** 這一格（從 at 開始）有選到（前半或後半）。 */
	const isSel = (at: number) => covered(at) || covered(at + 1);
	/** 半拍 at 所在那一格的開頭。 */
	const cellOf = (at: number) => at - ((((action.start + at) % BEAT) + BEAT) % BEAT);
	/** 現在播到的那一格（從動作開始算）；播放頭不在這個段就是 null。 */
	const nowCell = $derived.by(() => {
		if (playheadSec === undefined || !segment) return null;
		const pos = toPosition(flow, playheadSec);
		return pos?.segmentId === segment.id ? cellOf(pos.at - action.start) : null;
	});
	const selLen = $derived(beats.len);
	/** 可以改的環節：音樂段是選的拍剛好是它的拍的那個，口號段是點選的那個；沒有就 null。 */
	const editing = $derived(
		(segment?.kind === 'music'
			? phases.find((p) => p.beats?.at === sel.from && p.beats.len === selLen)
			: phases.find((p) => p.id === chosen)) ?? null
	);

	// 只在值變了才通知（action 每次改流程都是新物件）。
	const actionId = $derived(action.id);

	// 換動作就收掉小窗和問題（選的拍由 session 從第一拍開始）。
	$effect(() => {
		void actionId;
		untrack(() => {
			ask.clear();
			pop = false;
			chosen = null;
		});
	});

	/** 段內時間文字（例：「3-5」）；at 從動作開始算。 */
	const beatText = (at: number) => (segment ? atText(segment, action.start + at) : '');
	/** 「3-5 到 3-6・2 拍」；只有一拍是「3-5・1 拍」。 */
	function spanText(from: number, len: number): string {
		const last = from + len - BEAT;
		const range = last > from ? `${beatText(from)} 到 ${beatText(last)}` : beatText(from);
		return `${range}・${len / BEAT} 拍`;
	}

	/** 送指令給問教練；成功（問了答好也算）才跑 after。回有沒有馬上成功。 */
	function send(cmd: (o?: ConfirmOption) => CommandResult, after?: () => void): boolean {
		hold = pop;
		return ask.send(cmd, { done: () => after?.() }).kind === 'ok';
	}

	function openPop() {
		hold = false;
		ask.clear();
		pop = true;
	}

	/** 拖拉選拍：pointer 按下過、還沒收到 click（點一下時 pointerdown 已經選好，click 不用再選）。 */
	let pointerSel = false;

	/** 手指按在沒選到的格子上：先不選（可能是要捲畫面）；放開了才選這一拍，被系統打斷（捲動了）就不選。 */
	let tapAt: number | null = null;

	function dragStart(e: PointerEvent) {
		if (e.button !== 0) return;
		const el = (e.target as Element).closest<HTMLElement>('[data-at]');
		const at = Number(el?.dataset.at);
		if (!el || !inAction(at)) return;
		pointerSel = true;
		// 手指：選到的格子上才拖得動（拖過幾拍）；沒選到的一滑是捲動（docs/adr/0005-ipad-touch.md）。
		if (touchOnUnpicked(e, isSel(at))) {
			tapAt = at;
			return;
		}
		beats.click(at, e.shiftKey);
		dragging = true;
		// 抓住指標：拖過變淡（disabled）的格子、拖出格子外都收得到。
		(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
	}

	function dragMove(e: PointerEvent) {
		if (!dragging) return;
		const el = cellAt(e.currentTarget as HTMLElement, e.clientX, e.clientY);
		beats.dragTo(Number(el.dataset.at));
	}

	function dragEnd() {
		if (tapAt !== null) beats.click(tapAt);
		if (dragging || tapAt !== null) openPop();
		dragCancel();
	}
	function dragCancel() {
		tapAt = null;
		dragging = false;
	}

	function grow(step: 1 | -1) {
		hold = pop;
		beats.grow(step);
	}

	/** 拍子、步驟放滿選到的拍；手位只放在第一拍。拍子放完選取跳到下一拍。 */
	function place(kind: CueKind, word: string): boolean {
		const len = kind === 'motion' ? BEAT : selLen;
		const placed = send(() => placeCue(flow, action.id, { kind, at: sel.from, len, word, who: beats.who }));
		if (placed && kind === 'count' && beats.next()) follow = pop;
		return placed;
	}

	function addCustom(kind: 'step' | 'motion') {
		const word = custom[kind].trim();
		if (word && place(kind, word)) custom[kind] = '';
	}

	/** Enter 也能加入；中文輸入法還在選字時按的 Enter 不算（Safari 選字時 keyCode 是 229）。 */
	function onCustomKey(e: KeyboardEvent, kind: 'step' | 'motion') {
		if (e.key !== 'Enter' || composing(e)) return;
		e.preventDefault();
		addCustom(kind);
	}

	/** 把選的拍標給現有的環節。 */
	function markPhase(phaseId: string) {
		const { from } = sel;
		const len = selLen;
		send((o) => markPhaseBeats(flow, action.id, phaseId, from, len, o));
	}

	/** 清掉選的拍裡環節標的拍；拍清光的環節刪掉。 */
	function clearPhases() {
		const { from, to } = sel;
		send((o) => clearPhaseBeats(flow, action.id, from, to + BEAT, o));
	}

	/** 加環節（種類、名字）：音樂段標上選的拍，口號段加在最後。 */
	function addNewPhase() {
		const beats = segment?.kind === 'music' ? { at: sel.from, len: selLen } : undefined;
		send(
			(o) => addPhase(flow, action.id, { kind: phaseKind, name: phaseName, beats }, o),
			() => (phaseName = '')
		);
	}

	/** 口號段刪掉點選的環節。 */
	function deleteChosen() {
		const id = chosen;
		if (id) send((o) => deletePhase(flow, action.id, id, o));
	}

	/** 改環節的名字、種類、顏色。 */
	function editPhase(id: string, change: PhaseChange) {
		send(() => updatePhase(flow, action.id, id, change));
	}

	function clear(kind: CueKind) {
		send(() => clearCues(flow, action.id, kind, sel.from, sel.to + BEAT));
	}

	/** 點一個拍點或環節：選回它原本的範圍（從 & 開始的也照實）；拍點的「給誰」也換成它的。 */
	function pick(range: { at: number; len: number }, cueWho?: Who) {
		beats.pick(range, cueWho);
		openPop();
	}

	/** 方向鍵：左右移選取；加 Shift 延長或縮短（規則在 session）。焦點跟著動的那一端。 */
	function arrowKey(e: KeyboardEvent) {
		const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
		if (!dir) return;
		e.preventDefault();
		const to = beats.arrow(dir, e.shiftKey);
		if (to === null) return;
		openPop();
		wrapEl?.querySelector<HTMLElement>(`.cell[data-at="${to}"]`)?.focus();
	}

	/** 往上找會捲動的那一層（編輯頁右邊欄）。 */
	function scrollBox(el: HTMLElement): HTMLElement {
		let p = el.parentElement;
		while (p && !/(auto|scroll)/.test(getComputedStyle(p).overflowY)) p = p.parentElement;
		return p ?? document.documentElement;
	}

	// 拍點小窗放在選的拍下面（手位那條下面），畫面下面放不下就放上面；點選的時候不捲動畫面。
	// 按小窗裡的按鈕時小窗不動，只有尖角跟著選取（規則在 placeCuePop）。
	$effect(() => {
		if (!pop || dragging || !wrapEl || !popEl) return;
		void flow;
		void ask.error;
		void ask.question;
		void winW; // 視窗變寬變窄，小窗也重新放
		const held = hold;
		hold = false;
		const q = (s: string) => wrapEl!.querySelector<HTMLElement>(s);
		// 選取碰到的第一格、最後一格（從 & 開始的選取，頭尾各碰到半格）。
		const [first, last] = [cellOf(sel.from), cellOf(sel.to + 1)];
		const head = q(`.cell[data-at="${first}"]`);
		const a = q(`.slot.motion[data-at="${first}"]`);
		const b = q(`.slot.motion[data-at="${last}"]`);
		if (!head || !a || !b) return;
		// 小窗開在最上層（popover）：右邊欄捲動容器裁不到它。
		// jsdom 沒有 popover（還會把 popover 屬性的元素當成藏起來），所以在這裡才加屬性。
		if (popEl.showPopover && !popEl.matches(':popover-open')) {
			popEl.popover = 'manual';
			popEl.showPopover();
		}
		// 最寬跟格子框一樣；先設好寬度再量高度
		popEl.style.width = `min(480px, ${wrapEl.clientWidth}px)`;
		const h = popEl.offsetHeight;
		untrack(() => {
			if (h + GAP > reserve) reserve = h + GAP;
		});
		const box = scrollBox(wrapEl);
		// 自動跳到的下一拍在畫面下面看不到：往下捲剛好看得到那一排就好。
		let scrolled = false;
		if (follow) {
			follow = false;
			const view = box.getBoundingClientRect();
			const over = b.getBoundingClientRect().bottom - view.bottom;
			if (over > 0) {
				box.scrollTop += Math.min(over + GAP, head.getBoundingClientRect().top - view.top);
				scrolled = true;
			}
		}
		const wrap = wrapEl.getBoundingClientRect();
		origin = { x: wrap.left, y: wrap.top };
		// 小窗不會被右邊欄裁掉，下面可以開到畫面底（蓋住時間軸）；上面只算到右邊欄的頂端（再上面是分頁列、上方列）。
		const view = { top: box.getBoundingClientRect().top, bottom: innerHeight };
		const rect = (el: HTMLElement) => {
			const r = el.getBoundingClientRect();
			return { top: r.top - wrap.top, bottom: r.bottom - wrap.top, left: r.left - wrap.left, right: r.right - wrap.left };
		};
		const [ra, rb, rh] = [rect(a), rect(b), rect(head)];
		const sameRow = ra.top === rb.top;
		const mid = (ra.left + rb.right) / 2;
		popPos = placeCuePop({
			sel: { top: rh.top, bottom: rb.bottom, left: sameRow ? ra.left : 0, right: sameRow ? rb.right : wrap.width },
			arrowAbove: sameRow ? mid : (ra.left + ra.right) / 2,
			arrowBelow: sameRow ? mid : (rb.left + rb.right) / 2,
			pop: { w: popEl.offsetWidth, h },
			wrapW: wrapEl.clientWidth,
			view: { top: view.top - wrap.top, bottom: view.bottom - wrap.top },
			rowH: (head.parentElement as HTMLElement).offsetHeight + 10,
			cur: held && !scrolled ? untrack(() => popPos) : null
		});
	});

	function outside(e: PointerEvent) {
		if (pop && !wrapEl?.contains(e.target as Node)) pop = false;
	}

	// 小窗開著時右邊欄捲動、視窗變大變小：小窗跟著格子走。
	$effect(() => {
		if (!pop) return;
		const move = () => {
			if (!wrapEl) return;
			const r = wrapEl.getBoundingClientRect();
			origin = { x: r.left, y: r.top };
		};
		addEventListener('scroll', move, true);
		addEventListener('resize', move);
		return () => {
			removeEventListener('scroll', move, true);
			removeEventListener('resize', move);
		};
	});

	/** Esc 只關小窗（不讓編輯頁把動作也取消選）。 */
	function popKeys(e: KeyboardEvent) {
		// 中文輸入法選字時的 Esc 是取消選字，不關小窗（Safari 選字時 keyCode 是 229）。
		if (!pop || e.key !== 'Escape' || composing(e)) return;
		e.stopPropagation();
		pop = false;
	}

	/** 範圍 [lo, hi] 離 v 多遠（在裡面是 0）。 */
	const dist = ([lo, hi]: [number, number], v: number) => (v < lo ? lo - v : v > hi ? v - hi : 0);
	function nearest(els: HTMLElement[], span: (r: DOMRect) => [number, number], v: number) {
		let best = els[0];
		for (const el of els) {
			if (dist(span(el.getBoundingClientRect()), v) < dist(span(best.getBoundingClientRect()), v)) best = el;
		}
		return best;
	}
	/** 先找 y 最近的那個八拍，再找那一排 x 最近的數字格。 */
	function nearestCell(sheet: HTMLElement, x: number, y: number): HTMLElement {
		const row = nearest([...sheet.querySelectorAll<HTMLElement>('.row')], (r) => [r.top, r.bottom], y);
		return nearest([...row.querySelectorAll<HTMLElement>('.cell')], (r) => [r.left, r.right], x);
	}

	/** 某一個八拍裡的拍點、環節：每個從這個八拍的第 start 個半格到第 end 個半格（不含 end）；疊在一起的拍點在下一軌。 */
	const inEight = (e: number) => slices.find((s) => s.eight === e)!;

	/** 「1-1 到 1-3」：spanText 去掉後面的拍數。 */
	const rangeOf = (at: number, len: number) => spanText(at, len).replace(/・.*$/, '');

	/** 一個八拍裡三條的排法：每條從第幾列開始、有幾軌（至少一軌）；第 1 列是數字格，第 2 列是環節。 */
	function layout(e: number) {
		let row = 3;
		return LANES.map((lane) => {
			const ps = inEight(e).cues.filter((p) => p.cue.kind === lane.kind);
			const tracks = Math.max(1, ...ps.map((p) => p.track + 1));
			const placed = { ...lane, row, tracks, pieces: ps };
			row += tracks;
			return placed;
		});
	}
</script>

<div class="cues" role="group" aria-label="拍點">
	<span class="cap">拍點</span>
	{#if segment?.kind !== 'music'}
		<p class="muted">口號段不數拍，不能放拍點</p>
		<div class="pop-row phase" role="group" aria-label="環節">
			<span class="lbl">環節</span>
			<div class="words">
				{#each phases as p (p.id)}
					<button
						type="button"
						class="word phase"
						style:--c={phaseColor(p)}
						aria-label="環節 {phaseLabel(p)}"
						aria-pressed={p.id === chosen}
						onclick={() => (chosen = chosen === p.id ? null : p.id)}>{phaseLabel(p)}</button
					>
				{/each}
				{@render adder(addNewPhase)}
			</div>
			<button type="button" class="clear" aria-label="清掉環節" disabled={!editing} onclick={deleteChosen}>清掉</button>
			{#if editing}{@render edit(editing)}{/if}
		</div>
		{@render asks()}
	{:else if !hasCells}
		<p class="muted">動作不到一拍，不能放拍點</p>
	{:else}
		<p class="hint">在數字格上點或拖，選好拍就會跳出拍點小窗。點一拍，再按住 Shift 點另一拍，也能選連續好幾拍。</p>
		<div class="sheet-wrap" bind:this={wrapEl} style:padding-bottom={reserve ? `${reserve}px` : undefined}>
			<div
				class="sheet"
				role="presentation"
				onpointerdown={dragStart}
				onpointermove={dragMove}
				onpointerup={dragEnd}
				onpointercancel={() => {
					// 被系統打斷（手指捲動了）就不會有 click，下一次點格子要照常選。
					pointerSel = false;
					dragCancel();
				}}
				onclick={() => (pointerSel = false)}
				onkeydown={arrowKey}
			>
				{#each eights as e (e)}
					{@const lanes = layout(e)}
					{@const bottom = lanes[lanes.length - 1].row + lanes[lanes.length - 1].tracks}
					<div class="row">
						<span class="eight" aria-hidden="true">{e + 1}</span>
						<span class="lane-lbl phase" style:grid-row="2">環節</span>
						{#each lanes as lane (lane.kind)}
							<span class="lane-lbl {lane.kind}" style:grid-row="{lane.row} / span {lane.tracks}">{lane.label}</span>
						{/each}
						{#each cols as c (c)}
							{@const at = (e * 8 + c) * BEAT - action.start}
							<button
								type="button"
								class="cell"
								data-at={at}
								style:grid-column="{c * 2 + 2} / span 2"
								class:sel={isSel(at)}
								class:left={isSel(at) && !covered(at + 1)}
								class:right={isSel(at) && !covered(at)}
								class:now={at === nowCell}
								aria-label="{e + 1}-{c + 1}"
								aria-pressed={inAction(at) && isSel(at)}
								aria-current={at === nowCell ? 'time' : undefined}
								disabled={!inAction(at)}
								onclick={(ev) => {
								if (pointerSel) return;
								beats.click(at, ev.shiftKey);
								openPop();
							}}>{c + 1}</button
							>
							<span
								class="slot phase"
								data-at={at}
								class:out={!inAction(at)}
								class:sel={isSel(at)}
								class:left={isSel(at) && !covered(at + 1)}
								class:right={isSel(at) && !covered(at)}
								style:grid-column="{c * 2 + 2} / span 2"
								style:grid-row="2"
							></span>
							{#each lanes as lane (lane.kind)}
								<span
									class="slot {lane.kind}"
									data-at={at}
									class:out={!inAction(at)}
									class:sel={isSel(at)}
									class:left={isSel(at) && !covered(at + 1)}
									class:right={isSel(at) && !covered(at)}
									style:grid-column="{c * 2 + 2} / span 2"
									style:grid-row="{lane.row} / span {lane.tracks}"
								></span>
							{/each}
						{/each}
						{#each inEight(e).phases as p (p.phase.id)}
							{@const label = phaseLabel(p.phase)}
							<!-- 淡底：從數字格鋪到最後一條，左右畫線；疊在格子上面、字的下面，點得穿 -->
							<span
								class="zone"
								class:cont={!p.first}
								class:more={!p.last}
								data-phase={p.phase.id}
								style:--c={phaseColor(p.phase)}
								style:grid-column="{p.start + 2} / {p.end + 2}"
								style:grid-row="1 / {bottom}"
							></span>
							<button
								type="button"
								class="item phase"
								class:cont={!p.first}
								class:more={!p.last}
								style:--c={phaseColor(p.phase)}
								style:grid-column="{p.start + 2} / {p.end + 2}"
								style:grid-row="2"
								aria-label="環節 {label} {rangeOf(p.beats.at, p.beats.len)}"
								aria-hidden={!p.first || undefined}
								tabindex={p.first ? undefined : -1}
								onclick={() => pick(p.beats)}
								>{p.first ? label : `…${label}`}</button
							>
						{/each}
						{#each lanes as lane (lane.kind)}
							{#each lane.pieces as p}
								{@const to = whoName(flow, p.cue.who)}
								<button
									type="button"
									class="item {lane.kind} {lane.kind === 'count' ? p.cue.word : ''}"
									class:cont={!p.first}
									class:more={!p.last}
									class:end={p.start >= 14}
									style:grid-column="{p.start + 2} / {p.end + 2}"
									style:grid-row={lane.row + p.track}
									aria-label={cueText(lane.kind, p.cue.word, spanText(p.cue.at, p.cue.len), to)}
									aria-hidden={!p.first || undefined}
									tabindex={p.first ? undefined : -1}
									onclick={() => pick(p.cue, p.cue.who)}
									>{p.first ? p.cue.word : `…${p.cue.word}`}{#if to}<small class="who">{to}</small>{/if}</button
								>
							{/each}
						{/each}
					</div>
				{/each}
			</div>

			{#if pop && !dragging}
				<div
					class="pop"
					class:above={popPos.above}
					bind:this={popEl}
					style:top="{origin.y + popPos.top}px"
					style:left="{origin.x + popPos.left}px"
					style:--arrow="{popPos.arrow}px"
					role="dialog"
					aria-label="拍點小窗"
				>
					<div class="pop-head">
						<!-- －／＋ 放在字前面：字會變長，放後面按鈕就會被擠走 -->
						<button type="button" class="pm" aria-label="少選一拍" onclick={() => grow(-1)}>－</button>
						<button type="button" class="pm" aria-label="多選一拍" onclick={() => grow(1)}>＋</button>
						<span class="sel-text">選了 {spanText(sel.from, selLen)}</span>
						<label class="who-sel">
							<span>給誰</span>
							<select value={whoIndex} onchange={(e) => (beats.who = whoOptions[Number(e.currentTarget.value)].who)}>
								{#each whoOptions as o, i (i)}<option value={i}>{o.label}</option>{/each}
							</select>
						</label>
						<button type="button" class="x" aria-label="關閉" onclick={() => (pop = false)}>✕</button>
					</div>
					<div class="pop-row count" role="group" aria-label="拍子">
						<span class="lbl">拍子</span>
						<div class="words">
							{#each COUNT_WORDS as w (w)}
								<button type="button" class="word {w}" onclick={() => place('count', w)}>{w}</button>
							{/each}
						</div>
						<button type="button" class="clear" aria-label="清掉拍子" onclick={() => clear('count')}>清掉</button>
					</div>
					{#each wordRows as row (row.kind)}
						<div class="pop-row {row.kind}" role="group" aria-label={row.label}>
							<span class="lbl">{row.label}</span>
							<div class="words">
								{#each row.words as w (w)}
									<button type="button" class="word" onclick={() => place(row.kind, w)}>{w}</button>
								{/each}
								<span class="own">
									<input
										class="custom"
										aria-label="自己打{row.label}"
										placeholder={row.tip}
										bind:value={custom[row.kind]}
										onkeydown={(e) => onCustomKey(e, row.kind)}
									/>
									<button
										type="button"
										class="word"
										aria-label="加入{row.label}"
										disabled={!custom[row.kind].trim()}
										onclick={() => addCustom(row.kind)}>加入</button
									>
								</span>
							</div>
							<button type="button" class="clear" aria-label="清掉{row.label}" onclick={() => clear(row.kind)}>清掉</button>
						</div>
					{/each}
					<div class="pop-row phase" role="group" aria-label="環節">
						<span class="lbl">環節</span>
						<div class="words">
							{#each phases as p (p.id)}
								<button
									type="button"
									class="word phase"
									style:--c={phaseColor(p)}
									aria-label="把這幾拍標給 {phaseLabel(p)}"
									onclick={() => markPhase(p.id)}>{phaseLabel(p)}</button
								>
							{/each}
							{@render adder(addNewPhase)}
						</div>
						<button
							type="button"
							class="clear"
							aria-label="清掉環節"
							onclick={clearPhases}>清掉</button
						>
						{#if editing}{@render edit(editing)}{/if}
					</div>
					{@render asks()}
				</div>
			{/if}
		</div>
	{/if}
</div>

<!-- 加新環節：種類、名字、加入。 -->
{#snippet adder(add: () => void)}
	<span class="own">
		<select class="kind" aria-label="環節的種類" bind:value={phaseKind}>
			{#each PHASE_KINDS as k (k.key)}<option value={k.key}>{k.label}</option>{/each}
		</select>
		<input class="custom" aria-label="環節的名字" placeholder="名字，例：延伸" bind:value={phaseName} />
		<button type="button" class="word" aria-label="加入環節" onclick={add}>加入</button>
	</span>
{/snippet}

<!-- 改環節：名字、種類、顏色。 -->
{#snippet edit(p: Phase)}
	<div class="edit" role="group" aria-label="改環節">
		<span class="hint">改 {phaseLabel(p)}</span>
		<!-- 色塊就是換色的選單：選單疊在色塊上、看不見，點色塊就跳出顏色 -->
		<span class="chip" style:--c={phaseColor(p)} title="換顏色">
			<select
				aria-label="這個環節的顏色"
				value={p.color ?? ''}
				onchange={(e) => editPhase(p.id, { color: e.currentTarget.value || null })}
			>
				<option value="">照種類</option>
				{#each PHASE_COLORS as c (c.value)}<option value={c.value}>{c.label}</option>{/each}
			</select>
		</span>
		<select
			class="kind"
			aria-label="這個環節的種類"
			value={p.kind}
			onchange={(e) => editPhase(p.id, { kind: e.currentTarget.value as PhaseKind })}
		>
			{#each PHASE_KINDS as k (k.key)}<option value={k.key}>{k.label}</option>{/each}
		</select>
		<input
			class="custom"
			aria-label="這個環節的名字"
			placeholder="名字（可空）"
			value={p.name}
			onchange={(e) => editPhase(p.id, { name: e.currentTarget.value })}
		/>
	</div>
{/snippet}

<!-- 等確認的環節改動、被擋的原因。 -->
{#snippet asks()}
	{#if ask.question}<ConfirmList {ask} />{/if}
	{#if ask.error}<p class="error" role="alert">{ask.error}</p>{/if}
{/snippet}

<svelte:window bind:innerWidth={winW} onpointerdown={outside} onkeydowncapture={popKeys} />

<style>
	.cues {
		display: grid;
		gap: 8px;
		background: var(--surface, #fff);
		border: 1px solid var(--line-soft, #e8ecf3);
		border-radius: 10px;
		padding: 10px;
	}
	.cap {
		font-size: 12px;
		font-weight: 600;
		color: var(--muted, #66718a);
	}
	p {
		margin: 0;
	}
	.muted {
		color: var(--muted, #66718a);
	}
	.sheet {
		display: grid;
		gap: 10px;
		/* 拖拉選拍時不選到文字、畫面不捲動（觸控也一樣）。 */
		user-select: none;
		-webkit-user-select: none;
	}
	/* 選到的格子上手指拖是拖拉選拍；沒選到的一滑是捲右邊欄。 */
	.cell.sel,
	.slot.sel {
		touch-action: none;
	}
	.row {
		display: grid;
		/* 一拍兩欄（前半、後半）：從 & 開始或結束的拍點只塗半格。 */
		grid-template-columns: 34px repeat(16, minmax(0, 1fr));
		grid-template-rows: auto;
		grid-auto-rows: minmax(24px, auto);
		column-gap: 3px;
		row-gap: 3px;
	}
	.eight {
		grid-column: 1;
		grid-row: 1;
		align-self: center;
		text-align: center;
		font-size: 13px;
		font-weight: 800;
		color: var(--text, #1a2238);
	}
	.cell {
		grid-row: 1;
		justify-content: center;
		min-height: 26px;
		min-width: 24px;
		padding: 0;
		border-radius: 6px;
		border: 1px solid var(--line, #d8dee9);
		background: var(--surface, #fff);
		font-size: 12px;
		font-weight: 700;
		color: var(--muted, #66718a);
	}
	/* 手指：拍的格子至少 32px（格子之間不留縫、外框留白少一點，右邊欄才放得下一排八拍）。 */
	@media (pointer: coarse) {
		.cues {
			padding: 10px 6px;
		}
		.row {
			grid-template-columns: 24px repeat(16, minmax(0, 1fr));
			column-gap: 0;
		}
		.cell {
			min-height: 32px;
		}
	}
	.cell:disabled {
		opacity: 0.3;
		border-style: dashed;
	}
	.cell.sel {
		outline: 2px solid var(--sel, #19b4d8);
		outline-offset: -1px;
		background: var(--sel-soft, #dcf4fa);
		color: var(--text, #1a2238);
	}
	/* 只選到半格（從 & 開始的拍點）：只塗那一半。 */
	.cell.sel.left,
	.slot.sel.left {
		background: linear-gradient(to right, var(--sel-soft, #dcf4fa) 50%, transparent 50%);
	}
	.cell.sel.right,
	.slot.sel.right {
		background: linear-gradient(to left, var(--sel-soft, #dcf4fa) 50%, transparent 50%);
	}
	.cell.sel.left,
	.cell.sel.right {
		outline-style: dashed;
	}
	/* 現在播到的那一拍：數字格底下一條播放頭顏色的粗線。 */
	.cell.now {
		box-shadow: inset 0 -3px 0 var(--now, #f2542d);
	}
	.lane-lbl {
		grid-column: 1;
		align-self: center;
		font-size: 11px;
		font-weight: 700;
		text-align: center;
		color: var(--cue-down);
	}
	.lane-lbl.phase {
		color: var(--text, #1a2238);
	}
	.lane-lbl.step {
		color: var(--cue-step-ink);
	}
	.lane-lbl.motion {
		color: var(--cue-motion-ink);
	}
	.slot {
		border-radius: 4px;
		background: #f2f6fd;
	}
	.slot.step {
		background: #fdf7f0;
	}
	.slot.motion {
		background: #fdf3f8;
	}
	.slot.phase {
		background: #f4f5f7;
	}
	.slot.out {
		background: transparent;
	}
	.slot.sel {
		background: var(--sel-soft, #dcf4fa);
	}
	.item {
		z-index: 1;
		min-width: 0;
		padding: 0 4px;
		border-radius: 6px;
		border: 0;
		font-size: 11px;
		font-weight: 700;
		color: #fff;
		white-space: nowrap;
		overflow: hidden;
	}
	/* 環節：淡底疊在格子上（字和拍點在上面），左右兩條環節顏色的線；亮著的底色深一點、框起來。 */
	.zone {
		z-index: 0;
		pointer-events: none;
		border-left: 2px solid var(--c);
		border-right: 2px solid var(--c);
		border-radius: 4px;
		background: color-mix(in srgb, var(--c) 10%, transparent);
	}
	.zone.cont {
		border-left: 0;
		border-top-left-radius: 0;
		border-bottom-left-radius: 0;
	}
	.zone.more {
		border-right: 0;
		border-top-right-radius: 0;
		border-bottom-right-radius: 0;
	}
	.item.phase,
	.word.phase {
		background: var(--c);
		color: #fff;
	}
	.item.down,
	.word.down {
		background: var(--cue-down);
		color: #fff;
	}
	.item.up,
	.word.up {
		background: var(--cue-up);
		color: #fff;
	}
	/* 步驟：淡橘底、橘框、左邊粗線，像一個括號。 */
	.item.step {
		background: var(--cue-step-bg);
		border: 1px solid var(--cue-step-line);
		border-left-width: 4px;
		color: var(--cue-step-ink);
	}
	/* 手位：一拍的粉紅小牌子；字比一拍寬時撐開蓋到右邊（最多三格），跟泳道的手位一樣。 */
	.item.motion {
		justify-self: start;
		width: max-content;
		min-width: calc(100% - 2px);
		max-width: calc(300% + 4px);
		margin: 1px;
		padding: 0 2px;
		border-radius: 8px;
		border: 1px solid var(--cue-motion-line);
		background: var(--cue-motion-bg);
		color: var(--cue-motion-ink);
		font-size: 10px;
		justify-content: center;
	}
	/* 最後一格的往左撐，不超出格子。 */
	.item.motion.end {
		justify-self: end;
	}
	/* 給誰寫在字下面。 */
	.item:has(.who) {
		flex-direction: column;
		gap: 0;
		line-height: 1.15;
		padding-block: 2px;
	}
	.who {
		font-size: 9px;
		font-weight: 600;
	}
	.item.cont {
		border-top-left-radius: 0;
		border-bottom-left-radius: 0;
	}
	.item.more {
		border-top-right-radius: 0;
		border-bottom-right-radius: 0;
	}
	.pm {
		width: 28px;
		height: 28px;
		padding: 0;
		justify-content: center;
		font-size: 14px;
	}
	.pop-row {
		display: grid;
		grid-template-columns: 30px minmax(0, 1fr) auto;
		gap: 6px;
		align-items: center;
		padding: 5px 6px;
		border-radius: 8px;
		border-left: 4px solid var(--cue-down);
		background: #f6f9ff;
	}
	.pop-row.step {
		border-left-color: var(--cue-step-line);
		background: #fffaf4;
	}
	.pop-row.motion {
		border-left-color: var(--cue-motion-line);
		background: #fff7fb;
	}
	.lbl {
		font-size: 11px;
		font-weight: 700;
		color: var(--cue-down);
	}
	.pop-row.step .lbl {
		color: var(--cue-step-ink);
	}
	.pop-row.phase {
		border-left-color: var(--text, #1a2238);
		background: #f6f7f9;
	}
	.pop-row.phase .lbl {
		color: var(--text, #1a2238);
	}
	/* 口號段點選的環節。 */
	.word.phase[aria-pressed='true'] {
		outline: 2px solid var(--sel, #19b4d8);
		outline-offset: 2px;
	}
	.clear:disabled {
		opacity: 0.4;
	}
	.kind {
		min-height: 26px;
		font-size: 12px;
	}
	/* 改環節：在環節列下面另起一行，跟按鈕那一欄對齊。 */
	.edit {
		grid-column: 2 / -1;
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		align-items: center;
	}
	.chip {
		position: relative;
		width: 22px;
		height: 22px;
		border-radius: 5px;
		background: var(--c);
		cursor: pointer;
	}
	.chip select {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		margin: 0;
		padding: 0;
		opacity: 0;
		cursor: pointer;
	}
	.chip:has(select:focus-visible) {
		outline: 2px solid var(--sel, #19b4d8);
		outline-offset: 2px;
	}
	.pop-row.motion .lbl {
		color: var(--cue-motion-ink);
	}
	.own {
		display: inline-flex;
		gap: 4px;
	}
	.custom {
		width: 9em;
		min-height: 26px;
		padding: 2px 8px;
		border-radius: 999px;
		border: 1px solid var(--line, #d8dee9);
		font-size: 13px;
	}
	.words {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.word {
		min-height: 26px;
		padding: 3px 10px;
		border-radius: 999px;
		border: 0;
		font-size: 12px;
		font-weight: 700;
	}
	.clear {
		min-height: 24px;
		padding: 3px 8px;
		border-radius: 6px;
		font-size: 11px;
		color: var(--danger, #c8372d);
		background: transparent;
		border: 1px solid currentColor;
		white-space: nowrap;
	}
	.hint {
		font-size: 12px;
		color: var(--muted, #66718a);
	}
	/* 拍點小窗疊在格子上面，所以格子框要當它的定位基準。 */
	.sheet-wrap {
		position: relative;
	}
	/* 拍點小窗：白底、陰影、一個小尖角指著選的拍。 */
	.pop {
		/* 開在最上層（popover）：蓋掉瀏覽器給 popover 的置中、捲軸、顏色 */
		position: fixed;
		inset: auto;
		margin: 0;
		overflow: visible;
		color: inherit;
		display: grid;
		gap: 6px;
		padding: 8px;
		border-radius: 12px;
		border: 1px solid var(--line, #d8dee9);
		background: var(--surface, #fff);
		box-shadow: 0 10px 28px rgba(22, 33, 58, 0.22);
	}
	.pop::before {
		content: '';
		position: absolute;
		top: -7px;
		left: calc(var(--arrow) - 6px);
		width: 12px;
		height: 12px;
		background: inherit;
		border-left: 1px solid var(--line, #d8dee9);
		border-top: 1px solid var(--line, #d8dee9);
		transform: rotate(45deg);
	}
	/* 放在選取上面時，小尖角在下面往下指。 */
	.pop.above::before {
		top: auto;
		bottom: -7px;
		border: 0;
		border-right: 1px solid var(--line, #d8dee9);
		border-bottom: 1px solid var(--line, #d8dee9);
	}
	/* 右邊欄窄的時候「給誰」換到下一行，不擠成直的。 */
	.pop-head {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
	}
	.sel-text {
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.who-sel {
		display: inline-flex;
		gap: 4px;
		align-items: center;
		margin-left: auto;
		white-space: nowrap;
		font-size: 12px;
		color: var(--muted, #66718a);
	}
	.who-sel select {
		min-height: 28px;
		max-width: 9em;
		font-size: 13px;
	}
	.x {
		width: 28px;
		height: 28px;
		padding: 0;
		justify-content: center;
		border: 0;
		background: transparent;
		color: var(--muted, #66718a);
	}
	.error {
		padding: 6px 8px;
		border-radius: 8px;
		background: var(--danger-soft, #fdecea);
		color: var(--danger, #c8372d);
	}
</style>
