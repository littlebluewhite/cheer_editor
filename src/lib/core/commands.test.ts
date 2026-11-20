// 指令表：用名字＋參數叫，跟直接叫一樣；參數轉成 JSON 再轉回來也一樣；一步帶好幾個指令照順序跑、全算或全不算。
import { describe, expect, it } from 'vitest';
import {
	COMMAND_NAMES,
	addAction,
	addBookmark,
	deleteBookmark,
	renameBookmark,
	addCustomRole,
	addMemberLines,
	addMembers,
	addPhase,
	addSegment,
	adjustField,
	changeAttempt,
	clearCues,
	clearPhaseBeats,
	clearWalks,
	createFlow,
	deleteAction,
	deleteAttempt,
	deleteAttempts,
	deleteCustomRole,
	deleteFormation,
	deleteLastAttempt,
	deleteLastRunThrough,
	deleteMember,
	deletePhase,
	deleteSegment,
	fitSegmentToAudio,
	insertBeats,
	inStep,
	insertFormation,
	loadSegmentAudio,
	markPhaseBeats,
	moveGroup,
	moveAction,
	moveFormation,
	moveMember,
	moveMembers,
	moveSegment,
	pasteCues,
	placeCue,
	recordAttempt,
	recordRunThrough,
	renameFlow,
	renameFormation,
	resizeAction,
	restoreAttempt,
	restoreRunThrough,
	runCommand,
	runCommands,
	setMarkers,
	setPositions,
	setSquad,
	setTeamWalks,
	setWalks,
	splitSegment,
	updateAction,
	updateCustomRole,
	updateMember,
	updatePhase,
	updateSegment,
	updateTimeRules,
	type Command,
	type CommandResult,
	type Flow,
	type NewActionInput,
	type NewAttempt,
	type StepResult
} from './index';
import { flowOf, ratedSample } from '../test-flows';

const date = '2026-11-04';
/** 測試用的步驟 id。 */
const STEP = 'k3m9q2w7';
const drill: NewAttempt = {
	date,
	who: 'g1',
	practice: 'drill',
	whole: true,
	marks: { p1: '✓', p2: '△', p3: '✗' }
};
const walk = {
	depart: { segmentId: 's1', at: 1 },
	arrive: { segmentId: 's1', at: 4 }
};
const down = { kind: 'count' as const, at: 0, len: 2, word: 'down' };
const run = [{ actionId: 'x1', who: 'g1', marks: { p1: '✓', p2: '✓', p3: '✓' } as const }];

/**
 * ratedSample（音樂 1 是 150 BPM）再加：x1 第 1 組記一次（t1）、x1 的拍點 down、任務角色 r1「飛人」；
 * 口號段 s2（10 秒）和裡面的 x3：Toss（小B、小芳）；音樂 1 載入 a1；站位 f2 在 2 秒。
 */
/** base 加一個只有 A 的書籤 k1。 */
function withBookmark(): Flow {
	return flowOf(addBookmark(base(), '翻騰', { segmentId: 's1', at: 0 }, null));
}

function base(): Flow {
	let flow = flowOf(recordAttempt(ratedSample(), 'x1', drill));
	flow = flowOf(placeCue(flow, 'x1', down));
	flow = flowOf(addCustomRole(flow, { name: '飛人', meaning: '' }));
	flow = flowOf(addSegment(flow, 'chant'));
	flow = flowOf(updateSegment(flow, 's2', { seconds: 10 }));
	const members = [
		{ memberId: 'm3', role: '主底' },
		{ memberId: 'm4', role: '上層' }
	];
	flow = flowOf(
		addAction(flow, {
			segmentId: 's2',
			category: 'toss',
			name: 'Toss',
			start: 0,
			length: 30,
			note: '',
			members
		})
	);
	flow = flowOf(loadSegmentAudio(flow, 's1', '第一首.mp3'));
	return flowOf(insertFormation(flow, 2));
}

/** base 再記一次全上。 */
const withRun = () => flowOf(recordRunThrough(base(), date, 1794036000000, run));

