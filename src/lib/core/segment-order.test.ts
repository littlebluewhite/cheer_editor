import { describe, expect, it } from 'vitest';
import {
	addAction,
	addMembers,
	addSegment,
	createFlow,
	deleteSegment,
	moveSegment,
	readFlowFile,
	updateSegment,
	writeFlowFile,
	type Flow,
	type Formation
} from './index';
import { flowOf } from '../test-flows';

/**
 * 音樂 1（s1，150 BPM、2 個八拍 = 6.4 秒）→ 口號 1（s2，5 秒）。小A（m1）。
 * 站位：f1 開頭 [0,0]、f2 在 s1 的 2-1（3.2 秒）[1,0]、f3 在 s2 的 2.0 秒 [1,0]（跟 f2 一樣，不走位）。
 * 動作：x1 在 s1（技巧·Lib），x2 在 s2（舞蹈·喊）。
 */
function sample(): Flow {
	let flow = flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));
	flow = flowOf(addMembers(flow, [{ name: '小A', gender: 'F', globalRole: 'top' }]));
	flow = flowOf(addSegment(flow, 'music'));
	flow = flowOf(addSegment(flow, 'chant'));
	flow = flowOf(updateSegment(flow, 's1', { eights: 2, lastBeats: 8 }));
	flow = flowOf(updateSegment(flow, 's2', { seconds: 5 }));
	const formations: Formation[] = [
		{ id: 'f1', segmentId: 's1', at: 0, pos: { m1: [0, 0] } },
		{ id: 'f2', segmentId: 's1', at: 16, pos: { m1: [1, 0] } },
		{ id: 'f3', segmentId: 's2', at: 20, pos: { m1: [1, 0] } }
	];
	flow = { ...flow, formations };
	const base = { start: 0, length: 4, note: '', members: [{ memberId: 'm1', role: null }] };
	flow = flowOf(addAction(flow, { ...base, segmentId: 's1', category: 'stunt', name: 'Lib' }));
	return flowOf(addAction(flow, { ...base, segmentId: 's2', category: 'dance', name: '喊' }));
}

const where = (flow: Flow) => flow.formations.map((f) => `${f.id}@${f.segmentId}:${f.at}`);

describe('刪段', () => {
	it('段裡有動作、站位時先問，列出會一起刪掉的', () => {
		expect(deleteSegment(sample(), 's2')).toEqual({
			kind: 'confirm',
			message: '刪掉口號 1，下面這些也會一起刪掉',
			items: ['動作「舞蹈·喊」（0.0 起）', '站位 3（2.0）']
		});
	});

	it('確定後段、段裡的動作和站位都拿掉', () => {
		const flow = flowOf(deleteSegment(sample(), 's2', { confirmed: true }));
		expect(flow.segments.map((s) => s.id)).toEqual(['s1']);
		expect(flow.actions.map((a) => a.id)).toEqual(['x1']);
		expect(where(flow)).toEqual(['f1@s1:0', 'f2@s1:16']);
	});

	it('空的段直接刪（可以復原，不用問）', () => {
		let flow = flowOf(addSegment(sample(), 'music'));
		flow = flowOf(deleteSegment(flow, 's3'));
		expect(flow.segments.map((s) => s.id)).toEqual(['s1', 's2']);
	});

	it('刪第一段：開頭那張站位跟著新的第一段，位置是新第一段開始那一刻大家所在的地方', () => {
		const r = deleteSegment(sample(), 's1');
		expect(r.kind).toBe('confirm');
		const flow = flowOf(deleteSegment(sample(), 's1', { confirmed: true }));
		expect(flow.segments.map((s) => s.id)).toEqual(['s2']);
		expect(where(flow)).toEqual(['f1@s2:0', 'f3@s2:20']);
		expect(flow.formations[0].pos).toEqual({ m1: [1, 0] });
	});

	it('刪掉唯一的段：回到沒有段，開頭那張留著', () => {
		let flow = flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));
		flow = flowOf(addSegment(flow, 'music'));
		flow = flowOf(deleteSegment(flow, 's1'));
		expect(flow.segments).toEqual([]);
		expect(flow.formations).toEqual([{ id: 'f1', segmentId: null, at: 0, pos: {} }]);
	});

	it('別的站位的走位指到刪掉的段，那個設定拿掉（回到預設）', () => {
		let flow = sample();
		const walk = { depart: { segmentId: 's1', at: 24 }, arrive: { segmentId: 's2', at: 10 } };
		flow = { ...flow, formations: flow.formations.with(2, { ...flow.formations[2], walks: { m1: walk } }) };
		flow = flowOf(deleteSegment(flow, 's1', { confirmed: true }));
		expect(flow.formations.find((f) => f.id === 'f3')!.walks).toBeUndefined();
	});

	it('找不到段就擋下', () => {
		expect(deleteSegment(sample(), 's9').kind).toBe('blocked');
	});
});

describe('調段順序', () => {
	it('往前移：段換位置，動作、站位跟著自己的段走；開頭那張變成一般站位留在原本那段的開頭', () => {
		const flow = flowOf(moveSegment(sample(), 's2', -1));
		expect(flow.segments.map((s) => s.id)).toEqual(['s2', 's1']);
		// 新的開頭（f4）是口號 1 開始那一刻大家所在的位置
		expect(where(flow)).toEqual(['f4@s2:0', 'f3@s2:20', 'f1@s1:0', 'f2@s1:16']);
		expect(flow.formations[0].pos).toEqual({ m1: [1, 0] });
		expect(flow.actions.map((a) => a.segmentId)).toEqual(['s1', 's2']);
	});

	it('新的第一段開頭本來就有站位：那張變成開頭（拿掉走位設定）', () => {
		let flow = sample();
		const f4: Formation = { id: 'f4', segmentId: 's2', at: 0, pos: { m1: [2, 2] }, walks: {
			m1: { depart: { segmentId: 's1', at: 20 }, arrive: { segmentId: 's1', at: 30 } }
		} };
		flow = { ...flow, formations: [...flow.formations.slice(0, 2), f4, flow.formations[2]] };
		flow = flowOf(moveSegment(flow, 's2', -1));
		expect(where(flow)).toEqual(['f4@s2:0', 'f3@s2:20', 'f1@s1:0', 'f2@s1:16']);
		expect(flow.formations[0]).toEqual({ id: 'f4', segmentId: 's2', at: 0, pos: { m1: [2, 2] } });
	});

	it('第一段不能再往前、最後一段不能再往後', () => {
		expect(moveSegment(sample(), 's1', -1)).toEqual({ kind: 'blocked', message: '已經是第一段了' });
		expect(moveSegment(sample(), 's2', 1)).toEqual({ kind: 'blocked', message: '已經是最後一段了' });
	});

	it('換過順序、刪過段的流程存成流程檔再打開，內容一樣', () => {
		let flow = flowOf(moveSegment(sample(), 's2', -1));
		flow = flowOf(deleteSegment(flow, 's1', { confirmed: true }));
		const r = readFlowFile(writeFlowFile(flow, {}));
		expect(r.kind).toBe('ok');
		if (r.kind === 'ok') expect(r.flow).toEqual(flow);
	});

	it('移回來：段的順序、動作都回到原本的樣子', () => {
		const there = flowOf(moveSegment(sample(), 's2', -1));
		const back = flowOf(moveSegment(there, 's2', 1));
		expect(back.segments.map((s) => s.id)).toEqual(['s1', 's2']);
		expect(back.formations[0].segmentId).toBe('s1');
		expect(back.formations[0].at).toBe(0);
	});
});
