<script lang="ts">
	// 記錄頁的一張卡：一組（騰翻、跳躍的動作是一個人）記分段練。
	// 每個環節三顆大按鈕 ✓ △ ✗；再按一次點著的那顆就取消。
	// 正在記的這一次（這次練、點了還沒存的記號、留哪些、哪些按不了、什麼時候存）都在 session.drill，卡片只畫、把點的傳進去：
	// 「整個」點好按「存這一次」才存，「全部 ✓ 存」補 ✓，跳過了前面的環節存之前就提醒；只有一個環節點了就存；
	// 「只練幾個環節」點到最後一個要練的環節、或點了 ✗ 就自動存（卡上寫一行怎麼用；點環節那一列的空白處也能勾），
	// 還在等同時在做的環節時，卡上多一顆「存這一次」、提示寫為什麼在等。換動作、換頁再回來還在，卡上標「還沒存」。
	// 下面一排是這天的每一次，全上記的用虛線框、只練幾個環節的用淡色框分出來，雲端流程還沒傳上去的後面黃色「沒傳」（#260）；「刪掉上一次」只刪這張卡記的分段練，刪了幾秒內可以救回（提示寫出刪了哪一次；提示走編輯器唯一的提示，不在卡上）。
	// 點那一排裡的某一次（全上記的也一樣）可以改它的記號（改到一半的記號、按不了的環節問 session.drill 給的那一份），或只刪掉那一次（也可以救回）。
	// 雲端流程別人記的那一次，記號後面小字寫名字（自己記的不寫，#257）。
	// 雲端流程（#258）：「刪掉上一次」寫成「刪掉我的上一次」，只刪自己記的（編輯者也是）；記錄者點別人記的那一次只看得到是誰記的，不能改、刪。
	import {
		MARKS,
		NOT_YET_MARK,
		NOT_YET_TITLE,
		attemptText,
		phaseColor,
		phaseWhy,
		type Action,
		type Attempt,
		type Phase
	} from '#lib/core';
	import { getEditorSession } from '#lib/editor-session.svelte.js';
	import type { AttemptEdit } from '#lib/drill-attempts.svelte.js';
	import { whyText, joinText } from '#lib/reason-text.js';
	import { m as t } from '#lib/paraglide/messages.js';
	import { removeWithRestore } from './record-notice';
	import { revealAlert } from './reveal';

	interface Props {
		/** 有記成功率、至少一個環節的動作。 */
		action: Action;
		/** 組 id；騰翻、跳躍的動作是隊員 id。 */
		who: string;
		/** 卡上寫的名字：「第 1 組 小美」或隊員名字。 */
		name: string;
		/** 全組的名字，寫在名字下面（只寫名字看不出這組有誰）；騰翻、跳躍沒有。 */
		people?: string[];
		/** 記在哪一天（YYYY-MM-DD）。 */
		date: string;
	}

	let { action, who, name, people, date }: Props = $props();

	const session = getEditorSession();
	const flow = $derived(session.flow!);
	/** 記一次、刪掉上一次、救回：紀錄改了交給 session 的「記」（不算復原的一步）。 */
	const ask = session.recordAsk();

	/** 這張卡正在記的一次（這次練、點了還沒存的記號、什麼時候存都在 session.drill；換動作、切頁再回來還在）。 */
	const drill = $derived(session.drill.card(action, who, date, ask));
	const phases = $derived(action.successRate?.phases ?? []);
	const whole = $derived(drill.whole);
	const picked = $derived(drill.picked);
	/** 這一次要練的環節，照順序。 */
	const planned = $derived(drill.planned);
	/** 卡上亮的記號。 */
	const shown = $derived(drill.shown);
	/** 按不了的環節（按鈕停用）：✗ 做完之後才開始的。整個做、只練幾個環節都一樣。 */
	const shut = $derived(drill.shut);
	/** 只練幾個環節、到了存的時機，還有同時在做的環節沒打：先不存，等它們打完。 */
	const waiting = $derived(drill.waiting.length > 0);
	/** 這組在這一天的每一次（分段練和全上），照記的先後。 */
	const today = $derived((action.successRate?.records ?? []).filter((r) => r.who === who && r.date === date));

	/** 只練幾個環節時點那一列的空白處（不是勾選框、名字、能按的記號）：跟點勾選框一樣。 */
	function pickRow(e: MouseEvent, id: string) {
		if (whole || (e.target as Element).closest('label, button:enabled')) return;
		drill.pick(id, !picked.includes(id));
	}

	/** 正在改的這一次（session.drill 給的一份，卡片握著；收起來、換頁、換動作就丟，不存）；沒在改是 null。 */
	let edit = $state<AttemptEdit | null>(null);
	/** 改的那一次（紀錄被別的地方拿掉了就收起來）。 */
	const edited = $derived(edit && today.find((r) => r.id === edit!.id));

	function openEdit(attempt: Attempt) {
		edit = edit?.id === attempt.id ? null : session.drill.edit(() => action, attempt.id, ask);
	}

	/** 刪掉這天的某一次的提示，例：已刪掉 ·✓（第 4 次）。 */
	const removedText = (attempt: Attempt) =>
		t.practice_removed_rep({ marks: attemptText(action, attempt), n: today.indexOf(attempt) + 1 });
	/** 環節的名字，照畫面的語言（教練取的名字照原樣）。 */
	const phaseText = (p: Phase) => whyText(phaseWhy(p));

	function removeEdited(attempt: Attempt) {
		edit = null;
		removeWithRestore(
			ask,
			session,
			removedText(attempt),
			{ name: 'deleteAttempt', args: [action.id, attempt.id] },
			({ attempt, index }) => ({ name: 'restoreAttempt', args: [action.id, attempt, index] })
		);
	}

	/** 自己記的（本機流程全是自己的；雲端流程別人記的、沒有記的人的在 session.practice.recordedBy 裡）。 */
	const mine = (r: Attempt) => !(r.id in session.practice.recordedBy);
	/** 「刪掉（我的）上一次」刪的那一次：這天自己最後記的一次分段練。 */
	const lastMine = $derived(today.findLast((r) => r.practice === 'drill' && mine(r)));
	/** 記錄者點到別人記的那一次：不能改、刪，寫是誰記的。 */
	const othersOnly = $derived(edited && session.practice.ownRecordsOnly && !mine(edited) ? edited : null);

	function removeLast() {
		const last = lastMine!;
		removeWithRestore(
			ask,
			session,
			removedText(last),
			{ name: 'deleteAttempt', args: [action.id, last.id] },
			({ attempt, index }) => ({ name: 'restoreAttempt', args: [action.id, attempt, index] })
		);
	}
