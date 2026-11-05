<script lang="ts">
	// 八拍表列印：蓋在編輯畫面上，選全隊或一個隊員，按「列印」用瀏覽器列印（可存 PDF）。
	// 印的時候只印這張表（見 +page.svelte 的 @media print）。列的內容都問流程核心。
	import { eightCountRows, memberMarkers, type Flow } from '#lib/core';
	import EightCountCueLine, { actionTitle } from './EightCountCueLine.svelte';
	import Field from './Field.svelte';
	import Icon from './Icon.svelte';
	import Modal from './Modal.svelte';

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
	const markers = $derived(memberMarkers(flow));
	const who = $derived.by(() => {
		const m = flow.members.find((m) => m.id === memberId);
		if (!m) return '全隊';
		return flow.markers === 'initial'
			? `${m.name}（場上寫「${markers[m.id]}」）`
			: `${m.name}（場上 ${markers[m.id]} 號）`;
	});
</script>

<Modal label="八拍表" class="print-sheet" backdrop={false} {onclose}>
	{#snippet children(close)}
		<div class="toolbar">
			<b class="tool-title">八拍表</b>
			<label>
				印誰
				<select bind:value={memberId}>
					<option value="">全隊</option>
					{#each flow.members as m (m.id)}
						<option value={m.id}>{m.name}</option>
					{/each}
				</select>
			</label>
			<span class="muted">用瀏覽器列印（⌘P／Ctrl+P），也可以存成 PDF。</span>
			<span class="grow"></span>
			<button type="button" class="primary" onclick={print}><Icon name="print" />列印</button>
			<button type="button" onclick={close}>關閉</button>
		</div>

		<div class="page">
			<h1>{flow.name}　八拍表　{who}</h1>
			{#if !memberId}
				<ul class="legend" aria-label="號碼和名字">
					{#each flow.members as m (m.id)}
						<li><b>{markers[m.id]}</b> {m.name}</li>
					{/each}
				</ul>
			{/if}
			<table>
				<thead>
					<tr><th>段</th><th>八拍</th><th>開始（秒）</th><th>拍／動作</th><th>站位</th></tr>
				</thead>
				{#each rows as row, i (i)}
					<tbody>
						<tr>
							<td class="seg">{row.segmentLabel}</td>
							<td class="seg">{row.eightText}</td>
							<td class="num">{row.startSec.toFixed(1)}</td>
							<td>
								{#each row.actions as a, j (j)}
									<div class="action">
										<b class="at">{a.at}</b>
										{actionTitle(a.categoryLabel, a.name)}{#if a.who}：{a.who}{/if}
									</div>
								{/each}
								{#each row.continuing as name, j (j)}
									<div class="muted">↳ {name} 繼續</div>
								{/each}
								{#each row.walks as w, j (j)}
									<div>{w}</div>
								{/each}
							</td>
							<td>
								{#each row.formations as f (f.number)}
									<figure>
										<div class="mini">
											<Field
												field={flow.field}
												members={flow.members}
												{markers}
												positions={f.pos}
												controls={false}
												marked={memberId ? [memberId] : []}
												crop
											/>
										</div>
										<figcaption>{f.caption}</figcaption>
									</figure>
								{/each}
							</td>
						</tr>
						{#if row.cues.length}
							<tr class="cue-row">
								<td colspan="5">
									{#each row.cues as line, j (j)}
										<EightCountCueLine {line} eight={row.eight} />
									{/each}
								</td>
							</tr>
						{/if}
					</tbody>
				{/each}
			</table>
		</div>
	{/snippet}
</Modal>

<style>
	:global(.print-sheet) {
		position: fixed;
		inset: 0;
		z-index: 60;
		overflow: auto;
		background: var(--paper, #eceff5);
		font-size: 13px;
	}
	.toolbar {
		position: sticky;
		top: 0;
		z-index: 1;
		display: flex;
		gap: 12px;
		flex-wrap: wrap;
		align-items: center;
		padding: 10px 20px;
		background: var(--ink, #16213a);
		color: #e8ecf5;
	}
	.tool-title {
		font-size: 15px;
		color: #fff;
		white-space: nowrap;
	}
	.toolbar label {
		white-space: nowrap;
		display: inline-flex;
		gap: 8px;
		align-items: center;
	}
	.toolbar .muted {
		color: #9fb0d4;
		font-size: 12px;
	}
	.grow {
		flex: 1;
	}
	.page {
		max-width: 1000px;
		margin: 24px auto 48px;
		padding: 28px 32px;
		background: #fff;
		border-radius: 4px;
		box-shadow: 0 2px 14px rgba(22, 33, 58, 0.12);
	}
	h1 {
		font-size: 18px;
		margin: 0 0 14px;
	}
	/* 全隊的表：場上標記和名字的對照 */
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 2px 14px;
		margin: -6px 0 12px;
		padding: 0;
		list-style: none;
		font-size: 12px;
	}
	table {
		border-collapse: collapse;
		width: 100%;
	}
	th,
	td {
		border: 1px solid #c9ced8;
		padding: 5px 8px;
		text-align: left;
		vertical-align: top;
	}
	th {
		background: #f2f4f8;
		font-size: 12px;
	}
	/* 「音樂 1」「5–8」不折成直排 */
	.seg {
		min-width: 4.5em;
		white-space: nowrap;
	}
	tbody {
		break-inside: avoid;
	}
	.cue-row td {
		padding: 4px 8px 6px;
	}
	.num {
		font-variant-numeric: tabular-nums;
	}
	.at {
		display: inline-block;
		min-width: 3.5em;
		font-variant-numeric: tabular-nums;
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
	/* 窄的時候（直拿 iPad、手機）：說明自己一行，「八拍表」「印誰」不擠成直排 */
	@media screen and (max-width: 900px) {
		.toolbar .muted {
			order: 1;
			flex-basis: 100%;
		}
		.page {
			margin: 12px 8px 24px;
			padding: 16px 12px;
		}
	}
	@media print {
		:global(.print-sheet) {
			position: static;
			overflow: visible;
			background: #fff;
		}
		/* 同一個八拍可以跨頁（不然內容超過一頁時，第 1 頁只剩標題）；小站位圖不切開 */
		tbody {
			break-inside: auto;
		}
		figure {
			break-inside: avoid;
		}
		.page {
			margin: 0;
			padding: 0;
			box-shadow: none;
			max-width: none;
		}
		.toolbar {
			display: none;
		}
	}
</style>
