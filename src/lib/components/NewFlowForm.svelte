<script lang="ts">
	// 新建流程：取名字、選場地。規則（條數範圍、名字不能空）都交給流程核心判斷。
	import {
		FIELD_TEMPLATES,
		MAX_STRIPS,
		MIN_STRIPS,
		createFlow,
		fieldGeometry,
		stripsProblem,
		type FieldConfig,
		type FieldLayout,
		type Flow
	} from '#lib/core';
	import { Ask } from '#lib/ask.svelte.js';
	import CharCount from './CharCount.svelte';

	let { oncreate }: { oncreate: (flow: Flow) => void } = $props();

	let name = $state('');
	let nameInput = $state<HTMLInputElement>();
	/** 選到的範本編號，或 'custom'。 */
	let choice = $state<number | 'custom'>(0);
	let customStrips = $state<number | null>(9);
	let customLayout = $state<FieldLayout>('vertical');
	/** 建立被擋下的原因（名字空的、條數不對）。 */
	const ask = new Ask((flow) => oncreate(flow));
	/** 自訂條數不對（超出範圍、不是整數）：不畫預覽，馬上說原因，不用等按建立。 */
	const customError = $derived(choice === 'custom' ? stripsProblem(customStrips ?? Number.NaN) : null);

	function submit(e: SubmitEvent) {
		e.preventDefault();
		const field: FieldConfig =
			choice === 'custom'
				? { strips: customStrips ?? Number.NaN, layout: customLayout }
				: FIELD_TEMPLATES[choice].field;
		ask.send(() => createFlow({ name, field }));
	}

	/**
	 * 選項上的小場地圖：幾條、直放或橫放（正面在下面），照實際比例（一條 1 格寬、7 格長）縮進 36×28 的框、置中。
	 * 條數不對時不畫。
	 */
	function strips(f: FieldConfig) {
		if (stripsProblem(f.strips)) return [];
		const n = f.strips;
		const vertical = f.layout === 'vertical';
		const { cols, rows } = fieldGeometry(f);
		const cell = Math.min(36 / cols, 28 / rows);
		const [x0, y0] = [(36 - cols * cell) / 2, (28 - rows * cell) / 2];
		// 條和條之間留一點縫，外框不縮（整塊的比例才準）
		const half = Math.min(0.4, cell / 8);
		return Array.from({ length: n }, (_, i) => {
			const from = i * cell + (i > 0 ? half : 0);
			const len = cell - (i > 0 ? half : 0) - (i < n - 1 ? half : 0);
			return vertical
				? { x: x0 + from, y: y0, w: len, h: rows * cell }
				: { x: x0, y: y0 + from, w: cols * cell, h: len };
		});
	}
</script>

<!-- novalidate：條數對不對由流程核心判斷，不用瀏覽器內建的檢查 -->
<!-- 改了任一欄位就告訴 Ask，收掉上次被擋的原因 -->
<form class="new-flow" novalidate onsubmit={submit} oninput={() => ask.edited()} onchange={() => ask.edited()}>
	<h2>新建流程</h2>

	<label class="name">
		<span class="head">流程名字<CharCount field="flowName" input={nameInput} value={name} /></span>
		<input aria-label="流程名字" bind:value={name} bind:this={nameInput} placeholder="例：2027 全國賽" />
	</label>

	<fieldset>
		<legend>場地<span>建好之後不能換</span></legend>
		<div class="options">
			{#each FIELD_TEMPLATES as t, i (t.label)}
				<label class="option">
					<input type="radio" name="field" value={i} bind:group={choice} />
					<svg viewBox="-1 -1 38 30" aria-hidden="true">
						{#each strips(t.field) as s, j (j)}<rect x={s.x} y={s.y} width={s.w} height={s.h} />{/each}
					</svg>
					<span class="label">{t.label}</span>
					<small>{t.hint}</small>
				</label>
			{/each}
			<label class="option">
				<input type="radio" name="field" value="custom" bind:group={choice} />
				<svg viewBox="-1 -1 38 30" aria-hidden="true">
					{#each strips({ strips: customStrips ?? Number.NaN, layout: customLayout }) as s, j (j)}
						<rect class:faint={choice !== 'custom'} x={s.x} y={s.y} width={s.w} height={s.h} />
					{/each}
				</svg>
				<span class="label">自訂</span>
				<small>條數 {MIN_STRIPS}–{MAX_STRIPS}，鋪向直放或橫放</small>
			</label>
		</div>
		{#if choice === 'custom'}
			<div class="custom">
				<label>
					條數
					<input type="number" min={MIN_STRIPS} max={MAX_STRIPS} step="1" bind:value={customStrips} />
				</label>
				<span class="layout">
					鋪向
					<label><input type="radio" name="layout" value="vertical" bind:group={customLayout} />直放</label>
					<label><input type="radio" name="layout" value="horizontal" bind:group={customLayout} />橫放</label>
				</span>
			</div>
		{/if}
	</fieldset>

	{#if customError || ask.error}<p class="error" role="alert">{customError || ask.error}</p>{/if}

	<button type="submit" class="primary">建立</button>
</form>

<style>
	.new-flow {
		padding: 24px;
		background: var(--surface, #fff);
		border-radius: 14px;
		box-shadow: var(--shadow-pop);
		display: grid;
		gap: 18px;
	}
	h2 {
		margin: 0;
		font-size: 20px;
		font-weight: 700;
	}
	.name {
		display: grid;
		gap: 6px;
		font-size: 13px;
		font-weight: 600;
	}
	.head {
		display: flex;
		justify-content: space-between;
	}
	.name input {
		font-size: 15px;
		padding: 8px 10px;
	}
	fieldset {
		border: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}
	legend {
		padding: 0;
		margin-bottom: 6px;
		font-size: 13px;
		font-weight: 600;
	}
	legend span {
		margin-left: 8px;
		font-weight: 400;
		color: var(--muted);
		font-size: 12px;
	}
	.options {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 8px;
	}
	.option {
		position: relative;
		display: grid;
		justify-items: start;
		align-content: start;
		gap: 4px;
		padding: 10px;
		border: 1.5px solid var(--line);
		border-radius: 10px;
		cursor: pointer;
		transition: border-color 0.12s, background-color 0.12s;
	}
	.option:hover {
		border-color: #b9c4d8;
	}
	.option:has(input:checked) {
		border-color: var(--mat);
		background: var(--mat-soft);
	}
	.option:focus-within {
		outline: 2px solid var(--sel);
		outline-offset: 2px;
	}
	.option input {
		position: absolute;
		opacity: 0;
		width: 1px;
		height: 1px;
	}
	.option svg {
		width: 52px;
		height: 40px;
		margin-bottom: 4px;
	}
	.option rect {
		fill: var(--mat);
		rx: 0.6;
	}
	.option rect.faint {
		fill: #b8c6de;
	}
	.label {
		font-size: 13px;
		font-weight: 600;
	}
	small {
		color: var(--muted);
		font-size: 11px;
		line-height: 1.4;
	}
	.custom {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		align-items: center;
		padding: 10px 12px;
		background: var(--surface-2);
		border-radius: 8px;
		font-size: 13px;
	}
	.custom label,
	.layout {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.layout {
		gap: 12px;
	}
	.custom input[type='number'] {
		width: 4.5em;
	}
	.error {
		margin: 0;
		color: var(--danger, #c0392b);
	}
	button {
		justify-self: stretch;
		padding: 9px 18px;
		font-size: 15px;
	}
</style>
