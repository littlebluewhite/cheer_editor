// 會問的指令：帶「確定」或帶「保留／清掉」都算回答過了。
import { describe, expect, it } from 'vitest';
import {
	addPhase,
	clearPhaseBeats,
	deleteAction,
	deleteMember,
	deletePhase,
	markPhaseBeats,
	recordAttempt,
	resizeAction,
	setSquad,
	updateAction,
	updateMember,
	updateSegment,
	type CommandResult,
	type ConfirmOption,
	type Flow
} from './index';
import { flowOf, ratedSample } from '../test-flows';

/** ratedSample 的 x1 第 1 組記一次（三個環節都有記號）。 */
function base(): Flow {
	const marks = { p1: '✓', p2: '△', p3: '✗' } as const;
	return flowOf(recordAttempt(ratedSample(), 'x1', { date: '2026-11-04', who: 'g1', practice: 'drill', whole: true, marks }));
}

/** 每個會問的指令，各一個會問的情境。 */
const asking: [string, (flow: Flow, o: ConfirmOption) => CommandResult][] = [
	['updateAction', (f, o) => updateAction(f, 'x1', { length: 8 }, o)],
	['resizeAction', (f, o) => resizeAction(f, 'x1', 1.6, o)],
	['deleteAction', (f, o) => deleteAction(f, 'x1', o)],
	['setSquad', (f, o) => setSquad(f, 'x1', ['m1'], 2, o)],
	['updateMember', (f, o) => updateMember(f, 'm1', { name: '小美美' }, o)],
	['deleteMember', (f, o) => deleteMember(f, 'm4', o)],
	['updateSegment', (f, o) => updateSegment(f, 's1', { eights: 1 }, o)],
	['addPhase', (f, o) => addPhase(f, 'x1', { kind: 'whole', name: '', beats: { at: 0, len: 4 } }, o)],
	['deletePhase', (f, o) => deletePhase(f, 'x1', 'p3', o)],
	['markPhaseBeats', (f, o) => markPhaseBeats(f, 'x1', 'p1', 0, 16, o)],
	['clearPhaseBeats', (f, o) => clearPhaseBeats(f, 'x1', 12, 16, o)]
];

describe('會問的指令：帶確定或帶保留／清掉都算回答過了', () => {
	it.each(asking)('%s', (_, command) => {
		const flow = base();
		expect(['confirm', 'choose']).toContain(command(flow, {}).kind);
		for (const answer of [{ confirmed: true }, { records: 'keep' }, { records: 'clear' }] as const) {
			expect(command(flow, answer).kind).toBe('ok');
		}
	});
});
