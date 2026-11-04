import { describe, expect, it } from 'vitest';
import {
	addAction,
	addMembers,
	addSegment,
	createFlow,
	deleteAction,
	markPhaseBeats,
	recordAttempt,
	renameFlow,
	type CommandResult,
	type ConfirmOption,
	type Flow
} from '#lib/core';
import { flowOf, libSample } from '#lib/core/test-flows.js';
import { EditorSession } from './editor-session.svelte.js';

/** 小美一個人、一個技巧 x1（環節上法 1-1 到 1-4），可以記一次。 */
function sampleFlow(): Flow {
	let flow = flowOf(createFlow({ name: '練習用', field: { strips: 9, layout: 'vertical' } }));
	flow = flowOf(addMembers(flow, [{ name: '小美', gender: 'F', globalRole: 'top' }]));
	flow = flowOf(addSegment(flow, 'music'));
	const members = [{ memberId: 'm1', role: '上層' }];
	flow = flowOf(addAction(flow, { segmentId: 's1', category: 'stunt', name: 'Lib', start: 0, length: 8, note: '', members }));
	return flowOf(markPhaseBeats(flow, 'x1', { kind: 'load', name: '' }, 0, 4));
}

const rename = (s: EditorSession, name: string) => s.change(flowOf(renameFlow(s.flow!, name)));
const recordOnce = (s: EditorSession) =>
	s.record(flowOf(recordAttempt(s.flow!, 'x1', { date: '2026-11-05', who: 1, practice: 'drill', whole: true, marks: { p1: '✓' } })));
const records = (s: EditorSession) => s.flow!.actions[0].successRate?.records.length ?? 0;

describe('編輯 session：流程和復原', () => {
	it('沒給流程：沒有流程，也沒有沒存的改動', () => {
		const s = new EditorSession();
		expect(s.flow).toBeNull();
		expect(s.unsaved).toBe(false);
		expect(s.canUndo).toBe(false);
	});

	it('給的流程算存過的；改了就有沒存的改動，存了就沒有', () => {
		const s = new EditorSession(sampleFlow());
		expect(s.unsaved).toBe(false);
		rename(s, '全國賽');
		expect(s.unsaved).toBe(true);
		s.markSaved(s.flow!);
		expect(s.unsaved).toBe(false);
	});

	it('「改」算一步：復原回去、重做回來', () => {
		const s = new EditorSession(sampleFlow());
		expect(rename(s, '全國賽')).toBe(true);
		expect(s.flow!.name).toBe('全國賽');
		expect(s.undo()).toBe(true);
		expect(s.flow!.name).toBe('練習用');
		expect(s.canUndo).toBe(false);
		expect(s.redo()).toBe(true);
		expect(s.flow!.name).toBe('全國賽');
		expect(s.canRedo).toBe(false);
	});

	it('改成同一個流程不算一步', () => {
		const s = new EditorSession(sampleFlow());
		expect(s.change(s.flow!)).toBe(false);
		expect(s.canUndo).toBe(false);
		expect(s.unsaved).toBe(false);
	});

	it('沒東西可以復原、重做時什麼都不做', () => {
		const s = new EditorSession(sampleFlow());
		const before = s.flow;
		expect(s.undo()).toBe(false);
		expect(s.redo()).toBe(false);
		expect(s.flow).toBe(before);
	});

	it('做了新的一步，重做就清掉', () => {
		const s = new EditorSession(sampleFlow());
		rename(s, 'A');
		s.undo();
		expect(s.canRedo).toBe(true);
		rename(s, 'B');
		expect(s.canRedo).toBe(false);
	});

	it('最多記 100 步', () => {
		const s = new EditorSession(sampleFlow());
		for (let i = 1; i <= 105; i++) rename(s, String(i));
		let undone = 0;
		while (s.undo()) undone++;
		expect(undone).toBe(100);
		expect(s.flow!.name).toBe('5');
	});

	it('「記」不算一步、不清重做；有沒存的改動', () => {
		const s = new EditorSession(sampleFlow());
		rename(s, 'A');
		s.undo();
		recordOnce(s);
		expect(records(s)).toBe(1);
		expect(s.canUndo).toBe(false);
		expect(s.canRedo).toBe(true);
		expect(s.unsaved).toBe(true);
	});

	it('復原、重做帶著現在的紀錄：編排回去，紀錄還在', () => {
		const s = new EditorSession(sampleFlow());
		rename(s, '全國賽');
		recordOnce(s);
		s.undo();
		expect(s.flow!.name).toBe('練習用');
		expect(records(s)).toBe(1);
		recordOnce(s);
		s.redo();
		expect(s.flow!.name).toBe('全國賽');
		expect(records(s)).toBe(2);
	});

	it('換一支流程：清掉復原和重做；從檔案開的算存過，救回的草稿不算', () => {
		const s = new EditorSession(sampleFlow());
		rename(s, 'A');
		rename(s, 'B');
		s.undo();
		s.open(sampleFlow(), true);
		expect(s.flow!.name).toBe('練習用');
		expect(s.canUndo).toBe(false);
		expect(s.canRedo).toBe(false);
		expect(s.unsaved).toBe(false);
		s.open(sampleFlow());
		expect(s.unsaved).toBe(true);
		s.open(null);
		expect(s.flow).toBeNull();
		expect(s.unsaved).toBe(false);
	});
});

