// 雲端流程的復原、重做（#256）：復原堆疊存每一步改到的東西改之前、改之後的樣子；復原是送改之前的樣子，
// 放回去之後整份檢查，不合規則就擋下。
import { describe, expect, it } from 'vitest';
import {
	addMembers,
	deleteAction,
	deleteMember,
	deletePhase,
	renameFlow,
	setPositions,
	takeRecords,
	type Flow
} from './index';
import { joinUndo, runUndo, undoChanges, undone } from './cloud-undo';
import { inStep } from './ids';
import { flowOf, libSample, ratedSample } from '../test-flows';

const json = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe('undoChanges、undone', () => {
	it('刪掉的隊員復原回來（連站位裡的位置、名單的位置），重做再刪掉', () => {
		const before = ratedSample();
		const after = flowOf(deleteMember(before, 'm3', { confirmed: true }));
		const { undo, redo } = json(undoChanges(before, after));
		const back = undone(after, undo);
		expect(back.members.map((m) => m.id)).toEqual(before.members.map((m) => m.id));
		expect(back.formations[0].pos.m3).toEqual(before.formations[0].pos.m3);
		expect(undone(back, redo).members.map((m) => m.id)).toEqual(after.members.map((m) => m.id));
	});

	it('別人改的別的東西留著', () => {
		const before = ratedSample();
		const after = flowOf(renameFlow(before, '決賽'));
		const { undo } = undoChanges(before, after);
		const others = flowOf(setPositions(after, after.formations[0].id, { m1: [1, 1] }));
		const back = undone(others, undo);
		expect(back.name).toBe(before.name);
		expect(back.formations[0].pos.m1).toEqual([1, 1]);
	});

	it('刪掉的動作復原回來，紀錄是現在的（刪掉時清掉了就沒有）', () => {
		const before = ratedSample();
		const after = flowOf(deleteAction(before, 'x1', { confirmed: true }));
		const back = undone(after, undoChanges(before, after).undo);
		expect(back.actions.map((a) => a.id)).toEqual(['x1', 'x2']);
		expect(takeRecords(back).records).toEqual(takeRecords(after).records);
	});
});

describe('joinUndo（方向鍵連按合成一步）', () => {
	it('復原回到第一按之前，重做到最後一按之後', () => {
		const start = ratedSample();
		const opening = start.formations[0].id;
		const one = flowOf(setPositions(start, opening, { m1: [1, 1] }));
		const two = flowOf(setPositions(one, opening, { m1: [2, 1] }));
		const joined = joinUndo(undoChanges(start, one), undoChanges(one, two));
		expect(undone(two, joined.undo).formations[0].pos.m1).toEqual(start.formations[0].pos.m1);
		expect(undone(start, joined.redo).formations[0].pos.m1).toEqual([2, 1]);
	});
});

describe('runUndo（伺服器跑復原）', () => {
	/** 40 個人的流程。 */
	function full(): Flow {
		const base = ratedSample();
		const more = Array.from({ length: 40 - base.members.length }, (_, i) => ({
			name: `隊員${i}`,
			gender: 'F' as const,
			globalRole: 'base' as const
		}));
		return flowOf(addMembers(base, more));
	}

	it('放回去合規則：回新的樣子、紀錄、改到的鍵', () => {
		const before = ratedSample();
		const after = flowOf(renameFlow(before, '決賽'));
		const server = takeRecords(after);
		const r = runUndo(server.flow, server.records, undoChanges(before, after).undo);
		expect(r.kind).toBe('ok');
		if (r.kind !== 'ok') return;
		expect(r.flow.name).toBe(before.name);
		expect(r.records).toEqual(server.records);
		expect(r.keys).toEqual(['name']);
	});

	it('重做刪環節：復原時加回來的記號再清一次，只剩那個環節的記號的那一次整筆清掉（ADR 0007）', () => {
		const before = libSample();
		const who = before.actions[0].members[0].squad!;
		const once = (id: string, marks: Record<string, '✓' | '✗'>) => ({
			actionId: 'x1',
			attempt: { id, date: '2026-11-04', who, practice: 'drill' as const, whole: true, marks }
		});
		const after = flowOf(deletePhase(before, 'x1', 'p3', { confirmed: true }));
		const r = runUndo(before, [once('t1', { p1: '✓', p3: '✗' }), once('t2', { p3: '✗' })], undoChanges(before, after).redo);
		expect(r.kind).toBe('ok');
		if (r.kind !== 'ok') return;
		expect(r.records).toEqual([once('t1', { p1: '✓' })]);
	});

	it('你刪了 5 個人（35），別人加了 5 個（40），你復原變 45 人：擋下', () => {
		const forty = full();
		const gone = forty.members.slice(-5).map((m) => m.id);
		const mine = gone.reduce((f, id) => flowOf(deleteMember(f, id, { confirmed: true })), forty);
		const { undo } = undoChanges(forty, mine);
		const five = Array.from({ length: 5 }, (_, i) => ({ name: `新${i}`, gender: 'M' as const, globalRole: 'base' as const }));
		// 雲端的新 id 是亂數（不會跟刪掉的撞）
		const others = takeRecords(flowOf(inStep('step-other', () => addMembers(mine, five))));
		const r = runUndo(others.flow, others.records, undo);
		expect(r).toEqual({ kind: 'blocked', message: '一支流程最多 40 人' });
	});
});
