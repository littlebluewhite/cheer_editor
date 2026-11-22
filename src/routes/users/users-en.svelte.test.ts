// 管理使用者頁、分享對話框、登入頁的英文畫面（ADR 0017）：使用者看得到的字（含 aria-label、placeholder、頁名）沒有中文。
// 測試資料的名字都用英文，教練自己取的名字才不算。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { localStorageKey } from '#lib/paraglide/runtime.js';
import ShareDialog from '#lib/components/ShareDialog.svelte';
import TestSession from '#lib/TestSession.svelte';
import { fakeServer, flush, testEditor, type FakeCloudFlow, type FakeUser } from '#lib/test-fakes.js';
import { libSample } from '#lib/test-flows.js';
import Login from '../login/+page.svelte';
import Users from './+page.svelte';

// jsdom 沒有 scrollIntoView（錯誤訊息出現時捲過去，reveal.ts）。
Element.prototype.scrollIntoView = () => {};

const HAN = /\p{Script=Han}/u;
const PW = 'we will win this year go go go';
const lin: FakeUser = { email: 'lin@example.com', name: 'Coach Lin', isAdmin: true, password: PW };
const wang: FakeUser = { email: 'wang@example.com', name: 'Coach Wang', isAdmin: false, password: PW };
const mei: FakeUser = { email: 'mei@example.com', name: 'Mei', isAdmin: false };
const fang: FakeUser = { email: 'fang@example.com', name: 'Fang', isAdmin: false };
const huang: FakeUser = { email: 'huang@example.com', name: 'Coach Huang', isAdmin: false, password: PW, disabled: true };

const flowOf = (id: string, owner: string, people: FakeCloudFlow['people'] = {}): FakeCloudFlow => ({
	id,
	owner,
	flow: libSample(),
	updatedAt: new Date(2026, 10, 6).toISOString(),
	people
});

/** 畫面上（含屬性）和頁名都沒有中文。 */
function noHan(el: HTMLElement = document.body) {
	expect(el.innerHTML).not.toMatch(HAN);
	expect(document.title).not.toMatch(HAN);
}

const row = (name: string) => screen.getAllByRole('row').find((r) => within(r).queryByText(name))!;

describe('管理使用者頁（英文）', () => {
	async function usersPage() {
		localStorage.setItem(localStorageKey, 'en');
		const fake = fakeServer({
			users: [lin, wang, mei, fang, huang].map((u) => ({ ...u })),
			links: { invite1: { email: mei.email, purpose: 'invite', hoursLeft: 5 } },
			signedIn: lin.email,
			flows: [flowOf('c1', huang.email), flowOf('c2', huang.email)]
		});
		render(Users, { server: fake.server });
		await flush();
		return fake;
	}

	it('表、每種狀態、按了之後的綠字和紅字', async () => {
		const { state } = await usersPage();
		expect(screen.getByRole('heading', { name: 'Manage users' })).toBeTruthy();
		expect(document.title).toBe('Manage users — Routine Editor');
		expect(within(row('Mei')).getByText('Waiting for them to set a password (invite expires in 5 hours)')).toBeTruthy();
		expect(within(row('Fang')).getByText("Invite expired; they haven't set a password")).toBeTruthy();
		expect(within(row('Coach Huang')).getByText('Deactivated · owns 2 routines')).toBeTruthy();
		expect(within(row('Coach Huang')).getByRole('button', { name: 'Transfer 2 routines' })).toBeTruthy();
		noHan();

		await fireEvent.click(within(row('Coach Wang')).getByRole('button', { name: 'Send password reset' }));
		await flush();
		expect(screen.getByRole('status').textContent).toBe('Sent a password reset email to wang@example.com.');

		state.mailQuota = true;
		await fireEvent.click(within(row('Fang')).getByRole('button', { name: 'Resend invite' }));
		await flush();
		expect(screen.getByRole('alert').textContent).toBe("Can't send any more emails today. Try again tomorrow.");
		noHan();
	});

	it('每個對話框', async () => {
		await usersPage();
		const open = async (name: string, button: string, title: string) => {
			await fireEvent.click(name ? within(row(name)).getByRole('button', { name: button }) : screen.getByRole('button', { name: button }));
			await flush();
			const dialog = screen.getByRole('dialog', { name: title });
			noHan(dialog);
			await fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
		};
		await open('', '+ Add user', 'Add user');
		await open('Coach Wang', 'Change email', 'Change email: Coach Wang');
		await open('Coach Wang', 'Deactivate', 'Deactivate Coach Wang?');
		await open('Coach Huang', 'Transfer 2 routines', "Transfer Coach Huang's routines");
	});
});

