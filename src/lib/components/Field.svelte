<script lang="ts">
	// 場地：SVG 的使用者座標就是流程核心的公尺座標（原點中心 X，y 往正面＝畫面下面）。
	// 拖人：吸附和位置文字都問流程核心；放開時用 onmove 把新位置（公尺）交出去。
	// 選人：點人（Shift＋點多選）、拖空白處框選；選了好幾個人時拖其中一個，整組照他吸附後的位移一起移。
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
		raised = [],
		selected = [],
		onmove,
		onselect,
		toMeters = screenCtmToMeters,
		controls = true
	}: {
		field: FieldConfig;
		/** 照名單順序；點上寫的號碼是名單裡第幾個。 */
		members?: Member[];
		positions?: Record<string, Position>;
		/** 這一刻任務角色是上層或中層的人：畫在最上面，黃框加陰影。 */
		raised?: string[];
		/** 選到的人。 */
		selected?: string[];
		onmove?: (moves: Record<string, Position>) => void;
		/** 點人、框選、點空白處（清除）時送出新的選取。 */
		onselect?: (memberIds: string[]) => void;
		toMeters?: ToMeters;
		/** false：不顯示放大縮小的按鈕（八拍表上的小站位圖）。 */
		controls?: boolean;
	} = $props();

	const ZOOM_STEP = 1.25;
	/** 按下後移動不到這麼多 px 算點一下。 */
	const CLICK_PX = 4;
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

	/** 按著場上：拖人（id 是按到的人，ids 是一起移的人）或框選（box）。client 是按下時的螢幕座標。 */
	let drag = $state<{
		id: string;
		ids: string[];
		client: [number, number];
		shift: boolean;
		start: Position;
		orig: Record<string, Position>;
		/** 按到的人吸附後的位置；還沒移動時是 null。 */
		cur: Position | null;
	} | null>(null);
	let box = $state<{ client: [number, number]; shift: boolean; a: Position; b: Position | null } | null>(
		null
	);

	/** 拖人時每個人的位置：照按到的人吸附後的位移。 */
	const dragged = $derived.by((): Record<string, Position> => {
		if (!drag?.cur) return {};
		const { orig, cur, id } = drag;
		const dx = cur[0] - orig[id][0];
		const dy = cur[1] - orig[id][1];
		return Object.fromEntries(drag.ids.map((i) => [i, [orig[i][0] + dx, orig[i][1] + dy]]));
	});
	const lasso = $derived.by(() => {
		if (!box?.b) return null;
		const [[x1, y1], [x2, y2]] = [box.a, box.b];
		return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x1 - x2), height: Math.abs(y1 - y2) };
	});

	const dots = $derived(
		members
			.flatMap((m, i) => {
				const p = dragged[m.id] ?? positions[m.id];
				return p
					? [{ m, number: i + 1, p, up: raised.includes(m.id), sel: selected.includes(m.id) }]
					: [];
			})
			// SVG 後畫的蓋在上面：上層、中層排最後。
			.sort((a, b) => Number(a.up) - Number(b.up))
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

	function down(e: PointerEvent) {
		if (e.button !== 0) return;
		const id = (e.target as Element).closest?.('[data-member-id]')?.getAttribute('data-member-id');
		const client: [number, number] = [e.clientX, e.clientY];
		if (id && positions[id] && (onmove || onselect)) {
			const ids = selected.includes(id) && selected.length > 1 ? selected.filter((i) => positions[i]) : [id];
			const orig = Object.fromEntries(ids.map((i) => [i, positions[i]]));
			drag = { id, ids, client, shift: e.shiftKey, start: toMeters(e, svg), orig, cur: null };
		} else if (!id && onselect) {
			box = { client, shift: e.shiftKey, a: toMeters(e, svg), b: null };
		} else return;
		svg.setPointerCapture?.(e.pointerId);
	}

	/** 還在「點一下」的範圍內（還沒開始拖）。 */
	function still(e: PointerEvent, client: [number, number]) {
		return Math.hypot(e.clientX - client[0], e.clientY - client[1]) < CLICK_PX;
	}

	function move(e: PointerEvent) {
		if (drag && onmove && (drag.cur || !still(e, drag.client))) {
			const [px, py] = toMeters(e, svg);
			const o = drag.orig[drag.id];
			drag.cur = snapPosition(field, [o[0] + px - drag.start[0], o[1] + py - drag.start[1]], zoom);
		} else if (box && (box.b || !still(e, box.client))) {
			box.b = toMeters(e, svg);
		}
	}

	function up() {
		if (drag?.cur) onmove?.(dragged);
		else if (drag) onselect?.(pick(drag.id, drag.shift));
		else if (box) onselect?.(box.b ? inBox(box.a, box.b, box.shift) : []);
		drag = null;
		box = null;
	}

	/** 點人：只選他；Shift＋點是加進來或拿掉。 */
	function pick(id: string, shift: boolean): string[] {
		if (!shift) return [id];
		return selected.includes(id) ? selected.filter((i) => i !== id) : [...selected, id];
	}

	/** 框裡的人（Shift 時加上原本選的），照名單順序。 */
	function inBox(a: Position, b: Position, shift: boolean): string[] {
		const within = (v: number, p: number, q: number) => v >= Math.min(p, q) && v <= Math.max(p, q);
		return members
			.filter((m) => {
				const p = positions[m.id];
				const hit = p && within(p[0], a[0], b[0]) && within(p[1], a[1], b[1]);
				return hit || (shift && selected.includes(m.id));
			})
			.map((m) => m.id);
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
		onpointerdown={down}
		onpointermove={move}
		onpointerup={up}
		onpointercancel={() => {
			drag = null;
			box = null;
		}}
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
		{#each dots as { m, number, p, up, sel } (m.id)}
			<g
				class="dot"
				class:raised={up}
				class:selected={sel}
				class:dragging={drag?.cur && drag.ids.includes(m.id)}
				data-member-id={m.id}
				role="button"
				tabindex="-1"
				aria-label={m.name}
				transform="translate({p[0]},{p[1]})"
			>
				<title>{m.name}</title>
				{#if sel}<circle class="ring" r="0.42" />{/if}
				<circle class={m.globalRole} r="0.3" />
				<text y="0.11">{number}</text>
			</g>
		{/each}
		{#if lasso}
			<rect data-lasso class="lasso" x={lasso.x} y={lasso.y} width={lasso.width} height={lasso.height} />
		{/if}
	</svg>
	{#if controls}
		<div class="tools">
			<button type="button" aria-label="縮小" onclick={() => setZoom(zoom / ZOOM_STEP)}>－</button>
			<span>×{zoom.toFixed(1)}</span>
			<button type="button" aria-label="放大" onclick={() => setZoom(zoom * ZOOM_STEP)}>＋</button>
			<button type="button" onclick={() => setZoom(1)}>全場</button>
		</div>
	{/if}
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
	.dot.selected circle.ring {
		fill: none;
		stroke: #2f5bd3;
		stroke-width: 0.07;
	}
	.lasso {
		fill: rgba(47, 91, 211, 0.12);
		stroke: #2f5bd3;
		stroke-width: 0.04;
		pointer-events: none;
	}
	.dot circle.base {
		fill: #fff;
	}
	.dot circle.top {
		fill: #e0664f;
	}
	.dot.raised {
		filter: drop-shadow(0 0.06px 0.08px rgba(0, 0, 0, 0.6));
	}
	.dot.raised circle {
		stroke: #ffd400;
		stroke-width: 0.08;
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
