import { describe, expect, it } from 'vitest';
import {
	addAction,
	addMembers,
	addSegment,
	createFlow,
	eightCountRows,
	insertFormation,
	setPositions,
	updateSegment,
	type CommandResult,
	type Flow,
	type NewActionInput
} from './index';

function flowOf(r: CommandResult): Flow {
	if (r.kind !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(r)}`);
	return r.flow;
}

/** 音樂 1（150 BPM，一個八拍 3.2 秒；2 個整八拍 ＋ 4 拍）→ 口號 1（10 秒）；隊員 小A、小B、小C。 */
function sample(): Flow {
	let flow = flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));
	flow = flowOf(
		addMembers(flow, [
			{ name: '小A', gender: 'F', globalRole: 'top' },
			{ name: '小B', gender: 'M', globalRole: 'base' },
			{ name: '小C', gender: 'M', globalRole: 'base' }
		])
	);
	flow = flowOf(addSegment(flow, 'music'));
	flow = flowOf(updateSegment(flow, 's1', { eights: 3, lastBeats: 4 }));
	flow = flowOf(addSegment(flow, 'chant'));
	flow = flowOf(updateSegment(flow, 's2', { seconds: 10 }));
	return flow;
}

const action = (overrides: Partial<NewActionInput>): NewActionInput => ({
	segmentId: 's1',
	category: 'stunt',
	name: 'Lib',
	start: 0,
	length: 16,
	note: '',
	members: [
		{ memberId: 'm1', role: '上層' },
		{ memberId: 'm2', role: '主底' }
	],
	...overrides
});

describe('八拍表的列：全隊', () => {
	it('音樂段一個八拍一列，寫段、第幾個八拍、開始秒數；最後不滿一個八拍也算一列', () => {
		const rows = eightCountRows(sample(), null).filter((r) => r.segmentLabel === '音樂 1');
		expect(rows.map((r) => [r.segmentLabel, r.eight, r.startSec])).toEqual([
			['音樂 1', 1, 0],
			['音樂 1', 2, expect.closeTo(3.2, 6)],
			['音樂 1', 3, expect.closeTo(6.4, 6)]
		]);
	});

	it('每列寫這個八拍開始的動作：大類、名稱、人和任務角色', () => {
		let flow = sample();
		flow = flowOf(addAction(flow, action({ length: 40 })));
		flow = flowOf(
			addAction(flow, action({ category: 'jump', name: '', start: 16, length: 4, members: [{ memberId: 'm3', role: null }] }))
		);
		const [first, second, third] = eightCountRows(flow, null);
		expect(first.actions).toEqual([
			{
				at: '1',
				category: 'stunt',
				categoryLabel: '技巧',
				name: 'Lib',
				members: [
					{ memberId: 'm1', name: '小A', role: '上層' },
					{ memberId: 'm2', name: '小B', role: '主底' }
				]
			}
		]);
		expect(second.actions).toEqual([
			{
				at: '1',
				category: 'jump',
				categoryLabel: '跳躍',
				name: '',
				members: [{ memberId: 'm3', name: '小C', role: null }]
			}
		]);
		// 動作只寫在開始的那一列，後面延續的八拍不重複寫
		expect(third.actions).toEqual([]);
	});

	it('從半拍開始的動作寫「3 的 &」', () => {
		// 第 2 個八拍的第 3 拍後半拍：(8 + 2) × 2 + 1 = 21 個半拍
		const flow = flowOf(addAction(sample(), action({ start: 21, length: 2 })));
		const rows = eightCountRows(flow, null);
		expect(rows[1].actions.map((a) => a.at)).toEqual(['3 的 &']);
	});

	it('口號段整段一列，寫秒數；口號段的動作寫段內秒數', () => {
		const flow = flowOf(
			addAction(sample(), action({ segmentId: 's2', category: 'other', name: '口號', start: 23, length: 20 }))
		);
		const chant = eightCountRows(flow, null).filter((r) => r.segmentLabel === '口號 1');
		expect(chant).toHaveLength(1);
		expect(chant[0]).toMatchObject({ eight: null, startSec: expect.closeTo(8, 6), durationSec: expect.closeTo(10, 6) });
		expect(chant[0].actions.map((a) => a.at)).toEqual(['2.3 秒']);
	});
});

describe('八拍表的列：一個隊員', () => {
	it('只列他參加的動作，人只寫他自己和他的任務角色；每個八拍的列照樣都有', () => {
		let flow = sample();
		flow = flowOf(addAction(flow, action({ length: 8 })));
		flow = flowOf(
			addAction(flow, action({ category: 'toss', name: '拋', start: 16, members: [{ memberId: 'm3', role: '後保' }] }))
		);
		const all = eightCountRows(flow, null);
		const mine = eightCountRows(flow, 'm2');
		expect(mine.map((r) => [r.segmentLabel, r.eight])).toEqual(all.map((r) => [r.segmentLabel, r.eight]));
		expect(mine[0].actions).toEqual([
			{
				at: '1',
				category: 'stunt',
				categoryLabel: '技巧',
				name: 'Lib',
				members: [{ memberId: 'm2', name: '小B', role: '主底' }]
			}
		]);
		expect(mine[1].actions).toEqual([]);
		expect(eightCountRows(flow, 'm3')[1].actions.map((a) => a.members)).toEqual([
			[{ memberId: 'm3', name: '小C', role: '後保' }]
		]);
	});
});

describe('八拍表的列：站位', () => {
	it('有站位開始的列附站位（第幾張、在哪一拍、每個人的位置）；其他列沒有', () => {
		let flow = sample();
		// 第 2 個八拍的第 5 拍（3.2 + 4 × 0.4 = 4.8 秒）和口號段 2.5 秒（8 + 2.5 秒）插站位
		flow = flowOf(insertFormation(flow, 4.8));
		flow = flowOf(setPositions(flow, flow.formations[1].id, { m1: [1, 2] }));
		flow = flowOf(insertFormation(flow, 10.5));
		const rows = eightCountRows(flow, null);
		expect(rows.map((r) => r.formations.map((f) => [f.number, f.at]))).toEqual([
			[[1, '1']],
			[[2, '5']],
			[],
			[[3, '2.5 秒']]
		]);
		expect(rows[1].formations[0].pos.m1).toEqual([1, 2]);
	});
});

describe('八拍表的列：走位', () => {
	it('一個隊員每走位一次，在出發那一拍所在的列寫「出發 → 站位 N（幾拍到）」；全隊和沒動的人不寫', () => {
		let flow = sample();
		// 第 3 個八拍開頭（6.4 秒）插站位 2，小A 換位置；預設往前一個八拍出發（2-1）
		flow = flowOf(insertFormation(flow, 6.4));
		flow = flowOf(setPositions(flow, flow.formations[1].id, { m1: [1, 2] }));
		expect(eightCountRows(flow, 'm1').map((r) => r.walks)).toEqual([
			[],
			['2-1 出發 → 站位 2（3-1 到）'],
			[],
			[]
		]);
		expect(eightCountRows(flow, 'm2').map((r) => r.walks)).toEqual([[], [], [], []]);
		expect(eightCountRows(flow, null).map((r) => r.walks)).toEqual([[], [], [], []]);
	});

	it('到達在別的段時，時間前面加段名；口號段寫秒', () => {
		let flow = sample();
		flow = flowOf(insertFormation(flow, 6.4));
		// 口號段 2.5 秒插站位 3，小A 換位置；B 在口號段就整段走（從站位 2 出發）
		flow = flowOf(insertFormation(flow, 10.5));
		flow = flowOf(setPositions(flow, flow.formations[2].id, { m1: [1, 2] }));
		expect(eightCountRows(flow, 'm1').map((r) => r.walks)).toEqual([
			[],
			[],
			['3-1 出發 → 站位 3（口號 1 2.5 秒 到）'],
			[]
		]);
	});

	it('同一列也有他的動作時，動作和走位都寫', () => {
		let flow = sample();
		flow = flowOf(addAction(flow, action({ start: 16, length: 8 })));
		flow = flowOf(insertFormation(flow, 6.4));
		flow = flowOf(setPositions(flow, flow.formations[1].id, { m1: [1, 2] }));
		const row = eightCountRows(flow, 'm1')[1];
		expect(row.actions.map((a) => a.name)).toEqual(['Lib']);
		expect(row.walks).toEqual(['2-1 出發 → 站位 2（3-1 到）']);
	});
});
