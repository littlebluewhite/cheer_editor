<script lang="ts">
	// 站位縮圖列：每張站位一個小站位圖，放在它的站位時間上。
	// 點縮圖＝選這張並跳到那一拍；✕＝刪掉（開頭那張沒有 ✕）。
	// 拖縮圖＝挪站位：吸到最近一格，縮圖上寫新的站位時間；放開才交給 onmove，被擋就彈回原位。開頭那張拖不動。
	import {
		fieldGeometry,
		formationTimes,
		nearestPosition,
		timeTextWithUnit,
		toSeconds,
		totalSeconds,
		type Flow,
		type TimePosition
	} from '#lib/core';
	import Icon from './Icon.svelte';
	import { followPointer, touchOnUnpicked } from './pointer';

	interface Props {
		flow: Flow;
		/** 時間軸 1 秒幾 px。 */
		pxPerSec: number;
		selectedId: string | null;
		onselect: (formationId: string, sec: number) => void;
		ondelete: (formationId: string) => void;
		/** 拖縮圖放開：把這張挪到 to。 */
		onmove: (formationId: string, to: TimePosition) => void;
	}

	let { flow, pxPerSec, selectedId, onselect, ondelete, onmove }: Props = $props();

	const THUMB_W = 80;
	/** 拖超過這麼多 px 才算拖；沒超過就是點一下（手抖不會挪到）。 */
	const DRAG_PX = 4;
	const g = $derived(fieldGeometry(flow.field));
	const items = $derived(formationTimes(flow));
	const width = $derived(Math.max(0, ...items.map((i) => i.sec)) * pxPerSec + THUMB_W);

	/** 正在拖的那張和吸到的那一格；還沒拖超過 DRAG_PX 時 to 是 null。 */
	let drag = $state<{ id: string; to: TimePosition | null } | null>(null);
	/** 剛拖完：放開後瀏覽器接著送的 click 不算點縮圖。 */
	let dragged = false;

	function startDrag(e: PointerEvent, id: string, sec: number) {
		// 手指按在沒選中的縮圖上：一滑是捲時間軸，點一下選中才拖得動（docs/adr/0005-ipad-touch.md）。
		if (e.button !== 0 || touchOnUnpicked(e, id === selectedId)) return;
		const x = e.clientX;
		drag = { id, to: null };
		followPointer(
			e,
			(m) => {
				if (drag && (drag.to || Math.abs(m.clientX - x) > DRAG_PX)) {
					drag.to = nearestPosition(flow, sec + (m.clientX - x) / pxPerSec);
				}
			},
			() => {
				const to = drag?.to;
				drag = null;
				if (!to) return;
				dragged = true;
				setTimeout(() => (dragged = false));
				onmove(id, to);
			},
			() => (drag = null)
		);
	}

	/**
	 * 拖的時候縮圖上寫的新站位時間；home 是這張原本的段（拖得動的不是開頭那張，一定有段）。
	 * 拖出流程頭尾就不寫（放開會被擋）。
	 */
	function dragText(home: string, to: TimePosition): string {
		const sec = toSeconds(flow, to);
		return sec >= 0 && sec < totalSeconds(flow) ? timeTextWithUnit(flow, home, to) : '';
	}
</script>

