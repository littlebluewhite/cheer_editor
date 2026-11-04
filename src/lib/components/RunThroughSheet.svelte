<script lang="ts">
	// 總表的「＋ 記一次全上」打開的表（照台灣教練的全上表）：每個要記的動作一塊，照流程順序；一列一個環節，一欄一組。
	// 每格先是 ✓，教練只點出錯的地方：✓ → △ → ✗ → ✓。一格變 ✗，同一組後面的環節變空的；改回來，後面回到 ✓。
	// 全上中途停了，就在沒做的動作按「沒做（停了）」：整個動作變空的，不存。
	// 表上的東西只在這個元件裡，按「存這次全上」才用 recordRunThrough 存進流程；「取消」什麼都不存。
	import {
		actionLabel,
		attemptWhos,
		MARKS,
		phaseLabel,
		recordableActions,
		recordRunThrough,
		type Flow,
		type Mark,
		type RunThroughMarks
	} from '#lib/core';
	import { actionColor } from './category-colors';

	interface Props {
		flow: Flow;
		/** 記在哪一天（練習畫面選的日期）。 */
		date: string;
		/** 存好了：新的流程（紀錄不算復原的一步）。 */
		onrecord: (flow: Flow) => void;
		/** 存好或取消後關掉這張表。 */
		onclose: () => void;
	}

	let { flow, date, onrecord, onclose }: Props = $props();

	const NEXT: Record<Mark, Mark> = { '✓': '△', '△': '✗', '✗': '✓' };

	const blocks = $derived(recordableActions(flow).map((action) => ({ action, whos: attemptWhos(flow, action) })));

	/** 教練點過的格子（key：動作|誰|環節）；沒點過的是 ✓。 */
	let picked = $state<Record<string, Mark>>({});
	/** 按了「沒做（停了）」的動作。 */
	let skipped = $state<string[]>([]);
	let error = $state('');

	const key = (actionId: string, who: number | string, phaseId: string) => `${actionId}|${who}|${phaseId}`;

	/** 一組在一個動作的記號，照環節順序；✗ 後面的、沒做的動作是空的（null）。 */
	function column(actionId: string, phaseIds: string[], who: number | string): (Mark | null)[] {
		if (skipped.includes(actionId)) return phaseIds.map(() => null);
		let failed = false;
		return phaseIds.map((id) => {
			if (failed) return null;
			const mark = picked[key(actionId, who, id)] ?? '✓';
			failed = mark === '✗';
			return mark;
		});
	}

	/** 點一格換下一個記號；變 ✗ 就把同一組後面點過的清掉（改回來時後面是 ✓）。 */
	function tap(actionId: string, phaseIds: string[], who: number | string, index: number, mark: Mark) {
		const next = NEXT[mark];
		picked[key(actionId, who, phaseIds[index])] = next;
		if (next === '✗') for (const id of phaseIds.slice(index + 1)) delete picked[key(actionId, who, id)];
	}

	function toggleSkip(actionId: string) {
		skipped = skipped.includes(actionId) ? skipped.filter((id) => id !== actionId) : [...skipped, actionId];
	}

	function save() {
		const entries: RunThroughMarks[] = blocks
			.filter(({ action }) => !skipped.includes(action.id))
			.flatMap(({ action, whos }) => {
				const phaseIds = action.successRate!.phases.map((p) => p.id);
				return whos.map(({ who }) => {
					const marks: Record<string, Mark> = {};
					column(action.id, phaseIds, who).forEach((m, i) => m && (marks[phaseIds[i]] = m));
					return { actionId: action.id, who, marks };
				});
			});
		const r = recordRunThrough(flow, date, entries);
		if (r.kind !== 'ok') return void (error = r.message);
		onrecord(r.flow);
		onclose();
	}

	const markLabel = (m: Mark | null) => MARKS.find((x) => x.key === m)?.label ?? '空的';
</script>

