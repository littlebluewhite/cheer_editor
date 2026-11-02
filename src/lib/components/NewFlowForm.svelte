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
</script>

<!-- novalidate：條數對不對由流程核心判斷，不用瀏覽器內建的檢查 -->
<form class="new-flow" novalidate onsubmit={submit}>
	<h1>新建流程</h1>

	<label class="name">
		流程名字
		<input bind:value={name} placeholder="例：2027 全國賽" />
	</label>

	<fieldset>
		<legend>場地（建好之後不能換）</legend>
		{#each FIELD_TEMPLATES as t, i (t.label)}
			<label class="option">
				<input type="radio" name="field" value={i} bind:group={choice} />
				{t.label}
				<small>{t.hint}</small>
			</label>
		{/each}
		<label class="option">
			<input type="radio" name="field" value="custom" bind:group={choice} />
			自訂
			<small>條數 {MIN_STRIPS}–{MAX_STRIPS}，鋪向直放或橫放</small>
		</label>
		{#if choice === 'custom'}
			<div class="custom">
				<label>
					條數
					<input type="number" min={MIN_STRIPS} max={MAX_STRIPS} step="1" bind:value={customStrips} />
				</label>
				<span>鋪向</span>
				<label><input type="radio" name="layout" value="vertical" bind:group={customLayout} />直放</label>
				<label><input type="radio" name="layout" value="horizontal" bind:group={customLayout} />橫放</label>
			</div>
		{/if}
	</fieldset>

	{#if error}<p class="error" role="alert">{error}</p>{/if}

	<button type="submit">建立</button>
</form>

<style>
	.new-flow {
		max-width: 420px;
		margin: 48px auto;
		padding: 20px 24px;
		background: #fff;
		border: 1px solid #dde1ea;
		border-radius: 10px;
		display: grid;
		gap: 14px;
	}
	h1 {
		margin: 0;
		font-size: 20px;
	}
	.name {
		display: grid;
		gap: 4px;
	}
	fieldset {
		border: 1px solid #dde1ea;
		border-radius: 8px;
		display: grid;
		gap: 6px;
	}
	.option small {
		color: #6b7280;
		margin-left: 6px;
	}
	.custom {
		display: flex;
		gap: 10px;
		align-items: center;
		padding-left: 24px;
	}
	.custom input[type='number'] {
		width: 4em;
	}
	.error {
		margin: 0;
		color: #c0392b;
	}
	button {
		justify-self: end;
		padding: 6px 18px;
	}
</style>
