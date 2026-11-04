import { describe, expect, it } from 'vitest';
import {
	addAction,
	addMembers,
	addSegment,
	createFlow,
	markPhaseBeats,
	recordAttempt,
	renameFlow,
	type Flow
} from '#lib/core';
import { flowOf } from '#lib/core/test-flows.js';
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
