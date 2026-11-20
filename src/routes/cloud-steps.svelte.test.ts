// 頁面：雲端流程一步一步存（#248）。改一下就送一步給伺服器（先改自己的畫面）；名字旁「存中…」「✓ 已存」；
// 被退回換成伺服器的樣子、提示原因；有新版不能改；上方列沒有存檔、開啟、新建，換成「首頁」。
// 伺服器換成測試共用的假伺服器（fakeServer）：它的房間照真的規則收步。
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { deleteMember, type Flow } from '#lib/core';
import { editorPage, fromMenu, menuItem, fakeServer, flush } from '#lib/test-fakes.js';
import { flowOf, libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView（錯誤訊息出現時捲過去，reveal.ts）。
Element.prototype.scrollIntoView = () => {};

const lin = { email: 'lin@example.com', name: '林教練', isAdmin: true, password: '我們這一隊今年一定會贏 go go' };

/** 登入、首頁「我的流程」有一支 c1（libSample，名字「測試」），點它打開。 */
async function openCloud(fingerprint?: string) {
	const fake = fakeServer({
		users: [lin],
		signedIn: lin.email,
		flows: [{ id: 'c1', owner: lin.email, flow: libSample(), updatedAt: new Date(2026, 10, 7).toISOString() }]
	});
	if (fingerprint) fake.state.fingerprint = fingerprint;
	const page = editorPage(null, { server: fake.server });
	render(Page, page.props);
	await flush();
	await fireEvent.click(screen.getByRole('button', { name: /^測試/ }));
	await flush();
	return { ...fake, page };
}

/** 流程設定改流程名字。 */
async function rename(name: string) {
	await fromMenu('流程設定');
	await fireEvent.change(screen.getByLabelText('流程名字'), { target: { value: name } });
	await fireEvent.click(screen.getByRole('button', { name: '關閉' }));
}

const title = () => document.querySelector('.topbar .title')!.textContent!;

describe('雲端流程一步一步存', () => {
	it('打開就能改；上方列沒有存檔、開啟、新建，換成「首頁」', async () => {
		const s = await openCloud();
		expect(s.page.session.viewing).toBe(false);
		expect(screen.queryByRole('button', { name: /存檔/ })).toBeNull();
		expect(screen.queryByLabelText(/^開啟/)).toBeNull();
		expect(screen.queryByRole('button', { name: /新建/ })).toBeNull();
		expect(title()).toContain('✓ 已存');

		await fireEvent.click(screen.getByRole('button', { name: '首頁' }));
		expect(s.page.session.flow).toBeNull();
	});

	it('改一下：先改畫面、名字旁「存中…」；伺服器收了「✓ 已存」，伺服器上的流程也改了', async () => {
		const s = await openCloud();
		s.state.holdRoom = true;
		await rename('全國賽');

		expect(s.page.session.flow!.name).toBe('全國賽');
		expect(title()).toContain('存中…');
		expect(title()).not.toContain('✓ 已存');
		expect(s.state.flows[0].flow.name).toBe('測試');

		s.releaseRoom();
		await flush();
		expect(title()).toContain('✓ 已存');
		expect(s.state.flows[0].flow.name).toBe('全國賽');
		expect(s.state.flows[0].step).toBe(1);
	});

	it('被退回：畫面換成伺服器的樣子，提示原因', async () => {
		const s = await openCloud();
		// 伺服器上小芳已經被刪了（別的分頁），這個分頁還看得到她
		const server: Flow = flowOf(deleteMember(s.state.flows[0].flow, 'm4', { confirmed: true }));
		s.state.flows[0].flow = server;
		await fireEvent.click(screen.getByRole('tab', { name: /^隊員/ }));
		await fireEvent.change(screen.getByLabelText('第 4 位隊員的名字'), { target: { value: '芳芳' } });
		await flush();

		expect(s.page.session.flow).toEqual(server);
		expect(s.page.session.notice).toBe('沒存進去：找不到這個隊員');
		expect(screen.getByRole('status').textContent).toBe('沒存進去：找不到這個隊員');
		expect(title()).toContain('✓ 已存');
	});

	it('被退回（英文）：原因照使用者的語言寫（ADR 0017：伺服器送代號）', async () => {
		localStorage.setItem('PARAGLIDE_LOCALE', 'en');
		const s = await openCloud();
		s.state.flows[0].flow = flowOf(deleteMember(s.state.flows[0].flow, 'm4', { confirmed: true }));
		await fireEvent.click(screen.getByRole('tab', { name: /^隊員/ }));
		await fireEvent.change(screen.getByLabelText("Athlete 4's name"), { target: { value: '芳芳' } });
		await flush();

		expect(s.page.session.notice).toBe("Not saved: Can't find this athlete");
	});

	it('有新版：提示「有新版，請重新整理」，不能改', async () => {
		const s = await openCloud('newer-core');
		expect(s.page.session.viewing).toBe(true);
		expect((screen.getByRole('button', { name: '編輯' }) as HTMLButtonElement).disabled).toBe(true);
		expect(((await menuItem('流程設定')) as HTMLButtonElement).disabled).toBe(true);
		expect(document.querySelector('.field-host')!.textContent).toContain('有新版，請重新整理');

		// 鍵盤、程式送的改動也擋下
		s.page.session.ask.send({ name: 'renameFlow', args: ['偷改'] });
		await flush();
		expect(s.page.session.flow!.name).toBe('測試');
		expect(s.state.flows[0].flow.name).toBe('測試');
	});

	it('重新打開：看到改過的樣子', async () => {
		const s = await openCloud();
		await rename('全國賽');
		await flush();
		await fireEvent.click(screen.getByRole('button', { name: '首頁' }));
		await flush();

		await fireEvent.click(screen.getByRole('button', { name: /^全國賽/ }));
		await flush();
		expect(s.page.session.flow!.name).toBe('全國賽');
		expect(s.page.editor.file.cloudId).toBe('c1');
	});
});
