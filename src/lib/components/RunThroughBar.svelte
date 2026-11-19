<script lang="ts">
	// 記錄頁和總表最上面那一排：「＋ 記一次全上」、「刪掉上一次全上」。提示走編輯器唯一的提示（session.notice）。
	// 「刪掉上一次全上」整次拿掉這天最後存的全上（不拆開），提示寫出刪了這天第幾次全上，幾秒內可以救回。
	// 雲端流程的記錄者（#258）換成「刪掉我上一次全上記的」：只刪自己在這天最後記過的那次全上記的組（別人記的不刪）。
	// 一起記全上（#262）：有人在記（自己不在表裡）時上面一條藍的「● 王教練在記今天第 3 次全上（1:43 開的）」＋「加入，記別的組」
	// （斷網時按不了）；按「＋ 記一次全上」先跳框問「加入這一次」「開新的一次」「取消」（斷網時不問）。
	import { lastRunThrough, runThroughsOn } from '#lib/core';
	import { getEditor } from '#lib/editor.svelte.js';
	import { getEditorSession } from '#lib/editor-session.svelte.js';
	import { localDate } from '#lib/local-date.js';
	import { runNumber, startClock } from '#lib/run-keys.js';
	import type { RunView } from '#lib/server-api.js';
	import Modal from './Modal.svelte';
	import { removeWithRestore } from './record-notice';
	import { revealAlert } from './reveal';

	interface Props {
		/** 選的日期（YYYY-MM-DD）。 */
		date: string;
		/** 按「＋ 記一次全上」：join 是要加入的那次（雲端流程，#262），沒給是開新的。 */
		onrecord: (join?: RunView) => void;
	}

	let { date, onrecord }: Props = $props();

	const session = getEditorSession();
	/** 開著的雲端流程（本機流程是 null）。 */
	const cloud = $derived(getEditor().file.cloud);
	/** 連著（斷網時不能加入、不問）。 */
	const online = $derived(!!cloud && cloud.link === 'online' && !cloud.offline);
	/** 有人在記、自己不在表裡的全上。 */
	const others = $derived(
		session.cannotRecord ? [] : (cloud?.runs ?? []).filter((r) => r.people.length && !r.people.some((p) => p.me))
	);
	/** 按了「＋ 記一次全上」、有人在記：問加入還是開新的。 */
	let asking = $state<RunView | null>(null);

	/** 「王教練在記今天第 3 次全上」。 */
	function recording(run: RunView): string {
		const day = run.date === localDate() ? '今天' : run.date;
		return `${run.people[0].name}在記${day}第 ${runNumber(flow, cloud?.runs ?? [], run.date, run)} 次全上`;
	}

	function record() {
		if (online && others.length) asking = others[0];
		else onrecord();
	}
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
			{ name: 'deleteLastRunThrough', args: [date] },
			({ removed }) => ({ name: 'restoreRunThrough', args: [removed] })
		);
	}

	/** 記錄者（雲端流程）：這天自己記過的最後一次全上是第幾次、自己在那次記的那幾次的 id；沒有是 null。 */
	const myLastRun = $derived.by(() => {
		if (!session.ownRecordsOnly) return null;
		const runs = runThroughsOn(flow, date);
		const mine = flow.actions.flatMap(
			(a) => a.successRate?.records.filter((r) => r.date === date && r.runThroughId && !(r.id in session.recordedBy)) ?? []
		);
		for (let n = runs.length - 1; n >= 0; n--) {
			const ids = mine.filter((r) => r.runThroughId === runs[n]).map((r) => r.id);
			if (ids.length) return { n: n + 1, ids };
		}
		return null;
	});

	function removeMyRun() {
		const { n, ids } = myLastRun!;
		removeWithRestore(
			ask,
			session,
			`已刪掉你在第 ${n} 次全上記的 ${ids.length} 欄`,
			{ name: 'deleteAttempts', args: [ids] },
			({ removed }) => ({ name: 'restoreRunThrough', args: [removed] })
		);
	}
</script>

{#each others as run (run.id)}
	<p class="live" role="status" aria-label="有人在記全上">
		<span>● {recording(run)}（{startClock(run.startedAt)} 開的）</span>
		<button type="button" disabled={!online} onclick={() => onrecord(run)}>加入，記別的組</button>
	</p>
{/each}
{#if asking}
	{@const run = asking}
	<Modal label={recording(run)} class="dialog join" onclose={() => (asking = null)}>
		{#snippet children(close)}
			<h3>{recording(run)}</h3>
			<p class="hint">{startClock(run.startedAt)} 開的。一組在一次全上只能一個人記。</p>
			<div class="choices">
				<!-- 先交出 run 再清 asking：run 是跟著 asking 的 @const，清掉後再讀就是 null（變成開新的） -->
				<button type="button" class="primary" data-autofocus onclick={() => (onrecord(run), (asking = null))}
					>加入這一次：跟{run.people[0].name}一起記，你記別的組</button
				>
				<button type="button" onclick={() => ((asking = null), onrecord())}
					>開新的一次：只有你記，算第 {runNumber(flow, cloud?.runs ?? [], date)} 次</button
				>
				<button type="button" onclick={close}>取消</button>
			</div>
		{/snippet}
	</Modal>
{/if}
<div class="run">
	<button type="button" class="primary" onclick={record}>＋ 記一次全上</button>
	{#if session.ownRecordsOnly}
		<button type="button" disabled={!myLastRun} title="只刪你在這天最後一次全上記的那幾組（別人記的不刪）" onclick={removeMyRun}
			>刪掉我上一次全上記的</button
		>
	{:else}
		<button type="button" disabled={!hasRun} title="整次刪掉這天最後存的那次全上" onclick={removeRun}>刪掉上一次全上</button>
	{/if}
	{#if ask.error}<span class="error" {@attach revealAlert(ask.failures)}>{ask.error}</span>{/if}
</div>

<style>
	.live {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
		margin: 0;
		padding: 8px 12px;
		border-radius: 8px;
		background: #dbeafe;
		color: #1e3a8a;
	}
	h3 {
		margin: 0;
	}
	.hint {
		margin: 4px 0 12px;
		color: var(--muted);
		font-size: 13px;
	}
	.choices {
		display: grid;
		gap: 8px;
	}
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
		.run,
		.live {
			display: none;
		}
	}
</style>
