<script lang="ts" module>
	import { fieldGeometry, type FieldConfig, type Rect } from '#lib/core';

	/**
	 * 外圍框外寫條編號、格號的那一條留多寬（公尺）：放大了的場外圓點也蓋不到編號。
	 * 後面寫左右那一軸的號碼（直放的條號、橫放的格號），左邊寫前後那一軸的（直放的格號、橫放的條號）。
	 */
	export const NUMBER_BAND = 0.8;

	/**
	 * 整個場地的畫面範圍（公尺）：外圍以外再留給條編號、格號（NUMBER_BAND，左右都留，場地才置中）和「正面／裁判」字樣的空間。
	 * 編輯頁拿它的長寬比分配右邊欄的寬度。
	 */
	export function fullView(field: FieldConfig) {
		const { outer } = fieldGeometry(field);
		const b = NUMBER_BAND;
		return { x: outer.x - b, y: outer.y - b, width: outer.width + 2 * b, height: outer.height + b + 1 };
	}
</script>

<script lang="ts">
	// 場地：SVG 的使用者座標就是流程核心的公尺座標（原點中心 X，y 往正面＝畫面下面）。
	// 編輯頁（有 session、有按鈕）才能選人、拖人，選取從 session 拿；八拍表的小站位圖只畫。
	// 拖人：吸附和位置文字都問流程核心；放開時把新位置（公尺）改進播放頭這一拍的站位，送到 session 的 ask，
	// 改好了 session 說插了站位或往後帶了幾張、播放頭停到那張（session.moved）。
	// 放大縮小：按鈕（到上下限停用）、Ctrl／⌘＋滾輪、兩指捏合。放大後滾輪、觸控板兩指滑、兩指一起拖是平移（Shift＋滾輪左右移），
	// 拖人拖到畫面邊上會自動捲。圓點照倍數開根號放大（×4 看起來大 2 倍），條號、格號固定在畫面邊上。
	// 放大後放大縮小旁邊有 ✋：按下去拖空白處是平移（不框選），再按變回框選；按住 H 是暫時平移。空白鍵不管，照舊播放。
	// 選人：點人（Shift＋點或開著多選時多選）、拖空白處框選；選了好幾個人時拖其中一個，整組照他吸附後的位移一起移；
	// 拖一個沒選到的人，選取換成他。選到一個人時場地下面寫他的名字和位置。
	// 影子和走位線（編輯頁才給，八拍表的小站位圖不給）：畫在點下面，不吃滑鼠。
	// 有按鈕時（編輯頁）左邊是一欄工具（放大縮小和 railHead 固定在上面、railTop、railBottom、圖例），場地在右邊，工具不會蓋到場地；
	// 選到人時場地正上方浮出選人工具列；在人身上按右鍵是同一份清單的選單（SelectionTools）。
	// children 疊在場地上（置中的提示、確認框）；below（分組浮動列）浮在外圍框下面「正面／裁判」那一排，不蓋到場地、也不讓場地變小。
	import type { Snippet } from 'svelte';
	import {
		CELL_M,
		fieldPositionText,
		moveMembers,
		positionsAt,
		snapGroup,
		snapPointsNear,
		snapPosition,
		TIRING_MPS,
		TOO_FAST_MPS,
		toPosition,
		type Clash,
		type FormationWalk,
		type Member,
		type Position
	} from '#lib/core';
	import { getEditor } from '#lib/editor.svelte.js';
	import { AT_EDGE, VIEW_ONLY, getEditorSession, hasEditorSession } from '#lib/editor-session.svelte.js';
	import { isTouchScreen } from '#lib/editor-layout.js';
	import { loadLegendOpen, saveLegendOpen } from '#lib/local-settings.js';
	import Icon from './Icon.svelte';
	import SelectionTools, { TOOLS_H_PX } from './SelectionTools.svelte';
	import { isLongMarker, markerWidth } from './marker';
	import { onEscape } from './pointer';

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
		rail = true,
		ghosts = {},
		walks = [],
		clashes = [],
		railHead,
		railTop,
		railBottom,
		children,
		below,
		badges = {},
		marked = [],
		crop = null
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
		/** false：左欄藏起來（不拆掉，切回來原樣），場地拿整個寬度（檢視模式）。只在 controls 時有左欄。 */
		rail?: boolean;
		/** 上一張站位的位置，畫成淡淡的影子點。有選人時只畫選到的人。 */
		ghosts?: Record<string, Position>;
		/** 走位線，從起點畫到終點；太快的標紅、很喘的標橘。有選人時只畫選到的人。 */
		walks?: FormationWalk[];
		/** 撞位：在撞到的位置畫紫色 ✕。只是提醒。 */
		clashes?: Clash[];
		/** 左欄放大縮小旁邊、固定在上面不捲走的東西（多選、版面回原狀）。 */
		railHead?: Snippet;
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
		/** 只畫這一塊（八拍表的小站位圖，見 eightCountView），標的人塗滿；null 畫整個場地。 */
		crop?: Rect | null;
	} = $props();

	// controls 一開始給了就不換（編輯頁或八拍表）。
	// svelte-ignore state_referenced_locally
	const session = controls && hasEditorSession() ? getEditorSession() : null;
	/** 播放頭（全域秒數）從編輯器 module 的播放拿：拖人改這一拍的站位。有 session 就有編輯器 module（setEditor 一起放）。 */
	const playback = session ? getEditor().playback : null;
	/** 選到的人。 */
	const selected = $derived(session?.selectedMemberIds ?? marked);

	/** 觸控螢幕（iPad）：圓點最小尺寸比較大，手指才點得到。 */
	const touchScreen = isTouchScreen();
	/** 圓點的半徑（公尺）。 */
	const DOT_R = 0.3;
	/** 多字標記的字高（公尺）：寫在橫的膠囊裡。 */
	const LONG_FONT = 0.24;
	/** 多字標記的膠囊寬（公尺）：放得下字、至少跟圓點一樣寬；一兩格寬的標記畫圓點，是 0。 */
	const pillWidth = (mark: string) =>
		isLongMarker(mark) ? Math.max(DOT_R * 2, (markerWidth(mark) / 2) * LONG_FONT + 0.14) : 0;
	/** 編輯頁的圓點在螢幕上最少這麼大（直徑 px）；場地畫得很小時（窄視窗、iPad）放大圓點，標記跟著放大。 */
	const MIN_DOT_PX = touchScreen ? 32 : 22;
	const ZOOM_STEP = 1.25;
	/** 按下後移動不到這麼多 px 算點一下（手抖幾 px 不算拖，不插站位、不吸到別的格點）。 */
	const CLICK_PX = 8;
	const MAX_ZOOM = 8;

	const g = $derived(fieldGeometry(field));
	const vertical = $derived(field.layout === 'vertical');
	const full = $derived(fullView(field));

	let svg: SVGSVGElement;
	/** 場地那一塊的寬和高（px）；jsdom 量不到，是 0。 */
	let stageSize = $state<[number, number]>([0, 0]);
	let zoom = $state(1);
	/** 放大時畫面中心（公尺）；null = 整個場地的中心。 */
	let center = $state<Position | null>(null);
	/** 裁的時候人外面留多少（公尺）。 */
	const CROP_MARGIN = 1;
	/** 八拍表小站位圖：長邊最少放得下幾個圓點並排（範圍越大圓點越大，見 dotScale）。 */
	const MINI_DOTS_ACROSS = 12;
	const view = $derived.by(() => {
		if (crop) {
			const m = CROP_MARGIN;
			return { x: crop.x - m, y: crop.y - m, width: crop.width + 2 * m, height: crop.height + 2 * m };
		}
		const width = full.width / zoom;
		const height = full.height / zoom;
		const [cx, cy] = center ?? [full.x + full.width / 2, full.y + full.height / 2];
		const x = clamp(cx - width / 2, full.x, full.x + full.width - width);
		const y = clamp(cy - height / 2, full.y, full.y + full.height - height);
		return { x, y, width, height };
	});

	/**
	 * 圓點（連選取圈、標記、組號、影子）在場地單位裡放大幾倍：看整個場地時放大到有最小尺寸（夠大就是 1）；
	 * 放大場地時圓點在螢幕上只照倍數開根號變大（×4 大 2 倍），不會一個人佔滿畫面。
	 * 八拍表的小站位圖：範圍大時放大到圓點直徑是長邊的 1/MINI_DOTS_ACROSS，號碼才看得清楚。
	 */
	const dotScale = $derived.by(() => {
		if (!controls) return crop ? Math.max(1, Math.max(view.width, view.height) / MINI_DOTS_ACROSS / (2 * DOT_R)) : 1;
		const [w, h] = stageSize;
		const shrink = 1 / Math.sqrt(zoom);
		if (!w || !h) return shrink;
		// preserveAspectRatio meet：看整個場地時 1 公尺幾 px 看比較緊的那一邊
		const pxPerM = Math.min(w / full.width, h / full.height);
		return Math.max(1, MIN_DOT_PX / (2 * DOT_R * pxPerM)) * shrink;
	});

	/** 條編號、格號：字跟圓點一樣照倍數開根號放大；放大後捲到看不到外圍框外那一條時，固定在畫面邊上。 */
	const numScale = $derived(controls ? 1 / Math.sqrt(zoom) : 1);
	/** 後面那一排號碼（cx 是那一條或那一格左右的中間）。 */
	const topNumberAt = (cx: number): Position => [
		cx,
		Math.max(g.outer.y - NUMBER_BAND / 2, view.y + (NUMBER_BAND / 2) * numScale)
	];
	/** 左邊那一排號碼（cy 是那一條或那一格前後的中間）。 */
	const sideNumberAt = (cy: number): Position => [
		Math.max(g.outer.x - NUMBER_BAND * 0.7, view.x + NUMBER_BAND * 0.3 * numScale),
		cy + 0.09 * numScale
	];
	const numberAt = (s: { rect: { x: number; y: number; width: number; height: number } }): Position =>
		vertical ? topNumberAt(s.rect.x + s.rect.width / 2) : sideNumberAt(s.rect.y + s.rect.height / 2);
	/**
	 * 格號：跟位置文字一樣，直放正面起（寫在左邊）、橫放左起（寫在後面）。
	 * 八拍表的小站位圖（crop）不寫：擠在裁切的邊上會跟條號疊在一起。
	 */
	const cellNumbers = $derived(
		Array.from({ length: crop ? 0 : vertical ? g.rows : g.cols }, (_, i) => ({
			n: i + 1,
			at: vertical
				? sideNumberAt(g.mat.y + g.mat.height - (i + 0.5) * CELL_M)
				: topNumberAt(g.mat.x + (i + 0.5) * CELL_M)
		}))
	);

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
		/** 拖過頭（有人會出界）：整組停在最遠的地方。 */
		atEdge: boolean;
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
	/** 左下的圖例開著嗎（存在這台電腦）。 */
	let legendOpen = $state(loadLegendOpen());
	const legendId = $props.id();
	function toggleLegend() {
		legendOpen = !legendOpen;
		saveLegendOpen(legendOpen);
	}
	const walkLines = $derived(
		walks.filter((w) => shown(w.memberId) && (allWalkLines || w.tooFast || w.tiring))
	);
	const snapDots = $derived(drag?.cur ? snapPointsNear(field, drag.cur, zoom) : []);
	const readout = $derived.by(() => {
		if (!drag?.cur) return '';
		const name = members.find((m) => m.id === drag!.id)?.name ?? '';
		return `${name}　${fieldPositionText(field, drag.cur)}`;
	});
	/** 名字和在哪（滑鼠停在圓點上、選到一個人時寫在場地下面）。 */
	const whereText = (m: Member, p: Position) => `${m.name}　${fieldPositionText(field, p)}`;
	/** 編輯頁選到一個人（不在拖）：場地下面寫他的名字和位置。 */
	const picked = $derived.by(() => {
		if (!session || drag?.cur || selected.length !== 1) return '';
		const m = members.find((x) => x.id === selected[0]);
		return m && positions[m.id] ? whereText(m, positions[m.id]) : '';
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
		// 中心夾在畫面不超出整個場地的範圍裡，挪過頭再挪回來才不會卡住。
		const [w, h] = [full.width / z, full.height / z];
		center = [
			clamp(cx - pan[0], full.x + w / 2, full.x + full.width - w / 2),
			clamp(cy - pan[1], full.y + h / 2, full.y + full.height - h / 2)
		];
		zoom = z;
		if (z === 1) {
			center = null;
			handTool = false;
		}
	}

	// ---------- ✋ 平移：放大後拖空白處移動畫面（不框選）。按 ✋ 切換，或按住 H 暫時用。 ----------
	/** ✋ 按下去了（縮回整個場地就放掉）。 */
	let handTool = $state(false);
	/** 正按著 H。 */
	let holdingH = $state(false);
	/** 現在拖空白處是平移。 */
	const panMode = $derived(zoom > 1 && (handTool || holdingH));
	/** 平移中：上一次指標的螢幕座標。 */
	let pan = $state<[number, number] | null>(null);

	/** 拖著空白處：畫面跟著指標移（跟兩指拖一樣，指到的那一點留在指標下面）。 */
	function panTo(e: PointerEvent) {
		const perPx = metersPerPx(e);
		setZoom(zoom, undefined, [(e.clientX - pan![0]) * perPx, (e.clientY - pan![1]) * perPx]);
		pan = [e.clientX, e.clientY];
	}

	/** 打字的地方按 H 是打字，不是平移。 */
	const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

	/** 按住 H（沒按 Ctrl／⌘／Alt、不在打字的地方）：暫時平移。空白鍵不管，照舊是播放。 */
	function hKey(e: KeyboardEvent, down: boolean) {
		if (e.key.toLowerCase() !== 'h') return;
		if (down && (e.ctrlKey || e.metaKey || e.altKey || (e.target as Element | null)?.closest?.(TYPING))) return;
		holdingH = down;
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

	/** 螢幕 1 px 是幾公尺（現在的倍數）。 */
	function metersPerPx(e: { clientX: number; clientY: number }): number {
		const [x0] = toMeters(e, svg);
		const [x1] = toMeters({ clientX: e.clientX + 1, clientY: e.clientY }, svg);
		return x1 - x0;
	}

	/** Ctrl／⌘＋滾一次最多放大或縮小 e^0.25 ≈ 1.28 倍（滑鼠滾一格）。 */
	const WHEEL_MAX = 0.25;

	/**
	 * Ctrl／⌘＋滾輪、觸控板捏合：照滾了多少成比例縮放（跟時間軸一樣要按 Ctrl／⌘）。觸控板捏合是一連串 Ctrl＋滾輪的小事件
	 * （deltaY 約是 -100 × ln(放大倍數)），每個事件都放大一格的話，捏一下就跳到最大。
	 * 沒按 Ctrl／⌘：放大時是平移（觸控板兩指滑、滑鼠滾輪；Shift＋滾輪左右移），看整個場地時不管（不擋頁面捲動）。
	 */
	function onwheel(e: WheelEvent) {
		const line = e.deltaMode === 1 ? 33 : 1;
		const [dx, dy] = [e.deltaX * line, e.deltaY * line];
		if (e.ctrlKey || e.metaKey) {
			e.preventDefault();
			const step = clamp(-dy * (e.ctrlKey ? 0.01 : 0.0025), -WHEEL_MAX, WHEEL_MAX);
			setZoom(zoom * Math.exp(step), toMeters(e, svg));
			return;
		}
		if (zoom <= 1) return;
		e.preventDefault();
		const [px, py] = e.shiftKey && !dx ? [dy, 0] : [dx, dy];
		const perPx = metersPerPx(e);
		setZoom(zoom, undefined, [-px * perPx, -py * perPx]);
	}

	// ---------- 拖人拖到畫面邊上：自動捲 ----------
	/** 指標離畫面邊緣這麼近（px，含超出畫面）就往那邊捲。 */
	const EDGE_PX = 32;
	/** 自動捲每一格畫面捲幾 px。 */
	const EDGE_STEP_PX = 10;
	/** 拖人時最後的指標位置：停著不動也照樣捲。 */
	let lastPointer: { clientX: number; clientY: number } | null = null;
	let edgeFrame = 0;

	function edgeScroll() {
		edgeFrame = 0;
		if (!drag?.cur || !lastPointer || zoom <= 1) return;
		const [x, y] = toMeters(lastPointer, svg);
		const edge = EDGE_PX * metersPerPx(lastPointer);
		const push = (v: number, lo: number, size: number) => (v < lo + edge ? -1 : v > lo + size - edge ? 1 : 0);
		const dir = [push(x, view.x, view.width), push(y, view.y, view.height)];
		if (!dir[0] && !dir[1]) return;
		const step = EDGE_STEP_PX * metersPerPx(lastPointer);
		const before = [view.x, view.y];
		setZoom(zoom, undefined, [-dir[0] * step, -dir[1] * step]);
		if (view.x === before[0] && view.y === before[1]) return;
		dragTo(lastPointer);
		edgeFrame = requestAnimationFrame(edgeScroll);
	}

	function stopEdgeScroll() {
		if (edgeFrame) cancelAnimationFrame(edgeFrame);
		edgeFrame = 0;
		lastPointer = null;
	}

	/** 右鍵選單開在哪（畫面座標）；null = 沒開。 */
	let menu = $state<{ x: number; y: number } | null>(null);
	/** 選人工具列出現著（編輯頁、能改、有選人）：場上的提示往下排（--tools-h）。 */
	const toolsOn = $derived(!!session && !session.viewing && selected.length > 0);

	/** 在人身上按右鍵（或鍵盤的選單鍵）：他沒選到就選取換成他，開選人選單。空白處照舊是瀏覽器的選單。 */
	function contextMenu(e: MouseEvent) {
		if (!session || session.viewing) return;
		const el = (e.target as Element).closest?.('[data-member-id]');
		const id = el?.getAttribute('data-member-id');
		if (!el || !id) return;
		e.preventDefault();
		if (!selected.includes(id)) session.selectMembers([id]);
		// 鍵盤的選單鍵沒有指標位置：開在那個人旁邊
		const r = el.getBoundingClientRect();
		menu = e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : { x: r.right, y: r.bottom };
	}

	function down(e: PointerEvent) {
		// Mac 的 Control＋點是右鍵：不選人、不拖（交給 contextMenu）
		if (e.button !== 0 || (e.ctrlKey && e.pointerType === 'mouse')) return;
		if (e.pointerType === 'touch' && controls) {
			fingers.set(e.pointerId, [e.clientX, e.clientY]);
			if (fingers.size >= 2 || pinching) {
				// 第二根手指：不拖人、不框選，改成捏合。
				pinching = true;
				drag = null;
				box = null;
				pan = null;
				svg.setPointerCapture?.(e.pointerId);
				return;
			}
		}
		const target = e.target as Element;
		const id =
			target.closest?.('[data-member-id]')?.getAttribute('data-member-id') ??
			(e.pointerType === 'touch' || target.closest?.('[data-clash]') ? nearestDot(e) : null);
		const client: [number, number] = [e.clientX, e.clientY];
		if (!session) return;
		if (!id && panMode) {
			pan = client;
		} else if (id && positions[id]) {
			const ids = selected.includes(id) && selected.length > 1 ? selected.filter((i) => positions[i]) : [id];
			const orig = Object.fromEntries(ids.map((i) => [i, positions[i]]));
			drag = { id, ids, client, shift: e.shiftKey, start: toMeters(e, svg), orig, cur: null, atEdge: false };
		} else if (!id) {
			box = { client, shift: e.shiftKey || session.multiSelect, a: toMeters(e, svg), b: null };
		} else return;
		svg.setPointerCapture?.(e.pointerId);
		offEscape();
		offEscape = onEscape(cancelDrag);
	}

	/** 拖人、框選到一半按 Esc 時拿掉監聽的函式（沒在拖時什麼都不做）。 */
	let offEscape = () => {};

	/** 不拖了（拖到一半按 Esc、觸控被系統打斷）：人回到原位，框選不算。 */
	function cancelDrag() {
		offEscape();
		stopEdgeScroll();
		drag = null;
		box = null;
		pan = null;
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
		if (pan) panTo(e);
		else if (drag && (drag.cur || !still(e, drag.client))) {
			// 拖一個沒選到的人：選取換成他，畫的影子和走位線才是他的。
			if (!drag.cur && !selected.includes(drag.id)) session?.selectMembers([drag.id]);
			if (!drag.cur && playback?.playing) {
				// 播放中一開始拖就先暫停、播放頭停到整拍；拖的人從那一拍的位置算起
				playback.pauseOnBeat();
				const at = positionsAt(session!.flow!, playback.sec);
				drag.orig = Object.fromEntries(drag.ids.map((i) => [i, at[i] ?? drag!.orig[i]]));
			}
			dragTo(e);
			lastPointer = { clientX: e.clientX, clientY: e.clientY };
			if (!edgeFrame && typeof requestAnimationFrame === 'function') edgeFrame = requestAnimationFrame(edgeScroll);
		} else if (box && (box.b || !still(e, box.client))) {
			box.b = toMeters(e, svg);
		}
	}

	/** 拖到指標這裡：按到的人吸附（整組不出界），算在場地公尺座標裡，畫面捲了也對。 */
	function dragTo(e: { clientX: number; clientY: number }) {
		if (!drag) return;
		const [px, py] = toMeters(e, svg);
		const o = drag.orig[drag.id];
		const snapped = snapGroup(field, drag.orig, drag.id, [o[0] + px - drag.start[0], o[1] + py - drag.start[1]], zoom);
		drag.cur = snapped.at;
		drag.atEdge = snapped.clamped;
	}

	function up(e: PointerEvent) {
		liftFinger(e);
		stopEdgeScroll();
		offEscape();
		if (drag?.cur) {
			// 拖完吸附回原本的位置：不算修改；是往外拖、停在邊界，照樣提示（檢視模式說不能改）
			const [x, y] = drag.orig[drag.id];
			if (drag.cur[0] !== x || drag.cur[1] !== y) drop(dragged, drag.atEdge, e.altKey);
			else if (drag.atEdge) session!.notice = session!.viewing ? VIEW_ONLY : AT_EDGE;
		} else if (drag) session?.pickMember(drag.id, drag.shift);
		else if (box) session?.selectMembers(box.b ? inBox(box.a, box.b, box.shift) : []);
		drag = null;
		box = null;
		pan = null;
	}

	/**
	 * 放開拖的人：改播放頭這一拍的站位（沒有就插一張），被擋就說原因（人彈回原位）；atEdge 時提示「已靠到邊界」。
	 * onlyThis = 放開時按著 Alt：只改這張，不往後帶。
	 */
	function drop(moves: Record<string, Position>, atEdge: boolean, onlyThis: boolean) {
		const s = session!;
		const sec = playback!.sec;
		s.ask.send(() => moveMembers(s.flow!, sec, moves, !onlyThis), { done: (r) => s.moved(r, atEdge) });
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
	 * 檢視模式不能移人：方向鍵也往外傳，跟頁面其他地方一樣移播放頭。
	 */
	function dotKey(e: KeyboardEvent, id: string) {
		if (!session) return;
		if (e.key === 'Enter') {
			e.preventDefault();
			e.stopPropagation();
			session.pickMember(id, e.shiftKey);
			return;
		}
		if (session.viewing) return;
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

<svelte:window
	onkeydown={(e) => session && hKey(e, true)}
	onkeyup={(e) => session && hKey(e, false)}
	onblur={() => (holdingH = false)}
/>
<div class="field-wrap" class:with-rail={controls && rail}>
	{#if controls}
		<div class="rail" hidden={!rail}>
			<div class="rail-head">
				<div class="tools">
					<button
						type="button"
						class="ghost icon"
						aria-label="縮小"
						disabled={zoom <= 1}
						onclick={() => setZoom(zoom / ZOOM_STEP)}><Icon name="minus" /></button
					>
					<span class="zoom">×{zoom.toFixed(1)}</span>
					<button
						type="button"
						class="ghost icon"
						aria-label="放大"
						disabled={zoom >= MAX_ZOOM}
						onclick={() => setZoom(zoom * ZOOM_STEP)}><Icon name="plus" /></button
					>
					<button type="button" class="ghost" disabled={zoom === 1} onclick={() => setZoom(1)}
						><Icon name="fit" />整個場地</button
					>
					{#if zoom > 1}
						<button
							type="button"
							class="ghost icon"
							aria-label="平移"
							aria-pressed={handTool}
							title="按下去以後拖空白處是移動畫面，再按一次變回框選（按住 H 拖也可以）"
							onclick={() => (handTool = !handTool)}>✋</button
						>
					{/if}
				</div>
				{@render railHead?.()}
			</div>
			{@render railTop?.()}
			<div class="rail-gap"></div>
			{@render railBottom?.()}
			<!-- 圖例在「只看橘紅走位線」上面：左欄很矮（時間軸拖到最大）時，捲到底最下面那一行工具一定看得到、點得到 -->
			<div class="legend-box" id={legendId} hidden={!legendOpen}>
				<div class="walk-tools" aria-hidden="true">
					<!-- 門檻寫短（m/s），時間軸拉高時左欄還捲得到；滑鼠移上去寫完整的。 -->
					<span title="走位每秒超過 {TIRING_MPS} 公尺、沒到 {TOO_FAST_MPS} 公尺：跑得到但很喘"
						><i class="tiring"></i>很喘 &gt;{TIRING_MPS} m/s</span
					>
					<span title="走位每秒超過 {TOO_FAST_MPS} 公尺：跑不到"><i class="fast"></i>走太快 &gt;{TOO_FAST_MPS} m/s</span>
					<span><b class="clash-mark">✕</b>撞位</span>
				</div>
				<div class="legend" aria-hidden="true">
					<span><i class="base"></i>底層</span>
					<span><i class="top"></i>上層</span>
					<span><i class="up"></i>正在上面</span>
				</div>
			</div>
			<div class="walk-tools">
				<label title="勾起來時，正常的白色走位線藏起來，只畫很喘（橘）和走太快（紅）的線">
					<input type="checkbox" checked={!allWalkLines} onchange={() => (allWalkLines = !allWalkLines)} />只看橘紅走位線
				</label>
				<!-- 圖例可以收起來（存在這台電腦）；收著時箭頭朝上，看得出還能打開 -->
				<button
					type="button"
					class="ghost legend-toggle"
					aria-expanded={legendOpen}
					aria-controls={legendId}
					title={legendOpen ? '收起圖例' : '打開圖例'}
					onclick={toggleLegend}>圖例<span class="caret" aria-hidden="true">{legendOpen ? '▾' : '▴'}</span></button
				>
			</div>
		</div>
	{/if}
	<div class="stage" {@attach watchStage} style:--tools-h={toolsOn ? `${TOOLS_H_PX}px` : null}>
	<!-- 能點人時是 group：role=img 裡面的東西螢幕報讀器當成圖的一部分，讀不到一個一個的隊員。只看的（八拍表）照舊是圖。 -->
	<svg
		bind:this={svg}
		class="field"
		class:mini={!!crop}
		class:pan-mode={panMode}
		class:panning={!!pan}
		viewBox="{view.x} {view.y} {view.width} {view.height}"
		preserveAspectRatio="xMidYMid meet"
		role={session ? 'group' : 'img'}
		aria-label="場地"
		{onwheel}
		onpointerdown={down}
		onpointermove={move}
		onpointerup={up}
		oncontextmenu={contextMenu}
		onpointercancel={(e) => {
			liftFinger(e);
			cancelDrag();
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
		<path class="center" d="M-.4,0L.4,0M0,-.4L0,.4"><title>場地正中心</title></path>
		<!-- 條編號寫在外圍框外面那一條（NUMBER_BAND，直放在後面、橫放在左邊）靠外的地方、每條的中間：
		     墊子上和場外等著的人（觸控螢幕上放大了也一樣）都不會蓋到 -->
		{#each g.strips as s (s.number)}
			{@const [nx, ny] = numberAt(s)}
			<text class="num" data-strip-number x={nx} y={ny} style:font-size="{0.3 * numScale}px">{s.number}</text>
		{/each}
		<!-- 格號（條號的另一軸）：細一點、淡一點，跟條號分得出來 -->
		{#each cellNumbers as { n, at } (n)}
			<text class="num cell-num" data-cell-number x={at[0]} y={at[1]} style:font-size="{0.26 * numScale}px">{n}</text>
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
		{#each snapDots as p, i (i)}
			<circle data-snap-point class="snap" class:fine={p.fine} cx={p.x} cy={p.y} r={p.fine ? 0.035 : 0.05} />
		{/each}
		{#each dots as { m, mark, p, up, sel } (m.id)}
			{@const pill = pillWidth(mark)}
			<g
				class="dot"
				class:raised={up}
				class:selected={sel}
				class:filled={!!crop && sel}
				class:dragging={drag?.cur && drag.ids.includes(m.id)}
				data-member-id={m.id}
				role="button"
				tabindex={session ? 0 : undefined}
				aria-label={session ? whereText(m, p) : m.name}
				aria-pressed={session ? sel : undefined}
				onkeydown={(e) => dotKey(e, m.id)}
				transform="translate({p[0]},{p[1]})"
			>
				<title>{session ? whereText(m, p) : m.name}</title>
				<g transform="scale({dotScale})">
					{#if pill}
						{#if session}<rect class="focus-ring" x={-pill / 2 - 0.24} y="-0.54" width={pill + 0.48} height="1.08" rx="0.54" />{/if}
						{#if sel}<rect class="ring" x={-pill / 2 - 0.12} y="-0.42" width={pill + 0.24} height="0.84" rx="0.42" />{/if}
						<rect class={m.globalRole} x={-pill / 2} y={-DOT_R} width={pill} height={DOT_R * 2} rx={DOT_R} />
					{:else}
						{#if session}<circle class="focus-ring" r="0.54" />{/if}
						{#if sel}<circle class="ring" r="0.42" />{/if}
						<circle class={m.globalRole} r={DOT_R} />
					{/if}
					<text y={pill ? 0.085 : crop ? 0.145 : 0.11} class:long={!!pill}>{mark}</text>
					{#if badges[m.id]}
						<g class="badge" transform="translate({Math.max(pill / 2 - 0.03, 0.27)},-0.27)">
							<circle r="0.17" style:fill={badges[m.id].color} />
							<text y="0.065">{badges[m.id].text}</text>
						</g>
					{/if}
				</g>
			</g>
		{/each}
		<!-- 撞位的 ✕ 在圓點後面畫：蓋在人上面看得到（按在 ✕ 上拖到的是附近的人，見 down）。 -->
		{#each clashes as c, i (i)}
			<path
				data-clash={c.memberIds.join(',')}
				class="clash"
				d="M-.3,-.3L.3,.3M-.3,.3L.3,-.3"
				transform="translate({c.pos[0]},{c.pos[1]})"
				><title>撞位：{c.memberIds.map((id) => members.find((m) => m.id === id)?.name ?? '').join('、')}</title></path
			>
		{/each}
		{#if lasso}
			<rect data-lasso class="lasso" x={lasso.x} y={lasso.y} width={lasso.width} height={lasso.height} />
		{/if}
	</svg>
	{#if readout}<div class="readout">{readout}</div>{/if}
	{#if picked}<div class="picked" role="note" aria-label="選到的人在哪">{picked}</div>{/if}
	{#if session && !session.viewing}
		<SelectionTools {zoom} {menu} onclosemenu={() => (menu = null)} />
	{/if}
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
	.rail[hidden] {
		display: none;
	}
	.rail > :global(*) {
		max-width: 100%;
	}
	/* 放大縮小、版面回原狀固定在左欄上面：左欄捲下去也看得到。 */
	.rail-head {
		position: sticky;
		top: 0;
		z-index: 1;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
		padding-bottom: 2px;
		background: var(--paper, #eceff5);
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
	/* ✋、按住 H：空白處是抓著移的手 */
	.field.pan-mode {
		cursor: grab;
	}
	.field.panning {
		cursor: grabbing;
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
		font-size: 0.3px;
		fill: var(--muted, #66718a);
		font-weight: 700;
		pointer-events: none;
		/* 放大後固定在畫面邊上時可能疊在墊子上：白邊才看得清楚 */
		paint-order: stroke;
		stroke: #fff;
		stroke-width: 0.06px;
		stroke-opacity: 0.8;
	}
	.num.cell-num {
		font-weight: 400;
		fill-opacity: 0.85;
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
	/* 撞位的 ✕：紫色粗線，蓋在走位線和圓點上面；滑鼠移上去看得到是誰撞誰。 */
	.clash {
		fill: none;
		stroke: var(--walk-clash, #a855f7);
		stroke-width: 0.12;
		stroke-linecap: round;
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
	/* 用鍵盤停到人時：圓點外面隔一點距離的青色細框（跟全站的焦點框一樣）；選到是塗滿的 .ring，兩個分得開。 */
	.dot .focus-ring {
		display: none;
		fill: none;
		stroke: var(--sel);
		stroke-width: 0.08;
	}
	.dot:focus-visible .focus-ring {
		display: inline;
	}
	.dot :is(circle, rect) {
		stroke: #16213a;
		stroke-width: 0.04;
	}
	.dot.selected .ring {
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
	/* 八拍表個人表：自己的點塗滿深色、字反白 */
	.dot.filled :is(circle, rect):not(.ring) {
		fill: #16213a;
	}
	.dot.filled text {
		fill: #fff;
	}
	.dot .base {
		fill: #fff;
	}
	.dot .top {
		fill: var(--top, #e0664f);
	}
	.dot.raised {
		filter: drop-shadow(0 0.08px 0.1px rgba(0, 0, 0, 0.55));
	}
	.dot.raised :is(circle, rect) {
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
		font-size: 0.24px;
	}
	/* 八拍表小站位圖：號碼字放大到差不多塞滿圓點，印出來才看得清楚 */
	.field.mini .dot > g > text:not(.long) {
		font-size: 0.4px;
	}
	.dot .badge circle {
		stroke: #fff;
		stroke-width: 0.03;
	}
	.dot .badge text {
		font-size: 0.2px;
		fill: #fff;
	}
	.dot .top + text {
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
	.legend-toggle {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 1px 6px;
		font-size: 12px;
		color: var(--muted, #66718a);
	}
	/* 手指：「圖例」至少 32px 高 */
	@media (pointer: coarse) {
		.legend-toggle {
			min-height: 32px;
		}
	}
	/* 走位線和圓點的圖例放在同一塊白底裡：左欄很矮時（時間軸拖到最大）少佔一點高度 */
	.legend-box {
		display: grid;
		gap: 4px;
		justify-self: start;
		padding: 5px 10px;
		background: rgba(255, 255, 255, 0.94);
		border-radius: 10px;
		box-shadow: 0 1px 4px rgba(22, 33, 58, 0.12);
	}
	.legend-box > .walk-tools,
	.legend-box > .legend {
		padding: 0;
		background: none;
		box-shadow: none;
	}
	.legend-box[hidden] {
		display: none;
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
	/* 選到一個人：寫在左下角「正面／裁判」那一排的空處，不蓋到場地和場外的人。 */
	.picked {
		position: absolute;
		left: 4px;
		bottom: 4px;
		max-width: calc(50% - 90px);
		padding: 3px 8px;
		border-radius: 6px;
		background: rgba(255, 255, 255, 0.94);
		color: var(--text, #1a2238);
		font-size: 12px;
		line-height: 1.35;
		font-variant-numeric: tabular-nums;
		pointer-events: none;
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
