// 復原紀錄的兩個 adapter（#319）。本機（ADR 0007）：直接測 LocalUndo；整條路（session 的改、記、復原）在
// editor-session.test.ts「復原把這一步清掉的紀錄一起帶回來」。雲端（ADR 0014）：編輯器 module 在 Node 打開雲端流程
// （cloudEditor），復原、重做送成一步，伺服器收了、退回時的復原紀錄。
import { describe, expect, it } from 'vitest';
import { deletePhase, rateCounts, recordAttempt, remoteChange, runCommands, type Command, type Flow, type RemoteChange } from '#lib/core';
import type { RoomMessage } from '#lib/api-types/RoomMessage.js';
import { cloudEditor, flush } from '#lib/test-fakes.js';
import { flowOf, libSample, ratedSample } from '#lib/test-flows.js';
import { LocalUndo } from './undo-log.svelte.js';

/** 跑一串指令，一定要成功。 */
const ran = (flow: Flow, ...commands: Command[]): Flow => {
	const r = runCommands(flow, commands, 'test');
	if (r.kind !== 'ok') throw new Error(`指令沒成功：${r.kind}`);
	return r.flow;
};

describe('本機的復原紀錄（ADR 0007）', () => {
	/** ratedSample 的 Lib 第 1 組整個做一次 ✓✓✓。 */
	const recorded = () =>
		flowOf(recordAttempt(ratedSample(), 'x1', { date: '2026-11-05', who: 'g1', practice: 'drill', whole: true, marks: { p1: '✓', p2: '✓', p3: '✓' } }));
	const lib = (flow: Flow) => flow.actions.find((a) => a.id === 'x1')!.successRate!;

	it('復原：整份換回改之前，這一步清掉的紀錄帶回來；重做再清一次', () => {
		const log = new LocalUndo();
		const before = recorded();
		const after = flowOf(deletePhase(before, 'x1', 'p3', { confirmed: true }));
		expect(log.record({ before, after, joined: false, label: '刪環節「下法」' })).toBe('刪環節「下法」');
		expect([log.canUndo, log.undoLabel, log.canRedo]).toEqual([true, '刪環節「下法」', false]);

		const undone = log.undo(after)!;
		expect(undone.label).toBe('刪環節「下法」');
		expect(lib(undone.flow)).toEqual(lib(before));
		expect([log.canUndo, log.canRedo, log.redoLabel]).toEqual([false, true, '刪環節「下法」']);

		const redone = log.redo(undone.flow)!;
		expect(lib(redone.flow)).toEqual(lib(after));
		expect(rateCounts(lib(redone.flow).phases, lib(redone.flow).records)).toEqual(rateCounts(lib(after).phases, lib(after).records));
	});

	it('合成一步：從合之前到現在算一步；清掉就都沒了', () => {
		const log = new LocalUndo();
		const a = libSample();
		const b = ran(a, { name: 'renameFlow', args: ['區賽'] });
		const c = ran(b, { name: 'renameFlow', args: ['全國賽'] });
		log.record({ before: a, after: b, joined: false });
		log.record({ before: b, after: c, joined: true, label: '改流程名字' });
		expect(log.undo(c)!.flow.name).toBe('測試');
		expect(log.canUndo).toBe(false);
		log.clear();
		expect([log.canUndo, log.canRedo]).toEqual([false, false]);
	});
});

