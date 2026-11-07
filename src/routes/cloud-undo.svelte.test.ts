// 頁面：雲端流程的復原、重做（#256，ADR 0011）。復原也是一步：送那一步改到的東西改之前的樣子（重做送改之後的），
// 別人改的別的東西留著。那些東西後來被別的分頁改過：提示「王教練後來改過，這步不能復原」，跳過；再按一次試前一步。重做一樣。
// 伺服器換成測試共用的假伺服器（fakeServer）：別人用 joinAs 在別的地方打開、送步。
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { editorPage, fakeServer, flush } from '#lib/test-fakes.js';
import { libSample } from '#lib/test-flows.js';
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
	await fireEvent.click(screen.getByRole('button', { name: '流程設定' }));
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
	await fireEvent.click(screen.getByTitle(new RegExp(`^${button}（`)));
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