<section class="sheet" aria-label="記一次全上">
	<header>
		<h3>記一次全上</h3>
		<p>每格先是 ✓，點出錯的地方：✓ → △ → ✗。中途停了，沒做的動作按「沒做（停了）」。</p>
	</header>

	{#each blocks as { action, whos } (action.id)}
		{@const phases = action.successRate?.phases ?? []}
		{@const phaseIds = phases.map((p) => p.id)}
		{@const off = skipped.includes(action.id)}
		{@const columns = whos.map((w) => ({ ...w, marks: column(action.id, phaseIds, w.who) }))}
		<section class="block" class:off aria-label={actionLabel(action)}>
			<div class="head">
				<h4><span class="swatch" style:--c={actionColor(action)}></span>{actionLabel(action)}</h4>
				<button type="button" class="stop" aria-pressed={off} onclick={() => toggleSkip(action.id)}>沒做（停了）</button>
			</div>
			<div class="scroll">
				<table>
					<thead>
						<tr>
							<th scope="col">環節</th>
							{#each columns as col (col.who)}
								<th scope="col">{col.name}</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each phases as p, i (p.id)}
							<tr>
								<th scope="row">{phaseLabel(p)}</th>
								{#each columns as col (col.who)}
									{@const m = col.marks[i]}
									<td>
										<button
											type="button"
											class="slot {m === '✓' ? 'ok' : m === '△' ? 'minor' : m === '✗' ? 'fail' : ''}"
											aria-label="{col.name} {phaseLabel(p)} {markLabel(m)}"
											disabled={m === null}
											onclick={() => m && tap(action.id, phaseIds, col.who, i, m)}>{m ?? ''}</button
										>
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/each}

	{#if error}<p class="error" role="alert">{error}</p>{/if}

	<footer>
		<button type="button" class="primary" onclick={save}>存這次全上</button>
		<button type="button" onclick={onclose}>取消</button>
	</footer>
</section>

<style>
	.sheet {
		--ok: #15803d;
		--minor: #b45309;
		--fail: #b91c1c;
		display: grid;
		gap: 16px;
		padding: 12px;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 10px;
	}
	h3,
	h4 {
		margin: 0;
	}
	header p {
		margin: 4px 0 0;
		color: var(--muted);
		font-size: 13px;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 8px;
	}
	h4 {
		font-size: 15px;
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.swatch {
		width: 10px;
		height: 10px;
		border-radius: 3px;
		background: var(--c);
	}
	.stop {
		padding: 4px 10px;
		font-size: 13px;
	}
	.stop[aria-pressed='true'] {
		background: var(--ink);
		border-color: var(--ink);
		color: #fff;
	}
	.off table {
		opacity: 0.5;
	}
	.scroll {
		overflow-x: auto;
	}
	table {
		border-collapse: collapse;
	}
	th,
	td {
		border: 1px solid var(--line);
		padding: 6px 10px;
		text-align: center;
		white-space: nowrap;
	}
	td {
		padding: 0;
	}
	thead th {
		background: var(--surface-2);
		font-size: 13px;
	}
	th[scope='row'] {
		text-align: left;
		font-weight: 600;
	}
	/* 格子要大、好點；記號用顏色之外也寫出來。 */
	.slot {
		width: 100%;
		min-width: 72px;
		min-height: 40px;
		border: 0;
		border-radius: 0;
		background: transparent;
		font-size: 20px;
		font-weight: 700;
	}
	.slot.ok {
		color: var(--ok);
	}
	.slot.minor {
		color: var(--minor);
		background: #fdf0c4;
	}
	.slot.fail {
		color: var(--fail);
		background: #fde0dd;
	}
	.slot:disabled {
		cursor: default;
	}
	.error {
		margin: 0;
		color: var(--fail);
	}
	footer {
		display: flex;
		gap: 8px;
	}
	@media (pointer: coarse) {
		.slot {
			min-height: 56px;
		}
	}
</style>
