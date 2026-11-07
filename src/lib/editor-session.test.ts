import { describe, expect, it, vi } from 'vitest';
import {
	addAction,
	addMembers,
	addSegment,
	createFlow,
	deleteAction,
	addPhase,
	insertFormation,
	moveFormation,
	moveMembers,
	recordAttempt,
	renameFlow,
	toSeconds,
	type CommandResult,
	type ConfirmOption,
	type Flow
} from '#lib/core';
import { flowOf, libSample, squadNumbers } from '#lib/test-flows.js';
import { EditorSession, VIEW_ONLY } from './editor-session.svelte.js';

/** 小美一個人、一個技巧 x1（環節上法 1-1 到 1-4），可以記一次。 */
function sampleFlow(): Flow {
	let flow = flowOf(createFlow({ name: '練習用', field: { strips: 9, layout: 'vertical' } }));
	flow = flowOf(addMembers(flow, [{ name: '小美', gender: 'F', globalRole: 'top' }]));
	flow = flowOf(addSegment(flow, 'music'));
	const members = [{ memberId: 'm1', role: '上層' }];
	flow = flowOf(addAction(flow, { segmentId: 's1', category: 'stunt', name: 'Lib', start: 0, length: 8, note: '', members }));
	return flowOf(addPhase(flow, 'x1', { kind: 'load', name: '', beats: { at: 0, len: 4 } }));
}

