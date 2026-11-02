import { describe, expect, it } from 'vitest';
import {
	addSegment,
	createFlow,
	firstBeatPreview,
	loadSegmentAudio,
	playbackPlan,
	updateSegment,
	type CommandResult,
	type Flow
} from './index';

function flowOf(r: CommandResult): Flow {
	if (r.kind !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(r)}`);
	return r.flow;
}

/**
 * 音樂 1（a1，150 BPM、第一拍 0.42 秒、1 個八拍 = 3.2 秒）→ 口號 2 秒 →
 * 音樂 2（a2，120 BPM、第一拍 1 秒、最後一個八拍 3 拍 = 1.5 秒）。
 */
function sample(): Flow {
	let flow = flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));
	flow = flowOf(addSegment(flow, 'music'));
	flow = flowOf(addSegment(flow, 'chant'));
	flow = flowOf(addSegment(flow, 'music'));
	flow = flowOf(loadSegmentAudio(flow, 's1', 'one.mp3'));
	flow = flowOf(loadSegmentAudio(flow, 's3', 'two.mp3'));
	flow = flowOf(updateSegment(flow, 's1', { firstBeatSec: 0.42, eights: 1, lastBeats: 8 }));
	flow = flowOf(updateSegment(flow, 's2', { seconds: 2 }));
	flow = flowOf(updateSegment(flow, 's3', { bpm: 120, firstBeatSec: 1, eights: 1, lastBeats: 3 }));
	return flow;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

describe('從某一刻播放', () => {
	it('從頭播：每個音樂段從第一拍開始播；口號段沒有音樂，下一個音樂段排在口號之後', () => {
		const plan = playbackPlan(sample(), 0);
		expect(plan.clips.map((c) => ({ ...c, sec: round(c.sec), durationSec: round(c.durationSec) }))).toEqual([
			{ audioId: 'a1', sec: 0, fileSec: 0.42, durationSec: 3.2 },
			{ audioId: 'a2', sec: 5.2, fileSec: 1, durationSec: 1.5 }
		]);
		expect(plan.endSec).toBeCloseTo(6.7, 9);
	});

	it('從段中間播：那一段從對應的音樂位置接著播，已經過去的段不播', () => {
		const plan = playbackPlan(sample(), 5.7);
		expect(plan.clips).toHaveLength(1);
		expect(plan.clips[0].audioId).toBe('a2');
		expect(plan.clips[0].sec).toBeCloseTo(5.7, 9);
		expect(plan.clips[0].fileSec).toBeCloseTo(1.5, 9);
		expect(plan.clips[0].durationSec).toBeCloseTo(1, 9);
	});

	it('節拍器：音樂段每拍一聲，八拍的第一拍加重；口號段不響', () => {
		const plan = playbackPlan(sample(), 0);
		const clicks = plan.clicks.map((c) => [round(c.sec), c.accent]);
		expect(clicks).toEqual([
			[0, true],
			[0.4, false],
			[0.8, false],
			[1.2, false],
			[1.6, false],
			[2, false],
			[2.4, false],
			[2.8, false],
			[5.2, true],
			[5.7, false],
			[6.2, false]
		]);
	});

	it('節拍器從播放的那一刻之後才響', () => {
		const plan = playbackPlan(sample(), 2.5);
		expect(plan.clicks.map((c) => round(c.sec))).toEqual([2.8, 5.2, 5.7, 6.2]);
	});

	it('還沒載入音樂檔的音樂段只有節拍器', () => {
		let flow = flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));
		flow = flowOf(addSegment(flow, 'music'));
		const plan = playbackPlan(flow, 0);
		expect(plan.clips).toEqual([]);
		expect(plan.clicks).toHaveLength(64);
		expect(plan.endSec).toBeCloseTo(25.6, 9);
	});
});

describe('從第一拍聽 2 個八拍', () => {
	it('從第一拍播 16 拍的音樂，加 16 拍節拍器', () => {
		const plan = firstBeatPreview(sample(), 's3');
		expect(plan.clips).toEqual([{ audioId: 'a2', sec: 0, fileSec: 1, durationSec: 8 }]);
		expect(plan.clicks).toHaveLength(16);
		expect(plan.clicks.filter((c) => c.accent).map((c) => c.sec)).toEqual([0, 4]);
		expect(plan.clicks[1].sec).toBeCloseTo(0.5, 9);
		expect(plan.endSec).toBe(8);
	});
});
