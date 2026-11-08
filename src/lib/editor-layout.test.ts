import { describe, expect, it } from 'vitest';
import {
	FIELD_CHROME_PX,
	FIELD_KEEP_W_PX,
	INSPECTOR_AUTO_MAX_PX,
	INSPECTOR_MIN_PX,
	autoInspectorWidth,
	clampInspectorWidth,
	viewOnlyReason
} from './editor-layout';

describe('右邊欄自動多寬', () => {
	it('場地照長寬比要的寬度以外，都給右邊欄；場地上面固定留給選人工具列的那一條不算場地（N05）', () => {
		// 場地那一欄高 564 → 扣上下內距 24、工具列那一條 40 → 場地高 500，長寬比 1.2 → 場地寬 600
		expect(autoInspectorWidth(1440, 564, 1.2)).toBe(1440 - FIELD_CHROME_PX - 600);
	});

	it('螢幕越高，場地越大，右邊欄越窄', () => {
		expect(autoInspectorWidth(1440, 700, 1.2)).toBeLessThan(autoInspectorWidth(1440, 500, 1.2));
	});

	it('剩下的不夠時，右邊欄還是有最窄的寬度', () => {
		expect(autoInspectorWidth(1100, 900, 1.2)).toBe(INSPECTOR_MIN_PX);
	});

	it('剩很多時，最寬不超過上限，也不超過視窗的一半', () => {
		expect(autoInspectorWidth(3000, 400, 1.2)).toBe(INSPECTOR_AUTO_MAX_PX);
		expect(autoInspectorWidth(1400, 100, 1.2)).toBe(700);
	});
});

describe('自己拖的寬度', () => {
	it('夾在最窄和「場地那一欄留夠寬」之間', () => {
		expect(clampInspectorWidth(100, 1440)).toBe(INSPECTOR_MIN_PX);
		expect(clampInspectorWidth(500, 1440)).toBe(500);
		expect(clampInspectorWidth(2000, 1440)).toBe(1440 - FIELD_KEEP_W_PX);
	});

	it('拖到最寬，場地本身（不算左邊工具欄）還有 360 px 寬：1024 寬的視窗也是', () => {
		expect(1024 - FIELD_CHROME_PX - clampInspectorWidth(2000, 1024)).toBeGreaterThanOrEqual(360);
		expect(clampInspectorWidth(2000, 1024)).toBeGreaterThanOrEqual(INSPECTOR_MIN_PX);
	});
});

describe('窄螢幕上為什麼不能編', () => {
	it('手機橫拿（844×390 觸控）又窄又矮：寫太小，不叫人轉', () => {
		expect(viewOnlyReason(844, 390, true)).toBe('畫面太小了（不到 1024×600 像素），只能看、不能編');
	});

	it('夠大就不寫', () => {
		expect(viewOnlyReason(1024, 600, false)).toBe('');
	});
});