const rename = (s: EditorSession, name: string) => s.change(flowOf(renameFlow(s.flow!, name)));
const recordOnce = (s: EditorSession) =>
	s.record(flowOf(recordAttempt(s.flow!, 'x1', { date: '2026-11-05', who: 'g1', practice: 'drill', whole: true, marks: { p1: '✓' } })));
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

	it('改之前和改之後內容一樣（換了物件也一樣）不算一步，重做還在', () => {
		const s = new EditorSession(sampleFlow());
		rename(s, 'A');
		s.undo();
		const before = s.flow!;
		const copy = JSON.parse(JSON.stringify(before)) as Flow;
		expect(s.change({ ...copy, actions: copy.actions.map((a) => ({ ...a })) })).toBe(false);
		expect(s.flow).toBe(before);
		expect(s.canUndo).toBe(false);
		expect(s.canRedo).toBe(true);
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

	it('同一個 join 連續改合成一步；join 不一樣、中間有別的改動、復原過就斷開', () => {
		const s = new EditorSession(sampleFlow());
		const join = (name: string, key: string) => s.change(flowOf(renameFlow(s.flow!, name)), key);
		join('A', 'k');
		join('B', 'k');
		join('C', 'k');
		join('D', 'other');
		rename(s, 'E');
		join('F', 'k');
		const names: string[] = [];
		while (s.undo()) names.push(s.flow!.name);
		expect(names).toEqual(['E', 'D', 'C', '練習用']);

		join('A', 'k');
		s.undo();
		s.redo();
		join('B', 'k');
		s.undo();
		expect(s.flow!.name).toBe('A');
	});

	it('nudge：問題成功時用給的 key 合；被擋不算', () => {
		const s = new EditorSession(sampleFlow());
		const ok = (name: string) => () => renameFlow(s.flow!, name);
		s.nudge('k', ok('A'));
		s.nudge('k', () => ({ kind: 'blocked', message: '不行' }) as const);
		s.nudge('k', ok('B'));
		s.undo();
		expect(s.flow!.name).toBe('練習用');
		expect(s.canUndo).toBe(false);
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

	it('提示過 5 秒自己收掉；換了一句就重算', () => {
		vi.useFakeTimers();
		try {
			const s = new EditorSession(libSample());
			s.notice = '存好了';
			vi.advanceTimersByTime(4000);
			s.notice = '另一句';
			vi.advanceTimersByTime(4000);
			expect(s.notice).toBe('另一句');
			vi.advanceTimersByTime(1000);
			expect(s.notice).toBe('');
		} finally {
			vi.useRealTimers();
		}
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
		const attempt = { date: '2026-11-05', who: 'g1', practice: 'drill', whole: true, marks: { p1: '✓' } } as const;
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

	it('改了、復原：問題收掉；復原的提示換成「已復原：…」', () => {
		const s = new EditorSession(libSample());
		s.ask.send(result({ kind: 'confirm', message: '確定嗎', items: [] }));
		rename(s, 'A');
		expect(s.ask.question).toBeNull();
		s.ask.send(result({ kind: 'confirm', message: '確定嗎', items: [] }));
		s.notice = '提示';
		s.undo();
		expect(s.ask.question).toBeNull();
		expect(s.notice).toBe('已復原：改流程名字');
	});
});

describe('編輯 session：元件要的問題（「改」或「記」）', () => {
	it('「改」的問題成功：算一步，可以復原；確定鈕的字照給的', () => {
		const s = new EditorSession(sampleFlow());
		const ask = s.changeAsk({ confirmLabel: '確定刪除' });
		expect(ask.confirmLabel).toBe('確定刪除');
		ask.send(() => renameFlow(s.flow!, '全國賽'));
		expect(s.flow!.name).toBe('全國賽');
		expect(s.unsaved).toBe(true);
		expect(s.undo()).toBe(true);
		expect(s.flow!.name).toBe('練習用');
	});

	it('「記」的問題成功：不算一步、不清重做', () => {
		const s = new EditorSession(sampleFlow());
		rename(s, 'A');
		s.undo();
		const attempt = { date: '2026-11-05', who: 'g1', practice: 'drill', whole: true, marks: { p1: '✓' } } as const;
		s.recordAsk().send(() => recordAttempt(s.flow!, 'x1', attempt));
		expect(records(s)).toBe(1);
		expect(s.unsaved).toBe(true);
		expect(s.canUndo).toBe(false);
		expect(s.canRedo).toBe(true);
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
	const squads = (s: EditorSession) => squadNumbers(s.flow!.actions[0]);

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

	it('0 移出組', () => {
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

describe('編輯 session：改完跳播放頭', () => {
	/** session 接上一個只記下「跳到哪、要不要重播」的播放。 */
	function withJumps(flow: Flow) {
		const jumps: { sec: number; replay: boolean }[] = [];
		const s = new EditorSession(flow, { opened() {}, changed() {}, jump: (sec, replay) => void jumps.push({ sec, replay }) });
		return { s, jumps };
	}

	it('拖人插了站位：提示說插了一張，播放頭停到那張（播放中不重播）', () => {
		const { s, jumps } = withJumps(libSample());
		s.ask.send(() => moveMembers(s.flow!, 2, { m1: [1, 1] }), { done: (r) => s.moved(r) });
		expect(s.flow!.formations).toHaveLength(2);
		expect(s.canUndo).toBe(true);
		expect(s.notice).toBe('插了一張站位，大家的位置自動帶入');
		expect(jumps).toEqual([{ sec: 2, replay: false }]);
	});

	it('拖人改到現有的站位、往後帶：提示說帶了幾張', () => {
		const { s, jumps } = withJumps(flowOf(insertFormation(libSample(), 2)));
		s.notice = '舊的提示';
		s.ask.send(() => moveMembers(s.flow!, 0, { m1: [1, 1] }), { done: (r) => s.moved(r) });
		expect(s.notice).toBe('後面 1 張站位也跟著改了');
		expect(jumps).toEqual([{ sec: 0, replay: false }]);
	});

	it('挪站位：提示改到哪（旁邊有復原）、選著這張，播放頭跳到新的站位時間（播放中從那裡重播）', () => {
		const { s, jumps } = withJumps(flowOf(insertFormation(libSample(), 2)));
		s.notice = '舊的提示';
		const id = s.flow!.formations[1].id;
		const to = { segmentId: 's1', at: 16 };
		s.ask.send(() => moveFormation(s.flow!, id, to), { done: (r) => s.formationMoved(id, r) });
		expect(s.selectedFormationId).toBe(id);
		expect(s.notice).toBe('站位 2 改到 2-1');
		expect(s.noticeUndo).toBe('復原改站位時間');
		expect(jumps).toEqual([{ sec: toSeconds(s.flow!, to), replay: true }]);
	});

	it('跳到同一秒也每次都叫到播放', () => {
		const { s, jumps } = withJumps(libSample());
		s.moved({ inserted: false, sec: 0, carried: 0 });
		s.moved({ inserted: false, sec: 0, carried: 0 });
		expect(jumps).toHaveLength(2);
	});
});

describe('編輯 session：檢視模式', () => {
	it('改的問題、場上的問題、復原都擋下，說原因；記照記；切回編輯就能復原', () => {
		const s = new EditorSession(sampleFlow());
		rename(s, '全國賽');
		s.viewing = true;
		const before = s.flow;
		const asked = s.changeAsk();
		asked.send(() => renameFlow(s.flow!, '區賽'));
		expect(asked.error).toBe(VIEW_ONLY);
		s.ask.send(() => renameFlow(s.flow!, '區賽'));
		expect(s.notice).toBe(VIEW_ONLY);
		s.notice = '';
		expect(s.undo()).toBe(false);
		expect(s.notice).toBe(VIEW_ONLY);
		expect(s.flow).toBe(before);
		recordOnce(s);
		expect(records(s)).toBe(1);
		s.viewing = false;
		expect(s.undo()).toBe(true);
		expect(s.flow!.name).toBe('練習用');
	});
});
