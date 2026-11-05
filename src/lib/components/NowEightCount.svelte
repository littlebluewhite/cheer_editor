<script lang="ts">
	// 手機檢視模式下面那一塊：八拍表裡播放頭現在這一列（docs/adr/0005-ipad-touch.md）。
	// 選了「我」就是我的個人表那一列（我的動作、任務角色、走位），沒選是全隊。列的內容都問流程核心。
	import { actionLabel, eightCountRows, type Flow } from '#lib/core';
	import EightCountCueLine from './EightCountCueLine.svelte';

	interface Props {
		flow: Flow;
		/** 只看這個人；'' 是全隊。 */
		memberId: string;
		/** 播放頭（全域秒數）。 */
		sec: number;
	}

	let { flow, memberId, sec }: Props = $props();

	// 列只跟著流程和「我」重算；播放頭動只換一列。
	const rows = $derived(eightCountRows(flow, memberId || null));
	const row = $derived(rows.findLast((r) => r.startSec <= sec + 1e-6) ?? rows[0]);
</script>

<section class="now-eight" aria-label="八拍表這一列">
	{#if row}
		<header>
			<b>{row.segmentLabel}</b>
			<span>{row.eight === null ? row.eightText : `第 ${row.eightText} 個八拍`}</span>
		</header>
		{#each row.actions as a, j (j)}
			<div class="action"><b class="at">{a.at}</b> {actionLabel(a)}{#if a.who}：{a.who}{/if}</div>
		{/each}
		{#each row.continuing as name, j (j)}
			<div class="muted">↳ {name} 繼續</div>
		{/each}
		{#each row.walks as w, j (j)}
			<div>{w}</div>
		{/each}
		{#each row.formations as f (f.number)}
			<div class="muted">{f.caption}</div>
		{/each}
		{#if !row.actions.length && !row.continuing.length && !row.walks.length && !row.formations.length}
			<div class="muted">這一列沒有新的動作、站位</div>
		{/if}
		{#each row.cues as line, j (j)}
			<EightCountCueLine {line} eight={row.eight} />
		{/each}
	{:else}
		<div class="muted">還沒有段</div>
	{/if}
</section>

<style>
	.now-eight {
		display: grid;
		align-content: start;
		gap: 4px;
		min-height: 0;
		overflow-y: auto;
		padding: 10px 12px;
		border-top: 1px solid var(--line);
		background: var(--surface);
		font-size: 13px;
	}
	header {
		display: flex;
		gap: 8px;
		align-items: baseline;
	}
	.at {
		font-variant-numeric: tabular-nums;
	}
	.muted {
		color: var(--muted);
	}
	/* 手機很窄：拍點那一排的動作名字放上面一行，8 格拿整個寬度 */
	.now-eight :global(.cue-line) {
		flex-wrap: wrap;
	}
	.now-eight :global(.cue-name) {
		flex-basis: 100%;
	}
</style>
