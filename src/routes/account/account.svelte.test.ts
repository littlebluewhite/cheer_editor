import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { UnsentRecords } from '#lib/offline-store.js';
import { fakeHost, fakeOfflineStore, fakeServer, fakeShell, flush, type FakeCloudFlow } from '#lib/test-fakes.js';
import { libSample } from '#lib/test-flows.js';
import Account from './+page.svelte';

// jsdom 沒有 scrollIntoView（錯誤訊息出現時捲過去，reveal.ts）。
Element.prototype.scrollIntoView = () => {};

const lin = { email: 'lin@example.com', name: '林教練', isAdmin: false, password: '我們這一隊今年一定會贏 go go' };
const NEWER = '換一句新的話當密碼也很好記得住吧';
const LEAKED = 'correct horse battery staple';

/** 我的帳號頁；went 是換頁去的網址。unsent：這台還沒傳的成功率紀錄（離線存放，#260）。 */
async function accountPage(signedIn: string | null = lin.email, unsent: UnsentRecords[] = [], isAdmin = false) {
	const wang = { email: 'wang@example.com', name: '王教練', isAdmin: !isAdmin };
	const flows: FakeCloudFlow[] = [
		{ id: 'c1', owner: lin.email, flow: libSample(), updatedAt: '2026-11-07T00:00:00Z', people: { [wang.email]: 'editor' } },
		{ id: 'c2', owner: lin.email, flow: libSample(), updatedAt: '2026-11-07T00:00:00Z' }
	];
	const fake = fakeServer({ users: [{ ...lin, isAdmin }, wang], signedIn, breached: [LEAKED], flows });
	const offline = fakeOfflineStore({ unsent });
	const went: string[] = [];
	render(Account, { server: fake.server, go: (url: string) => went.push(url), offline: offline.store });
	await flush();
	return { ...fake, went, offline };
}

const section = (name: string) => screen.getByRole('region', { name });

async function changePassword(current: string, next: string) {
	const form = section('改密碼');
	await fireEvent.input(within(form).getByLabelText('現在的密碼'), { target: { value: current } });
	await fireEvent.input(within(form).getByLabelText('新密碼'), { target: { value: next } });
	await fireEvent.click(within(form).getByRole('button', { name: '改密碼' }));
	await flush();
}