</script>

<section class="card" aria-label={name}>
	<header>
		<div class="who">
			<b>{name}{#if drill.unsaved}<span class="unsaved">{t.practice_unsaved()}</span>{/if}</b>
			{#if people}<small>{joinText(people, t.practice_people)}</small>{/if}
		</div>
		<!-- 只有一個環節就沒得選，一定是整個做 -->
		{#if phases.length > 1}
			<div class="scope" role="radiogroup" aria-label={t.practice_scope_label({ name })}>
				<span>{t.practice_scope()}</span>
				<label
					><input type="radio" name="scope-{action.id}-{who}" checked={whole} onchange={() => drill.setWhole(true)} />{t.practice_scope_whole()}</label
				>
				<label
					><input type="radio" name="scope-{action.id}-{who}" checked={!whole} onchange={() => drill.setWhole(false)} />{t.practice_some_phases()}</label
				>
			</div>
		{/if}
	</header>
	{#if waiting}<p class="hint">{t.practice_hint_waiting()}</p>
	{:else if !whole}<p class="hint">{t.practice_hint_picked()}</p>{/if}

	<div class="phases">
		{#each phases as p (p.id)}
			{@const on = planned.includes(p) && !shut.includes(p.id)}
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions (鍵盤用勾選框) -->
			<div class="phase" class:off={!on} class:pickable={!whole} onclick={(e) => pickRow(e, p.id)}>
				{#if whole}
					<span class="phase-name"><span class="chip" style:--c={phaseColor(p)}></span>{phaseText(p)}</span>
				{:else}
					<label class="phase-name">
						<input type="checkbox" checked={picked.includes(p.id)} onchange={(e) => drill.pick(p.id, e.currentTarget.checked)} />
						<span class="chip" style:--c={phaseColor(p)}></span>{phaseText(p)}
					</label>
				{/if}
				<div class="marks">
					{#each MARKS as m (m.key)}
						<button
							type="button"
							class="mark {m.key === '✓' ? 'ok' : m.key === '△' ? 'minor' : 'fail'}"
							aria-label="{name} {phaseText(p)} {whyText(m.label)}"
							aria-pressed={shown[p.id] === m.key}
							disabled={!on}
							onclick={() => drill.tap(p.id, m.key)}>{m.key}</button
						>
					{/each}
				</div>
			</div>
		{/each}
	</div>

	<!-- 存檔鈕在右（靠近 ✓）。提示（已記下、已刪掉…救回）浮在練習畫面下方，不在卡上推動版面 -->
	{#if whole && phases.length > 1}
		<div class="save-row">
			<button type="button" class="save" disabled={!drill.unsaved} onclick={() => drill.save()}>{t.practice_save_rep()}</button>
			<button type="button" class="primary all-ok" onclick={() => drill.saveAllOk()}>{t.practice_save_all_ok()}</button>
		</div>
	{:else if waiting}
		<div class="save-row">
			<button type="button" class="save" onclick={() => drill.save()}>{t.practice_save_rep()}</button>
		</div>
	{/if}
	{#if drill.skipping}<p class="hint-warn">{t.practice_skipping()}</p>{/if}
	{#if ask.error}<p class="error" {@attach revealAlert(ask.failures)}>{ask.error}</p>{/if}

	<footer>
		{#if today.length}
			<ol class="day" aria-label={t.practice_day_reps()}>
				{#each today as r, i (r.id)}
					{@const run = r.practice === 'runThrough'}
					{@const kind = run ? t.practice_full_out() : r.whole ? t.practice_drill() : t.practice_some_phases()}
					{@const text = attemptText(action, r)}
					<li class:run class:partial={!r.whole} title={text.includes(NOT_YET_MARK) ? t.practice_kind_note({ kind, note: whyText(NOT_YET_TITLE) }) : kind}>
						<button
							type="button"
							aria-expanded={edit?.id === r.id}
							aria-label={t.practice_edit_rep_kind({ n: i + 1, kind, marks: text })}
							onclick={() => openEdit(r)}>{text}</button
						>{#if session.practice.recordedBy[r.id]}<small class="by">{session.practice.recordedBy[r.id]}</small>{/if}{#if session.practice.unsentRecords.has(r.id)}<small
								class="unsent">{t.practice_unsent()}</small
							>{/if}
					</li>
				{/each}
			</ol>
		{:else}
			<p class="none">{t.practice_none_that_day()}</p>
		{/if}
		<button
			type="button"
			class="undo-last"
			disabled={!lastMine}
			title={session.practice.sharedRecords ? t.practice_remove_mine_title() : t.practice_remove_last_title()}
			onclick={removeLast}>{session.practice.sharedRecords ? t.practice_remove_mine() : t.practice_remove_last()}</button
		>
	</footer>
	{#if edited}
		{@const n = today.indexOf(edited) + 1}
		<div class="edit" role="group" aria-label={t.practice_edit_rep({ n })}>
			<b>{edited.practice === 'runThrough' ? t.practice_edit_rep_full_out({ n }) : t.practice_edit_rep({ n })}</b>
			{#each phases as p (p.id)}
				<div class="phase">
					<span class="phase-name"><span class="chip" style:--c={phaseColor(p)}></span>{phaseText(p)}</span>
					<div class="marks">
						{#each MARKS as m (m.key)}
							<button
								type="button"
								class="mark {m.key === '✓' ? 'ok' : m.key === '△' ? 'minor' : 'fail'}"
								aria-label={t.practice_rep_phase_mark({ n, phase: phaseText(p), mark: whyText(m.label) })}
								aria-pressed={edit!.marks[p.id] === m.key}
								disabled={edit!.shut.includes(p.id)}
								onclick={() => edit!.tap(p.id, m.key)}>{m.key}</button
							>
						{/each}
					</div>
				</div>
			{/each}
			{#if othersOnly}
				{@const by = session.practice.recordedBy[othersOnly.id]}
				<p class="hint">{by ? t.practice_recorded_by({ name: by }) : t.practice_recorded_from_file()}</p>
			{/if}
			<div class="edit-row">
				{#if !othersOnly}<button type="button" class="danger" onclick={() => removeEdited(edited)}>{t.practice_delete_rep()}</button>{/if}
				<button type="button" onclick={() => (edit = null)}>{othersOnly ? t.practice_close_edit() : t.practice_cancel_edit()}</button>
				{#if !othersOnly}<button type="button" class="primary" onclick={() => edit!.save(() => (edit = null))}>{t.practice_save_edit()}</button>{/if}
			</div>
		</div>
	{/if}
</section>

<style>
	.card {
		--ok: #15803d;
		--minor: #b45309;
		display: grid;
		align-content: start;
		gap: 10px;
		padding: 12px;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 10px;
	}
	header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 6px 12px;
	}
	.who {
		display: grid;
		min-width: 0;
	}
	header b {
		font-size: 15px;
	}
	.unsaved {
		margin-left: 6px;
		padding: 0 5px;
		border-radius: 4px;
		background: var(--surface-2);
		color: var(--minor);
		font-size: 12px;
		font-weight: 400;
	}
	.who small {
		color: var(--muted);
		font-size: 12px;
	}
	.scope {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 10px;
		font-size: 13px;
	}
	.scope > span {
		color: var(--muted);
	}
	.scope label {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		cursor: pointer;
	}
	/* 一個環節一列，照順序從上往下：名字在左，三顆按鈕在右。 */
	.phases {
		display: grid;
		gap: 6px;
	}
	.phase {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 4px 4px 4px 8px;
		border: 1px solid var(--line-soft);
		border-radius: 8px;
	}
	.phase.off {
		background: var(--surface-2);
	}
	.phase-name {
		flex: 1;
		min-width: 0;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 14px;
		font-weight: 700;
	}
	label.phase-name,
	.phase.pickable {
		cursor: pointer;
	}
	/* 勾選框放大，好點 */
	label.phase-name input {
		width: 20px;
		height: 20px;
		margin: 0;
	}
	/* 點沒勾的環節停用的記號：交給那一列去勾 */
	.phase.pickable .mark:disabled {
		pointer-events: none;
	}
	.hint {
		margin: -4px 0 0;
		color: var(--muted);
		font-size: 12px;
	}
	.chip {
		flex: none;
		width: 10px;
		height: 10px;
		border-radius: 3px;
		background: var(--c);
	}
	.marks {
		flex: none;
		display: flex;
		gap: 4px;
	}
	/* 大按鈕：字寫 ✓ △ ✗，不只靠顏色；點了的那顆變實心。 */
	.mark {
		width: 48px;
		height: 48px;
		padding: 0;
		border-width: 2px;
		border-radius: 10px;
		font-size: 22px;
		font-weight: 700;
	}
	.mark.ok {
		color: var(--ok);
	}
	.mark.minor {
		color: var(--minor);
	}
	.mark.fail {
		color: var(--fail);
	}
	.mark[aria-pressed='true'] {
		color: #fff;
	}
	.mark.ok[aria-pressed='true'] {
		background: var(--ok);
		border-color: var(--ok);
	}
	.mark.minor[aria-pressed='true'] {
		background: var(--minor);
		border-color: var(--minor);
	}
	.mark.fail[aria-pressed='true'] {
		background: var(--fail);
		border-color: var(--fail);
	}
	/* 只練幾個環節時沒選的環節、「整個」✗ 後面的環節：按鈕變灰 */
	.mark:disabled {
		color: var(--muted);
		background: var(--surface-2);
	}
	/* 手指（ADR 0005）：再大一點 */
	@media (pointer: coarse) {
		.mark {
			width: 56px;
			height: 56px;
			font-size: 26px;
		}
		.scope label {
			min-height: 40px;
		}
		label.phase-name input {
			width: 26px;
			height: 26px;
		}
	}
	footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.day {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.day li {
		border: 1px solid var(--line);
		border-radius: 5px;
		background: var(--surface-2);
	}
	/* 點一次就能改它 */
	.day button {
		padding: 0 5px;
		border: 0;
		border-radius: 4px;
		background: transparent;
		font-size: 14px;
		letter-spacing: 1px;
	}
	.day button[aria-expanded='true'] {
		box-shadow: 0 0 0 2px var(--sel);
	}
	/* 雲端流程別人記的：記號後面小字寫名字 */
	.day .by {
		padding-right: 5px;
		font-size: 11px;
		color: var(--muted);
	}
	/* 還沒傳上去的那一次（#260）：黃色小標，傳上去就拿掉。 */
	.day .unsent {
		margin-right: 4px;
		padding: 0 4px;
		border-radius: 4px;
		background: #fef3c7;
		color: #92400e;
		font-size: 11px;
		font-weight: 700;
	}
	/* 全上記的那幾筆：虛線框，跟分段練分開。 */
	.day li.run {
		border: 2px dashed var(--sel);
		background: var(--surface);
	}
	/* 只練幾個環節的那幾次：淡色框，跟整個做中途 ✗ 分開 */
	.day li.partial {
		border-style: dotted;
		background: var(--surface);
		color: var(--muted);
	}
	.none {
		color: var(--muted);
		font-size: 12px;
	}
	.save-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
		min-height: 36px;
	}
	.undo-last {
		flex: none;
	}
	.edit {
		display: grid;
		gap: 6px;
		padding: 8px;
		border: 1px solid var(--sel);
		border-radius: 8px;
	}
	.edit-row {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 8px;
	}
	.edit-row .danger {
		margin-right: auto;
	}
</style>
