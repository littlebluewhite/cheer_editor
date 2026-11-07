<script lang="ts">
	// 八拍表列印：蓋在編輯畫面上，選全隊、一個隊員或一個全局角色（那些人每人一張個人版），
	// 按「列印」用瀏覽器列印（可存 PDF）。
	// 印的時候只印這張表（見 +page.svelte 的 @media print）。列的內容都問流程核心。
	import {
		GLOBAL_ROLES,
		actionLabel,
		charCount,
		eightCountRows,
		eightCountView,
		memberMarkers,
		type EightCountRow,
		type Flow
	} from '#lib/core';
	import { loadFlowSetting, saveFlowSetting } from '#lib/local-settings.js';
	import { untrack } from 'svelte';
	import EightCountCueLine from './EightCountCueLine.svelte';
	import Field from './Field.svelte';
	import Icon from './Icon.svelte';
	import Modal from './Modal.svelte';

	interface Props {
		flow: Flow;
		onclose: () => void;
		/** 預設印他：編輯畫面只選了一個人時是他，不然是「我」。 */
		selected?: string | null;
		/** 叫瀏覽器列印；測試換成假的（jsdom 沒有列印）。 */
		print?: () => void;
	}

	let { flow, onclose, selected = null, print = () => window.print() }: Props = $props();

	/** 有隊員是這個全局角色才給選。 */
	const roleChoices = $derived(
		GLOBAL_ROLES.filter((r) => flow.members.some((m) => m.globalRole === r.key)).map((r) => ({
			value: `role:${r.key}`,
			label: `全部${r.label}`
		}))
	);
	const valid = (c: string) =>
		c === '' || flow.members.some((m) => m.id === c) || roleChoices.some((r) => r.value === c);

	/** '' = 全隊、隊員 id、'role:top' = 全部上層。打開時：編輯畫面選的那個人優先，再來是上次選的。 */
	let choice = $state(
		untrack(() => [selected ?? '', loadFlowSetting('print', flow.name)].find((c) => c && valid(c)) ?? '')
	);

	/** 選的人（或那個角色最後一個人）被復原退掉了：回到印全隊。 */
	const validChoice = $derived(valid(choice) ? choice : '');

	/** 每張表印誰：'' 是全隊的表，其他是那個人的個人版。 */
	const sheets = $derived(
		validChoice.startsWith('role:')
			? flow.members.filter((m) => `role:${m.globalRole}` === validChoice).map((m) => m.id)
			: [validChoice]
	);
	const markers = $derived(memberMarkers(flow));
	/** 每張小站位圖都用同一個範圍，比得出前後張的差別。 */
	const miniView = $derived(eightCountView(flow));

	/**
	 * 這一列印在 A4 直的大約多高（px，估得偏高）。放得下一頁的才標「不切開」：
	 * 比一頁還長的列也標的話，瀏覽器會把整列推到下一頁，前一頁只剩標題。
	 * 量不到印出來的版面，照內容估：動作欄一行約 18 個字、每張小站位圖約 175、每排拍點約 60。
	 */
	const PAGE_PX = 1000;
	function fitsPage(row: EightCountRow): boolean {
		const lines = (text: string) => Math.ceil(charCount(text) / 18);
		const text =
			row.actions.reduce(
				(h, a) => h + 20 * lines(`${a.at}${actionLabel(a)}${a.who}`) + 18 * lines(a.note),
				0
			) +
			20 * (row.continuing.length + row.walks.length);
		return Math.max(text, 175 * row.formations.length) + 60 * row.cues.length + 20 < PAGE_PX;
	}
	function whoText(id: string): string {
		const m = flow.members.find((m) => m.id === id);
		if (!m) return '全隊';
		return flow.markers === 'initial'
			? `${m.name}（場上寫「${markers[m.id]}」）`
			: `${m.name}（場上 ${markers[m.id]} 號）`;
	}
</script>

