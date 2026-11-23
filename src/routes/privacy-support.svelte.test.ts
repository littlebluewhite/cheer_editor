// 隱私權政策、支援頁（#372）：沒登入打得開、不問伺服器；兩頁互相連；
// 首頁（登入前後）、登入頁、帳號頁、使用說明最下面有「隱私權政策・支援」，編輯畫面沒有。
import { render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { editorPage, fakeOfflineStore, fakeServer, flush } from '#lib/test-fakes.js';
import { libSample } from '#lib/test-flows.js';
import Privacy from './privacy/+page.svelte';
import Support from './support/+page.svelte';
import Login from './login/+page.svelte';
import Account from './account/+page.svelte';
import Guide from './guide/+page.svelte';
import Page from './+page.svelte';

Element.prototype.scrollIntoView = () => {};

const lin = { email: 'lin@example.com', name: '林教練', isAdmin: false, password: '我們這一隊今年一定會贏 go go' };
const SUPPORT = 'mailto:support@littlebluewhite.com';

const hrefs = (name: string) => screen.queryAllByRole('link', { name }).map((a) => a.getAttribute('href'));

/** 「隱私權政策・支援」那一行：兩個站內連結，不開新分頁（App 裡開 App 裡那一頁）。 */
function expectFooterLinks() {
	const privacy = screen.getByRole('link', { name: '隱私權政策' });
	const support = screen.getByRole('link', { name: '支援' });
	expect(privacy.getAttribute('href')).toBe('/privacy');
	expect(support.getAttribute('href')).toBe('/support');
	expect(privacy.getAttribute('target')).toBeNull();
	expect(support.getAttribute('target')).toBeNull();
}

afterEach(() => vi.restoreAllMocks());

describe('隱私權政策頁', () => {
	it('不問伺服器就畫得出來；最上面寫最後更新日期；連到支援頁、支援信箱、回首頁', () => {
		const fetch = vi.spyOn(globalThis, 'fetch');
		render(Privacy);
		expect(fetch).not.toHaveBeenCalled();
		expect(screen.getByRole('heading', { level: 1, name: '隱私權政策' })).toBeTruthy();
		expect(screen.getByText(/最後更新：\d{4}-\d{2}-\d{2}/)).toBeTruthy();
		expect(hrefs('支援')).toContain('/support');
		expect(hrefs('support@littlebluewhite.com')).toContain(SUPPORT);
		expect(hrefs('回首頁')).toContain('/');
	});

	it('分段寫齊大綱的十件事（含個資法第 8 條的「不提供的影響」）', () => {
		render(Privacy);
		for (const name of [
			'誰在收',
			'這份政策管什麼',
			'沒有帳號時',
			'有帳號時收什麼、怎麼收、拿來做什麼',
			'不提供的話',
			'交給哪些服務、在哪裡',
			'留多久',
			'你的權利',
			'未滿 18 歲',
			'外洩',
			'改版'
		]) {
			expect(screen.getByRole('heading', { level: 2, name }), name).toBeTruthy();
		}
	});

	it('每家服務寫名字和國家或地區', () => {
		render(Privacy);
		const vendors = screen.getByRole('table', { name: '交給哪些服務' });
		for (const [name, where] of [
			['Fly.io', '新加坡'],
			['Neon', '新加坡'],
			['Cloudflare', '亞太地區'],
			['Resend', '美國'],
			['Pwned Passwords', ''],
			['Apple iCloud', '']
		]) {
			const row = within(vendors).getByRole('row', { name: new RegExp(name) });
			expect(row.textContent).toContain(where);
		}
	});

	it('留多久的數字照伺服器和服務商：cookie 最多 400 天、登入 30 天失效、備份最多再留 31 天', () => {
		render(Privacy);
		const keep = screen.getByRole('table', { name: '留多久' }).textContent ?? '';
		for (const text of ['400 天', '30 天後失效', '最多再留 31 天', '7 天', '60 天', '24 小時', '1 小時']) {
			expect(keep, text).toContain(text);
		}
	});
});

describe('支援頁', () => {
	it('不問伺服器；有支援信箱、使用說明、怎麼要求刪除帳號、家長和隊員怎麼要求、多久回、隱私權政策', () => {
		const fetch = vi.spyOn(globalThis, 'fetch');
		render(Support);
		expect(fetch).not.toHaveBeenCalled();
		expect(screen.getByRole('heading', { level: 1, name: '支援' })).toBeTruthy();
		expect(hrefs('support@littlebluewhite.com')).toContain(SUPPORT);
		expect(hrefs('使用說明')).toContain('/guide');
		expect(hrefs('隱私權政策')).toContain('/privacy');
		expect(hrefs('帳號頁')).toContain('/account');
		for (const name of ['寫信給我們', '要求刪除帳號', '家長要刪孩子的帳號', '不是使用者的隊員', '多久回']) {
			expect(screen.getByRole('heading', { level: 2, name }), name).toBeTruthy();
		}
	});
});

describe('「隱私權政策・支援」在哪裡', () => {
	it('首頁沒登入', async () => {
		render(Page, editorPage().props);
		await flush();
		expectFooterLinks();
	});

	it('首頁登入後', async () => {
		const fake = fakeServer({ users: [lin], signedIn: lin.email });
		render(Page, editorPage(null, { server: fake.server }).props);
		await flush();
		expect(screen.getByRole('region', { name: '雲端' })).toBeTruthy();
		expectFooterLinks();
	});

	it('編輯畫面沒有', async () => {
		render(Page, editorPage(libSample()).props);
		await flush();
		expect(screen.queryByRole('link', { name: '隱私權政策' })).toBeNull();
	});

	it('登入頁', () => {
		history.replaceState(null, '', '/login');
		render(Login, { server: fakeServer({ users: [lin] }).server, go: () => {}, offline: fakeOfflineStore().store });
		expectFooterLinks();
	});

	it('帳號頁', async () => {
		const fake = fakeServer({ users: [lin], signedIn: lin.email });
		render(Account, { server: fake.server, go: () => {}, offline: fakeOfflineStore().store });
		await flush();
		expectFooterLinks();
	});

	it('使用說明最後，第三方套件授權旁邊', () => {
		render(Guide);
		expectFooterLinks();
		const credits = screen.getByRole('link', { name: '第三方套件授權' }).closest('p')!;
		expect(within(credits).getByRole('link', { name: '隱私權政策' })).toBeTruthy();
	});
});
