// 編輯器 module 在 Node：改到同一個東西時，後到的退回（#254），和之後的復原、重做（ADR 0014）（#320 從頁面測試
// src/routes/cloud-same-thing.svelte.test.ts 搬來，測試名字一樣）。別人剛改了同一個地方：提示寫是誰、我的哪一步沒改成；
// 換成伺服器的樣子，後面還沒送到的步也不見。頁面留一個接線測試（退回的提示、名字旁「✓ 已存」）。
// 伺服器是測試共用的假伺服器（fakeServer），cloudEditor 打開；別人用 joinAs 在別的地方打開、送步。
import { describe, expect, it, vi } from 'vitest';
import type { NewMemberInput } from '#lib/core';
import { undoChanges } from '#lib/core/cloud-undo.js';
import { cloudEditor, flush } from '#lib/test-fakes.js';
import { libSample } from '#lib/test-flows.js';

/** 林教練打開他的「測試」（libSample）；王教練是編輯者，也開著。 */
async function bothOpen() {
	const s = await cloudEditor();
	const w = s.joinAs('c1', s.wang.email);
	await flush();
	return { ...s, w };
}

/** 加一個隊員的指令。 */
const add = (name: string) => ({
	name: 'addMembers' as const,
	args: [[{ name, gender: 'F' as const, globalRole: 'top' as const }]] as [NewMemberInput[]]
});

/** 按復原、重做（頁面的按鈕叫的就是這兩個）。 */
async function undo(s: Awaited<ReturnType<typeof bothOpen>>) {
	s.session.undo();
	await flush();
}
async function redo(s: Awaited<ReturnType<typeof bothOpen>>) {
	s.session.redo();
	await flush();
}

