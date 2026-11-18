// 流程影片的版面：把一格的內容（videoFrame）排進直的 1080×1920，放不下時決定縮什麼、拿掉什麼。
// 不碰 Canvas：字寬由呼叫端給（measure），測試換成假的（跟 ADR 0002 的 toMeters 同一種做法）。

import {
	actionLabel,
	fullView,
	layerStagger,
	videoRows,
	type CueKind,
	type EightCountCueLine,
	type FieldConfig,
	type Flow,
	type StaggeredDot,
	type VideoFrameData,
	type VideoRow
} from '#lib/core';
import { isLongMarker, markerWidth } from '#lib/marker.js';
import type { ColorKey } from './colors';

export const VIDEO_W = 1080;
export const VIDEO_H = 1920;
/** 字的下限：1080 寬的影片在 390 pt 寬的手機上縮成約 0.36 倍，28 px 看起來約 10 pt。 */
export const MIN_TEXT_PX = 28;

/** 字寬（px）。畫的時候用 Canvas 的 measureText。 */
export type Measure = (text: string, px: number, weight: number) => number;

/** 一行字。y 是字的上緣（Canvas 的 textBaseline 'top'），字佔 y 到 y + px。 */
export interface TextItem {
	text: string;
	x: number;
	y: number;
	px: number;
	weight: number;
	color: ColorKey;
	align?: 'left' | 'center' | 'right';
}

export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
	fill: ColorKey;
	stroke?: ColorKey;
	lineWidth?: number;
	radius?: number;
}

/**
 * 場地怎麼畫：box 是整個場地（fullView）在影片上的範圍，公尺 (mx, my) 畫在
 * (box.x + (mx − fullView.x) × pxPerM, box.y + (my − fullView.y) × pxPerM)。
 * 條號、格號、「正面／裁判」都用 numberPx（給 fieldNumbers 的字高是 numberPx / pxPerM 公尺）。
 */
export interface VideoFieldLayout {
	box: { x: number; y: number; w: number; h: number };
	pxPerM: number;
	dotPx: number;
	markerPx: number;
	numberPx: number;
	/** 1 公尺的圓點在影片上幾 px（圓點放大的倍數）：圓點的線寬、陰影照它，再乘圓點的 scale。 */
	dotUnit: number;
	/** 圓點照這個順序畫（層高的在後面、蓋在上面）。 */
	dots: VideoDot[];
}

/**
 * 一個圓點畫出來的樣子（px，錯開、縮小後）：中心 c、半徑 r、多字膠囊直的那段一半長 h、標記的字高 font、
 * 縮成幾倍 scale（線寬、陰影一起縮）、covered（被不同層蓋到：在所有圓點上面畫一圈虛線）。
 * level 1 是地上，2 黃框，3 橘框。錯開、縮小、虛線圈都問流程核心的 layerStagger，跟場上一樣。
 */
export type VideoDot = StaggeredDot;

/** 照順序畫：boxes 先畫，texts 畫在上面。 */
export interface FrameLayout {
	texts: TextItem[];
	boxes: Box[];
	field: VideoFieldLayout;
	/** 有東西縮成一行、拿掉、或截掉加「⋯」；只縮字不算。 */
	overflow: boolean;
}

/** 字左右留的邊。 */
const LEFT = 48;
const WIDTH = VIDEO_W - 2 * LEFT;
/** 行高是字級的幾倍。 */
const LINE = 1.25;

// 上方 0–320：流程名、在哪和時間、1–8 一排
const TITLE_TOP = 24;
/** 流程名一行放得下就從 56 縮到 40；還放不下就 40 換兩行。 */
const TITLE_PX = [56, 52, 48, 44, 40];
const TITLE_LINES = 2;
const WHERE_Y = 140;
const WHERE_PX = 40;
const BAR_Y = 196;
const BAR_H = 100;
const BAR_PX = 56;
const BAR_GAP = 8;

