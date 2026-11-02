<script lang="ts">
	// 泳道：一人一條，照名單順序。動作是色條（顏色照大類，寫那個人的任務角色），
	// 沒在動作裡的時間是灰條紋；播放頭那一拍閒著的人名字變灰、標「閒」。
	// 拖色條移動、拉右邊改長度：放開時交給流程核心，被擋就還原。點名字選人，Shift＋點多選。
	import {
		actionLabel,
		actionSeconds,
		idleAt,
		moveAction,
		resizeAction,
		totalSeconds,
		type Flow
	} from '#lib/core';
	import { CATEGORY_COLORS } from './category-colors';
	import { followPointer } from './pointer';

	interface Props {
		flow: Flow;
		/** 播放頭，全域秒數。 */
		playheadSec: number;
		/** 時間軸 1 秒幾 px。 */
		pxPerSec: number;
		selectedActionId: string | null;
		onselectaction: (actionId: string) => void;
		/** 拖色條改好的流程。 */
		onchange?: (flow: Flow) => void;
		/** 拖色條被流程核心擋下（已還原），給教練看的原因。 */
		onblocked?: (message: string) => void;
		/** 選到的人。 */
		selectedMemberIds?: string[];
		onselectmembers?: (memberIds: string[]) => void;
	}

	let {
		flow,
		playheadSec,
		pxPerSec,
		selectedActionId,
		onselectaction,
		onchange = () => {},
		onblocked = () => {},
		selectedMemberIds = [],
		onselectmembers = () => {}
	}: Props = $props();

	/** 移動不到這麼多 px 算點一下，不改動作。 */
	const DRAG_PX = 3;

	/** 正在拖的色條：move = 整條移動，resize = 拉右邊；dx 是滑鼠移了幾 px。 */
	let drag = $state<{ id: string; mode: 'move' | 'resize'; x0: number; dx: number } | null>(null);

	const width = $derived(totalSeconds(flow) * pxPerSec);
	const idle = $derived(new Set(idleAt(flow, playheadSec)));
	/** 每個動作的位置（px），一個動作算一次，泳道共用。 */
	const placed = $derived(
		flow.actions.map((action) => {
			const { startSec, endSec } = actionSeconds(flow, action);
			return {
				action,
				label: actionLabel(action),
				left: startSec * pxPerSec,
				width: (endSec - startSec) * pxPerSec
			};
		})
	);
	const selected = $derived(new Set(selectedMemberIds));

	function startDrag(e: PointerEvent, id: string) {
		if (e.button !== 0) return;
		const mode = (e.target as Element).closest('[data-resize]') ? 'resize' : 'move';
		drag = { id, mode, x0: e.clientX, dx: 0 };
		followPointer(
			(ev) => {
				if (drag) drag.dx = ev.clientX - drag.x0;
			},
			() => {
				if (drag) drop(drag.id, drag.mode, drag.dx);
				drag = null;
			}
		);
	}

	function drop(id: string, mode: 'move' | 'resize', dx: number) {
		const action = flow.actions.find((a) => a.id === id);
		if (!action || Math.abs(dx) < DRAG_PX) return;
		const { startSec, endSec } = actionSeconds(flow, action);
		const dSec = dx / pxPerSec;
		const r =
			mode === 'move'
				? moveAction(flow, id, startSec + dSec)
				: resizeAction(flow, id, endSec + dSec);
		if (r.kind === 'ok') onchange(r.flow);
		else onblocked(r.message);
	}

	function pick(e: MouseEvent, id: string) {
		if (!e.shiftKey) return onselectmembers([id]);
		onselectmembers(
			selected.has(id) ? selectedMemberIds.filter((x) => x !== id) : [...selectedMemberIds, id]
		);
	}
</script>

{#each flow.members as m, i (m.id)}
	<div class="row" data-lane={m.id}>
		<button
			type="button"
			class="lab"
			class:idle={idle.has(m.id)}
			class:selected={selected.has(m.id)}
			aria-pressed={selected.has(m.id)}
			title="點一下選這個人，Shift＋點多選"
			onclick={(e) => pick(e, m.id)}
		>
			<b>{i + 1}</b>
			<span class="name">{m.name}</span>
			<i class="gr {m.globalRole}">{m.globalRole === 'top' ? '上' : '底'}</i>
			{#if idle.has(m.id)}<span class="idle-tag">閒</span>{/if}
		</button>
		<div class="trk" style:width={`${width}px`}>
			{#each placed as p (p.action.id)}
				{@const member = p.action.members.find((x) => x.memberId === m.id)}
				{#if member}
					{@const d = drag?.id === p.action.id ? drag : null}
					<button
						type="button"
						class="bar"
						class:selected={p.action.id === selectedActionId}
						data-action-id={p.action.id}
						class:dragging={d !== null}
						style:left={`${p.left + (d?.mode === 'move' ? d.dx : 0)}px`}
						style:width={`${Math.max(p.width + (d?.mode === 'resize' ? d.dx : 0), 2)}px`}
						style:background={CATEGORY_COLORS[p.action.category]}
						title="{p.label}{member.role ? `（${member.role}）` : ''}"
						onclick={() => onselectaction(p.action.id)}
						onpointerdown={(e) => startDrag(e, p.action.id)}
					>
						{#if p.action.members[0].memberId === m.id}<b>{p.label}</b>{/if}
						{member.role ?? ''}
						<span class="rz" data-resize title="拉這裡改長度"></span>
					</button>
				{/if}
			{/each}
		</div>
	</div>
{/each}

<style>
	.row {
		display: flex;
		height: 16px;
		border-bottom: 1px solid #f0f1f5;
	}
	.lab {
		position: sticky;
		left: 0;
		z-index: 3;
		width: 120px;
		flex: none;
		box-sizing: border-box;
		background: #fafbfd;
		border: none;
		border-right: 1px solid #dde1ea;
		padding: 0 4px;
		font: inherit;
		text-align: left;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 4px;
		white-space: nowrap;
		overflow: hidden;
	}
	.lab.selected {
		background: #fff3b8;
	}
	.lab b {
		color: #6b7280;
		font-weight: 600;
	}
	.lab.idle .name {
		color: #9aa1b2;
	}
	.idle-tag {
		color: #9aa1b2;
		font-style: italic;
	}
	.gr {
		font-style: normal;
		font-size: 9px;
		color: #fff;
		border-radius: 3px;
		padding: 0 3px;
	}
	.gr.base {
		background: #2c3e66;
	}
	.gr.top {
		background: #e0664f;
	}
	/* 灰條紋 = 沒在動作裡（站著或走位）；色條蓋在上面。 */
	.trk {
		position: relative;
		flex: none;
		height: 100%;
		background: repeating-linear-gradient(90deg, transparent 0 6px, #eceef3 6px 7px);
	}
	.bar {
		position: absolute;
		top: 1px;
		bottom: 1px;
		border: none;
		border-radius: 3px;
		color: #fff;
		font: inherit;
		font-size: 10px;
		line-height: 13px;
		padding: 0 4px;
		text-align: left;
		overflow: hidden;
		white-space: nowrap;
		cursor: grab;
		opacity: 0.88;
		touch-action: none;
		user-select: none;
	}
	.bar.dragging {
		cursor: grabbing;
		z-index: 2;
	}
	/* 色條右邊的把手：拉它改長度。 */
	.rz {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		width: 5px;
		cursor: ew-resize;
	}
	.bar.selected {
		outline: 2px solid #1d2330;
		opacity: 1;
	}
</style>
