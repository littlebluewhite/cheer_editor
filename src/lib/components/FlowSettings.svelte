<script lang="ts">
	// 流程設定：流程名字、規則警告的開關和三個數字、標記用號碼還是開頭字。被擋就顯示流程核心給的原因。
	import { getEditorSession } from '#lib/editor-session.svelte.js';
	import {
		memberMarkers,
		renameFlow,
		setMarkers,
		updateTimeRules,
		type MarkerStyle,
		type TimeRules
	} from '#lib/core';
	import { Ask } from './ask.svelte';
	import Icon from './Icon.svelte';
	import Modal from './Modal.svelte';
	import { isLongMarker } from './marker';

	interface Props {
		onclose: () => void;
	}

	let { onclose }: Props = $props();

	const session = getEditorSession();
	const flow = $derived(session.flow!);
	/** 被擋的原因。 */
	const ask = new Ask((f) => session.change(f));

	function update(patch: Partial<TimeRules>) {
		ask.send(() => updateTimeRules(flow, patch));
	}

	/** 改一個秒數；被擋就把那一格還原成實際的值，原因記在那一格。 */
	function setSeconds(key: (typeof fields)[number][0], label: string, input: HTMLInputElement) {
		ask.send(() => updateTimeRules(flow, { [key]: input.valueAsNumber }), {
			field: label,
			revert: () => (input.value = String(flow.timeRules[key]))
		});
	}

	function rename(input: HTMLInputElement) {
		// 被擋下時把輸入框還原成原本的名字。
		ask.send(() => renameFlow(flow, input.value), { field: '流程名字', revert: () => (input.value = flow.name) });
	}

	const markers = $derived(memberMarkers(flow));
	const MARKER_STYLES: { key: MarkerStyle; label: string }[] = [
		{ key: 'number', label: '號碼（名單第幾個）' },
		{ key: 'initial', label: '開頭字（名字的第一個字）' }
	];

	const fields = [
		['minChantSec', '口號段最少（秒）'],
		['maxMusicSec', '音樂段加起來最多（秒）'],
		['maxTotalSec', '整支流程最多（秒）']
	] as const;
</script>

<Modal label="流程設定" class="dialog flow-dialog" {ask} {onclose}>
	{#snippet children(close)}
		<header class="dialog-head">
			<h2>流程設定</h2>
			<button type="button" class="ghost icon close" aria-label="關閉" onclick={close}><Icon name="close" /></button>
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
						onchange={(e) => setSeconds(key, label, e.currentTarget)}
					/>
				</label>
			{/each}
		</section>
		<section class="rules markers">
			<b>標記（場上、泳道、名單上寫的字）</b>
			{#each MARKER_STYLES as s (s.key)}
				<label class="radio">
					<input
						type="radio"
						name="markers"
						checked={(flow.markers ?? 'number') === s.key}
						onchange={() => ask.send(() => setMarkers(flow, s.key))}
					/>
					{s.label}
				</label>
			{/each}
			{#if flow.markers === 'initial'}
				<span class="note">開頭字一樣的人，會再多帶一個字分開。不喜歡就到「隊員」改名字。</span>
			{/if}
			{#if flow.members.length}
				<ul class="preview" aria-label="每個人的標記">
					{#each flow.members as m (m.id)}
						<li>
							<i class="no {m.globalRole}" class:long={isLongMarker(markers[m.id])}>{markers[m.id]}</i><span
								>{m.name}</span
							>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
		{#each Object.values(ask.fieldErrors) as error (error)}<p class="error" role="alert">{error}</p>{/each}
		{#if ask.error}<p class="error" role="alert">{ask.error}</p>{/if}
	{/snippet}
</Modal>

<style>
	:global(.flow-dialog) {
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
	.radio {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.note {
		font-size: 12px;
		color: var(--muted, #66718a);
	}
	.preview {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 4px 12px;
		max-height: 120px;
		overflow: auto;
	}
	.preview li {
		display: inline-flex;
		gap: 4px;
		align-items: center;
		font-size: 12px;
	}
	/* 跟名單、泳道上的圓圈一樣：顏色照全局角色。 */
	.no {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		display: inline-grid;
		place-items: center;
		font-size: 10px;
		font-style: normal;
		font-weight: 700;
		line-height: 1;
		border: 1.5px solid #16213a;
		background: #fff;
	}
	.no.top {
		background: var(--top, #e0664f);
		color: #fff;
	}
	.no.long {
		font-size: 7px;
		letter-spacing: -0.3px;
	}
	.error {
		margin: 0;
		color: var(--danger, #c8372d);
	}
</style>