// 場地 320–1140：整個場地照比例塞進去，置中
const FIELD_ZONE = { x: 24, y: 320, w: VIDEO_W - 48, h: 820 };
/** 圓點的半徑（公尺），跟 Field.svelte 的 DOT_R 一樣；圓點上的標記字高是直徑的一半。 */
const DOT_R = 0.3;
/** 圓點最少多大：手機檢視畫面的 22 px（VIEW_MIN_DOT_PX）÷ 0.36 ≈ 61，取 64，標記才有 32 px。 */
const MIN_DOT_PX = 64;
/** 條號的字高（公尺），跟 Field.svelte 一樣；放大到不小於 MIN_TEXT_PX。 */
const NUMBER_M = 0.3;

// 下面那一列 1160–1880
const ROW_TOP = 1160;
const ROW_BOTTOM = 1880;
const ROW_PX_START = 40;
const ROW_PX_STEP = 2;
/** 字和拍點格子之間。 */
const GRID_GAP = 12;
/** 拍點格子左邊寫動作名字的那一欄。 */
const NAME_W = 192;
const NAME_GAP = 8;
const CELL_W = (WIDTH - NAME_W - NAME_GAP) / 8;
const CELLS_X = LEFT + NAME_W + NAME_GAP;
/**
 * 拍點、環節的框離格線多遠、字離框多遠、上下兩排之間多遠。留白小一點：一拍的格子 28 px 時
 * 一行寫得下 3 個中文字（步驟左邊多一條粗線，還是寫得下）。
 */
const CUE_INSET = 1;
const CUE_PAD = 3;
const SUB_GAP = 4;
/** 步驟左邊那條粗線多寬；字再往右讓開一點。 */
const STEP_BAR = 4;
const STEP_BAR_GAP = 2;

const EMPTY_TEXT = '這一列沒有新的動作、站位';

export function layoutFrame(field: FieldConfig, frame: VideoFrameData, measure: Measure): FrameLayout {
	const top = layoutTop(frame, measure);
	const row = layoutRow(frame.row, frame.beats?.lit ?? null, measure);
	return {
		texts: [...top.texts, ...row.texts],
		boxes: [...top.boxes, ...row.boxes],
		field: layoutField(field, frame),
		overflow: top.overflow || row.overflow
	};
}

/** videoRows 裡放不下（有東西縮掉、拿掉）的列的 label，給輸出前的對話框列出來。 */
export function overflowEights(flow: Flow, measure: Measure): string[] {
	return videoRows(flow)
		.filter(({ row }) => layoutRow(row, null, measure).overflow)
		.map(({ label }) => label);
}

interface Part {
	texts: TextItem[];
	boxes: Box[];
	overflow: boolean;
}

function layoutTop(frame: VideoFrameData, measure: Measure): Part {
	const texts: TextItem[] = [];
	const boxes: Box[] = [];
	const title = layoutTitle(frame.title, measure);
	texts.push(...title.texts);
	texts.push(
		{ text: frame.where, x: LEFT, y: WHERE_Y, px: WHERE_PX, weight: 600, color: 'muted' },
		{ text: frame.clock, x: LEFT + WIDTH, y: WHERE_Y, px: WHERE_PX, weight: 600, color: 'muted', align: 'right' }
	);
	// 口號段和開頭沒有 1–8；最後一個八拍不滿時多的格子灰掉
	if (frame.beats) {
		const { count, lit } = frame.beats;
		const step = WIDTH / 8;
		for (let n = 1; n <= 8; n++) {
			const x = LEFT + (n - 1) * step;
			const off = n > count;
			const on = !off && n === lit;
			boxes.push({ x, y: BAR_Y, w: step - BAR_GAP, h: BAR_H, fill: off ? 'beatOff' : on ? 'beatLit' : 'beatIdle', radius: 12 });
			texts.push({
				text: String(n),
				x: x + (step - BAR_GAP) / 2,
				y: BAR_Y + (BAR_H - BAR_PX) / 2,
				px: BAR_PX,
				weight: 800,
				color: off ? 'beatOffInk' : on ? 'beatLitInk' : 'beatIdleInk',
				align: 'center'
			});
		}
	}
	return { texts, boxes, overflow: title.overflow };
}

