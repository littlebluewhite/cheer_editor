// 總檢查：每個會改流程的指令，成功的結果存成流程檔再打開，要打得開而且一樣。
import { describe, expect, it } from 'vitest';
import {
	PHASE_COLORS,
	addAction,
	addCustomRole,
	addMembers,
	addPhase,
	addSegment,
	carryRecords,
	clearCues,
	clearPhaseBeats,
	clearWalks,
	createFlow,
	deleteAction,
	deleteFormation,
	deleteLastAttempt,
	deleteMember,
	deletePhase,
	insertFormation,
	moveMember,
	loadSegmentAudio,
	markPhaseBeats,
	moveAction,
	moveFormation,
	moveMembers,
	placeCue,
	readFlowFile,
	recordAttempt,
	recordRunThrough,
	renameFlow,
	renameFormation,
	resizeAction,
	setMarkers,
	setPositions,
	setSquad,
	setTeamWalks,
	setWalks,
	updateAction,
	updateMember,
	updatePhase,
	updateSegment,
	updateTimeRules,
	writeFlowFile,
	type CommandResult,
	type Flow,
	type NewAttempt
} from './index';
import { flowOf, ratedSample } from '../test-flows';

const date = '2026-11-04';
const drill: NewAttempt = { date, who: 'g1', practice: 'drill', whole: true, marks: { p1: '✓', p2: '△', p3: '✗' } };
const walk = { depart: { segmentId: 's1', at: 1 }, arrive: { segmentId: 's1', at: 4 } };
const down = (at: number) => ({ kind: 'count' as const, at, len: 2, word: 'down' });

/**
 * 共用的 ratedSample（音樂 1 是 150 BPM，一個半拍 0.2 秒）再加：x1 第 1 組記一次；
 * 口號段 s2（10 秒）和裡面的 x3：Toss（拋投，小B、小芳），還沒有環節；站位 f2 在 2 秒。
 */
function base(): Flow {
	let flow = flowOf(recordAttempt(ratedSample(), 'x1', drill));
	flow = flowOf(addSegment(flow, 'chant'));
	flow = flowOf(updateSegment(flow, 's2', { seconds: 10 }));
	const members = [
		{ memberId: 'm3', role: '主底' },
		{ memberId: 'm4', role: '上層' }
	];
	flow = flowOf(addAction(flow, { segmentId: 's2', category: 'toss', name: 'Toss', start: 0, length: 30, note: '', members }));
	return flowOf(insertFormation(flow, 2));
}

/**
 * 核心對外每個會改流程的指令，各跑一個代表情境（要問的帶回答）。
 * 加新指令要加進來。
 */
const commands: [string, (flow: Flow) => CommandResult | Flow][] = [
	['createFlow', () => createFlow({ name: '新流程', field: { strips: 7, layout: 'horizontal' } })],
	['renameFlow', (f) => renameFlow(f, '新名字')],
	['addMembers', (f) => addMembers(f, [{ name: '小C', gender: 'M', globalRole: 'base' }])],
	['updateMember', (f) => updateMember(f, 'm1', { name: '小美美' }, { records: 'keep' })],
	['deleteMember', (f) => deleteMember(f, 'm4', { confirmed: true })],
	['moveMember', (f) => moveMember(f, 'm4', 0)],
	['setMarkers', (f) => setMarkers(f, 'initial')],
	[
		'addAction',
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
	],
	['updateAction', (f) => updateAction(f, 'x1', { note: '慢慢上' })],
	['moveAction', (f) => moveAction(f, 'x2', 8, { confirmed: true })],
	['resizeAction', (f) => resizeAction(f, 'x2', 10.4, { confirmed: true })],
	['deleteAction', (f) => deleteAction(f, 'x2', { confirmed: true })],
	['placeCue', (f) => placeCue(f, 'x1', down(0))],
	[
		'clearCues',
		(f) => clearCues(flowOf(placeCue(flowOf(placeCue(f, 'x1', down(0))), 'x1', down(8))), 'x1', 'count', 0, 4)
	],
	['setSquad', (f) => setSquad(f, 'x1', ['m1'], 2, { records: 'keep' })],
	['recordAttempt', (f) => recordAttempt(f, 'x1', { ...drill, who: 'g2' })],
	['recordRunThrough', (f) => recordRunThrough(f, date, [{ actionId: 'x1', who: 'g1', marks: { p1: '✓', p2: '✓', p3: '✓' } }])],
	['deleteLastAttempt', (f) => deleteLastAttempt(f, 'x1', 'g1', date, 'drill')],
	['carryRecords', (f) => carryRecords(f, flowOf(recordAttempt(f, 'x1', { ...drill, who: 'g2' })))],
	['addPhase', (f) => addPhase(f, 'x3', { kind: 'whole', name: '拋' })],
	['addPhase（音樂段標拍）', (f) => addPhase(f, 'x1', { kind: 'whole', name: '', beats: { at: 0, len: 4 } }, { confirmed: true })],
	['updatePhase', (f) => updatePhase(f, 'x1', 'p2', { name: '撐住', color: PHASE_COLORS[0].value })],
	['deletePhase', (f) => deletePhase(f, 'x1', 'p3', { confirmed: true })],
	['markPhaseBeats', (f) => markPhaseBeats(f, 'x1', 'p1', 0, 2)],
	['clearPhaseBeats', (f) => clearPhaseBeats(f, 'x1', 12, 16, { confirmed: true })],
	['addCustomRole', (f) => addCustomRole(f, { name: '飛人', meaning: '從後面跑上來的人' })],
	['setPositions', (f) => setPositions(f, 'f2', { m1: [1 / 3, -1.8288] })],
	['moveMembers', (f) => moveMembers(f, 4, { m1: [1, 1] })],
	['renameFormation', (f) => renameFormation(f, 'f2', '開場')],
	['deleteFormation', (f) => deleteFormation(f, 'f2')],
	['setWalks', (f) => setWalks(f, 'f2', { m1: walk })],
	['setTeamWalks', (f) => setTeamWalks(flowOf(setPositions(f, 'f2', { m1: [1, 1] })), 'f2', walk)],
	['clearWalks', (f) => clearWalks(flowOf(setWalks(f, 'f2', { m1: walk, m2: walk })), 'f2', ['m1'])],
	['insertFormation', (f) => insertFormation(f, 4)],
	['moveFormation', (f) => moveFormation(f, 'f2', { segmentId: 's1', at: 20 })],
	['addSegment', (f) => addSegment(f, 'music')],
	['updateSegment', (f) => updateSegment(f, 's1', { bpm: 144 }, { confirmed: true })],
	['loadSegmentAudio', (f) => loadSegmentAudio(f, 's1', '第一首.mp3')],
	['updateTimeRules', (f) => updateTimeRules(f, { on: false, maxTotalSec: 150 })]
];

describe('每個會改流程的指令：成功的結果存了再開', () => {
	it.each(commands)('%s', (_, command) => {
		const before = base();
		const r = command(before);
		const flow = 'kind' in r ? flowOf(r) : r;
		// 情境要真的改到流程，存了再開才有意義。
		expect(flow).not.toEqual(before);
		const opened = readFlowFile(writeFlowFile(flow, {}));
		expect(opened.kind).toBe('ok');
		expect(opened.kind === 'ok' && opened.flow).toEqual(flow);
	});
});
