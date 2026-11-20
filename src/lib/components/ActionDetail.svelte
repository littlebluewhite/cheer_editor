<script lang="ts">
	// 檢視模式右邊欄：點到的動作的詳細內容（人、任務角色、拍點、備註），只能看。字都問流程核心。
	import {
		actionWhy,
		atWhy,
		beatSpanWhy,
		cueWhy,
		labelWhy,
		lengthWhy,
		memberName,
		roleWhy,
		segmentSpans,
		whoWhy,
		type Action,
		type Flow
	} from '#lib/core';
	import { whyText } from '#lib/reason-text.js';
	// 改名 msg：這個檔的 m 是動作裡的一個人
	import { m as msg } from '#lib/paraglide/messages.js';
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
		const { segment } = span;
		const time =
			segment.kind === 'music'
				? whyText(beatSpanWhy(segment, action.start, action.length))
				: msg.beat_range_span({ range: whyText(atWhy(segment, action.start)), length: whyText(lengthWhy(segment, action.length)) });
		return msg.time_in_segment({ segment: whyText(labelWhy(span)), at: time });
	});
	const cues = $derived(
		span
			? (action.cues ?? []).map((c) =>
					whyText(cueWhy(c.kind, c.word, beatSpanWhy(span.segment, action.start + c.at, c.len), whoWhy(flow, c.who)))
				)
			: []
	);
</script>

<section class="action-detail" aria-label={msg.action_form_detail()} style:--cat={actionColor(action)}>
	<header><span class="dot"></span><b>{whyText(actionWhy(action))}</b></header>
	<p class="when">{when}</p>
	<h3>{msg.action_form_detail_people()}</h3>
	<ul>
		{#each action.members as m (m.memberId)}
			<li>{memberName(flow, m.memberId)}{#if m.role}<span class="role">{whyText(roleWhy(m.role))}</span>{/if}</li>
		{/each}
	</ul>
	{#if cues.length}
		<h3>{msg.cue_grid_cues()}</h3>
		<ul>
			{#each cues as c, i (i)}
				<li>{c}</li>
			{/each}
		</ul>
	{/if}
	{#if action.note}
		<h3>{msg.text_length_note()}</h3>
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