/** 流程名：一行放得下就縮到放得下為止；放不下就用最小的字級換兩行，再多截掉加「⋯」。 */
function layoutTitle(title: string, measure: Measure): Part {
	const band = TITLE_LINES * TITLE_PX.at(-1)! * LINE;
	const item = (text: string, px: number, y: number): TextItem => ({ text, x: LEFT, y, px, weight: 800, color: 'ink' });
	for (const px of TITLE_PX) {
		if (measure(title, px, 800) <= WIDTH) return { texts: [item(title, px, TITLE_TOP + (band - px) / 2)], boxes: [], overflow: false };
	}
	const px = TITLE_PX.at(-1)!;
	const lines = wrap(title, px, 800, WIDTH, measure);
	const shown = lines.slice(0, TITLE_LINES);
	const cut = lines.length > TITLE_LINES;
	if (cut) shown[TITLE_LINES - 1] = withEllipsis(shown[TITLE_LINES - 1], px, 800, WIDTH, measure);
	const lh = px * LINE;
	return { texts: shown.map((t, i) => item(t, px, TITLE_TOP + i * lh + (lh - px) / 2)), boxes: [], overflow: cut };
}

function layoutField(field: FieldConfig, frame: VideoFrameData): VideoFieldLayout {
	const view = fullView(field);
	const pxPerM = Math.min(FIELD_ZONE.w / view.width, FIELD_ZONE.h / view.height);
	const w = view.width * pxPerM;
	const h = view.height * pxPerM;
	const box = { x: FIELD_ZONE.x + (FIELD_ZONE.w - w) / 2, y: FIELD_ZONE.y + (FIELD_ZONE.h - h) / 2, w, h };
	// 圓點照手機檢視畫面的做法放大到有最小尺寸，站得近的人會疊到，可以接受
	const dotPx = Math.max(2 * DOT_R * pxPerM, MIN_DOT_PX);
	const markerPx = dotPx / 2;
	// 1 公尺的圓點在影片上幾 px：錯開的距離、膠囊的留白都照它
	const unit = dotPx / (2 * DOT_R);
	const plain = Object.keys(frame.positions)
		.map((id) => {
			const [mx, my] = frame.positions[id];
			const mark = frame.markers[id] ?? '';
			const pill = isLongMarker(mark) ? Math.max(dotPx, (markerWidth(mark) / 2) * markerPx + 0.14 * unit) : dotPx;
			const c: [number, number] = [box.x + (mx - view.x) * pxPerM, box.y + (my - view.y) * pxPerM];
			return { id, level: frame.levels[id] ?? 1, c, r: dotPx / 2, h: (pill - dotPx) / 2, font: markerPx };
		})
		// 後畫的蓋在上面：層高的排後面（同一層照原本的順序）
		.toSorted((a, b) => a.level - b.level);
	// 縮小後標記的字還是要至少 MIN_TEXT_PX：不夠大就少縮一點
	const { drawn } = layerStagger(plain, unit, (font) => MIN_TEXT_PX / font);
	return { box, pxPerM, dotPx, markerPx, numberPx: Math.max(NUMBER_M * pxPerM, MIN_TEXT_PX), dotUnit: unit, dots: drawn };
}

/** 放不下時拿掉多少：從最下面縮幾個還在做的動作、拿掉幾個備註、留前面幾個動作。 */
interface Squeeze {
	collapsed: number;
	notesDropped: number;
	kept: number;
}

/** 一段字（還沒換行）。 */
interface Para {
	text: string;
	weight: number;
	color: ColorKey;
}

/**
 * 下面那一列：先用 40 排，太高就一級一級縮到 28；到 28 還太高就照順序拿東西（squeezes），
 * 都拿了還太高就截在區塊底、最後一行加「⋯」。拍點格子不拿、不截。
 */
