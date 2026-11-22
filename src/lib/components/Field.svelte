<script lang="ts" module>
	// 號碼條的寬和整個場地的範圍搬進流程核心了（流程影片也用）；編輯頁別處還從這裡 import。
	export { NUMBER_BAND, fullView } from '#lib/core';
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
	// 有按鈕時（編輯頁）左邊是一欄工具（放大縮小和 railHead 固定在上面、railTop、圖例），場地在右邊，工具不會蓋到場地；
	// 場地上面固定留的那一條浮出選人工具列（沒選人時只有「全隊跟第 [_] 張一樣」；場地不跳、不被蓋住）；在人身上按右鍵是同一份清單的選單（SelectionTools）。
	// children 疊在場地上（提示、確認框，自己找不蓋住 data-keep-visible 的地方）；below（分組浮動列）浮在外圍框下面「正面／裁判」那一排，不蓋到場地、也不讓場地變小。
	import { untrack, type Snippet } from 'svelte';
	import {
		CELL_M,
		fieldGeometry,
		fieldNumbers,
		fieldPositionWhy,
		frontLabelAt,
		fullView,
		markCovered,
		NUMBER_BAND,
		positionsAt,
		snapGroup,
		snapPointsNear,
		snapPosition,
		TIRING_MPS,
		TOO_FAST_MPS,
		toPosition,
		type Clash,
		type FieldConfig,
		type FormationWalk,
		type Member,
		type Position,
		type Rect
	} from '#lib/core';
	import { getEditor } from '#lib/editor.svelte.js';
	import { m as t } from '#lib/paraglide/messages.js';
	import { whyText, joinText } from '#lib/reason-text.js';
	import { getEditorSession, hasEditorSession } from '#lib/editor-session.svelte.js';
	import { isTouchScreen, SHORT_SCREEN_MAX_H } from '#lib/editor-layout.js';
	import { ownsKey } from '#lib/key-owner.js';
	import { loadLegendOpen, saveLegendOpen } from '#lib/local-settings.js';
	import Icon from './Icon.svelte';
	import SelectionTools from './SelectionTools.svelte';
	import { isLongMarker, markerWidth } from '#lib/marker.js';
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
		levels = {},
		toMeters = screenCtmToMeters,
		controls = true,
		rail = true,
		ghosts = {},
		walks = [],
		clashes = [],
		railHead,
		railTop,
		children,
		below,
		badges = {},
		marked = [],
		crop = null,
		numberBand = NUMBER_BAND,
		tapped = null,
		ontap,
		playing = false,
		peopleBounds = null
	}: {
		field: FieldConfig;
		/** 照名單順序。 */
		members?: Member[];
		/** 點上寫的標記（隊員 id → 字）；沒給的人寫名單裡第幾個。 */
		markers?: Record<string, string>;
		positions?: Record<string, Position>;
		/** 這一刻在空中的人第幾層（2、3；沒寫是地上的第 1 層）：高的層畫在上面，黃框加陰影，三層再加橘框。 */
		levels?: Record<string, number>;
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
		/** 左欄放大縮小下面的東西（現在站位、警告、這一拍的拍點）。 */
		railTop?: Snippet;
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
		/** 外圍框外的號碼條留多寬（公尺）。手機的檢視畫面給窄一點的，場地畫得比較大。 */
		numberBand?: number;
		/** 沒有編輯器時（手機的檢視畫面）點到的人：畫得跟選到一樣。 */
		tapped?: string | null;
		/** 沒有編輯器時（手機的檢視畫面）點一下：點到誰（點空白處是 null）。點兩下的第二下是放大，不叫。 */
		ontap?: (memberId: string | null) => void;
		/** 正在播放：只能看的場地放大了又標了「我」，畫面跟著「我」。 */
		playing?: boolean;
		/** 整支流程大家站過的地方（見 eightCountView）：只能看的場地沒放大時多一顆「只看有人的地方」，放大到這裡（四周留 CROP_MARGIN）。 */
		peopleBounds?: Rect | null;
	} = $props();

	// controls 一開始給了就不換（編輯頁或八拍表）。
	// svelte-ignore state_referenced_locally
	const session = controls && hasEditorSession() ? getEditorSession() : null;
	/** 播放頭（全域秒數）從編輯器 module 的播放拿：拖人改這一拍的站位。有 session 就有編輯器 module（setEditor 一起放）。 */
	const playback = session ? getEditor().playback : null;
	/** 選到的人。 */
	const selected = $derived(session?.selectedMemberIds ?? marked);
	/** 換「我」（marked）那時的選取：之後沒再點人，就標「我」。 */
	let selectedWhenMarked = $state.raw<string[] | null>(null);
	$effect.pre(() => {
		void marked;
		selectedWhenMarked = untrack(() => selected);
	});
	/**
	 * 畫成選到的人：「我」和場上點的人，後選的算（選「我」不清掉選取，動作表單的參加的人跟著選取）；
	 * 都沒有就是沒標。點、拖照樣只看 selected。手機的檢視畫面點到的人（tapped）也算。
	 */
	const lit = $derived.by(() => {
		const ids = marked.length && (!selected.length || selected === selectedWhenMarked) ? marked : selected;
		return tapped && !ids.includes(tapped) ? [...ids, tapped] : ids;
	});
	/**
	 * 只能看的場地（手機的檢視畫面、檢視模式；八拍表的小站位圖不算）：放大場地是為了把站得近的人分開，
	 * 所以圓點、號碼在螢幕上不跟著變大；手指點兩下放大、放大後一根手指拖是移動畫面。
	 * 沒有編輯器時看有沒有給 ontap：八拍表的小站位圖沒給（沒人排上場時也不裁）。
	 */
	const viewOnly = $derived(!crop && (session ? !session.editable : !!ontap));
	/** 點得到人的場地（編輯頁、手機的檢視畫面）：每個圓點是 Tab 停得到的按鈕，Enter 跟點一下一樣。八拍表的小站位圖不算。 */
	const pickable = $derived(!!session || (!crop && !!ontap));
	/** 標了「我」：別人畫淡一點（「我」和圈起來的人不淡）。八拍表的小站位圖不淡：我是塗滿的。 */
	const dim = (id: string) => !crop && marked.length > 0 && !marked.includes(id) && !lit.includes(id);

	/** 觸控螢幕（iPad）：圓點最小尺寸比較大，手指才點得到。 */
	const touchScreen = isTouchScreen();
	/** 圓點的半徑（公尺）。 */
	const DOT_R = 0.3;
	/** 多字標記的字高（公尺）：寫在橫的膠囊裡。 */
	const LONG_FONT = 0.24;
	/** 一兩格寬的標記的字高（公尺）：跟 .dot text 的 font-size 一樣。 */
	const DOT_FONT = 0.3;
	/** 編輯頁的圓點在螢幕上最少這麼大（直徑 px）；場地畫得很小時（窄視窗、iPad）放大圓點，標記跟著放大。 */
	const MIN_DOT_PX = touchScreen ? 32 : 22;
	/**
	 * 只能看的場地（手機的檢視畫面、檢視模式）圓點最少這麼大：號碼跟著到 11px。
	 * 觸控也是 22，不用 MIN_DOT_PX 的 32：不用拖，手指點是找最近的人，32 的話擠的地方疊得更多。
	 */
	const VIEW_MIN_DOT_PX = 22;
	/** 場地上的字（條號、格號、「正面／裁判」、多字標記）在螢幕上最少幾 px（Apple HIG 的最小字級 11 pt）。 */
	const MIN_TEXT_PX = 11;
	const ZOOM_STEP = 1.25;
	/** 按下後移動不到這麼多 px 算點一下（手抖幾 px 不算拖，不插站位、不吸到別的格點）。 */
	const CLICK_PX = 8;
	const MAX_ZOOM = 8;

	const g = $derived(fieldGeometry(field));
	const vertical = $derived(field.layout === 'vertical');
	const full = $derived(fullView(field, numberBand));

	let svg: SVGSVGElement;
	/** 場地那一塊的寬和高（px）；jsdom 量不到，是 0。 */
	let stageSize = $state<[number, number]>([0, 0]);
	let zoom = $state(1);
	/** 放大時畫面中心（公尺）；null = 整個場地的中心。 */
	let center = $state<Position | null>(null);
	/** 這次放大後使用者自己移動過畫面（拖、滾輪平移、兩根手指只移動或縮小）。回整個場地才清掉。 */
	let movedByHand = $state(false);
	/** 正在看「只看有人的地方」，還沒在裡面再放大。回整個場地、在裡面兩根手指再放大（endPinch）清掉。 */
	let fitted = $state(false);
	/** 兩根手指按著：捏的時候畫面不跟，放開再看。放開到一根也不接著拖人，要全部放開。 */
	let pinching = $state(false);
	/**
	 * 這次放大跟著「我」（#331）：只看這幾件事，不在別的地方開關。
	 * 放大了、沒在捏、這次放大沒自己移動過畫面、不是還沒在裡面再放大的「只看有人的地方」。
	 */
	const follow = $derived(zoom > 1 && !pinching && !movedByHand && !fitted);
	/** 裁的時候人外面留多少（公尺）。 */
	const CROP_MARGIN = 1;
	/** 八拍表小站位圖：長邊最少放得下幾個圓點並排（範圍越大圓點越大，見 dotScale）。 */
	const MINI_DOTS_ACROSS = 12;
	/** 一塊範圍四周留 CROP_MARGIN（八拍表的小站位圖、「只看有人的地方」同一個留法）。 */
	const padded = (r: Rect): Rect => {
		const m = CROP_MARGIN;
		return { x: r.x - m, y: r.y - m, width: r.width + 2 * m, height: r.height + 2 * m };
	};
	/** 一個畫面：放大幾倍、中心在哪（公尺）。 */
	type ZoomView = { zoom: number; center: Position };
	const view = $derived.by(() => {
		if (crop) return padded(crop);
		const width = full.width / zoom;
		const height = full.height / zoom;
		const [cx, cy] = center ?? [full.x + full.width / 2, full.y + full.height / 2];
		const x = clamp(cx - width / 2, full.x, full.x + full.width - width);
		const y = clamp(cy - height / 2, full.y, full.y + full.height - height);
		return { x, y, width, height };
	});
	const viewCenter = $derived<Position>([view.x + view.width / 2, view.y + view.height / 2]);

	/**
	 * 圓點（連選取圈、標記、組號、影子）在場地單位裡放大幾倍：看整個場地時放大到有最小尺寸（夠大就是 1）；
	 * 編輯時放大場地，圓點在螢幕上只照倍數開根號變大（×4 大 2 倍），不會一個人佔滿畫面。
	 * 只能看時（手機的檢視畫面、檢視模式）最小尺寸是 VIEW_MIN_DOT_PX，放大場地圓點在螢幕上一樣大：站得近的人才分得開。
	 * 八拍表的小站位圖：範圍大時放大到圓點直徑是長邊的 1/MINI_DOTS_ACROSS，號碼才看得清楚。
	 */
	const dotScale = $derived.by(() => {
		if (crop) return Math.max(1, Math.max(view.width, view.height) / MINI_DOTS_ACROSS / (2 * DOT_R));
		const [w, h] = stageSize;
		const shrink = viewOnly ? 1 / zoom : 1 / Math.sqrt(zoom);
		if (!w || !h) return shrink;
		// preserveAspectRatio meet：看整個場地時 1 公尺幾 px 看比較緊的那一邊
		const pxPerM = Math.min(w / full.width, h / full.height);
		return Math.max(1, (viewOnly ? VIEW_MIN_DOT_PX : MIN_DOT_PX) / (2 * DOT_R * pxPerM)) * shrink;
	});

	/** 現在螢幕上 1 公尺幾 px（preserveAspectRatio meet 看比較緊的那一邊）；jsdom 量不到是 0。 */
	const pxPerMeter = $derived(stageSize[0] && stageSize[1] ? Math.min(stageSize[0] / view.width, stageSize[1] / view.height) : 0);
	/**
	 * 場地上的字多大（公尺）：本來 m 公尺，在螢幕上小於 minPx 時放大到 minPx。SVG 沒有「字不跟著縮」的設定，只能自己算。
	 * 八拍表的小站位圖不放大：印出來的大小跟螢幕量到的不一樣，字跟著圓點放大（見 dotScale）。
	 */
	const fontM = (m: number, minPx: number) => (crop || !pxPerMeter ? m : Math.max(m, minPx / pxPerMeter));

	/** 條編號、格號：字跟圓點一樣（編輯時照倍數開根號放大，只能看時不變大）；放大後捲到看不到外圍框外那一條時，固定在畫面邊上。 */
	const numScale = $derived(crop ? 1 : viewOnly ? 1 / zoom : 1 / Math.sqrt(zoom));
	/**
	 * 條編號、格號的字高（公尺）：至少 MIN_TEXT_PX。
	 * 小站位圖跟圓點上的號碼一樣大（0.4 乘圓點放大的倍數，見 .field.mini 的號碼）：圓點的號碼印出來看得清楚，條號也是（N38）。
	 */
	const stripFont = $derived(crop ? 0.4 * dotScale : fontM(0.3 * numScale, MIN_TEXT_PX));
	const cellFont = $derived(fontM(0.26 * numScale, MIN_TEXT_PX));
	/** 「正面／裁判」的字高（公尺）。 */
	const frontFont = $derived(fontM(0.42, MIN_TEXT_PX));
	/** 多字標記膠囊裡的字高（圓點放大前的公尺）：放大後也至少 MIN_TEXT_PX。 */
	const longFont = $derived(fontM(LONG_FONT * dotScale, MIN_TEXT_PX) / dotScale);
	/** 場地中心記號「＋」每一臂多長（公尺）：比圓點的半徑短。 */
	const centerArm = $derived(Math.min(0.4, 0.9 * DOT_R * dotScale));
	/** 多字標記的膠囊寬（公尺）：放得下字、至少跟圓點一樣寬；一兩格寬的標記畫圓點，是 0。 */
	const pillWidth = (mark: string) =>
		isLongMarker(mark) ? Math.max(DOT_R * 2, (markerWidth(mark) / 2) * longFont + 0.14) : 0;
	/** 條號、格號寫在哪：公式在流程核心（流程影片也用）。八拍表的小站位圖（crop）不寫格號：擠在裁切的邊上會跟條號疊在一起。 */
	const numbers = $derived(fieldNumbers(field, view, stripFont, cellFont, numberBand));
	const cellNumbers = $derived(crop ? [] : numbers.cells);
	const frontLabel = $derived(frontLabelAt(field));

	/** 量場地那一塊多大（視窗、分界、右欄寬變了就重量；不算上面留給選人工具列的那一條）。jsdom 沒有 ResizeObserver，測試裡就不量。 */
	function watchStage(el: HTMLElement) {
		if (typeof ResizeObserver === 'undefined') return;
		const ro = new ResizeObserver(([e]) => (stageSize = [e.contentRect.width, e.contentRect.height]));
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
					? [{ m, mark: markers[m.id] ?? String(i + 1), p, level: levels[m.id] ?? 1, sel: lit.includes(m.id) }]
					: [];
			})
			// SVG 後畫的蓋在上面：層高的排後面。
			.sort((a, b) => a.level - b.level)
	);
	/**
	 * 被不同層蓋到的人畫虛線圈：公式在流程核心（流程影片也用）。圓點都畫在真的位置、原本大小（走位時不會跳），
	 * 在空中的人底色半透明（.dot.raised）。只是站在隔壁（圓點碰到邊）的不算被蓋到。多字的膠囊有直的一段。
	 */
	const covered = $derived(
		markCovered(
			dots.map((d) => ({
				id: d.m.id,
				level: d.level,
				at: d.p,
				c: d.p,
				r: DOT_R * dotScale,
				h: Math.max(0, pillWidth(d.mark) / 2 - DOT_R) * dotScale,
				font: (isLongMarker(d.mark) ? longFont : DOT_FONT) * dotScale
			}))
		).filter((a) => a.covered)
	);
	/** 有選人（或標亮了「我」）時只畫那些人的影子和線；都沒有時畫全隊。 */
	const shown = (id: string) => lit.length === 0 || lit.includes(id);
	const ghostDots = $derived(
		members.flatMap((m) => (ghosts[m.id] && shown(m.id) ? [{ id: m.id, p: ghosts[m.id] }] : []))
	);
	/**
	 * 左下的圖例開著嗎（存在這台電腦）。沒按過「圖例」時，觸控又矮的螢幕（橫拿的 iPad）收著：
	 * 左欄放不下，最下面的「圖例」鈕會被擠出去（N58）。
	 */
	let legendOpen = $state(loadLegendOpen(!(isTouchScreen() && typeof innerHeight === 'number' && innerHeight <= SHORT_SCREEN_MAX_H)));
	const legendId = $props.id();
	function toggleLegend() {
		legendOpen = !legendOpen;
		saveLegendOpen(legendOpen);
	}
	/** 左欄最下面的工具（「圖例」鈕）沒整個捲出來：底部畫淡出漸層提示（N58）。 */
	let railMore = $state(false);
	/**
	 * 量左欄最下面那一塊的按鈕有沒有整個露出來：捲動、左欄或裡面的東西變大變小都重量。
	 * 只看按鈕：那一塊只差幾 px 的留白被裁掉時不算，不然漸層會白白蓋在看得到的工具上。jsdom 沒有 ResizeObserver，測試裡不量。
	 */
	function watchRail(el: HTMLElement) {
		if (typeof ResizeObserver === 'undefined') return;
		const update = () => {
			const bottom = el.getBoundingClientRect().bottom;
			const tools = el.lastElementChild?.querySelectorAll('button') ?? [];
			railMore = [...tools].some((t) => t.getBoundingClientRect().bottom > bottom + 1);
		};
		const ro = new ResizeObserver(update);
		const observeAll = () => [el, ...el.children].forEach((c) => ro.observe(c));
		const mo = new MutationObserver(() => (observeAll(), update()));
		observeAll();
		mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
		el.addEventListener('scroll', update, { passive: true });
		update();
		return () => {
			ro.disconnect();
			mo.disconnect();
			el.removeEventListener('scroll', update);
		};
	}
	const walkLines = $derived(walks.filter((w) => shown(w.memberId)));
	const snapDots = $derived(drag?.cur ? snapPointsNear(field, drag.cur, zoom) : []);
	const readout = $derived.by(() => {
		if (!drag?.cur) return '';
		const name = members.find((m) => m.id === drag!.id)?.name ?? '';
		return t.field_view_where({ name, where: whyText(fieldPositionWhy(field, drag.cur)) });
	});
	/** 名字和在哪（滑鼠停在圓點上、選到一個人時寫在場地下面）。 */
	const whereText = (m: Member, p: Position) => t.field_view_where({ name: m.name, where: whyText(fieldPositionWhy(field, p)) });
	/** 一串名字接成一句（中文用「、」）。 */
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
		// 回整個場地：這次放大的事都清掉，下次放大重新跟著「我」。捏到一半經過整個場地不算，放開時停在整個場地才算（endPinch）。
		if (z === 1 && !pinching) movedByHand = fitted = false;
		const c = viewCenter;
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

	/**
	 * 「只看有人的地方」：放大幾倍、中心在哪，剛好包住大家站過的地方（超出整個場地的部分不算）。
	 * 沒有人站好、或放大不了（範圍沒有比整個場地小）是 null，不出現這顆。
	 */
	const peopleFit = $derived.by((): ZoomView | null => {
		if (!peopleBounds) return null;
		const r = padded(peopleBounds);
		const x0 = Math.max(r.x, full.x);
		const y0 = Math.max(r.y, full.y);
		const x1 = Math.min(r.x + r.width, full.x + full.width);
		const y1 = Math.min(r.y + r.height, full.y + full.height);
		const z = Math.min(MAX_ZOOM, full.width / (x1 - x0), full.height / (y1 - y0));
		return z > 1 ? { zoom: z, center: [(x0 + x1) / 2, (y0 + y1) / 2] as Position } : null;
	});

	/** 放大到「只看有人的地方」：這個畫面本來就包住大家走過的地方，不跟著「我」。 */
	function fitPeople(fit: ZoomView) {
		setZoom(fit.zoom, undefined, [viewCenter[0] - fit.center[0], viewCenter[1] - fit.center[1]]);
		fitted = true;
	}

	// ---------- 放大後播放，畫面跟著「我」（只能看的場地） ----------
	/** 「我」離畫面邊緣不到畫面寬（高）的這麼多，畫面才跟過去：不必每一拍都把他放正中間。 */
	const FOLLOW_EDGE = 0.2;
	/** 標的「我」（只標一個人才算）。 */
	const followed = $derived(viewOnly && follow && playing && zoom > 1 && marked.length === 1 ? positions[marked[0]] : undefined);
	$effect(() => {
		const p = followed;
		if (p) untrack(() => keepInView(p));
	});

	/**
	 * 「我」快走出畫面：畫面挪剛好讓他回到離邊緣 FOLLOW_EDGE 的地方。每一格播放都挪一點點，看起來是順的；
	 * 每次位置一換就挪好，不靠動畫，下一格之前「我」一定在畫面裡。
	 */
	function keepInView([px, py]: Position) {
		const { x, y, width: w, height: h } = view;
		/** 超出離邊緣 FOLLOW_EDGE 那條線多少（公尺，往小的那邊是負的；在線裡面是 0）。 */
		const pastEdge = (p: number, lo: number, size: number) =>
			Math.min(p - (lo + size * FOLLOW_EDGE), 0) + Math.max(p - (lo + size * (1 - FOLLOW_EDGE)), 0);
		const [dx, dy] = [pastEdge(px, x, w), pastEdge(py, y, h)];
		if (dx || dy) setZoom(zoom, undefined, [-dx, -dy]);
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
		// 真的拖了才不再跟著「我」：點一下看是誰時手抖幾 px 不算。
		if (!press || !still(e, press.client)) movedByHand = true;
		const perPx = metersPerPx(e);
		setZoom(zoom, undefined, [(e.clientX - pan![0]) * perPx, (e.clientY - pan![1]) * perPx]);
		pan = [e.clientX, e.clientY];
	}

	/** 按住 H（沒按 Ctrl／⌘／Alt、焦點所在的東西不用 H，例：打字的地方）：暫時平移。空白鍵不管，照舊是播放。 */
	function hKey(e: KeyboardEvent, down: boolean) {
		if (e.key.toLowerCase() !== 'h') return;
		if (down && (e.ctrlKey || e.metaKey || e.altKey || ownsKey(e.target, e.key))) return;
		holdingH = down;
	}

	// ---------- 兩根手指：捏合放大縮小、一起拖移動畫面（iPad）。只有一根時照舊點人、拖人、框選。 ----------
	/** 按在場上的每根手指（pointerId → 螢幕座標）。 */
	const fingers = new Map<number, [number, number]>();
	/** 兩指按下時放大幾倍：從整個場地捏，放大了就是又放大一次（endPinch）。 */
	let pinchFrom = 1;
	/** 兩指按下後，兩指距離一共變成幾倍：看手指本身，畫面卡在整個場地或最大時照算（endPinch 用它分張開、一起拖）。 */
	let pinchSpread = 1;
	/** 兩指按下後畫面動過嗎：沒動過就放開，是放上去而已、或放不大也移不動，照原樣（拖走再拖回原處也算動過）。 */
	let pinchMoved = false;
	/** 兩根手指放開時，兩指距離張開不到按下時的這麼多倍，算只是移動畫面（手指一起拖，兩指距離總會差一點）。 */
	const PINCH_ZOOMED = 1.1;

	function midAndSpan(): { mid: [number, number]; span: number } {
		const [[ax, ay], [bx, by]] = [...fingers.values()];
		return { mid: [(ax + bx) / 2, (ay + by) / 2], span: Math.hypot(ax - bx, ay - by) };
	}

	/** 第二根手指移動：照兩指距離縮放（兩指中間那一點不動），再照中點移了多少挪畫面。 */
	function pinchMove(e: PointerEvent) {
		const before = midAndSpan();
		fingers.set(e.pointerId, [e.clientX, e.clientY]);
		const after = midAndSpan();
		// 手指沒動（送了位置一樣的移動）：不重算，免得 1.2 × 109 ÷ 109 這種小數誤差也算動過畫面。
		if (before.span === 0 || (after.span === before.span && after.mid[0] === before.mid[0] && after.mid[1] === before.mid[1])) return;
		pinchSpread *= after.span / before.span;
		const anchor = toMeters({ clientX: before.mid[0], clientY: before.mid[1] }, svg);
		const next = clamp((zoom * after.span) / before.span, 1, MAX_ZOOM);
		// 螢幕 1 px 是幾公尺（縮放後）。
		const [x1] = toMeters({ clientX: before.mid[0] + 1, clientY: before.mid[1] }, svg);
		const perPx = ((x1 - anchor[0]) * zoom) / next;
		const [z0, [cx, cy]] = [zoom, viewCenter];
		setZoom(next, anchor, [(after.mid[0] - before.mid[0]) * perPx, (after.mid[1] - before.mid[1]) * perPx]);
		if (zoom !== z0 || viewCenter[0] !== cx || viewCenter[1] !== cy) pinchMoved = true;
	}

	function liftFinger(e: PointerEvent) {
		fingers.delete(e.pointerId);
		if (fingers.size === 0 && pinching) {
			pinching = false;
			endPinch();
		}
	}

	/**
	 * 兩根手指都放開：從整個場地放大、或兩指張開了，是又放大一次（在「只看有人的地方」裡就開始跟）；
	 * 只移動畫面、縮小，算自己移動過畫面。停在整個場地：這次放大的事都清掉。畫面沒動過：照原樣。
	 */
	function endPinch() {
		if (zoom === 1) movedByHand = fitted = false;
		if (!pinchMoved || zoom === 1) return;
		if (pinchFrom === 1 || pinchSpread >= PINCH_ZOOMED) fitted = false;
		else movedByHand = true;
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
		movedByHand = true;
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
	/**
	 * 編輯頁、能改：場地上面固定留一條給選人工具列（--tools-h；沒選人時是「全隊跟第 [_] 張一樣」）。場地不跳，
	 * 工具列也不蓋住場上的人和條號（N05）。檢視模式不會有工具列，不留。
	 */
	const band = $derived(!!session?.editable);

	/**
	 * 在人身上按右鍵（或鍵盤的選單鍵）：他沒選到就選取換成他，開選人選單。
	 * 沒選人時在空白處按：開套用全隊的選單（跟第 [_] 張一樣）；有選人時空白處照舊是瀏覽器的選單。
	 */
	function contextMenu(e: MouseEvent) {
		if (!session?.editable) return;
		const el = (e.target as Element).closest?.('[data-member-id]') ?? (selected.length ? null : svg);
		const id = el?.getAttribute('data-member-id');
		if (!el) return;
		e.preventDefault();
		if (id && !selected.includes(id)) session.selectMembers([id]);
		// 鍵盤的選單鍵沒有指標位置：開在那個人（或場地）旁邊
		const r = el.getBoundingClientRect();
		menu = e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : { x: r.right, y: r.bottom };
	}

	// ---------- 只能看的場地：點兩下放大到 ×2、再點兩下回整個場地；放大後一根手指拖是移動畫面（不拖人、不框選） ----------
	/** 點兩下放大到幾倍。 */
	const DOUBLE_TAP_ZOOM = 2;
	/** 兩下隔不到這麼久（毫秒）、離不到這麼遠（px）才算點兩下。 */
	const DOUBLE_TAP_MS = 300;
	const DOUBLE_TAP_PX = 30;
	/** 這根指標用「看」的手勢嗎：手機的檢視畫面（沒有 session）滑鼠、手指都是；檢視模式只有手指（滑鼠照舊框選、Ctrl／⌘＋滾輪）。 */
	const looking = (e: PointerEvent) => viewOnly && (!session || e.pointerType === 'touch');
	/** 「看」的手勢按下去了：放開時沒移動就是點一下。id 是按到的人。 */
	let press: { client: [number, number]; id: string | null } | null = null;
	/** 上一次點一下：下一下夠快、夠近、點到同一個人（或都是空白處）就是點兩下。 */
	let lastTap: { time: number; client: [number, number]; id: string | null } | null = null;

	/**
	 * 「看」的手勢放開：沒移動是點一下。回傳 true 是點兩下（放大或回整個場地），這一下不再當點一下。
	 * 點一下：手機的檢視畫面告訴外面點到誰；檢視模式放大時沒有拖人、框選接手，這裡選人、清選取。
	 */
	function lookRelease(e: PointerEvent): boolean {
		const pressed = press;
		press = null;
		if (!pressed || !still(e, pressed.client)) return false;
		const again =
			lastTap &&
			lastTap.id === pressed.id &&
			e.timeStamp - lastTap.time < DOUBLE_TAP_MS &&
			Math.hypot(e.clientX - lastTap.client[0], e.clientY - lastTap.client[1]) < DOUBLE_TAP_PX;
		if (again) {
			lastTap = null;
			if (zoom > 1) setZoom(1);
			else setZoom(DOUBLE_TAP_ZOOM, toMeters(e, svg));
			return true;
		}
		lastTap = { time: e.timeStamp, client: pressed.client, id: pressed.id };
		if (!session) ontap?.(pressed.id);
		else if (pan) {
			if (pressed.id) session.pickMember(pressed.id, e.shiftKey);
			else session.selectMembers([]);
		}
		return false;
	}

	/** 上一次指標放開的時間：緊接著的 click 是瀏覽器補的（clickDot），按的人在指標事件裡已經處理過了。 */
	let pointerUpAt = -Infinity;
	/** 指標放開後這麼久（毫秒）以內的 click 算是它補的。 */
	const CLICK_AFTER_UP_MS = 500;

	/**
	 * 在場上 click：讀螢幕軟體（例：VoiceOver）按人只送 click、沒有指標事件，跟 Enter 一樣選他。
	 * 手指、滑鼠按完瀏覽器也補一個 click，那個不再算一次。
	 */
	function clickDot(e: MouseEvent) {
		const fromPointer = e.timeStamp - pointerUpAt < CLICK_AFTER_UP_MS;
		// 補的 click 只有一個：用掉了，緊接著讀螢幕軟體按別人照樣算
		pointerUpAt = -Infinity;
		const id = (e.target as Element).closest?.('[data-member-id]')?.getAttribute('data-member-id');
		if (fromPointer || !id || !pickable) return;
		pick(id, e.shiftKey);
	}

	/** 鍵盤、讀螢幕軟體選人：跟手指點一下一樣（手機的檢視畫面告訴外面點到誰）。 */
	function pick(id: string, shift: boolean) {
		if (session) session.pickMember(id, shift);
		else ontap?.(id);
	}

	function down(e: PointerEvent) {
		// Mac 的 Control＋點是右鍵：不選人、不拖（交給 contextMenu）
		if (e.button !== 0 || (e.ctrlKey && e.pointerType === 'mouse')) return;
		const look = looking(e);
		if (e.pointerType === 'touch' && (controls || look)) {
			fingers.set(e.pointerId, [e.clientX, e.clientY]);
			if (fingers.size >= 2 || pinching) {
				// 第二根手指：不拖人、不框選，改成捏合。捏的時候畫面不跟著「我」跑，放開再看（endPinch）。
				if (!pinching) [pinchFrom, pinchSpread, pinchMoved] = [zoom, 1, false];
				pinching = true;
				drag = null;
				box = null;
				pan = null;
				press = null;
				svg.setPointerCapture?.(e.pointerId);
				return;
			}
		}
		const target = e.target as Element;
		const id =
			target.closest?.('[data-member-id]')?.getAttribute('data-member-id') ??
			(e.pointerType === 'touch' || target.closest?.('[data-clash]') ? nearestDot(e) : null);
		const client: [number, number] = [e.clientX, e.clientY];
		if (look) {
			press = { client, id };
			if (zoom > 1) {
				pan = client;
				svg.setPointerCapture?.(e.pointerId);
				return;
			}
		}
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
		press = null;
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
		if (lookRelease(e)) {
			drag = null;
			box = null;
			pan = null;
			return;
		}
		if (drag?.cur) {
			// 拖完吸附回原本的位置：不算修改；是往外拖、停在邊界，照樣提示（檢視模式說不能改）
			const [x, y] = drag.orig[drag.id];
			if (drag.cur[0] !== x || drag.cur[1] !== y) drop(dragged, drag.atEdge, e.altKey);
			else if (drag.atEdge) session!.notice = session!.editable ? t.session_at_edge() : t.session_view_only();
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
		s.ask.send({ name: 'moveMembers', args: [sec, moves, !onlyThis] }, { done: (r) => s.moved(r, { atEdge }) });
	}

	/** 方向鍵移人：跟拖人一樣，但連續移同一批人、同一拍（中間沒有別的改動）合成復原的一步。 */
	function nudge(moves: Record<string, Position>) {
		const s = session!;
		const sec = playback!.sec;
		const at = toPosition(s.flow!, sec);
		const key = `${Object.keys(moves).sort().join(',')}@${at?.segmentId}:${at?.at}`;
		s.nudge(key, { name: 'moveMembers', args: [sec, moves] }, { done: (r) => s.moved(r) });
	}

	const ARROWS: Record<string, Position> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

	/**
	 * 鍵盤操作焦點所在的人：Enter 跟點一下一樣；方向鍵移 1/4 格（Shift 一格），跟拖人一樣吸附、改播放頭這一拍的站位。
	 * 他在選取裡、選了好幾個人時整組一起移。不往外傳，免得頁面把方向鍵當移播放頭。
	 * 空白鍵往外傳：焦點在人身上時，空白鍵跟頁面其他地方一樣是播放／暫停。
	 * 檢視模式不能移人：方向鍵也往外傳，跟頁面其他地方一樣移播放頭。
	 * 手機的檢視畫面（沒有編輯器）：只有 Enter，跟手指點一下一樣。
	 */
	function dotKey(e: KeyboardEvent, id: string) {
		if (e.key === 'Enter' && pickable) {
			e.preventDefault();
			e.stopPropagation();
			pick(id, e.shiftKey);
			return;
		}
		if (!session) return;
		if (!session.editable) return;
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

	/** 框裡的人（照畫出來的位置；Shift 時加上原本選的），照名單順序。 */
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
		<div class="rail" hidden={!rail} {@attach watchRail}>
			<div class="rail-head">
				<div class="tools">
					<button
						type="button"
						class="ghost icon"
						aria-label={t.field_view_zoom_out()}
						disabled={zoom <= 1}
						onclick={() => setZoom(zoom / ZOOM_STEP)}><Icon name="minus" /></button
					>
					<span class="zoom">×{zoom.toFixed(1)}</span>
					<button
						type="button"
						class="ghost icon"
						aria-label={t.field_view_zoom_in()}
						disabled={zoom >= MAX_ZOOM}
						onclick={() => setZoom(zoom * ZOOM_STEP)}><Icon name="plus" /></button
					>
					<button type="button" class="ghost" disabled={zoom === 1} onclick={() => setZoom(1)}
						><Icon name="fit" />{t.field_view_fit()}</button
					>
					{#if zoom > 1}
						<button
							type="button"
							class="ghost icon"
							aria-label={t.field_view_pan()}
							aria-pressed={handTool || holdingH}
							title={t.field_view_pan_hint()}
							onclick={() => (handTool = !handTool)}>✋</button
						>
					{/if}
				</div>
				{@render railHead?.()}
			</div>
			{@render railTop?.()}
			<div class="rail-gap"></div>
			<!-- 圖例在「圖例」鈕上面：左欄很矮（時間軸拖到最大）時，捲到底最下面那一行工具一定看得到、點得到 -->
			<div class="legend-box" id={legendId} hidden={!legendOpen}>
				<div class="walk-tools" aria-hidden="true">
					<!-- 門檻寫短（m/s），時間軸拉高時左欄還捲得到；滑鼠移上去寫完整的。 -->
					<span title={t.field_view_tiring_hint({ tiring: TIRING_MPS, fast: TOO_FAST_MPS })}
						><i class="tiring"></i>{t.field_view_tiring({ n: TIRING_MPS })}</span
					>
					<span title={t.field_view_too_fast_hint({ n: TOO_FAST_MPS })}><i class="fast"></i>{t.field_view_too_fast({ n: TOO_FAST_MPS })}</span>
					<span title={t.field_view_clash_hint()}><b class="clash-mark">✕</b>{t.field_view_clash_legend()}</span>
				</div>
				<div class="legend" aria-hidden="true">
					<span><i class="base"></i>{t.role_base()}</span>
					<span><i class="top"></i>{t.role_top()}</span>
					<span><i class="up"></i>{t.field_view_up()}</span>
					<span><i class="up lv3"></i>{t.role_third()}</span>
					<span><i class="under"></i>{t.field_view_covered()}</span>
				</div>
			</div>
			<div class="walk-tools">
				<!-- 圖例可以收起來（存在這台電腦）；收著時箭頭朝上，看得出還能打開 -->
				<button
					type="button"
					class="ghost legend-toggle"
					aria-expanded={legendOpen}
					aria-controls={legendId}
					title={legendOpen ? t.field_view_legend_hide() : t.field_view_legend_show()}
					onclick={toggleLegend}>{t.field_view_legend()}<span class="caret" aria-hidden="true">{legendOpen ? '▾' : '▴'}</span></button
				>
			</div>
		</div>
		<!-- 左欄下面還有東西（觸控又矮的螢幕放不下）：底部淡出，看得出要往下捲；捲到底就不畫（N58）。不吃滑鼠 -->
		<div class="rail-fade" aria-hidden="true" hidden={!rail || !railMore}></div>
	{/if}
	<div class="stage" class:band {@attach watchStage}>
	<!-- 能點人時（編輯頁、手機的檢視畫面）是 group：role=img 裡面的東西螢幕報讀器當成圖的一部分，讀不到一個一個的隊員。只看的（八拍表）照舊是圖。 -->
	<svg
		bind:this={svg}
		class="field"
		class:mini={!!crop}
		class:pan-mode={panMode}
		class:panning={!!pan}
		viewBox="{view.x} {view.y} {view.width} {view.height}"
		preserveAspectRatio="xMidYMid meet"
		role={pickable ? 'group' : 'img'}
		aria-label={t.field_view_surface()}
		{onwheel}
		onpointerdown={down}
		onclick={clickDot}
		onpointermove={move}
		onpointerup={(e) => {
			pointerUpAt = e.timeStamp;
			up(e);
		}}
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
		<!-- 中心記號的兩臂比圓點短：站在正中心的人身上不露出十字，看起來不會像特別標了他（N56） -->
		<path class="center" d="M{-centerArm},0L{centerArm},0M0,{-centerArm}L0,{centerArm}"><title>{t.field_view_center()}</title></path>
		<!-- 條編號寫在外圍框外面那一條（NUMBER_BAND，直放在後面、橫放在左邊）靠外的地方、每條的中間：
		     墊子上和場外等著的人（觸控螢幕上放大了也一樣）都不會蓋到 -->
		{#each numbers.strips as { n, at } (n)}
			<text class="num" data-strip-number data-keep-visible x={at[0]} y={at[1]} style:font-size="{stripFont}px">{n}</text>
		{/each}
		<!-- 格號（條號的另一軸）：細一點，跟條號分得出來 -->
		{#each cellNumbers as { n, at } (n)}
			<text class="num cell-num" data-cell-number x={at[0]} y={at[1]} style:font-size="{cellFont}px">{n}</text>
		{/each}
		<text class="front" data-keep-visible x={frontLabel[0]} y={frontLabel[1]} style:font-size="{frontFont}px">{t.field_view_front()}</text>
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
		{#each dots as { m, mark, p, level, sel } (m.id)}
			{@const pill = pillWidth(mark)}
			<g
				class="dot"
				class:raised={level >= 2}
				class:lv3={level >= 3}
				class:outlined={!crop}
				class:selected={sel}
				class:dim={dim(m.id)}
				class:filled={!!crop && sel}
				class:dragging={drag?.cur && drag.ids.includes(m.id)}
				data-member-id={m.id}
				data-keep-visible
				role="button"
				tabindex={pickable ? 0 : undefined}
				aria-label={pickable ? whereText(m, p) : m.name}
				aria-pressed={pickable ? sel : undefined}
				onkeydown={(e) => dotKey(e, m.id)}
				transform="translate({p[0]},{p[1]})"
			>
				<title>{pickable ? whereText(m, p) : m.name}</title>
				<g transform="scale({dotScale})">
					{#if pill}
						{#if pickable}<rect class="focus-ring" x={-pill / 2 - 0.24} y="-0.54" width={pill + 0.48} height="1.08" rx="0.54" />{/if}
						{#if sel}<rect class="ring" x={-pill / 2 - 0.12} y="-0.42" width={pill + 0.24} height="0.84" rx="0.42" />{/if}
						<rect class={m.globalRole} x={-pill / 2} y={-DOT_R} width={pill} height={DOT_R * 2} rx={DOT_R} />
					{:else}
						{#if pickable}<circle class="focus-ring" r="0.54" />{/if}
						{#if sel}<circle class="ring" r="0.42" />{/if}
						<circle class={m.globalRole} r={DOT_R} />
					{/if}
					<text y={pill ? 0.35 * longFont : crop ? 0.145 : 0.11} class:long={!!pill} style:font-size={pill ? `${longFont}px` : undefined}
						>{mark}</text
					>
					{#if badges[m.id]}
						<g class="badge" transform="translate({Math.max(pill / 2 - 0.03, 0.27)},-0.27)">
							<circle r="0.17" style:fill={badges[m.id].color} />
							<text y="0.065">{badges[m.id].text}</text>
						</g>
					{/if}
				</g>
			</g>
		{/each}
		<!-- 被不同層蓋到的人：虛線圈畫在所有圓點上面 -->
		{#each covered as { id, c, r, h } (id)}
			{#if h}
				<rect class="covered" x={c[0] - h - r} y={c[1] - r} width={2 * (h + r)} height={2 * r} rx={r} />
			{:else}
				<circle class="covered" cx={c[0]} cy={c[1]} {r} />
			{/if}
		{/each}
		<!-- 撞位的 ✕ 在圓點後面畫：蓋在人上面看得到（按在 ✕ 上拖到的是附近的人，見 down）。 -->
		{#each clashes as c, i (i)}
			<path
				data-clash={c.memberIds.join(',')}
				class="clash"
				d="M-.3,-.3L.3,.3M-.3,.3L.3,-.3"
				transform="translate({c.pos[0]},{c.pos[1]})"
				><title>{t.field_view_clash({ names: joinText(c.memberIds.map((id) => members.find((m) => m.id === id)?.name ?? '')) })}</title></path
			>
		{/each}
		{#if lasso}
			<rect data-lasso class="lasso" x={lasso.x} y={lasso.y} width={lasso.width} height={lasso.height} />
		{/if}
	</svg>
	{#if readout}<div class="readout" data-keep-visible title={readout}>{readout}</div>{/if}
	{#if picked}<div class="picked" data-keep-visible role="note" aria-label={t.field_view_picked()}>{picked}</div>{/if}
	<!-- 只能看、沒有左欄的放大縮小（手機的檢視畫面、檢視模式）：放大了，右下角一顆回整個場地 -->
	{#if viewOnly && (zoom > 1 || peopleFit) && !(controls && rail)}
		<!-- 放大了是「整個場地」，沒放大時同一顆是「只看有人的地方」：同一個按鈕，用鍵盤按了焦點還在上面 -->
		<button
			type="button"
			class:fit={zoom > 1}
			class:people={zoom === 1}
			onclick={() => (zoom > 1 || !peopleFit ? setZoom(1) : fitPeople(peopleFit))}
			>{#if zoom > 1}<Icon name="fit" />{t.field_view_fit()}{:else}{t.field_view_people()}{/if}</button
		>
	{/if}
	{#if session?.editable}
		<SelectionTools {zoom} dragging={!!drag?.cur} {menu} onclosemenu={() => (menu = null)} />
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
	/* 場地上面固定留給選人工具列的那一條（含上面的空隙，SelectionTools 的 .tools-bar 浮在這裡）：場地畫在它下面。
	   工具列出不出現都留著，場地不跳。高度跟 editor-layout.ts 的 FIELD_PAD_Y_PX 一起改。 */
	.stage.band {
		--tools-h: 40px;
		box-sizing: border-box;
		padding-top: var(--tools-h);
	}
	@media (pointer: coarse) {
		.stage.band {
			--tools-h: 52px;
		}
	}
	/* 左欄：上面是放大縮小和提示，下面是拖人會改、圖例。 */
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
	/* 蓋在左欄最下面（左欄那一欄的寬，跟 .field-wrap.with-rail 的 236px 一樣），不佔版面 */
	.rail-fade {
		position: absolute;
		left: 0;
		bottom: 0;
		width: 236px;
		height: 32px;
		pointer-events: none;
		background: linear-gradient(to bottom, transparent, var(--paper, #eceff5) 85%);
	}
	/* 用鍵盤在左欄裡移動時不畫：聚焦的東西會捲進來，漸層不要蓋在它上面（捲動後才重量，會慢一格） */
	.rail-fade[hidden],
	.rail:has(:focus-visible) + .rail-fade {
		display: none;
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
		fill: var(--muted, #66718a);
		font-weight: 700;
		pointer-events: none;
		/* 放大後固定在畫面邊上時可能疊在墊子上：白邊才看得清楚 */
		paint-order: stroke;
		stroke: #fff;
		stroke-width: 0.2em;
		stroke-opacity: 0.8;
	}
	/* 格號只細一點，不調淡：淡灰的字在場地外的灰底上看不清楚（對比要 4.5:1，N50） */
	.num.cell-num {
		font-weight: 400;
	}
	/* 八拍表小站位圖：條號疊在藍墊子上，深色字加不透明的白邊才看得清楚（N38） */
	.field.mini .num {
		fill: var(--ink, #16213a);
		stroke-opacity: 1;
	}
	/* 字比播放頭的朱紅深一點：朱紅字在灰底上對比只有 3:1 */
	.front {
		fill: #b93a1a;
		font-weight: 700;
		letter-spacing: 0.19em;
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
	/* 在空中的人底色半透明：疊在下面的人透得出來，圓點不用錯開（走位時不會跳）。框、字還是實的。跟 RAISED_FILL_OPACITY 一樣。 */
	.dot.raised > g > :is(circle, rect):not(.ring):not(.focus-ring) {
		fill-opacity: 0.6;
	}
	/* 三層：橘框，跟第 2 層的黃框分得出來 */
	.dot.lv3 > g > :is(circle, rect):not(.ring):not(.focus-ring) {
		stroke: #ff7a00;
		stroke-width: 0.1;
	}
	/* 地上的人細深色外框：疊在一起時看得出邊 */
	.dot.outlined:not(.raised) > g > :is(circle, rect):not(.ring):not(.focus-ring) {
		stroke: #16213a;
		stroke-width: 0.035;
	}
	/* 標了「我」時的別人：底色變淡，框和號碼照舊（號碼還看得清楚）。放在各種底色、框的規則後面，蓋得過在空中的人的半透明 */
	.dot.dim > g > :is(circle, rect):not(.ring):not(.focus-ring) {
		fill-opacity: 0.4;
		stroke-opacity: 0.5;
	}
	.covered {
		fill: none;
		stroke: #16213a;
		stroke-width: 0.04;
		stroke-dasharray: 0.08 0.06;
		pointer-events: none;
	}
	.dot text {
		font-size: 0.3px;
		font-weight: 700;
		fill: #16213a;
		pointer-events: none;
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
	/* ✋ 按下去了（或按住 H）：跟選到的東西一樣的顏色，看得出來現在拖空白處是平移 */
	.tools button[aria-pressed='true'] {
		background: var(--sel-soft);
		border-color: var(--sel);
		box-shadow: inset 0 0 0 1px var(--sel);
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
		flex-wrap: wrap;
		gap: 4px 12px;
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
		white-space: nowrap;
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
	.legend .up.lv3 {
		border-color: #ff7a00;
	}
	.legend .under {
		background: #fff;
		border: 1.5px dashed #16213a;
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
	/* 只能看時放大了：右下角的「整個場地」（左下角是站位名稱、選到的人，中間是「正面／裁判」）。白底的膠囊，手指至少 40px 高 */
	.fit,
	.people {
		position: absolute;
		right: 4px;
		bottom: 4px;
		z-index: 6;
		border-radius: 999px;
		font-weight: 600;
		box-shadow: 0 2px 8px rgba(22, 33, 58, 0.15);
	}
	/* 沒放大時同一顆是「只看有人的地方」：字比較多，不畫圖示、字小一點，320px 的手機也不蓋到中間的「正面／裁判」 */
	.people {
		padding: 4px 6px;
		font-size: 12px;
	}
	@media (pointer: coarse) {
		.fit,
		.people {
			min-height: 40px;
		}
	}
	/* 拖人時寫在場地上面那一條（拖人時工具列收起來，讓給它）：不蓋住條號和場上的人。只寫一行，太長的尾巴變「…」 */
	.readout {
		position: absolute;
		left: 4px;
		top: 4px;
		max-width: calc(100% - 8px);
		box-sizing: border-box;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		padding: 5px 10px;
		background: rgba(22, 33, 58, 0.92);
		color: #fff;
		border-radius: 8px;
		font-size: 13px;
		font-variant-numeric: tabular-nums;
		pointer-events: none;
	}
</style>
