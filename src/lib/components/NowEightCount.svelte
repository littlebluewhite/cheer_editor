<script lang="ts">
	// 檢視模式的前後八拍：播放頭那個八拍寫完整、這一拍那格亮，前後的八拍各一行（點了跳過去）。
	// 電腦的右邊欄前三個、這個、後三個；手機放不下，只放這個和下一個（docs/adr/0005-ipad-touch.md）。
	// 選了「我」就是我的個人表（我的動作、任務角色、走位），沒選是全隊。列的內容都問流程核心。
	import { actionLabel, eightCountRows, nearbyEights, type EightCountRow, type Flow } from '#lib/core';
	import EightCountCueLine from './EightCountCueLine.svelte';

	interface Props {
		flow: Flow;
		/** 只看這個人；'' 是全隊。 */
		memberId: string;
		/** 播放頭（全域秒數）。 */
		sec: number;
		/** 這個八拍前面、後面各放幾個。 */
		before: number;
		after: number;
		/** 點前後的八拍：播放頭跳到那個八拍的第 1 拍（全域秒數）。 */
		onjump: (sec: number) => void;
	}

	let { flow, memberId, sec, before, after, onjump }: Props = $props();

	// 列只跟著流程和「我」重算；播放頭動只換位置和亮的那格。
	const rows = $derived(eightCountRows(flow, memberId || null, false));
	const near = $derived(nearbyEights(flow, memberId || null, sec, before, after, rows));

	const where = (r: EightCountRow) => (r.eight === null ? r.segmentLabel : `${r.segmentLabel} 第 ${r.eight} 個八拍`);
	/** 前後的八拍只寫一行：開始的動作（和誰）、繼續的動作、我的走位、站位。 */
	const summary = (r: EightCountRow) =>
		[
			...r.actions.map((a) => `${actionLabel(a)}${a.who ? `：${a.who}` : ''}`),
			...r.continuing.map((name) => `↳ ${name}`),
			...r.walks,
			...r.formations.map((f) => f.caption)
		].join('　');
	/** 換段的那一列（段的第一個八拍、口號段）前面寫段名（這個八拍的標題本來就寫）。 */
	const newSegment = (r: EightCountRow) => r.eight === null || r.eight === 1;
</script>

<section class="now-eight" aria-label="前後八拍">
	{#if near.rows[before]}
		{#each near.rows as row, i (i)}
			{#if !row}
				<div class="slot blank" data-slot="" aria-hidden="true"></div>
			{:else if i === before}
				<div class="slot now" class:whole={near.beat === null} data-slot={row.eight ?? '整段'} aria-current="step">
					<header>
						<b>{row.segmentLabel}</b>
						<span>{row.eight === null ? row.eightText : `第 ${row.eightText} 個八拍`}</span>
					</header>
					{#each row.actions as a, j (j)}
						<div class="action"><b class="at">{a.at}</b> {actionLabel(a)}{#if a.who}：{a.who}{/if}</div>
					{/each}
					{#each row.ongoing as a, j (j)}
						<div class="muted">↳ {actionLabel(a)} 繼續・{a.at}{#if a.who}：{a.who}{/if}</div>
					{/each}
					{#each row.walks as w, j (j)}
						<div>{w}</div>
					{/each}
					{#each row.formations as f (f.number)}
						<div class="muted">{f.caption}</div>
					{/each}
					{#if !row.actions.length && !row.ongoing.length && !row.walks.length && !row.formations.length}
						<div class="muted">這個八拍沒有新的動作、站位</div>
					{/if}
					{#each row.cues as line, j (j)}
						<EightCountCueLine {line} eight={row.eight} now={near.half} />
					{:else}
						<!-- 沒有拍點也畫 1–8，這一拍那格照樣亮 -->
						{#if row.eight !== null}<EightCountCueLine line={null} eight={row.eight} now={near.half} />{/if}
					{/each}
				</div>
			{:else}
				<button type="button" class="slot near" data-slot={row.eight ?? '整段'} aria-label="跳到{where(row)}：{summary(row)}" onclick={() => onjump(row.startSec)}>
					{#if newSegment(row)}<span class="seg">{row.segmentLabel}</span>{/if}
					<span class="num">{row.eight ?? '整段'}</span>
					<span class="sum">{summary(row)}</span>
				</button>
			{/if}
		{/each}
	{:else}
		<div class="muted">還沒有段</div>
	{/if}
</section>

<style>
	.now-eight {
		display: grid;
		align-content: start;
		gap: 2px;
		min-height: 0;
		overflow-y: auto;
		padding: 8px;
		border-top: 1px solid var(--line);
		background: var(--surface);
		font-size: 13px;
	}
	/* 前後的八拍和空格一樣高：這個八拍一直在同一個位置 */
	.slot.near,
	.slot.blank {
		height: 26px;
	}
	/* 觸控螢幕的按鈕至少 40px（app.css）：空格跟著一樣高，不然開頭幾個八拍這個八拍會往下掉 */
	@media (pointer: coarse) {
		.slot.near,
		.slot.blank {
			height: 40px;
		}
	}
	.slot.near {
		display: flex;
		gap: 8px;
		align-items: center;
		justify-content: flex-start;
		width: 100%;
		min-width: 0;
		padding: 0 6px;
		border: none;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--muted);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.slot.near:hover {
		background: var(--paper);
		color: var(--text);
	}
	.seg {
		flex-shrink: 0;
		font-weight: 600;
		color: var(--text);
	}
	.num {
		flex: 0 0 2.5em;
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}
	.sum {
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	/* 這個八拍：框起來，寫完整 */
	.slot.now {
		display: grid;
		gap: 4px;
		margin: 2px 0;
		padding: 8px 10px;
		border: 2px solid var(--now);
		border-radius: var(--radius);
	}
	/* 口號段不數拍：整列亮 */
	.slot.now.whole {
		background: color-mix(in srgb, var(--now) 12%, transparent);
	}
	/* 這一列在哪：比內容大一號，手機上一眼看得到 */
	header {
		display: flex;
		gap: 8px;
		align-items: baseline;
		font-size: 15px;
		font-weight: 600;
	}
	.at {
		font-variant-numeric: tabular-nums;
	}
	.muted {
		color: var(--muted);
	}
	/* 拍點那一排的動作名字放上面一行，8 格拿整個寬度 */
	.now-eight :global(.cue-line) {
		flex-wrap: wrap;
	}
	.now-eight :global(.cue-name) {
		flex-basis: 100%;
	}
	/* 1–8 的數字在畫面上要看得清楚（列印的淡灰對比不到 4.5:1） */
	.now-eight :global(.n:not(.lit)) {
		color: var(--muted);
	}
</style>
