<script lang="ts">
	// 練習畫面的「總表」頁：一眼看全部動作、每組、每個環節的成功率，找出最弱的地方。
	// 每個有記成功率、有環節的動作一塊，照流程順序：一列一個環節，最後一列「整次」；
	// 一欄一組（騰翻、跳躍一欄一個人），最後一欄「合計」。
	// 格子大字是選的比例（成功率或完成率；整次一律是整次成功率），小字是次數；顏色照 rateBand，數字一定寫出來。
	// 點一組的格子，右邊滑出這組、這個環節每天的每一次（全上的那幾次有標出來）。
	// 「＋ 記一次全上」打開記全上的表（RunThroughSheet），存好或取消再回到總表。
	import {
		actionLabel,
		cellDetail,
		completionPercent,
		percent,
		periodRange,
		phaseLabel,
		rateBand,
		rateTable,
		recordableActions,
		successPercent,
		type Period,
		type PracticeKind,
		type RateCounts,
		type Tally,
		type Flow
	} from '#lib/core';
	import { actionColor } from './category-colors.js';
	import RunThroughSheet from './RunThroughSheet.svelte';

	interface Props {
		flow: Flow;
		/** 選的日期（YYYY-MM-DD），跟記錄頁共用；期間從這天往回算。 */
		date: string;
		/** 記了一次全上：不算復原的一步。 */
		onrecord: (flow: Flow) => void;
	}

	let { flow, date, onrecord }: Props = $props();

	/** 記全上的表打開著。 */
	let recording = $state(false);

	const PERIODS: { key: Period; label: string }[] = [
		{ key: 'today', label: '今天' },
		{ key: 'week', label: '最近 7 天' },
		{ key: 'all', label: '全部' }
	];
	const PRACTICES: { key: PracticeKind | 'all'; label: string }[] = [
		{ key: 'all', label: '全部' },
		{ key: 'runThrough', label: '只看全上' },
		{ key: 'drill', label: '只看分段練' }
	];
	const RATES = [
		{ key: 'success', label: '成功率' },
		{ key: 'completion', label: '完成率' }
	] as const;

	let period = $state<Period>('today');
	let practice = $state<PracticeKind | 'all'>('all');
	let rate = $state<(typeof RATES)[number]['key']>('success');

	const filter = $derived({ ...periodRange(date, period), practice: practice === 'all' ? undefined : practice });
	const blocks = $derived(recordableActions(flow).map((action) => ({ action, table: rateTable(flow, action, filter) })));

	/** 一格：大字的 %（沒有紀錄是 null）和次數。 */
	function phaseCell(t: Tally): { pct: number | null; count: number } {
		return { pct: rate === 'success' ? successPercent(t) : completionPercent(t), count: t.marked };
	}
	const wholeCell = (c: RateCounts) => ({ pct: percent(c.whole.clean, c.whole.whole), count: c.whole.whole });
	const cellText = (c: { pct: number | null; count: number }) => (c.pct === null ? '—' : `${c.pct}% ${c.count} 次`);

	/** 打開的明細：哪個動作、誰、哪個環節。 */
	let open = $state<{ actionId: string; who: number | string; phaseId: string } | null>(null);
	/** 明細的內容；動作、組或環節不在了就關掉。 */
	const detail = $derived.by(() => {
		if (!open) return null;
		const { actionId, who, phaseId } = open;
		const block = blocks.find((b) => b.action.id === actionId);
		const phase = block?.action.successRate?.phases.find((p) => p.id === phaseId);
		const column = block?.table.columns.find((c) => c.who === who);
		if (!block || !phase || !column) return null;
		return { title: `${column.name} ${phaseLabel(phase)}`, days: cellDetail(block.action, who, phaseId) };
	});
</script>

