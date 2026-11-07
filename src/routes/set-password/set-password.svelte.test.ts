import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeServer, flush } from '#lib/test-fakes.js';
import SetPassword from './+page.svelte';

const mei = { email: 'mei@example.com', name: '陳小美', isAdmin: false };
const LEAKED = 'correct horse battery staple';

/** 從信裡的連結打開設密碼頁（token 在 # 後面）。went 是設好後要去的網址。 */
async function openLink(token = 'tok1', purpose: 'invite' | 'reset' = 'invite') {
	history.replaceState(null, '', `/set-password#${token}`);
	const fake = fakeServer({ users: [{ ...mei }], links: { tok1: { email: mei.email, purpose } }, breached: [LEAKED] });
	const went: string[] = [];
	render(SetPassword, { server: fake.server, go: (url: string) => went.push(url) });
	await flush();
	return { ...fake, went };
}

const password = () => screen.getByLabelText('密碼') as HTMLInputElement;
async function type(text: string) {
	await fireEvent.input(password(), { target: { value: text } });
}
async function submit(text: string) {
	await type(text);
	await fireEvent.click(screen.getByRole('button', { name: '設好密碼' }));
	await flush();
}

describe('設密碼頁', () => {
	beforeEach(() => history.replaceState(null, '', '/'));

	it('邀請：標題「設密碼」、「{名字}，歡迎！設好密碼就能登入。」，email 顯示但不能改', async () => {
		await openLink();
		expect(screen.getByRole('heading', { name: '設密碼' })).toBeTruthy();
		expect(screen.getByText('陳小美，歡迎！設好密碼就能登入。')).toBeTruthy();
		const email = screen.getByLabelText('Email') as HTMLInputElement;
		expect(email.value).toBe('mei@example.com');
		expect(email.readOnly).toBe(true);
		expect(email.autocomplete).toBe('username');
		expect(password().autocomplete).toBe('new-password');
		expect(screen.getByText('可以是一句話，空白、中文都算字。可以用密碼管理器。')).toBeTruthy();
	});

	it('重設密碼：標題「設新密碼」、「設好後，你在其他裝置都會登出。」', async () => {
		await openLink('tok1', 'reset');
		expect(screen.getByRole('heading', { name: '設新密碼' })).toBeTruthy();
		expect(screen.getByText('設好後，你在其他裝置都會登出。')).toBeTruthy();
	});

	it('密碼只打一次，旁邊「顯示」', async () => {
		await openLink();
		expect(screen.getAllByLabelText(/密碼/)).toHaveLength(1);
		await fireEvent.click(screen.getByRole('button', { name: '顯示' }));
		expect(password().type).toBe('text');
	});

	it('下面算字數「N／至少 15 個字」：中文、空白、emoji 都算一個字', async () => {
		await openLink();
		expect(screen.getByText('0／至少 15 個字')).toBeTruthy();
		await type('啦啦隊 加油 👨‍👩‍👧');
		expect(screen.getByText('8／至少 15 個字')).toBeTruthy();
	});

	it('太短：「還差 N 個字。」', async () => {
		const { went } = await openLink();
		await submit('啦啦隊 加油 👨‍👩‍👧 abc 1');
		expect(screen.getByRole('alert').textContent).toBe('還差 1 個字。');
		expect(went).toEqual([]);
	});

	it('太常見或外洩過：「這個密碼太常見，或在別的網站外洩過。換一個。」', async () => {
		const { went } = await openLink();
		await submit(LEAKED);
		expect(screen.getByRole('alert').textContent).toBe('這個密碼太常見，或在別的網站外洩過。換一個。');
		expect(went).toEqual([]);
	});

	it('設好：不自動登入，跳登入頁、帶著 email', async () => {
		const { went, state } = await openLink();
		await submit('啦啦隊 加油 👨‍👩‍👧 abc 12');
		expect(state.signedIn).toBeNull();
		expect(went).toEqual(['/login?email=mei%40example.com&passwordSet=1']);
	});

	it('連結過期、用過、亂改：「這個連結不能用了」和可能的原因，沒有密碼欄', async () => {
		await openLink('亂改的');
		expect(screen.getByRole('heading', { name: '這個連結不能用了' })).toBeTruthy();
		expect(screen.getByText('可能超過時間（邀請 24 小時、重設密碼 1 小時），或已經用過了。')).toBeTruthy();
		expect(screen.queryByLabelText('密碼')).toBeNull();
		expect(screen.getByRole('link', { name: '重寄一封信' }).getAttribute('href')).toBe('/forgot-password');
	});

	it('送出時連結剛好不能用了：換成「這個連結不能用了」', async () => {
		const { state } = await openLink();
		delete state.links.tok1;
		await submit('啦啦隊 加油 👨‍👩‍👧 abc 12');
		expect(screen.getByRole('heading', { name: '這個連結不能用了' })).toBeTruthy();
	});
});
