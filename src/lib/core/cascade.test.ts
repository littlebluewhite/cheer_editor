// 段縮短、改 BPM、刪人的連帶處理（規格「刪除要先確認」）。
import { describe, expect, it } from 'vitest';
import {
	actionSeconds,
	addAction,
	addMembers,
	addSegment,
	createFlow,
	deleteFormation,
	deleteMember,
	formationTimes,
	insertFormation,
	setMarkers,
	updateAction,
	updateSegment,
	type Flow,
	type NewActionInput,
	type Walk
} from './index';
import { flowOf, libSample } from '../test-flows';

/**
 * 音樂 1（150 BPM、4 個八拍 = 64 個半拍，一個半拍 0.2 秒）→ 口號 1（10 秒）；隊員小A、小B、小C。
 * 動作：x1 技巧·Lib（音樂 1 1-1 起 8 拍，小A 小B）、x2 跳躍·T（音樂 1 3-1 起 8 拍，小A）。
 * 站位：f1 開頭、f2 在音樂 1 2-1（3.2 秒）、f3 在音樂 1 4-1（9.6 秒）。
 */
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
	flow = flowOf(updateSegment(flow, 's1', { eights: 4, lastBeats: 8 }));
	flow = flowOf(addSegment(flow, 'chant'));
	flow = flowOf(updateSegment(flow, 's2', { seconds: 10 }));
	const action = (o: Partial<NewActionInput>): NewActionInput => ({
		segmentId: 's1',
		category: 'stunt',
		name: 'Lib',
		start: 0,
		length: 16,
		note: '',
		members: [],
		...o
	});
	flow = flowOf(
		addAction(
			flow,
			action({ members: [{ memberId: 'm1', role: '上層' }, { memberId: 'm2', role: '底層' }] })
		)
	);
	flow = flowOf(
		addAction(
			flow,
			action({ category: 'jump', name: 'T', start: 32, members: [{ memberId: 'm1', role: null }] })
		)
	);
	flow = flowOf(insertFormation(flow, 3.2));
	flow = flowOf(insertFormation(flow, 9.6));
	return flow;
}

/** sample() 再幫小A、小B 在 f2、f3 設出發和到達。 */
function withWalks(): Flow {
	const walk = (depart: number, arrive: number): Walk => ({
		depart: { segmentId: 's1', at: depart },
		arrive: { segmentId: 's1', at: arrive }
	});
	const flow = sample();
	return {
		...flow,
		formations: flow.formations.map((f) =>
			f.id === 'f2'
				? { ...f, walks: { m1: walk(2, 8), m2: walk(4, 10) } }
				: f.id === 'f3'
					? { ...f, walks: { m1: walk(20, 30) } }
					: f
		)
	};
}

describe('改 BPM', () => {
	it('動作和站位的拍不變，秒數重算', () => {
		const before = sample();
		const after = flowOf(updateSegment(before, 's1', { bpm: 120 }));
		expect(after.actions).toEqual(before.actions);
		expect(after.formations).toEqual(before.formations);
		// 120 BPM：一個半拍 0.25 秒。x2 從第 32 個半拍開始、長 16 個半拍。
		expect(actionSeconds(after, after.actions[1])).toEqual({ startSec: 8, endSec: 12 });
		expect(formationTimes(after).map((t) => t.sec)).toEqual([0, 4, 12]);
	});
});

describe('段縮短', () => {
	it('有動作或站位放不進段裡：回「要確認」並列出清單，流程不變', () => {
		const flow = sample();
		const before = structuredClone(flow);
		// 3 個八拍又 4 拍 = 56 個半拍：x2（32–48）和 f3（48）都放得下
		expect(updateSegment(flow, 's1', { eights: 4, lastBeats: 4 }).kind).toBe('ok');
		// 2 個八拍又 4 拍 = 40 個半拍：x2 跨出段尾，f3 在段外
		expect(updateSegment(flow, 's1', { eights: 3, lastBeats: 4 })).toEqual({
			kind: 'confirm',
			message: '音樂 1 縮短後，下面這些放不進段裡，確定就刪掉',
			items: ['動作「跳躍·T」（3-1 起）', '站位 3（4-1）']
		});
		expect(flow).toEqual(before);
	});

	it('帶「已確認」再送一次：段縮短，放不進的動作和站位刪掉，其他不動', () => {
		const after = flowOf(
			updateSegment(sample(), 's1', { eights: 3, lastBeats: 4 }, { confirmed: true })
		);
		expect(after.segments[0]).toMatchObject({ halfBeats: 40 });
		expect(after.actions.map((a) => a.id)).toEqual(['x1']);
		expect(after.formations.map((f) => f.id)).toEqual(['f1', 'f2']);
	});

	it('連帶刪掉的站位，出發和到達設定跟著一起刪', () => {
		const after = flowOf(
			updateSegment(withWalks(), 's1', { eights: 3, lastBeats: 4 }, { confirmed: true })
		);
		expect(after.formations.map((f) => [f.id, Object.keys(f.walks ?? {})])).toEqual([
			['f1', []],
			['f2', ['m1', 'm2']]
		]);
	});

	it('剛好在段尾結束的動作放得下；段尾那一刻的站位已經是下一段，放不下', () => {
		// 3 個八拍 = 48 個半拍：x2（32–48）剛好結束在段尾，f3（48）落在段外
		expect(updateSegment(sample(), 's1', { eights: 3, lastBeats: 8 })).toMatchObject({
			kind: 'confirm',
			items: ['站位 3（4-1）']
		});
	});

	it('口號段縮短也一樣，時間寫秒數', () => {
		// 口號 1 從 12.8 秒開始；在它的第 7 秒插一張站位
		const flow = flowOf(insertFormation(sample(), 12.8 + 7));
		expect(updateSegment(flow, 's2', { seconds: 5 })).toMatchObject({
			kind: 'confirm',
			message: '口號 1 縮短後，下面這些放不進段裡，確定就刪掉',
			items: ['站位 4（7.0）']
		});
		const after = flowOf(updateSegment(flow, 's2', { seconds: 5 }, { confirmed: true }));
		expect(after.formations.map((f) => f.id)).toEqual(['f1', 'f2', 'f3']);
	});
});

