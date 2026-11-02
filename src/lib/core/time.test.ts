import { describe, expect, it } from 'vitest';
import {
	addSegment,
	createFlow,
	positionText,
	rulerMarks,
	segmentSpans,
	toPosition,
	toSeconds,
	totalSeconds,
	updateSegment,
	type CommandResult,
	type Flow
} from './index';

function flowOf(r: CommandResult): Flow {
	if (r.kind !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(r)}`);
	return r.flow;
}

/** 音樂 1（150 BPM、8 個八拍）→ 口號 32.4 秒 → 音樂 2（120 BPM、1 個八拍）。 */
function sample(): Flow {
	let flow = flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));
	flow = flowOf(addSegment(flow, 'music'));
	flow = flowOf(addSegment(flow, 'chant'));
	flow = flowOf(addSegment(flow, 'music'));
	flow = flowOf(updateSegment(flow, 's2', { seconds: 32.4 }));
	flow = flowOf(updateSegment(flow, 's3', { bpm: 120, eights: 1, lastBeats: 8 }));
	return flow;
}

const empty = () => flowOf(createFlow({ name: '空', field: { strips: 9, layout: 'vertical' } }));

describe('段的秒數', () => {
	it('段跟段緊接：音樂段 = 半拍數 × 30 ÷ BPM，口號段 = 0.1 秒數 ÷ 10', () => {
		const spans = segmentSpans(sample());
		expect(spans.map((s) => [s.label, s.startSec, s.durationSec])).toEqual([
			['音樂 1', 0, 25.6],
			['口號 1', 25.6, 32.4],
			['音樂 2', 58, 4]
		]);
		expect(totalSeconds(sample())).toBeCloseTo(62, 9);
	});

	it('沒有段時全長 0', () => {
		expect(totalSeconds(empty())).toBe(0);
	});
});

describe('全域秒數和「段 ＋ 段內整數時間」互換', () => {
	it('段內時間換成秒數：音樂段用半拍，口號段用 0.1 秒', () => {
		const flow = sample();
		expect(toSeconds(flow, { segmentId: 's1', at: 8 })).toBeCloseTo(1.6, 9);
		expect(toSeconds(flow, { segmentId: 's2', at: 5 })).toBeCloseTo(26.1, 9);
		expect(toSeconds(flow, { segmentId: 's3', at: 2 })).toBeCloseTo(58.5, 9);
	});

	it('秒數換回段內時間，取到這一刻所在的那個半拍或 0.1 秒', () => {
		const flow = sample();
		expect(toPosition(flow, 1.6)).toEqual({ segmentId: 's1', at: 8 });
		expect(toPosition(flow, 1.79)).toEqual({ segmentId: 's1', at: 8 });
		expect(toPosition(flow, 26.1)).toEqual({ segmentId: 's2', at: 5 });
	});

	it('剛好在兩段交界時算後面那一段的開頭', () => {
		expect(toPosition(sample(), 25.6)).toEqual({ segmentId: 's2', at: 0 });
	});

	it('超出範圍時夾在流程頭尾', () => {
		const flow = sample();
		expect(toPosition(flow, -3)).toEqual({ segmentId: 's1', at: 0 });
		expect(toPosition(flow, 62)).toEqual({ segmentId: 's3', at: 15 });
		expect(toPosition(flow, 999)).toEqual({ segmentId: 's3', at: 15 });
	});

	it('沒有段時沒有位置', () => {
		expect(toPosition(empty(), 0)).toBeNull();
	});

	it('改 BPM 後，同一個段內時間（拍）不變、秒數變', () => {
		const pos = { segmentId: 's1', at: 32 };
		expect(toSeconds(sample(), pos)).toBeCloseTo(6.4, 9);
		const faster = flowOf(updateSegment(sample(), 's1', { bpm: 120 }));
		expect(toSeconds(faster, pos)).toBeCloseTo(8, 9);
	});
});

describe('八拍尺的刻度', () => {
	it('音樂段每拍一格，每個八拍的第一拍是大刻度並寫第幾個八拍；口號段每秒一格，每 5 秒寫秒數', () => {
		const flow = flowOf(updateSegment(sample(), 's1', { eights: 2, lastBeats: 2 }));
		// 音樂 1：150 BPM、10 拍、4 秒；口號 1：32.4 秒，從 4 秒開始
		const marks = rulerMarks(flow);
		expect(marks.slice(0, 11)).toEqual([
			{ sec: 0, major: true, label: '1' },
			...[0.4, 0.8, 1.2, 1.6, 2, 2.4, 2.8].map((sec) => ({ sec: expect.closeTo(sec, 9), major: false })),
			{ sec: expect.closeTo(3.2, 9), major: true, label: '2' },
			{ sec: expect.closeTo(3.6, 9), major: false },
			{ sec: 4, major: true, label: '0s' }
		]);
		expect(marks.slice(11, 16)).toEqual([
			{ sec: 5, major: false },
			{ sec: 6, major: false },
			{ sec: 7, major: false },
			{ sec: 8, major: false },
			{ sec: 9, major: true, label: '5s' }
		]);
	});
});

describe('目前位置文字', () => {
	it('音樂段寫「段名 第幾個八拍-第幾拍」，半拍加 &', () => {
		const flow = sample();
		expect(positionText(flow, 0)).toBe('音樂 1 1-1');
		// 第 3 個八拍第 5 拍的 & = 第 41 個半拍 = 41 × 0.2 秒
		expect(positionText(flow, 8.2)).toBe('音樂 1 3-5&');
		expect(positionText(flow, 8.35)).toBe('音樂 1 3-5&');
		expect(positionText(flow, 58)).toBe('音樂 2 1-1');
	});

	it('口號段寫秒數，到 0.1 秒', () => {
		expect(positionText(sample(), 25.6 + 12.37)).toBe('口號 1 12.3 秒');
	});

	it('最後一個八拍不滿：最後一拍是那個八拍的第 4 拍', () => {
		const flow = flowOf(updateSegment(sample(), 's3', { eights: 2, lastBeats: 4 }));
		// 音樂 2 是 120 BPM、12 拍 = 6 秒，從 58 秒開始
		expect(positionText(flow, 64)).toBe('音樂 2 2-4&');
	});

	it('沒有段時是空字串', () => {
		expect(positionText(empty(), 0)).toBe('');
	});
});
