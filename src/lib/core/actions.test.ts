import { describe, expect, expectTypeOf, it } from 'vitest';
import {
	actionSeconds,
	actionSlotAt,
	addAction,
	addMembers,
	deleteAction,
	idleAt,
	memberActionAt,
	memberGroup,
	moveAction,
	previousActions,
	raisedAt,
	resizeAction,
	updateAction,
	addSegment,
	createFlow,
	updateSegment,
	type Flow,
	type NewActionInput
} from './index';
import { flowOf } from '../test-flows';

/** 音樂 1（150 BPM、2 個八拍 = 32 個半拍）→ 口號 1（10 秒 = 100 個 0.1 秒）；隊員 m1–m3。 */
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
	flow = flowOf(updateSegment(flow, 's1', { eights: 2, lastBeats: 8 }));
	flow = flowOf(addSegment(flow, 'chant'));
	flow = flowOf(updateSegment(flow, 's2', { seconds: 10 }));
	return flow;
}

const lib = (overrides: Partial<NewActionInput> = {}): NewActionInput => ({
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

describe('新增動作', () => {
	it('輸入不收成功率設定（新動作一定沒有環節）；人身上不是別的動作的組不收', () => {
		expectTypeOf<NewActionInput>().not.toHaveProperty('successRate');
		const members = [{ memberId: 'm1', role: null, squad: 'g1' }];
		expect(flowOf(addAction(sample(), lib({ members }))).actions[0].members).toEqual([{ memberId: 'm1', role: null }]);
	});

	it('動作存段 ＋ 段內整數時間、大類、名稱、備註和每人的任務角色', () => {
		const flow = flowOf(addAction(sample(), lib({ name: ' Lib ', start: 3, note: '注意手' })));
		expect(flow.actions).toEqual([
			{
				id: 'x1',
				segmentId: 's1',
				category: 'stunt',
				name: 'Lib',
				start: 3,
				length: 16,
				note: '注意手',
				members: [
					{ memberId: 'm1', role: '上層' },
					{ memberId: 'm2', role: '主底' }
				]
			}
		]);
	});

	it('回傳新動作的 id（畫面用來選它）', () => {
		const flow = flowOf(addAction(sample(), lib()));
		const r = addAction(flow, lib({ start: 16, members: [{ memberId: 'm3', role: null }] }));
		expect(r.kind === 'ok' && r.id).toBe('x2');
	});

	it('動作不能跨段：超出段尾就擋下，剛好到段尾可以', () => {
		const flow = sample();
		expect(addAction(flow, lib({ start: 20, length: 13 }))).toEqual({
			kind: 'blocked',
			message: '動作不能跨段，要跨就拆成兩個'
		});
		expect(addAction(flow, lib({ start: 20, length: 12 })).kind).toBe('ok');
		expect(addAction(flow, lib({ segmentId: 's2', start: 95, length: 6 })).kind).toBe('blocked');
		expect(addAction(flow, lib({ segmentId: 's2', start: 95, length: 5 })).kind).toBe('ok');
	});

	it('同一個隊員同一時間只能在一個動作裡，重疊就擋下', () => {
		const flow = flowOf(addAction(sample(), lib({ start: 0, length: 16 })));
		const jump = (start: number, memberId: string) =>
			lib({ category: 'jump', name: '跳', start, length: 4, members: [{ memberId, role: null }] });
		expect(addAction(flow, jump(14, 'm2'))).toEqual({
			kind: 'blocked',
			message: '小B 同一時間已經在「技巧·Lib」裡'
		});
		// 接在後面、或別人同一時間做別的動作，都可以
		expect(addAction(flow, jump(16, 'm2')).kind).toBe('ok');
		expect(addAction(flow, jump(14, 'm3')).kind).toBe('ok');
		// 不同段的同一個段內時間不算重疊
		expect(addAction(flow, lib({ segmentId: 's2', start: 0, length: 10 })).kind).toBe('ok');
	});

	it('時間重疊列出所有重疊的人，不只第一個', () => {
		let flow = flowOf(addAction(sample(), lib({ start: 0, length: 8, members: [{ memberId: 'm1', role: null }, { memberId: 'm2', role: null }] })));
		flow = flowOf(addAction(flow, lib({ category: 'jump', name: '跳', start: 8, length: 8, members: [{ memberId: 'm3', role: null }] })));
		const everyone = lib({
			category: 'dance',
			name: '舞',
			start: 4,
			length: 8,
			members: ['m1', 'm2', 'm3'].map((memberId) => ({ memberId, role: null }))
		});
		expect(addAction(flow, everyone)).toEqual({
			kind: 'blocked',
			message: '小A、小B 同一時間已經在「技巧·Lib」裡；小C 同一時間已經在「跳躍·跳」裡'
		});
	});

	it.each([
		['沒有人', lib({ members: [] }), '一個動作至少要有 1 個人'],
		['同一個人放兩次', lib({ members: [{ memberId: 'm1', role: null }, { memberId: 'm1', role: '上層' }] }), '同一個人只能放一次'],
		['不在名單上的人', lib({ members: [{ memberId: 'm9', role: null }] }), '找不到這個隊員'],
		['不存在的任務角色', lib({ members: [{ memberId: 'm1', role: '飛人' }] }), '沒有「飛人」這個任務角色'],
		['不存在的段', lib({ segmentId: 's9' }), '找不到這一段'],
		['長度 0', lib({ length: 0 }), '動作長度要在 0.5 到 16 拍之間'],
		['長度是負的', lib({ start: 4, length: -2 }), '動作長度要在 0.5 到 14 拍之間'],
		['開始在段之前', lib({ start: -1 }), '動作的開始不能在段之前'],
		['不在半拍上的時間', lib({ start: 1.5 }), '音樂段的時間要落在半拍上'],
		['大類不在 7 個裡面', lib({ category: 'chant' as never }), '請選大類']
	])('%s就擋下', (_, input, message) => {
		expect(addAction(sample(), input)).toEqual({ kind: 'blocked', message });
	});

	it('口號段的長度單位是 0.1 秒，太短的提示寫 0.1 秒', () => {
		expect(addAction(sample(), lib({ segmentId: 's2', length: 0 }))).toEqual({
			kind: 'blocked',
			message: '動作長度要在 0.1 到 10.0 秒之間'
		});
	});

	it('全局角色和任務角色互不影響：全局底層的人可以當上層，全局上層的人可以當底層', () => {
		const r = addAction(
			sample(),
			lib({
				members: [
					{ memberId: 'm1', role: '底層' },
					{ memberId: 'm2', role: '上層' },
					{ memberId: 'm3', role: '中層' }
				]
			})
		);
		expect(r.kind).toBe('ok');
	});
});

describe('某一刻誰在做什麼、誰閒著', () => {
	/** 音樂 1 一個半拍 0.2 秒：Lib（小A 上層、小B 主底）在 0–3.2 秒；口號 1 從 6.4 秒開始，小C 騰翻在 7.4–8.4 秒。 */
	function busy(): Flow {
		let flow = flowOf(addAction(sample(), lib()));
		flow = flowOf(
			addAction(
				flow,
				lib({
					segmentId: 's2',
					category: 'tumbling',
					name: '',
					start: 10,
					length: 10,
					members: [{ memberId: 'm3', role: null }]
				})
			)
		);
		return flow;
	}

	it('動作的開始和結束秒數', () => {
		const [libAction, tumble] = busy().actions;
		expect(actionSeconds(busy(), libAction)).toEqual({ startSec: 0, endSec: 3.2 });
		const s = actionSeconds(busy(), tumble);
		expect(s.startSec).toBeCloseTo(7.4, 9);
		expect(s.endSec).toBeCloseTo(8.4, 9);
	});

	it('某個人在某一刻的動作和任務角色；動作結束那一刻就不算了', () => {
		const flow = busy();
		expect(memberActionAt(flow, 'm1', 1)).toMatchObject({ action: { id: 'x1' }, role: '上層' });
		expect(memberActionAt(flow, 'm3', 7.4)).toMatchObject({ action: { id: 'x2' }, role: null });
		expect(memberActionAt(flow, 'm1', 3.2)).toBeNull();
		expect(memberActionAt(flow, 'm3', 1)).toBeNull();
	});

	it('某一刻誰閒著（照名單順序）', () => {
		const flow = busy();
		expect(idleAt(flow, 0)).toEqual(['m3']);
		expect(idleAt(flow, 3.19)).toEqual(['m3']);
		expect(idleAt(flow, 3.2)).toEqual(['m1', 'm2', 'm3']);
		expect(idleAt(flow, 8)).toEqual(['m1', 'm2']);
	});

	it('沒有段時大家都閒著', () => {
		let flow = flowOf(createFlow({ name: '空', field: { strips: 9, layout: 'vertical' } }));
		flow = flowOf(addMembers(flow, [{ name: '小A', gender: 'F', globalRole: 'top' }]));
		expect(idleAt(flow, 0)).toEqual(['m1']);
	});

	it('某一刻任務角色是上層或中層的人（畫在最上面），跟全局角色無關', () => {
		let flow = sample();
		flow = flowOf(
			addAction(
				flow,
				lib({
					category: 'pyramid',
					members: [
						{ memberId: 'm1', role: '底層' },
						{ memberId: 'm2', role: '中層' },
						{ memberId: 'm3', role: '上層' }
					]
				})
			)
		);
		expect(raisedAt(flow, 1)).toEqual(['m2', 'm3']);
		expect(raisedAt(flow, 4)).toEqual([]);
	});
});

describe('新動作預設的時間', () => {
	it('從播放頭那一格開始，音樂段一個八拍、口號段 3 秒，不超出段尾', () => {
		const flow = sample();
		expect(actionSlotAt(flow, 1)).toEqual({ segmentId: 's1', start: 5, length: 16 });
		expect(actionSlotAt(flow, 6)).toEqual({ segmentId: 's1', start: 30, length: 2 });
		expect(actionSlotAt(flow, 6.4)).toEqual({ segmentId: 's2', start: 0, length: 30 });
	});

	it('沒有段時是 null', () => {
		const flow = flowOf(createFlow({ name: '空', field: { strips: 9, layout: 'vertical' } }));
		expect(actionSlotAt(flow, 0)).toBeNull();
	});
});

describe('改動作、刪動作', () => {
	it('改動作照新增的規則檢查：改到跟別的動作重疊就擋下', () => {
		let flow = flowOf(addAction(sample(), lib({ start: 0, length: 8 })));
		flow = flowOf(addAction(flow, lib({ name: 'Ext', start: 8, length: 8 })));
		expect(updateAction(flow, 'x2', { start: 6 })).toEqual({
			kind: 'blocked',
			message: '小A、小B 同一時間已經在「技巧·Lib」裡'
		});
		const moved = flowOf(updateAction(flow, 'x2', { start: 10, note: '慢一點' }));
		expect(moved.actions[1]).toMatchObject({ id: 'x2', start: 10, length: 8, note: '慢一點' });
		// 自己跟自己不算重疊
		expect(updateAction(moved, 'x2', { length: 6 }).kind).toBe('ok');
	});

	it('改人和任務角色；改到沒人就擋下', () => {
		const flow = flowOf(addAction(sample(), lib()));
		const r = flowOf(updateAction(flow, 'x1', { members: [{ memberId: 'm3', role: '騰翻' }] }));
		expect(r.actions[0].members).toEqual([{ memberId: 'm3', role: '騰翻' }]);
		expect(updateAction(flow, 'x1', { members: [] })).toEqual({
			kind: 'blocked',
			message: '一個動作至少要有 1 個人'
		});
	});

	it('辨識色：挑了就存；拿掉（空的）就回到用大類的顏色，不留欄位', () => {
		const flow = flowOf(addAction(sample(), lib({ color: '#1565c0' })));
		expect(flow.actions[0].color).toBe('#1565c0');
		const cleared = flowOf(updateAction(flow, 'x1', { color: undefined }));
		expect('color' in cleared.actions[0]).toBe(false);
		const blank = flowOf(addAction(sample(), lib({ color: '' })));
		expect('color' in blank.actions[0]).toBe(false);
	});

	it('刪掉動作', () => {
		const flow = flowOf(addAction(sample(), lib()));
		expect(flowOf(deleteAction(flow, 'x1')).actions).toEqual([]);
		expect(deleteAction(flow, 'x9')).toEqual({ kind: 'blocked', message: '找不到這個動作' });
	});
});

describe('拖色條：移動、改長度', () => {
	it('移到最近的半拍；動作還是在原來那一段', () => {
		const flow = flowOf(addAction(sample(), lib({ start: 0, length: 8 })));
		// 一個半拍 0.2 秒：1.05 秒最近的是第 5 個半拍（1.0 秒）
		const moved = flowOf(moveAction(flow, 'x1', 1.05));
		expect(moved.actions[0]).toMatchObject({ segmentId: 's1', start: 5, length: 8 });
	});

	it('口號段移到最近的 0.1 秒', () => {
		const flow = flowOf(addAction(sample(), lib({ segmentId: 's2', start: 0, length: 30 })));
		// 口號 1 從 6.4 秒開始
		expect(flowOf(moveAction(flow, 'x1', 7.66)).actions[0].start).toBe(13);
	});

	it('拖到段外（跨段、段之前）或撞到同一人就擋下', () => {
		let flow = flowOf(addAction(sample(), lib({ start: 0, length: 8 })));
		flow = flowOf(addAction(flow, lib({ name: 'Ext', start: 16, length: 8 })));
		expect(moveAction(flow, 'x1', 6)).toEqual({
			kind: 'blocked',
			message: '動作不能跨段，要跨就拆成兩個'
		});
		expect(moveAction(flow, 'x1', -0.4)).toEqual({
			kind: 'blocked',
			message: '動作的開始不能在段之前'
		});
		expect(moveAction(flow, 'x1', 2.2)).toEqual({
			kind: 'blocked',
			message: '小A、小B 同一時間已經在「技巧·Ext」裡'
		});
	});

	it('拉右邊改長度：結束吸到最近的半拍；拉到 0 或超出段尾就擋下', () => {
		const flow = flowOf(addAction(sample(), lib({ start: 4, length: 8 })));
		// 開始 0.8 秒；結束拉到 3.25 秒 → 長度 12 個半拍（結束 3.2 秒）
		expect(flowOf(resizeAction(flow, 'x1', 3.25)).actions[0]).toMatchObject({ start: 4, length: 12 });
		expect(resizeAction(flow, 'x1', 0.81)).toEqual({
			kind: 'blocked',
			message: '動作長度要在 0.5 到 14 拍之間'
		});
		expect(resizeAction(flow, 'x1', 7).kind).toBe('blocked');
	});

	it('找不到動作就擋下', () => {
		expect(moveAction(sample(), 'x9', 0)).toEqual({ kind: 'blocked', message: '找不到這個動作' });
		expect(resizeAction(sample(), 'x9', 0)).toEqual({ kind: 'blocked', message: '找不到這個動作' });
	});
});

describe('選人捷徑', () => {
	it('上一個動作：播放頭以前結束的動作，越晚結束越前面；同時結束的，晚開始的在前；還沒做完的不算', () => {
		let flow = flowOf(addAction(sample(), lib({ start: 0, length: 8 }))); // x1 結束 1.6 秒
		flow = flowOf(addAction(flow, lib({ name: 'Ext', start: 8, length: 8 }))); // x2 結束 3.2 秒
		flow = flowOf(
			addAction(flow, lib({ name: '跳', start: 12, length: 4, members: [{ memberId: 'm3', role: null }] }))
		); // x3 也結束 3.2 秒，晚開始
		flow = flowOf(
			addAction(flow, lib({ name: '翻', start: 16, length: 8, members: [{ memberId: 'm3', role: null }] }))
		); // x4 3.2–4.8 秒
		expect(previousActions(flow, 4).map((a) => a.id)).toEqual(['x3', 'x2', 'x1']);
		expect(previousActions(flow, 3.2).map((a) => a.id)).toEqual(['x3', 'x2', 'x1']);
		expect(previousActions(flow, 3.1).map((a) => a.id)).toEqual(['x1']);
		expect(previousActions(flow, 0)).toEqual([]);
	});

	it('全隊、全部底層、全部上層（看全局角色）、這一拍沒在動作裡的人，照名單順序', () => {
		const flow = flowOf(addAction(sample(), lib({ start: 0, length: 8 })));
		expect(memberGroup(flow, 'all', 0)).toEqual(['m1', 'm2', 'm3']);
		expect(memberGroup(flow, 'base', 0)).toEqual(['m2', 'm3']);
		expect(memberGroup(flow, 'top', 0)).toEqual(['m1']);
		expect(memberGroup(flow, 'idle', 0)).toEqual(['m3']);
		expect(memberGroup(flow, 'idle', 2)).toEqual(['m1', 'm2', 'm3']);
	});
});