function layoutRow(row: VideoRow, lit: number | null, measure: Measure): Part {
	const room = ROW_BOTTOM - ROW_TOP;
	const full: Squeeze = { collapsed: 0, notesDropped: 0, kept: row.actions.length };
	for (let px = ROW_PX_START; px > MIN_TEXT_PX; px -= ROW_PX_STEP) {
		const grid = layoutGrid(row.cues, lit, px, gridRoom(px), measure);
		const lines = textLines(row, full, px, measure);
		// 拍點格子有沒畫的、或格子裡有字（「down」、名字）要從中間斷開：先縮字
		if (!grid.overflow && !grid.split && lines.length * px * LINE + gridSpace(grid) <= room) return placeRow(lines, grid, px, false);
	}
	const px = MIN_TEXT_PX;
	const grid = layoutGrid(row.cues, lit, px, gridRoom(px), measure);
	// 格子最多佔到只剩一行字（gridRoom），這裡至少是 1
	const maxLines = Math.floor((room - gridSpace(grid)) / (px * LINE) + 1e-9);
	let lines: Para[] = [];
	let first = true;
	for (const s of squeezes(row)) {
		lines = textLines(row, s, px, measure);
		if (lines.length <= maxLines) return placeRow(lines, grid, px, grid.overflow || !first);
		first = false;
	}
	// 都拿了還放不下（例：一個動作的「誰」本身就比整塊長）：截在區塊底，最後一行加「⋯」。
	// 拿掉了動作時「⋯還有 N 個動作」那一行留著，截它上面的
	const dropped = row.actions.length > 1;
	const more = dropped ? lines.slice(-1) : [];
	const shown = lines.slice(0, maxLines - more.length);
	if (shown.length) {
		const last = shown[shown.length - 1];
		shown[shown.length - 1] = { ...last, text: withEllipsis(last.text, px, last.weight, WIDTH, measure) };
	}
	return placeRow([...shown, ...more], grid, px, true);
}

/** 拍點格子最多多高：下面那一列至少留一行字。 */
const gridRoom = (px: number) => ROW_BOTTOM - ROW_TOP - GRID_GAP - px * LINE;

/** 拍點格子佔多高（連上面的空隙）；沒有拍點是 0。 */
const gridSpace = (grid: Grid) => (grid.h ? GRID_GAP + grid.h : 0);

/** 照順序一步一步多拿一點：第一個是什麼都不拿。 */
function* squeezes(row: VideoRow): Generator<Squeeze> {
	const notes = row.actions.filter((a) => a.note).length;
	const s: Squeeze = { collapsed: 0, notesDropped: 0, kept: row.actions.length };
	yield { ...s };
	while (s.collapsed < row.continuing.length) {
		s.collapsed++;
		yield { ...s };
	}
	while (s.notesDropped < notes) {
		s.notesDropped++;
		yield { ...s };
	}
	// 至少留一個動作：只剩一個還放不下就截掉（見 layoutRow），不整個拿掉
	while (s.kept > 1) {
		s.kept--;
		yield { ...s };
	}
}

/** 下面那一列的字，換好行：站位、動作（標題、誰、備註）、還在做的動作、拿掉幾個動作。 */
function textLines(row: VideoRow, s: Squeeze, px: number, measure: Measure): Para[] {
	const paras: Para[] = [];
	if (row.empty) paras.push({ text: EMPTY_TEXT, weight: 400, color: 'muted' });
	for (const f of row.formations) paras.push({ text: f, weight: 600, color: 'muted' });
	// 備註從最下面那個拿起
	const noted = row.actions.flatMap((a, i) => (a.note ? [i] : []));
	const droppedNotes = new Set(noted.slice(noted.length - s.notesDropped));
	row.actions.slice(0, s.kept).forEach((a, i) => {
		paras.push({ text: a.title, weight: 700, color: 'ink' });
		if (a.who) paras.push({ text: a.who, weight: 400, color: 'ink' });
		if (a.note && !droppedNotes.has(i)) paras.push({ text: `備註：${a.note}`, weight: 400, color: 'muted' });
	});
	// 還在做的動作從最下面那個縮起
	const fullUntil = row.continuing.length - s.collapsed;
	row.continuing.forEach((c, i) => {
		const text = i < fullUntil && c.who ? `↳ ${c.name} 繼續：${c.who}` : `↳ ${c.name} 繼續`;
		paras.push({ text, weight: 400, color: 'ink' });
	});
	const dropped = row.actions.length - s.kept;
	if (dropped) paras.push({ text: `⋯還有 ${dropped} 個動作`, weight: 700, color: 'muted' });
	return paras.flatMap((p) => wrap(p.text, px, p.weight, WIDTH, measure).map((text) => ({ ...p, text })));
}

