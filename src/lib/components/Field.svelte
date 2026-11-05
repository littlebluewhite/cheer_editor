<script lang="ts" module>
	import { fieldGeometry, type FieldConfig } from '#lib/core';

	/** 全場的畫面範圍（公尺）：外圍以外再留給「正面／裁判」字樣的空間。編輯頁拿它的長寬比分配右邊欄的寬度。 */
	export function fullView(field: FieldConfig) {
		const { outer } = fieldGeometry(field);
		return { x: outer.x - 0.3, y: outer.y - 0.3, width: outer.width + 0.6, height: outer.height + 1.3 };
	}
</script>

<script lang="ts">
	// 場地：SVG 的使用者座標就是流程核心的公尺座標（原點中心 X，y 往正面＝畫面下面）。
	// 編輯頁（有 session、有按鈕）才能選人、拖人，選取從 session 拿；八拍表的小站位圖只畫。
	// 拖人：吸附和位置文字都問流程核心；放開時把新位置（公尺）改進播放頭這一拍的站位，送到 session 的 ask，
	// 改好了 session 說插了站位或往後帶了幾張、播放頭停到那張（session.moved）。
	// 放大縮小：按鈕、滾輪、兩指捏合；兩指一起拖是移動畫面。
	// 選人：點人（Shift＋點或開著多選時多選）、拖空白處框選；選了好幾個人時拖其中一個，整組照他吸附後的位移一起移。
	// 影子和走位線（編輯頁才給，八拍表的小站位圖不給）：畫在點下面，不吃滑鼠。
	// 有按鈕時（編輯頁）左邊是一欄工具（放大縮小、railTop、railBottom、圖例），場地在右邊，工具不會蓋到場地；
	// children 疊在場地上（置中的提示、確認框）；below（分組浮動列）浮在外圍框下面「正面／裁判」那一排，不蓋到場地、也不讓場地變小。
	import type { Snippet } from 'svelte';
	import {
		CELL_M,
		fieldPositionText,
		moveMembers,
		snapPointsNear,
		snapPosition,
		toPosition,
		type Clash,
		type FormationWalk,
		type Member,
		type Position
	} from '#lib/core';
	import { getEditor } from '#lib/editor.svelte.js';
	import { getEditorSession, hasEditorSession } from '#lib/editor-session.svelte.js';
	import Icon from './Icon.svelte';
	import { isLongMarker } from './marker';

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
		markers = {},
		positions = {},
		raised = [],
		toMeters = screenCtmToMeters,
		controls = true,
		ghosts = {},
		walks = [],
		clashes = [],
		railTop,
		railBottom,
		children,
		below,
		badges = {},
		marked = []
	}: {
		field: FieldConfig;
		/** 照名單順序。 */
		members?: Member[];
		/** 點上寫的標記（隊員 id → 字）；沒給的人寫名單裡第幾個。 */
		markers?: Record<string, string>;
		positions?: Record<string, Position>;
		/** 這一刻任務角色是上層或中層的人：畫在最上面，黃框加陰影。 */
		raised?: string[];
		toMeters?: ToMeters;
		/** false：不顯示放大縮小的按鈕（八拍表上的小站位圖）。 */
		controls?: boolean;
		/** 上一張站位的位置，畫成淡淡的影子點。有選人時只畫選到的人。 */
		ghosts?: Record<string, Position>;
		/** 走位線，從起點畫到終點；太快的標紅、很喘的標橘。有選人時只畫選到的人。 */
		walks?: FormationWalk[];
		/** 撞位：在撞到的位置畫紫色 ✕。只是提醒。 */
		clashes?: Clash[];
		/** 左欄放大縮小下面的東西（警告、這一拍的拍點）。 */
		railTop?: Snippet;
		/** 左欄圖例上面的東西（跟上一張一樣、拖人會改）。 */
		railBottom?: Snippet;
		/** 疊在場地上的東西。 */
		children?: Snippet;
		/** 場地下面另外一排的東西（分組浮動列）：佔自己的位置，不蓋到場地。 */
		below?: Snippet;
		/** 點右上角的小圓（隊員 id → 字和顏色），分組時寫組號。 */
		badges?: Record<string, { text: string; color: string }>;
		/** 沒有編輯器時（八拍表的個人表）標出這些人，畫得跟選到一樣。 */
		marked?: string[];
	} = $props();

	// controls 一開始給了就不換（編輯頁或八拍表）。
	// svelte-ignore state_referenced_locally
	const session = controls && hasEditorSession() ? getEditorSession() : null;
	/** 播放頭（全域秒數）從編輯器 module 的播放拿：拖人改這一拍的站位。有 session 就有編輯器 module（setEditor 一起放）。 */
	const playback = session ? getEditor().playback : null;
	/** 選到的人。 */
	const selected = $derived(session?.selectedMemberIds ?? marked);

	/** 觸控螢幕（iPad）：圓點最小尺寸比較大，手指才點得到。 */
	const touchScreen = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
	/** 圓點的半徑（公尺）。 */
	const DOT_R = 0.3;
	/** 編輯頁的圓點在螢幕上最少這麼大（直徑 px）；場地畫得很小時（窄視窗、iPad）放大圓點，標記跟著放大。 */
	const MIN_DOT_PX = touchScreen ? 32 : 22;
	const ZOOM_STEP = 1.25;
	/** 按下後移動不到這麼多 px 算點一下。 */
	const CLICK_PX = 4;
	const MAX_ZOOM = 8;

	const g = $derived(fieldGeometry(field));
	const vertical = $derived(field.layout === 'vertical');
	const full = $derived(fullView(field));

	let svg: SVGSVGElement;
	/** 場地那一塊的寬和高（px）；jsdom 量不到，是 0。 */
	let stageSize = $state<[number, number]>([0, 0]);
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

	/** 圓點（連選取圈、標記、組號、影子）放大幾倍才有最小尺寸；夠大就是 1。八拍表的小站位圖不放大。 */
	const dotScale = $derived.by(() => {
		const [w, h] = stageSize;
		if (!controls || !w || !h) return 1;
		// preserveAspectRatio meet：1 公尺幾 px 看比較緊的那一邊
		const pxPerM = Math.min(w / view.width, h / view.height);
		return Math.max(1, MIN_DOT_PX / (2 * DOT_R * pxPerM));
	});

	/** 量場地那一塊多大（視窗、分界、右欄寬變了就重量）。jsdom 沒有 ResizeObserver，測試裡就不量。 */
	function watchStage(el: HTMLElement) {
		if (typeof ResizeObserver === 'undefined') return;
		const ro = new ResizeObserver(() => (stageSize = [el.clientWidth, el.clientHeight]));
		ro.observe(el);
		return () => ro.disconnect();
	}

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
					? [{ m, mark: markers[m.id] ?? String(i + 1), p, up: raised.includes(m.id), sel: selected.includes(m.id) }]
					: [];
			})
			// SVG 後畫的蓋在上面：上層、中層排最後。
			.sort((a, b) => Number(a.up) - Number(b.up))
	);
	/** 有選人時只畫選到的人的影子和線；沒選人時畫全隊。 */
	const shown = (id: string) => selected.length === 0 || selected.includes(id);
	const ghostDots = $derived(
		members.flatMap((m) => (ghosts[m.id] && shown(m.id) ? [{ id: m.id, p: ghosts[m.id] }] : []))
	);
	/** false：只畫太快和很喘的走位線，正常的白線藏起來，場地比較乾淨。 */
	let allWalkLines = $state(true);
	const walkLines = $derived(
		walks.filter((w) => shown(w.memberId) && (allWalkLines || w.tooFast || w.tiring))
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

	function setZoom(next: number, anchor?: Position, pan: Position = [0, 0]) {
		const z = clamp(next, 1, MAX_ZOOM);
		const c: Position = [view.x + view.width / 2, view.y + view.height / 2];
		// 以 anchor 為不動點縮放（滾輪：滑鼠下面那一點不動）；pan 是縮放後再挪的公尺數（兩指拖）。
		const [cx, cy] = anchor
			? [anchor[0] + ((c[0] - anchor[0]) * zoom) / z, anchor[1] + ((c[1] - anchor[1]) * zoom) / z]
			: c;
		// 中心夾在畫面不超出全場的範圍裡，挪過頭再挪回來才不會卡住。
		const [w, h] = [full.width / z, full.height / z];
		center = [
			clamp(cx - pan[0], full.x + w / 2, full.x + full.width - w / 2),
			clamp(cy - pan[1], full.y + h / 2, full.y + full.height - h / 2)
		];
		zoom = z;
		if (z === 1) center = null;
	}

	// ---------- 兩根手指：捏合放大縮小、一起拖移動畫面（iPad）。只有一根時照舊點人、拖人、框選。 ----------
	/** 按在場上的每根手指（pointerId → 螢幕座標）。 */
	const fingers = new Map<number, [number, number]>();
	/** 兩指操作中；放開到一根也不接著拖人，要全部放開。 */
	let pinching = false;

	function midAndSpan(): { mid: [number, number]; span: number } {
		const [[ax, ay], [bx, by]] = [...fingers.values()];
		return { mid: [(ax + bx) / 2, (ay + by) / 2], span: Math.hypot(ax - bx, ay - by) };
	}

	/** 第二根手指移動：照兩指距離縮放（兩指中間那一點不動），再照中點移了多少挪畫面。 */
	function pinchMove(e: PointerEvent) {
		const before = midAndSpan();
		fingers.set(e.pointerId, [e.clientX, e.clientY]);
		const after = midAndSpan();
		if (before.span === 0) return;
		const anchor = toMeters({ clientX: before.mid[0], clientY: before.mid[1] }, svg);
		const next = clamp((zoom * after.span) / before.span, 1, MAX_ZOOM);
		// 螢幕 1 px 是幾公尺（縮放後）。
		const [x1] = toMeters({ clientX: before.mid[0] + 1, clientY: before.mid[1] }, svg);
		const perPx = ((x1 - anchor[0]) * zoom) / next;
		setZoom(next, anchor, [(after.mid[0] - before.mid[0]) * perPx, (after.mid[1] - before.mid[1]) * perPx]);
	}

	function liftFinger(e: PointerEvent) {
		fingers.delete(e.pointerId);
		if (fingers.size === 0) pinching = false;
	}

	/**
	 * 滾輪和觸控板捏合：照滾了多少成比例縮放。觸控板捏合是一連串 Ctrl＋滾輪的小事件（deltaY 約是 -100 × ln(放大倍數)），
	 * 每個事件都放大一格的話，捏一下就跳到最大。滑鼠滾一格（deltaY 約 100）放大約 1.25 倍。
	 */
	function onwheel(e: WheelEvent) {
		e.preventDefault();
		const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
		setZoom(zoom * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0025)), toMeters(e, svg));
	}

	function down(e: PointerEvent) {
		if (e.button !== 0) return;
		if (e.pointerType === 'touch' && controls) {
			fingers.set(e.pointerId, [e.clientX, e.clientY]);
			if (fingers.size >= 2 || pinching) {
				// 第二根手指：不拖人、不框選，改成捏合。
				pinching = true;
				drag = null;
				box = null;
				svg.setPointerCapture?.(e.pointerId);
				return;
			}
		}
		const id =
			(e.target as Element).closest?.('[data-member-id]')?.getAttribute('data-member-id') ??
			(e.pointerType === 'touch' ? nearestDot(e) : null);
		const client: [number, number] = [e.clientX, e.clientY];
		if (!session) return;
		if (id && positions[id]) {
			const ids = selected.includes(id) && selected.length > 1 ? selected.filter((i) => positions[i]) : [id];
			const orig = Object.fromEntries(ids.map((i) => [i, positions[i]]));
			drag = { id, ids, client, shift: e.shiftKey, start: toMeters(e, svg), orig, cur: null };
		} else if (!id) {
			box = { client, shift: e.shiftKey || session.multiSelect, a: toMeters(e, svg), b: null };
		} else return;
		svg.setPointerCapture?.(e.pointerId);
	}

	/** 手指沒剛好按在點上時，離手指這麼多 px 以內最近的人也算按到（點看起來不變）。 */
	const FINGER_PX = 22;

	function nearestDot(e: PointerEvent): string | null {
		const [x, y] = toMeters(e, svg);
		const [x1] = toMeters({ clientX: e.clientX + 1, clientY: e.clientY }, svg);
		let best: string | null = null;
		let bestD = FINGER_PX * Math.abs(x1 - x);
		for (const m of members) {
			const p = positions[m.id];
			const d = p ? Math.hypot(p[0] - x, p[1] - y) : Infinity;
			if (d <= bestD) [best, bestD] = [m.id, d];
		}
		return best;
	}

	/** 還在「點一下」的範圍內（還沒開始拖）。 */
	function still(e: PointerEvent, client: [number, number]) {
		return Math.hypot(e.clientX - client[0], e.clientY - client[1]) < CLICK_PX;
	}

	function move(e: PointerEvent) {
		if (pinching) {
			if (fingers.size === 2 && fingers.has(e.pointerId)) pinchMove(e);
			return;
		}
		if (drag && (drag.cur || !still(e, drag.client))) {
			const [px, py] = toMeters(e, svg);
			const o = drag.orig[drag.id];
			drag.cur = snapPosition(field, [o[0] + px - drag.start[0], o[1] + py - drag.start[1]], zoom);
		} else if (box && (box.b || !still(e, box.client))) {
			box.b = toMeters(e, svg);
		}
	}

	function up(e: PointerEvent) {
		liftFinger(e);
		if (drag?.cur) drop(dragged);
		else if (drag) session?.pickMember(drag.id, drag.shift);
		else if (box) session?.selectMembers(box.b ? inBox(box.a, box.b, box.shift) : []);
		drag = null;
		box = null;
	}

	/** 放開拖的人：改播放頭這一拍的站位（沒有就插一張），被擋就說原因（人彈回原位）。 */
	function drop(moves: Record<string, Position>) {
		const s = session!;
		const sec = playback!.sec;
		s.ask.send(() => moveMembers(s.flow!, sec, moves), { done: (r) => s.moved(r) });
	}

	/** 方向鍵移人：跟拖人一樣，但連續移同一批人、同一拍（中間沒有別的改動）合成復原的一步。 */
	function nudge(moves: Record<string, Position>) {
		const s = session!;
		const sec = playback!.sec;
		const at = toPosition(s.flow!, sec);
		const key = `${Object.keys(moves).sort().join(',')}@${at?.segmentId}:${at?.at}`;
		s.nudge(key, () => moveMembers(s.flow!, sec, moves), { done: (r) => s.moved(r) });
	}

	const ARROWS: Record<string, Position> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

	/**
	 * 鍵盤操作焦點所在的人：Enter 跟點一下一樣；方向鍵移 1/4 格（Shift 一格），跟拖人一樣吸附、改播放頭這一拍的站位。
	 * 他在選取裡、選了好幾個人時整組一起移。不往外傳，免得頁面把方向鍵當移播放頭。
	 * 空白鍵往外傳：焦點在人身上時，空白鍵跟頁面其他地方一樣是播放／暫停。
	 */
	function dotKey(e: KeyboardEvent, id: string) {
		if (!session) return;
		if (e.key === 'Enter') {
			e.preventDefault();
			e.stopPropagation();
			session.pickMember(id, e.shiftKey);
			return;
		}
		const dir = ARROWS[e.key];
		if (!dir || e.ctrlKey || e.metaKey || e.altKey || !positions[id]) return;
		e.preventDefault();
		e.stopPropagation();
		const step = e.shiftKey ? CELL_M : CELL_M / 4;
		const o = positions[id];
		const to = snapPosition(field, [o[0] + dir[0] * step, o[1] + dir[1] * step], zoom);
		const ids = selected.includes(id) && selected.length > 1 ? selected.filter((i) => positions[i]) : [id];
		const [dx, dy] = [to[0] - o[0], to[1] - o[1]];
		nudge(Object.fromEntries(ids.map((i) => [i, [positions[i][0] + dx, positions[i][1] + dy] as Position])));
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

<div class="field-wrap" class:with-rail={controls}>
	{#if controls}
		<div class="rail">
			<div class="tools">
				<button type="button" class="ghost icon" aria-label="縮小" onclick={() => setZoom(zoom / ZOOM_STEP)}
					><Icon name="minus" /></button
				>
				<span class="zoom">×{zoom.toFixed(1)}</span>
				<button type="button" class="ghost icon" aria-label="放大" onclick={() => setZoom(zoom * ZOOM_STEP)}
					><Icon name="plus" /></button
				>
				<button type="button" class="ghost" disabled={zoom === 1} onclick={() => setZoom(1)}
					><Icon name="fit" />全場</button
				>
			</div>
			{@render railTop?.()}
			<div class="rail-gap"></div>
			{@render railBottom?.()}
			<div class="walk-tools">
				<label title="勾起來時，正常的白色走位線藏起來，只畫很喘（橘）和走太快（紅）的線">
					<input type="checkbox" checked={!allWalkLines} onchange={() => (allWalkLines = !allWalkLines)} />只看橘紅走位線
				</label>
				<span aria-hidden="true"><i class="tiring"></i>很喘</span>
				<span aria-hidden="true"><i class="fast"></i>走太快</span>
				<span aria-hidden="true"><b class="clash-mark">✕</b>撞位</span>
			</div>
			<div class="legend" aria-hidden="true">
				<span><i class="base"></i>底層</span>
				<span><i class="top"></i>上層</span>
				<span><i class="up"></i>正在上面</span>
			</div>
		</div>
	{/if}
	<div class="stage" {@attach watchStage}>
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
		onpointercancel={(e) => {
			liftFinger(e);
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
		<path class="center" d="M-.35,-.35L.35,.35M-.35,.35L.35,-.35"><title>場地正中心</title></path>
		<!-- 條編號寫在墊子裡靠後（橫放靠左）的邊、每條的中間：場外等著的人（排在場地外半格）和接縫上的人都不會蓋到 -->
		{#each g.strips as s (s.number)}
			<text
				class="num"
				data-strip-number
				x={vertical ? s.rect.x + s.rect.width / 2 : g.mat.x + 0.35}
				y={vertical ? g.mat.y + 0.45 : s.rect.y + s.rect.height / 2 + 0.14}>{s.number}</text
			>
		{/each}
		<text class="front" x="0" y={g.outer.y + g.outer.height + 0.7}>▼ 正面／裁判 ▼</text>
		{#each ghostDots as { id, p } (id)}
			<circle data-ghost={id} class="ghost-dot" cx={p[0]} cy={p[1]} r={DOT_R * dotScale} />
		{/each}
		{#each walkLines as w (w.memberId)}
			<line
				data-walk-line={w.memberId}
				class="walk-line"
				class:fast={w.tooFast}
				class:tiring={w.tiring}
				x1={w.from[0]}
				y1={w.from[1]}
				x2={w.to[0]}
				y2={w.to[1]}
			/>
		{/each}
		{#each clashes as c, i (i)}
			<path
				data-clash={c.memberIds.join(',')}
				class="clash"
				d="M-.3,-.3L.3,.3M-.3,.3L.3,-.3"
				transform="translate({c.pos[0]},{c.pos[1]})"
				><title>撞位：{c.memberIds.map((id) => members.find((m) => m.id === id)?.name ?? '').join('、')}</title></path
			>
		{/each}
		{#each snapDots as p, i (i)}
			<circle data-snap-point class="snap" class:fine={p.fine} cx={p.x} cy={p.y} r={p.fine ? 0.035 : 0.05} />
		{/each}
		{#each dots as { m, mark, p, up, sel } (m.id)}
			<g
				class="dot"
				class:raised={up}
				class:selected={sel}
				class:dragging={drag?.cur && drag.ids.includes(m.id)}
				data-member-id={m.id}
				role="button"
				tabindex={session ? 0 : undefined}
				aria-label={m.name}
				aria-pressed={session ? sel : undefined}
				onkeydown={(e) => dotKey(e, m.id)}
				transform="translate({p[0]},{p[1]})"
			>
				<title>{m.name}</title>
				<g transform="scale({dotScale})">
					{#if sel}<circle class="ring" r="0.42" />{/if}
					<circle class={m.globalRole} r={DOT_R} />
					<text y={isLongMarker(mark) ? 0.08 : 0.11} class:long={isLongMarker(mark)}>{mark}</text>
					{#if badges[m.id]}
						<g class="badge" transform="translate(0.27,-0.27)">
							<circle r="0.17" style:fill={badges[m.id].color} />
							<text y="0.065">{badges[m.id].text}</text>
						</g>
					{/if}
				</g>
			</g>
		{/each}
		{#if lasso}
			<rect data-lasso class="lasso" x={lasso.x} y={lasso.y} width={lasso.width} height={lasso.height} />
		{/if}
	</svg>
	{#if readout}<div class="readout">{readout}</div>{/if}
	{@render children?.()}
	<div class="below">{@render below?.()}</div>
	</div>
</div>

<style>
	.field-wrap {
		position: relative;
		width: 100%;
		height: 100%;
	}
	.field-wrap.with-rail {
		display: grid;
		grid-template-columns: 236px minmax(0, 1fr);
		gap: 0 12px;
	}
	.stage {
		position: relative;
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
	}
	/* 左欄：上面是放大縮小和提示，下面是跟上一張一樣、拖人會改、圖例。 */
	.rail {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
		min-height: 0;
		overflow-y: auto;
	}
	.rail > :global(*) {
		max-width: 100%;
	}
	.rail-gap {
		flex: 1;
	}
	.field {
		display: block;
		width: 100%;
		height: 100%;
		user-select: none;
		touch-action: none;
	}
	.margin {
		fill: #e4e8ef;
		stroke: #c3cad7;
		stroke-width: 0.03;
		stroke-dasharray: 0.2 0.15;
	}
	.mat {
		fill: var(--mat, #2f66b8);
		stroke: var(--mat-deep, #1d4489);
		stroke-width: 0.06;
	}
	.grid {
		stroke: #fff;
		stroke-opacity: 0.16;
		stroke-width: 0.025;
	}
	.seam {
		stroke: #12306a;
		stroke-width: 0.07;
	}
	.center {
		stroke: #fff;
		stroke-opacity: 0.85;
		stroke-width: 0.08;
		fill: none;
	}
	text {
		text-anchor: middle;
		font-family: inherit;
	}
	.num {
		font-size: 0.4px;
		fill: #fff;
		fill-opacity: 0.75;
		font-weight: 700;
		pointer-events: none;
	}
	.front {
		font-size: 0.42px;
		fill: var(--now, #f2542d);
		font-weight: 700;
		letter-spacing: 0.08px;
	}
	/* 影子和走位線：淡淡的，不擋點，也不吃滑鼠（點人、拖人、框選照舊）。 */
	.ghost-dot {
		fill: #fff;
		fill-opacity: 0.22;
		stroke: #fff;
		stroke-opacity: 0.6;
		stroke-width: 0.03;
		stroke-dasharray: 0.08 0.06;
		pointer-events: none;
	}
	.walk-line {
		stroke: #fff;
		stroke-opacity: 0.55;
		stroke-width: 0.06;
		stroke-linecap: round;
		pointer-events: none;
	}
	.walk-line.fast {
		stroke: var(--walk-fast, #e5202e);
		stroke-opacity: 0.9;
		stroke-width: 0.08;
	}
	.walk-line.tiring {
		stroke: var(--walk-tiring, #ff9500);
		stroke-opacity: 0.9;
		stroke-width: 0.08;
	}
	/* 撞位的 ✕：紫色粗線，蓋在走位線上面；不吃滑鼠。 */
	.clash {
		fill: none;
		stroke: var(--walk-clash, #a855f7);
		stroke-width: 0.12;
		stroke-linecap: round;
		pointer-events: none;
	}
	.snap {
		fill: #ffe27a;
		opacity: 0.9;
		pointer-events: none;
	}
	.snap.fine {
		fill: #9ff3d6;
		opacity: 0.75;
	}
	.dot {
		cursor: grab;
		/* 點了會拿到焦點；瀏覽器的焦點框用 SVG 的單位（公尺）畫，會變成蓋住場地的大圈。選取已經有 .ring。 */
		outline: none;
	}
	.dot.dragging {
		cursor: grabbing;
	}
	/* 用鍵盤停到人時，圓點的邊加粗變色當焦點框。 */
	.dot:focus-visible circle:not(.ring) {
		stroke: var(--sel);
		stroke-width: 0.1;
	}
	.dot circle {
		stroke: #16213a;
		stroke-width: 0.04;
	}
	.dot.selected circle.ring {
		fill: rgba(25, 180, 216, 0.25);
		stroke: #7fe6ff;
		stroke-width: 0.07;
	}
	.lasso {
		fill: rgba(127, 230, 255, 0.16);
		stroke: #7fe6ff;
		stroke-width: 0.04;
		stroke-dasharray: 0.15 0.08;
		pointer-events: none;
	}
	.dot circle.base {
		fill: #fff;
	}
	.dot circle.top {
		fill: var(--top, #e0664f);
	}
	.dot.raised {
		filter: drop-shadow(0 0.08px 0.1px rgba(0, 0, 0, 0.55));
	}
	.dot.raised circle {
		stroke: #ffd400;
		stroke-width: 0.08;
	}
	.dot text {
		font-size: 0.3px;
		font-weight: 700;
		fill: #16213a;
		pointer-events: none;
	}
	.dot text.long {
		font-size: 0.2px;
	}
	.dot .badge circle {
		stroke: #fff;
		stroke-width: 0.03;
	}
	.dot .badge text {
		font-size: 0.2px;
		fill: #fff;
	}
	.dot circle.top + text {
		fill: #fff;
	}
	.tools {
		display: flex;
		gap: 2px;
		align-items: center;
		background: rgba(255, 255, 255, 0.94);
		border-radius: 10px;
		padding: 3px;
		box-shadow: 0 1px 4px rgba(22, 33, 58, 0.12);
	}
	.tools button {
		height: 28px;
		font-size: 12px;
	}
	.zoom {
		min-width: 3.2em;
		text-align: center;
		font-size: 12px;
		font-variant-numeric: tabular-nums;
		color: var(--muted, #66718a);
	}
	.walk-tools {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 10px;
		align-items: center;
		padding: 5px 10px;
		background: rgba(255, 255, 255, 0.94);
		border-radius: 10px;
		box-shadow: 0 1px 4px rgba(22, 33, 58, 0.12);
		font-size: 12px;
		color: var(--muted, #66718a);
	}
	.walk-tools label {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		color: var(--text, #1a2238);
		cursor: pointer;
	}
	.walk-tools input {
		margin: 0;
	}
	/* 手指：勾選框那一行至少 32px 高。 */
	@media (pointer: coarse) {
		.walk-tools label {
			min-height: 32px;
		}
	}
	.walk-tools span {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.walk-tools i {
		width: 14px;
		height: 3px;
		border-radius: 2px;
	}
	.walk-tools .tiring {
		background: var(--walk-tiring, #ff9500);
	}
	.walk-tools .fast {
		background: var(--walk-fast, #e5202e);
	}
	.walk-tools .clash-mark {
		color: var(--walk-clash, #a855f7);
		font-size: 12px;
	}
	.legend {
		display: flex;
		gap: 12px;
		padding: 5px 10px;
		background: rgba(255, 255, 255, 0.94);
		border-radius: 10px;
		box-shadow: 0 1px 4px rgba(22, 33, 58, 0.12);
		font-size: 12px;
		color: var(--muted, #66718a);
		pointer-events: none;
	}
	.legend span {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.legend i {
		width: 11px;
		height: 11px;
		border-radius: 50%;
		border: 1.5px solid #16213a;
	}
	.legend .base {
		background: #fff;
	}
	.legend .top {
		background: var(--top, #e0664f);
	}
	.legend .up {
		background: #fff;
		border: 2px solid #ffd400;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
	}
	/* 「正面／裁判」那一排在畫面最下面（見 fullView）：浮動列貼著它置中。 */
	.below {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 4px;
		display: flex;
		justify-content: center;
		pointer-events: none;
	}
	.below > :global(*) {
		pointer-events: auto;
	}
	.readout {
		position: absolute;
		left: 4px;
		top: 4px;
		padding: 5px 10px;
		background: rgba(22, 33, 58, 0.92);
		color: #fff;
		border-radius: 8px;
		font-size: 13px;
		font-variant-numeric: tabular-nums;
		pointer-events: none;
	}
</style>
