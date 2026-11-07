import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { editorPage, fakeServer, flush } from '#lib/test-fakes.js';
import Page from './+page.svelte';

const lin = { email: 'lin@example.com', name: '林教練', isAdmin: true, password: '我們這一隊今年一定會贏 go go' };

describe('首頁的登入、帳號選單', () => {
	it('沒登入：右上角「使用說明」旁邊多一顆「登入」，到登入頁', async () => {
		render(Page, editorPage().props);
		await flush();
		const login = screen.getByRole('link', { name: '登入' }) as HTMLAnchorElement;
		expect(login.getAttribute('href')).toBe('/login');
		expect(screen.getByRole('link', { name: '使用說明' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: /▾/ })).toBeNull();
	});

	it('登入後：「名字 ▾」選單，裡面有 email 和「登出」；沒有「登入」', async () => {
		const { server } = fakeServer({ users: [lin], signedIn: lin.email });
		render(Page, editorPage(null, { server }).props);
		await flush();
		expect(screen.queryByRole('link', { name: '登入' })).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: '林教練 ▾' }));
		const menu = screen.getByRole('menu');
		expect(within(menu).getByText('lin@example.com')).toBeTruthy();
		expect(within(menu).getByRole('menuitem', { name: '登出' })).toBeTruthy();
	});

	it('按「登出」：登出這台裝置，回到有「登入」的首頁', async () => {
		const fake = fakeServer({ users: [lin], signedIn: lin.email });
		render(Page, editorPage(null, { server: fake.server }).props);
		await flush();
		await fireEvent.click(screen.getByRole('button', { name: '林教練 ▾' }));
		await fireEvent.click(screen.getByRole('menuitem', { name: '登出' }));
		await flush();

		expect(fake.state.signedIn).toBeNull();
		expect(screen.getByRole('link', { name: '登入' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: '林教練 ▾' })).toBeNull();
	});

	it('帳號選單不放在編輯頁的上方列', async () => {
		const { server } = fakeServer({ users: [lin], signedIn: lin.email });
		render(Page, editorPage(null, { server }).props);
		await flush();
		await fireEvent.input(screen.getByLabelText('流程名字'), { target: { value: '全國賽' } });
		await fireEvent.click(screen.getByRole('button', { name: '建立' }));
		expect(screen.queryByRole('button', { name: '林教練 ▾' })).toBeNull();
		expect(screen.queryByRole('link', { name: '登入' })).toBeNull();
	});
});
