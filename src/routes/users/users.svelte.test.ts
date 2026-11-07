import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { fakeServer, flush, type FakeUser } from '#lib/test-fakes.js';
import Users from './+page.svelte';

const PW = '我們這一隊今年一定會贏 go go';
const lin: FakeUser = { email: 'lin@example.com', name: '林教練', isAdmin: true, password: PW };
const wang: FakeUser = { email: 'wang@example.com', name: '王教練', isAdmin: false, password: PW };
const mei: FakeUser = { email: 'mei@example.com', name: '陳小美', isAdmin: false };
const fang: FakeUser = { email: 'fang@example.com', name: '李小芳', isAdmin: false };
const huang: FakeUser = { email: 'huang@example.com', name: '黃教練', isAdmin: false, password: PW, disabled: true };

/** 管理使用者頁，林教練（管理員）登入著。mei 的邀請還有 5 小時，fang 的邀請過期了。 */
async function usersPage(signedIn = lin.email) {
	const fake = fakeServer({
		users: [lin, wang, mei, fang, huang].map((u) => ({ ...u })),
		links: { invite1: { email: mei.email, purpose: 'invite', hoursLeft: 5 } },
		signedIn
	});
	render(Users, { server: fake.server });
	await flush();
	return fake;
}

/** 表上某個人那一列。 */
function row(name: string): HTMLElement {
	return screen.getAllByRole('row').find((r) => within(r).queryByText(name))!;
}
const buttons = (name: string) => within(row(name)).queryAllByRole('button').map((b) => b.textContent?.trim());
const green = () => screen.getByRole('status').textContent;