function placeRow(lines: Para[], grid: Grid, px: number, overflow: boolean): Part {
	const lh = px * LINE;
	const texts: TextItem[] = lines.map((l, i) => ({
		text: l.text,
		x: LEFT,
		y: ROW_TOP + i * lh + (lh - px) / 2,
		px,
		weight: l.weight,
		color: l.color
	}));
	const gridTop = ROW_TOP + lines.length * lh + GRID_GAP;
	texts.push(...grid.texts.map((t) => ({ ...t, y: t.y + gridTop })));
	const boxes = grid.boxes.map((b) => ({ ...b, y: b.y + gridTop }));
	return { texts, boxes, overflow };
}

/**
 * 拍點格子：位置從 y = 0 算起，h 是總高；沒有拍點的列是空的。overflow：有拍點那一排沒畫。
 * split：格子裡有一個字（「down」、一個名字）寬過格子、從中間斷開（字還是寫完，只是縮小字比較好看）。
 */
interface Grid {
	texts: TextItem[];
	boxes: Box[];
	h: number;
	overflow: boolean;
	split: boolean;
}

/**
 * 拍點和環節：上面一排 1–8，每個動作一段，左邊寫動作名字，右邊 8 格；
 * 環節在上、拍點在下，同一格疊到的往下另起一排。拍點的字寫在上面、給誰寫在下面一行；
 * 比格子寬就在格子裡換行，那一格長高，不截。
 * 比 maxH 高時，超出的那幾段不畫，最後一行寫「⋯還有 N 行拍點」。
 */
function layoutGrid(cueLines: EightCountCueLine[], lit: number | null, px: number, maxH: number, measure: Measure): Grid {
	if (!cueLines.length) return { texts: [], boxes: [], h: 0, overflow: false, split: false };
	const lh = px * LINE;
	const cellX = (n: number) => CELLS_X + (n - 1) * CELL_W;
	const texts: TextItem[] = [];
	for (let n = 1; n <= 8; n++) {
		texts.push({ text: String(n), x: cellX(n) + CELL_W / 2, y: (lh - px) / 2, px, weight: 600, color: 'muted', align: 'center' });
	}
	const blocks = cueLines.map((line) => cueBlock(line, px, measure));
	const total = lh + blocks.reduce((h, b) => h + b.h, 0);
	const items: Box[] = [];
	let overflow = false;
	let y = lh;
	let shown = 0;
	for (const b of blocks) {
		// 放不下全部時，留一行給「⋯還有 N 行拍點」
		if (total > maxH && y + b.h + lh > maxH) break;
		texts.push(...b.texts.map((t) => ({ ...t, y: t.y + y })));
		items.push(...b.boxes.map((x) => ({ ...x, y: x.y + y })));
		y += b.h;
		shown++;
	}
	const columnsH = y;
	if (shown < blocks.length) {
		overflow = true;
		texts.push({ text: `⋯還有 ${blocks.length - shown} 行拍點`, x: LEFT, y: y + (lh - px) / 2, px, weight: 700, color: 'muted' });
		y += lh;
	}
	// 8 欄的格線先畫，現在這拍那一欄最後畫（框才不被旁邊蓋住），拍點畫在格線上面
	const columns: Box[] = [];
	for (let n = 1; n <= 8; n++) {
		if (n !== lit) columns.push({ x: cellX(n), y: 0, w: CELL_W, h: columnsH, fill: 'bg', stroke: 'gridLine', lineWidth: 2 });
	}
	if (lit) columns.push({ x: cellX(lit), y: 0, w: CELL_W, h: columnsH, fill: 'gridNow', stroke: 'beatLit', lineWidth: 6 });
	return { texts, boxes: [...columns, ...items], h: y, overflow, split: blocks.some((b) => b.split) };
}

