<script lang="ts">
	// 檢視模式的前後八拍：一個八拍一列，每列都畫成八格（像編輯模式的拍點格子），前後的八拍也看得清楚在做什麼。
	// 每列上面一行寫第幾個八拍、這一列開始的站位（和「我」的走位），下面 1–8 的數字格，再下面這一列碰到的每個動作一排：
	// 動作名字（點了在下面看人和任務角色）、拍點和環節；沒拍點的畫一條色條標佔的格子。列裡不寫一長串人。
	// 播放頭那個八拍框起來、這一拍那格亮；點前後的八拍跳過去。
	// 電腦前一個、這個、後三個；手機放不下，只放這個和下一個（docs/adr/0005-ipad-touch.md）。
	// 選了「我」就只寫我的動作、拍點和任務角色，沒選是全隊。列的內容都問流程核心。
	import { actionWhy, eightCountRows, nearbyEights, type EightCountRow, type Flow } from '#lib/core';
	import { actionColor } from './category-colors';
	import EightCountCueLine from './EightCountCueLine.svelte';
	import { whyText } from '#lib/reason-text.js';
	import { m } from '#lib/paraglide/messages.js';

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
		/** 點到的動作（名字標起來）；沒點是 null。 */
		picked: string | null;
		/** 點動作名字：選它（再點一次取消）。 */
		onpick: (actionId: string | null) => void;
	}

	let { flow, memberId, sec, before, after, onjump, picked, onpick }: Props = $props();

	// 列只跟著流程和「我」重算；播放頭動只換位置和亮的那格。
	const rows = $derived(eightCountRows(flow, memberId || null, false));
	const near = $derived(nearbyEights(flow, memberId || null, sec, before, after, rows));

	const where = (r: EightCountRow) =>
		whyText(r.eight === null ? r.segmentWhy : { code: 'video_frame_row', segment: r.segmentWhy, n: r.eight });
	/** 前後八拍的讀屏說明：動作、站位、我的走位。 */
	const summary = (r: EightCountRow) =>
		[...r.lanes.map((l) => `${l.continued ? '↳ ' : ''}${whyText(actionWhy(l))}`), ...r.formations.map((f) => whyText(f.caption)), ...r.walks.map(whyText)].join(
			m.timeline_summary_separator()
		);
	/** 換段的那一列（段的第一個八拍、口號段）前面寫段名；這個八拍一律寫。 */
	const newSegment = (r: EightCountRow) => r.eight === null || r.eight === 1;
	const colorOf = (id: string) => {
		const a = flow.actions.find((x) => x.id === id);
		return a ? actionColor(a) : 'var(--muted)';
	};
	/** 點列的空白處也跳過去（鍵盤用列頭的按鈕）；點動作名字不跳。 */
	function rowClick(e: MouseEvent, row: EightCountRow) {
		if ((e.target as HTMLElement).closest('button')) return;
		onjump(row.startSec);
	}
</script>

