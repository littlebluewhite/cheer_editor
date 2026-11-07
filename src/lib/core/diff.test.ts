// 比對前後：一步改到哪些東西（ADR 0011 的「同一個東西」那張表）。
import { describe, expect, it } from 'vitest';
import {
	addCustomRole,
	addSegment,
	adjustField,
	deleteMember,
	deleteSegment,
	diffFlows,
	insertBeats,
	insertFormation,
	moveMember,
	moveSegment,
	renameFlow,
	setMarkers,
	setPositions,
	updateAction,
	type CommandResult,
	type Flow
} from './index';
import { flowOf, ratedSample } from '../test-flows';

/**
 * ratedSample（音樂 s1；隊員 m1–m4；動作 x1、x2）再加：口號段 s2、任務角色 r1、音樂檔 a1、
 * 站位 f2 在 s1 第 16 個半拍（3.2 秒）。
 */
function sample(): Flow {
	let flow = flowOf(addSegment(ratedSample(), 'chant'));
	flow = flowOf(addCustomRole(flow, { name: '飛人', meaning: '飛起來的人' }));
	flow = flowOf(insertFormation(flow, 3.2));
	return {
		...flow,
		audio: [{ id: 'a1', file: 'audio/a1.mp3', name: '開場.mp3' }]
	};
}

/** 照 sample 改一份（直接改資料，不經過指令）。 */
function edited(change: (flow: Flow) => void): Flow {
	const flow = structuredClone(sample());
	change(flow);
	return flow;
}

const keysOf = (after: Flow, before = sample()) => diffFlows(before, after).map((c) => c.key);

