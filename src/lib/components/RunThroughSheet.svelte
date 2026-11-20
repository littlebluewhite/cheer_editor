<script lang="ts">
	// 記錄頁、總表的「＋ 記一次全上」打開的表（照台灣教練的全上表）：每個要記的動作一塊，照流程順序；一列一個環節，一欄一組。
	// 每格先是 ✓，教練只點出錯的地方：✓ → △ → ✗ → ✓。一格變 ✗，同一組按不了的環節（✗ 做完之後才開始的，問核心 blankPhases）變空的，佔同樣拍的留著；改回來，回到 ✓。
	// 有個動作沒做，在它那裡按「這個沒做」：整個動作變空的，不存；中途停了，在第一個沒做的動作按「後面都沒做」，它和後面的一次變空的。
	// 表上的東西只在這個元件裡，按「存這次全上」才用 recordRunThrough 存進流程；「取消」什麼都不存（改過格子先問，切頁也一樣）。
	// 雲端流程能記的人一起記（#262，ADR 0015）：開表就把全上 id、日期、開的時間和要拿的組報給伺服器（開新的拿全部的組，
	// 加入的拿沒人拿著的，日期、開的時間用開的人的）。最上面一排「我記哪幾組」照組號跨動作一起選，騰翻、跳躍每個人一顆，
	// 點一下拿來（別人還沒點過的能接手）或放掉；別人記的欄變灰、格子「—」，欄名下面寫誰在記；同一次全上別人先存了的欄也變灰。
	// 一欄第一次點記號時告訴伺服器；只存自己記的欄；存好、取消就離開表。
	import {
		actionWhy,
		attemptWhos,
		blankPhases,
		keptAttempt,
		MARKS,
		phaseWhy,
		recordableActions,
		type Action,
		type Mark,
		type Phase,
		type RunThroughMarks
	} from '#lib/core';
	import { getEditor } from '#lib/editor.svelte.js';
	import { getEditorSession } from '#lib/editor-session.svelte.js';
	import { whyText } from '#lib/reason-text.js';
	import { runKey, runKeyLabel, runKeys, runNumber } from '#lib/run-keys.js';
	import { m as t } from '#lib/paraglide/messages.js';
	import type { RunView } from '#lib/server-api.js';
	import ConfirmList from './ConfirmList.svelte';
	import { actionColor } from './category-colors';
	import { revealAlert } from './reveal';

	interface Props {
		/** 記在哪一天（練習畫面選的日期）。 */
		date: string;
		/** 加入別人在記的那次全上（雲端流程，#262）；開新的是 null。 */
		join?: RunView | null;
		/** 存好（saved = true）或取消後關掉這張表。 */
		onclose: (saved: boolean) => void;
	}

	let { date, join = null, onclose }: Props = $props();

	const session = getEditorSession();
	/** 一起記全上（雲端流程能記的人）；本機流程是 null。 */
	const together = session.cannotRecord ? null : getEditor().file.cloud;
	/**
	 * 這次全上：id、日期、開的時間（手機的時間，一天裡的全上照它排第幾次）。加入的用開的人的；
	 * 雲端流程開新的先發 id（報給伺服器，別人加入用同一個）。
	 */
	// svelte-ignore state_referenced_locally
	const joined = join;
	// svelte-ignore state_referenced_locally
	const run = joined
		? { id: joined.id, date: joined.date, startedAt: joined.startedAt }
		: { id: together ? newRunId() : '', date, startedAt: Date.now() };
	const flow = $derived(session.flow!);
	/** 存好了交給 session 的「記」（紀錄不算復原的一步）。 */
	const ask = session.recordAsk();

	const NEXT: Record<Mark, Mark> = { '✓': '△', '△': '✗', '✗': '✓' };

	const blocks = $derived(recordableActions(flow).map((action) => ({ action, whos: attemptWhos(flow, action) })));

	/** 「我記哪幾組」的每一組。 */
	const keys = $derived(runKeys(flow, blocks));
	/** 伺服器說的這次全上（誰拿著哪幾組）。 */
	const live = $derived(together?.runs.find((r) => r.id === run.id));
	/** 我拿著的組。 */
	const myKeys = $derived(together?.myRun?.keys ?? []);
	/** 別人拿著這一組：拿著的人。 */
	const holder = (key: string) => live?.keys.find((k) => k.key === key && !k.mine);
	/** 這次全上加入時是第幾次（存完還是這個數）。 */
	// svelte-ignore state_referenced_locally
	const number = joined ? runNumber(flow, together?.runs ?? [], run.date, run) : 0;

	if (together) {
		// svelte-ignore state_referenced_locally
		const free = joined ? keys.filter((k) => !joined.keys.some((h) => h.key === k)) : keys;
		together.enterRun(run, free, !!joined);
	}
	$effect(() => () => together?.leaveRun());

	/** 同一次全上這一欄別人已經存了：記的人的名字（不知道是誰是空字串）。 */
	function recordedBy(action: Action, who: string): string | null {
		if (!together) return null;
		const r = action.successRate!.records.find((r) => r.runThroughId === run.id && r.who === who && r.id in session.recordedBy);
		return r ? session.recordedBy[r.id] : null;
	}
	/** 這一欄是我記的（本機流程每一欄都是）。 */
	const isMine = (action: Action, who: string) =>
		!together || (myKeys.includes(runKey(action, who)) && recordedBy(action, who) === null);
	/** 別人記的欄，欄名下面的字。 */
	function otherText(action: Action, who: string): string {
		const done = recordedBy(action, who);
		if (done !== null) return done ? t.run_through_done_by({ name: done }) : t.run_through_done_by_someone();
		const h = holder(runKey(action, who));
		if (!h) return '';
		const name = h.name;
		return h.away ? t.run_through_away({ name }) : h.touched ? t.run_through_touched({ name }) : t.run_through_holding_untouched({ name });
	}
	/** 「我記哪幾組」每顆下面的字：你記（有幾欄別人先存了寫「你記 2／3」）、沒人記、王教練拿著、王教練在記。 */
	function pickText(key: string): string {
		if (myKeys.includes(key)) {
			const cols = blocks.flatMap(({ action, whos }) =>
				whos.filter((w) => runKey(action, w.who) === key).map((w) => recordedBy(action, w.who) === null)
			);
			const free = cols.filter(Boolean).length;
			return free === cols.length ? t.run_through_you() : t.run_through_you_some({ free, total: cols.length });
		}
		const h = holder(key);
		return !h ? t.run_through_no_one() : h.touched ? t.run_through_touched({ name: h.name }) : t.run_through_holding({ name: h.name });
	}
	function pick(key: string) {
		if (myKeys.includes(key)) together?.release(key);
		else together?.claim(key, holder(key)?.userId ?? null);
	}
	/** 拿不到一組、加入不了的提示。 */
	const refused = $derived.by(() => {
		const r = together?.runRefused;
		if (!r) return '';
		if (r === 'closed') return t.run_through_closed();
		const group = whyText(runKeyLabel(flow, r.key));
		return r.touched ? t.run_through_refused_touched({ name: r.by, group }) : t.run_through_refused({ name: r.by, group });
	});
	/** 每一組都有別人拿著、我一組都沒有。 */
	const allTaken = $derived(!!together && !myKeys.length && keys.every((k) => holder(k)));

	/** 教練點過的格子（key：動作|誰|環節）；沒點過的是 ✓。 */
	let picked = $state<Record<string, Mark>>({});
	/** 按了「這個沒做」的動作。 */
	let skipped = $state<string[]>([]);
	/** 按了取消，等教練確定要不要丟掉改過的格子。 */
	let confirming = $state(false);
	/** 改過格子、按過「沒做」：取消要先問。 */
	const dirty = $derived(skipped.length > 0 || Object.values(picked).some((m) => m !== '✓'));

	const key = (actionId: string, who: string, phaseId: string) => `${actionId}|${who}|${phaseId}`;

	/** 一組在一個動作點過的記號，每個環節都有（沒點過的是 ✓）。 */
	function tapped(action: Action, who: string): Record<string, Mark> {
		return Object.fromEntries(action.successRate!.phases.map((p) => [p.id, picked[key(action.id, who, p.id)] ?? '✓']));
	}

	/** 一組在一個動作的記號，照環節順序，是會存下來的樣子（問核心 keptAttempt，存的時候也照它）：按不了的環節（blankPhases 的 shut）、沒做的動作是空的（null），跟 ✗ 佔同樣拍的照點的留著。 */
	function column(action: Action, who: string): (Mark | null)[] {
		const phaseIds = action.successRate!.phases.map((p) => p.id);
		if (skipped.includes(action.id)) return phaseIds.map(() => null);
		const kept = keptAttempt(action, true, tapped(action, who)).marks;
		return phaseIds.map((id) => kept[id] ?? null);
	}

	/** 點一格換下一個記號；變 ✗ 就把同一組空著的環節點過的清掉（核心 blankPhases 說哪些；改回來時是 ✓）。 */
	function tap(action: Action, who: string, phaseId: string, mark: Mark) {
		together?.touch(runKey(action, who));
		const next = NEXT[mark];
		picked[key(action.id, who, phaseId)] = next;
		if (next !== '✗') return;
		for (const id of blankPhases(action, true, tapped(action, who)).shut) delete picked[key(action.id, who, id)];
	}

	function toggleSkip(actionId: string) {
		skipped = skipped.includes(actionId) ? skipped.filter((id) => id !== actionId) : [...skipped, actionId];
	}

	/** 第 index 個動作和它後面的動作 id。 */
	const after = (index: number) => blocks.slice(index).map((b) => b.action.id);
	/** 這個和後面的動作都按了沒做。 */
	const restSkipped = (index: number) => after(index).every((id) => skipped.includes(id));

	/** 「後面都沒做」：這個和後面的動作都變沒做；已經都沒做就都回來。 */
	function toggleRest(index: number) {
		const rest = after(index);
		skipped = restSkipped(index)
			? skipped.filter((id) => !rest.includes(id))
			: [...skipped, ...rest.filter((id) => !skipped.includes(id))];
	}

	function cancel() {
		if (dirty) confirming = true;
		else onclose(false);
	}

	/** 確定丟掉之後要去的地方（切頁時先問）；按取消問的是 null。 */
	let leaving: (() => void) | null = null;

	// 改過格子：切頁（記錄、總表、編排）跟按取消一樣先問，丟掉才切過去。
	$effect(() => {
		if (!dirty) return;
		const guard = (go: () => void) => {
			leaving = go;
			confirming = true;
		};
		session.practiceLeave = guard;
		return () => {
			if (session.practiceLeave === guard) session.practiceLeave = null;
		};
	});

	function discard() {
		const go = leaving;
		onclose(false);
		go?.();
	}

	/** 要存的：沒按「沒做」的動作裡、我記的欄。 */
	const entries: RunThroughMarks[] = $derived(
		blocks
			.filter(({ action }) => !skipped.includes(action.id))
			.flatMap(({ action, whos }) =>
				whos.filter(({ who }) => isMine(action, who)).map(({ who }) => ({ actionId: action.id, who, marks: tapped(action, who) }))
			)
	);

	function save() {
		const id = together ? run.id : undefined;
		ask.send({ name: 'recordRunThrough', args: [run.date, run.startedAt, entries, id] }, { done: () => onclose(true) });
	}

	const markLabel = (m: Mark | null) => {
		const label = MARKS.find((x) => x.key === m)?.label;
		return label ? whyText(label) : t.run_through_empty_mark();
	};
	/** 環節的名字，照畫面的語言（教練取的名字照原樣）。 */
	const phaseText = (p: Phase) => whyText(phaseWhy(p));

	/** 新的全上 id：r 加 12 個字的亂數（ADR 0014）。 */
	function newRunId(): string {
		return 'r' + Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join('');
	}
