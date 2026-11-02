<script lang="ts">
	// 流程設定：流程名字、規則警告的開關和三個數字。被擋就顯示流程核心給的原因。
	import { renameFlow, updateTimeRules, type CommandResult, type Flow, type TimeRules } from '#lib/core';

	interface Props {
		flow: Flow;
		onchange: (flow: Flow) => void;
		onclose: () => void;
	}

	let { flow, onchange, onclose }: Props = $props();
	let error = $state('');

	function apply(r: CommandResult): boolean {
		if (r.kind === 'ok') {
			error = '';
			onchange(r.flow);
			return true;
		}
		error = r.message;
		return false;
	}

	function update(patch: Partial<TimeRules>) {
		apply(updateTimeRules(flow, patch));
	}

	function rename(input: HTMLInputElement) {
		// 被擋下時把輸入框還原成原本的名字。
		if (!apply(renameFlow(flow, input.value))) input.value = flow.name;
	}

	const num = (e: Event) => (e.currentTarget as HTMLInputElement).valueAsNumber;
	const fields = [
		['minChantSec', '口號段最少（秒）'],
		['maxMusicSec', '音樂段加起來最多（秒）'],
		['maxTotalSec', '整支流程最多（秒）']
	] as const;
</script>

<div class="backdrop">
	<div class="dialog" role="dialog" aria-label="流程設定">
		<header>
			<b>流程設定</b>
			<button type="button" onclick={onclose}>關閉</button>
		</header>
		<label>
			流程名字
			<input value={flow.name} onchange={(e) => rename(e.currentTarget)} />
		</label>
		<label>
			<input
				type="checkbox"
				checked={flow.timeRules.on}
				onchange={(e) => update({ on: e.currentTarget.checked })}
			/>
			規則警告（只提醒，不擋）
		</label>
		{#each fields as [key, label] (key)}
			<label>
				{label}
				<input
					type="number"
					min="0"
					value={flow.timeRules[key]}
					onchange={(e) => update({ [key]: num(e) })}
				/>
			</label>
		{/each}
		{#if error}<p class="error" role="alert">{error}</p>{/if}
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(15, 20, 35, 0.45);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 50;
	}
	.dialog {
		background: #fff;
		border-radius: 10px;
		padding: 12px 16px;
		min-width: 320px;
		display: grid;
		gap: 8px;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	label {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	input[type='number'] {
		width: 6em;
	}
	.error {
		margin: 0;
		color: #c0392b;
	}
</style>
