import { describe, expect, it } from 'vitest';
import {
	addAction,
	addMembers,
	addSegment,
	createFlow,
	clearCues,
	moveAction,
	placeCue,
	updateAction,
	updateSegment,
	type CommandResult,
	type Cue,
	type Flow
} from './index';

function flowOf(r: CommandResult): Flow {
	if (r.kind !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(r)}`);
	return r.flow;
}

/** 音樂 1（2 個八拍）→ 口號 1。x1：音樂 1 的 1-3 開始、4 拍（半拍 4–12）；x2：口號 1 裡。 */
function sample(): Flow {
	let flow = flowOf(createFlow({ name: '測試', field: { strips: 5, layout: 'vertical' } }));
	flow = flowOf(
		addMembers(flow, [
			{ name: '小A', gender: 'F', globalRole: 'top' },
			{ name: '小B', gender: 'M', globalRole: 'base' }
		])
	);
	flow = flowOf(addSegment(flow, 'music'));
	flow = flowOf(updateSegment(flow, 's1', { eights: 2, lastBeats: 8 }));
	flow = flowOf(addSegment(flow, 'chant'));
	const members = [
		{ memberId: 'm1', role: '上層' },
		{ memberId: 'm2', role: '底層' }
	];
	const base = { category: 'stunt' as const, name: 'Lib', note: '', members };
	flow = flowOf(addAction(flow, { ...base, segmentId: 's1', start: 4, length: 8 }));
	return flowOf(addAction(flow, { ...base, segmentId: 's2', start: 0, length: 30 }));
}

const cuesOf = (flow: Flow, id = 'x1') => flow.actions.find((a) => a.id === id)!.cues ?? [];
const count = (at: number, len: number, word: string): Cue => ({ kind: 'count', at, len, word, who: null });

describe('放拍點', () => {
	it('down 2 拍、up 1 拍：拍子放滿選到的拍', () => {
		let flow = flowOf(placeCue(sample(), 'x1', { kind: 'count', at: 0, len: 4, word: 'down' }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'count', at: 4, len: 2, word: 'up' }));
		expect(cuesOf(flow)).toEqual([count(0, 4, 'down'), count(4, 2, 'up')]);
	});

	it('字去掉頭尾空白；同一種被新的蓋到時，舊的切短', () => {
		let flow = flowOf(placeCue(sample(), 'x1', { kind: 'count', at: 0, len: 8, word: 'down' }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'count', at: 4, len: 4, word: ' up ' }));
		expect(cuesOf(flow)).toEqual([count(0, 4, 'down'), count(4, 4, 'up')]);
	});

	it('從中間切開：兩邊露出來的都留著', () => {
		let flow = flowOf(placeCue(sample(), 'x1', { kind: 'count', at: 0, len: 8, word: 'down' }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'count', at: 2, len: 2, word: 'up' }));
		expect(cuesOf(flow)).toEqual([count(0, 2, 'down'), count(2, 2, 'up'), count(4, 4, 'down')]);
	});

	it('整個被蓋到的舊拍點拿掉', () => {
		let flow = flowOf(placeCue(sample(), 'x1', { kind: 'count', at: 2, len: 2, word: 'down' }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'count', at: 0, len: 6, word: 'up' }));
		expect(cuesOf(flow)).toEqual([count(0, 6, 'up')]);
	});

	it.each([
		['超出動作', { at: 6, len: 4, word: 'down' }, '拍點要在動作裡面'],
		['在動作之前', { at: -2, len: 2, word: 'down' }, '拍點要在動作裡面'],
		['不到一拍', { at: 0, len: 1, word: 'down' }, '拍點要佔整數拍，至少 1 拍'],
		['不是整數拍', { at: 0, len: 3, word: 'down' }, '拍點要佔整數拍，至少 1 拍'],
		['拍子用別的字', { at: 0, len: 2, word: 'ready' }, '拍子只能是 down 或 up'],
		['不在整拍上', { at: 1, len: 2, word: 'down' }, '拍點要放在整拍上']
	])('不合規則被擋（%s）', (_, input, message) => {
		expect(placeCue(sample(), 'x1', { kind: 'count', ...input })).toEqual({ kind: 'blocked', message });
	});

	it('口號段的動作不能放', () => {
		expect(placeCue(sample(), 'x2', { kind: 'count', at: 0, len: 2, word: 'down' })).toEqual({
			kind: 'blocked',
			message: '口號段不數拍，不能放拍點'
		});
	});
});

describe('清拍點', () => {
	it('只清那一段裡的拍子，露在外面的留著', () => {
		let flow = flowOf(placeCue(sample(), 'x1', { kind: 'count', at: 0, len: 4, word: 'down' }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'count', at: 4, len: 4, word: 'up' }));
		flow = flowOf(clearCues(flow, 'x1', 'count', 2, 6));
		expect(cuesOf(flow)).toEqual([count(0, 2, 'down'), count(6, 2, 'up')]);
	});
});

describe('拍點跟著動作', () => {
	const withDownUp = () => {
		const flow = flowOf(placeCue(sample(), 'x1', { kind: 'count', at: 0, len: 4, word: 'down' }));
		return flowOf(placeCue(flow, 'x1', { kind: 'count', at: 4, len: 2, word: 'up' }));
	};

	it('拖動作（含拖半拍）：拍點從動作開始算，所以跟著走', () => {
		// 150 BPM：一個半拍 0.2 秒；拖到段內第 5 個半拍（1-3&）。
		const flow = flowOf(moveAction(withDownUp(), 'x1', 1));
		expect(flow.actions[0].start).toBe(5);
		expect(cuesOf(flow)).toEqual([count(0, 4, 'down'), count(4, 2, 'up')]);
	});

	it('改動作的其他欄位，拍點還在', () => {
		const flow = flowOf(updateAction(withDownUp(), 'x1', { name: 'Cradle' }));
		expect(cuesOf(flow)).toEqual([count(0, 4, 'down'), count(4, 2, 'up')]);
	});

	it('動作變短、會切到拍點：先擋下來（之後的單改成先問）', () => {
		expect(updateAction(withDownUp(), 'x1', { length: 4 })).toEqual({
			kind: 'blocked',
			message: '拍點要在動作裡面'
		});
	});

	it('有拍點的動作不能換到口號段', () => {
		expect(updateAction(withDownUp(), 'x1', { segmentId: 's2', start: 40 })).toEqual({
			kind: 'blocked',
			message: '口號段不數拍，不能放拍點'
		});
	});
});
