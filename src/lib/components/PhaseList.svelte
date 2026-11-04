<script lang="ts">
	// 環節清單（動作表單的成功率區）：每一列有色塊、種類、名字，可以改名、換種類、換色、刪、換順序；最下面「＋ 加環節」。
	// 沒標拍的環節可以按上移、下移換順序，用滑鼠也可以拖；標了拍的照時間排在前面，不能換。
	// 手指不拖（ADR 0005 不用長按拖），只用上移、下移。
	// 刪有紀錄的環節時核心回「要確認」：照現有的確認樣子顯示訊息，按確定才刪。
	// 每一列底下寫標的拍（照八拍寫）和範圍裡的拍點；點它，拍點格子裡那幾拍就亮起來。
	import {
		PHASE_COLORS,
		PHASE_KINDS,
		addPhase,
		deletePhase,
		movePhase,
		phaseColor,
		phaseSpan,
		updatePhase,
		type Action,
		type Flow,
		type PhaseChange,
		type PhaseKind
	} from '#lib/core';
	import ConfirmList from './ConfirmList.svelte';
	import { applyResult } from './form';
	import Icon from './Icon.svelte';
	import { phaseLabel } from './phase-label';

	interface Props {
		flow: Flow;
		/** 有記成功率的動作。 */
		action: Action;
		onchange: (flow: Flow) => void;
		/** 亮著的環節 id（拍點格子裡它那幾拍亮起來）。 */
		lit?: string | null;
		/** 點了某個環節的拍。 */
		onlight?: (phaseId: string) => void;
	}

	let { flow, action, onchange, lit = null, onlight }: Props = $props();

	const phases = $derived(action.successRate?.phases ?? []);
	/** 每個環節標的拍和範圍裡的拍點；沒標拍是 null。 */
	const spans = $derived(phases.map((p) => phaseSpan(flow, action, p)));
	let newKind = $state<PhaseKind>('load');
	let newName = $state('');
	let error = $state('');
	/** 等教練確認的刪除（環節有紀錄）。 */
	let pending = $state<{ phaseId: string; message: string } | null>(null);
	/** 拖著的環節 id。 */
	let dragging = $state<string | null>(null);
	/** 用滑鼠（不是手指）：才能拖著換順序。 */
	const mouse = typeof matchMedia !== 'function' || matchMedia('(pointer: fine)').matches;

	// 換動作時清掉還沒確認的刪除和原因。
	$effect(() => {
		void action.id;
		pending = null;
		error = '';
	});

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
				aria-label={phaseLabel(p)}
				class:marked={!!p.beats}
				class:dragging={dragging === p.id}
				draggable={mouse && !p.beats}
				ondragstart={(e) => {
					if (!mouse) return;
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
				<span class="grip" aria-hidden="true">{mouse && !p.beats ? '⋮⋮' : ''}</span>
				<!-- 色塊就是換色的選單：選單疊在色塊上、看不見，點色塊就跳出顏色 -->
				<span class="chip" style:--c={phaseColor(p)} title="換顏色">
					<select
						aria-label="{phaseLabel(p)} 的顏色"
						value={p.color ?? ''}
						onchange={(e) => update(p.id, { color: e.currentTarget.value || null })}
					>
						<option value="">照種類</option>
						{#each PHASE_COLORS as c (c.value)}<option value={c.value}>{c.label}</option>{/each}
					</select>
				</span>
				<select
					class="kind"
					aria-label="{phaseLabel(p)} 的種類"
					value={p.kind}
					onchange={(e) => update(p.id, { kind: e.currentTarget.value as PhaseKind })}
				>
					{#each PHASE_KINDS as k (k.key)}<option value={k.key}>{k.label}</option>{/each}
				</select>
				<input
					class="name"
					aria-label="{phaseLabel(p)} 的名字"
					value={p.name}
					placeholder="名字（可空）"
					onchange={(e) => update(p.id, { name: e.currentTarget.value })}
				/>
				<button
					type="button"
					class="ghost icon"
					aria-label="把 {phaseLabel(p)} 上移"
					disabled={!canSwap(i, i - 1)}
					onclick={() => move(p.id, i - 1)}>↑</button
				>
				<button
					type="button"
					class="ghost icon"
					aria-label="把 {phaseLabel(p)} 下移"
					disabled={!canSwap(i, i + 1)}
					onclick={() => move(p.id, i + 1)}>↓</button
				>
				<button type="button" class="ghost icon" aria-label="刪掉 {phaseLabel(p)}" onclick={() => remove(p.id)}
					><Icon name="trash" size={14} /></button
				>
				{#if spans[i]}
					<button
						type="button"
						class="span"
						aria-pressed={lit === p.id}
						title="點一下，拍點格子裡這幾拍會亮起來"
						onclick={() => onlight?.(p.id)}
						><span class="range">{spans[i]!.range}</span>{#each spans[i]!.cues as c, j (j)}<span
								class="cue {c.kind} {c.kind === 'count' ? c.word : ''}">{c.word}</span
							>{/each}</button
					>
				{:else}
					<span class="span none">沒標拍</span>
				{/if}
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
	/* 第二行：標的拍和範圍裡的拍點，從種類那一欄排到最後 */
	.span {
		grid-column: 3 / -1;
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		align-items: center;
		justify-content: flex-start;
		min-height: 24px;
		padding: 2px 6px;
		border: 1px solid var(--line-soft, #e8ecf3);
		border-radius: 6px;
		background: transparent;
		font-size: 12px;
		font-weight: 400;
		text-align: left;
	}
	.span[aria-pressed='true'] {
		outline: 2px solid var(--sel, #19b4d8);
		outline-offset: -1px;
		background: var(--sel-soft, #dcf4fa);
	}
	.span.none {
		border-style: dashed;
		color: var(--muted, #66718a);
	}
	.range {
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.cue {
		padding: 0 6px;
		border-radius: 999px;
		font-size: 11px;
		font-weight: 700;
	}
	.cue.down {
		background: var(--cue-down);
		color: #fff;
	}
	.cue.up {
		background: var(--cue-up);
		color: #fff;
	}
	.cue.step {
		background: var(--cue-step-bg);
		color: var(--cue-step-ink);
		border-left: 3px solid var(--cue-step-line);
		border-radius: 4px;
	}
	.cue.motion {
		background: var(--cue-motion-bg);
		color: var(--cue-motion-ink);
		border: 1px solid var(--cue-motion-line);
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