describe('編輯 session：選取', () => {
	it('選動作清掉站位，選站位清掉動作；選的人不受影響', () => {
		const s = new EditorSession(libSample());
		s.selectMembers(['m1']);
		s.selectFormation('f1');
		s.selectAction('x1');
		expect(s.selectedFormationId).toBeNull();
		expect(s.selectedActionId).toBe('x1');
		s.selectFormation('f1');
		expect(s.selectedActionId).toBeNull();
		expect(s.selectedFormationId).toBe('f1');
		expect(s.selectedMemberIds).toEqual(['m1']);
	});

	it('取消選動作不動站位；全部取消', () => {
		const s = new EditorSession(libSample());
		s.selectFormation('f1');
		s.selectAction(null);
		expect(s.selectedFormationId).toBe('f1');
		s.selectMembers(['m1']);
		expect(s.anySelected).toBe(true);
		s.clearSelection();
		expect(s.selectedFormationId).toBeNull();
		expect(s.selectedMemberIds).toEqual([]);
		expect(s.anySelected).toBe(false);
	});

	it('點人：只選他；Shift 或多選開著是加進來或拿掉', () => {
		const s = new EditorSession(libSample());
		s.pickMember('m1', false);
		s.pickMember('m2', false);
		expect(s.selectedMemberIds).toEqual(['m2']);
		s.pickMember('m3', true);
		expect(s.selectedMemberIds).toEqual(['m2', 'm3']);
		s.pickMember('m2', true);
		expect(s.selectedMemberIds).toEqual(['m3']);
		s.multiSelect = true;
		s.pickMember('m1', false);
		expect(s.selectedMemberIds).toEqual(['m3', 'm1']);
	});

	it('改掉、復原掉的人、動作從選取拿掉', () => {
		const s = new EditorSession(libSample());
		s.change(flowOf(addMembers(s.flow!, [{ name: '小新', gender: 'M', globalRole: 'base' }])));
		s.selectMembers(['m1', 'm5']);
		s.selectAction('x1');
		s.undo();
		expect(s.selectedMemberIds).toEqual(['m1']);
		expect(s.selectedActionId).toBe('x1');
		s.change(flowOf(deleteAction(s.flow!, 'x1', { confirmed: true })));
		expect(s.selectedActionId).toBeNull();
	});

	it('換一支流程清掉選取和提示', () => {
		const s = new EditorSession(libSample());
		s.selectMembers(['m1']);
		s.selectAction('x1');
		s.notice = '存好了';
		s.open(libSample(), true);
		expect(s.selectedMemberIds).toEqual([]);
		expect(s.selectedActionId).toBeNull();
		expect(s.notice).toBe('');
	});
});

