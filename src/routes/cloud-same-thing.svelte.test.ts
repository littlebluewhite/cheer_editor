// 頁面：改到同一個東西時，後到的退回（#254）。別人剛改了同一個地方：提示寫是誰、我的哪一步沒改成；
// 畫面換成伺服器的樣子，後面還沒送到的步也不見。合起來被規則擋下：再加上原因。
// 伺服器換成測試共用的假伺服器（fakeServer）：別人用 joinAs 在別的地方打開、送步。
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { editorPage, fromMenu, fakeServer, flush } from '#lib/test-fakes.js';
import { libSample } from '#lib/test-flows.js';
import type { NewMemberInput } from '#lib/core';
import Page from './+page.svelte';

const pw = '我們這一隊今年一定會贏 go go';
const lin = { email: 'lin@example.com', name: '林教練', isAdmin: false, password: pw };
const wang = { email: 'wang@example.com', name: '王教練', isAdmin: false, password: pw };

/** 林教練登入，打開他的「測試」（libSample）；王教練是編輯者，也開著。 */
async function bothOpen() {
	const fake = fakeServer({
		users: [lin, wang],
		signedIn: lin.email,
		flows: [
			{
				id: 'c1',
				owner: lin.email,
				flow: libSample(),
				updatedAt: new Date(2026, 10, 7).toISOString(),
				people: { [wang.email]: 'editor' }
			}
		]
	});
	const page = editorPage(null, { server: fake.server });
	render(Page, page.props);
	await flush();
	await fireEvent.click(screen.getByRole('button', { name: /^測試/ }));
	await flush();
	const w = fake.joinAs('c1', wang.email);
	await flush();
	return { ...fake, page, w };
}

/** 流程設定改流程名字。 */
async function rename(name: string) {
	await fromMenu('流程設定');
	await fireEvent.change(screen.getByLabelText('流程名字'), { target: { value: name } });
	await fireEvent.click(screen.getByRole('button', { name: '關閉' }));
}

/** 加一個隊員的指令。 */
const add = (name: string) => ({
	name: 'addMembers' as const,
	args: [[{ name, gender: 'F' as const, globalRole: 'top' as const }]] as [NewMemberInput[]]
});

const title = () => document.querySelector('.topbar .title')!.textContent!;

describe('改到同一個東西', () => {
	it('王教練剛改了同一個地方：提示是誰、哪一步沒改成；換成伺服器的樣子，後面還沒送到的步不見', async () => {
		const s = await bothOpen();
		s.state.holdRoom = true;
		// 王教練先到；林教練沒看到，也改名字，接著又加一段（還沒送到）
		s.w.step({ name: 'renameFlow', args: ['區賽'] });
		await rename('全國賽');
		s.page.session.ask.send({ name: 'addSegment', args: ['chant'] });
		expect(s.page.session.flow!.segments).toHaveLength(2);

		s.releaseRoom();
		await flush();

		expect(screen.getByRole('status').textContent).toBe('王教練剛改了同一個地方，你的「改流程名字」沒改成');
		expect(s.page.session.flow).toEqual(s.state.flows[0].flow);
		expect(s.page.session.flow!.name).toBe('區賽');
		expect(s.page.session.flow!.segments).toHaveLength(1);
		expect(s.state.flows[0].step).toBe(1);
		expect(title()).toContain('✓ 已存');

		// 換成伺服器的樣子之後再改：收
		await rename('全國賽');
		await flush();
		expect(s.state.flows[0].flow.name).toBe('全國賽');
	});

	it('合起來被規則擋下：再加上原因', async () => {
		const s = await bothOpen();
		s.state.holdRoom = true;
		// 王教練先在第 3.2 秒插了站位；林教練沒看到，也在同一拍插
		s.w.step({ name: 'insertFormation', args: [3.2] });
		s.page.session.ask.send({ name: 'insertFormation', args: [3.2] });
		s.releaseRoom();
		await flush();

		expect(screen.getByRole('status').textContent).toBe(
			'王教練剛改了流程，你的「插入站位 2」沒改成：這一拍已經有站位'
		);
		expect(s.page.session.flow).toEqual(s.state.flows[0].flow);
	});

	it('兩個人同時各加一個隊員：都收；我這邊換成伺服器放的位置和順序，不會跟王教練加的人疊在一起', async () => {
		const s = await bothOpen();
		s.state.holdRoom = true;
		// 王教練先到；林教練沒看到，也加一個（兩邊都從同一份開始，林教練自己的畫面把小華放在王教練加的人會在的位置）
		s.w.step(add('小新'));
		s.page.session.ask.send(add('小華'));

		s.releaseRoom();
		await flush();

		const server = s.state.flows[0].flow;
		expect(s.state.flows[0].step).toBe(2);
		expect(s.page.session.flow!.members.map((m) => m.name)).toEqual(server.members.map((m) => m.name));
		expect(s.page.session.flow!.formations).toEqual(server.formations);
		expect(s.page.session.flow).toEqual(server);
		expect(title()).toContain('✓ 已存');
	});

	it('收了的時候後面還有沒送到的步：換成伺服器的樣子，再跑一次後面的步；全部收了跟伺服器一樣', async () => {
		const s = await bothOpen();
		const settled = vi.spyOn(s.page.session, 'settle');
		s.state.holdRoom = true;
		s.w.step(add('小新'));
		s.page.session.ask.send(add('小華'));
		s.page.session.ask.send(add('小玉'));

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
		expect(s.page.session.flow).toEqual(s.state.flows[0].flow);
	});

	it('「收了」沒收到就斷線，王教練接著搬了我加的人：連回來重送拿到的「收了」比補上的舊，不會把人搬回去', async () => {
		const fake = fakeServer({
			users: [lin, wang],
			signedIn: lin.email,
			flows: [
				{
					id: 'c1',
					owner: lin.email,
					flow: libSample(),
					updatedAt: new Date(2026, 10, 7).toISOString(),
					people: { [wang.email]: 'editor' }
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
		let lose = true;
		room.onmessage = (m) => {
			if (m.kind === 'accepted' && lose) {
				lose = false;
				fake.disconnect(lin.email);
				return;
			}
			heard(m);
		};

		page.session.ask.send(add('小華'));
		await flush();
		expect(fake.state.flows[0].step).toBe(1);
		const hua = fake.state.flows[0].flow.members.find((m) => m.name === '小華')!.id;
		w.step({ name: 'setPositions', args: ['f1', { [hua]: [3, 3] }] });
		await flush();
		expect(fake.state.flows[0].step).toBe(2);

		fake.reconnect(lin.email);
		await flush();
		expect(page.session.flow!.formations[0].pos[hua]).toEqual([3, 3]);
		expect(page.session.flow).toEqual(fake.state.flows[0].flow);
	});
});
