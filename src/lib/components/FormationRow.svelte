<script lang="ts">
	// 站位縮圖列：每張站位一個小站位圖，放在它的時間點上。
	// 點縮圖＝選這張並跳到那一拍；✕＝刪掉（開頭那張沒有 ✕）。
	import { fieldGeometry, formationTimes, type Flow } from '#lib/core';

	interface Props {
		flow: Flow;
		/** 時間軸 1 秒幾 px。 */
		pxPerSec: number;
		selectedId: string | null;
		onselect: (formationId: string, sec: number) => void;
		ondelete: (formationId: string) => void;
	}

	let { flow, pxPerSec, selectedId, onselect, ondelete }: Props = $props();

	const THUMB_W = 84;
	const g = $derived(fieldGeometry(flow.field));
	const items = $derived(formationTimes(flow));
	const width = $derived(Math.max(0, ...items.map((i) => i.sec)) * pxPerSec + THUMB_W);
</script>

<div class="row film">
	<div class="lab">站位</div>
	<div class="trk" style:width={`${width}px`}>
		{#each items as { formation, sec, deletable }, i (formation.id)}
			<div class="th" class:on={selectedId === formation.id} style:left={`${sec * pxPerSec}px`}>
				<button
					type="button"
					class="pick"
					aria-label={`站位 ${i + 1}`}
					aria-pressed={selectedId === formation.id}
					onclick={() => onselect(formation.id, sec)}
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
				</button>
				{#if deletable}
					<button
						type="button"
						class="del"
						aria-label={`刪掉站位 ${i + 1}`}
						onclick={() => ondelete(formation.id)}>✕</button
					>
				{/if}
			</div>
		{/each}
	</div>
</div>

<style>
	.row {
		display: flex;
		height: 78px;
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
		border-right: 1px solid #dde1ea;
		padding: 0 4px;
		display: flex;
		align-items: center;
	}
	.trk {
		position: relative;
		flex: none;
		height: 100%;
	}
	/* 縮圖的左邊對齊站位的時間點。 */
	.th {
		position: absolute;
		top: 3px;
		width: 84px;
		height: 70px;
	}
	.pick {
		position: relative;
		width: 100%;
		height: 100%;
		padding: 0;
		border: 2px solid #cfd3de;
		border-radius: 6px;
		background: #fff;
		cursor: pointer;
		overflow: hidden;
	}
	.th.on .pick {
		border-color: #ff8a00;
		box-shadow: 0 0 0 2px #ffd9a8;
	}
	svg {
		display: block;
		width: 100%;
		height: 100%;
	}
	.margin {
		fill: #eef0f4;
	}
	.mat {
		fill: #3f6fb6;
	}
	circle {
		stroke: #1d2330;
		stroke-width: 0.08;
	}
	circle.base {
		fill: #fff;
	}
	circle.top {
		fill: #e0664f;
	}
	.pick span {
		position: absolute;
		left: 3px;
		top: 1px;
		font-size: 10px;
		font-weight: 700;
		background: #fff;
		border-radius: 3px;
		padding: 0 2px;
	}
	.del {
		position: absolute;
		right: 2px;
		top: 2px;
		padding: 0 4px;
		font-size: 10px;
		opacity: 0;
	}
	.th:hover .del,
	.del:focus-visible {
		opacity: 1;
	}
</style>