{#snippet number(c: { pct: number | null; count: number })}
	{#if c.pct === null}—{:else}<strong>{c.pct}%</strong> <small>{c.count} 次</small>{/if}
{/snippet}

<div class="summary">
	{#if recording}
		<RunThroughSheet {flow} {date} {onrecord} onclose={() => (recording = false)} />
	{:else}
		<div class="filters">
			<div class="seg" role="group" aria-label="期間">
				<span>期間</span>
				{#each PERIODS as p (p.key)}
					<button type="button" aria-pressed={period === p.key} onclick={() => (period = p.key)}>{p.label}</button>
				{/each}
			</div>
			<div class="seg" role="group" aria-label="練法">
				<span>練法</span>
				{#each PRACTICES as p (p.key)}
					<button type="button" aria-pressed={practice === p.key} onclick={() => (practice = p.key)}>{p.label}</button>
				{/each}
			</div>
			<div class="seg" role="group" aria-label="大字看">
				<span>大字看</span>
				{#each RATES as r (r.key)}
					<button type="button" aria-pressed={rate === r.key} onclick={() => (rate = r.key)}>{r.label}</button>
				{/each}
			</div>
			<button type="button" class="primary" onclick={() => ((recording = true), (open = null))}>＋ 記一次全上</button>
		</div>

		{#each blocks as { action, table } (action.id)}
			{@const phases = action.successRate?.phases ?? []}
			{@const wholeTotal = wholeCell(table.total)}
			<section class="block" aria-label={actionLabel(action)}>
				<h3><span class="swatch" style:--c={actionColor(action)}></span>{actionLabel(action)}</h3>
				<div class="scroll">
					<table>
						<thead>
							<tr>
								<th scope="col">環節</th>
								{#each table.columns as col (col.who)}
									<th scope="col">{col.name}</th>
								{/each}
								<th scope="col">合計</th>
							</tr>
						</thead>
						<tbody>
							{#each phases as p (p.id)}
								{@const total = phaseCell(table.total.phases[p.id])}
								<tr>
									<th scope="row">{phaseLabel(p)}</th>
									{#each table.columns as col (col.who)}
										{@const c = phaseCell(col.phases[p.id])}
										<td class={rateBand(c.pct)}>
											<button
												type="button"
												class="cell"
												aria-label="{col.name} {phaseLabel(p)} {cellText(c)}"
												aria-pressed={open?.actionId === action.id && open.who === col.who && open.phaseId === p.id}
												onclick={() => (open = { actionId: action.id, who: col.who, phaseId: p.id })}
												>{@render number(c)}</button
											>
										</td>
									{/each}
									<td class="total {rateBand(total.pct) ?? ''}">{@render number(total)}</td>
								</tr>
							{/each}
							<tr class="whole">
								<th scope="row">整次</th>
								{#each table.columns as col (col.who)}
									{@const c = wholeCell(col)}
									<td class={rateBand(c.pct)}>{@render number(c)}</td>
								{/each}
								<td class="total {rateBand(wholeTotal.pct) ?? ''}">{@render number(wholeTotal)}</td>
							</tr>
						</tbody>
					</table>
				</div>
			</section>
		{:else}
			<p class="empty">還沒有要記的動作：到編排的動作表單打開「記成功率」，而且至少要有一個環節。</p>
		{/each}
	{/if}
</div>

{#if detail}
	<aside class="detail" aria-label="明細">
		<header>
			<h3>{detail.title}</h3>
			<button type="button" onclick={() => (open = null)}>關掉</button>
		</header>
		<ol class="days">
			{#each detail.days as day (day.date)}
				<li>
					<time datetime={day.date}>{day.date}</time>
					<ol class="marks">
						{#each day.marks as m, i (i)}
							<li class:run={m.runThrough}>{m.mark}{#if m.runThrough}<small>全上</small>{/if}</li>
						{/each}
					</ol>
				</li>
			{:else}
				<li class="empty">還沒有紀錄</li>
			{/each}
		</ol>
	</aside>
{/if}

<style>
	.summary {
		display: grid;
		gap: 16px;
	}
	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 16px;
	}
	.seg {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.seg span {
		color: var(--muted);
		font-size: 13px;
		margin-right: 4px;
	}
	.seg button {
		padding: 4px 10px;
		font-size: 13px;
	}
	.seg button[aria-pressed='true'] {
		background: var(--ink);
		border-color: var(--ink);
		color: #fff;
	}
	h3 {
		margin: 0 0 8px;
		font-size: 15px;
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.swatch {
		width: 10px;
		height: 10px;
		border-radius: 3px;
		background: var(--c);
	}
	.scroll {
		overflow-x: auto;
	}
	table {
		border-collapse: collapse;
		background: var(--surface);
		font-variant-numeric: tabular-nums;
	}
	th,
	td {
		border: 1px solid var(--line);
		padding: 6px 10px;
		text-align: center;
		white-space: nowrap;
	}
	td:has(.cell) {
		padding: 0;
	}
	thead th {
		background: var(--surface-2);
		font-size: 13px;
	}
	th[scope='row'] {
		text-align: left;
		font-weight: 600;
	}
	.cell {
		width: 100%;
		min-width: 72px;
		padding: 6px 10px;
		border: 0;
		border-radius: 0;
		background: transparent;
		color: inherit;
	}
	.cell[aria-pressed='true'] {
		box-shadow: inset 0 0 0 3px var(--sel);
	}
	td strong {
		font-size: 18px;
	}
	td small {
		color: inherit;
		opacity: 0.85;
		font-size: 11px;
	}
	/* 顏色：淡底配深色字，對比夠（都在 7:1 以上）；數字一定寫出來，不只靠顏色。 */
	.good {
		background: #dcf3e3;
		color: #14532d;
	}
	.fair {
		background: #fdf0c4;
		color: #6b4400;
	}
	.poor {
		background: #fde0dd;
		color: #8a1c13;
	}
	td.total {
		border-left: 2px solid var(--ink-3);
	}
	tr.whole > * {
		border-top: 2px solid var(--ink-3);
	}
	.empty {
		color: var(--muted);
	}
	.detail {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		z-index: 20;
		width: min(340px, 90vw);
		overflow-y: auto;
		padding: 16px;
		background: var(--surface);
		border-left: 1px solid var(--line);
		box-shadow: var(--shadow-pop);
		animation: slide-in 0.18s ease-out;
	}
	@keyframes slide-in {
		from {
			transform: translateX(100%);
		}
	}
	.detail header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 12px;
	}
	.detail h3 {
		margin: 0;
	}
	.days {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 10px;
	}
	.days > li {
		display: grid;
		gap: 4px;
	}
	time {
		font-weight: 600;
		font-size: 13px;
	}
	.marks {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.marks li {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		min-width: 28px;
		justify-content: center;
		padding: 2px 6px;
		border: 1px solid var(--line);
		border-radius: 6px;
		font-size: 16px;
	}
	.marks li.run {
		border-color: var(--ink);
		background: var(--surface-2);
	}
	.marks small {
		font-size: 10px;
		color: var(--muted);
	}
</style>
