import { describe, expect, it } from 'vitest';
import {
	addAction,
	addMembers,
	addSegment,
	createFlow,
	clearCues,
	moveAction,
	MOTION_WORDS,
	placeCue,
	STEP_WORDS,
	updateAction,
	updateSegment,
	usedWords,
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

describe('步驟和手位', () => {
	const step = (at: number, len: number, word: string): Cue => ({ kind: 'step', at, len, word, who: null });
	const motion = (at: number, word: string): Cue => ({ kind: 'motion', at, len: 2, word, who: null });

	it('步驟放滿選到的拍；手位放一拍；跟拍子各放各的', () => {
		let flow = flowOf(placeCue(sample(), 'x1', { kind: 'count', at: 0, len: 8, word: 'down' }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'step', at: 0, len: 8, word: '下手' }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'motion', at: 4, len: 2, word: ' high V ' }));
		expect(cuesOf(flow)).toEqual([count(0, 8, 'down'), step(0, 8, '下手'), motion(4, 'high V')]);
	});

	it.each([
		['步驟是空白', { kind: 'step' as const, at: 0, len: 2, word: '  ' }, '請寫拍點的字'],
		['手位是空的', { kind: 'motion' as const, at: 0, len: 2, word: '' }, '請寫拍點的字'],
		['手位佔兩拍', { kind: 'motion' as const, at: 0, len: 4, word: 'T' }, '手位只佔一拍']
	])('不合規則被擋（%s）', (_, input, message) => {
		expect(placeCue(sample(), 'x1', input)).toEqual({ kind: 'blocked', message });
	});

	it('清掉步驟不動拍子和手位', () => {
		let flow = flowOf(placeCue(sample(), 'x1', { kind: 'count', at: 0, len: 4, word: 'down' }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'step', at: 0, len: 4, word: '落地' }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'motion', at: 0, len: 2, word: 'T' }));
		flow = flowOf(clearCues(flow, 'x1', 'step', 0, 8));
		expect(cuesOf(flow)).toEqual([count(0, 4, 'down'), motion(0, 'T')]);
	});
});

describe('這支流程用過的字', () => {
	it('內建的步驟和手位', () => {
		expect(STEP_WORDS).toEqual(['下手', '落地', '放']);
		expect(MOTION_WORDS).toEqual(['high V', 'low V', 'T', 'touchdown', 'K', 'L', 'diagonal']);
	});

	it('步驟、手位各一份，扣掉內建的字，不重複', () => {
		const member = [{ memberId: 'm1', role: null }];
		let flow = flowOf(
			addAction(sample(), { category: 'stunt', name: 'B', note: '', segmentId: 's1', start: 16, length: 8, members: member })
		);
		const placed: [string, 'step' | 'motion', number, string][] = [
			['x1', 'step', 0, '下手'],
			['x1', 'step', 2, '抬腳'],
			['x1', 'motion', 0, 'high V'],
			['x1', 'motion', 2, '拳頭'],
			['x3', 'step', 0, '抬腳'],
			['x3', 'step', 2, '轉身'],
			['x3', 'motion', 0, '拳頭']
		];
		for (const [id, kind, at, word] of placed) flow = flowOf(placeCue(flow, id, { kind, at, len: 2, word }));
		expect(usedWords(flow)).toEqual({ step: ['抬腳', '轉身'], motion: ['拳頭'] });
	});

	it('沒有拍點就都是空的', () => {
		expect(usedWords(sample())).toEqual({ step: [], motion: [] });
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
