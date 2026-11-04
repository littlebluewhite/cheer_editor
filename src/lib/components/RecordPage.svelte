<script lang="ts">
	// 練習畫面的「記錄」頁：記分段練。
	// 左邊：有記成功率、有環節的動作，照流程順序，每個寫這天記了幾次和最弱的環節。
	// 右邊：選到的動作每組一張卡（騰翻、跳躍每人一張），下面是這個動作每天的成功率。
	import {
		actionLabel,
		attemptWhos,
		phaseLabel,
		recordableActions,
		successPercent,
		weakestPhase,
		type Action,
		type Flow
	} from '#lib/core';
	import AttemptCard from './AttemptCard.svelte';
	import DailyRates from './DailyRates.svelte';
	import { actionColor } from './category-colors';

	interface Props {
		flow: Flow;
		/** 記在哪一天（YYYY-MM-DD）。 */
		date: string;
		/** 紀錄改了：不算復原的一步。 */
		onrecord: (flow: Flow) => void;
	}

	let { flow, date, onrecord }: Props = $props();

	const actions = $derived(recordableActions(flow));
	/** 選到的動作；沒選過、或它不在清單上了（復原掉了）就是第一個。 */
	let chosenId = $state<string | null>(null);
	const action = $derived(actions.find((a) => a.id === chosenId) ?? actions[0]);

	const countOn = (records: { date: string }[]) => records.filter((r) => r.date === date).length;
	/** 這天最弱的環節，例：最弱：下法 50%；這天沒紀錄就是空的。 */
	function weakestText(a: Action): string {
		const weakest = weakestPhase(a, date);
		return weakest ? `最弱：${phaseLabel(weakest.phase)} ${successPercent(weakest.tally)}%` : '';
	}
</script>

{#if action}
	<div class="record">
		<ul class="list" aria-label="記成功率的動作">
			{#each actions as a (a.id)}
				{@const weakest = weakestText(a)}
				<li>
					<button type="button" aria-pressed={a === action} onclick={() => (chosenId = a.id)}>
						<span class="name"><span class="swatch" style:--c={actionColor(a)}></span>{actionLabel(a)}</span>
						<small>這天 {countOn(a.successRate?.records ?? [])} 次</small>
						{#if weakest}<small class="weakest">{weakest}</small>{/if}
					</button>
				</li>
			{/each}
		</ul>

		<div class="cards">
			{#key action.id}
				{#each attemptWhos(flow, action) as w (w.who)}
					<AttemptCard {flow} {action} who={w.who} name={w.name} {date} {onrecord} />
				{:else}
					<p class="empty">這個動作還沒有分組：到編排的動作表單，幫人選「第幾組」。</p>
				{/each}
			{/key}
		</div>
		<div class="rates">
			{#key action.id}
				<DailyRates {flow} {action} />
			{/key}
		</div>
	</div>
{:else}
	<p class="empty">還沒有要記的動作：到編排的動作表單打開「記成功率」，而且至少要有一個環節。</p>
{/if}

<style>
	.record {
		display: grid;
		grid-template-columns: minmax(180px, 240px) minmax(0, 1fr);
		gap: 12px;
		align-items: start;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 6px;
	}
	.list button {
		width: 100%;
		display: grid;
		justify-content: start;
		justify-items: start;
		gap: 2px;
		padding: 8px 10px;
		text-align: left;
		white-space: normal;
		border-radius: 8px;
	}
	.list button[aria-pressed='true'] {
		border-color: var(--sel);
		box-shadow: 0 0 0 2px var(--sel);
	}
	.name {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-weight: 600;
	}
	.swatch {
		flex: none;
		width: 10px;
		height: 10px;
		border-radius: 3px;
		background: var(--c);
	}
	.list small {
		color: var(--muted);
		font-size: 12px;
	}
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
		gap: 10px;
	}
	.list .weakest {
		color: var(--text);
	}
	.rates {
		grid-column: 2;
		min-width: 0;
	}
	.empty {
		color: var(--muted);
	}
	@media (max-width: 760px) {
		.record {
			grid-template-columns: minmax(0, 1fr);
		}
		.rates {
			grid-column: auto;
		}
	}
</style>
