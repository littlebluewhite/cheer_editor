<script lang="ts">
	// 場地：SVG 的使用者座標就是流程核心的公尺座標（原點中心 X，y 往正面＝畫面下面）。
	// 拖人：吸附和位置文字都問流程核心；放開時用 onmove 把新位置（公尺）交出去。
	import {
		fieldGeometry,
		fieldPositionText,
		snapPointsNear,
		snapPosition,
		type FieldConfig,
		type Member,
		type Position
	} from '#lib/core';

	/** 螢幕座標 → 場地公尺座標。測試換成假的（見 docs/adr/0002-component-tests-jsdom.md）。 */
	type ToMeters = (e: { clientX: number; clientY: number }, svg: SVGSVGElement) => Position;

	const screenCtmToMeters: ToMeters = (e, svg) => {
		const pt = svg.createSVGPoint();
		pt.x = e.clientX;
		pt.y = e.clientY;
		const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
		return [p.x, p.y];
	};

	let {
		field,
		members = [],
		positions = {},
		onmove,
		toMeters = screenCtmToMeters
	}: {
		field: FieldConfig;
		/** 照名單順序；點上寫的號碼是名單裡第幾個。 */
		members?: Member[];
		positions?: Record<string, Position>;
		onmove?: (moves: Record<string, Position>) => void;
		toMeters?: ToMeters;
	} = $props();

	const ZOOM_STEP = 1.25;
	const MAX_ZOOM = 8;

	const g = $derived(fieldGeometry(field));
	const vertical = $derived(field.layout === 'vertical');
	/** 全場的畫面範圍：外圍以外再留給「正面／裁判」字樣的空間。 */
	const full = $derived({
		x: g.outer.x - 0.3,
		y: g.outer.y - 0.3,
		width: g.outer.width + 0.6,
		height: g.outer.height + 1.3
	});

	let svg: SVGSVGElement;
	let zoom = $state(1);
	/** 放大時畫面中心（公尺）；null = 全場的中心。 */
	let center = $state<Position | null>(null);
	const view = $derived.by(() => {
		const width = full.width / zoom;
		const height = full.height / zoom;
		const [cx, cy] = center ?? [full.x + full.width / 2, full.y + full.height / 2];
		const x = clamp(cx - width / 2, full.x, full.x + full.width - width);
		const y = clamp(cy - height / 2, full.y, full.y + full.height - height);
		return { x, y, width, height };
	});

	let drag = $state<{
		id: string;
		start: Position;
		orig: Position;
		/** 吸附後的位置；還沒移動時是 null。 */
		cur: Position | null;
	} | null>(null);

	const dots = $derived(
		members.flatMap((m, i) => {
			const p = drag?.id === m.id && drag.cur ? drag.cur : positions[m.id];
			return p ? [{ m, number: i + 1, p }] : [];
		})
	);
	const snapDots = $derived(drag?.cur ? snapPointsNear(field, drag.cur, zoom) : []);
	const readout = $derived.by(() => {
		if (!drag?.cur) return '';
		const name = members.find((m) => m.id === drag!.id)?.name ?? '';
		return `${name}　${fieldPositionText(field, drag.cur)}`;
	});

	function clamp(v: number, lo: number, hi: number) {
		return Math.min(Math.max(v, lo), hi);
	}

	function setZoom(next: number, anchor?: Position) {
		const z = clamp(next, 1, MAX_ZOOM);
		const c: Position = [view.x + view.width / 2, view.y + view.height / 2];
		// 以 anchor 為不動點縮放（滾輪：滑鼠下面那一點不動）。
		center = anchor
			? [anchor[0] + ((c[0] - anchor[0]) * zoom) / z, anchor[1] + ((c[1] - anchor[1]) * zoom) / z]
			: c;
		zoom = z;
		if (z === 1) center = null;
	}

	function onwheel(e: WheelEvent) {
		e.preventDefault();
		setZoom(e.deltaY < 0 ? zoom * ZOOM_STEP : zoom / ZOOM_STEP, toMeters(e, svg));
	}

	function startDrag(e: PointerEvent, id: string) {
		if (e.button !== 0 || !onmove) return;
		svg.setPointerCapture?.(e.pointerId);
		drag = { id, start: toMeters(e, svg), orig: positions[id], cur: null };
	}

	function moveDrag(e: PointerEvent) {
		if (!drag) return;
		const [px, py] = toMeters(e, svg);
		const target: Position = [drag.orig[0] + px - drag.start[0], drag.orig[1] + py - drag.start[1]];
		drag.cur = snapPosition(field, target, zoom);
	}

	function endDrag() {
		if (drag?.cur) onmove?.({ [drag.id]: drag.cur });
		drag = null;
	}
</script>

<div class="field-wrap">
	<svg
		bind:this={svg}
		class="field"
		viewBox="{view.x} {view.y} {view.width} {view.height}"
		preserveAspectRatio="xMidYMid meet"
		role="img"
		aria-label="場地"
		{onwheel}
		onpointermove={moveDrag}
		onpointerup={endDrag}
		onpointercancel={() => (drag = null)}
	>
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
		{#each snapDots as p, i (i)}
			<circle data-snap-point class="snap" class:fine={p.fine} cx={p.x} cy={p.y} r={p.fine ? 0.035 : 0.05} />
		{/each}
		{#each dots as { m, number, p } (m.id)}
			<g
				class="dot"
				class:dragging={drag?.id === m.id}
				data-member-id={m.id}
				role="button"
				tabindex="-1"
				aria-label={m.name}
				transform="translate({p[0]},{p[1]})"
				onpointerdown={(e) => startDrag(e, m.id)}
			>
				<title>{m.name}</title>
				<circle class={m.globalRole} r="0.3" />
				<text y="0.11">{number}</text>
			</g>
		{/each}
	</svg>
	<div class="tools">
		<button type="button" aria-label="縮小" onclick={() => setZoom(zoom / ZOOM_STEP)}>－</button>
		<span>×{zoom.toFixed(1)}</span>
		<button type="button" aria-label="放大" onclick={() => setZoom(zoom * ZOOM_STEP)}>＋</button>
		<button type="button" onclick={() => setZoom(1)}>全場</button>
	</div>
	{#if readout}<div class="readout">{readout}</div>{/if}
</div>

<style>
	.field-wrap {
		position: relative;
		width: 100%;
		height: 100%;
	}
	.field {
		display: block;
		width: 100%;
		height: 100%;
		user-select: none;
		touch-action: none;
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
	.snap {
		fill: #ffd84d;
		opacity: 0.85;
		pointer-events: none;
	}
	.snap.fine {
		opacity: 0.6;
	}
	.dot {
		cursor: grab;
	}
	.dot.dragging {
		cursor: grabbing;
	}
	.dot circle {
		stroke: #1d2330;
		stroke-width: 0.04;
	}
	.dot circle.base {
		fill: #fff;
	}
	.dot circle.top {
		fill: #e0664f;
	}
	.dot text {
		font-size: 0.3px;
		font-weight: 700;
		fill: #1d2330;
		pointer-events: none;
	}
	.tools {
		position: absolute;
		top: 6px;
		right: 6px;
		display: flex;
		gap: 4px;
		align-items: center;
		background: #fffc;
		border-radius: 6px;
		padding: 2px 4px;
		font-size: 12px;
	}
	.readout {
		position: absolute;
		left: 8px;
		bottom: 8px;
		padding: 3px 8px;
		background: #1d2330e0;
		color: #fff;
		border-radius: 4px;
		font-size: 13px;
		pointer-events: none;
	}
</style>
