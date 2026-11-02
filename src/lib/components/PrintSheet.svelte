<script lang="ts">
	// 八拍表列印：蓋在編輯畫面上，選全隊或一個隊員，按「列印」用瀏覽器列印（可存 PDF）。
	// 印的時候只印這張表（見 +page.svelte 的 @media print）。列的內容都問流程核心。
	import { eightCountRows, type Flow } from '#lib/core';
	import Field from './Field.svelte';

	interface Props {
		flow: Flow;
		onclose: () => void;
		/** 叫瀏覽器列印；測試換成假的（jsdom 沒有列印）。 */
		print?: () => void;
	}

	let { flow, onclose, print = () => window.print() }: Props = $props();

	/** '' = 全隊。 */
	let memberId = $state('');

	const rows = $derived(eightCountRows(flow, memberId || null));
	const who = $derived.by(() => {
		const i = flow.members.findIndex((m) => m.id === memberId);
		return i === -1 ? '全隊' : `${flow.members[i].name}（場上 ${i + 1} 號）`;
	});
</script>

<div class="print-sheet" role="dialog" aria-label="八拍表">
	<div class="toolbar">
		<label>
			印誰
			<select bind:value={memberId}>
				<option value="">全隊</option>
				{#each flow.members as m (m.id)}
					<option value={m.id}>{m.name}</option>
				{/each}
			</select>
		</label>
		<button type="button" onclick={print}>列印</button>
		<button type="button" onclick={onclose}>關閉</button>
		<span class="muted">用瀏覽器列印（Ctrl+P），也可以存成 PDF。</span>
	</div>

	<h1>{flow.name}　八拍表　{who}</h1>
	<table>
		<thead>
			<tr><th>段</th><th>八拍</th><th>開始（秒）</th><th>動作</th><th>站位</th></tr>
		</thead>
		<tbody>
			{#each rows as row, i (i)}
				<tr>
					<td>{row.segmentLabel}</td>
					<td>{row.eight ?? `整段 ${row.durationSec.toFixed(1)} 秒`}</td>
					<td class="num">{row.startSec.toFixed(1)}</td>
					<td>
						{#each row.actions as a, j (j)}
							<div class="action">
								<b class="at">{a.at}</b>
								{a.categoryLabel}{#if a.name}·{a.name}{/if}：
								{a.members.map((m) => (m.role ? `${m.name}（${m.role}）` : m.name)).join('、')}
							</div>
						{/each}
					</td>
					<td>
						{#each row.formations as f (f.number)}
							<figure>
								<div class="mini">
									<Field field={flow.field} members={flow.members} positions={f.pos} controls={false} />
								</div>
								<figcaption>站位 {f.number}　{f.at}</figcaption>
							</figure>
						{/each}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.print-sheet {
		position: fixed;
		inset: 0;
		z-index: 60;
		overflow: auto;
		background: #fff;
		padding: 12px 20px;
		font-size: 13px;
	}
	.toolbar {
		display: flex;
		gap: 8px;
		align-items: center;
		margin-bottom: 8px;
	}
	h1 {
		font-size: 16px;
		margin: 4px 0 8px;
	}
	table {
		border-collapse: collapse;
		width: 100%;
	}
	th,
	td {
		border: 1px solid #c9ced8;
		padding: 3px 6px;
		text-align: left;
		vertical-align: top;
	}
	th {
		background: #f6f7fa;
	}
	tr {
		break-inside: avoid;
	}
	.num {
		font-variant-numeric: tabular-nums;
	}
	.at {
		display: inline-block;
		min-width: 3.5em;
	}
	figure {
		margin: 0 0 4px;
	}
	.mini {
		width: 45mm;
		height: 40mm;
		print-color-adjust: exact;
		-webkit-print-color-adjust: exact;
	}
	figcaption {
		font-size: 11px;
	}
	.muted {
		color: #7a8296;
	}
	@media print {
		.print-sheet {
			position: static;
			overflow: visible;
			padding: 0;
		}
		.toolbar {
			display: none;
		}
	}
</style>