/** base 刪掉 t1：給「放回一次」用。在一步外面先做好（不在一步裡發的 id），情境裡跑幾次都一樣。 */
const DELETED = (() => {
	const r = deleteAttempt(base(), 'x1', 't1');
	if (r.kind !== 'ok') throw new Error('deleteAttempt');
	return r;
})();
const deleted = () => DELETED;

/** withRun 刪掉那次全上：給「放回全上」用。跟 deleted 一樣先做好。 */
const DELETED_RUN = (() => {
	const r = deleteLastRunThrough(withRun(), date);
	if (r.kind !== 'ok') throw new Error('deleteLastRunThrough');
	return r;
})();
const deletedRun = () => DELETED_RUN;

/** 一個情境：在哪個流程上、用名字叫的指令、直接叫的同一個指令。 */
interface Case {
	label: string;
	flow: () => Flow;
	command: Command;
	direct: (flow: Flow) => CommandResult;
}

const at = (label: string, flow: () => Flow, command: Command, direct: (flow: Flow) => CommandResult): Case => ({
	label,
	flow,
	command,
	direct
});

/** 每個登記的指令至少一個情境；成功、被擋、要確認、要選都要有。 */
const cases: Case[] = [
	at(
		'createFlow',
		base,
		{
			name: 'createFlow',
			args: [{ name: '新流程', field: { strips: 7, layout: 'horizontal' } }]
		},
		() =>
			createFlow({
				name: '新流程',
				field: { strips: 7, layout: 'horizontal' }
			})
	),
	at('renameFlow', base, { name: 'renameFlow', args: ['決賽'] }, (f) => renameFlow(f, '決賽')),
	at('renameFlow 被擋', base, { name: 'renameFlow', args: [''] }, (f) => renameFlow(f, '')),
	at('adjustField', base, { name: 'adjustField', args: [{ strips: 7, layout: 'horizontal' }] }, (f) =>
		adjustField(f, { strips: 7, layout: 'horizontal' })
	),
	at(
		'addMembers',
		base,
		{
			name: 'addMembers',
			args: [[{ name: '小C', gender: 'M', globalRole: 'base' }]]
		},
		(f) => addMembers(f, [{ name: '小C', gender: 'M', globalRole: 'base' }])
	),
	at(
		'addMemberLines',
		base,
		{
			name: 'addMemberLines',
			args: ['小C\n小D', { gender: null, globalRole: 'base' }]
		},
		(f) => addMemberLines(f, '小C\n小D', { gender: null, globalRole: 'base' })
	),
	at('updateMember 要選', base, { name: 'updateMember', args: ['m1', { name: '小美美' }] }, (f) =>
		updateMember(f, 'm1', { name: '小美美' })
	),
	at(
		'updateMember 帶著保留',
		base,
		{
			name: 'updateMember',
			args: ['m1', { name: '小美美' }],
			options: { records: 'keep' }
		},
		(f) => updateMember(f, 'm1', { name: '小美美' }, { records: 'keep' })
	),
	at('deleteMember 要確認', base, { name: 'deleteMember', args: ['m4'] }, (f) => deleteMember(f, 'm4')),
	at('deleteMember 帶著確定', base, { name: 'deleteMember', args: ['m4'], options: { confirmed: true } }, (f) =>
		deleteMember(f, 'm4', { confirmed: true })
	),
	at('moveMember', base, { name: 'moveMember', args: ['m4', 0] }, (f) => moveMember(f, 'm4', 0)),
	at('setMarkers', base, { name: 'setMarkers', args: ['initial'] }, (f) => setMarkers(f, 'initial')),
	at(
		'addAction',
		base,
		{
			name: 'addAction',
			args: [
				{
					segmentId: 's1',
					category: 'jump',
					name: 'T',
					start: 48,
					length: 8,
					note: '',
					members: [{ memberId: 'm3', role: null }]
				}
			]
		},
		(f) =>
			addAction(f, {
				segmentId: 's1',
				category: 'jump',
				name: 'T',
				start: 48,
				length: 8,
				note: '',
				members: [{ memberId: 'm3', role: null }]
			})
	),
	at('updateAction', base, { name: 'updateAction', args: ['x1', { note: '慢慢上' }] }, (f) =>
		updateAction(f, 'x1', { note: '慢慢上' })
	),
	at('updateAction 要確認', base, { name: 'updateAction', args: ['x1', { length: 8 }] }, (f) =>
		updateAction(f, 'x1', { length: 8 })
	),
	at('moveAction', base, { name: 'moveAction', args: ['x2', 8], options: { confirmed: true } }, (f) =>
		moveAction(f, 'x2', 8, { confirmed: true })
	),
	at('resizeAction', base, { name: 'resizeAction', args: ['x2', 10.4], options: { confirmed: true } }, (f) =>
		resizeAction(f, 'x2', 10.4, { confirmed: true })
	),
	at('deleteAction 要確認', base, { name: 'deleteAction', args: ['x1'] }, (f) => deleteAction(f, 'x1')),
	at('deleteAction 被擋', base, { name: 'deleteAction', args: ['x9'] }, (f) => deleteAction(f, 'x9')),
	at('setSquad 要選', base, { name: 'setSquad', args: ['x1', ['m1'], 2] }, (f) => setSquad(f, 'x1', ['m1'], 2)),
	at(
		'setSquad 帶著清掉',
		base,
		{
			name: 'setSquad',
			args: ['x1', ['m1'], 2],
			options: { records: 'clear' }
		},
		(f) => setSquad(f, 'x1', ['m1'], 2, { records: 'clear' })
	),
	at(
		'setSquad 移出組',
		base,
		{
			name: 'setSquad',
			args: ['x1', ['m1'], null],
			options: { records: 'keep' }
		},
		(f) => setSquad(f, 'x1', ['m1'], null, { records: 'keep' })
	),
	at('placeCue', base, { name: 'placeCue', args: ['x1', { ...down, at: 8 }] }, (f) =>
		placeCue(f, 'x1', { ...down, at: 8 })
	),
	at('clearCues', base, { name: 'clearCues', args: ['x1', 'count', 0, 4] }, (f) => clearCues(f, 'x1', 'count', 0, 4)),
	at('clearCues 全部種類', base, { name: 'clearCues', args: ['x1', null, 0, 4] }, (f) =>
		clearCues(f, 'x1', null, 0, 4)
	),
	at('pasteCues', base, { name: 'pasteCues', args: ['x1', 8, [{ ...down, who: null }]] }, (f) =>
		pasteCues(f, 'x1', 8, [{ ...down, who: null }])
	),
	at('recordAttempt', base, { name: 'recordAttempt', args: ['x1', { ...drill, who: 'g2' }] }, (f) =>
		recordAttempt(f, 'x1', { ...drill, who: 'g2' })
	),
	at('changeAttempt', base, { name: 'changeAttempt', args: ['x1', 't1', { p1: '✗' }] }, (f) =>
		changeAttempt(f, 'x1', 't1', { p1: '✗' })
	),
	at('deleteAttempts', base, { name: 'deleteAttempts', args: [['t1']] }, (f) => deleteAttempts(f, ['t1'])),
	at('deleteAttempt', base, { name: 'deleteAttempt', args: ['x1', 't1'] }, (f) => deleteAttempt(f, 'x1', 't1')),
	at(
		'restoreAttempt',
		() => deleted().flow,
		{
			name: 'restoreAttempt',
			args: ['x1', deleted().attempt, deleted().index]
		},
		(f) => restoreAttempt(f, 'x1', deleted().attempt, deleted().index)
	),
	at('deleteLastAttempt', base, { name: 'deleteLastAttempt', args: ['x1', 'g1', date, 'drill'] }, (f) =>
		deleteLastAttempt(f, 'x1', 'g1', date, 'drill')
	),
	at('recordRunThrough', base, { name: 'recordRunThrough', args: [date, 1794036000000, run] }, (f) => recordRunThrough(f, date, 1794036000000, run)),
	at('deleteLastRunThrough', withRun, { name: 'deleteLastRunThrough', args: [date] }, (f) =>
		deleteLastRunThrough(f, date)
	),
	at(
		'restoreRunThrough',
		() => deletedRun().flow,
		{ name: 'restoreRunThrough', args: [deletedRun().removed] },
		(f) => restoreRunThrough(f, deletedRun().removed)
	),
	at('addPhase', base, { name: 'addPhase', args: ['x3', { kind: 'toss', name: '拋' }] }, (f) =>
		addPhase(f, 'x3', { kind: 'toss', name: '拋' })
	),
	at(
		'addPhase 帶著確定',
		base,
		{
			name: 'addPhase',
			args: ['x1', { kind: 'hold', name: '', beats: { at: 0, len: 4 } }],
			options: { confirmed: true }
		},
		(f) => addPhase(f, 'x1', { kind: 'hold', name: '', beats: { at: 0, len: 4 } }, { confirmed: true })
	),
	at('updatePhase', base, { name: 'updatePhase', args: ['x1', 'p2', { name: '撐住' }] }, (f) =>
		updatePhase(f, 'x1', 'p2', { name: '撐住' })
	),
	at('deletePhase 要確認', base, { name: 'deletePhase', args: ['x1', 'p3'] }, (f) => deletePhase(f, 'x1', 'p3')),
	at('markPhaseBeats', base, { name: 'markPhaseBeats', args: ['x1', 'p1', 0, 2] }, (f) =>
		markPhaseBeats(f, 'x1', 'p1', 0, 2)
	),
	at(
		'clearPhaseBeats 帶著確定',
		base,
		{
			name: 'clearPhaseBeats',
			args: ['x1', 12, 16],
			options: { confirmed: true }
		},
		(f) => clearPhaseBeats(f, 'x1', 12, 16, { confirmed: true })
	),
	at('addCustomRole', base, { name: 'addCustomRole', args: [{ name: '提手', meaning: '' }] }, (f) =>
		addCustomRole(f, { name: '提手', meaning: '' })
	),
	at('updateCustomRole', base, { name: 'updateCustomRole', args: ['r1', { name: '飛飛', meaning: '' }] }, (f) =>
		updateCustomRole(f, 'r1', { name: '飛飛', meaning: '' })
	),
	at('deleteCustomRole', base, { name: 'deleteCustomRole', args: ['r1'] }, (f) => deleteCustomRole(f, 'r1')),
	at('setPositions', base, { name: 'setPositions', args: ['f2', { m1: [1, 1] }] }, (f) =>
		setPositions(f, 'f2', { m1: [1, 1] })
	),
	at('moveMembers', base, { name: 'moveMembers', args: [4, { m1: [1, 1] }] }, (f) => moveMembers(f, 4, { m1: [1, 1] })),
	at('moveGroup', base, { name: 'moveGroup', args: [4, { m1: [1, 1] }] }, (f) => moveGroup(f, 4, { m1: [1, 1] })),
	at('renameFormation', base, { name: 'renameFormation', args: ['f2', '開場'] }, (f) =>
		renameFormation(f, 'f2', '開場')
	),
	at('deleteFormation', base, { name: 'deleteFormation', args: ['f2'] }, (f) => deleteFormation(f, 'f2')),
	at('setWalks', base, { name: 'setWalks', args: ['f2', { m1: walk }] }, (f) => setWalks(f, 'f2', { m1: walk })),
	at('setTeamWalks', base, { name: 'setTeamWalks', args: ['f2', walk] }, (f) => setTeamWalks(f, 'f2', walk)),
	at('clearWalks', base, { name: 'clearWalks', args: ['f2', ['m1']] }, (f) => clearWalks(f, 'f2', ['m1'])),
	at('insertFormation', base, { name: 'insertFormation', args: [4] }, (f) => insertFormation(f, 4)),
	at('moveFormation', base, { name: 'moveFormation', args: ['f2', { segmentId: 's1', at: 20 }] }, (f) =>
		moveFormation(f, 'f2', { segmentId: 's1', at: 20 })
	),
	at('addSegment', base, { name: 'addSegment', args: ['music'] }, (f) => addSegment(f, 'music')),
	at('addSegment 插在後面', base, { name: 'addSegment', args: ['chant', 's1'] }, (f) => addSegment(f, 'chant', 's1')),
	at('updateSegment 要確認', base, { name: 'updateSegment', args: ['s1', { eights: 1 }] }, (f) =>
		updateSegment(f, 's1', { eights: 1 })
	),
	at(
		'updateSegment 帶著音樂長度',
		base,
		{ name: 'updateSegment', args: ['s1', { firstBeatSec: 40 }, { a1: 30 }] },
		(f) => updateSegment(f, 's1', { firstBeatSec: 40 }, {}, { a1: 30 })
	),
	at(
		'updateSegment 帶著確定',
		base,
		{
			name: 'updateSegment',
			args: ['s1', { bpm: 144 }],
			options: { confirmed: true }
		},
		(f) => updateSegment(f, 's1', { bpm: 144 }, { confirmed: true })
	),
	at('loadSegmentAudio', base, { name: 'loadSegmentAudio', args: ['s1', '第二首.mp3', ['a1']] }, (f) =>
		loadSegmentAudio(f, 's1', '第二首.mp3', ['a1'])
	),
	at(
		'fitSegmentToAudio',
		base,
		{
			name: 'fitSegmentToAudio',
			args: ['s1', { a1: 60 }],
			options: { confirmed: true }
		},
		(f) => fitSegmentToAudio(f, 's1', { a1: 60 }, { confirmed: true })
	),
	at('deleteSegment 要確認', base, { name: 'deleteSegment', args: ['s2'] }, (f) => deleteSegment(f, 's2')),
	at('moveSegment', base, { name: 'moveSegment', args: ['s2', -1] }, (f) => moveSegment(f, 's2', -1)),
	at('splitSegment', base, { name: 'splitSegment', args: ['s1', 17] }, (f) => splitSegment(f, 's1', 17)),
	at('insertBeats', base, { name: 'insertBeats', args: [{ segmentId: 's1', at: 64 }, 16] }, (f) =>
		insertBeats(f, { segmentId: 's1', at: 64 }, 16)
	),
	at('updateTimeRules', base, { name: 'updateTimeRules', args: [{ on: false, maxTotalSec: 150 }] }, (f) =>
		updateTimeRules(f, { on: false, maxTotalSec: 150 })
	),
	at('addBookmark', base, { name: 'addBookmark', args: ['翻騰', { segmentId: 's1', at: 8 }, { segmentId: 's1', at: 24 }] }, (f) =>
		addBookmark(f, '翻騰', { segmentId: 's1', at: 8 }, { segmentId: 's1', at: 24 })
	),
	at('renameBookmark', withBookmark, { name: 'renameBookmark', args: ['k1', '開場'] }, (f) => renameBookmark(f, 'k1', '開場')),
	at('deleteBookmark', withBookmark, { name: 'deleteBookmark', args: ['k1'] }, (f) => deleteBookmark(f, 'k1'))
];