describe('分享對話框（英文）', () => {
	async function share(me: string, people: FakeCloudFlow['people']) {
		localStorage.setItem(localStorageKey, 'en');
		const fake = fakeServer({ users: [lin, wang, huang], signedIn: me, flows: [flowOf('c1', wang.email, people)] });
		const { editor } = testEditor(null, { server: fake.server });
		render(TestSession, { props: { editor, component: ShareDialog, props: { flowId: 'c1', flowName: 'Test', onclose: () => {} } } });
		await flush();
		return screen.getByRole('dialog', { name: 'Share “Test”' });
	}

	it('擁有者：名單、權限選單、分享連結；加不進去的原因、收回、確認框', async () => {
		const dialog = await share(wang.email, { [lin.email]: 'recorder' });
		const people = within(within(dialog).getByRole('list', { name: 'People with access' })).getAllByRole('listitem');
		expect(people[0].textContent).toContain('Coach Wang (you)');
		expect(people[0].textContent).toContain('Owner');
		expect(within(dialog).getByLabelText("Coach Lin's permission")).toBeTruthy();
		noHan(dialog);

		const email = within(dialog).getByLabelText('Email');
		await fireEvent.input(email, { target: { value: lin.email } });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
		await flush();
		expect(within(dialog).getByRole('alert').textContent).toBe('Coach Lin already has Recorder access. Change it in the list below.');
		await fireEvent.input(email, { target: { value: huang.email } });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
		await flush();
		expect(within(dialog).getByRole('alert').textContent).toBe("Coach Huang's account is deactivated, so you can't share with them.");
		noHan(dialog);

		await fireEvent.change(within(dialog).getByLabelText("Coach Lin's permission"), { target: { value: 'revoke' } });
		await flush();
		expect(within(dialog).getByRole('status').textContent).toBe("Removed Coach Lin's access.");

		await fireEvent.click(within(dialog).getByRole('switch'));
		await flush();
		expect(within(dialog).getByText('On: anyone with the link can view')).toBeTruthy();
		noHan(dialog);

		// 確認框（ConfirmList 是別的元件）：只看這裡給它的句子和按鈕
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Delete this routine' }));
		await flush();
		expect(dialog.textContent).toContain('Delete “Test”? No one will be able to open it');
		expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeTruthy();
	});

	it('不是擁有者：看得到權限、分享連結關著、離開', async () => {
		const dialog = await share(lin.email, { [lin.email]: 'viewer' });
		expect(within(dialog).getByText('Off (only the owner can turn it on or off)')).toBeTruthy();
		expect(within(dialog).getByRole('button', { name: 'Leave this routine' })).toBeTruthy();
		noHan(dialog);
	});
});

describe('登入頁（英文）', () => {
	it('不登入也能用那一句：連結在句子中間；試太多次說要等幾分鐘', async () => {
		localStorage.setItem(localStorageKey, 'en');
		history.replaceState(null, '', '/login');
		const fake = fakeServer({ users: [lin] });
		render(Login, { server: fake.server, go: () => {} });
		expect(screen.getByText(/without signing in/).textContent).toBe(
			'You can also use it without signing in: back to home. Routines are then saved on this device only.'
		);
		expect(screen.getByRole('link', { name: 'back to home' }).getAttribute('href')).toBe('/');
		fake.state.retryAfter = 61;
		await fireEvent.input(screen.getByLabelText('Email'), { target: { value: lin.email } });
		await fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
		await fireEvent.submit(screen.getByLabelText('Email').closest('form')!);
		await flush();
		expect(screen.getByRole('alert').textContent).toContain('Too many tries. Try again in 2 minutes');
		noHan();
	});
});
