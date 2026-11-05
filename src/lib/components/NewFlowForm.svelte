<script lang="ts">
	// 新建流程：取名字、選場地。規則（條數範圍、名字不能空）都交給流程核心判斷。
	import {
		FIELD_TEMPLATES,
		MAX_STRIPS,
		MIN_STRIPS,
		createFlow,
		type FieldConfig,
		type FieldLayout,
		type Flow
	} from '#lib/core';

	let { oncreate }: { oncreate: (flow: Flow) => void } = $props();

	let name = $state('');
	/** 選到的範本編號，或 'custom'。 */
	let choice = $state<number | 'custom'>(0);
	let customStrips = $state<number | null>(9);
	let customLayout = $state<FieldLayout>('vertical');
	let error = $state('');

	function submit(e: SubmitEvent) {
		e.preventDefault();
		const field: FieldConfig =
			choice === 'custom'
				? { strips: customStrips ?? Number.NaN, layout: customLayout }
				: FIELD_TEMPLATES[choice].field;
		const r = createFlow({ name, field });
		if (r.kind === 'ok') oncreate(r.flow);
		else error = r.message;
	}

	/** 選項上的小場地圖：幾條、直放或橫放（正面在下面）。 */
	function strips(f: { strips: number; layout: FieldLayout }) {
		const n = Math.min(Math.max(Math.round(f.strips) || 1, 1), MAX_STRIPS);
		return Array.from({ length: n }, (_, i) =>
			f.layout === 'vertical'
				? { x: (i * 36) / n, y: 0, w: 36 / n - 0.8, h: 28 }
				: { x: 0, y: (i * 28) / n, w: 36, h: 28 / n - 0.8 }
		);
	}
</script>

<!-- novalidate：條數對不對由流程核心判斷，不用瀏覽器內建的檢查 -->
<!-- 改了任一欄位就收掉上次被擋的原因 -->
<form class="new-flow" novalidate onsubmit={submit} oninput={() => (error = '')} onchange={() => (error = '')}>
	<h2>新建流程</h2>

	<label class="name">
		流程名字
		<input bind:value={name} placeholder="例：2027 全國賽" />
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
					{#each strips({ strips: customStrips ?? 1, layout: customLayout }) as s, j (j)}
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

	{#if error}<p class="error" role="alert">{error}</p>{/if}

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
