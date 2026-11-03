<script lang="ts">
	// 八拍表列印：蓋在編輯畫面上，選全隊或一個隊員，按「列印」用瀏覽器列印（可存 PDF）。
	// 印的時候只印這張表（見 +page.svelte 的 @media print）。列的內容都問流程核心。
	import { cueText, eightCountRows, type EightCountCue, type Flow } from '#lib/core';
	import Field from './Field.svelte';
	import Icon from './Icon.svelte';

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

	/** 「拍子 down 1-6 到 1-7」「手位 high V 1-8・給上層」。 */
	function cueLabel(eight: number | null, c: EightCountCue): string {
		const span = c.to > c.from ? `${eight}-${c.from} 到 ${eight}-${c.to}` : `${eight}-${c.from}`;
		return cueText(c.kind, c.word, span, c.who ?? '');
	}
</script>

<div class="print-sheet" role="dialog" aria-label="八拍表">
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
		<span class="muted">用瀏覽器列印（Ctrl+P），也可以存成 PDF。</span>
		<span class="grow"></span>
		<button type="button" class="primary" onclick={print}><Icon name="print" />列印</button>
		<button type="button" onclick={onclose}>關閉</button>
	</div>

	<div class="page">
		<h1>{flow.name}　八拍表　{who}</h1>
		<table>
			<thead>
				<tr><th>段</th><th>八拍</th><th>開始（秒）</th><th>動作</th><th>站位</th></tr>
			</thead>
			{#each rows as row, i (i)}
				<tbody>
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
							{#each row.walks as w, j (j)}
								<div>{w}</div>
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
					{#if row.cues.length}
						<tr class="cue-row">
							<td colspan="5">
								{#each row.cues as line, j (j)}
									{@const name = `${line.categoryLabel}${line.name ? `·${line.name}` : ''}`}
									<div class="cue-line" role="group" aria-label="{name} 的拍點">
										<span class="cue-name">{name}</span>
										<div class="cells">
											{#each [1, 2, 3, 4, 5, 6, 7, 8] as n (n)}
												<span class="n" style:grid-column={n}>{n}</span>
											{/each}
											{#each line.cues as c, k (k)}
												<span
													class="cue {c.kind} {c.kind === 'count' ? c.word : ''}"
													style:grid-column="{c.from} / {c.to + 1}"
													aria-label={cueLabel(row.eight, c)}
													>{c.word}{#if c.who}<small>{c.who}</small>{/if}</span
												>
											{/each}
										</div>
									</div>
								{/each}
							</td>
						</tr>
					{/if}
				</tbody>
			{/each}
		</table>
	</div>
</div>

<style>
	.print-sheet {
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
		align-items: center;
		padding: 10px 20px;
		background: var(--ink, #16213a);
		color: #e8ecf5;
	}
	.tool-title {
		font-size: 15px;
		color: #fff;
	}
	.toolbar label {
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
	tbody {
		break-inside: avoid;
	}
	/* 拍點：一排 8 格，字寫在佔的格子裡。黑白印也分得出：拍子實心、步驟左邊粗線、手位圓角虛線小牌子。 */
	.cue-row td {
		padding: 4px 8px 6px;
	}
	.cue-line {
		display: flex;
		gap: 8px;
		align-items: start;
		margin: 2px 0;
	}
	.cue-name {
		flex: 0 0 9em;
		font-size: 12px;
		font-weight: 600;
		padding-top: 2px;
	}
	.cells {
		flex: 1;
		display: grid;
		grid-template-columns: repeat(8, 1fr);
		grid-auto-flow: row dense;
		gap: 2px 0;
		padding-bottom: 2px;
		border: 1px solid #c9ced8;
		background: linear-gradient(to right, #c9ced8 1px, transparent 1px) 0 0 / 12.5% 100%;
		print-color-adjust: exact;
		-webkit-print-color-adjust: exact;
	}
	.n {
		grid-row: 1;
		padding: 0 4px;
		font-size: 10px;
		color: #7a8296;
		border-bottom: 1px solid #c9ced8;
	}
	.cue {
		margin: 0 2px;
		padding: 1px 4px;
		font-size: 12px;
		line-height: 1.3;
		border-radius: 2px;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.cue small {
		margin-left: 4px;
		font-size: 10px;
	}
	.cue.down {
		background: var(--cue-down);
		color: #fff;
		font-weight: 600;
	}
	.cue.up {
		background: var(--cue-up);
		color: #fff;
		font-weight: 600;
	}
	.cue.step {
		background: var(--cue-step-bg);
		border: 1px solid var(--cue-step-line);
		border-left-width: 4px;
		color: var(--cue-step-ink);
	}
	.cue.motion {
		justify-self: start;
		background: var(--cue-motion-bg);
		border: 1px dashed var(--cue-motion-line);
		border-radius: 999px;
		color: var(--cue-motion-ink);
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
	@media print {
		.print-sheet {
			position: static;
			overflow: visible;
			background: #fff;
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
