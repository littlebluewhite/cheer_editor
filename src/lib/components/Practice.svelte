<script lang="ts">
	// 練習畫面（上方列切到「練習」時蓋掉編排）：上面選頁和日期，下面是那一頁。
	// 兩頁「記錄」「總表」共用日期；日期由編輯頁管（切回編排再切回來還在，不存進流程檔）。
	// 流程從 session 拿；記一次、刪掉上一次、記一次全上交給 session 的「記」（不算復原的一步）。
	// 雲端流程（#257）：檢視者只看總表、不能記；沒存進去的紀錄（教練改了流程）在日期那一排下面紅色一條，按「知道了」才清。
	import { recordableActions } from '#lib/core';
	import { getEditorSession } from '#lib/editor-session.svelte.js';
	import { localDate } from '#lib/local-date.js';
	import RecordPage from './RecordPage.svelte';
	import SummaryPage from './SummaryPage.svelte';

	interface Props {
		/** 記在哪一天（YYYY-MM-DD），預設今天；可以改（練完補打）。 */
		date: string;
		ondate: (date: string) => void;
		/** 窄螢幕（手機）：記錄頁的動作清單改成下拉選單。 */
		narrow?: boolean;
	}

	let { date, ondate, narrow = false }: Props = $props();

	const session = getEditorSession();
	/** 有沒有要記的動作（有記成功率、有環節）；沒有就兩頁都只寫怎麼加環節，不給記一次全上。 */
	const empty = $derived(recordableActions(session.flow!).length === 0);

	const ALL_PAGES = [
		{ key: 'record', label: '記錄' },
		{ key: 'summary', label: '總表' }
	] as const;
	/** 不能記（雲端流程的檢視者）只有總表。 */
	const PAGES = $derived(session.cannotRecord ? ALL_PAGES.filter((p) => p.key === 'summary') : ALL_PAGES);
	let picked = $state<(typeof ALL_PAGES)[number]['key']>('record');
	const page = $derived(PAGES.some((p) => p.key === picked) ? picked : PAGES[0].key);
	/** 沒存進去的紀錄（雲端流程）。 */
	const dropped = $derived(session.droppedRecords);

	/** 最晚選到今天（未來還沒練）。 */
	const today = localDate();

	/** 日期框清空了、打了未來的日子，就回到原來的日期（一次一定要有日期）。 */
	function changeDate(input: HTMLInputElement) {
		if (input.value && input.value <= localDate()) ondate(input.value);
		else input.value = date;
	}
</script>

<section class="practice" aria-label="練習">
	<header>
		<div class="pages" role="group" aria-label="練習的頁">
			{#each PAGES as p (p.key)}
				<button
					type="button"
					aria-pressed={page === p.key}
					onclick={() => p.key !== page && session.leavePracticePage(() => (picked = p.key))}>{p.label}</button
				>
			{/each}
		</div>
		<label class="date">日期<input type="date" value={date} max={today} onchange={(e) => changeDate(e.currentTarget)} /></label>
	</header>
	{#if dropped.length}
		<div class="dropped" role="alert">
			<div class="dropped-head">
				<p><b>教練改了流程，這 {dropped.length} 筆沒存進去</b><small>你記的時候，教練刪掉了這些環節或組。</small></p>
				<button type="button" onclick={() => (session.droppedRecords = [])}>知道了</button>
			</div>
			<table>
				<thead><tr><th>日期</th><th>動作</th><th>組</th><th>記號</th></tr></thead>
				<tbody>
					{#each dropped as d (d.id)}
						<tr>
							<td>{d.date}</td>
							<td>{d.action}</td>
							<td>{d.who}</td>
							<td>{d.marks}{#if d.runThrough}<small class="run">全上</small>{/if}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
	{#if empty}
		<!-- 手機不能編排（docs/adr/0005-ipad-touch.md），所以寫清楚要換電腦或橫放的 iPad。 -->
		<p class="empty">還沒有要記的動作：要先幫動作加環節。用電腦或橫放的 iPad 打開這支流程，到「編排」的拍點格子加環節。</p>
	{:else if page === 'record'}
		<RecordPage {date} {narrow} />
	{:else}
		<SummaryPage {date} />
	{/if}
</section>

<style>
	.practice {
		min-height: 0;
		overflow-y: auto;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		align-content: start;
		gap: 12px;
		padding: 12px 16px 24px;
	}
	header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 8px 16px;
	}
	.pages {
		display: inline-flex;
		border: 1px solid var(--line);
		border-radius: 8px;
		overflow: hidden;
		background: var(--surface);
	}
	.pages button {
		border: 0;
		border-radius: 0;
		padding: 6px 16px;
		font-size: 14px;
		font-weight: 600;
		color: var(--muted);
	}
	.pages button[aria-pressed='true'] {
		background: var(--ink);
		color: #fff;
	}
	.date {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-weight: 600;
	}
	.empty {
		color: var(--muted);
	}
	.dropped {
		display: grid;
		gap: 8px;
		padding: 10px 12px;
		border: 1px solid #fca5a5;
		border-radius: 8px;
		background: #fef2f2;
		color: #991b1b;
	}
	.dropped-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}
	.dropped-head p {
		display: grid;
		gap: 2px;
		margin: 0;
	}
	.dropped table {
		border-collapse: collapse;
		font-size: 13px;
	}
	.dropped th,
	.dropped td {
		padding: 2px 12px 2px 0;
		text-align: left;
	}
	.dropped .run {
		margin-left: 4px;
		color: var(--muted);
	}
	@media print {
		.practice {
			overflow: visible;
			padding: 0;
		}
		header {
			display: none;
		}
	}
</style>
