// 把版面（layoutFrame 排好的一格）畫在 Canvas 上。不排版、不量字：位置、字級都在 layout 裡。
// 瀏覽器才有 Canvas 2D，jsdom 沒有，所以沒有自動測試；輸出影片時用真的瀏覽器看（見實作計畫 Task 8）。

import { fieldGeometry, fieldNumbers, frontLabelAt, fullView, type FieldConfig, type GlobalRole, type VideoFrameData } from '#lib/core';
import { isLongMarker, markerWidth } from '../components/marker';
import { VIDEO_COLORS, type ColorKey } from './colors';
import { VIDEO_H, VIDEO_W, type Box, type FrameLayout, type Measure, type TextItem } from './layout';

const FONT = '"PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif';

/** 真的量字：一個 OffscreenCanvas 的 measureText，字型跟畫的時候一樣，量的和畫的才一樣寬。只在瀏覽器用。 */
export function canvasMeasure(): Measure {
	const ctx = new OffscreenCanvas(1, 1).getContext('2d')!;
	return (text, px, weight) => {
		ctx.font = `${weight} ${px}px ${FONT}`;
		return ctx.measureText(text).width;
	};
}

/** 圓點的半徑（公尺），跟 Field.svelte 的 DOT_R 一樣；圓點的線寬、陰影都照這個比例放大。 */
const DOT_R = 0.3;

const color = (key: ColorKey) => VIDEO_COLORS[key];

/**
 * 畫一格。roles 是每個隊員的底層、上層（frame 沒有，圓點的顏色要用）。
 * 順序：底色、場地（外圍、墊子、格線、接縫、中心、號碼）、圓點（上層、中層最後畫）、版面的框、版面的字。
 */
export function drawFrame(
	ctx: CanvasRenderingContext2D,
	field: FieldConfig,
	frame: VideoFrameData,
	layout: FrameLayout,
	roles: Record<string, GlobalRole>
): void {
	ctx.save();
	ctx.fillStyle = color('bg');
	ctx.fillRect(0, 0, VIDEO_W, VIDEO_H);
	drawField(ctx, field, frame, layout, roles);
	for (const box of layout.boxes) drawBox(ctx, box);
	for (const text of layout.texts) drawText(ctx, text);
	ctx.restore();
}

function drawBox(ctx: CanvasRenderingContext2D, b: Box): void {
	// 線畫在框裡面，不超出去蓋到旁邊
	const inset = b.stroke ? (b.lineWidth ?? 1) / 2 : 0;
	const [x, y, w, h] = [b.x + inset, b.y + inset, b.w - 2 * inset, b.h - 2 * inset];
	ctx.beginPath();
	if (b.radius) ctx.roundRect(x, y, w, h, Math.min(b.radius, w / 2, h / 2));
	else ctx.rect(x, y, w, h);
	ctx.fillStyle = color(b.fill);
	ctx.fill();
	if (b.stroke) {
		ctx.strokeStyle = color(b.stroke);
		ctx.lineWidth = b.lineWidth ?? 1;
		ctx.stroke();
	}
}

function drawText(ctx: CanvasRenderingContext2D, t: TextItem): void {
	ctx.font = `${t.weight} ${t.px}px ${FONT}`;
	ctx.textAlign = t.align ?? 'left';
	ctx.textBaseline = 'top';
	ctx.fillStyle = color(t.color);
	ctx.fillText(t.text, t.x, t.y);
}