describe('改到同一個東西', () => {
	it('王教練剛改了同一個地方：提示是誰、哪一步沒改成；換成伺服器的樣子，後面還沒送到的步不見', async () => {
		const s = await bothOpen();
		s.state.holdRoom = true;
		// 王教練先到；林教練沒看到，也改名字，接著又加一段（還沒送到）
		s.w.step({ name: 'renameFlow', args: ['區賽'] });
		s.session.ask.send({ name: 'renameFlow', args: ['全國賽'] });
		s.session.ask.send({ name: 'addSegment', args: ['chant'] });
		expect(s.session.flow!.segments).toHaveLength(2);

		s.releaseRoom();
		await flush();

		expect(s.session.notice).toBe('王教練剛改了同一個地方，你的「改流程名字」沒改成');
		expect(s.session.flow).toEqual(s.state.flows[0].flow);
		expect(s.session.flow!.name).toBe('區賽');
		expect(s.session.flow!.segments).toHaveLength(1);
		expect(s.state.flows[0].step).toBe(1);
		expect(s.editor.file.cloud!.saving).toBe(false);

		// 換成伺服器的樣子之後再改：收
		s.session.ask.send({ name: 'renameFlow', args: ['全國賽'] });
		await flush();
		expect(s.state.flows[0].flow.name).toBe('全國賽');
	});

	it('合起來被規則擋下：再加上原因', async () => {
		const s = await bothOpen();
		s.state.holdRoom = true;
		// 王教練先在第 3.2 秒插了站位；林教練沒看到，也在同一拍插
		s.w.step({ name: 'insertFormation', args: [3.2] });
		s.session.ask.send({ name: 'insertFormation', args: [3.2] });
		s.releaseRoom();
		await flush();

		expect(s.session.notice).toBe('王教練剛改了流程，你的「插入站位 2」沒改成：這一拍已經有站位');
		expect(s.session.flow).toEqual(s.state.flows[0].flow);
	});

	it('兩個人同時各加一個隊員：都收；我這邊換成伺服器放的位置和順序，不會跟王教練加的人疊在一起', async () => {
		const s = await bothOpen();
		s.state.holdRoom = true;
		// 王教練先到；林教練沒看到，也加一個（兩邊都從同一份開始，林教練自己的畫面把小華放在王教練加的人會在的位置）
		s.w.step(add('小新'));
		s.session.ask.send(add('小華'));

		s.releaseRoom();
		await flush();

		const server = s.state.flows[0].flow;
		expect(s.state.flows[0].step).toBe(2);
		expect(s.session.flow!.members.map((m) => m.name)).toEqual(server.members.map((m) => m.name));
		expect(s.session.flow!.formations).toEqual(server.formations);
		expect(s.session.flow).toEqual(server);
		expect(s.editor.file.cloud!.saving).toBe(false);
	});

	it('action edit queued behind a step still gets sent：前一步還沒收時用動作表單改動作，前一步收了照樣送出去', async () => {
		const s = await bothOpen();
		s.state.holdRoom = true;
		s.session.ask.send({ name: 'renameFlow', args: ['全國賽'] });
		// 動作表單的人是畫面上的狀態（$state），跟著這一步排在後面
		s.session.selectAction('x1');
		await flush();
		const draft = s.editor.actionDraft;
		draft.note = '注意手';
		draft.update();
		expect(s.session.flow!.actions[0].note).toBe('注意手');

		s.releaseRoom();
		await flush();
		await flush();

		expect(s.state.flows[0].flow.name).toBe('全國賽');
		expect(s.state.flows[0].flow.actions[0].note).toBe('注意手');
		expect(s.editor.file.cloud!.saving).toBe(false);
	});

	it('redo after undo keeps the spot the server gave：同時加隊員、我的人被放到別的位置，復原再重做不會跟王教練加的人疊在一起', async () => {
		const s = await bothOpen();
		s.state.holdRoom = true;
		s.w.step(add('小新'));
		s.session.ask.send(add('小華'));
		s.releaseRoom();
		await flush();
		const placed = structuredClone(s.state.flows[0].flow);

		await undo(s);
		expect(s.state.flows[0].flow.members.map((m) => m.name)).not.toContain('小華');
		await redo(s);

		const server = s.state.flows[0].flow;
		const spots = Object.values(server.formations[0].pos).map((p) => p.join());
		expect(new Set(spots).size).toBe(server.members.length);
		expect(server.formations).toEqual(placed.formations);
		expect(s.session.flow).toEqual(server);
	});

	it('redo after undo keeps a roster move made meanwhile：同時加隊員，王教練把他的人調到最前面，我復原再重做不會把他的人搬回去', async () => {
		const s = await bothOpen();
		s.state.holdRoom = true;
		s.w.step(add('小新'));
		s.session.ask.send(add('小華'));
		s.releaseRoom();
		await flush();
		const xin = s.state.flows[0].flow.members.find((m) => m.name === '小新')!.id;
		s.w.step({ name: 'moveMember', args: [xin, 0] });
		await flush();
		expect(s.state.flows[0].flow.members[0].name).toBe('小新');
		const order = s.state.flows[0].flow.members.map((m) => m.name);

		await undo(s);
		await redo(s);

		const server = s.state.flows[0].flow;
		expect(server.members.map((m) => m.name)).toEqual(order);
		expect(s.session.flow).toEqual(server);
	});

	it('redo after undo keeps the accepted segment order：兩個人同時在同一段後面加段，我復原再重做，播的順序還是 A、我的、他的', async () => {
		const s = await bothOpen();
		const a = s.state.flows[0].flow.segments[0].id;
		s.state.holdRoom = true;
		s.w.step({ name: 'addSegment', args: ['chant', a] });
		s.session.ask.send({ name: 'addSegment', args: ['chant', a] });
		s.releaseRoom();
		await flush();
		const order = s.state.flows[0].flow.segments.map((g) => g.id);
		const mine = s.session.flow!.segments[1].id;
		expect(order.indexOf(mine)).toBe(1);
		expect(s.session.flow).toEqual(s.state.flows[0].flow);

		await undo(s);
		await redo(s);

		expect(s.state.flows[0].flow.segments.map((g) => g.id)).toEqual(order);
		expect(s.session.flow).toEqual(s.state.flows[0].flow);
	});

	it('redo after undo puts a teammate back where the server had it：同時加隊員，沒人調順序，我復原再重做，名單跟收了的時候一樣', async () => {
		const s = await bothOpen();
		s.state.holdRoom = true;
		s.w.step(add('小新'));
		s.session.ask.send(add('小華'));
		s.releaseRoom();
		await flush();
		const order = s.state.flows[0].flow.members.map((m) => m.name);

		await undo(s);
		await redo(s);

		expect(s.state.flows[0].flow.members.map((m) => m.name)).toEqual(order);
		expect(s.session.flow).toEqual(s.state.flows[0].flow);
	});

	it('redo of a roster move still moves：王教練加了隊員，我調順序、復原再重做，還是調好的順序', async () => {
		const s = await bothOpen();
		s.w.step(add('小新'));
		await flush();
		const last = s.session.flow!.members.at(-2)!.id;
		s.session.ask.send({ name: 'moveMember', args: [last, 0] });
		await flush();
		const moved = s.state.flows[0].flow.members.map((m) => m.id);
		expect(moved[0]).toBe(last);

		await undo(s);
		await redo(s);

		expect(s.state.flows[0].flow.members.map((m) => m.id)).toEqual(moved);
		expect(s.session.flow).toEqual(s.state.flows[0].flow);
	});

	it('redo keeps formations in time order：我在 3.2 秒加站位、復原，王教練在 1.6 秒加一張，我重做，站位照時間排、伺服器收了', async () => {
		const s = await bothOpen();
		s.session.ask.send({ name: 'insertFormation', args: [3.2] });
		await flush();
		await undo(s);
		s.w.step({ name: 'insertFormation', args: [1.6] });
		await flush();
		const count = s.state.flows[0].flow.formations.length;

		await redo(s);

		const server = s.state.flows[0].flow;
		expect(server.formations).toHaveLength(count + 1);
		expect(s.session.flow).toEqual(server);
	});

	it('redo of a deletion leaves a roster move alone：我刪隊員、王教練加人、我復原、他把他的人調到最前面，我重做還是刪掉了', async () => {
		const s = await bothOpen();
		const gone = s.session.flow!.members[1];
		s.session.ask.send({ name: 'deleteMember', args: [gone.id], options: { confirmed: true } });
		await flush();
		s.w.step(add('小新'));
		await flush();
		await undo(s);
		const xin = s.state.flows[0].flow.members.find((m) => m.name === '小新')!.id;
		s.w.step({ name: 'moveMember', args: [xin, 0] });
		await flush();

		await redo(s);

		const server = s.state.flows[0].flow;
		expect(server.members.map((m) => m.id)).not.toContain(gone.id);
		expect(server.members[0].name).toBe('小新');
		expect(s.session.flow).toEqual(server);
	});

	it('redo of one step that adds and reorders keeps the reorder：一步加隊員又把第二個調到最前面，復原再重做還是同一個順序', async () => {
		const s = await bothOpen();
		const second = s.session.flow!.members[1].id;
		s.session.ask.send([add('小華'), { name: 'moveMember', args: [second, 0] }]);
		await flush();
		const order = s.state.flows[0].flow.members.map((m) => m.id);
		expect(order[0]).toBe(second);

		await undo(s);
		await redo(s);

		expect(s.state.flows[0].flow.members.map((m) => m.id)).toEqual(order);
		expect(s.session.flow).toEqual(s.state.flows[0].flow);
	});

	it('undo then redo of a move puts it back after a teammate insert：我把第三段調到第二，王教練在它後面插一段，我復原再重做，回到復原前的順序', async () => {
		const s = await bothOpen();
		s.session.ask.send({ name: 'addSegment', args: ['chant'] });
		await flush();
		s.session.ask.send({ name: 'addSegment', args: ['chant'] });
		await flush();
		const third = s.session.flow!.segments[2].id;
		s.session.ask.send({ name: 'moveSegment', args: [third, -1] });
		await flush();
		s.w.step({ name: 'addSegment', args: ['chant', third] });
		await flush();
		const order = s.state.flows[0].flow.segments.map((x) => x.id);
		expect(order.indexOf(third)).toBe(1);

		await undo(s);
		expect(s.session.notice).toMatch(/^已復原/);
		await redo(s);

		expect(s.state.flows[0].flow.segments.map((x) => x.id)).toEqual(order);
		expect(s.session.flow).toEqual(s.state.flows[0].flow);
	});

	it('redo of a move whose moved segment is gone leaves the rest alone：我把第二段調到第三段後面，復原，王教練在它後面插一段再刪掉它，我重做，順序不動', async () => {
		const s = await bothOpen();
		s.session.ask.send({ name: 'addSegment', args: ['chant'] });
		await flush();
		s.session.ask.send({ name: 'addSegment', args: ['chant'] });
		await flush();
		const second = s.session.flow!.segments[1].id;
		s.session.ask.send({ name: 'moveSegment', args: [second, 1] });
		await flush();
		await undo(s);
		s.w.step({ name: 'addSegment', args: ['chant', second] });
		await flush();
		s.w.step({ name: 'deleteSegment', args: [second, { confirmed: true }] });
		await flush();
		const order = s.state.flows[0].flow.segments.map((x) => x.id);
		expect(order).toHaveLength(3);

		await redo(s);

		expect(s.state.flows[0].flow.segments.map((x) => x.id)).toEqual(order);
		expect(s.session.flow).toEqual(s.state.flows[0].flow);
	});

	it('redo moves the member I moved：王教練刪了第二個，我把第一個調到最後、復原，王教練復原他刪的、刪到剩三個，我重做，調的還是第一個', async () => {
		const s = await bothOpen();
		const [a, x, b] = s.session.flow!.members.map((m) => m.id);
		const withX = structuredClone(s.state.flows[0].flow);
		s.w.step({ name: 'deleteMember', args: [x, { confirmed: true }] });
		await flush();
		const withoutX = structuredClone(s.state.flows[0].flow);
		const ids = withoutX.members.map((m) => m.id);
		s.session.ask.send({ name: 'moveMember', args: [a, ids.length - 1] });
		await flush();
		await undo(s);
		const seen = () => s.state.flows[0].step ?? 0;
		const change = undoChanges(withX, withoutX).undo;
		s.w.room.send({ kind: 'undo', stepId: 'wang-undo', seen: seen(), of: 'step-wang@example.com-1', redo: false, change });
		await flush();
		for (const id of ids.slice(2)) {
			s.w.step({ name: 'deleteMember', args: [id, { confirmed: true }] });
			await flush();
		}
		expect(s.state.flows[0].flow.members.map((m) => m.id)).toEqual([a, x, b]);

		await redo(s);

		expect(s.state.flows[0].flow.members.map((m) => m.id)).toEqual([x, b, a]);
		expect(s.session.flow).toEqual(s.state.flows[0].flow);
	});

	it('redo after only the mover is left still moves it：王教練刪了第一個，我把第二個調到最後，王教練加回第一個、刪第三個，我復原，王教練刪第四個，我重做，還是排在後面', async () => {
		const s = await bothOpen();
		const [x, a, b, c] = s.session.flow!.members.map((m) => m.id);
		const withX = structuredClone(s.state.flows[0].flow);
		s.w.step({ name: 'deleteMember', args: [x, { confirmed: true }] });
		await flush();
		const withoutX = structuredClone(s.state.flows[0].flow);
		s.session.ask.send({ name: 'moveMember', args: [a, 2] });
		await flush();
		// 王教練的畫面算的順序（跟 travelled 一樣）：加回來的放最前面，其他照現在的
		const undoX = undoChanges(withX, withoutX).undo;
		const now = s.state.flows[0].flow.members.map((m) => m.id);
		const change = { ...undoX, orders: { ...undoX.orders, members: [x, ...now] } };
		s.w.room.send({ kind: 'undo', stepId: 'wang-undo', seen: s.state.flows[0].step ?? 0, of: 'step-wang@example.com-1', redo: false, change });
		await flush();
		s.w.step({ name: 'deleteMember', args: [b, { confirmed: true }] });
		await flush();
		expect(s.state.flows[0].flow.members.map((m) => m.id)).toEqual([x, c, a]);
		await undo(s);
		expect(s.state.flows[0].flow.members.map((m) => m.id)).toEqual([a, x, c]);
		s.w.step({ name: 'deleteMember', args: [c, { confirmed: true }] });
		await flush();

		await redo(s);

		expect(s.state.flows[0].flow.members.map((m) => m.id)).toEqual([x, a]);
		expect(s.session.flow).toEqual(s.state.flows[0].flow);
	});

	it('undo of an add leaves a roster move alone：我加隊員，王教練把第二個調到最前面，我復原只拿掉我加的', async () => {
		const s = await bothOpen();
		s.session.ask.send(add('小華'));
		await flush();
		const second = s.state.flows[0].flow.members[1].id;
		s.w.step({ name: 'moveMember', args: [second, 0] });
		await flush();

		await undo(s);

		const server = s.state.flows[0].flow;
		expect(server.members.map((m) => m.name)).not.toContain('小華');
		expect(server.members[0].id).toBe(second);
		expect(s.session.flow).toEqual(server);
	});

	it('undo of a formation deletion keeps time order：我刪 1.6 秒的站位，王教練在 3.2 秒加一張，我復原，站位照時間排', async () => {
		const s = await bothOpen();
		s.session.ask.send({ name: 'insertFormation', args: [1.6] });
		await flush();
		const early = s.state.flows[0].flow.formations.find((f) => !libSample().formations.some((g) => g.id === f.id))!.id;
		s.session.ask.send({ name: 'deleteFormation', args: [early] });
		await flush();
		s.w.step({ name: 'insertFormation', args: [3.2] });
		await flush();
		const count = s.state.flows[0].flow.formations.length;

		await undo(s);

		const server = s.state.flows[0].flow;
		expect(server.formations).toHaveLength(count + 1);
		expect(s.session.flow).toEqual(server);
	});

	it('收了的時候後面還有沒送到的步：換成伺服器的樣子，再跑一次後面的步；全部收了跟伺服器一樣', async () => {
		const s = await bothOpen();
		const settled = vi.spyOn(s.session, 'settle');
		s.state.holdRoom = true;
		s.w.step(add('小新'));
		s.session.ask.send(add('小華'));
		s.session.ask.send(add('小玉'));

		// 伺服器先收王教練的、再收林教練的第一步；林教練先聽到「收了」（第 2 步），才聽到王教練的第 1 步，
		// 接上之後畫面換成伺服器的樣子、再跑一次還沒收的「加小玉」
		s.releaseRoom(true);
		const atTwo = structuredClone(s.state.flows[0].flow);
		s.releaseRoom();
		await flush();

		const first = settled.mock.calls[0][0];
		expect(first.members.map((m) => m.name)).toEqual([...atTwo.members.map((m) => m.name), '小玉']);
		const spots = Object.values(first.formations[0].pos).map((p) => p.join());
		expect(new Set(spots).size).toBe(first.members.length);
		expect(s.state.flows[0].step).toBe(3);
		expect(s.session.flow).toEqual(s.state.flows[0].flow);
	});

	it('reconnect after an ack that jumped ahead still catches up：先聽到自己第 2 步收了、王教練的第 1 步還沒到就斷線，連回來補上第 1 步', async () => {
		const s = await bothOpen();
		s.state.holdRoom = true;
		s.w.step(add('小新'));
		s.session.ask.send(add('小華'));
		// 伺服器收了王教練的（第 1 步，要告訴林教練的還在路上）和林教練的（第 2 步，「收了」先到）
		s.releaseRoom(true);
		expect(s.state.flows[0].step).toBe(2);
		s.disconnect(s.lin.email);
		await flush();
		s.releaseRoom();

		s.reconnect(s.lin.email);
		await flush();
		await flush();
		expect(s.session.flow!.members.map((m) => m.name)).toContain('小新');
		expect(s.session.flow).toEqual(s.state.flows[0].flow);
	});

	it('「收了」沒收到就斷線，王教練接著搬了我加的人：連回來重送拿到的「收了」比補上的舊，不會把人搬回去', async () => {
		const s = await bothOpen();
		// 林教練的房間：第一次的「收了」在路上不見，接著斷線
		const heard = s.room.onmessage;
		let lose = true;
		s.room.onmessage = (m) => {
			if (m.kind === 'accepted' && lose) {
				lose = false;
				s.disconnect(s.lin.email);
				return;
			}
			heard(m);
		};

		s.session.ask.send(add('小華'));
		await flush();
		expect(s.state.flows[0].step).toBe(1);
		const hua = s.state.flows[0].flow.members.find((m) => m.name === '小華')!.id;
		s.w.step({ name: 'setPositions', args: ['f1', { [hua]: [3, 3] }] });
		await flush();
		expect(s.state.flows[0].step).toBe(2);

		s.reconnect(s.lin.email);
		await flush();
		expect(s.session.flow!.formations[0].pos[hua]).toEqual([3, 3]);
		expect(s.session.flow).toEqual(s.state.flows[0].flow);
	});
});
