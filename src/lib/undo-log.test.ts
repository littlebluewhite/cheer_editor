// 復原紀錄的兩個 adapter（#319）。本機（ADR 0007）：直接測 LocalUndo；整條路（session 的改、記、復原）在
// editor-session.test.ts「復原把這一步清掉的紀錄一起帶回來」。雲端（ADR 0014）：編輯器 module 在 Node 打開雲端流程
// （cloudEditor），復原、重做送成一步，伺服器收了、退回時的復原紀錄；復原帶回這一步清掉的紀錄、清掉和退回時紀錄跟伺服器對得上。
// 雲端的那幾組是 #320 從頁面測試 src/routes/cloud-undo.svelte.test.ts 搬來的（測試名字一樣），頁面留按鈕的接線測試。
import { describe, expect, it } from 'vitest';
import {
	dailyTable,
	deletePhase,
	rateCounts,
	recordAttempt,
	remoteChange,
	runCommands,
	takeRecords,
	type Attempt,
	type Command,
	type Flow,
	type RemoteChange
} from '#lib/core';
import { undoChanges } from '#lib/core/cloud-undo.js';
import type { RoomMessage } from '#lib/api-types/RoomMessage.js';
import { CORE_FINGERPRINT } from '#lib/core-fingerprint.js';
import { cloudEditor, fakeServer, flush, testEditor, type FakeCloudFlow } from '#lib/test-fakes.js';
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
		expect(s.session.notice).toBe('已復原：改流程名字');
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

	it('重做也一樣：王教練後來改過，提示這步不能重做，跳過；再按一次試前一步', async () => {
		const s = await cloudEditor();
		const w = s.joinAs('c1', s.wang.email);
		await flush();
		s.session.ask.send({ name: 'addSegment', args: ['chant'] });
		await flush();
		s.session.ask.send({ name: 'renameFlow', args: ['全國賽'] });
		await flush();
		s.session.undo();
		await flush();
		s.session.undo();
		await flush();
		expect(s.state.flows[0].flow.segments).toHaveLength(1);
		w.step({ name: 'renameFlow', args: ['區賽'] });
		await flush();

		// 重做的第一步是加段（王教練沒碰）
		s.session.redo();
		await flush();
		expect(s.state.flows[0].flow.segments).toHaveLength(2);
		// 第二步是改名字（王教練後來改過）
		s.session.redo();
		await flush();
		expect(s.session.notice).toBe('王教練後來改過，這步不能重做');
		expect(s.state.flows[0].flow.name).toBe('區賽');
		expect(s.session.flow).toEqual(s.state.flows[0].flow);
		expect(s.session.canRedo).toBe(false);
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
		expect(s.session.notice).toBe('王教練剛改了同一個地方，你的「改流程名字」沒改成');
		expect(s.session.undoLabel).toBe('加第 2 段');

		s.session.undo();
		await flush();
		expect(s.session.notice).toBe('已復原：加第 2 段');
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

describe('方向鍵連按', () => {
	it('每按一下送一步，復原時合成一步', async () => {
		const s = await cloudEditor();
		const opening = s.state.flows[0].flow.formations[0].id;
		const start = s.state.flows[0].flow.formations[0].pos.m1;
		for (const x of [1, 2]) {
			s.session.nudge('m1', { name: 'setPositions', args: [opening, { m1: [x, 0] }] });
			await flush();
		}
		expect(s.state.flows[0].step).toBe(2);

		s.session.undo();
		await flush();
		expect(s.state.flows[0].flow.formations[0].pos.m1).toEqual(start);
		expect(s.session.canUndo).toBe(false);
		s.session.redo();
		await flush();
		expect(s.state.flows[0].flow.formations[0].pos.m1).toEqual([2, 0]);
	});

	it('合成一步裡治好舊毛病的是後面那一按：復原送合了哪幾步，伺服器收了（ADR 0020）', async () => {
		const old = libSample();
		const [first] = old.formations;
		const flow: Flow = { ...old, formations: [{ ...first, pos: { ...first.pos, m1: [-10, 0] } }, ...old.formations.slice(1)] };
		const s = await cloudEditor({ flow, held: { keys: [`pos:${first.id}:m1`], core: CORE_FINGERPRINT } });
		s.session.nudge('k', { name: 'setPositions', args: [first.id, { m2: [1, 1] }] });
		await flush();
		s.session.nudge('k', { name: 'setPositions', args: [first.id, { m1: [-9, 0] }] });
		await flush();
		expect(s.state.flows[0].step).toBe(2);

		s.session.undo();
		await flush();
		expect(s.session.notice).toBe('已復原：改站位 1');
		expect(s.state.flows[0].flow.formations[0].pos.m1).toEqual([-10, 0]);
	});
});

describe('復原帶回這一步清掉的紀錄（ADR 0007）', () => {
	/** 王教練記的一次：11/4 分段練、整個做、第 1 組。 */
	const wangs = (id: string, marks: Attempt['marks']) => ({
		actionId: 'x1',
		attempt: { id, date: '2026-11-04', who: 'g1', practice: 'drill' as const, whole: true, marks },
		by: 'wang@example.com'
	});
	/** 林教練打開他的「測試」（libSample，紀錄是 records）；王教練是編輯者，也開著。 */
	async function bothOpen(records: FakeCloudFlow['records'] = []) {
		const s = await cloudEditor({ records });
		const w = s.joinAs('c1', s.wang.email);
		await flush();
		return { ...s, w };
	}
	/** 伺服器上還在的紀錄。 */
	const live = (s: { state: { flows: FakeCloudFlow[] } }) => (s.state.flows[0].records ?? []).filter((r) => !r.gone);
	/** 練習「每天的成功率」那張表（Lib 的）。 */
	const rates = (flow: Flow) => dailyTable(flow.actions.find((a) => a.id === 'x1')!);
	/** 按復原、重做（頁面的按鈕叫的就是這兩個）。 */
	async function undo(s: { session: { undo(): boolean } }) {
		s.session.undo();
		await flush();
	}
	async function redo(s: { session: { redo(): boolean } }) {
		s.session.redo();
		await flush();
	}

	it('復原刪環節：清掉的記號、整筆清掉的那一次都回來，成功率跟刪之前一樣（N02）；重做再清一次', async () => {
		// 兩次都在下法失敗
		const s = await bothOpen([wangs('t1', { p1: '✓', p2: '✓', p3: '✗' }), wangs('t2', { p1: '✓', p3: '✗' })]);
		const before = rates(s.session.flow!);
		const records = () => takeRecords(s.session.flow!).records;
		const kept = records();
		const server = () => live(s).map((r) => r.attempt);
		expect(kept).toHaveLength(2);

		s.session.ask.send({ name: 'deletePhase', args: ['x1', 'p3'], options: { confirmed: true } });
		await flush();
		expect(server().map((a) => a.marks)).toEqual([{ p1: '✓', p2: '✓' }, { p1: '✓' }]);

		await undo(s);
		expect(server()).toEqual(kept.map((r) => r.attempt));
		expect(records()).toEqual(kept);
		expect(rates(s.session.flow!)).toEqual(before);

		await redo(s);
		expect(server().map((a) => a.marks)).toEqual([{ p1: '✓', p2: '✓' }, { p1: '✓' }]);
		expect(records().map((r) => r.attempt.marks)).toEqual([{ p1: '✓', p2: '✓' }, { p1: '✓' }]);
	});

	it('redo clears records the step cleared：換人選清掉重算 → 復原 → 重做，換上來的人不接前一個人的紀錄', async () => {
		const s = await bothOpen([wangs('t1', { p1: '✓', p2: '✓', p3: '✗' })]);
		const kept = takeRecords(s.session.flow!).records;
		const server = () => live(s).map((r) => r.attempt);
		s.session.ask.send({ name: 'updateMember', args: ['m1', { name: '小琪' }], options: { records: 'clear' } });
		await flush();
		expect(server()).toEqual([]);

		await undo(s);
		expect(server()).toEqual(kept.map((r) => r.attempt));

		await redo(s);
		expect(server()).toEqual([]);
		expect(takeRecords(s.session.flow!).records).toEqual([]);
	});

	it('records snapshot keeps attempts a queued step cleared：還沒連上就改名清掉重算，進房間拿到的紀錄不會把清掉的放回來', async () => {
		// cloudEditor 打開時已經打完招呼；這裡要在打招呼之前就把房間的回答留著，自己開
		const pw = '我們這一隊今年一定會贏 go go';
		const fake = fakeServer({
			users: [
				{ email: 'lin@example.com', name: '林教練', isAdmin: false, password: pw },
				{ email: 'wang@example.com', name: '王教練', isAdmin: false, password: pw }
			],
			signedIn: 'lin@example.com',
			flows: [
				{
					id: 'c1',
					owner: 'lin@example.com',
					flow: libSample(),
					updatedAt: new Date(2026, 10, 7).toISOString(),
					records: [wangs('t1', { p1: '✓', p2: '✓', p3: '✗' })]
				}
			]
		});
		const { editor, session } = testEditor(null, { server: fake.server });
		// 打招呼還在路上（伺服器還沒給紀錄、還沒說可以送步）
		fake.state.holdRoom = true;
		await editor.file.openCloud('c1');
		await flush();
		expect(takeRecords(session.flow!).records).toHaveLength(1);
		session.ask.send({ name: 'updateMember', args: ['m1', { name: '小琪' }], options: { records: 'clear' } });
		expect(takeRecords(session.flow!).records).toEqual([]);

		fake.releaseRoom();
		await flush();
		await flush();
		expect(live(fake)).toEqual([]);
		expect(takeRecords(session.flow!).records).toEqual([]);
	});

	it('two queued clears on one action end like the server：連刪兩個環節，第一步跟著改的紀錄先到、第二步還在等，最後跟伺服器一樣', async () => {
		const s = await bothOpen([wangs('t1', { p1: '✓', p2: '✓', p3: '✗' })]);
		s.state.holdRoom = true;
		s.session.ask.send({ name: 'deletePhase', args: ['x1', 'p3'], options: { confirmed: true } });
		s.session.ask.send({ name: 'deletePhase', args: ['x1', 'p2'], options: { confirmed: true } });
		expect(takeRecords(s.session.flow!).records[0].attempt.marks).toEqual({ p1: '✓' });

		s.releaseRoom();
		await flush();
		await flush();
		const server = live(s).map((r) => r.attempt.marks);
		expect(server).toEqual([{ p1: '✓' }]);
		expect(takeRecords(s.session.flow!).records.map((r) => r.attempt.marks)).toEqual(server);
	});

	it('a step\'s own recordsChanged does not undo a mark correction in flight：刪環節還沒收到就改了一個記號，跟著改的紀錄到了再照畫面改另一個，兩個都留著', async () => {
		const s = await bothOpen([wangs('t1', { p1: '✓', p2: '✓', p3: '✓' })]);
		const t1 = () => takeRecords(s.session.flow!).records[0].attempt.marks;
		const heard = s.room.onmessage;
		// 刪環節跟著改的紀錄到了（第一個記號的回答還沒到）：再改另一個記號
		s.room.onmessage = (m) => {
			heard(m);
			if (m.kind !== 'recordsChanged') return;
			s.room.onmessage = heard;
			s.session.recordAsk().send({ name: 'changeAttempt', args: ['x1', 't1', { ...t1(), p2: '△' }] });
		};
		s.session.ask.send({ name: 'deletePhase', args: ['x1', 'p3'], options: { confirmed: true } });
		s.session.recordAsk().send({ name: 'changeAttempt', args: ['x1', 't1', { ...t1(), p1: '△' }] });
		await flush();
		await flush();

		// 第二次是照畫面上的改的：畫面上要是被舊的記號蓋掉，伺服器的 p1 又變回 ✓
		const server = live(s).map((r) => r.attempt.marks);
		expect(server).toEqual([{ p1: '△', p2: '△' }]);
		expect(takeRecords(s.session.flow!).records.map((r) => r.attempt.marks)).toEqual(server);
	});

	it('rollback of a rejected offline phase deletion keeps a mark another editor restored：斷線時刪環節，王教練復原他刪的環節、記號回來，連回來被退回，記號還在', async () => {
		const s = await bothOpen([wangs('t1', { p1: '✓', p2: '✓', p3: '✓' })]);
		// 王教練刪 p2（記號一起清掉），林教練看到了
		const was = s.state.flows[0].flow;
		s.w.room.send({ kind: 'step', stepId: 'swangdelp2aa', seen: 0, commands: [{ name: 'deletePhase', args: ['x1', 'p2'], options: { confirmed: true } }] });
		await flush();
		expect(takeRecords(s.session.flow!).records[0].attempt.marks).toEqual({ p1: '✓', p3: '✓' });
		// 林教練刪 p3 還沒送到就斷線
		s.state.holdRoom = true;
		s.session.ask.send({ name: 'deletePhase', args: ['x1', 'p3'], options: { confirmed: true } });
		s.disconnect(s.lin.email);
		s.releaseRoom();
		await flush();
		// 王教練復原：p2 和 t1 的 p2 回來
		const { undo: back } = undoChanges(was, s.state.flows[0].flow);
		s.w.room.send({ kind: 'undo', stepId: 'swangundop2a', seen: 1, of: 'swangdelp2aa', redo: false, change: back });
		await flush();
		expect((s.state.flows[0].records ?? []).map((r) => r.attempt.marks)).toEqual([{ p1: '✓', p2: '✓', p3: '✓' }]);

		s.reconnect(s.lin.email);
		await flush();
		await flush();
		expect(s.session.notice).toBe('王教練剛改了同一個地方，你的「改動作 技巧·Lib」沒改成');
		const server = live(s).map((r) => r.attempt.marks);
		expect(takeRecords(s.session.flow!).records.map((r) => r.attempt.marks)).toEqual(server);
		expect(takeRecords(s.session.flow!).flow).toEqual(s.state.flows[0].flow);
	});

	it('rollback after a downgrade shows the mark the server kept：改了記號又刪動作，擁有者改了那個記號、把我降成檢視者，退回後是伺服器的記號', async () => {
		const s = await bothOpen([wangs('t1', { p1: '✓' })]);
		const t1 = () => takeRecords(s.session.flow!).records[0];
		// 假伺服器的回答都先留著，照下面的順序一個一個說
		s.state.holdRoom = true;
		s.session.recordAsk().send({ name: 'changeAttempt', args: ['x1', 't1', { p1: '△' }] });
		await flush();
		const kept = { actionId: 'x1', attempt: { ...t1().attempt, marks: { p1: '✗' as const } }, mine: false, by: s.wang.name };
		s.session.ask.send({ name: 'deleteAction', args: ['x1'], options: { confirmed: true } });
		await flush();

		s.room.onmessage({ kind: 'recordsChanged', changed: [kept], deleted: [] });
		s.room.onmessage({ kind: 'recordsSaved', saved: [kept], dropped: [] });
		s.room.onmessage({ kind: 'roleChanged', role: 'viewer', flow: libSample(), step: 0 });
		await flush();

		expect(t1().attempt.marks).toEqual({ p1: '✗' });
	});

	it('reconnect keeps an attempt on a phase added meanwhile：改名清掉重算沒收到就斷線，王教練加了環節、記了另一組，連回來那一次還在', async () => {
		const s = await bothOpen([wangs('t1', { p1: '✓' })]);
		s.state.holdRoom = true;
		s.session.ask.send({ name: 'updateMember', args: ['m1', { name: '小琪' }], options: { records: 'clear' } });
		s.disconnect(s.lin.email);
		await flush();
		s.w.step({ name: 'addPhase', args: ['x1', { kind: 'hold', name: '再一次', beats: { at: 12, len: 4 } }] });
		s.releaseRoom();
		await flush();
		const phase = s.state.flows[0].flow.actions[0].successRate!.phases.at(-1)!.id;
		const t2 = { id: 'tphase2222220', date: '2026-11-04', who: 'g2', practice: 'drill' as const, whole: false, marks: { [phase]: '✓' as const } };
		s.recordAs('c1', s.wang.email, [{ actionId: 'x1', attempt: t2 }]);

		s.reconnect(s.lin.email);
		await flush();
		await flush();
		const ids = live(s).map((r) => r.attempt.id);
		expect(ids).toEqual(['tphase2222220']);
		expect(takeRecords(s.session.flow!).records.map((r) => r.attempt.id)).toEqual(ids);
	});

	it('reconnect keeps an attempt restored after a clear whose ack was lost：清掉重算收了、「收了」沒收到就斷線，王教練救回那一次，連回來還在', async () => {
		const s = await bothOpen([wangs('t1', { p1: '✓' })]);
		// 林教練的房間：第一次的「收了」在路上不見，接著斷線
		const heard = s.room.onmessage;
		s.room.onmessage = (m) => (m.kind === 'accepted' ? s.disconnect(s.lin.email) : heard(m));

		// 王教練刪了 t1，林教練還沒聽到就改名清掉重算；伺服器收了，「收了」不見
		s.state.holdRoom = true;
		s.w.room.send({ kind: 'deleteRecords', ids: ['t1'] });
		s.session.ask.send({ name: 'updateMember', args: ['m1', { name: '小琪' }], options: { records: 'clear' } });
		s.releaseRoom();
		await flush();
		expect(s.state.flows[0].flow.members[0].name).toBe('小琪');
		// 王教練救回 t1
		s.w.room.send({ kind: 'restoreRecords', ids: ['t1'] });
		await flush();
		s.room.onmessage = heard;

		s.reconnect(s.lin.email);
		await flush();
		await flush();
		const ids = live(s).map((r) => r.attempt.id);
		expect(ids).toEqual(['t1']);
		expect(takeRecords(s.session.flow!).records.map((r) => r.attempt.id)).toEqual(ids);
	});

	it('復原刪動作：動作和它的紀錄都回來', async () => {
		const s = await bothOpen([wangs('t1', { p1: '✓', p2: '✓', p3: '✗' })]);
		const kept = takeRecords(s.session.flow!).records;
		s.session.ask.send({ name: 'deleteAction', args: ['x1'], options: { confirmed: true } });
		await flush();
		expect(takeRecords(s.session.flow!).records).toEqual([]);

		await undo(s);
		expect(live(s).map((r) => r.attempt)).toEqual(kept.map((r) => r.attempt));
		expect(takeRecords(s.session.flow!).records).toEqual(kept);
	});

	it('rejected delete keeps saved attempts：刪動作被退回，動作回來，它的紀錄也回來', async () => {
		const s = await bothOpen([wangs('t1', { p1: '✓', p2: '✓', p3: '✗' }), wangs('t2', { p1: '✓' })]);
		const kept = takeRecords(s.session.flow!).records;
		s.state.holdRoom = true;
		s.w.step({ name: 'updateAction', args: ['x1', { note: '注意手' }] });
		s.session.ask.send({ name: 'deleteAction', args: ['x1'], options: { confirmed: true } });
		await flush();
		expect(takeRecords(s.session.flow!).records).toEqual([]);

		s.releaseRoom();
		await flush();
		expect(s.session.notice).toBe('王教練剛改了同一個地方，你的「刪動作 技巧·Lib」沒改成');
		expect(s.session.flow!.actions[0].note).toBe('注意手');
		expect(takeRecords(s.session.flow!).records).toEqual(kept);
	});

	it('rejected delete leaves out attempts deleted meanwhile：刪動作被退回，等的時候王教練刪掉的那一次不會跟著回來', async () => {
		const s = await bothOpen([wangs('t1', { p1: '✓', p2: '✓', p3: '✗' }), wangs('t2', { p1: '✓' })]);
		s.state.holdRoom = true;
		// 王教練刪掉 t2（告訴林教練的還在路上）
		s.w.room.send({ kind: 'deleteRecords', ids: ['t2'] });
		s.releaseRoom(true);
		// 王教練改了 x1；林教練還沒聽到，刪了動作 x1（畫面上連紀錄一起不見）
		s.w.step({ name: 'updateAction', args: ['x1', { note: '注意手' }] });
		s.session.ask.send({ name: 'deleteAction', args: ['x1'], options: { confirmed: true } });
		expect(takeRecords(s.session.flow!).records).toEqual([]);
		// 林教練先聽到 t2 刪了（動作不在畫面上），伺服器才收王教練的、退回林教練的
		s.releaseRoom();
		await flush();
		await flush();

		expect(s.session.notice).toBe('王教練剛改了同一個地方，你的「刪動作 技巧·Lib」沒改成');
		expect(live(s).map((r) => r.attempt.id)).toEqual(['t1']);
		expect(takeRecords(s.session.flow!).records.map((r) => r.attempt.id)).toEqual(['t1']);
	});

	it('rejected delete after reconnect leaves out attempts deleted meanwhile：刪動作沒送到就斷線，王教練刪了一次、改了動作，連回來被退回，那一次不會回來', async () => {
		const s = await bothOpen([wangs('t1', { p1: '✓', p2: '✓', p3: '✗' }), wangs('t2', { p1: '✓' })]);
		s.state.holdRoom = true;
		s.session.ask.send({ name: 'deleteAction', args: ['x1'], options: { confirmed: true } });
		s.disconnect(s.lin.email);
		await flush();
		s.w.room.send({ kind: 'deleteRecords', ids: ['t2'] });
		s.w.step({ name: 'updateAction', args: ['x1', { note: '注意手' }] });
		s.releaseRoom();
		await flush();

		s.reconnect(s.lin.email);
		await flush();
		await flush();
		expect(s.session.notice).toContain('沒改成');
		expect(live(s).map((r) => r.attempt.id)).toEqual(['t1']);
		expect(takeRecords(s.session.flow!).records.map((r) => r.attempt.id)).toEqual(['t1']);
	});

	it('被退回時別人新加的動作的紀錄留著（退回的那一步之後才聽到的動作）', async () => {
		const s = await bothOpen();
		s.state.holdRoom = true;
		// 王教練加了一個動作、記了一次、改了 x1，林教練都還沒聽到
		const members = ['m1', 'm2', 'm3', 'm4'].map((memberId, i) => ({ memberId, role: i % 3 ? '主底' : '上層' }));
		s.w.step({ name: 'addAction', args: [{ segmentId: 's1', category: 'stunt', name: 'Ext', start: 16, length: 8, note: '', members }] });
		s.releaseRoom(true);
		const x2 = s.state.flows[0].flow.actions[1].id;
		s.w.step(
			{ name: 'addPhase', args: [x2, { kind: 'load', name: '', beats: { at: 0, len: 8 } }] },
			{ name: 'setSquad', args: [x2, ['m1', 'm2', 'm3', 'm4'], 1] }
		);
		s.releaseRoom(true);
		const ext = s.state.flows[0].flow.actions[1];
		const t3 = wangs('text000000003', { [ext.successRate!.phases[0].id]: '✓' });
		s.recordAs('c1', s.wang.email, [{ ...t3, actionId: x2, attempt: { ...t3.attempt, who: ext.squadOrder![0] } }]);
		s.w.step({ name: 'updateAction', args: ['x1', { note: '注意手' }] });
		// 林教練刪 x1（做的時候還沒有那個動作）
		s.session.ask.send({ name: 'deleteAction', args: ['x1'], options: { confirmed: true } });
		await flush();

		s.releaseRoom();
		await flush();
		await flush();
		expect(s.session.notice).toBe('王教練剛改了同一個地方，你的「刪動作 技巧·Lib」沒改成');
		const server = live(s).map(({ actionId, attempt }) => ({ actionId, attempt }));
		expect(server.map((r) => r.attempt.id)).toEqual(['text000000003']);
		expect(takeRecords(s.session.flow!).records).toEqual(server);
	});
});
