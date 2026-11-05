<script lang="ts">
	// 練習畫面（上方列切到「練習」時蓋掉編排）：上面選頁和日期，下面是那一頁。
	// 兩頁「記錄」「總表」共用日期；日期由編輯頁管（切回編排再切回來還在，不存進流程檔）。
	// 流程從 session 拿；記一次、刪掉上一次、記一次全上交給 session 的「記」（不算復原的一步）。
	import { localDate } from '#lib/local-date.js';
	import RecordPage from './RecordPage.svelte';
	import SummaryPage from './SummaryPage.svelte';

	interface Props {
		/** 記在哪一天（YYYY-MM-DD），預設今天；可以改（練完補打）。 */
		date: string;
		ondate: (date: string) => void;
	}

	let { date, ondate }: Props = $props();

	const PAGES = [
		{ key: 'record', label: '記錄' },
		{ key: 'summary', label: '總表' }
	] as const;
	let page = $state<(typeof PAGES)[number]['key']>('record');

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
				<button type="button" aria-pressed={page === p.key} onclick={() => (page = p.key)}>{p.label}</button>
			{/each}
		</div>
		<label class="date">日期<input type="date" value={date} max={today} onchange={(e) => changeDate(e.currentTarget)} /></label>
	</header>
	{#if page === 'record'}
		<RecordPage {date} />
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
