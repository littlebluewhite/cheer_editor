// 照層畫圓點：每個人都畫在真的位置、原本大小（走位時才不會跳），在空中的人底色半透明，看得到下面的人；
// 被不同層蓋到的人畫虛線圈。場上（Field.svelte）和流程影片（video/layout.ts）都問這裡，兩邊才畫得一樣。
// 只是站在隔壁（圓點碰到邊）的不算被蓋到。

import type { Position } from './formation';
import { samePoint } from './hints';

/** 在空中的人（第 2、3 層）圓點底色的不透明度：場上 Field.svelte 的 .dot.raised 用同一個數字（video/colors.test.ts 比對）。 */
export const RAISED_FILL_OPACITY = 0.6;

/** 一個圓點畫出來的樣子：場上真的位置 at（公尺）；中心 c、半徑 r、多字膠囊直的那段一半長 h、標記的字高 font（單位由呼叫的一方決定）。 */
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

/** 加上 covered：要不要畫虛線圈。 */
export interface CoveredDot extends LayerDot {
	covered: boolean;
}

/**
 * 哪些人要畫虛線圈：後面（照 dots 的順序，層高的排後面）有別層的人跟他疊在同一點。同一層擠在一起的不算。
 * 圓點不移位、不縮小。
 */
export function markCovered(dots: LayerDot[]): CoveredDot[] {
	return dots.map((a, i) => ({
		...a,
		covered: dots.slice(i + 1).some((b) => b.level !== a.level && samePoint(a.at, b.at))
	}));
}
