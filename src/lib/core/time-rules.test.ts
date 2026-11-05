import { describe, expect, it } from 'vitest';
import {
	addSegment,
	createFlow,
	DEFAULT_TIME_RULES,
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
		expect(timeRuleWarnings(routine(200, 20))).toEqual([{ title: '口號段太短', text: '口號段共 20.0 秒，少於 30 秒' }]);
	});

	it('音樂段加起來超過 120 秒', () => {
		expect(timeRuleWarnings(routine(260, 32.4))).toEqual([
			{ title: '音樂段太長', text: '音樂段共 130.0 秒，超過 120 秒' }
		]);
	});

	it('整支流程超過 180 秒', () => {
		expect(timeRuleWarnings(routine(240, 70))).toEqual([
			{ title: '整支流程太長', text: '整支流程共 190.0 秒，超過 180 秒' }
		]);
	});

	it('三條可以同時出現，每條有自己的標題', () => {
		const flow = flowOf(updateTimeRules(routine(260, 20), { maxMusicSec: 100, maxTotalSec: 100 }));
		expect(timeRuleWarnings(flow)).toEqual([
			{ title: '口號段太短', text: '口號段共 20.0 秒，少於 30 秒' },
			{ title: '音樂段太長', text: '音樂段共 130.0 秒，超過 100 秒' },
			{ title: '整支流程太長', text: '整支流程共 150.0 秒，超過 100 秒' }
		]);
	});

	it('還沒有任何段時不警告（剛建好的流程不要一打開就黃字）', () => {
		const flow = flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));
		expect(timeRuleWarnings(flow)).toEqual([]);
	});

	it('只有音樂段、沒有口號段：照樣提醒，但寫法中性（不說「少於」）', () => {
		const flow = flowOf(addSegment(flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } })), 'music'));
		expect(timeRuleWarnings(flow)).toEqual([{ title: '還沒有口號段', text: '口號段加起來最少要 30 秒' }]);
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

	it('數字要大於 0（0、負的、不是數字都擋）', () => {
		const flow = routine(240, 30);
		for (const key of ['minChantSec', 'maxMusicSec', 'maxTotalSec'] as const) {
			for (const bad of [0, -1, Number.NaN]) {
				expect(updateTimeRules(flow, { [key]: bad })).toEqual({ kind: 'blocked', message: '秒數要大於 0' });
			}
		}
	});

	it('口號段加起來最少要比整支流程最多少（不然一定有警告）', () => {
		const flow = routine(240, 30);
		const message = '「口號段加起來最少」要比「整支流程最多」少';
		expect(updateTimeRules(flow, { minChantSec: 180 })).toEqual({ kind: 'blocked', message });
		expect(updateTimeRules(flow, { minChantSec: 200 })).toEqual({ kind: 'blocked', message });
		expect(updateTimeRules(flow, { maxMusicSec: 20, maxTotalSec: 30 })).toEqual({ kind: 'blocked', message });
	});

	it('音樂段加起來最多不能超過整支流程最多', () => {
		const flow = routine(240, 30);
		const message = '「音樂段加起來最多」不能超過「整支流程最多」';
		expect(updateTimeRules(flow, { maxMusicSec: 181 })).toEqual({ kind: 'blocked', message });
		expect(updateTimeRules(flow, { maxTotalSec: 119 })).toEqual({ kind: 'blocked', message });
		expect(updateTimeRules(flow, { maxMusicSec: 180 }).kind).toBe('ok');
	});

	it('舊檔存著 0 的那一格照留：改開關、改別格不會被它擋', () => {
		const old = { ...routine(240, 30), timeRules: { on: true, minChantSec: 0, maxMusicSec: 120, maxTotalSec: 180 } };
		expect(updateTimeRules(old, { on: false }).kind).toBe('ok');
		expect(updateTimeRules(old, { maxMusicSec: 150 }).kind).toBe('ok');
	});

	it('恢復預設：開關和三個數字都回到預設', () => {
		const changed = flowOf(updateTimeRules(routine(240, 30), { on: false, minChantSec: 10, maxMusicSec: 90 }));
		expect(flowOf(updateTimeRules(changed, DEFAULT_TIME_RULES)).timeRules).toEqual(DEFAULT_TIME_RULES);
	});
});