describe('diffFlows', () => {
	it('兩份一樣的流程回空的', () => {
		expect(diffFlows(sample(), sample())).toEqual([]);
		expect(diffFlows(sample(), structuredClone(sample()))).toEqual([]);
	});

	it('sample 的 id 跟說明一樣', () => {
		const flow = sample();
		expect(flow.segments.map((s) => s.id)).toEqual(['s1', 's2']);
		expect(flow.customRoles.map((r) => r.id)).toEqual(['r1']);
		expect(flow.formations.map((f) => [f.id, f.segmentId, f.at])).toEqual([
			['f1', 's1', 0],
			['f2', 's1', 16]
		]);
	});

	describe('動作（裡面的環節、組、拍點都算在動作裡）', () => {
		it('加', () => {
			const added = { ...sample().actions[0], id: 'x9' };
			const changes = diffFlows(
				sample(),
				edited((f) => f.actions.push(structuredClone(added)))
			);
			expect(changes.map((c) => c.key)).toEqual(['action:x9']);
			expect(changes[0].before).toBeNull();
		});
		it('改名字', () => {
			expect(keysOf(edited((f) => (f.actions[0].name = 'Full')))).toEqual(['action:x1']);
		});
		it('改環節', () => {
			expect(keysOf(edited((f) => (f.actions[0].successRate!.phases[0].name = '上')))).toEqual(['action:x1']);
		});
		it('改組', () => {
			expect(keysOf(edited((f) => (f.actions[0].members[0].squad = 'g9')))).toEqual(['action:x1']);
		});
		it('加拍點', () => {
			const cue = { kind: 'count' as const, at: 0, len: 2, word: 'down', who: null };
			expect(keysOf(edited((f) => (f.actions[1].cues = [cue])))).toEqual(['action:x2']);
		});
		it('刪', () => {
			const changes = diffFlows(
				sample(),
				edited((f) => f.actions.pop())
			);
			expect(changes.map((c) => c.key)).toEqual(['action:x2']);
			expect(changes[0].after).toBeNull();
		});
		it('只多了紀錄不算改到', () => {
			const attempt = {
				id: 't1',
				date: '2026-11-07',
				kind: 'full',
				squad: 'g1',
				marks: {}
			};
			const after = edited((f) => f.actions[0].successRate!.records.push(attempt as never));
			expect(diffFlows(sample(), after)).toEqual([]);
		});
	});

	describe('站位裡的一個人（位置＋走法）', () => {
		it('加', () => {
			expect(keysOf(edited((f) => (f.formations[1].pos.m9 = [1, 1])))).toEqual(['pos:f2:m9']);
		});
		it('改位置', () => {
			expect(keysOf(edited((f) => (f.formations[1].pos.m1 = [1, 1])))).toEqual(['pos:f2:m1']);
		});
		it('改走法', () => {
			const walk = {
				depart: { segmentId: 's1', at: 4 },
				arrive: { segmentId: 's1', at: 12 }
			};
			const changes = diffFlows(
				sample(),
				edited((f) => (f.formations[1].walks = { m2: walk }))
			);
			expect(changes).toEqual([
				{
					key: 'pos:f2:m2',
					before: { pos: sample().formations[1].pos.m2 },
					after: { pos: sample().formations[1].pos.m2, walk }
				}
			]);
		});
		it('刪', () => {
			expect(keysOf(edited((f) => delete f.formations[0].pos.m3))).toEqual(['pos:f1:m3']);
		});
	});

	describe('一張站位的時間（在哪段、第幾拍）', () => {
		it('改第幾拍', () => {
			expect(keysOf(edited((f) => (f.formations[1].at = 20)))).toEqual(['formation:f2']);
		});
		it('改在哪段', () => {
			expect(keysOf(edited((f) => (f.formations[1].segmentId = 's2')))).toEqual(['formation:f2']);
		});
		it('改名稱也算', () => {
			expect(keysOf(edited((f) => (f.formations[1].name = '金字塔')))).toEqual(['formation:f2']);
		});
		it('加：站位和裡面每一個人', () => {
			const added = {
				...structuredClone(sample().formations[1]),
				id: 'f9',
				at: 40
			};
			expect(keysOf(edited((f) => f.formations.push(added)))).toEqual([
				'formation:f9',
				'pos:f9:m1',
				'pos:f9:m2',
				'pos:f9:m3',
				'pos:f9:m4'
			]);
		});
		it('刪：站位和裡面每一個人', () => {
			expect(keysOf(edited((f) => f.formations.pop()))).toEqual([
				'formation:f2',
				'pos:f2:m1',
				'pos:f2:m2',
				'pos:f2:m3',
				'pos:f2:m4'
			]);
		});
	});

	describe.each([
		{
			row: '段',
			key: 'segment',
			add: (f: Flow) => f.segments.push({ id: 's9', kind: 'chant', tenths: 50 }),
			change: (f: Flow) => (f.segments[1] = { id: 's2', kind: 'chant', tenths: 70 }),
			del: (f: Flow) => f.segments.pop(),
			ids: ['s9', 's2', 's2']
		},
		{
			row: '隊員',
			key: 'member',
			add: (f: Flow) =>
				f.members.push({
					id: 'm9',
					name: '小C',
					gender: 'F',
					globalRole: 'base'
				}),
			change: (f: Flow) => (f.members[1].name = '阿A'),
			del: (f: Flow) => f.members.pop(),
			ids: ['m9', 'm2', 'm4']
		},
		{
			row: '任務角色',
			key: 'role',
			add: (f: Flow) => f.customRoles.push({ id: 'r9', name: '補位', meaning: '' }),
			change: (f: Flow) => (f.customRoles[0].meaning = '飛'),
			del: (f: Flow) => f.customRoles.pop(),
			ids: ['r9', 'r1', 'r1']
		},
		{
			row: '音樂檔',
			key: 'audio',
			add: (f: Flow) => f.audio.push({ id: 'a9', file: 'audio/a9.mp3', name: '結尾.mp3' }),
			change: (f: Flow) => (f.audio[0].name = '開場 2.mp3'),
			del: (f: Flow) => f.audio.pop(),
			ids: ['a9', 'a1', 'a1']
		}
	])('$row', ({ key, add, change, del, ids: [added, changed, deleted] }) => {
		it('加', () => {
			expect(keysOf(edited(add))).toEqual([`${key}:${added}`]);
		});
		it('改', () => {
			expect(keysOf(edited(change))).toEqual([`${key}:${changed}`]);
		});
		it('刪', () => {
			expect(keysOf(edited(del))).toEqual([`${key}:${deleted}`]);
		});
	});

	describe('流程名字、時間規則、標記用號碼還是開頭字各算一個', () => {
		it('流程名字', () => {
			expect(
				diffFlows(
					sample(),
					edited((f) => (f.name = '決賽'))
				)
			).toEqual([{ key: 'name', before: '測試', after: '決賽' }]);
		});
		it('時間規則', () => {
			expect(keysOf(edited((f) => (f.timeRules.on = false)))).toEqual(['timeRules']);
		});
		it('標記：從沒設過換成開頭字', () => {
			expect(keysOf(edited((f) => (f.markers = 'initial')))).toEqual(['markers']);
		});
		it('標記：從沒設過設成號碼不算改到（沒設過就是號碼）', () => {
			expect(keysOf(edited((f) => (f.markers = 'number')))).toEqual([]);
		});
	});

	describe('場地', () => {
		it('改場地算改到每張站位的每一個人', () => {
			expect(keysOf(edited((f) => (f.field = { strips: 7, layout: 'vertical' })))).toEqual([
				'field',
				...['f1', 'f2'].flatMap((fid) => ['m1', 'm2', 'm3', 'm4'].map((m) => `pos:${fid}:${m}`))
			]);
		});
	});

	describe('段的順序、名單的順序', () => {
		it('只加一個段不算改到段的順序', () => {
			expect(keysOf(edited((f) => f.segments.unshift({ id: 's9', kind: 'chant', tenths: 50 })))).toEqual([
				'segment:s9'
			]);
		});
		it('只刪一個段不算改到段的順序', () => {
			expect(keysOf(edited((f) => f.segments.shift()))).toEqual(['segment:s1']);
		});
		it('調段的順序才算', () => {
			expect(
				diffFlows(
					sample(),
					edited((f) => f.segments.reverse())
				)
			).toEqual([{ key: 'segmentOrder', before: ['s1', 's2'], after: ['s2', 's1'] }]);
		});
		it('只加、刪隊員不算改到名單的順序', () => {
			expect(keysOf(edited((f) => f.members.shift()))).toEqual(['member:m1']);
		});
		it('調名單的順序才算', () => {
			const after = edited((f) => f.members.push(f.members.shift()!));
			expect(keysOf(after)).toEqual(['memberOrder']);
		});
	});

	it('回來的東西能用 JSON 送：送過去再拿回來一模一樣', () => {
		const changes = diffFlows(
			sample(),
			edited((f) => {
				f.actions.pop();
				f.formations[1].pos.m1 = [2, 2];
				f.segments.reverse();
			})
		);
		expect(JSON.parse(JSON.stringify(changes))).toEqual(changes);
	});

	describe('拿現有的指令跑範例流程，比對出來的跟指令真的改的對得上', () => {
		const run = (command: (flow: Flow) => CommandResult) => keysOf(flowOf(command(sample())));
		it('改流程名字', () => {
			expect(run((f) => renameFlow(f, '決賽'))).toEqual(['name']);
		});
		it('換標記', () => {
			expect(run((f) => setMarkers(f, 'initial'))).toEqual(['markers']);
		});
		it('拖一個人', () => {
			expect(run((f) => setPositions(f, 'f2', { m1: [1, 1] }))).toEqual(['pos:f2:m1']);
		});
		it('改動作名字', () => {
			expect(run((f) => updateAction(f, 'x2', { name: '後手翻' }))).toEqual(['action:x2']);
		});
		it('調名單順序', () => {
			expect(run((f) => moveMember(f, 'm1', 2))).toEqual(['memberOrder']);
		});
		it('調段順序：開頭那張站位跟著換到新的第一段', () => {
			expect(run((f) => moveSegment(f, 's2', -1))).toEqual(['formation:f1', 'segmentOrder']);
		});
		it('刪沒有東西的段：沒段用的音樂檔一起拿掉', () => {
			expect(run((f) => deleteSegment(f, 's2', { confirmed: true }))).toEqual(['segment:s2', 'audio:a1']);
		});
		it('加任務角色', () => {
			expect(run((f) => addCustomRole(f, { name: '補位', meaning: '' }))).toEqual(['role:r2']);
		});
		it('刪隊員：隊員、他在每張站位的位置、他在的動作', () => {
			expect(run((f) => deleteMember(f, 'm4', { confirmed: true }))).toEqual([
				'member:m4',
				'action:x1',
				'pos:f1:m4',
				'pos:f2:m4'
			]);
		});
		it('改場地：場地和每張站位的每一個人', () => {
			expect(run((f) => adjustField(f, { strips: 7, layout: 'horizontal' }))).toEqual([
				'field',
				...['f1', 'f2'].flatMap((fid) => ['m1', 'm2', 'm3', 'm4'].map((m) => `pos:${fid}:${m}`))
			]);
		});
		it('插入八拍：段不變長，後面的動作、站位往後挪，開頭那張不動', () => {
			expect(run((f) => insertBeats(f, { segmentId: 's1', at: 0 }, 16))).toEqual([
				'action:x1',
				'action:x2',
				'formation:f2'
			]);
		});
	});
});
