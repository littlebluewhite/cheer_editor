import { describe, expect, it } from 'vitest';
import {
	addSegment,
	atText,
	createFlow,
	lengthText,
	positionText,
	readLength,
	readStart,
	readTime,
	rulerMarks,
	segmentSpans,
	snapPlayhead,
	snapToBeat,
	stepPlayhead,
	timeText,
	toPosition,
	toSeconds,
	totalSeconds,
	updateSegment,
	type Flow
} from './index';
import { flowOf } from '../test-flows';

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

/** 讀得懂的時間點。 */
const time = (segmentId: string, at: number) => ({ kind: 'ok', value: { segmentId, at } });

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

describe('段內時間的文字（動作表單）', () => {
	const music = () => sample().segments[0];
	const chant = () => sample().segments[1];

	it('音樂段的時間點寫「第幾個八拍-第幾拍」，半拍加 &；口號段寫秒數', () => {
		expect(atText(music(), 0)).toBe('1-1');
		expect(atText(music(), 41)).toBe('3-5&');
		expect(atText(chant(), 123)).toBe('12.3');
	});

	it('開始：把教練打的時間點換回段內整數時間', () => {
		expect(readStart(music(), '3-5&')).toEqual({ kind: 'ok', value: 41 });
		expect(readStart(music(), ' 1-1 ')).toEqual({ kind: 'ok', value: 0 });
		expect(readStart(chant(), '12.3')).toEqual({ kind: 'ok', value: 123 });
		// 負的看得懂（交給指令擋下、說範圍），不說看不懂
		expect(readStart(chant(), '-1')).toEqual({ kind: 'ok', value: -10 });
	});

	it('開始看不懂：擋下來，音樂段給例子，口號段說打秒數', () => {
		const unreadable = { kind: 'blocked', message: '開始看不懂，例：3-5&' };
		expect(readStart(music(), '1-9')).toEqual(unreadable);
		expect(readStart(music(), 'abc')).toEqual(unreadable);
		expect(readStart(music(), '')).toEqual(unreadable);
		expect(readStart(music(), '0-1')).toEqual(unreadable);
		expect(readStart(chant(), 'abc')).toEqual({ kind: 'blocked', message: '開始看不懂，請打秒數' });
		expect(readStart(chant(), '')).toEqual({ kind: 'blocked', message: '開始看不懂，請打秒數' });
	});

	it('全形數字、全形符號當成半形', () => {
		expect(readStart(music(), '３－５＆')).toEqual({ kind: 'ok', value: 41 });
		expect(readStart(chant(), '１２．３')).toEqual({ kind: 'ok', value: 123 });
		expect(readLength(music(), '４．５')).toEqual({ kind: 'ok', value: 9 });
		expect(readLength(chant(), '－２')).toEqual({ kind: 'ok', value: -20 });
		expect(readTime(sample(), 's3', '口號 １ １２．３ 秒', '出發')).toEqual(time('s2', 123));
	});

	it('長度：音樂段用拍（可以半拍），口號段用秒（到 0.1 秒）', () => {
		expect(lengthText(music(), 16)).toBe('8');
		expect(lengthText(music(), 9)).toBe('4.5');
		expect(lengthText(chant(), 30)).toBe('3.0');
		expect(readLength(music(), '4.5')).toEqual({ kind: 'ok', value: 9 });
		expect(readLength(chant(), '2.5')).toEqual({ kind: 'ok', value: 25 });
	});

	it('長度看不懂：擋下來說看不懂', () => {
		const unreadable = { kind: 'blocked', message: '長度看不懂' };
		expect(readLength(chant(), '')).toEqual(unreadable);
		expect(readLength(music(), 'abc')).toEqual(unreadable);
		expect(readLength(music(), '3-5')).toEqual(unreadable);
	});
});

