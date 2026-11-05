import { describe, expect, it } from 'vitest';
import {
	CELL_M,
	addAction,
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

/** 在音樂 1 從第 start 個半拍開始、長 length 個半拍，加一個 memberIds 參加的動作。 */
function withAction(
	flow: Flow,
	memberIds: string[],
	start: number,
	length: number,
	category: 'tumbling' | 'dance' = 'tumbling'
): Flow {
	return okFlow(
		addAction(flow, {
			segmentId: 's1',
			category,
			name: '',
			start,
			length,
			note: '',
			members: memberIds.map((memberId) => ({ memberId, role: null }))
		})
	);
}

/** 小A 走位的那 16 個半拍（16.8–20 秒）整段是騰翻。 */
function tumbling(flow: Flow, memberIds = [A]): Flow {
	return withAction(flow, memberIds, 84, 16);
}

/** passing 再讓小B 在 16.8–20 秒從 [2, -2] 走到 [2, 2]：18.4 秒兩人都在 [2, 0]。 */
function crossing(): Flow {
	let flow = passing([2, -2]);
	return okFlow(setPositions(flow, 'f2', { [B]: [2, 2] }));
}

describe('撞位', () => {
	it('兩個人一般走位交錯：靠再近也不算撞位', () => {
		expect(clashes(crossing())).toEqual([]);
		expect(clashes(passing([2, 0]))).toEqual([]);
	});

	it('騰翻中走位的人經過站著的人：連續撞到只算一次，時間和位置取最近的那一刻', () => {
		// 小A 在 17.8–19.0 秒（x 1.25 到 2.75）離小B 不到半格，18.4 秒疊在一起。
		const list = clashes(tumbling(passing([2, 0])));
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

	it('騰翻中走位的人經過一般走位的人、另一個騰翻中走位的人：都算撞位', () => {
		for (const flow of [tumbling(crossing()), tumbling(crossing(), [A, B])]) {
			const list = clashes(flow);
			expect(list).toHaveLength(1);
			expect(list[0].memberIds).toEqual([A, B]);
			expect(list[0].sec).toBeCloseTo(18.4, 9);
		}
		// 小B 自己騰翻、小A 一般走位也算。
		expect(clashes(tumbling(crossing(), [B]))).toHaveLength(1);
	});

	it('靠太近就是中心距離不到半格；剛好半格不算', () => {
		expect(CELL_M / 2).toBeCloseTo(0.9144, 4);
		expect(clashes(tumbling(passing([2, 0.9])))).toHaveLength(1);
		expect(clashes(tumbling(passing([2, CELL_M / 2])))).toHaveLength(0);
	});

	it('在騰翻動作時間外走位不算；騰翻動作裡的走位才算', () => {
		// 騰翻在 0–0.8 秒，小A 16.8 秒才出發。
		expect(clashes(withAction(passing([2, 0]), [A], 0, 4))).toEqual([]);
		// 不是騰翻的動作不算。
		expect(clashes(withAction(passing([2, 0]), [A], 84, 16, 'dance'))).toEqual([]);
		// 騰翻從 18.4 秒才開始：從那一刻才算。
		const list = clashes(withAction(passing([2, 0]), [A], 92, 8));
		expect(list).toHaveLength(1);
		expect(list[0].startSec).toBeCloseTo(18.4, 9);
		// 騰翻在 18.4 秒結束：結束那一刻起不算。
		const early = clashes(withAction(passing([2, 0]), [A], 84, 8));
		expect(early).toHaveLength(1);
		expect(early[0].endSec).toBeCloseTo(18.2, 9);
	});

	it('原地騰翻（沒有移動）不算：騰翻的人站著、別人一般走位經過', () => {
		// 小B 在 [2, 0] 原地騰翻，小A 一般走位經過他。
		expect(clashes(withAction(passing([2, 0]), [B], 84, 16))).toEqual([]);
	});

	it('助跑：騰翻動作開始、還沒翻的那幾拍撞到人也算', () => {
		// 騰翻動作 16.8 秒開始、長 8 拍；小A 前 1.6 秒在助跑時就撞到小B。
		const list = clashes(withAction(passing([2, 0]), [A], 84, 32));
		expect(list).toHaveLength(1);
		expect(list[0].startSec).toBeCloseTo(17.8, 9);
	});

	it('兩個人都站著時靠再近也不算：從有人出發後的第一個取樣點才開始算', () => {
		// 小B 站在小A 開頭的位置旁邊；16.8 秒小A 才出發。
		const list = clashes(tumbling(passing([0.3, 0])));
		expect(list).toHaveLength(1);
		expect(list[0].startSec).toBeCloseTo(17, 9);
	});

	it('口號段每 0.1 秒取樣', () => {
		// 小B 在 [4.3, 3]：小A 在 y 2.14 到 3.86（24.27–27.73 秒）都離他不到半格；騰翻放在口號段整段。
		let flow = passing([4.3, 3]);
		flow = okFlow(
			addAction(flow, { segmentId: 's2', category: 'tumbling', name: '', start: 0, length: 100, note: '', members: [{ memberId: A, role: null }] })
		);
		const list = clashes(flow);
		expect(list).toHaveLength(1);
		const [c] = list;
		expect(c.formationId).toBe('f3');
		// 口號段 25.6 秒開始；0.1 秒格子上的最後一個：27.7 秒；26 秒最近。
		expect(c.startSec).toBeCloseTo(25.6, 9);
		expect(c.endSec).toBeCloseTo(27.7, 9);
		expect(c.sec).toBeCloseTo(26, 9);
		expect(c.pos[0]).toBeCloseTo(4.15, 9);
		expect(c.pos[1]).toBeCloseTo(3, 9);
	});

	it('沒有段時沒有撞位', () => {
		expect(clashes(twoMembers())).toEqual([]);
	});
});
