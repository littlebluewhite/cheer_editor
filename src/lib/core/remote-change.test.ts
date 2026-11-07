// 別人的改動（#253）：伺服器收了一步，送「改好之後的那些東西」給房間裡的其他人，他們套在自己的畫面上。
import { describe, expect, it } from 'vitest';
import {
	addAction,
	addCustomRole,
	addMembers,
	addSegment,
	adjustField,
	applyRemoteChange,
	deleteAction,
	deleteFormation,
	deleteMember,
	deleteSegment,
	insertFormation,
	moveMember,
	moveSegment,
	remoteChange,
	renameFlow,
	setMarkers,
	setPositions,
	updateAction,
	type CommandResult,
	type Flow
} from './index';
import { flowOf, ratedSample } from '../test-flows';

/** ratedSample 再加：口號段 s2、任務角色 r1、站位 f2 在 s1 第 16 個半拍。 */
function sample(): Flow {
	let flow = flowOf(addSegment(ratedSample(), 'chant'));
	flow = flowOf(addCustomRole(flow, { name: '飛人', meaning: '飛起來的人' }));
	return flowOf(insertFormation(flow, 3.2));
}

/** 經過 JSON（伺服器送來的樣子）。 */
const overTheWire = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe('別人的改動套上去跟伺服器一樣', () => {
	it.each<[string, (f: Flow) => CommandResult]>([
		['改流程名字', (f) => renameFlow(f, '決賽')],
		['換標記', (f) => setMarkers(f, 'initial')],
		['在第一段後面插一段（插在中間）', (f) => addSegment(f, 'music', 's1')],
		['調段的順序', (f) => moveSegment(f, 's2', -1)],
		['刪段', (f) => deleteSegment(f, 's2', { confirmed: true })],
		['加隊員', (f) => addMembers(f, [{ name: '小C', gender: 'F', globalRole: 'base' }])],
		['調名單順序', (f) => moveMember(f, 'm1', 2)],
		['刪隊員（連帶動作、站位裡的他）', (f) => deleteMember(f, 'm4', { confirmed: true })],
		['拖一個人', (f) => setPositions(f, 'f2', { m1: [1, 1] })],
		['插一張站位（插在中間）', (f) => insertFormation(f, 1)],
		['刪站位', (f) => deleteFormation(f, 'f2')],
		['改場地', (f) => adjustField(f, { strips: 7, layout: 'horizontal' })],
		['改動作', (f) => updateAction(f, 'x2', { name: '後手翻' })],
		['刪動作', (f) => deleteAction(f, 'x2', { confirmed: true })],
		[
			'加動作',
			(f) =>
				addAction(f, {
					segmentId: 's1',
					category: 'tumbling',
					name: '',
					start: 16,
					length: 8,
					note: '',
					members: [{ memberId: 'm3', role: '騰翻' }]
				})
		]
	])('%s', (_, command) => {
		const before = sample();
		const after = flowOf(command(sample()));
		const change = overTheWire(remoteChange(before, after));
		expect(applyRemoteChange(sample(), change)).toEqual(after);
	});

	it('沒改到東西是空的，套上去一樣', () => {
		const change = remoteChange(sample(), sample());
		expect(change).toEqual({ things: [], orders: {} });
		expect(applyRemoteChange(sample(), change)).toEqual(sample());
	});

	it('動作的紀錄留我這邊的（紀錄不在改動裡）', () => {
		const attempt = { id: 't1', date: '2026-11-07', kind: 'full', squad: 'g1', marks: {} };
		const mine = structuredClone(sample());
		mine.actions[0].successRate!.records.push(attempt as never);
		const after = flowOf(updateAction(sample(), 'x1', { name: 'Full' }));
		const got = applyRemoteChange(mine, overTheWire(remoteChange(sample(), after)));
		expect(got.actions[0].name).toBe('Full');
		expect(got.actions[0].successRate!.records).toEqual([attempt]);
	});

	it('我這邊還沒送到的新東西留著（伺服器還不知道它）', () => {
		const mine = flowOf(addCustomRole(sample(), { name: '補位', meaning: '' }));
		const after = flowOf(renameFlow(flowOf(addCustomRole(sample(), { name: '別人的', meaning: '' })), '決賽'));
		// 別人加的跟我加的 id 不一樣才有意義：直接改 id
		after.customRoles[1].id = 'r9';
		const got = applyRemoteChange(mine, overTheWire(remoteChange(sample(), after)));
		expect(got.name).toBe('決賽');
		// 我的放在我這邊它前一個的後面
		expect(got.customRoles.map((r) => r.id)).toEqual(['r1', 'r2', 'r9']);
	});

	it('別人沒碰的東西保持我這邊的樣子', () => {
		const mine = flowOf(setPositions(sample(), 'f1', { m2: [2, 2] }));
		const after = flowOf(setPositions(sample(), 'f2', { m1: [1, 1] }));
		const got = applyRemoteChange(mine, overTheWire(remoteChange(sample(), after)));
		expect(got.formations[0].pos.m2).toEqual([2, 2]);
		expect(got.formations[1].pos.m1).toEqual([1, 1]);
	});

	it('刪掉的東西送鍵、樣子是 null', () => {
		const after = flowOf(deleteAction(sample(), 'x2', { confirmed: true }));
		expect(remoteChange(sample(), after).things).toEqual([{ key: 'action:x2', after: null }]);
	});
});
