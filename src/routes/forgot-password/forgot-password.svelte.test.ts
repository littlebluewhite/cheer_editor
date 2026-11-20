import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeServer, flush } from '#lib/test-fakes.js';
import ForgotPassword from './+page.svelte';

// jsdom 沒有 scrollIntoView（錯誤訊息出現時捲過去，reveal.ts）。
Element.prototype.scrollIntoView = () => {};

const lin = { email: 'lin@example.com', name: '林教練', isAdmin: false, password: '我們這一隊今年一定會贏 go go' };

function forgotPage(search = '') {
	history.replaceState(null, '', `/forgot-password${search}`);
	const fake = fakeServer({ users: [lin] });
	render(ForgotPassword, { server: fake.server });
	return fake;
}

async function send(email: string) {
	await fireEvent.input(screen.getByLabelText('Email'), { target: { value: email } });
	await fireEvent.click(screen.getByRole('button', { name: '寄信' }));
	await flush();
}

describe('忘記密碼頁', () => {
	beforeEach(() => history.replaceState(null, '', '/'));

	it('標題「忘記密碼」、說明、Email、「寄信」；畫面不寫幾小時內有效', () => {
		forgotPage();
		expect(screen.getByRole('heading', { name: '忘記密碼' })).toBeTruthy();
		expect(screen.getByText('填你登入用的 email，我們寄一封信，點信裡的連結設新密碼。')).toBeTruthy();
		expect(screen.getByLabelText('Email').getAttribute('autocomplete')).toBe('username');
		expect(document.body.textContent).not.toMatch(/小時/);
	});

	it('按「寄信」：一律回「如果 {email} 有帳號，我們已經寄出一封信。」，沒帳號的 email 也一樣', async () => {
		for (const email of ['lin@example.com', 'nobody@example.com']) {
			const fake = forgotPage();
			await send(email);
			expect(fake.state.forgot).toEqual([email]);
			expect(screen.getByRole('status').textContent).toBe(`如果 ${email} 有帳號，我們已經寄出一封信。`);
			expect(screen.getByText('沒收到？看看垃圾信，或請管理員幫你寄。')).toBeTruthy();
			expect(document.body.textContent).not.toMatch(/小時/);
			cleanup();
		}
	});

	it('從登入頁來時 email 已經填好', () => {
		forgotPage('?email=lin%40example.com');
		expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('lin@example.com');
	});

	it('連不上伺服器：說連不上，不說寄出了', async () => {
		const { state } = forgotPage();
		state.unreachable = true;
		await send('lin@example.com');
		expect(screen.getByRole('alert').textContent).toBe('連不上伺服器，請稍後再試。');
		expect(screen.queryByRole('status')).toBeNull();
	});
});

describe('忘記密碼頁（英文）', () => {
	beforeEach(() => localStorage.setItem('PARAGLIDE_LOCALE', 'en'));

	it('瀏覽器存的語言是英文：整頁是英文', async () => {
		forgotPage();
		expect(document.title).toBe('Forgot password — Routine Editor');
		expect(screen.getByRole('heading', { name: 'Forgot password' })).toBeTruthy();
		// 上面那條（AccountCard）也是英文
		expect(screen.getByRole('link', { name: 'Cheer Routine Editor' })).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Home' })).toBeTruthy();
		await fireEvent.input(screen.getByLabelText('Email'), { target: { value: 'lin@example.com' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Send email' }));
		await flush();
		expect(screen.getByRole('status').textContent).toBe("If lin@example.com has an account, we've sent it an email.");
	});
});