describe('管理使用者頁', () => {
	it('一張表：名字、Email、狀態、按鈕；右上「＋ 加使用者」', async () => {
		await usersPage();
		expect(screen.getByRole('heading', { name: '管理使用者' })).toBeTruthy();
		const headers = screen.getAllByRole('columnheader').map((h) => h.textContent?.trim());
		expect(headers.slice(0, 3)).toEqual(['名字', 'Email', '狀態']);
		expect(screen.getByRole('button', { name: '＋ 加使用者' })).toBeTruthy();
		expect(within(row('王教練')).getByText('wang@example.com')).toBeTruthy();
	});

	it('每種狀態的字和按鈕；自己那列沒有「停用」', async () => {
		await usersPage();
		expect(within(row('王教練')).getByText('可以登入')).toBeTruthy();
		expect(buttons('王教練')).toEqual(['寄重設密碼信', '改 email', '停用']);
		expect(within(row('陳小美')).getByText('等他設密碼（邀請信 5 小時後過期）')).toBeTruthy();
		expect(buttons('陳小美')).toEqual(['重寄邀請', '改 email', '停用']);
		expect(within(row('李小芳')).getByText('邀請過期，他還沒設密碼')).toBeTruthy();
		expect(buttons('李小芳')).toEqual(['重寄邀請', '改 email', '停用']);
		expect(within(row('黃教練')).getByText('已停用')).toBeTruthy();
		expect(buttons('黃教練')).toEqual(['恢復', '改 email']);
		expect(within(row('林教練')).getByText('可以登入')).toBeTruthy();
		expect(buttons('林教練')).toEqual(['寄重設密碼信', '改 email']);
	});

	it('不是管理員：看不到表', async () => {
		await usersPage(wang.email);
		expect(screen.getByText('只有管理員能看這一頁。')).toBeTruthy();
		expect(screen.queryByRole('table')).toBeNull();
	});

	it('寄重設密碼信、重寄邀請、恢復：按了直接做，表上面綠色一行', async () => {
		const { state } = await usersPage();
		await fireEvent.click(within(row('王教練')).getByRole('button', { name: '寄重設密碼信' }));
		await flush();
		expect(green()).toBe('寄了重設密碼信給 wang@example.com。');
		expect(Object.values(state.links)).toContainEqual(expect.objectContaining({ email: wang.email, purpose: 'reset' }));

		await fireEvent.click(within(row('李小芳')).getByRole('button', { name: '重寄邀請' }));
		await flush();
		expect(green()).toBe('重寄了邀請給 fang@example.com，舊的連結不能用了。');
		expect(within(row('李小芳')).getByText('等他設密碼（邀請信 24 小時後過期）')).toBeTruthy();

		await fireEvent.click(within(row('黃教練')).getByRole('button', { name: '恢復' }));
		await flush();
		expect(green()).toBe('恢復了黃教練，他用原本的密碼就能登入。');
		expect(within(row('黃教練')).getByText('可以登入')).toBeTruthy();
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('加使用者：對話框填 email、名字，按「寄邀請」；新的一列在等他設密碼', async () => {
		await usersPage();
		await fireEvent.click(screen.getByRole('button', { name: '＋ 加使用者' }));
		const dialog = screen.getByRole('dialog', { name: '加使用者' });
		expect(within(dialog).getByText('會寄一封邀請信給他，24 小時內設好密碼就能登入。名字他之後可以自己改。')).toBeTruthy();
		await fireEvent.input(within(dialog).getByLabelText('Email'), { target: { value: 'chen@example.com' } });
		await fireEvent.input(within(dialog).getByLabelText('名字'), { target: { value: '陳教練' } });
		await fireEvent.click(within(dialog).getByRole('button', { name: '寄邀請' }));
		await flush();

		expect(screen.queryByRole('dialog')).toBeNull();
		expect(green()).toBe('寄了邀請給 chen@example.com。');
		expect(within(row('陳教練')).getByText('等他設密碼（邀請信 24 小時後過期）')).toBeTruthy();
	});

	it('加使用者：同一個 email（大小寫不同）加不進去，對話框留著說原因', async () => {
		await usersPage();
		await fireEvent.click(screen.getByRole('button', { name: '＋ 加使用者' }));
		const dialog = screen.getByRole('dialog', { name: '加使用者' });
		await fireEvent.input(within(dialog).getByLabelText('Email'), { target: { value: 'WANG@example.com' } });
		await fireEvent.input(within(dialog).getByLabelText('名字'), { target: { value: '另一個王' } });
		await fireEvent.click(within(dialog).getByRole('button', { name: '寄邀請' }));
		await flush();
		expect(within(dialog).getByRole('alert').textContent).toBe('這個 email 已經有帳號了。');
		expect(screen.queryByText('另一個王')).toBeNull();
	});

	it('改 email：對話框寫現在的 email 和通知的事；改好後表上換新的', async () => {
		await usersPage();
		await fireEvent.click(within(row('王教練')).getByRole('button', { name: '改 email' }));
		const dialog = screen.getByRole('dialog', { name: '改 email：王教練' });
		expect(within(dialog).getByText('現在：wang@example.com')).toBeTruthy();
		expect(within(dialog).getByText('改好後新舊兩個信箱都會收到通知，他下次用新的 email 登入。不能跟別人重複。')).toBeTruthy();

		await fireEvent.input(within(dialog).getByLabelText('新的 email'), { target: { value: 'mei@example.com' } });
		await fireEvent.click(within(dialog).getByRole('button', { name: '改 email' }));
		await flush();
		expect(within(dialog).getByRole('alert').textContent).toBe('這個 email 已經是別人的了。');

		await fireEvent.input(within(dialog).getByLabelText('新的 email'), { target: { value: 'wang2@example.com' } });
		await fireEvent.click(within(dialog).getByRole('button', { name: '改 email' }));
		await flush();
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(within(row('王教練')).getByText('wang2@example.com')).toBeTruthy();
		expect(green()).toBe('改好了：王教練的 email 是 wang2@example.com，新舊兩個信箱都寄了通知。');
	});

	it('停用：確認框寫清楚三點，停用後他登出、狀態「已停用」', async () => {
		const { state } = await usersPage();
		await fireEvent.click(within(row('王教練')).getByRole('button', { name: '停用' }));
		const dialog = screen.getByRole('dialog', { name: '停用王教練？' });
		for (const line of [
			'他每台裝置馬上登出，還沒用的連結都不能用。',
			'他的流程、權限、記的紀錄都留著，別人照常能用。',
			'之後可以恢復，他用原本的密碼登入。'
		]) {
			expect(within(dialog).getByText(line)).toBeTruthy();
		}
		await fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(within(row('王教練')).getByText('可以登入')).toBeTruthy();

		await fireEvent.click(within(row('王教練')).getByRole('button', { name: '停用' }));
		await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '停用' }));
		await flush();
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(within(row('王教練')).getByText('已停用')).toBeTruthy();
		expect(green()).toBe('停用了王教練。');
		expect(state.users.find((u) => u.email === wang.email)?.disabled).toBe(true);
	});

	it('寄信服務今天的額度用完了：「今天寄不出去，明天再試。」', async () => {
		const { state } = await usersPage();
		state.mailQuota = true;
		await fireEvent.click(within(row('王教練')).getByRole('button', { name: '寄重設密碼信' }));
		await flush();
		expect(screen.getByRole('alert').textContent).toBe('今天寄不出去，明天再試。');
		expect(screen.queryByRole('status')).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: '＋ 加使用者' }));
		const dialog = screen.getByRole('dialog', { name: '加使用者' });
		await fireEvent.input(within(dialog).getByLabelText('Email'), { target: { value: 'chen@example.com' } });
		await fireEvent.input(within(dialog).getByLabelText('名字'), { target: { value: '陳教練' } });
		await fireEvent.click(within(dialog).getByRole('button', { name: '寄邀請' }));
		await flush();
		expect(within(dialog).getByRole('alert').textContent).toBe('今天寄不出去，明天再試。');
	});
});
