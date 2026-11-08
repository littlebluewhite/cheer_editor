import { describe, expect, it } from 'vitest';
import { placeToasts, type Box } from './toast-dodge';

// 場地那一塊 400×300（畫面座標從 0,0 起）；提示 100×30。
const area: Box = { left: 0, top: 0, right: 400, bottom: 300 };
const size = { width: 100, height: 30 };
const box = (left: number, top: number, width: number, height: number): Box => ({ left, top, right: left + width, bottom: top + height });
/** 上面那一列（場地上緣往下 4px）和下面那一列（提示下緣離場地下緣 4px）。 */
const rows = [4, 300 - 4 - 30];

describe('場地上的提示放哪：不蓋住要看得到的東西（N23、N24）', () => {
	it('沒有東西擋著：放在上面中間', () => {
		expect(placeToasts(size, area, rows, [])).toEqual({ left: 150, top: 4 });
	});

	it('上面中間是選人工具列：同一列換到右邊，不往下蓋到場地（工具列旁邊空著就放旁邊）', () => {
		const tools = { rect: box(120, 4, 160, 36), weight: 1 };
		expect(placeToasts(size, area, rows, [tools])).toEqual({ left: 296, top: 4 });
	});

	it('上面那一列都會蓋到東西：換到下面那一列；下面中間是「正面／裁判」就放旁邊，不蓋住沒選到的人和字', () => {
		const numbers = { rect: box(0, 10, 400, 12), weight: 1 };
		const front = { rect: box(160, 280, 80, 14), weight: 1 };
		expect(placeToasts(size, area, rows, [numbers, front])).toEqual({ left: 296, top: 266 });
	});

	it('哪裡都會蓋到東西：放在蓋到最少的地方，選到的人（權重大）寧可不蓋', () => {
		const everywhereTop = { rect: box(0, 0, 400, 40), weight: 1 };
		const picked = { rect: box(0, 260, 400, 40), weight: 100 };
		expect(placeToasts(size, area, rows, [everywhereTop, picked])).toEqual({ left: 150, top: 4 });
	});

	it('提示比場地還寬：只能置中', () => {
		const wide = { width: 500, height: 30 };
		const tools = { rect: box(120, 4, 160, 36), weight: 1 };
		expect(placeToasts(wide, area, rows, [tools])).toEqual({ left: -50, top: 266 });
	});
});