/** 給誰那一行的字重：比拍點的字細，看得出哪一行是哪個。 */
const WHO_WEIGHT = 400;

/** 一個動作的那一段（從 y = 0 算起）：左邊名字，右邊環節和拍點。split：格子裡有字從中間斷開。 */
function cueBlock(line: EightCountCueLine, px: number, measure: Measure): { texts: TextItem[]; boxes: Box[]; h: number; split: boolean } {
	const lh = px * LINE;
	const cellX = (n: number) => CELLS_X + (n - 1) * CELL_W;
	const texts: TextItem[] = [];
	const boxes: Box[] = [];
	let split = false;
	const name = wrap(actionLabel(line), px, 700, NAME_W, measure);
	name.forEach((text, i) => texts.push({ text, x: LEFT, y: i * lh + (lh - px) / 2, px, weight: 700, color: 'ink' }));
	const phases = line.phases.map((p) => ({ from: p.from, to: p.to, text: p.label, who: '', style: PHASE_STYLE }));
	// 從上一列接過來的不再寫字和給誰
	const cues = line.cues.map((c) => ({
		from: c.from,
		to: c.to,
		text: [c.lead, c.continued ? '' : c.word].filter(Boolean).join(' '),
		who: c.continued ? '' : (c.who ?? ''),
		style: CUE_STYLES[c.kind](c.word)
	}));
	let sub = 0;
	// 環節和拍點各自分排，環節在上
	for (const r of [...pack(phases), ...pack(cues)]) {
		let rowH = lh;
		for (const p of r) {
			const x = cellX(p.from) + CUE_INSET;
			const w = (p.to - p.from + 1) * CELL_W - 2 * CUE_INSET;
			const left = CUE_PAD + p.style.indent;
			const inner = w - left - CUE_PAD;
			// 字在上、給誰在下，各自換行
			const lines = [
				...cellWrap(p.text, px, p.style.weight, inner, measure).map((text) => ({ text, weight: p.style.weight })),
				...cellWrap(p.who, px, WHO_WEIGHT, inner, measure).map((text) => ({ text, weight: WHO_WEIGHT }))
			];
			split ||= breaksWord(p.text, px, p.style.weight, inner, measure) || breaksWord(p.who, px, WHO_WEIGHT, inner, measure);
			const h = Math.max(1, lines.length) * lh;
			rowH = Math.max(rowH, h);
			boxes.push(...p.style.boxes(x, sub, w, h));
			lines.forEach((l, i) =>
				texts.push({ text: l.text, x: x + left, y: sub + i * lh + (lh - px) / 2, px, weight: l.weight, color: p.style.ink })
			);
		}
		sub += rowH + SUB_GAP;
	}
	return { texts, boxes, h: Math.max(name.length * lh, sub), split };
}

interface PieceStyle {
	weight: number;
	ink: ColorKey;
	/** 字比平常多往右讓多少（步驟左邊的粗線）。 */
	indent: number;
	boxes: (x: number, y: number, w: number, h: number) => Box[];
}

/** 環節：細框，字寫在裡面（顏色是教練挑的，影片不分，靠框線和字）。 */
const PHASE_STYLE: PieceStyle = {
	weight: 600,
	ink: 'ink',
	indent: 0,
	boxes: (x, y, w, h) => [{ x, y, w, h, fill: 'bg', stroke: 'phaseLine', lineWidth: 2 }]
};

/**
 * 拍點照八拍表的樣子：拍子實心、步驟左邊粗線、手位圓角小牌子。
 * 拍點的字一律粗體，下面的給誰是細的（WHO_WEIGHT）。
 */