describe('我的帳號頁', () => {
	it('沒登入：到登入頁', async () => {
		const { went } = await accountPage(null);
		expect(went).toEqual(['/login']);
	});

	it('名字（說明誰看得到）、Email 只顯示（要改請找管理員）；上面一條有帳號選單', async () => {
		await accountPage();
		expect(screen.getByRole('heading', { name: '我的帳號' })).toBeTruthy();
		const name = within(section('名字')).getByLabelText('名字') as HTMLInputElement;
		expect(name.value).toBe('林教練');
		expect(screen.getByText('別人在分享名單、成功率紀錄上看到的名字')).toBeTruthy();
		const email = screen.getByLabelText('Email') as HTMLInputElement;
		expect(email.value).toBe('lin@example.com');
		expect(email.readOnly).toBe(true);
		expect(screen.getByText('要改 email 請找管理員')).toBeTruthy();
		expect(screen.getByRole('button', { name: '林教練 ▾' })).toBeTruthy();
	});

	it('改名字：伺服器存起來，帳號選單也換成新名字', async () => {
		const { state } = await accountPage();
		const form = section('名字');
		await fireEvent.input(within(form).getByLabelText('名字'), { target: { value: '林總教練' } });
		await fireEvent.click(within(form).getByRole('button', { name: '改名字' }));
		await flush();
		expect(state.users[0].name).toBe('林總教練');
		expect(within(form).getByRole('status').textContent).toBe('名字改好了。');
		expect(screen.getByRole('button', { name: '林總教練 ▾' })).toBeTruthy();
	});

	it('改密碼：寫「改好後，你在其他裝置都會登出」；新密碼算字數；改好說改好了，其他裝置登出、這台還登入著', async () => {
		const { state } = await accountPage();
		const form = section('改密碼');
		expect(within(form).getByText('改好後，你在其他裝置都會登出')).toBeTruthy();
		expect((within(form).getByLabelText('現在的密碼') as HTMLInputElement).autocomplete).toBe('current-password');
		expect((within(form).getByLabelText('新密碼') as HTMLInputElement).autocomplete).toBe('new-password');
		await fireEvent.input(within(form).getByLabelText('新密碼'), { target: { value: '啦啦隊' } });
		expect(within(form).getByText('3／至少 15 個字')).toBeTruthy();

		await changePassword(lin.password, NEWER);
		expect(state.users[0].password).toBe(NEWER);
		expect(state.otherDevices).toBe(0);
		expect(state.signedIn).toBe(lin.email);
		expect(within(form).getByRole('status').textContent).toBe('密碼改好了。');
	});

	it('現在的密碼不對、新密碼太短、外洩過、試太多次：各說原因', async () => {
		const { state } = await accountPage();
		const form = () => section('改密碼');
		await changePassword('不對的密碼不對的密碼不對的密碼', NEWER);
		expect(within(form()).getByRole('alert').textContent).toBe('現在的密碼不對。');
		await changePassword(lin.password, '啦啦隊');
		expect(within(form()).getByRole('alert').textContent).toBe('還差 12 個字。');
		await changePassword(lin.password, LEAKED);
		expect(within(form()).getByRole('alert').textContent).toBe('這個密碼太常見，或在別的網站外洩過。換一個。');
		state.retryAfter = 30;
		await changePassword(lin.password, NEWER);
		expect(within(form()).getByRole('alert').textContent).toBe('試太多次了，請 30 秒後再試');
		expect(state.users[0].password).toBe(lin.password);
	});

	it('「登出這台裝置」：登出，回首頁；這台的離線副本清掉（#261）', async () => {
		const { state, went, offline } = await accountPage();
		await offline.store.saveCopy({ flowId: 'c1', name: '流程', savedAt: 1, openedAt: 1, role: 'owner', step: 0, flow: {}, records: [] });
		await fireEvent.click(screen.getByRole('button', { name: '登出這台裝置' }));
		await flush();
		expect(state.signedIn).toBeNull();
		expect(went).toEqual(['/']);
		expect(offline.copyIds()).toEqual([]);
	});

	it('這台還有沒傳的成功率紀錄（#260）：登出先跳小框，「先不要登出」留著，「丟掉，登出」才登出', async () => {
		const row = { id: 'tabc123def456', date: '2026-11-07', action: '技巧·Lib', who: '第 1 組 小美', marks: '✓··', runThrough: false };
		const record = { actionId: 'x1', attempt: { id: 'tabc123def456', date: '2026-11-07', who: 'g1', practice: 'drill' as const, whole: true, marks: { p1: '✓' as const } } };
		const { state, went, offline } = await accountPage(lin.email, [{ flowId: 'c1', flowName: '區賽', records: [{ record, row }], amends: [], dropped: [] }]);
		await fireEvent.click(screen.getByRole('button', { name: '登出這台裝置' }));
		await flush();
		const box = screen.getByRole('dialog', { name: '還有 1 筆成功率紀錄沒傳' });
		await fireEvent.click(within(box).getByRole('button', { name: '先不要登出' }));
		expect(state.signedIn).toBe(lin.email);
		expect(went).toEqual([]);

		await fireEvent.click(screen.getByRole('button', { name: '登出這台裝置' }));
		await flush();
		await fireEvent.click(screen.getByRole('button', { name: '丟掉，登出' }));
		await flush();
		expect(state.signedIn).toBeNull();
		expect(went).toEqual(['/']);
		expect(await offline.store.unsent()).toEqual([]);
	});

	it('要求刪除帳號（#370）：確認框寫會刪什麼、流程幾支幾支有分享；確認後帳號停用、這台登出、離線副本清掉，同一組帳密登不進來', async () => {
		const { state, server, went, offline } = await accountPage();
		await offline.store.saveCopy({ flowId: 'c1', name: '流程', savedAt: 1, openedAt: 1, role: 'owner', step: 0, flow: {}, records: [] });
		await fireEvent.click(screen.getByRole('button', { name: '要求刪除帳號' }));
		await flush();
		const box = screen.getByRole('dialog', { name: '要求刪除帳號？' });
		expect(within(box).getByText('你有 2 支流程，1 支有分享；要留給隊上，先移交。')).toBeTruthy();
		expect(within(box).getByText('不想刪了：回「收到了」那封信，管理員會恢復你的帳號。')).toBeTruthy();
		await fireEvent.click(within(box).getByRole('button', { name: '要求刪除帳號' }));
		await flush();
		expect(state.users[0].disabled).toBe(true);
		expect(state.signedIn).toBeNull();
		expect(went).toEqual(['/']);
		expect(offline.copyIds()).toEqual([]);
		expect(await server.login(lin.email, lin.password)).toBe('wrong');
	});

	it('要求刪除帳號：按「取消」什麼都不變', async () => {
		const { state, went } = await accountPage();
		await fireEvent.click(screen.getByRole('button', { name: '要求刪除帳號' }));
		await flush();
		await fireEvent.click(within(screen.getByRole('dialog', { name: '要求刪除帳號？' })).getByRole('button', { name: '取消' }));
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(state.users[0].disabled).toBeFalsy();
		expect(went).toEqual([]);
	});

	it('要求刪除帳號：沒網路時說要有網路，不跳確認框', async () => {
		const { state } = await accountPage();
		state.unreachable = true;
		await fireEvent.click(screen.getByRole('button', { name: '要求刪除帳號' }));
		await flush();
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(screen.getByRole('alert').textContent).toBe('要有網路才能要求刪除帳號。連上網路再試。');
	});

	it('要求刪除帳號：這台還有沒傳的紀錄，先跳小框；「先不要登出」什麼都不做，「丟掉，登出」才送出要求', async () => {
		const row = { id: 'tabc123def456', date: '2026-11-07', action: '技巧·Lib', who: '第 1 組 小美', marks: '✓··', runThrough: false };
		const record = { actionId: 'x1', attempt: { id: 'tabc123def456', date: '2026-11-07', who: 'g1', practice: 'drill' as const, whole: true, marks: { p1: '✓' as const } } };
		const { state, went, offline } = await accountPage(lin.email, [{ flowId: 'c1', flowName: '區賽', records: [{ record, row }], amends: [], dropped: [] }]);
		const confirm = async (button: string) => {
			await fireEvent.click(screen.getByRole('button', { name: '要求刪除帳號' }));
			await flush();
			await fireEvent.click(within(screen.getByRole('dialog', { name: '要求刪除帳號？' })).getByRole('button', { name: '要求刪除帳號' }));
			await flush();
			await fireEvent.click(within(screen.getByRole('dialog', { name: '還有 1 筆成功率紀錄沒傳' })).getByRole('button', { name: button }));
			await flush();
		};
		await confirm('先不要登出');
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(state.users[0].disabled).toBeFalsy();
		expect(state.signedIn).toBe(lin.email);

		await confirm('丟掉，登出');
		expect(state.users[0].disabled).toBe(true);
		expect(went).toEqual(['/']);
		expect(await offline.store.unsent()).toEqual([]);
	});

	it('要求刪除帳號：今天寄不出信，確認框裡說明天再試，帳號不變', async () => {
		const { state } = await accountPage();
		state.mailQuota = true;
		await fireEvent.click(screen.getByRole('button', { name: '要求刪除帳號' }));
		await flush();
		const box = screen.getByRole('dialog', { name: '要求刪除帳號？' });
		await fireEvent.click(within(box).getByRole('button', { name: '要求刪除帳號' }));
		await flush();
		expect(within(box).getByRole('alert').textContent).toBe('今天寄不出去，明天再試。');
		expect(state.users[0].disabled).toBeFalsy();
	});

	it('管理員：沒有「要求刪除帳號」，寫一行怎麼辦', async () => {
		await accountPage(lin.email, [], true);
		expect(screen.queryByRole('button', { name: '要求刪除帳號' })).toBeNull();
		expect(screen.getByText('你是管理員。要刪，先用伺服器指令換別人當管理員。')).toBeTruthy();
	});
});

describe('App 裡（#392）：同一台的 App 和瀏覽器各登各的', () => {
	it('「登出這台裝置」下面說只登出 App，同一台的瀏覽器還登著；改密碼說同一台的瀏覽器也會登出', async () => {
		fakeHost({ shell: fakeShell() });
		await accountPage();
		expect(screen.getByText('只登出 App。同一台 iPad 上，App 和瀏覽器各存各的、各登各的：這台的瀏覽器還登著。')).toBeTruthy();
		expect(
			within(section('改密碼')).getByText('改好後，你在其他裝置都會登出。同一台 iPad 上，App 和瀏覽器各存各的、各登各的：這台的瀏覽器也會登出')
		).toBeTruthy();
	});

	it('網頁版：照舊，沒有那一句', async () => {
		await accountPage();
		expect(within(section('改密碼')).getByText('改好後，你在其他裝置都會登出')).toBeTruthy();
		expect(document.body.textContent).not.toContain('各登各的');
	});
});
