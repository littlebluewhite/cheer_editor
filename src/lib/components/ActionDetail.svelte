<script lang="ts">
	// 檢視模式右邊欄：點到的動作的詳細內容（人、任務角色、拍點、備註），只能看。字都問流程核心。
	import {
		actionLabel,
		atTextWithUnit,
		beatSpanText,
		cueText,
		lengthTextWithUnit,
		memberName,
		segmentSpans,
		whoName,
		type Action,
		type Flow
	} from '#lib/core';
	import { actionColor } from './category-colors';

	interface Props {
		flow: Flow;
		action: Action;
	}

	let { flow, action }: Props = $props();

	const span = $derived(segmentSpans(flow).find((s) => s.segment.id === action.segmentId));
	/** 「第 1 段 1-1 到 2-8・16 拍」；口號段「口號 1 3.0 秒・2.0 秒」。 */
	const when = $derived.by(() => {
		if (!span) return '';
		const { segment, label } = span;
		const time =
			segment.kind === 'music'
				? beatSpanText(segment, action.start, action.length)
				: `${atTextWithUnit(segment, action.start)}・${lengthTextWithUnit(segment, action.length)}`;
		return `${label} ${time}`;
	});
	const cues = $derived(
		span
			? (action.cues ?? []).map((c) =>
					cueText(c.kind, c.word, beatSpanText(span.segment, action.start + c.at, c.len), whoName(flow, c.who))
				)
			: []
	);
</script>

<section class="action-detail" aria-label="動作詳細" style:--cat={actionColor(action)}>
	<header><span class="dot"></span><b>{actionLabel(action)}</b></header>
	<p class="when">{when}</p>
	<h3>人</h3>
	<ul>
		{#each action.members as m (m.memberId)}
			<li>{memberName(flow, m.memberId)}{#if m.role}<span class="role">{m.role}</span>{/if}</li>
		{/each}
	</ul>
	{#if cues.length}
		<h3>拍點</h3>
		<ul>
			{#each cues as c, i (i)}
				<li>{c}</li>
			{/each}
		</ul>
	{/if}
	{#if action.note}
		<h3>備註</h3>
		<p class="note">{action.note}</p>
	{/if}
</section>

<style>
	.action-detail {
		display: grid;
		gap: 6px;
		font-size: 13px;
	}
	header {
		display: flex;
		gap: 8px;
		align-items: center;
		font-size: 15px;
	}
	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--cat);
		flex: none;
	}
	.when {
		margin: 0;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}
	h3 {
		margin: 6px 0 0;
		font-size: 12px;
		color: var(--muted);
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 2px;
	}
	.role {
		margin-left: 6px;
		color: var(--muted);
	}
	.note {
		margin: 0;
		white-space: pre-wrap;
	}
</style>
