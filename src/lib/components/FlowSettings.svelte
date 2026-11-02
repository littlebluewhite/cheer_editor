<script lang="ts">
	// 流程設定：流程名字、規則警告的開關和三個數字。被擋就顯示流程核心給的原因。
	import { renameFlow, updateTimeRules, type Flow, type TimeRules } from '#lib/core';
	import { applyResult, numberValue } from './form';
	import Icon from './Icon.svelte';

	interface Props {
		flow: Flow;
		onchange: (flow: Flow) => void;
		onclose: () => void;
	}

	let { flow, onchange, onclose }: Props = $props();
	let error = $state('');

	function update(patch: Partial<TimeRules>) {
		error = applyResult(updateTimeRules(flow, patch), onchange);
	}

	function rename(input: HTMLInputElement) {
		error = applyResult(renameFlow(flow, input.value), onchange);
		// 被擋下時把輸入框還原成原本的名字。
		if (error) input.value = flow.name;
	}

	const fields = [
		['minChantSec', '口號段最少（秒）'],
		['maxMusicSec', '音樂段加起來最多（秒）'],
		['maxTotalSec', '整支流程最多（秒）']
	] as const;
</script>

<div class="backdrop">
	<div class="dialog flow-dialog" role="dialog" aria-label="流程設定">
		<header class="dialog-head">
			<h2>流程設定</h2>
			<button type="button" class="ghost icon close" aria-label="關閉" onclick={onclose}><Icon name="close" /></button>
		</header>
		<label class="stack">
			流程名字
			<input value={flow.name} onchange={(e) => rename(e.currentTarget)} />
		</label>
		<section class="rules" class:off={!flow.timeRules.on}>
			<label class="switch">
				<input
					type="checkbox"
					checked={flow.timeRules.on}
					onchange={(e) => update({ on: e.currentTarget.checked })}
				/>
				規則警告（只提醒，不擋）
			</label>
			{#each fields as [key, label] (key)}
				<label class="num">
					{label}
					<input
						type="number"
						min="0"
						value={flow.timeRules[key]}
						onchange={(e) => update({ [key]: numberValue(e) })}
					/>
				</label>
			{/each}
		</section>
		{#if error}<p class="error" role="alert">{error}</p>{/if}
	</div>
</div>

<style>
	.flow-dialog {
		width: min(420px, 100%);
		font-size: 13px;
	}
	.stack {
		display: grid;
		gap: 6px;
		font-weight: 600;
	}
	.stack input {
		font-size: 14px;
		font-weight: 400;
	}
	.rules {
		display: grid;
		gap: 8px;
		padding: 12px 14px;
		border-radius: 10px;
		background: var(--surface-2, #f6f8fb);
	}
	.switch {
		display: flex;
		gap: 8px;
		align-items: center;
		font-weight: 600;
		padding-bottom: 4px;
	}
	.num {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		align-items: center;
	}
	.rules.off .num {
		opacity: 0.5;
	}
	input[type='number'] {
		width: 6em;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.error {
		margin: 0;
		color: var(--danger, #c8372d);
	}
</style>