<section class="now-eight" aria-label={m.timeline_nearby()}>
	{#if near.rows[before]}
		{#each near.rows as row, i (i)}
			{#if !row}
				<div class="slot blank" data-slot="" aria-hidden="true"></div>
			{:else}
				{@const now = i === before}
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions (鍵盤用列頭的「跳到…」按鈕) -->
				<div
					class="slot"
					class:now
					class:near={!now}
					class:whole={now && near.beat === null}
					data-slot={row.eight ?? '整段'}
					aria-current={now ? 'step' : undefined}
					onclick={now ? undefined : (e) => rowClick(e, row)}
				>
					{#snippet head()}
						{#if now || newSegment(row)}<b class="seg">{whyText(row.segmentWhy)}</b>{/if}
						<span class="num">{row.eight === null ? whyText(row.eightText) : m.timeline_eight({ n: whyText(row.eightText) })}</span>
						{#each row.formations as f (f.number)}<span class="tag">{whyText(f.caption)}</span>{/each}
						{#each row.walks as w, j (j)}<span class="tag">{whyText(w)}</span>{/each}
					{/snippet}
					{#if now}
						<header class="head">{@render head()}</header>
					{:else}
						<button type="button" class="head" aria-label={m.timeline_jump_to({ where: where(row), summary: summary(row) })} onclick={() => onjump(row.startSec)}>{@render head()}</button>
					{/if}
					{#if row.eight !== null}
						<!-- 沒有拍點也畫 1–8，這一拍那格照樣亮 -->
						<EightCountCueLine line={null} eight={row.eight} now={now ? near.half : null} />
					{/if}
					{#each row.lanes as lane (lane.actionId)}
						<div class="lane">
							<button
								type="button"
								class="name"
								class:picked={picked === lane.actionId}
								aria-pressed={picked === lane.actionId}
								title={m.timeline_who_does()}
								onclick={() => onpick(picked === lane.actionId ? null : lane.actionId)}
								>{lane.continued ? '↳ ' : ''}{whyText(actionWhy(lane))}{#if lane.role}<span class="role">{whyText(lane.role)}</span>{/if}</button
							>
							{#if row.eight !== null}
								<EightCountCueLine
									line={lane}
									eight={row.eight}
									now={now ? near.half : null}
									named={false}
									numbers={false}
									bar={{ from: lane.from, to: lane.to, color: colorOf(lane.actionId) }}
								/>
							{/if}
						</div>
					{/each}
					{#if now && !row.lanes.length && !row.formations.length && !row.walks.length}
						<div class="muted">{m.timeline_eight_empty()}</div>
					{/if}
				</div>
			{/if}
		{/each}
	{:else}
		<div class="muted">{m.time_no_segments()}</div>
	{/if}
</section>

<style>
	.now-eight {
		display: grid;
		align-content: start;
		gap: 6px;
		min-height: 0;
		overflow-y: auto;
		padding: 8px;
		border-top: 1px solid var(--line);
		background: var(--surface);
		font-size: 13px;
	}
	.slot.blank {
		display: none;
	}
	.slot {
		display: grid;
		gap: 2px;
		padding: 6px 8px;
		border: 2px solid transparent;
		border-radius: var(--radius);
	}
	.slot.near {
		cursor: pointer;
	}
	.slot.near:hover {
		background: var(--paper);
	}
	/* 這個八拍：框起來 */
	.slot.now {
		border-color: var(--now);
	}
	/* 口號段不數拍：整列亮 */
	.slot.now.whole {
		background: color-mix(in srgb, var(--now) 12%, transparent);
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 8px;
		align-items: baseline;
		justify-content: flex-start;
		width: 100%;
		padding: 0;
		border: none;
		background: none;
		color: var(--text);
		font: inherit;
		text-align: left;
		cursor: inherit;
	}
	.slot.near .head {
		min-height: 0;
	}
	/* 這一列在哪：這個八拍比內容大一號，手機上一眼看得到 */
	.slot.now .head {
		font-size: 15px;
	}
	.seg {
		font-weight: 600;
	}
	.num {
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.slot.near .num {
		color: var(--muted);
	}
	/* 這一列開始的站位、我的走位：小標 */
	.tag {
		padding: 0 6px;
		border-radius: 999px;
		background: var(--paper);
		border: 1px solid var(--line);
		font-size: 12px;
		font-weight: 400;
	}
	.lane {
		display: grid;
		gap: 1px;
	}
	.name {
		justify-self: start;
		max-width: 100%;
		min-height: 0;
		padding: 0 4px;
		border: none;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--text);
		font: inherit;
		font-size: 12px;
		font-weight: 600;
		text-align: left;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		cursor: pointer;
	}
	/* 觸控螢幕：右邊欄的按鈕一律 40px（app.css），動作名字縮回 28px，不然每排撐太高 */
	@media (pointer: coarse) {
		.slot .lane .name {
			min-height: 28px;
		}
	}
	.name:hover {
		text-decoration: underline;
	}
	.name.picked {
		background: color-mix(in srgb, var(--now) 15%, transparent);
	}
	.role {
		margin-left: 6px;
		font-weight: 400;
		color: var(--muted);
	}
	.muted {
		color: var(--muted);
	}
	.now-eight :global(.cue-line) {
		margin: 0;
	}
	/* 1–8 的數字在畫面上要看得清楚（列印的淡灰對比不到 4.5:1） */
	.now-eight :global(.n:not(.lit)) {
		color: var(--muted);
	}
</style>
