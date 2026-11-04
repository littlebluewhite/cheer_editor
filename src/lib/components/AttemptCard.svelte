<script lang="ts">
	// 記錄頁的一張卡：一組（騰翻、跳躍的動作是一個人）記分段練。
	// 每個環節三顆大按鈕 ✓ △ ✗；照順序點，點到最後一個要練的環節、或點了 ✗，就自動存成一次（存成核心 keptAttempt 給的樣子：✗ 後面空著）。
	// 點到一半的記號只在這張卡上，還沒進流程：換動作、換頁（卡不見了）就不存。
	import {
		MARKS,
		attemptText,
		deleteLastAttempt,
		keptAttempt,
		phaseColor,
		phaseLabel,
		recordAttempt,
		type Action,
		type Mark
	} from '#lib/core';
	import { getEditorSession } from '#lib/editor-session.svelte.js';
	import { Ask } from './ask.svelte.js';

	interface Props {
		/** 有記成功率、至少一個環節的動作。 */
		action: Action;
		/** 第幾組；騰翻、跳躍的動作是隊員 id。 */
		who: number | string;
		/** 卡上寫的名字：「第 1 組 小美」或隊員名字。 */
		name: string;
		/** 記在哪一天（YYYY-MM-DD）。 */
		date: string;
	}

	let { action, who, name, date }: Props = $props();

	const session = getEditorSession();
	const flow = $derived(session.flow!);
	/** 記一次、刪掉上一次：紀錄改了交給 session 的「記」（不算復原的一步）。 */
	const ask = new Ask((f) => session.record(f));

	/** 這次練：整個（true）或只練幾個環節（false）。換下一次也留著。 */
	let whole = $state(true);
	/** 只練幾個環節時，要練的環節 id。 */
	let picked = $state<string[]>([]);
	/** 這一次已經點的記號（還沒存）。 */
	let marks = $state<Record<string, Mark>>({});

	const phases = $derived(action.successRate?.phases ?? []);
	/** 這一次要練的環節，照順序。 */
	const planned = $derived(whole ? phases : phases.filter((p) => picked.includes(p.id)));
	/** 卡上亮的記號：會存下來的樣子。 */
	const shown = $derived(keptAttempt(action, whole, marks).marks);
	/** 這組在這一天的每一次，照記的先後。 */
	const today = $derived((action.successRate?.records ?? []).filter((r) => r.who === who && r.date === date));

	function setWhole(value: boolean) {
		whole = value;
		marks = {};
	}

	function pick(id: string, on: boolean) {
		picked = on ? [...picked, id] : picked.filter((p) => p !== id);
		marks = {};
	}

	/** 點一個記號：點到最後一個要練的環節、或點了 ✗，就存成一次（留哪些記號、算不算整個做由核心決定）。 */
	function tap(phaseId: string, mark: Mark) {
		const next = { ...marks, [phaseId]: mark };
		if (mark !== '✗' && phaseId !== planned.at(-1)?.id) {
			marks = next;
			return;
		}
		marks = {};
		ask.send(() => recordAttempt(flow, action.id, { date, who, practice: 'drill', whole, marks: next }));
	}

	function removeLast() {
		ask.send(() => deleteLastAttempt(flow, action.id, who, date));
	}
</script>

<section class="card" aria-label={name}>
	<header>
		<b>{name}</b>
		<div class="scope" role="radiogroup" aria-label="{name} 這次練">
			<span>這次練</span>
			<label><input type="radio" name="scope-{action.id}-{who}" checked={whole} onchange={() => setWhole(true)} />整個</label>
			<label
				><input type="radio" name="scope-{action.id}-{who}" checked={!whole} onchange={() => setWhole(false)} />只練幾個環節</label
			>
		</div>
	</header>

	<div class="phases">
		{#each phases as p (p.id)}
			{@const on = planned.includes(p)}
			<div class="phase" class:off={!on}>
				{#if whole}
					<span class="phase-name"><span class="chip" style:--c={phaseColor(p)}></span>{phaseLabel(p)}</span>
				{:else}
					<label class="phase-name">
						<input type="checkbox" checked={picked.includes(p.id)} onchange={(e) => pick(p.id, e.currentTarget.checked)} />
						<span class="chip" style:--c={phaseColor(p)}></span>{phaseLabel(p)}
					</label>
				{/if}
				<div class="marks">
					{#each MARKS as m (m.key)}
						<button
							type="button"
							class="mark {m.key === '✓' ? 'ok' : m.key === '△' ? 'minor' : 'fail'}"
							aria-label="{name} {phaseLabel(p)} {m.label}"
							aria-pressed={shown[p.id] === m.key}
							disabled={!on}
							onclick={() => tap(p.id, m.key)}>{m.key}</button
						>
					{/each}
				</div>
			</div>
		{/each}
	</div>

	{#if ask.error}<p class="error" role="alert">{ask.error}</p>{/if}

	<footer>
		{#if today.length}
			<ol class="day" aria-label="這天的每一次">
				{#each today as r (r.id)}<li>{attemptText(action, r)}</li>{/each}
			</ol>
		{:else}
			<p class="none">這天還沒記</p>
		{/if}
		<button type="button" class="undo-last" disabled={!today.length} onclick={removeLast}>刪掉上一次</button>
	</footer>
</section>

<style>
	.card {
		--ok: #15803d;
		--minor: #b45309;
		--fail: #b91c1c;
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
	header b {
		font-size: 15px;
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
	label.phase-name {
		cursor: pointer;
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
	/* 只練幾個環節時，沒選的環節按鈕變灰 */
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
		padding: 0 5px;
		border: 1px solid var(--line);
		border-radius: 5px;
		background: var(--surface-2);
		font-size: 14px;
		letter-spacing: 1px;
	}
	.none {
		color: var(--muted);
		font-size: 12px;
	}
	.undo-last {
		flex: none;
	}
</style>