describe('用名字＋參數叫指令', () => {
	it.each(cases.map((c) => [c.label, c] as const))('%s：跟在同一步裡直接叫一樣', (_, c) => {
		const flow = c.flow();
		expect(runCommand(flow, c.command, STEP)).toEqual(inStep(STEP, () => c.direct(flow)));
	});

	it.each(cases.map((c) => [c.label, c] as const))('%s：參數轉成 JSON 再轉回來，結果一樣', (_, c) => {
		const sent = JSON.parse(JSON.stringify(c.command)) as Command;
		const flow = c.flow();
		expect(runCommand(flow, sent, STEP)).toEqual(inStep(STEP, () => c.direct(flow)));
	});

	it('57 個指令都登記，每個都有情境', () => {
		expect(COMMAND_NAMES).toHaveLength(57);
		expect(new Set(cases.map((c) => c.command.name))).toEqual(new Set(COMMAND_NAMES));
	});

	it('情境裡成功、被擋、要確認、要選都有', () => {
		const kinds = new Set(cases.map((c) => c.direct(c.flow()).kind));
		expect(kinds).toEqual(new Set(['ok', 'blocked', 'confirm', 'choose']));
	});
});

describe('一步帶好幾個指令', () => {
	it('照順序跑：後面的指令跑在前面改好的流程上', () => {
		const flow = base();
		const r = runCommands(
			flow,
			[
				{ name: 'addSegment', args: ['music'] },
				{ name: 'moveSegment', args: ['s2', 1] }
			],
			STEP
		);
		expect(r.kind === 'ok' && r.flow).toEqual(
			inStep(STEP, () => flowOf(moveSegment(flowOf(addSegment(flow, 'music')), 's2', 1)))
		);
	});

	it('多帶的結果都留著（例：新加的段 id）', () => {
		const r = runCommands(
			base(),
			[
				{ name: 'addSegment', args: ['music'] },
				{ name: 'renameFlow', args: ['決賽'] }
			],
			STEP
		);
		expect(r.kind === 'ok' && r.flow.segments.at(-1)!.id).toBe(r.kind === 'ok' && 'id' in r && r.id);
	});

	it('中間一個被擋：整串都不算，回那一個的原因和它是第幾個', () => {
		const r = runCommands(
			base(),
			[
				{ name: 'renameFlow', args: ['決賽'] },
				{ name: 'deleteAction', args: ['x9'] },
				{ name: 'moveMember', args: ['m4', 0] }
			],
			STEP
		);
		expect(r).toEqual({ kind: 'blocked', message: '找不到這個動作', at: 1 });
	});

	it('中間一個要問：整串都不算，回那一個的問題和它是第幾個', () => {
		const flow = base();
		const r = runCommands(
			flow,
			[
				{ name: 'renameFlow', args: ['決賽'] },
				{ name: 'deleteAction', args: ['x1'] }
			],
			STEP
		);
		expect(r).toEqual({ ...deleteAction(flow, 'x1'), at: 1 });
	});

	it('沒有開著的流程：只有新建流程叫得動', () => {
		expect(runCommands(null, [{ name: 'renameFlow', args: ['決賽'] }], STEP)).toMatchObject({ kind: 'blocked', at: 0 });
		const field = { strips: 7, layout: 'horizontal' } as const;
		expect(runCommand(null, { name: 'createFlow', args: [{ name: '新', field }] }, STEP)).toEqual(
			inStep(STEP, () => createFlow({ name: '新', field }))
		);
	});
});

