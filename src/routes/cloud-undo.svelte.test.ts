// 頁面：雲端流程的復原、重做（#256，ADR 0014）。復原也是一步：送那一步改到的東西改之前的樣子（重做送改之後的），
// 別人改的別的東西留著。那些東西後來被別的分頁改過：提示「王教練後來改過，這步不能復原」，跳過；再按一次試前一步。重做一樣。
// 伺服器換成測試共用的假伺服器（fakeServer）：別人用 joinAs 在別的地方打開、送步。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { takeRecords, undoChanges, type Attempt } from '#lib/core';
import { editorPage, fromMenu, fakeServer, flush, type FakeCloudFlow } from '#lib/test-fakes.js';
import { libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

const pw = '我們這一隊今年一定會贏 go go';
const lin = { email: 'lin@example.com', name: '林教練', isAdmin: false, password: pw };
const wang = { email: 'wang@example.com', name: '王教練', isAdmin: false, password: pw };

/** 林教練登入，打開他的「測試」（libSample，紀錄是 records）；王教練是編輯者，也開著。room 是林教練的房間。 */
async function bothOpen(records: FakeCloudFlow['records'] = []) {
	const fake = fakeServer({
		users: [lin, wang],
		signedIn: lin.email,
		flows: [
			{
				id: 'c1',
				owner: lin.email,
				flow: libSample(),
				updatedAt: new Date(2026, 10, 7).toISOString(),
				people: { [wang.email]: 'editor' },
				records
			}
		]
	});
	const open = fake.server.openRoom.bind(fake.server);
	let room: ReturnType<typeof open> | null = null;
	fake.server.openRoom = (id) => (room ??= open(id));
	const page = editorPage(null, { server: fake.server });
	render(Page, page.props);
	await flush();
	await fireEvent.click(screen.getByRole('button', { name: /^測試/ }));
	await flush();
	fake.server.openRoom = open;
	const w = fake.joinAs('c1', wang.email);
	await flush();
	return { ...fake, page, w, room: room! };
}

/** 流程設定改流程名字。 */
async function rename(name: string) {
	await fromMenu('流程設定');
	await fireEvent.change(screen.getByLabelText('流程名字'), { target: { value: name } });
	await fireEvent.click(screen.getByRole('button', { name: '關閉' }));
	await flush();
}

/** 加一段口號（林教練）。 */
async function addSegment(s: Awaited<ReturnType<typeof bothOpen>>) {
	s.page.session.ask.send({ name: 'addSegment', args: ['chant'] });
	await flush();
}

async function press(button: '復原' | '重做') {
	await fireEvent.click(screen.getByRole('button', { name: button }));
	await flush();
}

const status = () => screen.getByRole('status').textContent;

describe('雲端流程的復原、重做', () => {
	it('復原送伺服器，別人改的別的東西留著；重做也送', async () => {
		const s = await bothOpen();
		await rename('全國賽');
		s.w.step({ name: 'addSegment', args: ['chant'] });
		await flush();

		await press('復原');
		expect(status()).toBe('已復原：改流程名字');
		const server = s.state.flows[0];
		expect(server.flow.name).toBe('測試');
		expect(server.flow.segments).toHaveLength(2);
		expect(s.page.session.flow).toEqual(server.flow);

		await press('重做');
		expect(server.flow.name).toBe('全國賽');
		expect(s.page.session.flow).toEqual(server.flow);
	});

	it('王教練後來改過：提示這步不能復原，跳過；再按一次試前一步', async () => {
		const s = await bothOpen();
		await addSegment(s);
		await rename('全國賽');
		s.w.step({ name: 'renameFlow', args: ['區賽'] });
		await flush();

		await press('復原');
		expect(status()).toBe('王教練後來改過，這步不能復原');
		expect(s.page.session.flow!.name).toBe('區賽');
		expect(s.page.session.flow).toEqual(s.state.flows[0].flow);

		await press('復原');
		expect(status()).toBe('已復原：加第 2 段');
		expect(s.state.flows[0].flow.segments).toHaveLength(1);
		expect(s.state.flows[0].flow.name).toBe('區賽');
		expect(s.page.session.flow).toEqual(s.state.flows[0].flow);
	});

	it('重做也一樣：王教練後來改過，提示這步不能重做，跳過；再按一次試前一步', async () => {
		const s = await bothOpen();
		await addSegment(s);
		await rename('全國賽');
		await press('復原');
		await press('復原');
		expect(s.state.flows[0].flow.segments).toHaveLength(1);
		s.w.step({ name: 'renameFlow', args: ['區賽'] });
		await flush();

		// 重做的第一步是加段（王教練沒碰）
		await press('重做');
		expect(s.state.flows[0].flow.segments).toHaveLength(2);
		// 第二步是改名字（王教練後來改過）
		await press('重做');
		expect(status()).toBe('王教練後來改過，這步不能重做');
		expect(s.state.flows[0].flow.name).toBe('區賽');
		expect(s.page.session.flow).toEqual(s.state.flows[0].flow);
		expect(s.page.session.canRedo).toBe(false);
	});

	it('被退回的步不算：復原不會試它', async () => {
		const s = await bothOpen();
		await addSegment(s);
		s.state.holdRoom = true;
		s.w.step({ name: 'renameFlow', args: ['區賽'] });
		await rename('全國賽');
		s.releaseRoom();
		await flush();
		expect(status()).toBe('王教練剛改了同一個地方，你的「改流程名字」沒改成');

		await press('復原');
		expect(status()).toBe('已復原：加第 2 段');
		expect(s.state.flows[0].flow.segments).toHaveLength(1);
		expect(s.page.session.canUndo).toBe(false);
	});
});

describe('復原帶回這一步清掉的紀錄（ADR 0007）', () => {
	/** 王教練記的一次：11/4 分段練、整個做、第 1 組。 */
	const wangs = (id: string, marks: Attempt['marks']) => ({
		actionId: 'x1',
		attempt: { id, date: '2026-11-04', who: 'g1', practice: 'drill' as const, whole: true, marks },
		by: wang.email
	});
	/** 練習的總表：每天的成功率。 */
	async function rates(): Promise<string[][]> {
		await fireEvent.click(screen.getByRole('button', { name: '練習' }));
		const table = screen.getByRole('table', { name: '每天的成功率' });
		const rows = within(table)
			.getAllByRole('row')
			.map((row) => Array.from(row.children).map((c) => c.textContent?.replace(/\s+/g, ' ').trim() ?? ''));
		await fireEvent.click(screen.getByRole('button', { name: '編排' }));
		return rows;
	}

	it('復原刪環節：清掉的記號、整筆清掉的那一次都回來，成功率跟刪之前一樣（N02）；重做再清一次', async () => {
		// 兩次都在下法失敗
		const s = await bothOpen([wangs('t1', { p1: '✓', p2: '✓', p3: '✗' }), wangs('t2', { p1: '✓', p3: '✗' })]);
		const before = await rates();
		const records = () => takeRecords(s.page.session.flow!).records;
		const kept = records();
		const server = () => (s.state.flows[0].records ?? []).filter((r) => !r.gone).map((r) => r.attempt);
		expect(kept).toHaveLength(2);

		s.page.session.ask.send({ name: 'deletePhase', args: ['x1', 'p3'], options: { confirmed: true } });
		await flush();
		expect(server().map((a) => a.marks)).toEqual([{ p1: '✓', p2: '✓' }, { p1: '✓' }]);

		await press('復原');
		expect(server()).toEqual(kept.map((r) => r.attempt));
		expect(records()).toEqual(kept);
		expect(await rates()).toEqual(before);

		await press('重做');
		expect(server().map((a) => a.marks)).toEqual([{ p1: '✓', p2: '✓' }, { p1: '✓' }]);
		expect(records().map((r) => r.attempt.marks)).toEqual([{ p1: '✓', p2: '✓' }, { p1: '✓' }]);
	});

	it('redo clears records the step cleared：換人選清掉重算 → 復原 → 重做，換上來的人不接前一個人的紀錄', async () => {
		const s = await bothOpen([wangs('t1', { p1: '✓', p2: '✓', p3: '✗' })]);
		const kept = takeRecords(s.page.session.flow!).records;
		const server = () => (s.state.flows[0].records ?? []).filter((r) => !r.gone).map((r) => r.attempt);
		s.page.session.ask.send({ name: 'updateMember', args: ['m1', { name: '小琪' }], options: { records: 'clear' } });
		await flush();
		expect(server()).toEqual([]);

		await press('復原');
		expect(server()).toEqual(kept.map((r) => r.attempt));

		await press('重做');
		expect(server()).toEqual([]);
		expect(takeRecords(s.page.session.flow!).records).toEqual([]);
	});

	it('records snapshot keeps attempts a queued step cleared：還沒連上就改名清掉重算，進房間拿到的紀錄不會把清掉的放回來', async () => {
		const fake = fakeServer({
			users: [lin, wang],
			signedIn: lin.email,
			flows: [
				{
					id: 'c1',
					owner: lin.email,
					flow: libSample(),
					updatedAt: new Date(2026, 10, 7).toISOString(),
					records: [wangs('t1', { p1: '✓', p2: '✓', p3: '✗' })]
				}
			]
		});
		const page = editorPage(null, { server: fake.server });
		render(Page, page.props);
		await flush();
		// 打招呼還在路上（伺服器還沒給紀錄、還沒說可以送步）
		fake.state.holdRoom = true;
		await fireEvent.click(screen.getByRole('button', { name: /^測試/ }));
		await flush();
		expect(takeRecords(page.session.flow!).records).toHaveLength(1);
		page.session.ask.send({ name: 'updateMember', args: ['m1', { name: '小琪' }], options: { records: 'clear' } });
		expect(takeRecords(page.session.flow!).records).toEqual([]);

		fake.releaseRoom();
		await flush();
		await flush();
		expect((fake.state.flows[0].records ?? []).filter((r) => !r.gone)).toEqual([]);
		expect(takeRecords(page.session.flow!).records).toEqual([]);
	});

	it('two queued clears on one action end like the server：連刪兩個環節，第一步跟著改的紀錄先到、第二步還在等，最後跟伺服器一樣', async () => {
		const s = await bothOpen([wangs('t1', { p1: '✓', p2: '✓', p3: '✗' })]);
		s.state.holdRoom = true;
		s.page.session.ask.send({ name: 'deletePhase', args: ['x1', 'p3'], options: { confirmed: true } });
		s.page.session.ask.send({ name: 'deletePhase', args: ['x1', 'p2'], options: { confirmed: true } });
		expect(takeRecords(s.page.session.flow!).records[0].attempt.marks).toEqual({ p1: '✓' });

		s.releaseRoom();
		await flush();
		await flush();
		const server = (s.state.flows[0].records ?? []).filter((r) => !r.gone).map((r) => r.attempt.marks);
		expect(server).toEqual([{ p1: '✓' }]);
		expect(takeRecords(s.page.session.flow!).records.map((r) => r.attempt.marks)).toEqual(server);
	});

	it('a step\'s own recordsChanged does not undo a mark correction in flight：刪環節還沒收到就改了一個記號，跟著改的紀錄到了再照畫面改另一個，兩個都留著', async () => {
		const s = await bothOpen([wangs('t1', { p1: '✓', p2: '✓', p3: '✓' })]);
		const t1 = () => takeRecords(s.page.session.flow!).records[0].attempt.marks;
		const heard = s.room.onmessage;
		// 刪環節跟著改的紀錄到了（第一個記號的回答還沒到）：再改另一個記號
		s.room.onmessage = (m) => {
			heard(m);
			if (m.kind !== 'recordsChanged') return;
			s.room.onmessage = heard;
			s.page.session.recordAsk().send({ name: 'changeAttempt', args: ['x1', 't1', { ...t1(), p2: '△' }] });
		};
		s.page.session.ask.send({ name: 'deletePhase', args: ['x1', 'p3'], options: { confirmed: true } });
		s.page.session.recordAsk().send({ name: 'changeAttempt', args: ['x1', 't1', { ...t1(), p1: '△' }] });
		await flush();
		await flush();

		// 第二次是照畫面上的改的：畫面上要是被舊的記號蓋掉，伺服器的 p1 又變回 ✓
		const server = (s.state.flows[0].records ?? []).filter((r) => !r.gone).map((r) => r.attempt.marks);
		expect(server).toEqual([{ p1: '△', p2: '△' }]);
		expect(takeRecords(s.page.session.flow!).records.map((r) => r.attempt.marks)).toEqual(server);
	});

	it('rollback of a rejected offline phase deletion keeps a mark another editor restored：斷線時刪環節，王教練復原他刪的環節、記號回來，連回來被退回，記號還在', async () => {
		const s = await bothOpen([wangs('t1', { p1: '✓', p2: '✓', p3: '✓' })]);
		// 王教練刪 p2（記號一起清掉），林教練看到了
		const was = s.state.flows[0].flow;
		s.w.room.send({ kind: 'step', stepId: 'swangdelp2aa', seen: 0, commands: [{ name: 'deletePhase', args: ['x1', 'p2'], options: { confirmed: true } }] });
		await flush();
		expect(takeRecords(s.page.session.flow!).records[0].attempt.marks).toEqual({ p1: '✓', p3: '✓' });
		// 林教練刪 p3 還沒送到就斷線
		s.state.holdRoom = true;
		s.page.session.ask.send({ name: 'deletePhase', args: ['x1', 'p3'], options: { confirmed: true } });
		s.disconnect(lin.email);
		s.releaseRoom();
		await flush();
		// 王教練復原：p2 和 t1 的 p2 回來
		const { undo } = undoChanges(was, s.state.flows[0].flow);
		s.w.room.send({ kind: 'undo', stepId: 'swangundop2a', seen: 1, of: 'swangdelp2aa', redo: false, change: undo });
		await flush();
		expect((s.state.flows[0].records ?? []).map((r) => r.attempt.marks)).toEqual([{ p1: '✓', p2: '✓', p3: '✓' }]);

		s.reconnect(lin.email);
		await flush();
		await flush();
		expect(status()).toBe('王教練剛改了同一個地方，你的「改動作 技巧·Lib」沒改成');
		const server = (s.state.flows[0].records ?? []).filter((r) => !r.gone).map((r) => r.attempt.marks);
		expect(takeRecords(s.page.session.flow!).records.map((r) => r.attempt.marks)).toEqual(server);
		expect(takeRecords(s.page.session.flow!).flow).toEqual(s.state.flows[0].flow);
	});

	it('reconnect keeps an attempt on a phase added meanwhile：改名清掉重算沒收到就斷線，王教練加了環節、記了另一組，連回來那一次還在', async () => {
		const s = await bothOpen([wangs('t1', { p1: '✓' })]);
		s.state.holdRoom = true;
		s.page.session.ask.send({ name: 'updateMember', args: ['m1', { name: '小琪' }], options: { records: 'clear' } });
		s.disconnect(lin.email);
		await flush();
		s.w.step({ name: 'addPhase', args: ['x1', { kind: 'hold', name: '再一次', beats: { at: 12, len: 4 } }] });
		s.releaseRoom();
		await flush();
		const phase = s.state.flows[0].flow.actions[0].successRate!.phases.at(-1)!.id;
		const t2 = { id: 'tphase2222220', date: '2026-11-04', who: 'g2', practice: 'drill' as const, whole: false, marks: { [phase]: '✓' as const } };
		s.recordAs('c1', wang.email, [{ actionId: 'x1', attempt: t2 }]);

		s.reconnect(lin.email);
		await flush();
		await flush();
		const live = (s.state.flows[0].records ?? []).filter((r) => !r.gone).map((r) => r.attempt.id);
		expect(live).toEqual(['tphase2222220']);
		expect(takeRecords(s.page.session.flow!).records.map((r) => r.attempt.id)).toEqual(live);
	});

	it('reconnect keeps an attempt restored after a clear whose ack was lost：清掉重算收了、「收了」沒收到就斷線，王教練救回那一次，連回來還在', async () => {
		const fake = fakeServer({
			users: [lin, wang],
			signedIn: lin.email,
			flows: [
				{
					id: 'c1',
					owner: lin.email,
					flow: libSample(),
					updatedAt: new Date(2026, 10, 7).toISOString(),
					people: { [wang.email]: 'editor' },
					records: [wangs('t1', { p1: '✓' })]
				}
			]
		});
		// 林教練的房間：第一次的「收了」在路上不見，接著斷線
		const open = fake.server.openRoom.bind(fake.server);
		let mine: ReturnType<typeof open> | null = null;
		fake.server.openRoom = (id) => {
			const room = open(id);
			mine ??= room;
			return room;
		};
		const page = editorPage(null, { server: fake.server });
		render(Page, page.props);
		await flush();
		await fireEvent.click(screen.getByRole('button', { name: /^測試/ }));
		await flush();
		const w = fake.joinAs('c1', wang.email);
		await flush();
		const room = mine!;
		const heard = room.onmessage;
		room.onmessage = (m) => (m.kind === 'accepted' ? fake.disconnect(lin.email) : heard(m));

		// 王教練刪了 t1，林教練還沒聽到就改名清掉重算；伺服器收了，「收了」不見
		fake.state.holdRoom = true;
		w.room.send({ kind: 'deleteRecords', ids: ['t1'] });
		page.session.ask.send({ name: 'updateMember', args: ['m1', { name: '小琪' }], options: { records: 'clear' } });
		fake.releaseRoom();
		await flush();
		expect(fake.state.flows[0].flow.members[0].name).toBe('小琪');
		// 王教練救回 t1
		w.room.send({ kind: 'restoreRecords', ids: ['t1'] });
		await flush();
		room.onmessage = heard;

		fake.reconnect(lin.email);
		await flush();
		await flush();
		const live = (fake.state.flows[0].records ?? []).filter((r) => !r.gone).map((r) => r.attempt.id);
		expect(live).toEqual(['t1']);
		expect(takeRecords(page.session.flow!).records.map((r) => r.attempt.id)).toEqual(live);
	});

	it('復原刪動作：動作和它的紀錄都回來', async () => {
		const s = await bothOpen([wangs('t1', { p1: '✓', p2: '✓', p3: '✗' })]);
		const kept = takeRecords(s.page.session.flow!).records;
		s.page.session.ask.send({ name: 'deleteAction', args: ['x1'], options: { confirmed: true } });
		await flush();
		expect(takeRecords(s.page.session.flow!).records).toEqual([]);

		await press('復原');
		expect((s.state.flows[0].records ?? []).filter((r) => !r.gone).map((r) => r.attempt)).toEqual(kept.map((r) => r.attempt));
		expect(takeRecords(s.page.session.flow!).records).toEqual(kept);
	});

	it('rejected delete keeps saved attempts：刪動作被退回，動作回來，它的紀錄也回來', async () => {
		const s = await bothOpen([wangs('t1', { p1: '✓', p2: '✓', p3: '✗' }), wangs('t2', { p1: '✓' })]);
		const kept = takeRecords(s.page.session.flow!).records;
		s.state.holdRoom = true;
		s.w.step({ name: 'updateAction', args: ['x1', { note: '注意手' }] });
		s.page.session.ask.send({ name: 'deleteAction', args: ['x1'], options: { confirmed: true } });
		await flush();
		expect(takeRecords(s.page.session.flow!).records).toEqual([]);

		s.releaseRoom();
		await flush();
		expect(status()).toBe('王教練剛改了同一個地方，你的「刪動作 技巧·Lib」沒改成');
		expect(s.page.session.flow!.actions[0].note).toBe('注意手');
		expect(takeRecords(s.page.session.flow!).records).toEqual(kept);
	});

	it('rejected delete leaves out attempts deleted meanwhile：刪動作被退回，等的時候王教練刪掉的那一次不會跟著回來', async () => {
		const s = await bothOpen([wangs('t1', { p1: '✓', p2: '✓', p3: '✗' }), wangs('t2', { p1: '✓' })]);
		s.state.holdRoom = true;
		// 王教練刪掉 t2（告訴林教練的還在路上）
		s.w.room.send({ kind: 'deleteRecords', ids: ['t2'] });
		s.releaseRoom(true);
		// 王教練改了 x1；林教練還沒聽到，刪了動作 x1（畫面上連紀錄一起不見）
		s.w.step({ name: 'updateAction', args: ['x1', { note: '注意手' }] });
		s.page.session.ask.send({ name: 'deleteAction', args: ['x1'], options: { confirmed: true } });
		expect(takeRecords(s.page.session.flow!).records).toEqual([]);
		// 林教練先聽到 t2 刪了（動作不在畫面上），伺服器才收王教練的、退回林教練的
		s.releaseRoom();
		await flush();
		await flush();

		expect(status()).toBe('王教練剛改了同一個地方，你的「刪動作 技巧·Lib」沒改成');
		const server = (s.state.flows[0].records ?? []).filter((r) => !r.gone).map((r) => r.attempt.id);
		expect(server).toEqual(['t1']);
		expect(takeRecords(s.page.session.flow!).records.map((r) => r.attempt.id)).toEqual(['t1']);
	});

	it('rejected delete after reconnect leaves out attempts deleted meanwhile：刪動作沒送到就斷線，王教練刪了一次、改了動作，連回來被退回，那一次不會回來', async () => {
		const s = await bothOpen([wangs('t1', { p1: '✓', p2: '✓', p3: '✗' }), wangs('t2', { p1: '✓' })]);
		s.state.holdRoom = true;
		s.page.session.ask.send({ name: 'deleteAction', args: ['x1'], options: { confirmed: true } });
		s.disconnect(lin.email);
		await flush();
		s.w.room.send({ kind: 'deleteRecords', ids: ['t2'] });
		s.w.step({ name: 'updateAction', args: ['x1', { note: '注意手' }] });
		s.releaseRoom();
		await flush();

		s.reconnect(lin.email);
		await flush();
		await flush();
		expect(status()).toContain('沒改成');
		expect((s.state.flows[0].records ?? []).filter((r) => !r.gone).map((r) => r.attempt.id)).toEqual(['t1']);
		expect(takeRecords(s.page.session.flow!).records.map((r) => r.attempt.id)).toEqual(['t1']);
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
		s.recordAs('c1', wang.email, [{ ...t3, actionId: x2, attempt: { ...t3.attempt, who: ext.squadOrder![0] } }]);
		s.w.step({ name: 'updateAction', args: ['x1', { note: '注意手' }] });
		// 林教練刪 x1（做的時候還沒有那個動作）
		s.page.session.ask.send({ name: 'deleteAction', args: ['x1'], options: { confirmed: true } });
		await flush();

		s.releaseRoom();
		await flush();
		await flush();
		expect(status()).toBe('王教練剛改了同一個地方，你的「刪動作 技巧·Lib」沒改成');
		const server = (s.state.flows[0].records ?? []).filter((r) => !r.gone).map(({ actionId, attempt }) => ({ actionId, attempt }));
		expect(server.map((r) => r.attempt.id)).toEqual(['text000000003']);
		expect(takeRecords(s.page.session.flow!).records).toEqual(server);
	});
});

describe('方向鍵連按', () => {
	it('每按一下送一步，復原時合成一步', async () => {
		const s = await bothOpen();
		const opening = s.state.flows[0].flow.formations[0].id;
		const start = s.state.flows[0].flow.formations[0].pos.m1;
		for (const x of [1, 2]) {
			s.page.session.nudge('m1', { name: 'setPositions', args: [opening, { m1: [x, 0] }] });
			await flush();
		}
		expect(s.state.flows[0].step).toBe(2);

		await press('復原');
		expect(s.state.flows[0].flow.formations[0].pos.m1).toEqual(start);
		expect(s.page.session.canUndo).toBe(false);
		await press('重做');
		expect(s.state.flows[0].flow.formations[0].pos.m1).toEqual([2, 0]);
	});
});
