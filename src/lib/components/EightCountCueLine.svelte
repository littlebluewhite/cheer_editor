<script lang="ts">
	// 八拍表一列裡、一個動作的拍點那一排：上面一行環節，下面 8 格拍點。八拍表（列印）和檢視模式的「前後八拍」共用。
	import { actionLabel, cueWhy, cueWordWhy, type EightCountCue, type EightCountCueLine, type EightCountPhase } from '#lib/core';
	import { whyText } from '#lib/reason-text.js';

	interface Props {
		/** null：沒有動作，只畫 1–8 的空格（前後八拍裡這一拍照樣有格子亮）。 */
		line: EightCountCueLine | null;
		/** 這一列是第幾個八拍（環節的讀屏名字寫「1-1 到 1-3」）。 */
		eight: number | null;
		/** 播放頭在第幾個半拍（0–15）：那一拍的數字格和正在響的拍點亮。八拍表（列印）不給。 */
		now?: number | null;
		/** 寫動作名字（前後八拍自己寫成按鈕，這裡就不寫）。 */
		named?: boolean;
		/** 畫 1–8 的數字格（前後八拍一列只在最上面畫一次）。 */
		numbers?: boolean;
		/** 沒拍點時畫一條色條，標動作佔第幾格到第幾格（前後八拍用）。 */
		bar?: { from: number; to: number; color: string } | null;
	}

	let { line, eight, now = null, named = true, numbers = true, bar = null }: Props = $props();

	const beat = $derived(now === null ? null : Math.floor(now / 2) + 1);

	const name = $derived(line ? actionLabel(line) : '');
	const cues = $derived(line?.cues ?? []);
	const phases = $derived(line?.phases ?? []);

	/** 「拍子 down 1-6 到 1-7・2 拍」「手位 high V 1-8・1 拍・給上層」。 */
	const cueLabel = (c: EightCountCue) => whyText(cueWhy(c.kind, c.word, c.span, c.who ?? ''));
	const word = (c: EightCountCue) => whyText(cueWordWhy(c.kind, c.word));

	/** 「環節 上法 延伸 1-1 到 1-3」。 */
	function phaseAria(p: EightCountPhase): string {
		const span = p.to > p.from ? `${eight}-${p.from} 到 ${eight}-${p.to}` : `${eight}-${p.from}`;
		return `環節 ${whyText(p.label)} ${span}`;
	}
</script>

