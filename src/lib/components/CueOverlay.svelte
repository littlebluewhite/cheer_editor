<script lang="ts">
	// 場地左邊那一欄的大字：播放頭在有拍點的動作裡（或開始前一個八拍）時，每個動作一張卡，
	// 寫現在這拍的步驟、拍子、手位（有長度的寫走到第幾拍），下面預告下一個。不吃滑鼠。
	import { actionWhy, cueWordWhy, cuesAt, whoWhy, type Cue, type Flow } from '#lib/core';
	import { getEditor } from '#lib/editor.svelte.js';
	import { m } from '#lib/paraglide/messages.js';
	import { whyText, joinText } from '#lib/reason-text.js';

	interface Props {
		flow: Flow;
	}
	let { flow }: Props = $props();

	/** 播放頭從編輯器 module 的播放拿。 */
	const { playback } = getEditor();
	const live = $derived(cuesAt(flow, playback.sec));
	/** 「high V（上層）」；給全部的只寫字。 */
	const word = (c: Cue) => whyText(cueWordWhy(c.kind, c.word));
	const nextText = (c: Cue) => (c.who ? m.eight_count_with_role({ name: word(c), role: whyText(whoWhy(flow, c.who)) }) : word(c));
	/** 「down、high V（上層）」。 */
</script>

{#if live.length}
	<section class="cues-now" aria-label={m.cue_grid_this_beat()} aria-live="polite">
		{#each live as l (l.action.id)}
			<div class="card">
				<span class="act">{whyText(actionWhy(l.action))}</span>
				{#if l.now.length}
					<span class="now">
						{#each l.now as n, i (i)}
							{@const to = whyText(whoWhy(flow, n.cue.who))}
							<b class="{n.cue.kind} {n.cue.kind === 'count' ? n.cue.word : ''}"
								>{#if to}<i>{to}</i>{' '}{/if}{word(n.cue)}{#if n.beats > 1}{' '}<small
										>{n.beat}/{n.beats}</small
									>{/if}</b
							>{' '}
						{/each}
					</span>
				{/if}
				{#if l.next}
					<span class="next">{m.cue_grid_next({ at: l.next.at, cues: joinText(l.next.cues.map(nextText)) })}</span>
				{/if}
			</div>
		{/each}
	</section>
{/if}

<style>
	/* 放在場地左邊那一欄（放大縮小下面），不蓋到場地。
	   不跟著左欄縮：左欄放不下就捲，卡不會被切掉下緣。 */
	.cues-now {
		display: flex;
		flex-direction: column;
		flex-shrink: 0;
		gap: 8px;
		max-width: 100%;
		overflow: hidden;
		pointer-events: none;
	}
	.card {
		display: grid;
		justify-items: start;
		gap: 4px;
		padding: 8px 12px;
		border-radius: 10px;
		background: rgba(255, 255, 255, 0.94);
		box-shadow: var(--shadow-pop);
	}
	.act {
		font-size: 12px;
		color: var(--muted);
	}
	.now {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.now b {
		padding: 2px 10px;
		border-radius: 6px;
		font-size: 24px;
		line-height: 1.2;
		font-weight: 800;
		/* 左欄只有 236 px：長的字（9 個字再加「1/2」）放不下就換行，不被切掉 */
		overflow-wrap: anywhere;
	}
	.now i {
		font-style: normal;
		font-size: 13px;
		font-weight: 600;
	}
	.now small {
		white-space: nowrap;
		font-size: 14px;
		font-weight: 600;
	}
	.down {
		background: var(--cue-down);
		color: #fff;
	}
	.up {
		background: var(--cue-up);
		color: #fff;
	}
	/* 步驟：淡橘底、橘框、左邊粗線；手位：粉紅圓角小牌子。 */
	.step {
		background: var(--cue-step-bg);
		border: 1px solid var(--cue-step-line);
		border-left-width: 5px;
		color: var(--cue-step-ink);
	}
	.motion {
		background: var(--cue-motion-bg);
		border: 1px solid var(--cue-motion-line);
		border-radius: 14px;
		color: var(--cue-motion-ink);
	}
	.next {
		font-size: 13px;
		color: var(--text);
	}
</style>
