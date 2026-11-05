import { describe, expect, it } from 'vitest';
import {
	actionEights,
	addAction,
	addMembers,
	addPhase,
	addSegment,
	createFlow,
	placeCue,
	updateSegment,
	type Flow
} from './index';
import { flowOf } from '../test-flows';

/** 音樂 1（4 個八拍）；x1 是從 start 開始、length 個半拍的技巧，小A 上層、小B 主底。 */
function withAction(start: number, length: number): Flow {
	let flow = flowOf(createFlow({ name: '測試', field: { strips: 9, layout: 'vertical' } }));
	flow = flowOf(
		addMembers(flow, [
			{ name: '小A', gender: 'F', globalRole: 'top' },
			{ name: '小B', gender: 'M', globalRole: 'base' }
		])
	);
	flow = flowOf(addSegment(flow, 'music'));
	flow = flowOf(updateSegment(flow, 's1', { eights: 4, lastBeats: 8 }));
	const members = [
		{ memberId: 'm1', role: '上層' },
		{ memberId: 'm2', role: '主底' }
	];
	return flowOf(addAction(flow, { segmentId: 's1', category: 'stunt', name: 'Lib', start, length, note: '', members }));
}

describe('切進每個八拍', () => {
	it('動作碰到的每個八拍各一個（段內第幾個，從 0 起）；拍點寫從那個八拍開頭算第幾個半拍到第幾個半拍', () => {
		// 1-5 到 2-4 的動作，down 在 1-7
		const flow = flowOf(placeCue(withAction(8, 16), 'x1', { kind: 'count', at: 4, len: 2, word: 'down' }));
		const [down] = flow.actions[0].cues!;
		expect(actionEights(flow.actions[0])).toEqual([
			{ eight: 0, cues: [{ cue: down, start: 12, end: 14, first: true, last: true, track: 0 }], phases: [] },
			{ eight: 1, cues: [], phases: [] }
		]);
	});

	it('跨八拍的拍點兩個八拍各拿自己那一段；剛好在八拍結尾結束的不接到下一個八拍', () => {
		// 1-5 到 3-4 的動作：down 從 1-7 佔 4 拍到 2-2；up 從 2-7 佔 2 拍，剛好到 2-8 結束
		let flow = flowOf(placeCue(withAction(8, 32), 'x1', { kind: 'count', at: 4, len: 8, word: 'down' }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'count', at: 20, len: 4, word: 'up' }));
		const [down, up] = flow.actions[0].cues!;
		expect(actionEights(flow.actions[0])).toEqual([
			{ eight: 0, cues: [{ cue: down, start: 12, end: 16, first: true, last: false, track: 0 }], phases: [] },
			{
				eight: 1,
				cues: [
					{ cue: down, start: 0, end: 4, first: false, last: true, track: 0 },
					{ cue: up, start: 12, end: 16, first: true, last: true, track: 0 }
				],
				phases: []
			},
			{ eight: 2, cues: [], phases: [] }
		]);
	});

	it('從「&」開始的拍點從那個半拍算；跨八拍的只佔下一個八拍的頭半拍', () => {
		// 動作拖到 1-1&：down 從 1-1& 佔 1 拍，up 從 1-8& 佔 1 拍到 2-1
		let flow = flowOf(placeCue(withAction(0, 32), 'x1', { kind: 'count', at: 0, len: 2, word: 'down' }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'count', at: 14, len: 2, word: 'up' }));
		const action = { ...flow.actions[0], start: 1 };
		const [down, up] = action.cues!;
		expect(actionEights(action)).toEqual([
			{
				eight: 0,
				cues: [
					{ cue: down, start: 1, end: 3, first: true, last: true, track: 0 },
					{ cue: up, start: 15, end: 16, first: true, last: false, track: 0 }
				],
				phases: []
			},
			{ eight: 1, cues: [{ cue: up, start: 0, end: 1, first: false, last: true, track: 0 }], phases: [] },
			{ eight: 2, cues: [], phases: [] }
		]);
	});

	it('同一種拍點疊在一起的放到下一軌，放進第一個空出來的軌；別種不算疊；每個八拍各自排', () => {
		// 1-1 到 2-8 的動作。拍子：全部 down 1-1 到 1-4、上層 up 1-2、小B down 1-2 到 1-3、
		// 上層 up 1-5 到 1-8、小B down 1-7 到 2-2；步驟：全部 下手 1-2
		const top = { role: '上層' };
		const b = { member: 'm2' };
		let flow = withAction(0, 32);
		for (const [kind, at, len, word, who] of [
			['count', 0, 8, 'down', null],
			['count', 2, 2, 'up', top],
			['count', 2, 4, 'down', b],
			['step', 2, 2, '下手', null],
			['count', 8, 8, 'up', top],
			['count', 12, 8, 'down', b]
		] as const) {
			flow = flowOf(placeCue(flow, 'x1', { kind, at, len, word, who }));
		}
		const action = flow.actions[0];
		const cues = action.cues!;
		const tracks = actionEights(action).map((e) => e.cues.map((p) => [cues.indexOf(p.cue), p.track]));
		expect(tracks).toEqual([
			[
				[0, 0],
				[1, 1],
				[2, 2],
				[3, 0],
				[4, 0],
				[5, 1]
			],
			[[5, 0]]
		]);
	});

	it('標了拍的環節也切：跨八拍的兩個八拍各拿自己那一段', () => {
		// 1-5 到 2-4 的動作：上法「延伸」1-5 到 1-6、中段 1-7 到 2-2
		let flow = flowOf(addPhase(withAction(8, 16), 'x1', { kind: 'load', name: '延伸', beats: { at: 0, len: 4 } }));
		flow = flowOf(addPhase(flow, 'x1', { kind: 'hold', name: '', beats: { at: 4, len: 8 } }));
		const [load, hold] = flow.actions[0].successRate!.phases;
		expect(actionEights(flow.actions[0])).toEqual([
			{
				eight: 0,
				cues: [],
				phases: [
					{ phase: load, beats: { at: 0, len: 4 }, start: 8, end: 12, first: true, last: true },
					{ phase: hold, beats: { at: 4, len: 8 }, start: 12, end: 16, first: true, last: false }
				]
			},
			{ eight: 1, cues: [], phases: [{ phase: hold, beats: { at: 4, len: 8 }, start: 0, end: 4, first: false, last: true }] }
		]);
	});

	it('給了拍點就只切那些（例：個人表只切給他的），環節照樣切', () => {
		let flow = flowOf(placeCue(withAction(0, 16), 'x1', { kind: 'count', at: 0, len: 8, word: 'down' }));
		flow = flowOf(placeCue(flow, 'x1', { kind: 'count', at: 2, len: 2, word: 'up', who: { member: 'm2' } }));
		flow = flowOf(addPhase(flow, 'x1', { kind: 'whole', name: '', beats: { at: 0, len: 16 } }));
		const action = flow.actions[0];
		const [, up] = action.cues!;
		const [only] = actionEights(action, [up]);
		expect(only.cues).toEqual([{ cue: up, start: 2, end: 4, first: true, last: true, track: 0 }]);
		expect(only.phases.map((p) => p.phase.kind)).toEqual(['whole']);
	});
});