<div class="cue-line" role="group" aria-label={line ? `${name} 的拍點` : '這個八拍的拍'}>
	{#if line && named}<span class="cue-name" title={name}>{name}</span>{/if}
	<div class="beats">
		{#if phases.length}
			<div class="phases">
				{#each phases as p, k (k)}
					<span
						class="phase"
						data-phase
						style:grid-column="{p.from} / {p.to + 1}"
						style:grid-row={p.row + 1}
						style:border-top-color={p.color}
						aria-label={phaseAria(p)}>{whyText(p.label)}</span
					>
				{/each}
			</div>
		{/if}
		<div class="cells">
			{#if numbers}
				{#each [1, 2, 3, 4, 5, 6, 7, 8] as n (n)}
					<span class="n" class:lit={n === beat} data-now={n === beat ? '' : undefined} style:grid-column={n}>{n}</span>
				{/each}
			{/if}
			{#if bar && !cues.length}
				<span class="bar" style:grid-column="{bar.from} / {bar.to + 1}" style:background={bar.color}></span>
			{/if}
			{#each cues as c, k (k)}
				<span
					class="cue {c.kind} {c.kind === 'count' ? c.word : ''}"
					class:lit={now !== null && c.start <= now && now < c.end}
					style:grid-column="{c.from} / {c.to + 1}"
					aria-label={cueLabel(c)}
					title={c.who ? `${word(c)}（${whyText(c.who)}）` : word(c)}
					>{#if c.lead}<span class="span">{c.lead}</span>{/if}{#if !c.continued}{word(c)}{#if c.who}<small>{whyText(c.who)}</small>{/if}{/if}</span
				>
			{/each}
		</div>
	</div>
</div>

<style>
	/* 拍點：一排 8 格，字寫在佔的格子裡。黑白印也分得出：拍子實心、步驟左邊粗線、手位圓角虛線小牌子。 */
	.cue-line {
		display: flex;
		gap: 8px;
		align-items: start;
		margin: 2px 0;
	}
	.cue-name {
		flex: 0 0 9em;
		font-size: 12px;
		font-weight: 600;
		padding-top: 2px;
	}
	.beats {
		flex: 1;
		min-width: 0;
	}
	/* 環節：拍點上面一行，左右直線框出範圍、上緣是環節的顏色，寫種類和名字（黑白印靠線和字）。
	   金字塔疊著的往下多一排（第幾排流程核心算好）；這個八拍只有下面那排有東西時，上面那排照樣留高度，同一個環節才每列都在同一排。 */
	.phases {
		display: grid;
		grid-template-columns: repeat(8, 1fr);
		grid-auto-rows: minmax(19px, auto);
		margin-bottom: 2px;
	}
	.phase {
		margin: 0 1px;
		padding: 1px 4px;
		font-size: 11px;
		font-weight: 600;
		line-height: 1.3;
		border: 1.5px solid #16213a;
		border-top-width: 3px;
		border-bottom: none;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		print-color-adjust: exact;
		-webkit-print-color-adjust: exact;
	}
	.cells {
		display: grid;
		grid-template-columns: repeat(8, 1fr);
		grid-auto-flow: row dense;
		gap: 2px 0;
		padding-bottom: 2px;
		border: 1px solid #c9ced8;
		background: linear-gradient(to right, #c9ced8 1px, transparent 1px) 0 0 / 12.5% 100%;
		print-color-adjust: exact;
		-webkit-print-color-adjust: exact;
	}
	.n {
		grid-row: 1;
		padding: 0 4px;
		font-size: 10px;
		color: #7a8296;
		border-bottom: 1px solid #c9ced8;
	}
	/* 播放頭在的那一拍（檢視模式）：數字格塗滿播放頭的顏色（深一點，白字對比才夠 4.5:1），蓋到那格的拍點外面一圈 */
	.n.lit {
		background: #c4401f;
		color: #fff;
		font-weight: 700;
	}
	.cue.lit {
		box-shadow: 0 0 0 2px var(--now);
	}
	/* 沒拍點的動作：佔的格子一條細色條 */
	.bar {
		height: 6px;
		margin: 3px 2px 1px;
		border-radius: 3px;
	}
	.cue {
		margin: 0 2px;
		padding: 1px 4px;
		font-size: 12px;
		line-height: 1.3;
		border-radius: 2px;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.cue small {
		margin-left: 4px;
		font-size: 10px;
	}
	/* 從 & 開始的拍點：格子只能整格，拍寫在字前面 */
	.cue .span {
		margin-right: 4px;
		font-size: 10px;
		font-weight: 400;
	}
	.cue.down {
		background: var(--cue-down);
		color: #fff;
		font-weight: 600;
	}
	.cue.up {
		background: var(--cue-up);
		color: #fff;
		font-weight: 600;
	}
	.cue.step {
		background: var(--cue-step-bg);
		border: 1px solid var(--cue-step-line);
		border-left-width: 4px;
		color: var(--cue-step-ink);
	}
	/* 手位靠左、跟著字寬，最寬到自己那一拍（左右各留 2px），再長就「…」，不蓋到下一拍。 */
	.cue.motion {
		justify-self: start;
		max-width: calc(100% - 4px);
		background: var(--cue-motion-bg);
		border: 1px dashed var(--cue-motion-line);
		border-radius: 999px;
		color: var(--cue-motion-ink);
	}
	/* 長拍點、環節名字換行，不用「...」截掉：印出來和手機、iPad（沒有滑鼠，移上去看 title 這招不能用，N35） */
	@media print, (hover: none) {
		.cue,
		.phase {
			white-space: normal;
			overflow: visible;
			text-overflow: clip;
			overflow-wrap: anywhere;
		}
	}
	@media print {
		.cue-line {
			break-inside: avoid;
		}
	}
</style>