describe('刪隊員', () => {
	it('先回「要確認」：寫名字、標記、全局角色，他在 N 個動作裡，其中 M 個會被整個刪掉；流程不變', () => {
		const flow = sample();
		const before = structuredClone(flow);
		// 小A 在 x1（和小B）和 x2（只有他）裡
		expect(deleteMember(flow, 'm1')).toEqual({
			kind: 'confirm',
			message:
				'刪掉隊員「小A」（標記 1、上層）：他在 2 個動作裡，其中 1 個會被整個刪掉，「技巧·Lib」會沒有上層；後面 2 個人的號碼會往前遞補',
			items: ['動作「技巧·Lib」（音樂 1 1-1 起）：他是上層', '動作「跳躍·T」（音樂 1 3-1 起）：只有他，會整個刪掉']
		});
		expect(flow).toEqual(before);
	});

	it('不在動作裡的人也要先確認，不寫「0 個動作裡，其中 0 個」', () => {
		expect(deleteMember(sample(), 'm3')).toEqual({
			kind: 'confirm',
			message: '刪掉隊員「小C」（標記 3、底層）：他不在任何動作裡',
			items: []
		});
	});

	it('帶「已確認」再送一次：從名單、每張站位、每個動作拿掉；沒人剩下的動作刪掉', () => {
		const after = flowOf(deleteMember(sample(), 'm1', { confirmed: true }));
		expect(after.members.map((m) => m.name)).toEqual(['小B', '小C']);
		for (const f of after.formations) expect(Object.keys(f.pos)).toEqual(['m2', 'm3']);
		expect(after.actions).toEqual([
			expect.objectContaining({ id: 'x1', members: [{ memberId: 'm2', role: '底層' }] })
		]);
	});

	it('每張站位裡他的出發和到達設定一起清掉', () => {
		const after = flowOf(deleteMember(withWalks(), 'm1', { confirmed: true }));
		expect(after.formations.map((f) => f.walks)).toEqual([
			undefined,
			{ m2: { depart: { segmentId: 's1', at: 4 }, arrive: { segmentId: 's1', at: 10 } } },
			undefined
		]);
	});

	it('標記用開頭字時寫開頭字', () => {
		const flow = flowOf(setMarkers(sample(), 'initial'));
		expect(deleteMember(flow, 'm3')).toMatchObject({ message: '刪掉隊員「小C」（標記 小C、底層）：他不在任何動作裡' });
	});

	it('留下來的動作裡沒有別人是他的任務角色：寫那個動作會沒有那個角色；還有別人是就不寫', () => {
		expect(deleteMember(sample(), 'm1')).toMatchObject({ message: expect.stringContaining('，「技巧·Lib」會沒有上層；') });
		expect(deleteMember(sample(), 'm2')).toMatchObject({ message: expect.stringContaining('，「技巧·Lib」會沒有底層；') });
		const twoTops = flowOf(
			updateAction(sample(), 'x1', {
				members: [
					{ memberId: 'm1', role: '上層' },
					{ memberId: 'm2', role: '底層' },
					{ memberId: 'm3', role: '上層' }
				]
			})
		);
		expect(deleteMember(twoTops, 'm1')).toMatchObject({ message: expect.not.stringContaining('會沒有') });
	});

	it('分組的動作：看他那一組，寫第幾組會沒有那個角色', () => {
		expect(deleteMember(libSample(), 'm1')).toMatchObject({
			message: '刪掉隊員「小美」（標記 1、上層）：他在 1 個動作裡，「技巧·Lib」第 1 組會沒有上層；後面 3 個人的號碼會往前遞補',
			items: ['動作「技巧·Lib」（音樂 1 1-1 起）：他是第 1 組的上層']
		});
	});

	it('號碼遞補：他是最後一個就不寫；標記用開頭字也不寫', () => {
		expect(deleteMember(sample(), 'm3')).toMatchObject({ message: expect.not.stringContaining('遞補') });
		expect(deleteMember(flowOf(setMarkers(sample(), 'initial')), 'm1')).toMatchObject({
			message: expect.not.stringContaining('遞補')
		});
	});

	it('在動作裡但沒有動作會被整個刪掉：不寫「其中 0 個」', () => {
		expect(deleteMember(sample(), 'm2')).toMatchObject({
			message: '刪掉隊員「小B」（標記 2、底層）：他在 1 個動作裡，「技巧·Lib」會沒有底層；後面 1 個人的號碼會往前遞補'
		});
	});

	it('找不到這個隊員就擋下', () => {
		expect(deleteMember(sample(), 'm9')).toEqual({ kind: 'blocked', message: '找不到這個隊員' });
	});
});

describe('刪站位', () => {
	it('它的出發和到達設定一起刪；後面那張的設定留著', () => {
		const flow = withWalks();
		const after = flowOf(deleteFormation(flow, 'f2'));
		expect(after.formations.map((f) => f.id)).toEqual(['f1', 'f3']);
		expect(after.formations[1].walks).toEqual(flow.formations[2].walks);
	});
});