describe('編輯 session：頁面層級的問題', () => {
	const result = (r: CommandResult) => () => r;

	it('成功：算一步，提示收掉', () => {
		const s = new EditorSession(libSample());
		s.notice = '舊的提示';
		s.ask.send(() => renameFlow(s.flow!, '全國賽'));
		expect(s.flow!.name).toBe('全國賽');
		expect(s.canUndo).toBe(true);
		expect(s.notice).toBe('');
	});

	it('被擋：原因放進提示；給了還原就加「，已還原」並還原', () => {
		const s = new EditorSession(libSample());
		s.ask.send(result({ kind: 'blocked', message: '不能這樣拖' }));
		expect(s.notice).toBe('不能這樣拖');
		let reverted = false;
		s.ask.send(result({ kind: 'blocked', message: '不能這樣拖' }), { revert: () => (reverted = true) });
		expect(s.notice).toBe('不能這樣拖，已還原');
		expect(reverted).toBe(true);
		expect(s.canUndo).toBe(false);
	});

	it('要確認：提示收掉、留下問題；確定才改', () => {
		const s = new EditorSession(libSample());
		const attempt = { date: '2026-11-05', who: 1, practice: 'drill', whole: true, marks: { p1: '✓' } } as const;
		s.record(flowOf(recordAttempt(s.flow!, 'x1', attempt)));
		s.notice = '舊的提示';
		s.ask.send((o) => deleteAction(s.flow!, 'x1', o));
		expect(s.ask.question?.message).toContain('會清掉 1 次紀錄');
		expect(s.notice).toBe('');
		expect(s.flow!.actions).toHaveLength(1);
		s.ask.answer('confirm');
		expect(s.flow!.actions).toHaveLength(0);
		expect(s.ask.question).toBeNull();
	});

	it('要選：保留舊紀錄、清掉重算帶著回答再送', () => {
		for (const answer of ['keep', 'clear'] as const) {
			const s = new EditorSession(libSample());
			const sent: ConfirmOption[] = [];
			s.ask.send((o: ConfirmOption = {}): CommandResult => {
				sent.push(o);
				return o.records ? renameFlow(s.flow!, answer) : { kind: 'choose', message: '要保留嗎', items: [] };
			});
			expect(s.ask.question?.choose).toBe(true);
			s.ask.answer(answer);
			expect(sent.at(-1)).toEqual({ records: answer });
			expect(s.flow!.name).toBe(answer);
		}
	});

	it('取消：問題收掉、流程沒變、還原', () => {
		const s = new EditorSession(libSample());
		const before = s.flow;
		let reverted = false;
		s.ask.send(result({ kind: 'confirm', message: '確定嗎', items: [] }), { revert: () => (reverted = true) });
		s.ask.answer('cancel');
		expect(s.ask.question).toBeNull();
		expect(s.flow).toBe(before);
		expect(reverted).toBe(true);
		expect(s.notice).toBe('');
	});

	it('改了、復原：問題收掉；復原也清提示', () => {
		const s = new EditorSession(libSample());
		s.ask.send(result({ kind: 'confirm', message: '確定嗎', items: [] }));
		rename(s, 'A');
		expect(s.ask.question).toBeNull();
		s.ask.send(result({ kind: 'confirm', message: '確定嗎', items: [] }));
		s.notice = '提示';
		s.undo();
		expect(s.ask.question).toBeNull();
		expect(s.notice).toBe('');
	});
});

describe('編輯 session：分組數字鍵', () => {
	/** libSample 選好 x1（小美、小A 第 1 組，小B、小芳 第 2 組），再選 ids 這些人。 */
	function grouping(ids: string[]) {
		const s = new EditorSession(libSample());
		s.selectAction('x1');
		s.selectMembers(ids);
		return s;
	}
	const squads = (s: EditorSession) => s.flow!.actions[0].members.map((m) => m.squad);

	it('選到要分組的動作才有分組', () => {
		const s = new EditorSession(libSample());
		expect(s.groupingAction).toBeNull();
		s.selectAction('x1');
		expect(s.groupingAction?.id).toBe('x1');
	});

	it('數字鍵放進那一組，最多到新的一組；算一步', () => {
		const s = grouping(['m1']);
		expect(s.squadKey(2)).toBe(true);
		expect(squads(s)).toEqual([2, 1, 2, 2]);
		expect(s.canUndo).toBe(true);
		expect(s.squadKey(3)).toBe(true);
		expect(squads(s)).toEqual([3, 1, 2, 2]);
	});

	it('超過下一個組號不算', () => {
		const s = grouping(['m1']);
		const before = s.flow;
		expect(s.squadKey(4)).toBe(false);
		expect(s.flow).toBe(before);
	});

	it('0 拿出組', () => {
		const s = grouping(['m1', 'm3']);
		expect(s.squadKey(0)).toBe(true);
		expect(squads(s)).toEqual([undefined, 1, undefined, 2]);
	});

	it('沒選人、選的人不在動作裡、沒選要分組的動作，都不算', () => {
		expect(grouping([]).squadKey(1)).toBe(false);
		expect(grouping(['m9']).squadKey(1)).toBe(false);
		const s = new EditorSession(libSample());
		s.selectMembers(['m1']);
		expect(s.squadKey(1)).toBe(false);
	});

	it('選的人只算動作裡的', () => {
		expect(grouping(['m1', 'm9']).squadPicked).toEqual(['m1']);
	});
});
