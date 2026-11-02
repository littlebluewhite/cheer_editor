<script lang="ts">
	// 場地：SVG 的使用者座標就是流程核心的公尺座標（原點中心 X，y 往正面＝畫面下面）。
	import { fieldGeometry, type FieldConfig } from '#lib/core';

	let { field }: { field: FieldConfig } = $props();

	const g = $derived(fieldGeometry(field));
	const vertical = $derived(field.layout === 'vertical');
	/** 外圍以外再留給「正面／裁判」字樣的空間。 */
	const viewBox = $derived(
		`${g.outer.x - 0.3} ${g.outer.y - 0.3} ${g.outer.width + 0.6} ${g.outer.height + 1.3}`
	);
</script>

<svg class="field" {viewBox} preserveAspectRatio="xMidYMid meet" role="img" aria-label="場地">
	<rect class="margin" x={g.outer.x} y={g.outer.y} width={g.outer.width} height={g.outer.height} />
	<rect class="mat" x={g.mat.x} y={g.mat.y} width={g.mat.width} height={g.mat.height} />
	{#each g.gridLines as l, i (i)}
		<line class="grid" x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
	{/each}
	{#each g.seams as l, i (i)}
		<line class="seam" x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
	{/each}
	<path class="center" d="M-.35,-.35L.35,.35M-.35,.35L.35,-.35" />
	{#each g.strips as s (s.number)}
		<text
			class="num"
			data-strip-number
			x={vertical ? s.rect.x + s.rect.width / 2 : g.mat.x - 0.5}
			y={vertical ? g.mat.y - 0.3 : s.rect.y + s.rect.height / 2 + 0.14}>{s.number}</text
		>
	{/each}
	<text class="front" x="0" y={g.outer.y + g.outer.height + 0.7}>▼ 正面／裁判 ▼</text>
</svg>

<style>
	.field {
		display: block;
		width: 100%;
		height: 100%;
		user-select: none;
	}
	.margin {
		fill: #e9ecf1;
		stroke: #c9ced8;
		stroke-width: 0.03;
		stroke-dasharray: 0.2 0.15;
	}
	.mat {
		fill: #3f6fb6;
		stroke: #1f3f78;
		stroke-width: 0.06;
	}
	.grid {
		stroke: #fff;
		stroke-opacity: 0.18;
		stroke-width: 0.025;
	}
	.seam {
		stroke: #0f2550;
		stroke-width: 0.07;
	}
	.center {
		stroke: #fff;
		stroke-width: 0.09;
		fill: none;
	}
	text {
		text-anchor: middle;
		font-family: inherit;
	}
	.num {
		font-size: 0.42px;
		fill: #56607a;
		font-weight: 600;
	}
	.front {
		font-size: 0.5px;
		fill: #c0392b;
		font-weight: 700;
	}
</style>
