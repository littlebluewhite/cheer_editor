<script lang="ts">
	// 站位縮圖列：每張站位一個小站位圖，放在它的時間點上。
	// 點縮圖＝選這張並跳到那一拍；✕＝刪掉（開頭那張沒有 ✕）。
	import { fieldGeometry, formationTimes, type Flow } from '#lib/core';
	import Icon from './Icon.svelte';

	interface Props {
		flow: Flow;
		/** 時間軸 1 秒幾 px。 */
		pxPerSec: number;
		selectedId: string | null;
		onselect: (formationId: string, sec: number) => void;
		ondelete: (formationId: string) => void;
	}

	let { flow, pxPerSec, selectedId, onselect, ondelete }: Props = $props();

	const THUMB_W = 80;
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
					aria-label={formation.name ? `站位 ${i + 1} ${formation.name}` : `站位 ${i + 1}`}
					title={formation.name ? `站位 ${i + 1} ${formation.name}` : undefined}
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
					{#if formation.name}<em class="name" aria-hidden="true">{formation.name}</em>{/if}
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
	.del {
		position: absolute;
		right: 3px;
		top: 3px;
		width: 18px;
		height: 18px;
		padding: 0;
		border-radius: 4px;
		opacity: 0;
	}
	.del:hover {
		color: var(--danger, #c8372d);
	}
	.th:hover .del,
	.del:focus-visible {
		opacity: 1;
	}
</style>
