import { describe, expect, it } from 'vitest';
import {
	addAction,
	addMembers,
	addSegment,
	createFlow,
	eightCountRows,
	clearPhaseBeats,
	markPhaseBeats,
	insertFormation,
	placeCue,
	renameFormation,
	setPositions,
	updateAction,
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

	it('站位有名稱就帶上', () => {
		let flow = flowOf(insertFormation(sample(), 4.8));
		flow = flowOf(renameFormation(flow, flow.formations[1].id, '金字塔'));
		const rows = eightCountRows(flow, null);
		expect(rows[1].formations[0].name).toBe('金字塔');
		expect(rows[0].formations[0].name).toBeUndefined();
	});
});

describe('八拍表的列：走位', () => {
	it('一個隊員每走位一次，在出發那一拍所在的列寫「出發 → 站位 N（幾拍到達）」；全隊和沒動的人不寫', () => {
		let flow = sample();
		// 第 3 個八拍開頭（6.4 秒）插站位 2，小A 換位置；預設往前一個八拍出發（2-1）
		flow = flowOf(insertFormation(flow, 6.4));
		flow = flowOf(setPositions(flow, flow.formations[1].id, { m1: [1, 2] }));
		expect(eightCountRows(flow, 'm1').map((r) => r.walks)).toEqual([
			[],
			['2-1 出發 → 站位 2（3-1 到達）'],
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
			['3-1 出發 → 站位 3（口號 1 2.5 秒 到達）'],
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
		expect(row.walks).toEqual(['2-1 出發 → 站位 2（3-1 到達）']);
	});
});

describe('八拍表的列：拍點', () => {
	/** 第 2 個八拍的 Cradle（小A 上層、小B 主底）：2-5 下手、2-6 down、2-7 up、2-8 上層 high V。 */
	function cradle(): Flow {
		let flow = flowOf(addAction(sample(), action({ name: 'Cradle', start: 16, length: 16 })));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'step', at: 8, len: 2, word: '下手' }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'count', at: 10, len: 2, word: 'down' }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'count', at: 12, len: 2, word: 'up' }));
		return flowOf(placeCue(flow, 'x1', { kind: 'motion', at: 14, len: 2, word: 'high V', who: { role: '上層' } }));
	}

	it('有拍點的動作在它那一列多一排：動作名字，每個拍點寫第幾格到第幾格、字和給誰', () => {
		const rows = eightCountRows(cradle(), null);
		expect(rows[1].cues).toEqual([
			{
				categoryLabel: '技巧',
				name: 'Cradle',
				cues: [
					{ kind: 'step', from: 5, to: 5, word: '下手', who: null },
					{ kind: 'count', from: 6, to: 6, word: 'down', who: null },
					{ kind: 'count', from: 7, to: 7, word: 'up', who: null },
					{ kind: 'motion', from: 8, to: 8, word: 'high V', who: '上層' }
				],
				phases: []
			}
		]);
		expect(rows[0].cues).toEqual([]);
	});

	it('跨到下一列的拍點，兩列各畫自己那一段，字兩列都寫', () => {
		// 1-5 開始的動作，down 從 1-7 佔 4 拍到 2-2
		let flow = flowOf(addAction(sample(), action({ start: 8, length: 16 })));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'count', at: 4, len: 8, word: 'down' }));
		const rows = eightCountRows(flow, null);
		expect(rows[0].cues[0].cues).toEqual([{ kind: 'count', from: 7, to: 8, word: 'down', who: null }]);
		expect(rows[1].cues).toEqual([
			{ categoryLabel: '技巧', name: 'Lib', cues: [{ kind: 'count', from: 1, to: 2, word: 'down', who: null }], phases: [] }
		]);
		// 動作名字還是只在開始那一列的動作欄
		expect(rows[1].actions).toEqual([]);
	});

	it('動作被拖半拍、拍點落在 & 上時，碰到的格子都算', () => {
		let flow = flowOf(addAction(sample(), action({ start: 0, length: 16 })));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'step', at: 2, len: 4, word: '下手' }));
		flow = { ...flow, actions: flow.actions.map((a) => ({ ...a, start: 1 })) };
		// 下手從 2 的 & 到 4 的 &
		expect(eightCountRows(flow, null)[0].cues[0].cues).toEqual([
			{ kind: 'step', from: 2, to: 4, word: '下手', who: null }
		]);
	});

	it('全隊表給隊員的寫他的名字；個人表只列給他的拍點，不寫給誰', () => {
		let flow = cradle();
		flow = flowOf(placeCue(flow, 'x1', { kind: 'step', at: 0, len: 2, word: '放', who: { member: 'm2' } }));
		expect(eightCountRows(flow, null)[1].cues[0].cues.map((c) => [c.word, c.who])).toEqual([
			['放', '小B'],
			['下手', null],
			['down', null],
			['up', null],
			['high V', '上層']
		]);
		const words = (memberId: string) =>
			eightCountRows(flow, memberId)[1].cues.flatMap((l) => l.cues.map((c) => [c.word, c.who]));
		expect(words('m1')).toEqual([
			['下手', null],
			['down', null],
			['up', null],
			['high V', null]
		]);
		expect(words('m2')).toEqual([
			['放', null],
			['下手', null],
			['down', null],
			['up', null]
		]);
		// 不在動作裡的人沒有這一排
		expect(eightCountRows(flow, 'm3')[1].cues).toEqual([]);
	});

	it('沒有拍點的動作不多一排，列跟原本一樣', () => {
		const flow = flowOf(addAction(sample(), action({ start: 16, length: 8 })));
		expect(eightCountRows(flow, null).map((r) => r.cues)).toEqual([[], [], [], []]);
		expect(eightCountRows(flow, 'm1').map((r) => r.cues)).toEqual([[], [], [], []]);
	});
});

