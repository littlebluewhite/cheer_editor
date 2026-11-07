// 調整場地（#169）：改條數或鋪向，站位照比例放大縮小，再吸附到格子上。
import { describe, expect, it } from 'vitest';
import { adjustField, CELL_M, createFlow, fieldGeometry, type FieldConfig, type Flow, type Position } from './index';
import { flowOf } from '../test-flows';

const NINE_V: FieldConfig = { strips: 9, layout: 'vertical' };
const FIVE_H: FieldConfig = { strips: 5, layout: 'horizontal' };

/** 9 條直放（9 格寬 × 7 格深）的流程；站位用格子單位寫。 */
function flowWith(cells: Record<string, [number, number]>[]): Flow {
	const flow = flowOf(createFlow({ name: '測試', field: NINE_V }));
	const pos = (c: Record<string, [number, number]>) =>
		Object.fromEntries(Object.entries(c).map(([id, [x, y]]) => [id, [x * CELL_M, y * CELL_M] as Position]));
	return {
		...flow,
		formations: cells.map((c, i) => ({ id: `f${i + 1}`, segmentId: null, at: i, pos: pos(c) }))
	};
}

/** 換成格子單位、四捨五入到 1/1000 格，好比對。 */
const inCells = (p: Position) => p.map((v) => Math.round((v / CELL_M) * 1000) / 1000 + 0);

function inside(field: FieldConfig, [x, y]: Position) {
	const { outer } = fieldGeometry(field);
	const e = 1e-9;
	return x >= outer.x - e && x <= outer.x + outer.width + e && y >= outer.y - e && y <= outer.y + outer.height + e;
}

describe('調整場地', () => {
	const before = flowWith([
		// 正中間、左後角那格的中心、右前角那格的中心
		{ a: [0, 0], b: [-4, -3], c: [4, 3] },
		// c 站在墊子右邊外 3/8 格（場外的人）
		{ a: [0, 0], b: [-4, -3], c: [4.875, 3] }
	]);

	it('9 條直放換 5 條橫放：場地換了，每個人照比例縮、吸到格子上', () => {
		const after = flowOf(adjustField(before, FIVE_H));
		expect(after.field).toEqual(FIVE_H);
		// 寬 9 → 7 格、深 7 → 5 格，再吸到最近的 1/4 格
		expect(inCells(after.formations[0].pos.a)).toEqual([0, 0]);
		expect(inCells(after.formations[0].pos.b)).toEqual([-3, -2.25]);
		expect(inCells(after.formations[0].pos.c)).toEqual([3, 2.25]);
	});

	it('場外的人還是在墊子外一樣遠', () => {
		const after = flowOf(adjustField(before, FIVE_H));
		expect(inCells(after.formations[1].pos.c)).toEqual([3.875, 2.25]);
	});

	it('每個人都在新場地裡；換回來也都還在場內', () => {
		const there = flowOf(adjustField(before, FIVE_H));
		const back = flowOf(adjustField(there, NINE_V));
		expect(back.field).toEqual(NINE_V);
		for (const [flow, field] of [
			[there, FIVE_H],
			[back, NINE_V]
		] as const) {
			for (const f of flow.formations) for (const p of Object.values(f.pos)) expect(inside(field, p)).toBe(true);
		}
	});

	it('左右對稱的站位：9 條換 4 條再換回 9 條，還是左右對稱', () => {
		const FOUR_V: FieldConfig = { strips: 4, layout: 'vertical' };
		// 每一對站在中線兩邊一樣遠（格子單位，都在 1/4 格上）
		const xs = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75, 4, 4.25, 4.5];
		const pairs = Object.fromEntries(
			xs.flatMap((x, i) => [
				[`l${i}`, [-x, 1] as [number, number]],
				[`r${i}`, [x, 1] as [number, number]]
			])
		);
		const there = flowOf(adjustField(flowWith([pairs]), FOUR_V));
		const back = flowOf(adjustField(there, NINE_V));
		for (const flow of [there, back]) {
			const pos = flow.formations[0].pos;
			for (const i of xs.keys()) {
				const [lx, ly] = inCells(pos[`l${i}`]);
				const [rx, ry] = inCells(pos[`r${i}`]);
				expect([lx + rx + 0, ly - ry + 0]).toEqual([0, 0]);
			}
		}
	});

	it('條數不對就擋下', () => {
		expect(adjustField(before, { strips: 0, layout: 'vertical' })).toEqual({
			kind: 'blocked',
			message: '條數要是 1–12 的整數'
		});
	});
});
