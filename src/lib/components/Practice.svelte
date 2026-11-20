<script lang="ts">
	// 練習畫面（上方列切到「練習」時蓋掉編排）：上面選頁和日期，下面是那一頁。
	// 兩頁「記錄」「總表」共用日期；日期由編輯頁管（切回編排再切回來還在，不存進流程檔）。
	// 流程從 session 拿；記一次、刪掉上一次、記一次全上交給 session 的「記」（不算復原的一步）。
	// 雲端流程（#257）：檢視者只看總表、不能記；沒存進去的紀錄（教練改了流程）在日期那一排下面紅色一條，按「知道了」才清。
	// 斷網照記（#260）：日期那一排下面一件事一條：斷網（黃）、傳不上去（紅，「現在再試」）、登入超過 30 天（紅，「再登入」）、
	// 傳中、都傳上去了（綠，一下就收）。同一次全上同一組別人先存了（#262）：沒存進去的那一列寫「王教練已經記了…」。iPhone、iPad 的 Safari 第一次記之後，下面滑上來提醒加到主畫面。
	import { resolve } from '$app/paths';
	import { recordableActions } from '#lib/core';
	import { getEditor } from '#lib/editor.svelte.js';
	import { droppedNote } from '#lib/cloud-steps.svelte.js';
	import { getEditorSession } from '#lib/editor-session.svelte.js';
	import { localDate } from '#lib/local-date.js';
	import { m as t } from '#lib/paraglide/messages.js';
	import { whyText } from '#lib/reason-text.js';
	import HomeScreenHint from './HomeScreenHint.svelte';
	import RecordPage from './RecordPage.svelte';
	import SummaryPage from './SummaryPage.svelte';
	import { revealAlert } from './reveal';

	interface Props {
		/** 記在哪一天（YYYY-MM-DD），預設今天；可以改（練完補打）。 */
		date: string;
		ondate: (date: string) => void;
		/** 窄螢幕（手機）：記錄頁的動作清單改成下拉選單。 */
		narrow?: boolean;
	}

	let { date, ondate, narrow = false }: Props = $props();

	const session = getEditorSession();
	/** 開著的雲端流程（本機流程是 null）：連線、還沒傳的。 */
	const cloud = $derived(getEditor().file.cloud);
	/** 還有幾筆沒傳。 */
	const unsent = $derived(cloud?.unsentCount ?? 0);
	/** 加到主畫面的提醒有多高：練習畫面下面留這麼多。 */
	let hintHeight = $state(0);
	/** 有沒有要記的動作（有記成功率、有環節）；沒有就兩頁都只寫怎麼加環節，不給記一次全上。 */
	const empty = $derived(recordableActions(session.flow!).length === 0);

	const ALL_PAGES = $derived([
		{ key: 'record', label: t.practice_page_record() },
		{ key: 'summary', label: t.practice_page_summary() }
	] as const);
	/** 不能記（雲端流程的檢視者）只有總表。 */
	const PAGES = $derived(session.cannotRecord ? ALL_PAGES.filter((p) => p.key === 'summary') : ALL_PAGES);
	/** 在哪一頁：放在 session，切到編排再回來還是這一頁（不能記的只有總表）。 */
	const page = $derived(PAGES.some((p) => p.key === session.view.practicePage) ? session.view.practicePage : PAGES[0].key);
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

