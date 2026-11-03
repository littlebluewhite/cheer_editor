<script lang="ts">
	// 拍點格子：像紙本八拍表，動作碰到的每個八拍一排 8 個數字格，下面是拍子、步驟、手位三條。
	// 點一格選一拍，用 ＋、－ 多選或少選；點 down、up 就放滿選到的拍，選取跳到下一拍。
	// 步驟放滿選到的拍，手位只放在選到的第一拍；兩條都可以自己打字，這支流程用過的字變成按鈕。
	// 格子對齊音樂的整拍（動作從 & 開始也一樣），動作外面的格子變淡、不能選。
	// 規則（在動作裡、整數拍、只有 down／up）都交給流程核心；被擋就顯示原因。
	import { untrack } from 'svelte';
	import {
		COUNT_WORDS,
		MOTION_WORDS,
		STEP_WORDS,
		atText,
		clearCues,
		placeCue,
		usedWords,
		type Action,
		type CommandResult,
		type Cue,
		type CueKind,
		type Flow
	} from '#lib/core';

	interface Props {
		flow: Flow;
		action: Action;
		onchange: (flow: Flow) => void;
	}

	let { flow, action, onchange }: Props = $props();

	/** 一拍幾個半拍；一個八拍幾個半拍。 */
	const BEAT = 2;
	const EIGHT = 16;
	const cols = Array.from({ length: 8 }, (_, c) => c);
	/** 三條由上往下；row 是在每個八拍裡的第幾列（第 1 列是數字格）。 */
	const LANES: { kind: CueKind; label: string; row: number }[] = [
		{ kind: 'count', label: '拍子', row: 2 },
		{ kind: 'step', label: '步驟', row: 3 },
		{ kind: 'motion', label: '手位', row: 4 }
	];

	const segment = $derived(flow.segments.find((s) => s.id === action.segmentId) ?? null);
	/** 步驟、手位的按鈕：內建的字，加上這支流程用過的字（打開別人的流程檔也看得到）。 */
	const wordRows = $derived.by(() => {
		const used = usedWords(flow);
		return [
			{ kind: 'step' as const, label: '步驟', words: [...STEP_WORDS, ...used.step], tip: '自己打，例：抬腳' },
			{ kind: 'motion' as const, label: '手位', words: [...MOTION_WORDS, ...used.motion], tip: '自己打，例：拳頭' }
		];
	});
	/** 自己打的字，步驟和手位各一格。 */
	let custom = $state({ step: '', motion: '' });
	/** 動作碰到的八拍（從 0 起）。 */
	const eights = $derived.by(() => {
		const first = Math.floor(action.start / EIGHT);
		const last = Math.floor((action.start + action.length - 1) / EIGHT);
		return Array.from({ length: last - first + 1 }, (_, i) => first + i);
	});
	/** 動作裡第一格（整拍）從動作開始算第幾個半拍；動作從 & 開始時是 1。 */
	const firstCell = $derived(action.start % BEAT);

	/** 選到的拍：從 from 那一格到 to 那一格（都是格子開頭、從動作開始算的半拍）。 */
	let sel = $state({ from: 0, to: 0 });
	let error = $state('');

	/** 這一格（從 at 開始的一拍）整個在動作裡。 */
	const inAction = (at: number) => at >= 0 && at + BEAT <= action.length;
	const hasCells = $derived(inAction(firstCell));
	const isSel = (at: number) => at >= sel.from && at <= sel.to;
	const selLen = $derived(sel.to - sel.from + BEAT);

	// 只在值變了才通知（action 每次改流程都是新物件）。
	const actionId = $derived(action.id);
	const actionLength = $derived(action.length);

	// 換動作就從第一拍開始。
	$effect(() => {
		void actionId;
		untrack(() => {
			error = '';
			sel = { from: firstCell, to: firstCell };
		});
	});

	// 動作移動或變短、選取跑到外面或不在整拍上時，也從第一拍開始。
	$effect(() => {
		const first = firstCell;
		void actionLength;
		untrack(() => {
			if (!inAction(sel.from) || !inAction(sel.to) || (sel.from - first) % BEAT !== 0) {
				sel = { from: first, to: first };
			}
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

	function apply(r: CommandResult): boolean {
		if (r.kind !== 'ok') {
			error = r.kind === 'blocked' ? r.message : '';
			return false;
		}
		error = '';
		onchange(r.flow);
		return true;
	}

	const selectOne = (at: number) => (sel = { from: at, to: at });

	function grow(step: number) {
		const to = sel.to + step * BEAT;
		if (to >= sel.from && inAction(to)) sel = { from: sel.from, to };
	}

	/** 拍子、步驟放滿選到的拍；手位只放在第一拍。拍子放完選取跳到下一拍。 */
	function place(kind: CueKind, word: string): boolean {
		const len = kind === 'motion' ? BEAT : selLen;
		const placed = apply(placeCue(flow, action.id, { kind, at: sel.from, len, word }));
		if (placed && kind === 'count' && inAction(sel.to + BEAT)) selectOne(sel.to + BEAT);
		return placed;
	}

	function addCustom(kind: 'step' | 'motion') {
		const word = custom[kind].trim();
		if (word && place(kind, word)) custom[kind] = '';
	}

	/** Enter 也能加入；中文輸入法還在選字時按的 Enter 不算（Safari 選字時 keyCode 是 229）。 */
	function onCustomKey(e: KeyboardEvent, kind: 'step' | 'motion') {
		if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
		e.preventDefault();
		addCustom(kind);
	}

	function clear(kind: CueKind) {
		apply(clearCues(flow, action.id, kind, sel.from, sel.to + BEAT));
	}

	/** 點一個拍點：選回它佔的那幾格（動作被拖半拍時，取碰到的整拍格，不超出動作）。 */
	function pick(c: Cue) {
		const cellOf = (at: number) => at - ((((action.start + at) % BEAT) + BEAT) % BEAT);
		const from = Math.max(cellOf(c.at), firstCell);
		let to = cellOf(c.at + c.len - 1);
		while (to > from && !inAction(to)) to -= BEAT;
		if (inAction(from)) sel = { from, to };
	}

	/** 某一種的每個拍點在某一個八拍裡的那一段：從第 c0 格到第 c1 格（不含 c1）。 */
	function pieces(e: number, kind: CueKind) {
		const lo = e * EIGHT;
		const hi = lo + EIGHT;
		return (action.cues ?? []).filter((c) => c.kind === kind).flatMap((cue) => {
			const s = action.start + cue.at;
			const end = s + cue.len;
			if (end <= lo || s >= hi) return [];
			const c0 = Math.floor((Math.max(s, lo) - lo) / BEAT);
			const c1 = Math.ceil((Math.min(end, hi) - lo) / BEAT);
			return [{ cue, c0, c1, first: s >= lo, last: end <= hi }];
		});
	}
</script>

<div class="cues" role="group" aria-label="拍點">
	<span class="cap">拍點</span>
	{#if segment?.kind !== 'music'}
		<p class="muted">口號段不數拍，不能放拍點</p>
	{:else if !hasCells}
		<p class="muted">動作不到一拍，不能放拍點</p>
	{:else}
		<div class="sheet">
			{#each eights as e (e)}
				<div class="row">
					<span class="eight" aria-hidden="true">{e + 1}</span>
					{#each LANES as lane (lane.kind)}
						<span class="lane-lbl {lane.kind}" style:grid-row={lane.row}>{lane.label}</span>
					{/each}
					{#each cols as c (c)}
						{@const at = (e * 8 + c) * BEAT - action.start}
						<button
							type="button"
							class="cell"
							style:grid-column={c + 2}
							class:sel={inAction(at) && isSel(at)}
							aria-label="{e + 1}-{c + 1}"
							aria-pressed={inAction(at) && isSel(at)}
							disabled={!inAction(at)}
							onclick={() => selectOne(at)}>{c + 1}</button
						>
						{#each LANES as lane (lane.kind)}
							<span
								class="slot {lane.kind}"
								class:out={!inAction(at)}
								class:sel={inAction(at) && isSel(at)}
								style:grid-column={c + 2}
								style:grid-row={lane.row}
							></span>
						{/each}
					{/each}
					{#each LANES as lane (lane.kind)}
						{#each pieces(e, lane.kind) as p}
							<button
								type="button"
								class="item {lane.kind} {lane.kind === 'count' ? p.cue.word : ''}"
								class:cont={!p.first}
								class:more={!p.last}
								style:grid-column="{p.c0 + 2} / {p.c1 + 2}"
								style:grid-row={lane.row}
								aria-label="{lane.label} {p.cue.word} {spanText(p.cue.at, p.cue.len)}"
								aria-hidden={!p.first || undefined}
								tabindex={p.first ? undefined : -1}
								onclick={() => pick(p.cue)}>{p.first ? p.cue.word : `…${p.cue.word}`}</button
							>
						{/each}
					{/each}
				</div>
			{/each}
		</div>

		<div class="selbar">
			<span>選了 {spanText(sel.from, selLen)}</span>
			<button type="button" class="pm" aria-label="少選一拍" onclick={() => grow(-1)}>－</button>
			<button type="button" class="pm" aria-label="多選一拍" onclick={() => grow(1)}>＋</button>
		</div>

		<div class="kindrow count" role="group" aria-label="拍子">
			<span class="lbl">拍子</span>
			<div class="words">
				{#each COUNT_WORDS as w (w)}
					<button type="button" class="word {w}" onclick={() => place('count', w)}>{w}</button>
				{/each}
			</div>
			<button type="button" class="clear" onclick={() => clear('count')}>清掉拍子</button>
		</div>

		{#each wordRows as row (row.kind)}
			<div class="kindrow {row.kind}" role="group" aria-label={row.label}>
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
				<button type="button" class="clear" onclick={() => clear(row.kind)}>清掉{row.label}</button>
			</div>
		{/each}
	{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</div>

<style>
	.cues {
		display: grid;
		gap: 8px;
		background: var(--surface, #fff);
		border: 1px solid var(--line-soft, #e8ecf3);
		border-radius: 10px;
		padding: 10px;
		/* down 藍、up 綠：實心，白字（對比 4.5 以上）。 */
		--down: #1f5fbf;
		--up: #2b7a2f;
		/* 步驟：橘色框加左邊粗線；手位：粉紅小牌子。字用深色（對比 4.5 以上）。 */
		--step-bg: #fff1e2;
		--step-line: #e08a2e;
		--step-ink: #8a4a12;
		--motion-bg: #ffe3f0;
		--motion-line: #d6589a;
		--motion-ink: #9c1d5c;
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
	}
	.row {
		display: grid;
		grid-template-columns: 34px repeat(8, minmax(0, 1fr));
		grid-template-rows: auto repeat(3, 24px);
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
	.lane-lbl {
		grid-column: 1;
		align-self: center;
		font-size: 11px;
		font-weight: 700;
		text-align: center;
		color: var(--down);
	}
	.lane-lbl.step {
		color: var(--step-ink);
	}
	.lane-lbl.motion {
		color: var(--motion-ink);
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
	.item.down,
	.word.down {
		background: var(--down);
		color: #fff;
	}
	.item.up,
	.word.up {
		background: var(--up);
		color: #fff;
	}
	/* 步驟：淡橘底、橘框、左邊粗線，像一個括號。 */
	.item.step {
		background: var(--step-bg);
		border: 1px solid var(--step-line);
		border-left-width: 4px;
		color: var(--step-ink);
	}
	/* 手位：一拍的粉紅小牌子。 */
	.item.motion {
		margin: 1px;
		padding: 0 2px;
		border-radius: 8px;
		border: 1px solid var(--motion-line);
		background: var(--motion-bg);
		color: var(--motion-ink);
		font-size: 10px;
		justify-content: center;
	}
	.item.cont {
		border-top-left-radius: 0;
		border-bottom-left-radius: 0;
	}
	.item.more {
		border-top-right-radius: 0;
		border-bottom-right-radius: 0;
	}
	.selbar {
		display: flex;
		gap: 6px;
		align-items: center;
		padding-top: 6px;
		border-top: 1px solid var(--line-soft, #e8ecf3);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.selbar span {
		margin-right: auto;
	}
	.pm {
		width: 28px;
		height: 28px;
		padding: 0;
		justify-content: center;
		font-size: 14px;
	}
	.kindrow {
		display: grid;
		grid-template-columns: 34px minmax(0, 1fr) auto;
		gap: 6px;
		align-items: center;
		padding: 6px 6px 6px 8px;
		border-radius: 8px;
		border-left: 4px solid var(--down);
		background: #f6f9ff;
	}
	.kindrow.step {
		border-left-color: var(--step-line);
		background: #fffaf4;
	}
	.kindrow.motion {
		border-left-color: var(--motion-line);
		background: #fff7fb;
	}
	.lbl {
		font-size: 11px;
		font-weight: 700;
		color: var(--down);
	}
	.kindrow.step .lbl {
		color: var(--step-ink);
	}
	.kindrow.motion .lbl {
		color: var(--motion-ink);
	}
	.own {
		display: inline-flex;
		gap: 4px;
	}
	.custom {
		width: 9em;
		min-height: 28px;
		padding: 2px 8px;
		border-radius: 999px;
		border: 1px solid var(--line, #d8dee9);
		font-size: 13px;
	}
	.words {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.word {
		min-height: 28px;
		padding: 4px 16px;
		border-radius: 999px;
		border: 0;
		font-size: 13px;
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
	.error {
		padding: 6px 8px;
		border-radius: 8px;
		background: var(--danger-soft, #fdecea);
		color: var(--danger, #c8372d);
	}
</style>
