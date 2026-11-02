import { describe, expect, it } from 'vitest';
import { fieldGeometry } from './index';

describe('場地幾何', () => {
	it('9 條直放是 16.46 × 12.80 m、9 × 7 格', () => {
		const g = fieldGeometry({ strips: 9, layout: 'vertical' });
		expect(g.width).toBeCloseTo(16.46, 2);
		expect(g.depth).toBeCloseTo(12.8, 2);
		expect([g.cols, g.rows]).toEqual([9, 7]);
	});

	it('5 條橫放是 12.80 × 9.14 m、7 × 5 格', () => {
		const g = fieldGeometry({ strips: 5, layout: 'horizontal' });
		expect(g.width).toBeCloseTo(12.8, 2);
		expect(g.depth).toBeCloseTo(9.14, 2);
		expect([g.cols, g.rows]).toEqual([7, 5]);
	});

	it('自訂照條數和鋪向算', () => {
		const v = fieldGeometry({ strips: 4, layout: 'vertical' });
		expect(v.width).toBeCloseTo(7.32, 2);
		expect([v.cols, v.rows]).toEqual([4, 7]);
		const h = fieldGeometry({ strips: 12, layout: 'horizontal' });
		expect(h.depth).toBeCloseTo(21.95, 2);
		expect([h.cols, h.rows]).toEqual([7, 12]);
	});

	it('原點是中心 X；墊子外留 1 m', () => {
		const g = fieldGeometry({ strips: 9, layout: 'vertical' });
		expect(g.mat.x).toBeCloseTo(-8.23, 2);
		expect(g.mat.y).toBeCloseTo(-6.4, 2);
		expect(g.outer.x).toBeCloseTo(-9.23, 2);
		expect(g.outer.y).toBeCloseTo(-7.4, 2);
		expect(g.outer.width).toBeCloseTo(18.46, 2);
		expect(g.outer.height).toBeCloseTo(14.8, 2);
	});

	it('直放的條從畫面左邊數起，每條從前鋪到後', () => {
		const g = fieldGeometry({ strips: 9, layout: 'vertical' });
		expect(g.strips.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
		const first = g.strips[0].rect;
		expect(first.x).toBeCloseTo(-8.23, 2);
		expect(first.width).toBeCloseTo(1.83, 2);
		expect(first.height).toBeCloseTo(12.8, 2);
		expect(g.strips[8].rect.x).toBeCloseTo(6.4, 2);
	});

	it('橫放最靠近裁判（正面，y 最大）的是第 1 條', () => {
		const g = fieldGeometry({ strips: 5, layout: 'horizontal' });
		expect(g.strips.map((s) => s.number)).toEqual([1, 2, 3, 4, 5]);
		const first = g.strips[0].rect;
		expect(first.y).toBeCloseTo(2.74, 2);
		expect(first.width).toBeCloseTo(12.8, 2);
		expect(first.height).toBeCloseTo(1.83, 2);
		expect(g.strips[4].rect.y).toBeCloseTo(-4.57, 2);
	});

	it('直放的接縫是前後走向的線；中心 X 在正中間那格的中心', () => {
		const g = fieldGeometry({ strips: 9, layout: 'vertical' });
		expect(g.seams).toHaveLength(8);
		for (const s of g.seams) {
			expect(s.x1).toBe(s.x2);
			expect(s.y1).toBeCloseTo(-6.4, 2);
			expect(s.y2).toBeCloseTo(6.4, 2);
		}
		const xs = g.seams.map((s) => s.x1);
		expect(xs[3]).toBeCloseTo(-0.91, 2);
		expect(xs[4]).toBeCloseTo(0.91, 2);
		expect(xs[7]).toBeCloseTo(6.4, 2);
	});

	it('橫放的接縫是左右走向的線', () => {
		const g = fieldGeometry({ strips: 5, layout: 'horizontal' });
		expect(g.seams).toHaveLength(4);
		for (const s of g.seams) {
			expect(s.y1).toBe(s.y2);
			expect(s.x1).toBeCloseTo(-6.4, 2);
			expect(s.x2).toBeCloseTo(6.4, 2);
		}
		expect(g.seams.map((s) => s.y1).sort((a, b) => a - b)[0]).toBeCloseTo(-2.74, 2);
	});

	it('格線是墊子上不和接縫重疊的格子線', () => {
		const v = fieldGeometry({ strips: 9, layout: 'vertical' });
		expect(v.gridLines).toHaveLength(6);
		for (const l of v.gridLines) expect(l.y1).toBe(l.y2);

		const h = fieldGeometry({ strips: 5, layout: 'horizontal' });
		expect(h.gridLines).toHaveLength(6);
		for (const l of h.gridLines) expect(l.x1).toBe(l.x2);
	});
});
