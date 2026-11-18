// 照層畫圓點：蓋到下面一層的人往右上錯開、縮小，被不同層蓋到的人畫虛線圈。
// 場上（Field.svelte）和流程影片（video/layout.ts）都問這裡，兩邊才畫得一樣。位置照真的，只改畫法。

import type { Position } from './formation';

/** 一個圓點沒錯開時的樣子：中心 c、半徑 r、多字膠囊直的那段一半長 h、標記的字高 font（單位由呼叫的一方決定）。 */
export interface LayerDot {
	id: string;
	/** 第幾層：1 是地上，2、3 在空中。 */
	level: number;
	c: Position;
	r: number;
	h: number;
	font: number;
}

/** 錯開多少（d，圓點沒放大時的公尺，乘 unit 才是呼叫一方的單位）、縮成幾倍（s）。 */
export interface LayerShift {
	d: number;
	s: number;
}

/** 兩個圓點或膠囊有沒有碰到。 */
function touches(a: LayerDot, b: LayerDot): boolean {
	return Math.hypot(Math.max(0, Math.abs(a.c[0] - b.c[0]) - a.h - b.h), a.c[1] - b.c[1]) < a.r + b.r;
}

/**
 * 每個圓點要不要錯開、畫出來的樣子、哪些人要畫虛線圈。
 * - 蓋到下面一層的人（碰到層比較低的人）往右上錯開 0.22 × (層 − 1)、縮成 0.85^(層 − 1)。
 * - unit：圓點放大的倍數（1 公尺的圓點在呼叫一方是幾個單位），錯開的距離乘它。
 * - minScale(font)：縮小的下限（縮了以後字還要夠大）；不用就回 0。
 * - covered：碰到別層、畫出來後還被後面（照 dots 的順序，層高的排後面）的人碰到的人。同一層擠在一起的不算。
 */
export function layerStagger(
	dots: LayerDot[],
	unit: number,
	minScale: (font: number) => number
): { shifts: Record<string, LayerShift>; drawn: LayerDot[]; covered: LayerDot[] } {
	const shifts: Record<string, LayerShift> = {};
	for (const a of dots) {
		if (a.level < 2) continue;
		if (dots.some((b) => b.level < a.level && touches(a, b))) {
			shifts[a.id] = { d: 0.22 * (a.level - 1), s: Math.min(1, Math.max(0.85 ** (a.level - 1), minScale(a.font))) };
		}
	}
	const drawn = dots.map((a) => {
		const sh = shifts[a.id];
		const off = (sh?.d ?? 0) * unit;
		const s = sh?.s ?? 1;
		return { ...a, c: [a.c[0] + off, a.c[1] - off] as Position, r: a.r * s, h: a.h * s, font: a.font * s };
	});
	const covered = drawn.filter((a, i) => drawn.slice(i + 1).some((b) => b.level !== a.level && touches(a, b)));
	return { shifts, drawn, covered };
}
