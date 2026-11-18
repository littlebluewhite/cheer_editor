import { describe, expect, it } from 'vitest';
import { layerStagger, type LayerDot } from './layer-stagger';

/** 一個圓點：半徑 0.3（沒放大），字 0.3。 */
const dot = (id: string, level: number, c: [number, number], more: Partial<LayerDot> = {}): LayerDot => ({
	id,
	level,
	c,
	r: 0.3,
	h: 0,
	font: 0.3,
	...more
});
const noFloor = () => 0;

describe('layerStagger：照層錯開、縮小（場上和流程影片共用）', () => {
	it('沒有人在空中：不錯開、不縮小、沒有虛線圈', () => {
		const dots = [dot('a', 1, [0, 0]), dot('b', 1, [0, 0]), dot('c', 1, [3, 0])];
		const out = layerStagger(dots, 1, noFloor);
		expect(out.shifts).toEqual({});
		expect(out.drawn.map((d) => [d.c, d.r])).toEqual([
			[[0, 0], 0.3],
			[[0, 0], 0.3],
			[[3, 0], 0.3]
		]);
		expect(out.drawn.filter((d) => d.covered)).toEqual([]);
	});

	it('三層金字塔疊在同一點：第 2 層錯開 0.22、縮成 0.85；三層錯開 0.44、縮成 0.85²；下面兩個人有虛線圈', () => {
		const dots = [dot('base', 1, [0, 0]), dot('mid', 2, [0, 0]), dot('top', 3, [0, 0])];
		const out = layerStagger(dots, 1, noFloor);
		expect(out.shifts.base).toBeUndefined();
		expect(out.shifts.mid).toEqual({ offset: 0.22, scale: 0.85 });
		expect(out.shifts.top.offset).toBeCloseTo(0.44);
		expect(out.shifts.top.scale).toBeCloseTo(0.7225);
		const mid = out.drawn.find((d) => d.id === 'mid')!;
		expect(mid.c[0]).toBeCloseTo(0.22);
		expect(mid.c[1]).toBeCloseTo(-0.22);
		expect(mid.r).toBeCloseTo(0.255);
		expect(out.drawn.map((d) => [d.id, d.scale, d.covered])).toEqual([
			['base', 1, true],
			['mid', 0.85, true],
			['top', expect.closeTo(0.7225), false]
		]);
	});

	it('錯開的距離照 unit 放大（影片用 px）', () => {
		const out = layerStagger([dot('base', 1, [100, 100], { r: 32 }), dot('mid', 2, [100, 100], { r: 32 })], 100, noFloor);
		const mid = out.drawn.find((d) => d.id === 'mid')!;
		expect(mid.c[0]).toBeCloseTo(122);
		expect(mid.c[1]).toBeCloseTo(78);
	});

	it('字的下限：縮小後字不夠大就少縮一點', () => {
		const dots = [dot('base', 1, [0, 0]), dot('top', 3, [0, 0], { font: 32 })];
		const out = layerStagger(dots, 1, (font) => 28 / font);
		expect(out.shifts.top.scale).toBeCloseTo(0.875);
	});

	it('旁邊沒碰到下面一層的人不動；同一層擠在一起不畫虛線圈', () => {
		const dots = [dot('a', 2, [0, 0]), dot('b', 2, [0.1, 0]), dot('c', 1, [5, 0])];
		const out = layerStagger(dots, 1, noFloor);
		expect(out.shifts).toEqual({});
		expect(out.drawn.filter((d) => d.covered)).toEqual([]);
	});

	it('膠囊只有兩端碰到：照膠囊的形狀算碰到', () => {
		const dots = [dot('base', 1, [0, 0]), dot('mid', 2, [0.8, 0], { h: 0.4 })];
		const out = layerStagger(dots, 1, noFloor);
		expect(out.shifts.mid).toEqual({ offset: 0.22, scale: 0.85 });
	});
});
