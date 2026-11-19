// 頁面：分享連結（#251）。分享對話框的「分享連結」一段（擁有者開、關、複製；不是擁有者只看得到開著沒、能複製）；
// 用連結打開（網址 /#share=…）：沒登入是檢視模式、沒有練習頁、不連房間；已經有權限的人照自己的權限。
// 伺服器換成測試共用的假伺服器（fakeServer）：分享連結照真的規則。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { editorPage, fakeServer, flush, type FakeCloudFlow } from '#lib/test-fakes.js';
import { libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView（錯誤訊息出現時捲過去，reveal.ts）。
Element.prototype.scrollIntoView = () => {};

const pw = '我們這一隊今年一定會贏 go go';
const lin = { email: 'lin@example.com', name: '林教練', isAdmin: false, password: pw };
const wang = { email: 'wang@example.com', name: '王教練', isAdmin: false, password: pw };

/** 王教練的「測試」；people：分享給誰；link：分享連結（沒寫是關著）。 */
const wangsFlow = (more: Partial<FakeCloudFlow> = {}): FakeCloudFlow => ({
	id: 'c1',
	owner: wang.email,
	flow: libSample(),
	updatedAt: new Date(2026, 10, 6, 15, 20).toISOString(),
	...more
});

/** 網址是 url 時打開頁面，me 登入（null 是沒登入）；回假伺服器和頁面。 */
async function visit(url: string, me: string | null, flows: FakeCloudFlow[]) {
	history.replaceState(null, '', url);
	const fake = fakeServer({ users: [lin, wang], signedIn: me, flows });
	const openRoom = vi.spyOn(fake.server, 'openRoom');
	const page = editorPage(null, { server: fake.server });
	render(Page, page.props);
	await flush();
	await flush();
	return { ...fake, page, openRoom };
}

async function openShare() {
	await fireEvent.click(screen.getByRole('button', { name: /^測試/ }));
	await flush();
	await fireEvent.click(screen.getByRole('button', { name: '分享' }));
	await flush();
	return screen.getByRole('dialog', { name: '分享「測試」' });
}

const SMALL_PRINT = '不用登入就能看編排（場地、八拍表、播放），看不到練習頁和成功率。關掉再打開會換一條新的，舊的就不能用。';

afterEach(() => history.replaceState(null, '', '/'));

describe('分享對話框的分享連結', () => {
	it('擁有者開、關；開著時連結加「複製」；關掉再打開換一條新的', async () => {
		const writeText = vi.fn(async () => {});
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		const s = await visit('/', wang.email, [wangsFlow()]);
		const dialog = await openShare();
		const section = within(within(dialog).getByRole('group', { name: '分享連結' }));
		const toggle = section.getByRole('switch') as HTMLInputElement;
		expect(toggle.checked).toBe(false);
		expect(section.getByText('關著')).toBeTruthy();
		expect(section.getByText(SMALL_PRINT)).toBeTruthy();
		expect(section.queryByRole('button', { name: '複製' })).toBeNull();

		await fireEvent.click(toggle);
		await flush();
		const first = s.state.flows[0].link!;
		expect(first).toBeTruthy();
		expect(toggle.checked).toBe(true);
		expect(section.getByText('開著：拿到連結的人都能看')).toBeTruthy();
		const url = `${location.origin}/#share=${first}`;
		expect((section.getByLabelText('連結') as HTMLInputElement).value).toBe(url);
		await fireEvent.click(section.getByRole('button', { name: '複製' }));
		await flush();
		expect(writeText).toHaveBeenCalledWith(url);
		expect(within(dialog).getByRole('status').textContent).toBe('複製了分享連結。');

		await fireEvent.click(toggle);
		await flush();
		expect(s.state.flows[0].link).toBeNull();
		expect(section.getByText('關著')).toBeTruthy();
		await fireEvent.click(toggle);
		await flush();
		expect(s.state.flows[0].link).not.toBe(first);
		expect((section.getByLabelText('連結') as HTMLInputElement).value).toBe(`${location.origin}/#share=${s.state.flows[0].link}`);
	});

	it('不是擁有者：看得到開著、關著（只有擁有者能開、關），開著時也能複製', async () => {
		await visit('/', lin.email, [wangsFlow({ people: { [lin.email]: 'viewer' } })]);
		let dialog = await openShare();
		let section = within(within(dialog).getByRole('group', { name: '分享連結' }));
		expect(section.queryByRole('switch')).toBeNull();
		expect(section.getByText('關著（只有擁有者能開、關）')).toBeTruthy();
		expect(section.queryByRole('button', { name: '複製' })).toBeNull();
		document.body.innerHTML = '';

		await visit('/', lin.email, [wangsFlow({ people: { [lin.email]: 'viewer' }, link: 'abc' })]);
		dialog = await openShare();
		section = within(within(dialog).getByRole('group', { name: '分享連結' }));
		expect(section.queryByRole('switch')).toBeNull();
		expect(section.getByText('開著（只有擁有者能開、關）')).toBeTruthy();
		expect((section.getByLabelText('連結') as HTMLInputElement).value).toBe(`${location.origin}/#share=abc`);
		expect(section.getByRole('button', { name: '複製' })).toBeTruthy();
	});
});

describe('用分享連結打開', () => {
	it('沒登入：檢視模式，沒有練習頁、分享、存檔，不連房間；重新整理（再打開）看到最新的', async () => {
		const s = await visit('/#share=abc', null, [wangsFlow({ link: 'abc' })]);
		expect(s.page.session.flow?.name).toBe('測試');
		expect(s.page.session.viewing).toBe(true);
		expect((screen.getByRole('button', { name: '編輯' }) as HTMLButtonElement).disabled).toBe(true);
		expect(screen.getByText('檢視模式・只能看')).toBeTruthy();
		expect(screen.queryByRole('button', { name: '練習' })).toBeNull();
		expect(screen.queryByRole('button', { name: '分享' })).toBeNull();
		expect(screen.queryByRole('button', { name: /存檔/ })).toBeNull();
		expect(s.openRoom).not.toHaveBeenCalled();
		s.page.session.ask.send({ name: 'renameFlow', args: ['偷改'] });
		await flush();
		expect(s.state.flows[0].flow.name).toBe('測試');
		document.body.innerHTML = '';

		// 擁有者改了名字：用連結看的人重新整理才看到
		s.state.flows[0].flow = { ...s.state.flows[0].flow, name: '決賽' };
		const again = await visit('/#share=abc', null, s.state.flows);
		expect(again.page.session.flow?.name).toBe('決賽');
	});

	it('回首頁：網址拿掉連結，首頁不會多出這支', async () => {
		const s = await visit('/#share=abc', lin.email, [wangsFlow({ link: 'abc' })]);
		expect(s.page.session.viewing).toBe(true);
		await fireEvent.click(screen.getByRole('button', { name: '首頁' }));
		await flush();
		expect(s.page.session.flow).toBeNull();
		expect(location.hash).toBe('');
		expect(screen.getByRole('list', { name: '分享給我的' }).textContent).not.toContain('測試');
	});

	it('已經有權限的人：照自己的權限（編輯者能改、連房間）', async () => {
		const s = await visit('/#share=abc', lin.email, [wangsFlow({ link: 'abc', people: { [lin.email]: 'editor' } })]);
		expect(s.page.session.flow?.name).toBe('測試');
		expect(s.page.session.viewing).toBe(false);
		expect(s.openRoom).toHaveBeenCalledWith('c1');
		expect(screen.getByRole('button', { name: '練習' })).toBeTruthy();
		expect(screen.getByRole('button', { name: '分享' })).toBeTruthy();
	});

	it('連結關掉、換掉了：首頁說打不開', async () => {
		await visit('/#share=old', null, [wangsFlow({ link: 'abc' })]);
		expect(screen.getByRole('alert').textContent).toBe('這個分享連結不能用了：可能已經關掉，或換了一條新的。');
	});
});
