import { describe, expect, it } from 'vitest';
import { CELL_M } from './field';
import { mirrorPositions } from './group-moves';

/** 位置差不到 1e-9 m 就算一樣（吸附點是算出來的，可能差最後一位）。 */
function expectNear(got: Record<string, number[]>, want: Record<string, number[]>) {
	expect(Object.keys(got)).toEqual(Object.keys(want));
	for (const [id, [x, y]] of Object.entries(want)) {
		expect(got[id][0]).toBeCloseTo(x, 9);
		expect(got[id][1]).toBe(y);
	}
}

const vertical9 = { strips: 9, layout: 'vertical' } as const;
const horizontal5 = { strips: 5, layout: 'horizontal' } as const;

describe('鏡像', () => {
	it('9 條直放：左右對調（左起第 2 條 1/4 → 右起第 2 條 1/4），前後不變', () => {
		const pos = { a: [-3.25 * CELL_M, -2 * CELL_M], b: [4.5 * CELL_M, 1.5 * CELL_M] } as const;
		expectNear(mirrorPositions(vertical9, { a: [...pos.a], b: [...pos.b] }, 1), {
			a: [3.25 * CELL_M, -2 * CELL_M],
			b: [-4.5 * CELL_M, 1.5 * CELL_M]
		});
	});

	it('5 條橫放：一樣以左右中線為軸，左右對調、前後不變', () => {
		expectNear(mirrorPositions(horizontal5, { a: [-3.25 * CELL_M, 2 * CELL_M] }, 1), {
			a: [3.25 * CELL_M, 2 * CELL_M]
		});
	});

	it('站在中線上的人不動（連不在格點上的前後也不動）', () => {
		expect(mirrorPositions(vertical9, { a: [0, 0.1234] }, 1)).toEqual({ a: [0, 0.1234] });
	});

	it('翻過去不在吸附點上：左右吸到最近的吸附點（放大時多八等分），前後照舊', () => {
		// 1.1 m（約 0.6 格）在中線右邊；翻過去最近的 1/4 格是中線左邊 0.5 格，放大 ×2 是 0.625 格。
		expectNear(mirrorPositions(vertical9, { a: [1.1, 0.3] }, 1), { a: [-0.5 * CELL_M, 0.3] });
		expectNear(mirrorPositions(vertical9, { a: [1.1, 0.3] }, 2), { a: [-0.625 * CELL_M, 0.3] });
	});
});
