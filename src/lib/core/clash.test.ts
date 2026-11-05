import { describe, expect, it } from 'vitest';
import {
	CELL_M,
	addMembers,
	addSegment,
	clashes,
	createFlow,
	insertFormation,
	setPositions,
	type CommandResult,
	type Flow,
	type Position
} from './index';

function okFlow(r: CommandResult): Flow {
	if (r.kind !== 'ok') throw new Error(r.message);
	return r.flow;
}

const A = 'm1';
const B = 'm2';

/** 小A、小B，還沒有段。 */
function twoMembers(): Flow {
	const m = { name: '小A', gender: 'F', globalRole: 'top' } as const;
	const flow = okFlow(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));
	return okFlow(addMembers(flow, [m, { ...m, name: '小B' }]));
}

/**
 * 小A、小B；音樂 1（150 BPM，一個半拍 0.2 秒，25.6 秒）→ 口號 1（10 秒）。
 * 小A 從 [0, 0] 在 16.8–20 秒走到 [4, 0]（每半拍 0.25 公尺），再在 20–30 秒走到 [4, 5]（每秒 0.5 公尺）。
 * 小B 整個流程站在 b。
 */
function passing(b: Position): Flow {
	let flow = twoMembers();
	flow = okFlow(addSegment(flow, 'music'));
	flow = okFlow(addSegment(flow, 'chant'));
	flow = okFlow(setPositions(flow, 'f1', { [A]: [0, 0], [B]: b }));
	flow = okFlow(insertFormation(flow, 20));
	flow = okFlow(setPositions(flow, 'f2', { [A]: [4, 0] }));
	flow = okFlow(insertFormation(flow, 30));
	return okFlow(setPositions(flow, 'f3', { [A]: [4, 5] }));
}

describe('撞位', () => {
	it('走位的人經過站著的人：連續撞到只算一次，時間和位置取最近的那一刻', () => {
		// 小A 在 17.8–19.0 秒（x 1.25 到 2.75）離小B 不到半格，18.4 秒疊在一起。
		const list = clashes(passing([2, 0]));
		expect(list).toHaveLength(1);
		const [c] = list;
		expect(c.memberIds).toEqual([A, B]);
		expect(c.sec).toBeCloseTo(18.4, 9);
		expect(c.startSec).toBeCloseTo(17.8, 9);
		expect(c.endSec).toBeCloseTo(19.0, 9);
		expect(c.pos[0]).toBeCloseTo(2, 9);
		expect(c.pos[1]).toBeCloseTo(0, 9);
		expect(c.formationId).toBe('f2');
	});

	it('靠太近就是中心距離不到半格；半格以上不算', () => {
		expect(CELL_M / 2).toBeCloseTo(0.9144, 4);
		expect(clashes(passing([2, 0.9]))).toHaveLength(1);
		expect(clashes(passing([2, 0.92]))).toHaveLength(0);
	});

	it('兩個人都站著時靠再近也不算：從有人出發後的第一個取樣點才開始算', () => {
		// 小B 站在小A 開頭的位置旁邊；16.8 秒小A 才出發。
		const list = clashes(passing([0.3, 0]));
		expect(list).toHaveLength(1);
		expect(list[0].startSec).toBeCloseTo(17, 9);
	});

	it('音樂段每半拍取樣、口號段每 0.1 秒取樣；跨段連續撞到也只算一次', () => {
		// 小B 在 [4.3, 3]：小A 在 y 2.14 到 3.86（24.27–27.73 秒）都離他不到半格，26 秒最近。
		const list = clashes(passing([4.3, 3]));
		expect(list).toHaveLength(1);
		const [c] = list;
		expect(c.formationId).toBe('f3');
		// 音樂段半拍格子上的第一個：24.4 秒；口號段 0.1 秒格子上的最後一個：27.7 秒。
		expect(c.startSec).toBeCloseTo(24.4, 9);
		expect(c.endSec).toBeCloseTo(27.7, 9);
		expect(c.sec).toBeCloseTo(26, 9);
		expect(c.pos[0]).toBeCloseTo(4.15, 9);
		expect(c.pos[1]).toBeCloseTo(3, 9);
	});

	it('沒有段時沒有撞位', () => {
		expect(clashes(twoMembers())).toEqual([]);
	});
});
