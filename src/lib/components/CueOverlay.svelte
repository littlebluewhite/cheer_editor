<script lang="ts">
	// 場地左上角的大字：播放頭在有拍點的動作裡（或開始前一個八拍）時，每個動作一張卡，
	// 寫現在這拍的步驟、拍子、手位（有長度的寫走到第幾拍），下面預告下一個。不吃滑鼠。
	import { actionLabel, cuesAt, whoName, type Cue, type Flow } from '#lib/core';

	interface Props {
		flow: Flow;
		playheadSec: number;
	}
	let { flow, playheadSec }: Props = $props();

	const live = $derived(cuesAt(flow, playheadSec));
	/** 「high V（上層）」；給全部的只寫字。 */
	const nextText = (c: Cue) => (c.who ? `${c.word}（${whoName(flow, c.who)}）` : c.word);
</script>

{#if live.length}
	<section class="cues-now" aria-label="這一拍" aria-live="polite">
		{#each live as l (l.action.id)}
			<div class="card">
				<span class="act">{actionLabel(l.action)}</span>
				{#if l.now.length}
					<span class="now">
						{#each l.now as n, i (i)}
							{@const to = whoName(flow, n.cue.who)}
							<b class="{n.cue.kind} {n.cue.kind === 'count' ? n.cue.word : ''}"
								>{#if to}<i>{to}</i>{' '}{/if}{n.cue.word}{#if n.beats > 1}{' '}<small
										>{n.beat}/{n.beats}</small
									>{/if}</b
							>{' '}
						{/each}
					</span>
				{/if}
				{#if l.next}
					<span class="next">下一個 {l.next.at}：{l.next.cues.map(nextText).join('、')}</span>
				{/if}
			</div>
		{/each}
	</section>
{/if}

<style>
	/* 疊在場地左上角；拖人時的座標提示也在左上角，但那時大家看的是人，先不避開。 */
	.cues-now {
		position: absolute;
		top: 16px;
		left: 16px;
		z-index: 3;
		display: flex;
		flex-direction: column;
		gap: 8px;
		max-width: calc(100% - 32px);
		pointer-events: none;
		/* 跟動作表單的拍點格子同一套顏色。 */
		--down: #1f5fbf;
		--up: #2b7a2f;
		--step-bg: #fff1e2;
		--step-line: #e08a2e;
		--step-ink: #8a4a12;
		--motion-bg: #ffe3f0;
		--motion-line: #d6589a;
		--motion-ink: #9c1d5c;
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
		white-space: nowrap;
	}
	.now i {
		font-style: normal;
		font-size: 13px;
		font-weight: 600;
	}
	.now small {
		font-size: 14px;
		font-weight: 600;
	}
	.down {
		background: var(--down);
		color: #fff;
	}
	.up {
		background: var(--up);
		color: #fff;
	}
	/* 步驟：淡橘底、橘框、左邊粗線；手位：粉紅圓角小牌子。 */
	.step {
		background: var(--step-bg);
		border: 1px solid var(--step-line);
		border-left-width: 5px;
		color: var(--step-ink);
	}
	.motion {
		background: var(--motion-bg);
		border: 1px solid var(--motion-line);
		border-radius: 14px;
		color: var(--motion-ink);
	}
	.next {
		font-size: 13px;
		color: var(--text);
	}
</style>