<div class="row film">
	<div class="lab">站位</div>
	<div class="trk" style:width={`${width}px`}>
		{#each items as { formation, sec, deletable }, i (formation.id)}
			{@const to = drag?.id === formation.id ? drag.to : null}
			<div
				class="th"
				class:on={selectedId === formation.id}
				class:movable={deletable}
				class:dragging={!!to}
				style:left={`${(to ? toSeconds(flow, to) : sec) * pxPerSec}px`}
			>
				<button
					type="button"
					class="pick"
					aria-label={formation.name ? `站位 ${i + 1} ${formation.name}` : `站位 ${i + 1}`}
					title={formation.name ? `站位 ${i + 1} ${formation.name}` : undefined}
					aria-pressed={selectedId === formation.id}
					onclick={() => {
						if (!dragged) onselect(formation.id, sec);
					}}
					onpointerdown={deletable ? (e) => startDrag(e, formation.id, sec) : undefined}
				>
					<svg
						viewBox="{g.outer.x} {g.outer.y} {g.outer.width} {g.outer.height}"
						preserveAspectRatio="xMidYMid meet"
						aria-hidden="true"
					>
						<rect class="margin" x={g.outer.x} y={g.outer.y} width={g.outer.width} height={g.outer.height} />
						<rect class="mat" x={g.mat.x} y={g.mat.y} width={g.mat.width} height={g.mat.height} />
						{#each flow.members as m (m.id)}
							{@const p = formation.pos[m.id]}
							{#if p}<circle class={m.globalRole} cx={p[0]} cy={p[1]} r="0.45" />{/if}
						{/each}
					</svg>
					<span>{i + 1}</span>
					{#if to}
						{@const text = dragText(formation.segmentId!, to)}
						{#if text}<em class="name when" aria-hidden="true">{text}</em>{/if}
					{:else if formation.name}<em class="name" aria-hidden="true">{formation.name}</em>{/if}
				</button>
				{#if deletable}
					<button
						type="button"
						class="del"
						aria-label={`刪掉站位 ${i + 1}`}
						onclick={() => ondelete(formation.id)}><Icon name="close" size={11} /></button
					>
				{/if}
			</div>
		{/each}
	</div>
</div>

<style>
	.row {
		display: flex;
		height: 76px;
		border-bottom: 1px solid var(--line-soft, #e8ecf3);
	}
	.lab {
		position: sticky;
		left: 0;
		z-index: 6;
		width: var(--lab-w, 120px);
		flex: none;
		background: var(--surface-2, #f6f8fb);
		border-right: 1px solid var(--line, #d8dee9);
		padding: 0 8px 0 12px;
		display: flex;
		align-items: center;
		font-weight: 600;
		color: var(--muted, #66718a);
	}
	.trk {
		position: relative;
		flex: none;
		height: 100%;
	}
	/* 縮圖的左邊對齊站位的時間點。 */
	.th {
		position: absolute;
		top: 6px;
		width: 80px;
		height: 64px;
	}
	.th::before {
		content: '';
		position: absolute;
		left: 0;
		top: -6px;
		height: 6px;
		width: 2px;
		background: #9aa6bf;
	}
	.pick {
		position: relative;
		display: block;
		width: 100%;
		height: 100%;
		padding: 0;
		border: 2px solid var(--line, #d8dee9);
		border-radius: 8px;
		background: #e4e8ef;
		overflow: hidden;
	}
	.pick:hover {
		border-color: #a9b5cc;
		background: #e4e8ef;
	}
	.th.on .pick {
		border-color: var(--sel, #19b4d8);
		box-shadow: 0 0 0 3px var(--sel-soft, #dcf4fa);
	}
	/* 挪站位：拖得動的縮圖是手掌游標；拖的時候浮起來、蓋在別張上面，✕ 先藏起來。 */
	.th.movable .pick {
		cursor: grab;
		user-select: none;
	}
	/* 選中的才不讓手指捲畫面（手指拖得動）。 */
	.th.on.movable .pick {
		touch-action: none;
	}
	.th.dragging {
		z-index: 5;
	}
	.th.dragging .pick {
		cursor: grabbing;
		border-color: var(--sel, #19b4d8);
		box-shadow:
			0 0 0 3px var(--sel-soft, #dcf4fa),
			0 6px 14px rgb(22 33 58 / 0.28);
	}
	.th.dragging .del {
		display: none;
	}
	svg {
		display: block;
		width: 100%;
		height: 100%;
	}
	.margin {
		fill: #e4e8ef;
	}
	.mat {
		fill: var(--mat, #2f66b8);
	}
	circle {
		stroke: #16213a;
		stroke-width: 0.08;
	}
	circle.base {
		fill: #fff;
	}
	circle.top {
		fill: var(--top, #e0664f);
	}
	.pick span {
		position: absolute;
		left: 3px;
		top: 3px;
		min-width: 16px;
		font-size: 10px;
		line-height: 15px;
		font-weight: 700;
		text-align: center;
		color: #fff;
		background: var(--ink, #16213a);
		border-radius: 4px;
		padding: 0 3px;
	}
	/* 站位名稱：縮圖底下一條，太長就切掉，滑鼠停上去看全名。 */
	.name {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		padding: 1px 4px;
		font-size: 10px;
		font-style: normal;
		font-weight: 700;
		line-height: 14px;
		text-align: left;
		color: #fff;
		background: rgb(22 33 58 / 0.82);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/* 拖的時候換成新的站位時間，置中、深底白字。 */
	.name.when {
		text-align: center;
		font-variant-numeric: tabular-nums;
		background: var(--ink, #16213a);
	}
	.del {
		position: absolute;
		right: 3px;
		top: 3px;
		width: 18px;
		height: 18px;
		padding: 0;
		border-radius: 4px;
	}
	.del:hover {
		color: var(--danger, #c8372d);
	}
	/* 手指：✕ 點得到的範圍變大，看起來不變。 */
	@media (pointer: coarse) {
		.del::after {
			content: '';
			position: absolute;
			inset: -8px;
		}
	}
</style>
