import { describe, expect, it } from 'vitest';
import { placeBelow, type BelowInput } from './popover.svelte.js';

/**
 * 畫面座標（px）。畫面 1000×800；錨點（「!」、「＋」）在 300–320、100–120；小窗寬 200、高 150。
 */
function input(over: Partial<BelowInput> = {}): BelowInput {
	return {
		anchor: { top: 100, bottom: 120, left: 300, right: 320 },
		pop: { w: 200, h: 150 },
		view: { w: 1000, h: 800 },
		gap: 6,
		align: 'right',
		flip: true,
		...over
	};
}

describe('小窗放在錨點下面', () => {
	it('放在錨點下面隔 gap，右邊對齊錨點的右邊', () => {
		expect(placeBelow(input())).toEqual({ top: 126, left: 120 });
	});

	it('左邊對齊錨點的左邊', () => {
		expect(placeBelow(input({ gap: 4, align: 'left' }))).toEqual({ top: 124, left: 300 });
	});

	it('左右不超出畫面，邊上留 8px', () => {
		const nearLeft = { top: 100, bottom: 120, left: 80, right: 100 };
		expect(placeBelow(input({ anchor: nearLeft })).left).toBe(8);
		const nearRight = { top: 100, bottom: 120, left: 900, right: 920 };
		expect(placeBelow(input({ anchor: nearRight, align: 'left' })).left).toBe(1000 - 8 - 200);
	});

	it('下面放不下、上面放得下，就放在錨點上面', () => {
		const low = { top: 700, bottom: 720, left: 300, right: 320 };
		expect(placeBelow(input({ anchor: low })).top).toBe(700 - 6 - 150);
	});

	it('上下都放不下：放下面，往上夾到不超出畫面底（留 8px）', () => {
		expect(placeBelow(input({ pop: { w: 200, h: 700 } })).top).toBe(800 - 8 - 700);
	});

	it('不翻（加段選單）：下面放不下也放在錨點下面，只管左右', () => {
		const lowRight = { top: 700, bottom: 720, left: 900, right: 920 };
		expect(placeBelow(input({ anchor: lowRight, gap: 4, align: 'left', flip: false }))).toEqual({
			top: 724,
			left: 1000 - 8 - 200
		});
	});
});