describe('雲端的復原紀錄（ADR 0014）', () => {
	it('復原送一步，伺服器退回去、別人改的別的東西留著；重做也送一步', async () => {
		const s = await cloudEditor();
		const w = s.joinAs('c1', s.wang.email);
		await flush();
		s.session.ask.send({ name: 'renameFlow', args: ['全國賽'] });
		await flush();
		w.step({ name: 'addSegment', args: ['chant'] });
		await flush();
		const steps = s.state.flows[0].step!;

		expect(s.session.undo()).toBe(true);
		await flush();
		expect(s.state.flows[0].step).toBe(steps + 1);
		expect(s.state.flows[0].flow.name).toBe('測試');
		expect(s.state.flows[0].flow.segments).toHaveLength(2);
		expect(s.session.flow).toEqual(s.state.flows[0].flow);
		expect(s.session.unsaved).toBe(false);

		expect(s.session.redo()).toBe(true);
		await flush();
		expect(s.state.flows[0].step).toBe(steps + 2);
		expect(s.state.flows[0].flow.name).toBe('全國賽');
		expect(s.session.flow).toEqual(s.state.flows[0].flow);
	});

	it('別人後來改過：這步不能復原，從紀錄拿掉；再按一次試前一步', async () => {
		const s = await cloudEditor();
		const w = s.joinAs('c1', s.wang.email);
		await flush();
		s.session.ask.send({ name: 'addSegment', args: ['chant'] });
		s.session.ask.send({ name: 'renameFlow', args: ['全國賽'] });
		await flush();
		w.step({ name: 'renameFlow', args: ['區賽'] });
		await flush();

		s.session.undo();
		await flush();
		expect(s.session.notice).toBe('王教練後來改過，這步不能復原');
		expect(s.session.flow!.name).toBe('區賽');
		expect(s.session.flow).toEqual(s.state.flows[0].flow);
		expect([s.session.undoLabel, s.session.canRedo]).toEqual(['加第 2 段', false]);

		s.session.undo();
		await flush();
		expect(s.session.notice).toBe('已復原：加第 2 段');
		expect(s.state.flows[0].flow.segments).toHaveLength(1);
		expect(s.state.flows[0].flow.name).toBe('區賽');
		expect(s.session.flow).toEqual(s.state.flows[0].flow);
	});

	it('被退回的步從紀錄拿掉：復原不會試它', async () => {
		const s = await cloudEditor();
		const w = s.joinAs('c1', s.wang.email);
		await flush();
		s.session.ask.send({ name: 'addSegment', args: ['chant'] });
		await flush();
		s.state.holdRoom = true;
		w.step({ name: 'renameFlow', args: ['區賽'] });
		s.session.ask.send({ name: 'renameFlow', args: ['全國賽'] });
		expect(s.session.undoLabel).toBe('改流程名字');
		s.releaseRoom();
		await flush();
		expect(s.session.undoLabel).toBe('加第 2 段');

		s.session.undo();
		await flush();
		expect(s.state.flows[0].flow.segments).toHaveLength(1);
		expect(s.state.flows[0].flow.name).toBe('區賽');
		expect(s.session.canUndo).toBe(false);
	});

	/** 伺服器收了第 n 步（從 0 數）時說它做出來的改動是 changes[n]（沒給照伺服器的）：假伺服器照同一個流程核心跑，做不出跟畫面不一樣的。 */
	function acceptAs(s: Awaited<ReturnType<typeof cloudEditor>>, changes: (RemoteChange | undefined)[]) {
		const heard = s.room.onmessage;
		let n = 0;
		s.room.onmessage = (msg: RoomMessage) => heard(msg.kind === 'accepted' ? { ...msg, change: changes[n++] ?? msg.change } : msg);
	}

	it('一步收了：重做送的換成伺服器做出來的改動，不是畫面上的', async () => {
		const s = await cloudEditor();
		const start = s.state.flows[0].flow;
		acceptAs(s, [remoteChange(start, ran(start, { name: 'renameFlow', args: ['區賽'] })) as RemoteChange]);
		s.session.ask.send({ name: 'renameFlow', args: ['全國賽'] });
		await flush();
		expect(s.session.flow!.name).toBe('區賽');

		s.session.undo();
		await flush();
		expect(s.state.flows[0].flow.name).toBe('測試');
		s.session.redo();
		await flush();
		expect(s.state.flows[0].flow.name).toBe('區賽');
		expect(s.session.flow).toEqual(s.state.flows[0].flow);
	});

	it('合成一步（方向鍵連按）：最後一步收了才換成伺服器做出來的改動', async () => {
		const s = await cloudEditor();
		const start = s.state.flows[0].flow;
		const opening = start.formations[0].id;
		const at = (flow: Flow, x: number) => ran(flow, { name: 'setPositions', args: [opening, { m1: [x, 1] }] });
		// 伺服器說：第 1 步做成 (6, 1)、第 2 步做成 (5, 1)
		acceptAs(s, [remoteChange(start, at(start, 6)) as RemoteChange, remoteChange(at(start, 6), at(start, 5)) as RemoteChange]);
		s.state.holdRoom = true;
		for (const x of [1, 2]) s.session.nudge('m1', { name: 'setPositions', args: [opening, { m1: [x, 0] }] });
		s.releaseRoom();
		await flush();
		expect(s.state.flows[0].step).toBe(2);

		s.session.undo();
		await flush();
		expect(s.state.flows[0].flow.formations[0].pos.m1).toEqual(start.formations[0].pos.m1);
		expect(s.session.canUndo).toBe(false);
		s.session.redo();
		await flush();
		expect(s.state.flows[0].flow.formations[0].pos.m1).toEqual([5, 1]);
		expect(s.session.flow).toEqual(s.state.flows[0].flow);
	});
});
