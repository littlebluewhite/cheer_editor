import { describe, expect, it } from 'vitest';
import {
	FIELD_CHROME_PX,
	FIELD_KEEP_W_PX,
	INSPECTOR_AUTO_MAX_PX,
	INSPECTOR_MIN_PX,
	autoInspectorWidth,
	clampInspectorWidth
} from './editor-layout';

describe('右邊欄自動多寬', () => {
	it('場地照長寬比要的寬度以外，都給右邊欄', () => {
		// 場地那一欄高 524 → 場地高 500，長寬比 1.2 → 場地寬 600
		expect(autoInspectorWidth(1440, 524, 1.2)).toBe(1440 - FIELD_CHROME_PX - 600);
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
});
