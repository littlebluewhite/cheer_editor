import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeOfflineStore, fakeServer, flush } from '#lib/test-fakes.js';
import Login from './+page.svelte';

const lin = { email: 'lin@example.com', name: '林教練', isAdmin: false, password: '我們這一隊今年一定會贏 go go' };

/** 登入頁；went 是登入後要去的網址。 */
function loginPage(search = '') {
	history.replaceState(null, '', `/login${search}`);
	const fake = fakeServer({ users: [lin] });
	const went: string[] = [];
	render(Login, { server: fake.server, go: (url: string) => went.push(url) });
	return { ...fake, went };
}

async function submit(email: string, password: string) {
	await fireEvent.input(screen.getByLabelText('Email'), { target: { value: email } });
	await fireEvent.input(screen.getByLabelText('密碼'), { target: { value: password } });
	await fireEvent.click(screen.getByRole('button', { name: '登入' }));
	await flush();
}

describe('登入頁', () => {
	beforeEach(() => history.replaceState(null, '', '/'));

	it('有 Email、密碼、登入；寫「沒有帳號？請管理員加你。」和不登入也能用，「回首頁」連到首頁', () => {
		loginPage();
		expect(screen.getByRole('heading', { name: '登入' })).toBeTruthy();
		expect(screen.getByLabelText('Email').getAttribute('autocomplete')).toBe('username');
		expect(screen.getByLabelText('密碼').getAttribute('autocomplete')).toBe('current-password');
		expect(screen.getByText('沒有帳號？請管理員加你。')).toBeTruthy();
		expect(screen.getByText(/不登入也能用：/).textContent).toBe('不登入也能用：回首頁，流程只存在這台電腦。');
		const home = screen.getAllByRole('link', { name: '回首頁' });
		expect(home.every((a) => a.getAttribute('href') === '/')).toBe(true);
	});

	it('密碼旁邊「顯示」：按了看得到打的字', async () => {
		loginPage();
		const password = screen.getByLabelText('密碼') as HTMLInputElement;
		expect(password.type).toBe('password');
		await fireEvent.click(screen.getByRole('button', { name: '顯示' }));
		expect(password.type).toBe('text');
	});

	it('打錯：「email 或密碼不對」，下面小字「一直進不去？請找管理員。」；沒有這個人也一樣', async () => {
		const { went } = loginPage();
		for (const email of ['lin@example.com', 'nobody@example.com']) {
			await submit(email, '不對的密碼不對的密碼不對的密碼');
			const alert = screen.getByRole('alert');
			expect(alert.textContent).toContain('email 或密碼不對');
			expect(alert.textContent).toContain('一直進不去？請找管理員。');
		}
		expect(went).toEqual([]);
	});

	it('登入成功回首頁', async () => {
		const { went, state } = loginPage();
		await submit('LIN@example.com', lin.password);
		expect(state.signedIn).toBe('lin@example.com');
		expect(went).toEqual(['/']);
	});

	it('剛設好密碼：上面綠色一行「密碼設好了，請用新密碼登入。」，email 已經填好', () => {
		loginPage('?email=lin%40example.com&passwordSet=1');
		expect(screen.getByRole('status').textContent).toBe('密碼設好了，請用新密碼登入。');
		expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('lin@example.com');
	});

	it('「忘記密碼？」到忘記密碼頁，帶著打好的 email', async () => {
		loginPage();
		const forgot = () => screen.getByRole('link', { name: '忘記密碼？' }).getAttribute('href');
		expect(forgot()).toBe('/forgot-password');
		await fireEvent.input(screen.getByLabelText('Email'), { target: { value: 'lin@example.com' } });
		expect(forgot()).toBe('/forgot-password?email=lin%40example.com');
	});

	it('試太多次：「試太多次了，請 N 秒後再試」，下面「忘記密碼的話，按『忘記密碼』重設。」；一分鐘以上寫分鐘', async () => {
		const { state, went } = loginPage();
		state.retryAfter = 30;
		await submit('nobody@example.com', lin.password);
		let alert = screen.getByRole('alert');
		expect(alert.textContent).toContain('試太多次了，請 30 秒後再試');
		expect(alert.textContent).toContain('忘記密碼的話，按『忘記密碼』重設。');
		expect(alert.textContent).not.toContain('email 或密碼不對');

		state.retryAfter = 90;
		await submit('lin@example.com', lin.password);
		alert = screen.getByRole('alert');
		expect(alert.textContent).toContain('試太多次了，請 2 分鐘後再試');
		expect(went).toEqual([]);
	});

	it('登入超過 30 天：上面黃色一行「登入超過 30 天了，請再登入一次。」；沒到期不寫', async () => {
		history.replaceState(null, '', '/login');
		const fake = fakeServer({ users: [lin] });
		fake.state.expired = true;
		render(Login, { server: fake.server, go: () => {} });
		await flush();
		expect(screen.getByText('登入超過 30 天了，請再登入一次。').classList.contains('warn')).toBe(true);
	});

	it('登入超過 30 天、這台還有沒傳的成功率紀錄（#260）：黃色那一行加「這台還有 N 筆成功率紀錄沒傳，登入後會自動傳。」', async () => {
		history.replaceState(null, '', '/login');
		const fake = fakeServer({ users: [lin] });
		fake.state.expired = true;
		const row = { id: 'tabc123def456', date: '2026-11-07', action: '技巧·Lib', who: '第 1 組 小美', marks: '✓··', runThrough: false };
		const record = { actionId: 'x1', attempt: { id: 'tabc123def456', date: '2026-11-07', who: 'g1', practice: 'drill' as const, whole: true, marks: { p1: '✓' as const } } };
		const unsent = [
			{ flowId: 'c1', flowName: '區賽', records: [{ record, row }], amends: [{ ids: ['tdef456abc123'], request: { kind: 'deleteRecords' as const, ids: ['tdef456abc123'] } }], dropped: [] }
		];
		render(Login, { server: fake.server, go: () => {}, offline: fakeOfflineStore({ unsent }).store });
		await flush();
		expect(screen.getByRole('status').textContent!.trim()).toBe('登入超過 30 天了，請再登入一次。這台還有 2 筆成功率紀錄沒傳，登入後會自動傳。');
	});

	it('沒到期：沒有黃色那一行', async () => {
		loginPage();
		await flush();
		expect(screen.queryByText('登入超過 30 天了，請再登入一次。')).toBeNull();
	});

	it('連不上伺服器：說連不上，不說密碼不對', async () => {
		const { state } = loginPage();
		state.unreachable = true;
		await submit('lin@example.com', lin.password);
		expect(screen.getByRole('alert').textContent).toBe('連不上伺服器，請稍後再試。');
	});
});
