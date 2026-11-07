// 頁面：改到同一個東西時，後到的退回（#254）。別人剛改了同一個地方：提示寫是誰、我的哪一步沒改成；
// 畫面換成伺服器的樣子，後面還沒送到的步也不見。合起來被規則擋下：再加上原因。
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
}

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
});
