import { describe, expect, it } from 'vitest';
import { placeCuePop, type CuePopInput } from './cue-pop';

/**
 * 座標都是格子框裡的 px（左上角是 0, 0）。
 * 一排八拍高 100：第一排 0–100、第二排 110–210、第三排 220–320；一格寬 50。
 * 拍點小窗寬 300、高 120；格子框寬 440；畫面看得到 0–600。
 */
function input(over: Partial<CuePopInput> = {}): CuePopInput {
	return {
		sel: { top: 0, bottom: 100, left: 100, right: 200 },
		arrowAbove: 150,
		arrowBelow: 150,
		pop: { w: 300, h: 120 },
		wrapW: 440,
		view: { top: 0, bottom: 600 },
		rowH: 110,
		cur: null,
		...over
	};
}

describe('拍點小窗放哪裡', () => {
	it('下面放得下就放在選的拍下面，尖角對準選取中間', () => {
		expect(placeCuePop(input())).toEqual({ top: 108, left: 0, arrow: 150, above: false });
	});

	it('左右不超出格子框：選在最右邊，小窗貼齊右邊，尖角還是指著選取', () => {
		const p = placeCuePop(input({ sel: { top: 0, bottom: 100, left: 350, right: 400 }, arrowAbove: 375, arrowBelow: 375 }));
		expect(p.left).toBe(140);
		expect(p.arrow).toBe(235);
	});

	it('下面放不下、上面放得下，就放在選的拍上面', () => {
		const p = placeCuePop(input({ sel: { top: 440, bottom: 540, left: 100, right: 200 } }));
		expect(p).toEqual({ top: 440 - 8 - 120, left: 0, arrow: 150, above: true });
	});

	it('按小窗裡的按鈕：選取變長但沒被蓋住，小窗不動，只有尖角跟著', () => {
		const cur = { top: 108, left: 0, arrow: 150, above: false };
		const p = placeCuePop(input({ cur, sel: { top: 0, bottom: 100, left: 100, right: 250 }, arrowBelow: 175 }));
		expect(p).toEqual({ ...cur, arrow: 175 });
	});

	it('按小窗裡的按鈕：選取跑到下一個八拍、被小窗蓋住，就搬走；上下都放得下時挑離原本近的', () => {
		const cur = { top: 108, left: 0, arrow: 150, above: false };
		// 選到第二排（110–210），小窗在 108–228 會蓋住；上面放 110-8-120=-18（看不到，放不下），下面放 218。
		const p = placeCuePop(input({ cur, sel: { top: 110, bottom: 210, left: 0, right: 440 } }));
		expect(p.above).toBe(false);
		expect(p.top).toBe(218);
		// 畫面再往下捲一點，上下都放得下：上面 -18 比下面 218 離原本的 108 遠，還是放下面。
		const q = placeCuePop(input({ cur, view: { top: -200, bottom: 600 }, sel: { top: 110, bottom: 210, left: 0, right: 440 } }));
		expect(q.top).toBe(218);
	});

	it('按小窗裡的按鈕：選取離小窗超過一個八拍，就搬回選取旁邊', () => {
		const cur = { top: 108, left: 0, arrow: 150, above: false };
		const p = placeCuePop(input({ cur, sel: { top: 440, bottom: 540, left: 100, right: 200 }, view: { top: 0, bottom: 900 } }));
		expect(p.top).toBe(548);
	});
});
