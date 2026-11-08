<script lang="ts">
	// 練習畫面的「總表」頁：一眼看全部動作、每組、每個環節的成功率，找出最弱的地方。
	// 每個有記成功率、有環節的動作一塊，照流程順序：一列一個環節，最後一列「整次」（只有一個環節時跟那一列一樣，不放）；
	// 一欄一組（騰翻、跳躍一欄一個人；組的名字下面小字列出全組），最後一欄「合計」。
	// 格子大字是選的比例（成功率或完成率；整次一律是整次成功率），小字是次數；顏色照 rateBand（篩選下面有圖例），數字一定寫出來。
	// 點一組的格子（整次的也可以），右邊滑出這組、這個環節每天的每一次（全上的那幾次有標出來），篩選和格子一樣。
	// 最上面一排（RunThroughBar，跟記錄頁一樣）：「＋ 記一次全上」打開記全上的表（RunThroughSheet），存好或取消再回到總表；
	// 「刪掉上一次全上」整次拿掉這天最後存的全上（記完才發現記錯，不用切回記錄頁）。
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
		type Tally
	} from '#lib/core';
	import { getEditorSession } from '#lib/editor-session.svelte.js';
	import { localDate } from '#lib/local-date.js';
	import { actionColor } from './category-colors';
	import RunThroughSheet from './RunThroughSheet.svelte';
	import RunThroughBar from './RunThroughBar.svelte';

	interface Props {
		/** 選的日期（YYYY-MM-DD），跟記錄頁共用；期間從這天往回算。 */
		date: string;
	}

	let { date }: Props = $props();

	const session = getEditorSession();
	const flow = $derived(session.flow!);

	/** 記全上的表打開著。 */
	let recording = $state(false);

	function closeSheet(done: boolean) {
		recording = false;
		if (done) session.notice = '已記下這次全上';
	}

	/** YYYY-MM-DD 寫成「11/4」。 */
	function monthDay(day: string): string {
		const [, m, d] = day.split('-').map(Number);
		return `${m}/${d}`;
	}
	/** 選的那天寫成「11/4」；是今天才加「今天」（日期是右上角選的，不一定是今天）。 */
	const dayLabel = $derived(date === localDate() ? `今天 ${monthDay(date)}` : monthDay(date));
	/** 最近 7 天寫出是哪幾天，例：最近 7 天（10/29–11/4）。 */
	const weekLabel = $derived.by(() => {
		const { from, to } = periodRange(date, 'week');
		return `最近 7 天（${monthDay(from!)}–${monthDay(to!)}）`;
	});
	const PERIODS = $derived<{ key: Period; label: string }[]>([
		{ key: 'today', label: dayLabel },
		{ key: 'week', label: weekLabel },
		{ key: 'all', label: '全部' }
	]);
	const PRACTICES: { key: PracticeKind | 'all'; label: string }[] = [
		{ key: 'all', label: '全部' },
		{ key: 'runThrough', label: '只看全上' },
		{ key: 'drill', label: '只看分段練' }
	];
	const RATES = [
		{ key: 'success', label: '成功率' },
		{ key: 'completion', label: '完成率' }
	] as const;

	/** 篩選放在 session：切到記錄、編排再回來還是它。 */
	const picks = $derived(session.view.summary);
	const filter = $derived({ ...periodRange(date, picks.period), practice: picks.practice === 'all' ? undefined : picks.practice });
	const blocks = $derived(recordableActions(flow).map((action) => ({ action, table: rateTable(flow, action, filter) })));

	/** 一格：大字的 %（沒有紀錄是 null）和次數。 */
	function phaseCell(t: Tally): { pct: number | null; count: number } {
		return { pct: picks.rate === 'success' ? successPercent(t) : completionPercent(t), count: t.marked };
	}
	const wholeCell = (c: RateCounts) => ({ pct: percent(c.whole.clean, c.whole.whole), count: c.whole.whole });
	const cellText = (c: { pct: number | null; count: number }) => (c.pct === null ? '—' : `${c.pct}% ${c.count} 次`);

	/** 打開的明細：哪個動作、誰、哪個環節（null 是整次）。 */
	let open = $state<{ actionId: string; who: string; phaseId: string | null } | null>(null);
	/** 明細的內容；動作、組或環節不在了就關掉。 */
	const detail = $derived.by(() => {
		if (!open) return null;
		const { actionId, who, phaseId } = open;
		const block = blocks.find((b) => b.action.id === actionId);
		const phases = block?.action.successRate?.phases ?? [];
		const phase = phaseId === null ? (phases.length > 1 ? '整次' : null) : phases.find((p) => p.id === phaseId);
		const column = block?.table.columns.find((c) => c.who === who);
		if (!block || !phase || !column) return null;
		const name = typeof phase === 'string' ? phase : phaseLabel(phase);
		return { title: `${column.name} ${name}`, days: cellDetail(block.action, who, phaseId, filter) };
	});
	const isOpen = (actionId: string, who: string, phaseId: string | null) =>
		open?.actionId === actionId && open.who === who && open.phaseId === phaseId;
</script>