<Modal label="八拍表" class="print-sheet" backdrop={false} {onclose}>
	{#snippet children(close)}
		<div class="toolbar">
			<b class="tool-title">八拍表</b>
			<label>
				印誰
				<select
					value={validChoice}
					onchange={(e) => {
						choice = e.currentTarget.value;
						saveFlowSetting('print', flow.name, choice);
					}}
				>
					<option value="">全隊</option>
					{#each roleChoices as r (r.value)}
						<option value={r.value}>{r.label}</option>
					{/each}
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

		{#each sheets as memberId (memberId)}
			{@const rows = eightCountRows(flow, memberId || null)}
			<div class="page">
				<h1>{flow.name}　八拍表　{whoText(memberId)}</h1>
				{#if !memberId}
					<ul class="legend" aria-label="號碼和名字">
						{#each flow.members as m (m.id)}
							<li><b>{markers[m.id]}</b> {m.name}</li>
						{/each}
					</ul>
				{/if}
				{#if !flow.actions.length}
					<p class="empty" role="note">還沒有動作。到「編排」加了動作，這裡會一個八拍一列寫出誰在做什麼。</p>
				{/if}
				<table>
					<thead>
						<tr><th>段</th><th>八拍</th><th>開始（秒）</th><th>拍／動作</th><th>站位</th></tr>
					</thead>
					{#each rows as row, i (i)}
						<tbody class:keep={fitsPage(row)}>
							<tr>
								<td class="seg">{row.segmentLabel}</td>
								<td class="seg" class:eight={row.eight !== null}>{row.eightText}</td>
								<td class="num">{row.startSec.toFixed(1)}</td>
								<td class="actions">
									{#each row.actions as a, j (j)}
										<div class="action">
											<b class="at">{a.at}</b>
											{actionLabel(a)}{#if a.who}：{a.who}{/if}
											{#if a.note}<div class="note">{a.note}</div>{/if}
										</div>
									{/each}
									{#each row.continuing as name, j (j)}
										<div class="muted">↳ {name} 繼續</div>
									{/each}
									{#each row.walks as w, j (j)}
										<div>{w}</div>
									{/each}
								</td>
								<td class="formations">
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
													crop={miniView}
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
		{/each}
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
	/* 備註：動作底下，對齊動作名字（不在時間底下） */
	.note {
		margin-left: 3.5em;
		font-size: 12px;
		color: #4a5368;
		white-space: pre-wrap;
	}
	.empty {
		margin: 0 0 12px;
		padding: 10px 12px;
		border: 1px dashed #c9ced8;
		border-radius: 4px;
		color: #4a5368;
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
	/* 手機：一個八拍一張卡，段、八拍、開始秒數一行，下面是動作，站位圖在動作下面；整張表不用左右捲 */
	@media screen and (max-width: 700px) {
		table,
		tbody,
		tr,
		td {
			display: block;
		}
		thead {
			display: none;
		}
		tbody {
			margin-bottom: 8px;
			border: 1px solid #c9ced8;
			border-radius: 4px;
		}
		tbody > tr:first-child {
			display: flex;
			flex-wrap: wrap;
		}
		td {
			border: none;
			padding: 4px 10px;
		}
		.seg,
		.num {
			min-width: 0;
			padding-right: 0;
			background: #f2f4f8;
			font-weight: 600;
		}
		.num {
			flex: 1;
			padding-right: 10px;
		}
		.eight::before {
			content: '八拍 ';
		}
		.num::after {
			content: ' 秒';
		}
		.actions,
		.formations {
			flex-basis: 100%;
		}
		.formations {
			display: flex;
			flex-wrap: wrap;
			gap: 0 12px;
		}
		.actions:empty,
		.formations:empty {
			display: none;
		}
		/* 拍點那一排的動作名字放上面一行，8 格拿整個寬度（跟手機檢視畫面的那一列一樣） */
		.cue-row :global(.cue-line) {
			flex-wrap: wrap;
		}
		.cue-row :global(.cue-name) {
			flex-basis: 100%;
		}
	}
	@media print {
		:global(.print-sheet) {
			position: static;
			overflow: visible;
			background: #fff;
		}
		/* 鍵盤捲過表也不印焦點外框 */
		:global(.print-sheet:focus-visible) {
			outline: none;
		}
		/* 放得下一頁的八拍不切到兩頁（見 fitsPage）；小站位圖不切開 */
		tbody.keep {
			break-inside: avoid;
		}
		figure {
			break-inside: avoid;
		}
		/* 照全局角色印：每人一張，從新的一頁開始 */
		.page + .page {
			break-before: page;
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