describe('八拍表的列：環節', () => {
	/**
	 * 1-5 開始的 Lib（小A 上層、小B 主底，到 2-4），環節：
	 * p1 上法「延伸」1-5 到 1-6、p2 中段 1-7 到 2-2（跨列）、p3 下法（標了 2-3 到 2-4 再清掉，沒標拍）。1-8 有一個 down。
	 */
	function phased(): Flow {
		let flow = flowOf(addAction(sample(), action({ start: 8, length: 16 })));
		flow = flowOf(markPhaseBeats(flow, 'x1', { kind: 'load', name: '延伸' }, 0, 4));
		flow = flowOf(markPhaseBeats(flow, 'x1', { kind: 'hold', name: '' }, 4, 8));
		flow = flowOf(markPhaseBeats(flow, 'x1', { kind: 'dismount', name: '' }, 12, 4));
		flow = flowOf(clearPhaseBeats(flow, 'x1', 12, 16));
		return flowOf(placeCue(flow, 'x1', { kind: 'count', at: 6, len: 2, word: 'down' }));
	}

	it('有標拍環節的動作，那一排多寫環節：種類和名字、第幾格到第幾格、顏色', () => {
		const [first] = eightCountRows(phased(), null);
		expect(first.cues).toEqual([
			{
				categoryLabel: '技巧',
				name: 'Lib',
				cues: [{ kind: 'count', from: 8, to: 8, word: 'down', who: null }],
				phases: [
					{ label: '上法 延伸', from: 5, to: 6, color: '#00796b' },
					{ label: '中段', from: 7, to: 8, color: '#475569' }
				]
			}
		]);
	});

	it('跨到下一列的環節兩列各畫自己那一段，名字兩列都寫；那一列沒拍點也有這一排', () => {
		const second = eightCountRows(phased(), null)[1];
		expect(second.cues).toEqual([
			{
				categoryLabel: '技巧',
				name: 'Lib',
				cues: [],
				phases: [{ label: '中段', from: 1, to: 2, color: '#475569' }]
			}
		]);
	});

	it('動作拖到半拍上：相鄰的環節各佔自己的格子，不疊在一起', () => {
		let flow = flowOf(addAction(sample(), action({ start: 8, length: 16 })));
		flow = flowOf(markPhaseBeats(flow, 'x1', { kind: 'load', name: '' }, 0, 2));
		flow = flowOf(markPhaseBeats(flow, 'x1', { kind: 'hold', name: '' }, 2, 2));
		flow = flowOf(updateAction(flow, 'x1', { start: 9 }));
		const [first] = eightCountRows(flow, null);
		expect(first.cues[0].phases.map((p) => [p.from, p.to])).toEqual([
			[6, 6],
			[7, 7]
		]);
	});

	it('沒標拍的環節不印；只有沒標拍的環節、也沒拍點的動作不多一排', () => {
		const rows = eightCountRows(phased(), null);
		expect(rows.flatMap((r) => r.cues.flatMap((l) => l.phases.map((p) => p.label)))).not.toContain('下法');
		let flow = flowOf(addAction(sample(), action({ start: 16, length: 8 })));
		flow = flowOf(markPhaseBeats(flow, 'x1', { kind: 'load', name: '' }, 0, 8));
		flow = flowOf(clearPhaseBeats(flow, 'x1', 0, 8));
		expect(eightCountRows(flow, null).map((r) => r.cues)).toEqual([[], [], [], []]);
	});

	it('個人表也印環節（環節不分給誰）；不在動作裡的人沒有', () => {
		const labels = (memberId: string) =>
			eightCountRows(phased(), memberId).map((r) => r.cues.flatMap((l) => l.phases.map((p) => p.label)));
		expect(labels('m2')).toEqual([['上法 延伸', '中段'], ['中段'], [], []]);
		expect(labels('m3')).toEqual([[], [], [], []]);
	});
});
