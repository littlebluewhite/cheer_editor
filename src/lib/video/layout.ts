// 流程影片的版面：把一格的內容（videoFrame）排進直的 1080×1920，放不下時決定縮什麼、拿掉什麼。
// 不碰 Canvas：字寬由呼叫端給（measure），測試換成假的（跟 ADR 0002 的 toMeters 同一種做法）。

import {
	actionLabel,
	fullView,
	videoRows,
	type CueKind,
	type EightCountCue,
	type EightCountCueLine,
	type FieldConfig,
	type Flow,
	type VideoFrameData,
	type VideoRow
} from '#lib/core';
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

interface Box {
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
}

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
/** 拍點、環節的框離格線多遠、字離框多遠、上下兩排之間多遠。 */
const CUE_INSET = 3;
const CUE_PAD = 8;
const SUB_GAP = 4;

const EMPTY_TEXT = '這一列沒有新的動作、站位';

export function layoutFrame(field: FieldConfig, frame: VideoFrameData, measure: Measure): FrameLayout {
	const top = layoutTop(frame, measure);
	const row = layoutRow(frame.row, frame.beats?.lit ?? null, measure);
	return {
		texts: [...top.texts, ...row.texts],
		boxes: [...top.boxes, ...row.boxes],
		field: layoutField(field),
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

function layoutField(field: FieldConfig): VideoFieldLayout {
	const view = fullView(field);
	const pxPerM = Math.min(FIELD_ZONE.w / view.width, FIELD_ZONE.h / view.height);
	const w = view.width * pxPerM;
	const h = view.height * pxPerM;
	// 圓點照手機檢視畫面的做法放大到有最小尺寸，站得近的人會疊到，可以接受
	const dotPx = Math.max(2 * DOT_R * pxPerM, MIN_DOT_PX);
	return {
		box: { x: FIELD_ZONE.x + (FIELD_ZONE.w - w) / 2, y: FIELD_ZONE.y + (FIELD_ZONE.h - h) / 2, w, h },
		pxPerM,
		dotPx,
		markerPx: dotPx / 2,
		numberPx: Math.max(NUMBER_M * pxPerM, MIN_TEXT_PX)
	};
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
		const grid = layoutGrid(row.cues, lit, px, measure);
		const lines = textLines(row, full, px, measure);
		if (lines.length * px * LINE + gridSpace(grid) <= room) return placeRow(lines, grid, px, false);
	}
	const px = MIN_TEXT_PX;
	const grid = layoutGrid(row.cues, lit, px, measure);
	const maxLines = Math.floor((room - gridSpace(grid)) / (px * LINE));
	let lines: Para[] = [];
	let first = true;
	for (const s of squeezes(row)) {
		lines = textLines(row, s, px, measure);
		if (lines.length <= maxLines) return placeRow(lines, grid, px, !first);
		first = false;
	}
	// 都拿了還放不下（例：一個動作的「誰」本身就比整塊長）：截在區塊底，最後一行加「⋯」
	const shown = lines.slice(0, Math.max(maxLines, 0));
	if (shown.length) {
		const last = shown[shown.length - 1];
		shown[shown.length - 1] = { ...last, text: withEllipsis(last.text, px, last.weight, WIDTH, measure) };
	}
	return placeRow(shown, grid, px, true);
}

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
	// 拍點格子一律留著：多到本身就比整塊高時會超出區塊，算放不下
	return { texts, boxes, overflow: overflow || (grid.h > 0 && gridTop + grid.h > ROW_BOTTOM) };
}

/** 拍點格子：位置從 y = 0 算起，h 是總高；沒有拍點的列是空的。 */
interface Grid {
	texts: TextItem[];
	boxes: Box[];
	h: number;
}

/**
 * 拍點和環節：上面一排 1–8，每個動作一段，左邊寫動作名字，右邊 8 格；
 * 環節在上、拍點在下，同一格疊到的往下另起一排。字比格子寬就在格子裡換行。
 */
