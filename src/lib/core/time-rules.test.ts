import { describe, expect, it } from 'vitest';
import {
	addSegment,
	createFlow,
	timeRuleWarnings,
	updateSegment,
	updateTimeRules,
	type Flow
} from './index';
import { flowOf } from '../test-flows';

/** 一個 120 BPM 的音樂段（beats 拍）加一個口號段（chantSec 秒）。 */
function routine(beats: number, chantSec: number): Flow {
	let flow = flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));
	flow = flowOf(addSegment(flow, 'music'));
	flow = flowOf(addSegment(flow, 'chant'));
	const eights = Math.ceil(beats / 8);
	flow = flowOf(updateSegment(flow, 's1', { bpm: 120, eights, lastBeats: beats - (eights - 1) * 8 }));
	return flowOf(updateSegment(flow, 's2', { seconds: chantSec }));
}

describe('時間規則警告', () => {
	it('都在規則內就沒有警告（剛好 120 秒、30 秒不算超過）', () => {
		// 240 拍 ÷ 2 拍/秒 = 120 秒
		expect(timeRuleWarnings(routine(240, 30))).toEqual([]);
	});

	it('口號段加起來少於 30 秒', () => {
		expect(timeRuleWarnings(routine(200, 20))).toEqual(['口號段共 20.0 秒，少於 30 秒']);
	});

	it('音樂段加起來超過 120 秒', () => {
		expect(timeRuleWarnings(routine(260, 32.4))).toEqual(['音樂段共 130.0 秒，超過 120 秒']);
	});

	it('整支流程超過 180 秒', () => {
		expect(timeRuleWarnings(routine(240, 70))).toEqual(['整支流程共 190.0 秒，超過 180 秒']);
	});

	it('三條可以同時出現', () => {
		const flow = flowOf(updateTimeRules(routine(260, 20), { maxTotalSec: 100 }));
		expect(timeRuleWarnings(flow)).toEqual([
			'口號段共 20.0 秒，少於 30 秒',
			'音樂段共 130.0 秒，超過 120 秒',
			'整支流程共 150.0 秒，超過 100 秒'
		]);
	});

	it('關掉就沒有警告', () => {
		const flow = flowOf(updateTimeRules(routine(260, 20), { on: false }));
		expect(timeRuleWarnings(flow)).toEqual([]);
	});

	it('改數字後照新的數字算', () => {
		const flow = flowOf(updateTimeRules(routine(260, 20), { minChantSec: 15, maxMusicSec: 150 }));
		expect(timeRuleWarnings(flow)).toEqual([]);
		expect(flow.timeRules).toEqual({ on: true, minChantSec: 15, maxMusicSec: 150, maxTotalSec: 180 });
	});

	it('數字不能是負的或不是數字', () => {
		const flow = routine(240, 30);
		for (const bad of [-1, Number.NaN]) {
			expect(updateTimeRules(flow, { maxMusicSec: bad })).toEqual({
				kind: 'blocked',
				message: '秒數要是 0 以上的數字'
			});
		}
	});
});
