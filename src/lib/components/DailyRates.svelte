<script lang="ts">
	// 記錄頁下面：選到的動作每天的成功率。一列一天，最後一列「合計」；一欄一個環節，最後一欄「整次」
	// （只有一個環節時整次跟那一欄一樣，不放，跟總表一樣）。
	// 大字是成功率，小字是完成率和次數；沒有紀錄寫「—」。可以看全部的組，或只看某一組（騰翻、跳躍是某一個人）。
	import {
		attemptWhos,
		completionPercent,
		dailyTable,
		percent,
		perPerson,
		phaseLabel,
		successPercent,
		type Action
	} from '#lib/core';
	import { getEditorSession } from '#lib/editor-session.svelte.js';

	interface Props {
		action: Action;
	}

	let { action }: Props = $props();

	const session = getEditorSession();
	const flow = $derived(session.flow!);

	const whos = $derived(attemptWhos(flow, action));
	/** 選的組（或人），存成 select 的值；空字串是全部。放在 session（照動作記）：切頁再回來還是它。 */
	const picked = $derived(session.view.dailyWho[action.id] ?? '');
	/** 選的組不在了（例如復原掉了）就看全部。 */
	const who = $derived(whos.find((w) => w.who === picked)?.who);
	const phases = $derived(action.successRate?.phases ?? []);
	const table = $derived(dailyTable(action, who));
	const rows = $derived([...table.days.map((d) => ({ label: d.date, ...d })), { label: '合計', ...table.total }]);
	const pickLabel = $derived(perPerson(action.category) ? '看哪一個人' : '看哪一組');
</script>

<div class="daily">
	<div class="head">
		<h3>每天的成功率</h3>
		<label
			>{pickLabel}
			<select value={picked} onchange={(e) => (session.view.dailyWho[action.id] = e.currentTarget.value)}>
				<option value="">全部</option>
				{#each whos as w (w.who)}
					<option value={w.who}>{w.name}</option>
				{/each}
			</select>
		</label>
	</div>
	<div class="scroll">
		<table aria-label="每天的成功率">
			<thead>
				<tr>
					<th scope="col">日期</th>
					{#each phases as p (p.id)}
						<th scope="col">{phaseLabel(p)}</th>
					{/each}
					{#if phases.length > 1}<th scope="col">整次</th>{/if}
				</tr>
			</thead>
			<tbody>
				{#each rows as row (row.label)}
					<tr class:total={row.label === '合計'}>
						<th scope="row">{row.label}</th>
						{#each phases as p (p.id)}
							{@const t = row.phases[p.id]}
							<td>
								{#if t.marked}
									<strong>{successPercent(t)}%</strong>
									<small>完成率 {completionPercent(t)}%・{t.marked} 次</small>
								{:else}—{/if}
							</td>
						{/each}
						{#if phases.length > 1}
							<td>
								{#if row.whole.whole}
									<strong>{percent(row.whole.clean, row.whole.whole)}%</strong>
									<small>{row.whole.whole} 次</small>
								{:else}—{/if}
							</td>
						{/if}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<style>
	.daily {
		margin-top: 16px;
		display: grid;
		gap: 8px;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}
	h3 {
		margin: 0;
		font-size: 15px;
	}
	label {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--muted);
		font-size: 13px;
	}
	.scroll {
		overflow-x: auto;
	}
	table {
		border-collapse: collapse;
		background: var(--surface);
		font-variant-numeric: tabular-nums;
	}
	th,
	td {
		border: 1px solid var(--line);
		padding: 6px 10px;
		text-align: center;
		white-space: nowrap;
	}
	thead th {
		background: var(--surface-2);
		font-size: 13px;
	}
	th[scope='row'] {
		text-align: left;
		font-weight: 600;
	}
	td strong {
		display: block;
		font-size: 18px;
	}
	td small {
		display: block;
		color: var(--muted);
		font-size: 11px;
	}
	tr.total {
		background: var(--surface-2);
		border-top: 2px solid var(--ink-3);
	}
</style>
