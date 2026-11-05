<script lang="ts" module>
	/** 「技巧·Lib」；名稱跟大類一樣（「舞蹈」）只寫一次。八拍表的動作和拍點那一排都這樣寫。 */
	export function actionTitle(categoryLabel: string, name: string): string {
		return name && name !== categoryLabel ? `${categoryLabel}·${name}` : categoryLabel;
	}
</script>

<script lang="ts">
	// 八拍表一列裡、一個動作的拍點那一排：上面一行環節，下面 8 格拍點。八拍表（列印）和手機的「八拍表這一列」共用。
	import { cueText, type EightCountCue, type EightCountCueLine, type EightCountPhase } from '#lib/core';

	interface Props {
		line: EightCountCueLine;
		/** 這一列是第幾個八拍（環節的讀屏名字寫「1-1 到 1-3」）。 */
		eight: number | null;
	}

	let { line, eight }: Props = $props();

	const name = $derived(actionTitle(line.categoryLabel, line.name));

	/** 「拍子 down 1-6 到 1-7・2 拍」「手位 high V 1-8・1 拍・給上層」。 */
	const cueLabel = (c: EightCountCue) => cueText(c.kind, c.word, c.span, c.who ?? '');

	/** 「環節 上法 延伸 1-1 到 1-3」。 */
	function phaseAria(p: EightCountPhase): string {
		const span = p.to > p.from ? `${eight}-${p.from} 到 ${eight}-${p.to}` : `${eight}-${p.from}`;
		return `環節 ${p.label} ${span}`;
	}
</script>

<div class="cue-line" role="group" aria-label="{name} 的拍點">
	<span class="cue-name">{name}</span>
	<div class="beats">
		{#if line.phases.length}
			<div class="phases">
				{#each line.phases as p, k (k)}
					<span
						class="phase"
						data-phase
						style:grid-column="{p.from} / {p.to + 1}"
						style:border-top-color={p.color}
						aria-label={phaseAria(p)}>{p.label}</span
					>
				{/each}
			</div>
		{/if}
		<div class="cells">
			{#each [1, 2, 3, 4, 5, 6, 7, 8] as n (n)}
				<span class="n" style:grid-column={n}>{n}</span>
			{/each}
			{#each line.cues as c, k (k)}
				<span
					class="cue {c.kind} {c.kind === 'count' ? c.word : ''}"
					style:grid-column="{c.from} / {c.to + 1}"
					aria-label={cueLabel(c)}
					title={c.who ? `${c.word}（${c.who}）` : c.word}
					>{#if c.lead}<span class="span">{c.lead}</span>{/if}{#if !c.continued}{c.word}{#if c.who}<small>{c.who}</small>{/if}{/if}</span
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
	/* 環節：拍點上面一行，左右直線框出範圍、上緣是環節的顏色，寫種類和名字（黑白印靠線和字）。 */
	.phases {
		display: grid;
		grid-template-columns: repeat(8, 1fr);
		margin-bottom: 2px;
	}
	.phase {
		grid-row: 1;
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
	@media print {
		/* 長拍點、環節名字換行，不用「...」截掉 */
		.cue,
		.phase {
			white-space: normal;
			overflow: visible;
			text-overflow: clip;
			overflow-wrap: anywhere;
		}
		.cue-line {
			break-inside: avoid;
		}
	}
</style>
