import { describe, expect, it } from 'vitest';
import { CELL_M, fieldGeometry, fieldNumbers, frontLabelAt, fullView, NUMBER_BAND } from './index';

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

describe('場地上的號碼位置', () => {
	const vertical = { strips: 9, layout: 'vertical' } as const;
	const horizontal = { strips: 5, layout: 'horizontal' } as const;

	it('整個場地的範圍：外圍以外左右上留號碼條、下面留 1 m 給「正面／裁判」', () => {
		for (const field of [vertical, horizontal]) {
			const { outer } = fieldGeometry(field);
			const b = NUMBER_BAND;
			expect(fullView(field)).toEqual({
				x: outer.x - b,
				y: outer.y - b,
				width: outer.width + 2 * b,
				height: outer.height + b + 1
			});
		}
	});

	it('號碼條給窄一點的（手機的檢視畫面 0.7 m）：整個場地的範圍跟著縮，號碼貼著窄的那一條靠外的邊', () => {
		// 9 條直放：墊子寬 16.4592、深 12.8016，外圍各多 1 m
		const view = fullView(vertical, 0.7);
		expect(view.x).toBeCloseTo(-9.9296);
		expect(view.y).toBeCloseTo(-8.1008);
		expect(view.width).toBeCloseTo(19.8592);
		expect(view.height).toBeCloseTo(16.5016);
		const { strips, cells } = fieldNumbers(vertical, view, 0.3, 0.26, 0.7);
		expect(strips[0].at[1]).toBeCloseTo(-8.1008 + 1.1 * 0.3);
		expect(cells[0].at[0]).toBeCloseTo(-9.9296 + 0.65 * 0.26);
	});

	it('9 條直放：條號在後面（上）、格號在左邊', () => {
		const { mat, outer } = fieldGeometry(vertical);
		const { strips, cells } = fieldNumbers(vertical, fullView(vertical), 0.3, 0.26);
		expect(strips).toHaveLength(9);
		expect(strips[0].n).toBe(1);
		expect(strips[0].at[0]).toBeCloseTo(mat.x + CELL_M / 2);
		expect(strips[0].at[1]).toBeCloseTo(outer.y - NUMBER_BAND + 1.1 * 0.3);
		expect(cells).toHaveLength(7);
		expect(cells[0].n).toBe(1);
		expect(cells[0].at[0]).toBeCloseTo(outer.x - NUMBER_BAND + 0.65 * 0.26);
		expect(cells[0].at[1]).toBeCloseTo(mat.y + mat.height - 0.5 * CELL_M + 0.3 * 0.26);
	});

	it('5 條橫放：條號在左邊、格號在後面（上）', () => {
		const { mat, outer, strips: rects } = fieldGeometry(horizontal);
		const { strips, cells } = fieldNumbers(horizontal, fullView(horizontal), 0.3, 0.26);
		expect(strips).toHaveLength(5);
		expect(strips[0].at[0]).toBeCloseTo(outer.x - NUMBER_BAND + 0.65 * 0.3);
		expect(strips[0].at[1]).toBeCloseTo(rects[0].rect.y + CELL_M / 2 + 0.3 * 0.3);
		expect(cells).toHaveLength(7);
		expect(cells[0].at[0]).toBeCloseTo(mat.x + CELL_M / 2);
		expect(cells[0].at[1]).toBeCloseTo(outer.y - NUMBER_BAND + 1.1 * 0.26);
	});

	it('放大後號碼條捲出畫面時，號碼貼著畫面邊上', () => {
		const { outer } = fieldGeometry(vertical);
		const view = { x: outer.x + 3, y: outer.y + 2, width: 5, height: 5 };
		const { strips, cells } = fieldNumbers(vertical, view, 0.3, 0.26);
		expect(strips[0].at[1]).toBeCloseTo(view.y + 1.1 * 0.3);
		expect(cells[0].at[0]).toBeCloseTo(view.x + 0.65 * 0.26);
	});

	it('「正面／裁判」寫在外圍框下面 0.7 m、正中間', () => {
		const { outer } = fieldGeometry(vertical);
		expect(frontLabelAt(vertical)).toEqual([0, outer.y + outer.height + 0.7]);
	});
});