function layoutGrid(cueLines: EightCountCueLine[], lit: number | null, px: number, measure: Measure): Grid {
	if (!cueLines.length) return { texts: [], boxes: [], h: 0 };
	const lh = px * LINE;
	const cellX = (n: number) => CELLS_X + (n - 1) * CELL_W;
	const texts: TextItem[] = [];
	const items: Box[] = [];
	for (let n = 1; n <= 8; n++) {
		texts.push({ text: String(n), x: cellX(n) + CELL_W / 2, y: (lh - px) / 2, px, weight: 600, color: 'muted', align: 'center' });
	}
	let y = lh;
	for (const line of cueLines) {
		const name = wrap(actionLabel(line), px, 700, NAME_W, measure);
		name.forEach((text, i) => texts.push({ text, x: LEFT, y: y + i * lh + (lh - px) / 2, px, weight: 700, color: 'ink' }));
		let sub = y;
		const phases = line.phases.map((p) => ({ from: p.from, to: p.to, text: p.label, style: PHASE_STYLE }));
		const cues = line.cues.map((c) => ({ from: c.from, to: c.to, text: cueWords(c), style: CUE_STYLES[c.kind](c.word) }));
		// 環節和拍點各自分排，環節在上
		const rows = [...pack(phases), ...pack(cues)];
		for (const r of rows) {
			let rowH = lh;
			for (const p of r) {
				const x = cellX(p.from) + CUE_INSET;
				const w = (p.to - p.from + 1) * CELL_W - 2 * CUE_INSET;
				const words = p.text ? wrap(p.text, px, p.style.weight, w - 2 * CUE_PAD, measure) : [];
				const h = Math.max(1, words.length) * lh;
				rowH = Math.max(rowH, h);
				items.push(...p.style.boxes(x, sub, w, h));
				words.forEach((text, i) =>
					texts.push({ text, x: x + CUE_PAD, y: sub + i * lh + (lh - px) / 2, px, weight: p.style.weight, color: p.style.ink })
				);
			}
			sub += rowH + SUB_GAP;
		}
		y = Math.max(y + name.length * lh, sub);
	}
	// 8 欄的格線先畫，現在這拍那一欄最後畫（框才不被旁邊蓋住），拍點畫在格線上面
	const columns: Box[] = [];
	for (let n = 1; n <= 8; n++) {
		if (n !== lit) columns.push({ x: cellX(n), y: 0, w: CELL_W, h: y, fill: 'bg', stroke: 'gridLine', lineWidth: 2 });
	}
	if (lit) columns.push({ x: cellX(lit), y: 0, w: CELL_W, h: y, fill: 'gridNow', stroke: 'beatLit', lineWidth: 6 });
	return { texts, boxes: [...columns, ...items], h: y };
}

/** 一個拍點格子裡寫的字：「1-1& down（上層）」；從上一列接過來的不再寫字和給誰。 */
function cueWords(c: EightCountCue): string {
	const word = c.continued ? '' : c.who ? `${c.word}（${c.who}）` : c.word;
	return [c.lead, word].filter(Boolean).join(' ');
}

interface PieceStyle {
	weight: number;
	ink: ColorKey;
	boxes: (x: number, y: number, w: number, h: number) => Box[];
}

/** 環節：細框，字寫在裡面（顏色是教練挑的，影片不分，靠框線和字）。 */
const PHASE_STYLE: PieceStyle = {
	weight: 600,
	ink: 'ink',
	boxes: (x, y, w, h) => [{ x, y, w, h, fill: 'bg', stroke: 'phaseLine', lineWidth: 2 }]
};

/** 拍點照八拍表的樣子：拍子實心、步驟左邊粗線、手位圓角小牌子。 */
const CUE_STYLES: Record<CueKind, (word: string) => PieceStyle> = {
	count: (word) => ({
		weight: 700,
		ink: 'cueCountInk',
		boxes: (x, y, w, h) => [{ x, y, w, h, fill: word === 'up' ? 'cueUp' : 'cueDown', radius: 4 }]
	}),
	step: () => ({
		weight: 400,
		ink: 'cueStepInk',
		boxes: (x, y, w, h) => [
			{ x, y, w, h, fill: 'cueStepBg', stroke: 'cueStepLine', lineWidth: 2, radius: 4 },
			{ x, y, w: 6, h, fill: 'cueStepLine' }
		]
	}),
	motion: () => ({
		weight: 400,
		ink: 'cueMotionInk',
		boxes: (x, y, w, h) => [{ x, y, w, h, fill: 'cueMotionBg', stroke: 'cueMotionLine', lineWidth: 2, radius: h / 2 }]
	})
};

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
			lines.push(line);
			line = '';
			w = 0;
		}
		line += segment;
		w += cw;
	}
	if (line) lines.push(line);
	return lines;
}

/** 截掉尾巴、加「⋯」，加了還放得進寬度。 */
function withEllipsis(line: string, px: number, weight: number, width: number, measure: Measure): string {
	const chars = Array.from(graphemes.segment(line), (s) => s.segment);
	while (chars.length && measure(chars.join('') + '⋯', px, weight) > width) chars.pop();
	return chars.join('') + '⋯';
}
