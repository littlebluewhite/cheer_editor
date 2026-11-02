<script lang="ts">
	// 泳道：一人一條，照名單順序。動作是色條（顏色照大類，每條都寫動作名稱和那個人的任務角色），
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
				/** 色條上的字：顏色已經是大類，只寫名稱；沒取名才寫大類。 */
				name: action.name || actionLabel(action),
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
			<b class="no gr {m.globalRole}" title={m.globalRole === 'top' ? '上層' : '底層'}>{i + 1}</b>
			<span class="name">{m.name}</span>
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
						<b>{p.name}</b>
						{#if member.role}<span class="role">{member.role}</span>{/if}
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
		height: 26px;
		border-bottom: 1px solid var(--line-soft, #e8ecf3);
	}
	.row:hover .trk {
		background-color: rgba(47, 102, 184, 0.03);
	}
	/* 名字欄疊在播放頭（z 5）上面，橫向捲動時播放頭從名字底下過去。 */
	.lab {
		position: sticky;
		left: 0;
		z-index: 6;
		width: var(--lab-w, 120px);
		flex: none;
		justify-content: flex-start;
		gap: 8px;
		background: var(--surface-2, #f6f8fb);
		border: none;
		border-right: 1px solid var(--line, #d8dee9);
		border-radius: 0;
		padding: 0 8px 0 10px;
		font-size: 12px;
		text-align: left;
		white-space: nowrap;
		overflow: hidden;
	}
	.lab:hover {
		background: #eef2f8;
	}
	.lab.selected {
		background: var(--sel-soft, #dcf4fa);
		box-shadow: inset 3px 0 0 var(--sel, #19b4d8);
	}
	/* 號碼圓圈：顏色照全局角色，跟場上的點一樣。 */
	.no {
		flex: none;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		display: inline-grid;
		place-items: center;
		font-size: 10px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		line-height: 1;
		border: 1.5px solid #16213a;
	}
	.gr.base {
		background: #fff;
		color: #16213a;
	}
	.gr.top {
		background: var(--top, #e0664f);
		color: #fff;
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		font-weight: 500;
	}
	.lab.idle .name {
		color: #9aa3b5;
	}
	.idle-tag {
		margin-left: auto;
		flex: none;
		padding: 0 5px;
		border-radius: 4px;
		background: var(--line-soft, #e8ecf3);
		color: var(--muted, #66718a);
		font-size: 11px;
	}
	/* 灰條紋 = 沒在動作裡（站著或走位）；色條蓋在上面。 */
	.trk {
		position: relative;
		flex: none;
		height: 100%;
		background-image: repeating-linear-gradient(
			135deg,
			transparent 0 5px,
			rgba(102, 113, 138, 0.07) 5px 6px
		);
	}
	.bar {
		position: absolute;
		top: 3px;
		bottom: 3px;
		justify-content: flex-start;
		gap: 6px;
		border: none;
		border-radius: 5px;
		color: #fff;
		font-size: 11px;
		line-height: 1;
		padding: 0 6px;
		text-align: left;
		overflow: hidden;
		white-space: nowrap;
		cursor: grab;
		touch-action: none;
		user-select: none;
		box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.14);
	}
	.bar:hover {
		filter: brightness(1.06);
	}
	.role {
		opacity: 0.9;
	}
	.bar.dragging {
		cursor: grabbing;
		z-index: 2;
		box-shadow: 0 4px 10px rgba(22, 33, 58, 0.3);
	}
	/* 色條右邊的把手：拉它改長度。 */
	.rz {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		width: 6px;
		cursor: ew-resize;
	}
	.bar:hover .rz {
		background: rgba(255, 255, 255, 0.35);
	}
	.bar.selected {
		outline: 2px solid var(--ink, #16213a);
		outline-offset: 1px;
		z-index: 1;
	}
</style>
