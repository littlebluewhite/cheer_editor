<script lang="ts">
	// 環節清單（動作表單的成功率區）：每一列有色塊、種類、名字，可以改名、換種類、換色、刪、換順序；最下面「＋ 加環節」。
	// 沒標拍的環節可以拖著換順序，也可以按上移、下移；標了拍的照時間排在前面，不能換。
	// 刪有紀錄的環節時核心回「要確認」：照現有的確認樣子顯示訊息，按確定才刪。
	import {
		PHASE_COLORS,
		PHASE_KINDS,
		addPhase,
		deletePhase,
		movePhase,
		phaseColor,
		updatePhase,
		type Action,
		type Flow,
		type Phase,
		type PhaseChange,
		type PhaseKind
	} from '#lib/core';
	import ConfirmList from './ConfirmList.svelte';
	import { applyResult } from './form';
	import Icon from './Icon.svelte';

	interface Props {
		flow: Flow;
		/** 有記成功率的動作。 */
		action: Action;
		onchange: (flow: Flow) => void;
	}

	let { flow, action, onchange }: Props = $props();

	const phases = $derived(action.successRate?.phases ?? []);
	let newKind = $state<PhaseKind>('load');
	let newName = $state('');
	let error = $state('');
	/** 等教練確認的刪除（環節有紀錄）。 */
	let pending = $state<{ phaseId: string; message: string } | null>(null);
	/** 拖著的環節 id。 */
	let dragging = $state<string | null>(null);

	// 換動作時清掉還沒確認的刪除和原因。
	$effect(() => {
		void action.id;
		pending = null;
		error = '';
	});

	const kindLabel = (kind: PhaseKind) => PHASE_KINDS.find((k) => k.key === kind)?.label ?? '';
	const label = (p: Phase) => (p.name ? `${kindLabel(p.kind)} ${p.name}` : kindLabel(p.kind));
	/** 第 i 列能不能跟第 j 列換：兩列都在、都沒標拍。 */
	const canSwap = (i: number, j: number) => j >= 0 && j < phases.length && !phases[i].beats && !phases[j].beats;

	function add() {
		error = applyResult(addPhase(flow, action.id, { kind: newKind, name: newName }), onchange);
		if (!error) newName = '';
	}

	function update(id: string, change: PhaseChange) {
		error = applyResult(updatePhase(flow, action.id, id, change), onchange);
	}

	function move(id: string, to: number) {
		error = applyResult(movePhase(flow, action.id, id, to), onchange);
	}

	function remove(id: string) {
		pending = null;
		const r = deletePhase(flow, action.id, id);
		if (r.kind === 'confirm') {
			error = '';
			pending = { phaseId: id, message: r.message };
			return;
		}
		error = applyResult(r, onchange);
	}

	function confirmRemove() {
		if (!pending) return;
		const r = deletePhase(flow, action.id, pending.phaseId, { confirmed: true });
		pending = null;
		error = applyResult(r, onchange);
	}

	function drop(to: number) {
		const id = dragging;
		dragging = null;
		if (id) move(id, to);
	}
</script>