</script>

<section class="sheet" aria-label={t.run_through_record()}>
	<header>
		<h3>{joined ? t.run_through_join_title({ name: joined.people[0]?.name ?? '', n: number }) : t.run_through_record()}</h3>
		{#if together}
			<p>{t.run_through_together_hint()}</p>
		{/if}
		<p>{t.run_through_how()}</p>
	</header>

	{#if together}
		<div class="picks" role="group" aria-label={t.run_through_my_groups()}>
			<span class="picks-label">{t.run_through_my_groups()}</span>
			{#each keys as key (key)}
				<button type="button" aria-pressed={myKeys.includes(key)} onclick={() => pick(key)}
					>{whyText(runKeyLabel(flow, key))}{' '}<small>{pickText(key)}</small></button
				>
			{/each}
		</div>
		{#if allTaken}<p class="hint">{t.run_through_all_taken()}</p>{/if}
		{#if refused}<p class="error" {@attach revealAlert()}>{refused}</p>{/if}
	{/if}

	{#each blocks as { action, whos }, index (action.id)}
		{@const phases = action.successRate?.phases ?? []}
		{@const off = skipped.includes(action.id)}
		{@const columns = whos.map((w) => ({ ...w, marks: column(action, w.who), mine: isMine(action, w.who) }))}
		<section class="block" class:off aria-label={whyText(actionWhy(action))}>
			<div class="head">
				<h4><span class="swatch" style:--c={actionColor(action)}></span>{whyText(actionWhy(action))}</h4>
				<button type="button" class="stop" aria-pressed={off} onclick={() => toggleSkip(action.id)}>{t.run_through_not_done()}</button>
				{#if index < blocks.length - 1}
					<button type="button" class="stop" aria-pressed={restSkipped(index)} onclick={() => toggleRest(index)}
						>{t.run_through_rest_not_done()}</button
					>
				{/if}
			</div>
			<div class="scroll">
				<table>
					<thead>
						<tr>
							<th scope="col">{t.practice_phase()}</th>
							{#each columns as col (col.who)}
								<th scope="col" class:other={!col.mine}
									>{whyText(col.name)}{#if !col.mine && otherText(action, col.who)}{' '}<small>{otherText(action, col.who)}</small
										>{/if}</th
								>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each phases as p, i (p.id)}
							<tr>
								<th scope="row">{phaseText(p)}</th>
								{#each columns as col (col.who)}
									{@const m = col.marks[i]}
									<td class:other={!col.mine}>
										{#if col.mine}
											<button
												type="button"
												class="slot {m === '✓' ? 'ok' : m === '△' ? 'minor' : m === '✗' ? 'fail' : ''}"
												aria-label="{whyText(col.name)} {phaseText(p)} {markLabel(m)}"
												disabled={m === null}
												onclick={() => m && tap(action, col.who, p.id, m)}>{m ?? ''}</button
											>
										{:else}
											<button
											type="button"
											class="slot"
											aria-label={t.run_through_others_cell({ who: whyText(col.name), phase: phaseText(p) })}
											disabled>—</button
										>
										{/if}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/each}

	{#if ask.error}<p class="error" {@attach revealAlert(ask.failures)}>{ask.error}</p>{/if}

	{#if confirming}
		<ConfirmList
			message={t.run_through_discard_question()}
			items={[]}
			confirmLabel={t.run_through_discard()}
			cancelLabel={t.run_through_keep_recording()}
			onconfirm={discard}
			oncancel={() => {
				confirming = false;
				leaving = null;
			}}
		/>
	{:else}
		<footer>
			<button type="button" class="primary" disabled={!!together && !entries.length} onclick={save}
				>{together
					? (entries.length === 1 ? t.run_through_save_mine_one : t.run_through_save_mine)({ n: entries.length })
					: t.run_through_save()}</button
			>
			<button type="button" onclick={cancel}>{t.practice_cancel()}</button>
		</footer>
	{/if}
</section>

<style>
	.sheet {
		--ok: #15803d;
		--minor: #b45309;
		display: grid;
		/* 人多時只有表格自己左右捲（.scroll），不把畫面撐開 */
		grid-template-columns: minmax(0, 1fr);
		gap: 16px;
		padding: 12px;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 10px;
	}
	h3,
	h4 {
		margin: 0;
	}
	header p {
		margin: 4px 0 0;
		color: var(--muted);
		font-size: 13px;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 8px;
	}
	h4 {
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
	.stop {
		padding: 4px 10px;
		font-size: 13px;
	}
	.stop[aria-pressed='true'] {
		background: var(--ink);
		border-color: var(--ink);
		color: #fff;
	}
	.off table {
		opacity: 0.5;
	}
	.scroll {
		overflow-x: auto;
	}
	table {
		border-collapse: collapse;
	}
	th,
	td {
		border: 1px solid var(--line);
		padding: 6px 10px;
		text-align: center;
		white-space: nowrap;
	}
	td {
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
	/* 40 人時表格很寬：「環節」那一欄往右捲也留在左邊，看得出每一列是哪個環節。 */
	tr > th:first-child {
		position: sticky;
		left: 0;
		z-index: 1;
	}
	tbody th {
		background: var(--surface);
	}
	/* 格子要大、好點；記號用顏色之外也寫出來。 */
	.slot {
		width: 100%;
		min-width: 72px;
		min-height: 40px;
		border: 0;
		border-radius: 0;
		background: transparent;
		font-size: 20px;
		font-weight: 700;
	}
	.slot.ok {
		color: var(--ok);
	}
	.slot.minor {
		color: var(--minor);
		background: #fdf0c4;
	}
	.slot.fail {
		color: var(--fail);
		background: #fde0dd;
	}
	.slot:disabled {
		cursor: default;
	}
	.error {
		margin: 0;
		color: var(--fail);
	}
	.picks {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}
	.picks-label {
		font-weight: 600;
		font-size: 13px;
	}
	.picks button {
		display: grid;
		justify-items: center;
		padding: 4px 10px;
	}
	.picks button[aria-pressed='true'] {
		background: var(--ink);
		border-color: var(--ink);
		color: #fff;
	}
	.picks small,
	th small {
		display: block;
		font-size: 11px;
		font-weight: 400;
	}
	.hint {
		margin: 0;
		color: var(--muted);
		font-size: 13px;
	}
	.other {
		background: var(--surface-2);
		color: var(--muted);
	}
	footer {
		display: flex;
		gap: 8px;
	}
	@media (pointer: coarse) {
		.slot {
			min-height: 56px;
		}
	}
	/* 印出來：只印表格，欄位跟著紙寬縮（人多時名字可以拆行），不印說明和按鈕 */
	@media print {
		.sheet {
			padding: 0;
			border: 0;
		}
		header p,
		.picks,
		.hint,
		.stop,
		footer {
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
		td {
			padding: 2px;
			font-size: 9px;
			white-space: normal;
			word-break: break-all;
		}
		.slot {
			min-width: 0;
			min-height: 0;
			padding: 0;
			font-size: 11px;
		}
	}
</style>