const CUE_STYLES: Record<CueKind, (word: string) => PieceStyle> = {
	count: (word) => ({
		weight: 700,
		ink: 'cueCountInk',
		indent: 0,
		boxes: (x, y, w, h) => [{ x, y, w, h, fill: word === 'up' ? 'cueUp' : 'cueDown', radius: 4 }]
	}),
	step: () => ({
		weight: 700,
		ink: 'cueStepInk',
		indent: STEP_BAR + STEP_BAR_GAP,
		boxes: (x, y, w, h) => [
			{ x, y, w, h, fill: 'cueStepBg', stroke: 'cueStepLine', lineWidth: 2, radius: 4 },
			{ x, y, w: STEP_BAR, h, fill: 'cueStepLine' }
		]
	}),
	// 一行時是圓角小牌子；長高了圓角不變大，字才不跑出圓角外面
	motion: () => ({
		weight: 700,
		ink: 'cueMotionInk',
		indent: 0,
		boxes: (x, y, w, h) => [{ x, y, w, h, fill: 'cueMotionBg', stroke: 'cueMotionLine', lineWidth: 2, radius: MOTION_RADIUS }]
	})
};

/** 手位小牌子的圓角：28 px 一行高 35，圓角接近半個行高。 */
const MOTION_RADIUS = 16;

/**
 * 格子裡的換行：照空白分成一個一個字（「high V」是兩個、一個名字是一個），整個放得下就不拆；
 * 一個字本身就比格子寬，才一個字母一個字母斷開。
 */
function cellWrap(text: string, px: number, weight: number, width: number, measure: Measure): string[] {
	const lines: string[] = [];
	let line = '';
	for (const word of text.split(' ').filter(Boolean)) {
		const joined = line ? `${line} ${word}` : word;
		if (measure(joined, px, weight) <= width) {
			line = joined;
			continue;
		}
		if (line) lines.push(line);
		line = '';
		if (measure(word, px, weight) <= width) {
			line = word;
			continue;
		}
		const parts = wrap(word, px, weight, width, measure);
		line = parts.pop()!;
		lines.push(...parts);
	}
	if (line) lines.push(line);
	return lines;
}

/**
 * 有沒有一個字（照空白分）比格子寬、要從中間斷開，而且縮到 28 px 就不用斷（縮字才有用）。
 * 照畫的字重量（拍點的字照它的樣子、給誰 WHO_WEIGHT），跟 cellWrap 換行一樣。格子的寬不隨字級變。
 */
const breaksWord = (text: string, px: number, weight: number, width: number, measure: Measure) =>
	text.split(' ').some((word) => word && measure(word, px, weight) > width && measure(word, MIN_TEXT_PX, weight) <= width);

/** 分排：放進第一個格子沒被佔到的排，都佔到就另起一排。 */
function pack<T extends { from: number; to: number }>(pieces: T[]): T[][] {
	const rows: T[][] = [];
	for (const p of pieces) {
		const free = rows.find((r) => r.every((o) => o.to < p.from || o.from > p.to));
		if (free) free.push(p);
		else rows.push([p]);
	}
	return rows;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** 一個字一個字量、超過寬度就換行（中文沒有空白可以斷）。每個字只量一次。 */
function wrap(text: string, px: number, weight: number, width: number, measure: Measure): string[] {
	const lines: string[] = [];
	let line = '';
	let w = 0;
	for (const { segment } of graphemes.segment(text)) {
		const cw = measure(segment, px, weight);
		if (line && w + cw > width) {
			lines.push(line.trimEnd());
			line = '';
			w = 0;
		}
		// 換行後不用空白開頭：「high V」換成「high」「V」
		if (!line && lines.length && !segment.trim()) continue;
		line += segment;
		w += cw;
	}
	if (line) lines.push(line.trimEnd());
	return lines;
}

/** 截掉尾巴、加「⋯」，加了還放得進寬度。 */
function withEllipsis(line: string, px: number, weight: number, width: number, measure: Measure): string {
	const chars = Array.from(graphemes.segment(line), (s) => s.segment);
	while (chars.length && measure(chars.join('') + '⋯', px, weight) > width) chars.pop();
	return chars.join('') + '⋯';
}
