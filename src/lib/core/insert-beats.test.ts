import { describe, expect, it } from 'vitest';
import {
	addAction,
	addMembers,
	addSegment,
	createFlow,
	insertBeats,
	insertFormation,
	setWalks,
	toSeconds,
	updateSegment,
	type Flow,
	type NewActionInput
} from './index';
import { flowOf } from '../test-flows';

/** 150 BPM：一個半拍 0.2 秒。 */
const HALF = 0.2;

/**
 * 音樂 1（150 BPM、8 個八拍 = 128 個半拍）→ 口號 1（10 秒）；隊員 m1、m2。
 * 站位：開頭、2-1（f2）、5-1（f3）、6-1（f4，m1 自己設走位 5-5 出發、6-1 到達）、口號 1 的 2 秒（f5）。
 * 動作：x1 1-1 起 1 個八拍；x2 5-1 起 1 個八拍，拍點在第 3 拍；x3 7-1 起 1 個八拍。
 */
function sample(): Flow {
	let flow = flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));
	flow = flowOf(
		addMembers(flow, [
			{ name: '小A', gender: 'F', globalRole: 'top' },
			{ name: '小B', gender: 'M', globalRole: 'base' }
		])
	);
	flow = flowOf(addSegment(flow, 'music'));
	flow = flowOf(updateSegment(flow, 's1', { eights: 8, lastBeats: 8 }));
	flow = flowOf(addSegment(flow, 'chant'));
	flow = flowOf(updateSegment(flow, 's2', { seconds: 10 }));
	for (const at of [16, 64, 80]) flow = flowOf(insertFormation(flow, at * HALF));
	flow = flowOf(insertFormation(flow, 128 * HALF + 2));
	flow = flowOf(
		setWalks(flow, 'f4', { m1: { depart: { segmentId: 's1', at: 72 }, arrive: { segmentId: 's1', at: 80 } } })
	);
	const action = (start: number, cues: NewActionInput['cues'] = []): NewActionInput => ({
		segmentId: 's1',
		category: 'stunt',
		name: `x${start}`,
		start,
		length: 16,
		note: '',
		members: [{ memberId: 'm1', role: null }],
		cues
	});
	flow = flowOf(addAction(flow, action(0)));
	flow = flowOf(addAction(flow, action(64, [{ kind: 'step', at: 4, len: 2, word: '上', who: null }])));
	flow = flowOf(addAction(flow, action(96)));
	return flow;
}

const at = (segmentId: string, at: number) => ({ segmentId, at });

describe('插入八拍', () => {
	it('在 5-1 插入 1 個八拍：5-1 以後的站位、動作、拍點、出發和到達都晚 8 拍；之前的、別段的不變', () => {
		const before = sample();
		const after = flowOf(insertBeats(before, at('s1', 64), 16));
		expect(after.formations.map((f) => [f.segmentId, f.at])).toEqual([
			['s1', 0],
			['s1', 16],
			['s1', 80],
			['s1', 96],
			['s2', 20]
		]);
		expect(after.formations[3].walks).toEqual({ m1: { depart: at('s1', 88), arrive: at('s1', 96) } });
		expect(after.actions.map((a) => a.start)).toEqual([0, 80, 112]);
		// 拍點記在動作裡、從動作開始算，跟著動作走，秒數也晚 8 拍
		expect(after.actions[1].cues).toEqual(before.actions[1].cues);
		const x2 = after.actions[1];
		expect(toSeconds(after, at('s1', x2.start + x2.cues![0].at)) - toSeconds(before, at('s1', 68))).toBeCloseTo(16 * HALF);
		expect(after.segments).toEqual(before.segments);
	});

	it('插入的那一拍以前開始、跨過去的動作不動；出發在那之前的走位只晚到達', () => {
		const before = sample();
		const after = flowOf(insertBeats(before, at('s1', 76), 4));
		expect(after.actions.map((a) => a.start)).toEqual([0, 64, 100]);
		expect(after.formations[3].walks).toEqual({ m1: { depart: at('s1', 72), arrive: at('s1', 84) } });
	});

	it('在第一段的開頭插：開頭那張站位不動', () => {
		const after = flowOf(insertBeats(sample(), at('s1', 0), 2));
		expect(after.formations.map((f) => f.at)).toEqual([0, 18, 66, 82, 20]);
		expect(after.actions.map((a) => a.start)).toEqual([2, 66, 98]);
	});

	it('後面的東西會超過段尾：擋下，說是哪個放不下', () => {
		const flow = sample();
		// 7-1 起的動作到 8-8& 結束，段尾後面只剩 1 個八拍
		expect(insertBeats(flow, at('s1', 64), 32)).toEqual({
			kind: 'blocked',
			message: '「技巧·x96」會超過這段的結尾，最多插 8 拍'
		});
		// 站位 3、4 都放不下，說卡最緊的那張
		const noActions = { ...flow, actions: flow.actions.slice(0, 1) };
		expect(insertBeats(noActions, at('s1', 64), 64)).toEqual({
			kind: 'blocked',
			message: '站位 4 會超過這段的結尾，最多插 23.5 拍'
		});
	});

	it('口號段：最多插幾秒', () => {
		const flow = sample();
		expect(insertBeats(flow, at('s2', 0), 80)).toEqual({
			kind: 'blocked',
			message: '站位 5 會超過這段的結尾，最多插 7.9 秒'
		});
		expect(flowOf(insertBeats(flow, at('s2', 0), 79)).formations[4].at).toBe(99);
	});

	it('插 0 拍、不在段的格子上、找不到段：擋下', () => {
		const flow = sample();
		expect(insertBeats(flow, at('s1', 64), 0).kind).toBe('blocked');
		expect(insertBeats(flow, at('s1', 128), 16).kind).toBe('blocked');
		expect(insertBeats(flow, at('nope', 0), 16).kind).toBe('blocked');
	});
});