describe('新東西的 id 由步驟 id 算出來', () => {
	const twoSegments = (stepId: string) =>
		runCommands(
			base(),
			[
				{ name: 'addSegment', args: ['music'] },
				{ name: 'addSegment', args: ['chant'] }
			],
			stepId
		);
	const newSegmentIds = (r: StepResult) => (r.kind === 'ok' ? r.flow.segments.slice(2).map((s) => s.id) : []);

	it('同一個步驟 id 跑同一步：新東西的 id 一樣', () => {
		expect(newSegmentIds(twoSegments('k3m9q2w7'))).toEqual(newSegmentIds(twoSegments('k3m9q2w7')));
	});

	it('換一個步驟 id 就不一樣；同一步裡的兩個也不一樣', () => {
		const ids = [...newSegmentIds(twoSegments('k3m9q2w7')), ...newSegmentIds(twoSegments('z8w1p0a5'))];
		expect(ids).toHaveLength(4);
		expect(new Set(ids).size).toBe(4);
	});

	it('格式是種類字母加 12 個小寫字母或數字', () => {
		const ids = newSegmentIds(twoSegments('k3m9q2w7'));
		expect(ids).toHaveLength(2);
		for (const id of ids) expect(id).toMatch(/^s[a-z0-9]{12}$/);
	});

	it('指令回的 id 就是流程裡新東西的 id', () => {
		const action: NewActionInput = { segmentId: 's1', category: 'jump', name: 'T', start: 48, length: 8, note: '', members: [{ memberId: 'm1', role: null }] };
		const r = runCommand(base(), { name: 'addAction', args: [action] }, 'k3m9q2w7');
		if (r.kind !== 'ok') throw new Error('addAction');
		expect(r.id).toMatch(/^x[a-z0-9]{12}$/);
		expect(r.flow.actions.at(-1)!.id).toBe(r.id);
	});
});