<section class="practice" aria-label={t.practice_label()} style:padding-bottom={cloud?.homeHint ? `${hintHeight + 24}px` : undefined}>
	<header>
		<div class="pages" role="group" aria-label={t.practice_pages()}>
			{#each PAGES as p (p.key)}
				<button
					type="button"
					aria-pressed={page === p.key}
					onclick={() => p.key !== page && session.leavePracticePage(() => (session.view.practicePage = p.key))}>{p.label}</button
				>
			{/each}
		</div>
		<label class="date">{t.practice_date()}<input type="date" value={date} max={today} onchange={(e) => changeDate(e.currentTarget)} /></label>
	</header>
	{#if cloud && (!session.cannotRecord || unsent)}
		{#if cloud.link === 'offline'}
			<p class="bar warn" role="status">
				{unsent ? (unsent === 1 ? t.practice_offline_unsent_one : t.practice_offline_unsent)({ n: unsent }) : t.practice_offline()}
			</p>
		{:else if cloud.link === 'unreachable'}
			<p class="bar bad" role="status">
				<span
					>{unsent
						? (unsent === 1 ? t.practice_unreachable_unsent_one : t.practice_unreachable_unsent)({ n: unsent })
						: t.practice_unreachable()}</span
				>
				<button type="button" onclick={() => cloud.retry()}>{t.practice_retry()}</button>
			</p>
		{:else if cloud.link === 'expired'}
			<p class="bar bad" role="status">
				<span
					>{unsent ? (unsent === 1 ? t.practice_expired_unsent_one : t.practice_expired_unsent)({ n: unsent }) : t.practice_expired()}</span
				>
				<a class="btn" href={resolve('/login')}>{t.practice_sign_in_again()}</a>
			</p>
		{:else if cloud.syncing}
			<p class="bar" role="status">{t.practice_syncing({ n: unsent })}</p>
		{:else if cloud.synced.value}
			<p class="bar ok" role="status">{t.practice_synced()}</p>
		{/if}
	{/if}
	{#if dropped.length}
		<div class="dropped" {@attach revealAlert()}>
			<div class="dropped-head">
				{#if dropped.every((d) => d.note)}
					<p><b>{(dropped.length === 1 ? t.practice_dropped_one : t.practice_dropped)({ n: dropped.length })}</b></p>
				{:else}
					<p>
						<b>{(dropped.length === 1 ? t.practice_dropped_changed_one : t.practice_dropped_changed)({ n: dropped.length })}</b><small
							>{t.practice_dropped_why()}</small
						>
					</p>
				{/if}
				<button type="button" onclick={() => (cloud ? cloud.dismissDropped() : (session.droppedRecords = []))}>{t.practice_got_it()}</button>
			</div>
			<table>
				<thead
					><tr
						><th>{t.practice_date()}</th><th>{t.practice_skill()}</th><th>{t.practice_squad()}</th><th>{t.practice_marks()}</th></tr
					></thead
				>
				<tbody>
					{#each dropped as d (d.id)}
						<tr>
							<td>{d.date}</td>
							<td>{whyText(d.action)}</td>
							<td>{whyText(d.who)}</td>
							<td
								>{d.marks}{#if d.runThrough}<small class="run">{t.practice_full_out()}</small>{/if}{#if d.note}<small class="note">{droppedNote(d.note)}</small
									>{/if}</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
	{#if empty}
		<!-- 手機不能編排（docs/adr/0005-ipad-touch.md），所以寫清楚要換電腦或橫放的 iPad。 -->
		<p class="empty">{t.practice_empty()}</p>
	{:else if page === 'record'}
		<RecordPage {date} {narrow} />
	{:else}
		<SummaryPage {date} />
	{/if}
	{#if cloud?.homeHint}
		<HomeScreenHint bind:height={hintHeight} onknown={() => cloud.closeHomeHint(true)} onlater={() => cloud.closeHomeHint(false)} />
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
	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 6px 12px;
		margin: 0;
		padding: 8px 12px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--surface);
		font-weight: 600;
	}
	.bar.warn {
		border-color: #fcd34d;
		background: #fffbeb;
		color: #92400e;
	}
	.bar.bad {
		border-color: #fca5a5;
		background: #fef2f2;
		color: #991b1b;
	}
	.bar.ok {
		border-color: #86efac;
		background: #f0fdf4;
		color: #15803d;
	}
	.bar button,
	.bar .btn {
		flex: none;
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
	.dropped .note {
		display: block;
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
