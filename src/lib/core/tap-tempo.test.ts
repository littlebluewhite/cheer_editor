import { describe, expect, it } from 'vitest';
import { MIN_TAPS, tapBpm } from './index';

/** 從 0 秒起，每 gap 秒點一下，共 n 下。 */
const taps = (n: number, gap: number) => Array.from({ length: n }, (_, i) => i * gap);

describe('敲擊測速', () => {
	it('0.4 秒一下點 8 下 → 150 BPM', () => {
		expect(MIN_TAPS).toBe(8);
		expect(tapBpm(taps(8, 0.4))).toBe(150);
	});

	it('點不到 8 下 → 還算不出來', () => {
		expect(tapBpm(taps(7, 0.4))).toBeNull();
		expect(tapBpm([])).toBeNull();
	});

	it('中間有一下點歪 → 去掉離群的間隔後還是對的', () => {
		const t = taps(10, 0.5);
		t[4] += 0.15;
		expect(tapBpm(t)).toBe(120);
	});

	it('點得有一點不準：取到整數', () => {
		expect(tapBpm([0, 0.41, 0.8, 1.19, 1.6, 2.01, 2.4, 2.8])).toBe(150);
	});
});
