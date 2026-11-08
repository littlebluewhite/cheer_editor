import { describe, expect, it } from 'vitest';
import { CELL_M } from './field';
import { alignColumn, alignRow, mirrorPositions, spreadEvenly } from './group-moves';

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

const C = CELL_M;
type Pos = Record<string, [number, number]>;

/** 所有的排列順序。 */
function permutations<T>(xs: T[]): T[][] {
	if (xs.length <= 1) return [xs];
	return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest]));
}

describe('對齊', () => {
	it('一橫排：前後位置取平均再吸附，左右不變', () => {
		// 前後 -2、1、0.5 格：平均 -1/6 格，吸到 -1/4 格
		const pos: Pos = { a: [-2 * C, -2 * C], b: [0, 1 * C], c: [1.5 * C, 0.5 * C] };
		const got = alignRow(vertical9, pos, 1);
		expect(Object.keys(got)).toEqual(['a', 'b', 'c']);
		for (const id of ['a', 'b', 'c']) {
			expect(got[id][0]).toBe(pos[id][0]);
			expect(got[id][1]).toBeCloseTo(-0.25 * C, 9);
		}
	});

	it('一直排：左右位置取平均再吸附，前後不變', () => {
		// 左右 -1、0.5、1.25 格：平均 0.25 格，正好在吸附點上
		const pos: Pos = { a: [-1 * C, -2 * C], b: [0.5 * C, 1 * C], c: [1.25 * C, 0.3] };
		const got = alignColumn(vertical9, pos, 1);
		for (const id of ['a', 'b', 'c']) {
			expect(got[id][0]).toBeCloseTo(0.25 * C, 9);
			expect(got[id][1]).toBe(pos[id][1]);
		}
	});

	it('放大 ×2 時平均吸到八等分的點', () => {
		// 左右 0 和 0.25 格：平均 1/8 格，放大 ×2 才有這個吸附點
		const pos: Pos = { a: [0, 0], b: [0.25 * C, C] };
		expect(alignColumn(vertical9, pos, 2).a[0]).toBeCloseTo(0.125 * C, 9);
	});
});

describe('平均分開', () => {
	it('兩端不動，中間的人照左右的順序排在兩端之間，間隔一樣（不照選的順序）', () => {
		// 左右攤得比前後開：照左右排
		const pos: Pos = {
			end2: [3 * C, 1 * C],
			mid2: [2.75 * C, -1 * C],
			end1: [-3 * C, -1 * C],
			mid1: [-2 * C, 0.25 * C]
		};
		const got = spreadEvenly(vertical9, pos, 1);
		expect(got.end1).toEqual(pos.end1);
		expect(got.end2).toEqual(pos.end2);
		// 兩端左右差 6 格、前後差 2 格，分三段：(-1, -1/3)、(1, 1/3) 格，再吸到 1/4 格
		expect(got.mid1[0]).toBeCloseTo(-1 * C, 9);
		expect(got.mid1[1]).toBeCloseTo(-0.25 * C, 9);
		expect(got.mid2[0]).toBeCloseTo(1 * C, 9);
		expect(got.mid2[1]).toBeCloseTo(0.25 * C, 9);
	});

	it('L 形（左右、前後攤得一樣開）：兩端是距離最遠的兩個人；輸入順序打亂、座標差 ±1e-9 結果都一樣（N44）', () => {
		// 轉角 a、往右 b、c，往後 d：最遠的是 c 和 d
		const base: Pos = { a: [0, 0], b: [1 * C, 0], c: [2 * C, 0], d: [0, 2 * C] };
		const want = spreadEvenly(vertical9, base, 1);
		expect(want.c).toEqual(base.c);
		expect(want.d).toEqual(base.d);
		const ids = Object.keys(base);
		const orders = permutations(ids);
		for (const [k, order] of orders.entries()) {
			const pos: Pos = Object.fromEntries(
				order.map((id, i) => [id, [base[id][0] + ((i + k) % 3 - 1) * 1e-9, base[id][1] + ((i * 2 + k) % 3 - 1) * 1e-9]])
			);
			const got = spreadEvenly(vertical9, pos, 1);
			for (const id of ids) {
				expect(got[id][0]).toBeCloseTo(want[id][0], 6);
				expect(got[id][1]).toBeCloseTo(want[id][1], 6);
			}
		}
	});

	it('前後攤得比左右開：照前後的順序排', () => {
		const pos: Pos = { a: [0, -3 * C], b: [1 * C, 3 * C], c: [-1 * C, 2.5 * C] };
		const got = spreadEvenly(vertical9, pos, 1);
		expect(got.a).toEqual(pos.a);
		expect(got.b).toEqual(pos.b);
		// 前後排起來 c 在中間：排到 a、b 正中間
		expect(got.c[0]).toBeCloseTo(0.5 * C, 9);
		expect(got.c[1]).toBeCloseTo(0, 9);
	});
});
