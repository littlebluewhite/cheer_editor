import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeServer, flush } from '#lib/test-fakes.js';
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

	it('連不上伺服器：說連不上，不說密碼不對', async () => {
		const { state } = loginPage();
		state.unreachable = true;
		await submit('lin@example.com', lin.password);
		expect(screen.getByRole('alert').textContent).toBe('連不上伺服器，請稍後再試。');
	});
});
