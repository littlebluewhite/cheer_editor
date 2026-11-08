<script lang="ts">
	// 練習畫面的「記錄」頁：記分段練。
	// 左邊：有記成功率、有環節的動作，照流程順序，每個寫這天記了幾次和最弱的環節。
	// 窄螢幕（手機）清單會疊在卡片上面、動作一多要捲很久，所以改成下拉選單，選好捲到卡片。
	// 右邊：選到的動作每組一張卡（騰翻、跳躍每人一張），下面是這個動作每天的成功率。
	// 最上面一排（RunThroughBar，跟總表一樣）：「＋ 記一次全上」打開全上表（RunThroughSheet），存好或取消再回到記錄頁；
	// 「刪掉上一次全上」整次拿掉這天最後存的全上。
	import {
		actionLabel,
		attemptWhos,
		perPerson,
		phaseLabel,
		recordableActions,
		successPercent,
		weakestPhase,
		type Action
	} from '#lib/core';
	import { getEditorSession } from '#lib/editor-session.svelte.js';
	import AttemptCard from './AttemptCard.svelte';
	import DailyRates from './DailyRates.svelte';
	import RunThroughSheet from './RunThroughSheet.svelte';
	import RunThroughBar from './RunThroughBar.svelte';
	import { actionColor } from './category-colors';

	interface Props {
		/** 記在哪一天（YYYY-MM-DD）。 */
		date: string;
		/** 窄螢幕：動作清單改成下拉選單。 */
		narrow?: boolean;
	}

	let { date, narrow = false }: Props = $props();

	const session = getEditorSession();
	const flow = $derived(session.flow!);

	const actions = $derived(recordableActions(flow));
	/** 選到的動作；沒選過、或它不在清單上了（復原掉了）就是第一個。放在 session：切到總表、編排再回來還是它（N07）。 */
	const action = $derived(actions.find((a) => a.id === session.view.recordActionId) ?? actions[0]);
	/** 記全上的表打開著。 */
	let recording = $state(false);

	function closeSheet(done: boolean) {
		recording = false;
		if (done) session.notice = '已記下這次全上';
	}

	/** 卡片那一塊：手機從下拉選好動作就捲過去。 */
	let cards = $state<HTMLElement>();

	function choose(id: string) {
		session.view.recordActionId = id;
		cards?.scrollIntoView({ block: 'start', behavior: 'smooth' });
	}

	/**
	 * 這天記了幾次，例：這天 3 次。騰翻、跳躍每個人自己算，加起來會誤會，寫「這天每人 5 次」；
	 * 每人不一樣多寫「這天每人 3–5 次」。
	 */
	function countText(a: Action): string {
		const records = (a.successRate?.records ?? []).filter((r) => r.date === date);
		if (!perPerson(a.category)) return `這天 ${records.length} 次`;
		// 動作裡沒人時當成 0 次
		const counts = attemptWhos(flow, a).map(({ who }) => records.filter((r) => r.who === who).length);
		if (!counts.length) counts.push(0);
		const [min, max] = [Math.min(...counts), Math.max(...counts)];
		return `這天每人 ${min === max ? min : `${min}–${max}`} 次`;
	}
	/** 這天最弱的環節，例：最弱：下法 50%；這天沒紀錄、或全部成功就是空的。 */
	function weakestText(a: Action): string {
		const weakest = weakestPhase(a, date);
		return weakest ? `最弱：${phaseLabel(weakest.phase)} ${successPercent(weakest.tally)}%` : '';
	}
	/** 這天有哪張卡點了記號還沒存：清單上標「還沒存」，換到別的動作也看得出來。 */
	function unsaved(a: Action): boolean {
		return attemptWhos(flow, a).some(({ who }) => Object.keys(session.unsavedMarks(a, who, date)).length > 0);
	}
</script>

{#if recording}
	<RunThroughSheet {date} onclose={closeSheet} />
{:else if action}
	<RunThroughBar {date} onrecord={() => (recording = true)} />
	<div class="record" class:narrow>
		{#if narrow}
			<label class="pick"
				>記哪個動作<select value={action.id} onchange={(e) => choose(e.currentTarget.value)}>
					{#each actions as a (a.id)}
						<option value={a.id}>{actionLabel(a)}{unsaved(a) ? '（還沒存）' : ''}</option>
					{/each}
				</select></label
			>
		{:else}
			<ul class="list" aria-label="記成功率的動作">
				{#each actions as a (a.id)}
					{@const weakest = weakestText(a)}
					<li>
						<button type="button" aria-pressed={a === action} onclick={() => (session.view.recordActionId = a.id)}>
							<span class="name"><span class="swatch" style:--c={actionColor(a)}></span>{actionLabel(a)}</span>
							<!-- 標在次數同一行：標上、拿掉都不會讓下面的動作上下移 -->
							<small>{countText(a)}{#if unsaved(a)}<span class="unsaved">還沒存</span>{/if}</small>
							<!-- 還沒記也留著這一行的高度：存了第一次，下面的動作不往下移 -->
							<small class="weakest">{weakest}</small>
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		<div class="cards" bind:this={cards}>
			{#key action.id}
				{#each attemptWhos(flow, action) as w (w.who)}
					<AttemptCard {action} who={w.who} name={w.name} people={w.people} {date} />
				{:else}
					<p class="empty">這個動作還沒有分組：到編排選這個動作，在場上選人，用場地下面的分組浮動列分組。</p>
				{/each}
			{/key}
		</div>
		<div class="rates">
			{#key action.id}
				<DailyRates {action} />
			{/key}
		</div>
	</div>
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
	/* 跟卡上的「還沒存」同一個樣子 */
	.list .unsaved {
		margin-left: 6px;
		padding: 0 5px;
		border-radius: 4px;
		background: var(--surface-2);
		color: var(--minor);
		font-size: 12px;
		font-weight: 400;
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
		min-height: 1lh;
		color: var(--text);
	}
	.rates {
		grid-column: 2;
		min-width: 0;
	}
	.empty {
		color: var(--muted);
	}
	.pick {
		display: grid;
		gap: 4px;
		font-weight: 600;
	}
	/* 手機：清單換成下拉選單，排成一欄 */
	.record.narrow {
		grid-template-columns: minmax(0, 1fr);
	}
	.record.narrow .rates {
		grid-column: auto;
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