{#snippet number(c: { pct: number | null; count: number })}
	{#if c.pct === null}—{:else}<strong>{c.pct}%</strong> <small>{c.count} 次</small>{/if}
{/snippet}

<!-- 一組的一格：點了打開明細（phaseId 是 null 是整次）。 -->
{#snippet cellButton(actionId: string, who: string, phaseId: string | null, label: string, c: { pct: number | null; count: number })}
	<td class={rateBand(c.pct)}>
		<button
			type="button"
			class="cell"
			aria-label="{label} {cellText(c)}"
			aria-pressed={isOpen(actionId, who, phaseId)}
			onclick={() => (open = { actionId, who, phaseId })}>{@render number(c)}</button
		>
	</td>
{/snippet}

<div class="summary">
	{#if recording}
		<RunThroughSheet {date} onclose={closeSheet} />
	{:else}
		<RunThroughBar {date} onrecord={() => ((recording = true), (open = null))} />
		<div class="filters">
			<div class="seg" role="group" aria-label="期間">
				<span>期間</span>
				{#each PERIODS as p (p.key)}
					<button type="button" aria-pressed={picks.period === p.key} onclick={() => (picks.period = p.key)}>{p.label}</button>
				{/each}
			</div>
			<div class="seg" role="group" aria-label="練法">
				<span>練法</span>
				{#each PRACTICES as p (p.key)}
					<button type="button" aria-pressed={picks.practice === p.key} onclick={() => (picks.practice = p.key)}>{p.label}</button>
				{/each}
			</div>
			<div class="seg" role="group" aria-label="大字看">
				<span>大字看</span>
				{#each RATES as r (r.key)}
					<button type="button" aria-pressed={picks.rate === r.key} onclick={() => (picks.rate = r.key)}>{r.label}</button>
				{/each}
			</div>
		</div>
		<ul class="legend" aria-label="顏色">
			<li><span class="good"></span>90% 以上</li>
			<li><span class="fair"></span>75–89%</li>
			<li><span class="poor"></span>75% 以下</li>
			<li>— 沒有紀錄</li>
		</ul>

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
									<th scope="col">{col.name}{#if col.people}{' '}<small class="people">{col.people.join('・')}</small>{/if}</th>
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
										{@render cellButton(action.id, col.who, p.id, `${col.name} ${phaseLabel(p)}`, phaseCell(col.phases[p.id]))}
									{/each}
									<td class="total {rateBand(total.pct) ?? ''}">{@render number(total)}</td>
								</tr>
							{/each}
							<!-- 只有一個環節：整次跟那一列一樣，不放 -->
							{#if phases.length > 1}
								<tr class="whole">
									<!-- 整次一律是整次成功率：大字看完成率時寫清楚 -->
									<th scope="row">{picks.rate === 'completion' ? '整次成功率' : '整次'}</th>
									{#each table.columns as col (col.who)}
										{@render cellButton(action.id, col.who, null, `${col.name} 整次`, wholeCell(col))}
									{/each}
									<td class="total {rateBand(wholeTotal.pct) ?? ''}">{@render number(wholeTotal)}</td>
								</tr>
							{/if}
						</tbody>
					</table>
				</div>
			</section>
		{:else}
			<p class="empty">還沒有要記的動作：到編排的拍點格子，幫動作加環節。</p>
		{/each}
	{/if}
</div>

{#if detail}
	<aside class="detail" aria-label="明細">
		<header>
			<h3>{detail.title}</h3>
			<button type="button" onclick={() => (open = null)}>關閉</button>
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
		grid-template-columns: minmax(0, 1fr);
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
	.legend {
		list-style: none;
		margin: -8px 0 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		color: var(--muted);
		font-size: 12px;
	}
	.legend li {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.legend span {
		width: 14px;
		height: 14px;
		border-radius: 3px;
		border: 1px solid var(--line);
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
	.people {
		display: block;
		color: var(--muted);
		font-size: 11px;
		font-weight: 400;
	}
	th[scope='row'] {
		text-align: left;
		font-weight: 600;
	}
	/* 40 人時表格很寬：「環節」那一欄往右捲也留在左邊，看得出每一列是哪個環節。 */
	tr > th:first-child {
		position: sticky;
		left: 0;
		z-index: 1;
	}
	tbody th {
		background: var(--surface);
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
	/* 蓋在練習畫面上（不蓋上方列）：位置照練習畫面那一格（.practice-host），不跟著總表捲。 */
	.detail {
		position: absolute;
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
	/* 印出來：只印表格，欄位跟著紙寬縮（人多時字可以拆行），不印篩選、按鈕和明細 */
	@media print {
		.filters,
		.detail {
			display: none;
		}
		.scroll {
			overflow: visible;
		}
		tr > th:first-child {
			position: static;
		}
		table {
			width: 100%;
		}
		th,
		thead th,
		td,
		td:has(.cell) {
			padding: 2px;
			font-size: 9px;
			white-space: normal;
			word-break: break-all;
		}
		.cell {
			min-width: 0;
			padding: 0;
			font-size: 9px;
			white-space: normal;
		}
		td strong {
			font-size: 11px;
		}
		td small {
			font-size: 8px;
		}
	}
</style>