function drawField(
	ctx: CanvasRenderingContext2D,
	field: FieldConfig,
	frame: VideoFrameData,
	layout: FrameLayout,
	roles: Record<string, GlobalRole>
): void {
	const { box, pxPerM, dotPx, markerPx, numberPx } = layout.field;
	const view = fullView(field);
	const g = fieldGeometry(field);
	const px = (mx: number) => box.x + (mx - view.x) * pxPerM;
	const py = (my: number) => box.y + (my - view.y) * pxPerM;
	const line = (x1: number, y1: number, x2: number, y2: number) => {
		ctx.beginPath();
		ctx.moveTo(px(x1), py(y1));
		ctx.lineTo(px(x2), py(y2));
		ctx.stroke();
	};

	// 外圍（虛線框）、墊子
	ctx.beginPath();
	ctx.rect(px(g.outer.x), py(g.outer.y), g.outer.width * pxPerM, g.outer.height * pxPerM);
	ctx.fillStyle = color('margin');
	ctx.fill();
	ctx.strokeStyle = color('marginLine');
	ctx.lineWidth = 0.03 * pxPerM;
	ctx.setLineDash([0.2 * pxPerM, 0.15 * pxPerM]);
	ctx.stroke();
	ctx.setLineDash([]);
	ctx.beginPath();
	ctx.rect(px(g.mat.x), py(g.mat.y), g.mat.width * pxPerM, g.mat.height * pxPerM);
	ctx.fillStyle = color('mat');
	ctx.fill();
	ctx.strokeStyle = color('matLine');
	ctx.lineWidth = 0.06 * pxPerM;
	ctx.stroke();

	// 淡格線、接縫、中心記號（兩臂比圓點短：站在正中心的人身上不露出十字）
	ctx.strokeStyle = color('matGrid');
	ctx.globalAlpha = 0.16;
	ctx.lineWidth = 0.025 * pxPerM;
	for (const l of g.gridLines) line(l.x1, l.y1, l.x2, l.y2);
	ctx.globalAlpha = 1;
	ctx.strokeStyle = color('seam');
	ctx.lineWidth = 0.07 * pxPerM;
	for (const l of g.seams) line(l.x1, l.y1, l.x2, l.y2);
	const arm = Math.min(0.4 * pxPerM, 0.9 * (dotPx / 2));
	ctx.strokeStyle = color('center');
	ctx.globalAlpha = 0.85;
	ctx.lineWidth = 0.08 * pxPerM;
	ctx.beginPath();
	ctx.moveTo(px(0) - arm, py(0));
	ctx.lineTo(px(0) + arm, py(0));
	ctx.moveTo(px(0), py(0) - arm);
	ctx.lineTo(px(0), py(0) + arm);
	ctx.stroke();
	ctx.globalAlpha = 1;

	// 條號、格號（字基線、水平置中；放大後的白邊讓疊在墊子上也看得清楚）、「正面／裁判」
	const numbers = fieldNumbers(field, view, numberPx / pxPerM, numberPx / pxPerM);
	ctx.textAlign = 'center';
	ctx.textBaseline = 'alphabetic';
	ctx.lineJoin = 'round';
	const label = (text: string, at: [number, number], weight: number) => {
		ctx.font = `${weight} ${numberPx}px ${FONT}`;
		ctx.lineWidth = 0.2 * numberPx;
		ctx.strokeStyle = color('bg');
		ctx.globalAlpha = 0.8;
		ctx.strokeText(text, px(at[0]), py(at[1]));
		ctx.globalAlpha = 1;
		ctx.fillStyle = color('muted');
		ctx.fillText(text, px(at[0]), py(at[1]));
	};
	for (const s of numbers.strips) label(String(s.n), s.at, 700);
	for (const c of numbers.cells) label(String(c.n), c.at, 400);
	const [fx, fy] = frontLabelAt(field);
	ctx.font = `700 ${numberPx}px ${FONT}`;
	ctx.letterSpacing = `${0.19 * numberPx}px`;
	ctx.fillStyle = color('front');
	ctx.fillText('▼ 正面／裁判 ▼', px(fx), py(fy));
	ctx.letterSpacing = '0px';

	// 圓點：上層、中層（raised）最後畫、蓋在上面，加黃框
	const ids = Object.keys(frame.positions).toSorted((a, b) => Number(isRaised(frame, a)) - Number(isRaised(frame, b)));
	// 圓點的線寬、陰影照 Field.svelte 的公尺數，隨圓點放大
	const unit = dotPx / (2 * DOT_R);
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	for (const id of ids) {
		const [mx, my] = frame.positions[id];
		const [cx, cy] = [px(mx), py(my)];
		const up = isRaised(frame, id);
		const top = roles[id] === 'top';
		const mark = frame.markers[id] ?? '';
		const pill = isLongMarker(mark) ? Math.max(dotPx, (markerWidth(mark) / 2) * markerPx + 0.14 * unit) : dotPx;
		ctx.beginPath();
		ctx.roundRect(cx - pill / 2, cy - dotPx / 2, pill, dotPx, dotPx / 2);
		if (up) {
			ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
			ctx.shadowOffsetY = 0.08 * unit;
			ctx.shadowBlur = 0.1 * unit;
		}
		ctx.fillStyle = color(top ? 'dotTop' : 'dotBase');
		ctx.fill();
		ctx.shadowColor = 'transparent';
		ctx.shadowOffsetY = 0;
		ctx.shadowBlur = 0;
		ctx.strokeStyle = color(up ? 'raised' : 'dotLine');
		ctx.lineWidth = (up ? 0.08 : 0.04) * unit;
		ctx.stroke();
		ctx.font = `700 ${markerPx}px ${FONT}`;
		ctx.fillStyle = color(top ? 'dotTopInk' : 'dotInk');
		ctx.fillText(mark, cx, cy);
	}
}

const isRaised = (frame: VideoFrameData, id: string) => frame.raised.includes(id);
