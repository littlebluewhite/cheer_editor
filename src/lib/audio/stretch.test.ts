import { describe, expect, it } from 'vitest';
import { stretch } from './stretch.js';

const RATE = 44100;

function sine(hz: number, sec: number): Float32Array {
	return Float32Array.from({ length: Math.round(sec * RATE) }, (_, i) => Math.sin((2 * Math.PI * hz * i) / RATE));
}

/** 中間那一段的頻率：數往上穿過 0 的次數。 */
function pitch(data: Float32Array): number {
	const from = Math.floor(data.length / 4);
	const to = Math.floor((data.length * 3) / 4);
	let ups = 0;
	for (let i = from + 1; i < to; i++) if (data[i - 1] < 0 && data[i] >= 0) ups++;
	return ups / ((to - from) / RATE);
}

describe('慢速播放的拉長（音高不變）', () => {
	for (const rate of [0.5, 0.75]) {
		it(`${rate}x：長度變成 1 / ${rate} 倍，440 Hz 還是 440 Hz，左右聲道一起拉`, () => {
			const left = sine(440, 1);
			const right = sine(440, 1);
			const [l, r] = stretch([left, right], RATE, rate);
			expect(l.length).toBe(Math.ceil(left.length / rate));
			expect(r.length).toBe(l.length);
			expect(Math.abs(pitch(l) - 440)).toBeLessThan(5);
			// 音量也還在（不是拉成一片安靜）
			const peak = l.slice(l.length / 4, (l.length * 3) / 4).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
			expect(peak).toBeGreaterThan(0.8);
		});
	}
});