{#if phases.length}
	<ol class="phases" aria-label="環節">
		{#each phases as p, i (p.id)}
			<li
				aria-label={label(p)}
				class:marked={!!p.beats}
				class:dragging={dragging === p.id}
				draggable={!p.beats}
				ondragstart={(e) => {
					dragging = p.id;
					e.dataTransfer?.setData('text/plain', p.id);
				}}
				ondragend={() => (dragging = null)}
				ondragover={(e) => {
					if (dragging && !p.beats) e.preventDefault();
				}}
				ondrop={(e) => {
					e.preventDefault();
					drop(i);
				}}
			>
				<span class="grip" aria-hidden="true">{p.beats ? '' : '⋮⋮'}</span>
				<!-- 色塊就是換色的選單：選單疊在色塊上、看不見，點色塊就跳出顏色 -->
				<span class="chip" style:--c={phaseColor(p)} title="換顏色">
					<select
						aria-label="{label(p)} 的顏色"
						value={p.color ?? ''}
						onchange={(e) => update(p.id, { color: e.currentTarget.value || null })}
					>
						<option value="">照種類</option>
						{#each PHASE_COLORS as c (c.value)}<option value={c.value}>{c.label}</option>{/each}
					</select>
				</span>
				<select
					class="kind"
					aria-label="{label(p)} 的種類"
					value={p.kind}
					onchange={(e) => update(p.id, { kind: e.currentTarget.value as PhaseKind })}
				>
					{#each PHASE_KINDS as k (k.key)}<option value={k.key}>{k.label}</option>{/each}
				</select>
				<input
					class="name"
					aria-label="{label(p)} 的名字"
					value={p.name}
					placeholder="名字（可空）"
					onchange={(e) => update(p.id, { name: e.currentTarget.value })}
				/>
				<button
					type="button"
					class="ghost icon"
					aria-label="把 {label(p)} 上移"
					disabled={!canSwap(i, i - 1)}
					onclick={() => move(p.id, i - 1)}>↑</button
				>
				<button
					type="button"
					class="ghost icon"
					aria-label="把 {label(p)} 下移"
					disabled={!canSwap(i, i + 1)}
					onclick={() => move(p.id, i + 1)}>↓</button
				>
				<button type="button" class="ghost icon" aria-label="刪掉 {label(p)}" onclick={() => remove(p.id)}
					><Icon name="trash" size={14} /></button
				>
			</li>
		{/each}
	</ol>
{:else}
	<p class="muted none">還沒有環節</p>
{/if}

<div class="adder">
	<select aria-label="新環節的種類" bind:value={newKind}>
		{#each PHASE_KINDS as k (k.key)}<option value={k.key}>{k.label}</option>{/each}
	</select>
	<input aria-label="新環節的名字" bind:value={newName} placeholder="名字，例：延伸" />
	<button type="button" onclick={add}>＋ 加環節</button>
</div>

{#if pending}
	<div {@attach (d) => d.scrollIntoView({ block: 'nearest' })}>
		<ConfirmList
			message={pending.message}
			items={[]}
			confirmLabel="確定"
			onconfirm={confirmRemove}
			oncancel={() => (pending = null)}
		/>
	</div>
{/if}

{#if error}<p class="error" role="alert">{error}</p>{/if}

<style>
	p {
		margin: 0;
	}
	.muted {
		color: var(--muted, #66718a);
	}
	.none {
		font-size: 12px;
	}
	.phases {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 4px;
	}
	.phases li {
		display: grid;
		grid-template-columns: 10px 20px auto minmax(0, 1fr) auto auto auto;
		gap: 6px;
		align-items: center;
		border-radius: 6px;
	}
	.phases li.dragging {
		opacity: 0.5;
	}
	.grip {
		color: var(--muted, #66718a);
		font-size: 11px;
		line-height: 1;
		cursor: grab;
	}
	li.marked .grip {
		cursor: default;
	}
	.chip {
		position: relative;
		width: 20px;
		height: 20px;
		border-radius: 5px;
		background: var(--c);
		cursor: pointer;
	}
	.chip select {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		margin: 0;
		padding: 0;
		opacity: 0;
		cursor: pointer;
	}
	.chip:has(select:focus-visible) {
		outline: 2px solid var(--sel, #19b4d8);
		outline-offset: 2px;
	}
	.kind {
		padding-inline: 4px;
		font-size: 12px;
	}
	.name {
		min-width: 0;
		width: 100%;
	}
	.icon {
		width: 26px;
		height: 26px;
		padding: 0;
		color: var(--muted, #66718a);
	}
	.adder {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		gap: 6px;
	}
	.adder input {
		min-width: 0;
	}
	.error {
		padding: 8px 10px;
		border-radius: 8px;
		background: var(--danger-soft, #fdecea);
		color: var(--danger, #c8372d);
	}
</style>
