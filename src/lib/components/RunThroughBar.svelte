<script lang="ts">
	// 記錄頁和總表最上面那一排：「＋ 記一次全上」、「刪掉上一次全上」。提示走編輯器唯一的提示（session.notice）。
	// 「刪掉上一次全上」整次拿掉這天最後存的全上（不拆開），提示寫出刪了這天第幾次全上，幾秒內可以救回。
	import { deleteLastRunThrough, lastRunThrough, restoreRunThrough } from '#lib/core';
	import { getEditorSession } from '#lib/editor-session.svelte.js';
	import { removeWithRestore } from './record-notice';
	import { revealAlert } from './reveal';

	interface Props {
		/** 選的日期（YYYY-MM-DD）。 */
		date: string;
		/** 按「＋ 記一次全上」。 */
		onrecord: () => void;
	}

	let { date, onrecord }: Props = $props();

	const session = getEditorSession();
	const flow = $derived(session.flow!);
	/** 刪掉上一次全上、救回：紀錄改了交給 session 的「記」（不算復原的一步）。 */
	const ask = session.recordAsk();
	/** 這天有沒有全上。 */
	const hasRun = $derived(lastRunThrough(flow, date) !== undefined);

	/** 這天記了幾次全上（每次全上的 id 不一樣）。 */
	function runsOn(): number {
		const ids = flow.actions.flatMap(
			(a) => a.successRate?.records.flatMap((r) => (r.date === date && r.runThroughId) || []) ?? []
		);
		return new Set(ids).size;
	}

	function removeRun() {
		removeWithRestore(
			ask,
			session,
			`已刪掉第 ${runsOn()} 次全上`,
			() => deleteLastRunThrough(flow, date),
			({ removed }) => restoreRunThrough(flow, removed)
		);
	}
</script>

<div class="run">
	<button type="button" class="primary" onclick={onrecord}>＋ 記一次全上</button>
	<button type="button" disabled={!hasRun} title="整次刪掉這天最後存的那次全上" onclick={removeRun}>刪掉上一次全上</button>
	{#if ask.error}<span class="error" {@attach revealAlert(ask.failures)}>{ask.error}</span>{/if}
</div>

<style>
	.run {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
	}
	.error {
		color: #b91c1c;
		font-size: 13px;
	}
	/* 印總表時只印表格 */
	@media print {
		.run {
			display: none;
		}
	}
</style>