describe('出發和到達的時間文字', () => {
	// sample()：s1 = 音樂 1，s2 = 口號 1，s3 = 音樂 2

	it('在這一段裡只寫段內時間：音樂段八拍-拍，口號段秒數', () => {
		const flow = sample();
		expect(timeText(flow, 's1', { segmentId: 's1', at: 41 })).toBe('3-5&');
		expect(timeText(flow, 's2', { segmentId: 's2', at: 123 })).toBe('12.3');
	});

	it('在別的段前面加段名，跟上方列一樣', () => {
		const flow = sample();
		expect(timeText(flow, 's3', { segmentId: 's2', at: 123 })).toBe('口號 1 12.3');
		expect(timeText(flow, 's2', { segmentId: 's1', at: 41 })).toBe('音樂 1 3-5&');
	});

	it('解析：只有段內時間就是這一段；前面有段名就是那一段', () => {
		const flow = sample();
		expect(readTime(flow, 's1', '2-5', '出發')).toEqual(time('s1', 24));
		expect(readTime(flow, 's2', ' 12.3 ', '到達')).toEqual(time('s2', 123));
		expect(readTime(flow, 's3', '口號 1 12.3', '站位時間')).toEqual(time('s2', 123));
		expect(readTime(flow, 's2', '音樂 1 3-5&', '出發')).toEqual(time('s1', 41));
		expect(readTime(flow, 's2', '音樂 2 1-1', '出發')).toEqual(time('s3', 0));
	});

	it('從上方列抄來的「秒」也看得懂', () => {
		expect(readTime(sample(), 's3', '口號 1 12.3 秒', '出發')).toEqual(time('s2', 123));
	});

	it('看不懂：寫法不對、沒有這一段都擋下來，說是哪一格、給例子', () => {
		const flow = sample();
		const departHint = { kind: 'blocked', message: '出發看不懂，例：2-5（別的段前面加段名，例：口號 1 12.3）' };
		expect(readTime(flow, 's1', '', '出發')).toEqual(departHint);
		expect(readTime(flow, 's1', '12.3', '出發')).toEqual(departHint);
		expect(readTime(flow, 's1', '口號 1 2-5', '出發')).toEqual(departHint);
		expect(readTime(flow, 's1', '口號 9 1.0', '出發')).toEqual(departHint);
		expect(readTime(flow, 's1', '音樂 2-5', '出發')).toEqual(departHint);
	});

	it('出發、到達、站位時間看不懂時用同一個例子', () => {
		const flow = sample();
		expect(readTime(flow, 's1', 'abc', '到達')).toEqual({
			kind: 'blocked',
			message: '到達看不懂，例：2-5（別的段前面加段名，例：口號 1 12.3）'
		});
		expect(readTime(flow, 's1', 'abc', '站位時間')).toEqual({
			kind: 'blocked',
			message: '站位時間看不懂，例：2-5（別的段前面加段名，例：口號 1 12.3）'
		});
	});
});

describe('播放頭吸附、一步一步移', () => {
	it('在八拍尺上點：音樂段吸到最近的整拍，口號段吸到 0.1 秒', () => {
		const flow = sample();
		expect(snapToBeat(flow, 1.15)).toBeCloseTo(1.2);
		expect(snapToBeat(flow, 0.95)).toBeCloseTo(0.8);
		expect(snapToBeat(flow, 30.04)).toBeCloseTo(30.0);
		expect(snapToBeat(flow, 62)).toBeCloseTo(62);
		expect(snapToBeat(flow, 1.05, true)).toBeCloseTo(1.0);
	});

	it('在八拍尺上點：一小段距離內先停到最近的站位，再來才是最近的整拍', () => {
		// 站位 2 在 1-2&（第 3 個半拍，0.6 秒）
		const base = sample();
		const flow = { ...base, formations: [...base.formations, { id: 'f2', segmentId: 's1', at: 3, pos: {} }] };
		expect(snapPlayhead(flow, 0.75, 0.2)).toBeCloseTo(0.6);
		expect(snapPlayhead(flow, 0.75, 0.1)).toBeCloseTo(0.8);
		// 開頭那張也算
		expect(snapPlayhead(flow, 0.15, 0.2)).toBe(0);
		expect(snapPlayhead(flow, 1.05, 0.1, true)).toBeCloseTo(1.0);
	});

	it('沒有段時照原樣', () => {
		expect(snapToBeat(empty(), 3.3)).toBe(3.3);
		expect(stepPlayhead(empty(), 3.3, 1, false)).toBe(3.3);
	});

	it('方向鍵：音樂段一次一拍，從半拍上先對到整拍', () => {
		const flow = sample();
		expect(stepPlayhead(flow, 0.5, 1, false)).toBeCloseTo(0.8);
		expect(stepPlayhead(flow, 0.8, 1, false)).toBeCloseTo(1.2);
		expect(stepPlayhead(flow, 0.8, -1, false)).toBeCloseTo(0.4);
		expect(stepPlayhead(flow, 0.5, -1, false)).toBeCloseTo(0.4);
	});

	it('頭尾停住；跨段時停在段的開頭', () => {
		const flow = sample();
		expect(stepPlayhead(flow, 0, -1, false)).toBe(0);
		expect(stepPlayhead(flow, 62, 1, false)).toBeCloseTo(62);
		expect(stepPlayhead(flow, 25.4, 1, false)).toBeCloseTo(25.6);
		expect(stepPlayhead(flow, 58, -1, false)).toBeCloseTo(57.6);
	});

	it('口號段一次 1 秒；Shift 一次一個八拍（口號段 5 秒）', () => {
		const flow = sample();
		expect(stepPlayhead(flow, 25.6, 1, false)).toBeCloseTo(26.6);
		expect(stepPlayhead(flow, 0.5, 1, true)).toBeCloseTo(3.2);
		expect(stepPlayhead(flow, 3.2, -1, true)).toBeCloseTo(0);
		expect(stepPlayhead(flow, 25.6, 1, true)).toBeCloseTo(30.6);
	});
});
