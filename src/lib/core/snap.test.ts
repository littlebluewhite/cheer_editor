import { describe, expect, it } from 'vitest';
import {
	fieldPositionText,
	snapGroup,
	snapPointsNear,
	snapPosition,
	type FieldConfig,
	type Position
} from './index';

const nine: FieldConfig = { strips: 9, layout: 'vertical' };
const five: FieldConfig = { strips: 5, layout: 'horizontal' };

// 9 條直放：一格 1.8288 m，墊子 x -8.2296–8.2296、y -6.4008–6.4008，正面 y = 6.4008。
// 第 3 條是 x -4.572–-2.7432；正面起第 2 格是 y 4.572–2.7432。

function close(p: Position): Position {
	return [Number(p[0].toFixed(4)), Number(p[1].toFixed(4))];
}

describe('吸附', () => {
	it('吸到格子裡的 1/4、1/2、3/4 和格線上', () => {
		expect(close(snapPosition(nine, [-4.05, 3.7], 1))).toEqual([-4.1148, 3.6576]);
		expect(close(snapPosition(nine, [-4.55, 2.76], 1))).toEqual([-4.572, 2.7432]);
		expect(close(snapPosition(nine, [-3.25, 3.0], 1))).toEqual([-3.2004, 3.2004]);
	});

	it('中心 X 在正中間那格的中心，也是吸附點', () => {
		expect(close(snapPosition(nine, [0.05, -0.05], 1))).toEqual([0, 0]);
	});

	it('放大 ×2 以上才多 1/8、3/8、5/8、7/8', () => {
		expect(close(snapPosition(nine, [-4.36, 0], 1))[0]).toBe(-4.572);
		expect(close(snapPosition(nine, [-4.36, 0], 1.9))[0]).toBe(-4.572);
		expect(close(snapPosition(nine, [-4.36, 0], 2))[0]).toBe(-4.3434);
		expect(close(snapPosition(nine, [-3.94, 0], 3))[0]).toBe(-3.8862);
	});

	it('場地外照同一套格子，最遠到墊子外 1 m', () => {
		expect(close(snapPosition(nine, [-8.7, 6.9], 1))).toEqual([-8.6868, 6.858]);
		expect(close(snapPosition(nine, [-12, 9], 1))).toEqual([-9.144, 7.3152]);
		expect(close(snapPosition(nine, [-12, 9], 4))).toEqual([-9.144, 7.3152]);
	});

	it('橫放也照同一套', () => {
		// 5 條橫放：墊子 x -6.4008–6.4008、y -4.572–4.572。
		expect(close(snapPosition(five, [-5.9, 0.1], 1))).toEqual([-5.9436, 0]);
	});

	it('拖的時候冒出來的小點：附近的吸附點，放大 ×2 以上才有八等分，不超出墊子外 1 m', () => {
		const coarse = snapPointsNear(nine, [0, 0], 1);
		expect(coarse.length).toBeGreaterThan(0);
		for (const p of coarse) {
			expect(close(snapPosition(nine, [p.x, p.y], 1))).toEqual(close([p.x, p.y]));
			expect(p.fine).toBe(false);
		}
		expect(coarse.some((p) => Math.abs(p.x - 0.4572) < 1e-6 && Math.abs(p.y) < 1e-6)).toBe(true);

		const fine = snapPointsNear(nine, [0, 0], 2);
		expect(fine.some((p) => p.fine && Math.abs(p.x - 0.2286) < 1e-6)).toBe(true);

		for (const p of snapPointsNear(nine, [-9.2, 7.3], 2)) {
			expect(p.x).toBeGreaterThanOrEqual(-9.2297);
			expect(p.y).toBeLessThanOrEqual(7.4009);
		}
	});
});

describe('位置文字', () => {
	it('直放：第幾條左起幾分之幾｜正面起第幾格幾分之幾', () => {
		expect(fieldPositionText(nine, [-4.1148, 3.6576])).toBe('第 3 條 左起 1/4｜正面起第 2 格 1/2');
		expect(fieldPositionText(nine, [0, 0])).toBe('第 5 條 左起 1/2｜正面起第 4 格 1/2');
	});

	it('在格線上寫「線上」；八等分照寫', () => {
		expect(fieldPositionText(nine, [-4.572, 2.7432])).toBe('第 3 條 左起 線上｜正面起第 3 格 線上');
		expect(fieldPositionText(nine, [-4.3434, 3.8862])).toBe('第 3 條 左起 1/8｜正面起第 2 格 3/8');
	});

	it('墊子右邊和後面的邊上（不叫「邊線」：那是接縫的 Avoid 詞）', () => {
		expect(fieldPositionText(nine, [8.2296, -6.4008])).toBe('第 9 條 場地右緣｜正面起第 7 格 場地後緣');
	});

	it('場地外寫在哪一邊外面幾格', () => {
		expect(fieldPositionText(nine, [-8.2296, 6.858])).toBe('第 1 條 左起 線上｜場地外正面那邊 1/4 格');
		expect(fieldPositionText(nine, [-9.144, -6.858])).toBe('場地外左邊 1/2 格｜場地外後面 1/4 格');
		expect(fieldPositionText(nine, [8.6868, 0])).toBe('場地外右邊 1/4 格｜正面起第 4 格 1/2');
	});

	it('橫放：第幾條正面起幾分之幾｜左起第幾格幾分之幾（第 1 條最靠近裁判）', () => {
		expect(fieldPositionText(five, [-5.9436, 0])).toBe('第 3 條 正面起 1/2｜左起第 1 格 1/4');
	});

	it('沒在吸附點上（例如舊檔）就寫百分比', () => {
		expect(fieldPositionText(nine, [-4.572 + 0.3 * 1.8288, 3.6576])).toBe(
			'第 3 條 左起 30%｜正面起第 2 格 1/2'
		);
	});
});

describe('整組拖：拖過頭停在最遠的合法位置', () => {
	const team = { m1: [0, 0] as Position, m2: [0.9144, 0] as Position };

	it('都在場地外 1 m 以內：跟一個人吸附一樣，沒有靠邊', () => {
		const r = snapGroup(nine, team, 'm2', [3.25, 3.0], 1);
		expect(close(r.at)).toEqual(close(snapPosition(nine, [3.25, 3.0], 1)));
		expect(r.clamped).toBe(false);
	});

	it('拖的人出界：他停在最遠的吸附點，有靠邊', () => {
		const r = snapGroup(nine, team, 'm2', [12, 0], 1);
		expect(close(r.at)).toEqual([9.144, 0]);
		expect(r.clamped).toBe(true);
	});

	it('別人會出界：整組停在那個人碰到邊界之前，拖的人還在吸附點上', () => {
		const r = snapGroup(nine, team, 'm1', [10, -20], 1);
		expect(close(r.at)).toEqual([8.2296, -7.3152]);
		expect(r.clamped).toBe(true);
	});
});
