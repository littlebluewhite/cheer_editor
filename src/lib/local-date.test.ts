import { describe, expect, it } from 'vitest';
import { localDate } from './local-date';

describe('裝置的當地日期', () => {
	it('寫成 YYYY-MM-DD，月和日補 0', () => {
		expect(localDate(new Date(2026, 0, 9, 12))).toBe('2026-01-09');
	});

	it('用當地時間，不是 UTC：半夜剛過還是當天', () => {
		expect(localDate(new Date(2026, 10, 4, 0, 30))).toBe('2026-11-04');
		expect(localDate(new Date(2026, 10, 4, 23, 59))).toBe('2026-11-04');
	});
});
