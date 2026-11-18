// 照層畫圓點：跟下面一層的人疊在同一點的往右上錯開、縮小，被不同層蓋到的人畫虛線圈。
// 場上（Field.svelte）和流程影片（video/layout.ts）都問這裡，兩邊才畫得一樣。位置照真的，只改畫法。
// 只是站在隔壁（圓點碰到邊）的不錯開：錯開了看起來像疊在一起。

import type { Position } from './formation';
import { samePoint } from './hints';

/** 一個圓點沒錯開時的樣子：場上真的位置 at（公尺）；中心 c、半徑 r、多字膠囊直的那段一半長 h、標記的字高 font（單位由呼叫的一方決定）。 */
export interface LayerDot {
	id: string;
	/** 第幾層：1 是地上，2、3 在空中。 */
	level: number;
	at: Position;
	c: Position;
	r: number;
	h: number;
	font: number;
}

/** 錯開多少（offset，圓點沒放大時的公尺，乘 unit 才是呼叫一方的單位）、縮成幾倍（scale）。 */
export interface LayerShift {
	offset: number;
	scale: number;
}

/** 一個圓點畫出來的樣子（錯開、縮小後）：縮成幾倍 scale（線寬、陰影跟著縮）、covered 要不要畫虛線圈。 */
export interface StaggeredDot extends LayerDot {
	scale: number;
	covered: boolean;
}

/**
 * 每個圓點要不要錯開、畫出來的樣子、哪些人要畫虛線圈。
 * - 跟層比較低的人疊在同一點的往右上錯開 0.22 × (層 − 1)、縮成 0.85^(層 − 1)。
 * - unit：圓點放大的倍數（1 公尺的圓點在呼叫一方是幾個單位），錯開的距離乘它。
 * - minScale(font)：縮小的下限（縮了以後字還要夠大）；不用就回 0。
 * - covered：後面（照 dots 的順序，層高的排後面）有別層的人跟他疊在同一點。同一層擠在一起的不算。
 */
export function layerStagger(
	dots: LayerDot[],
	unit: number,
	minScale: (font: number) => number
): { shifts: Record<string, LayerShift>; drawn: StaggeredDot[] } {
	const shifts: Record<string, LayerShift> = {};
	for (const a of dots) {
		if (a.level < 2) continue;
		if (dots.some((b) => b.level < a.level && samePoint(a.at, b.at))) {
			shifts[a.id] = {
				offset: 0.22 * (a.level - 1),
				scale: Math.min(1, Math.max(0.85 ** (a.level - 1), minScale(a.font)))
			};
		}
	}
	const drawn = dots.map((a, i) => {
		const sh = shifts[a.id];
		const off = (sh?.offset ?? 0) * unit;
		const scale = sh?.scale ?? 1;
		return {
			...a,
			c: [a.c[0] + off, a.c[1] - off] as Position,
			r: a.r * scale,
			h: a.h * scale,
			font: a.font * scale,
			scale,
			covered: dots.slice(i + 1).some((b) => b.level !== a.level && samePoint(a.at, b.at))
		};
	});
	return { shifts, drawn };
}
