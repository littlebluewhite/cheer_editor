import { describe, expect, it } from 'vitest';
import { markCovered, type LayerDot } from './layer-cover';

/** 一個圓點：半徑 0.3，字 0.3。 */
const dot = (id: string, level: number, c: [number, number], more: Partial<LayerDot> = {}): LayerDot => ({
	id,
	level,
	at: c,
	c,
	r: 0.3,
	h: 0,
	font: 0.3,
	...more
});

describe('markCovered：照層畫圓點（場上和流程影片共用）', () => {
	it('三層金字塔疊在同一點：每個人都在原本的位置、原本大小；下面兩個人有虛線圈', () => {
		const dots = [dot('base', 1, [0, 0]), dot('mid', 2, [0, 0]), dot('top', 3, [0, 0])];
		expect(markCovered(dots).map((d) => [d.id, d.c, d.r, d.font, d.covered])).toEqual([
			['base', [0, 0], 0.3, 0.3, true],
			['mid', [0, 0], 0.3, 0.3, true],
			['top', [0, 0], 0.3, 0.3, false]
		]);
	});

	it('沒有人在空中、同一層擠在一起：沒有虛線圈', () => {
		const dots = [dot('a', 1, [0, 0]), dot('b', 1, [0, 0]), dot('c', 2, [3, 0]), dot('d', 2, [3.01, 0])];
		expect(markCovered(dots).filter((d) => d.covered)).toEqual([]);
	});

	it('只是站在隔壁（圓點、膠囊邊緣碰到）不算疊在一起：沒有虛線圈', () => {
		const dots = [dot('base', 1, [0, 0]), dot('mid', 2, [0.5, 0]), dot('top', 3, [0.8, 0], { h: 0.4 })];
		expect(markCovered(dots).filter((d) => d.covered)).toEqual([]);
	});

	it('影片的 c 是 px：疊不疊照場上真的位置 at（公尺）算，c 不動', () => {
		const dots = [dot('base', 1, [100, 100], { at: [3, 3] }), dot('mid', 2, [102, 100], { at: [3.02, 3] })];
		const out = markCovered(dots);
		expect(out.map((d) => d.c)).toEqual([
			[100, 100],
			[102, 100]
		]);
		expect(out.map((d) => d.covered)).toEqual([true, false]);
	});
});
