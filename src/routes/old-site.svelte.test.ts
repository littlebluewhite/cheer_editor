// 舊網址版（GitHub Pages，#267）：首頁最上面一條黃的搬家提示和「到新網址」，沒有「登入」。新網址版沒有黃條。
import { render, screen } from '@testing-library/svelte';
import { isRedirect } from '@sveltejs/kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { editorPage, flush } from '#lib/test-fakes.js';
import Page from './+page.svelte';

/** 這次建的是哪一版（建置時由 OLD_SITE 決定，見 docs/deploy.md）。 */
const site = vi.hoisted(() => ({ old: false }));
vi.mock('#lib/old-site.js', async (load) => ({
	...(await load<typeof import('#lib/old-site.js')>()),
	get OLD_SITE() {
		return site.old;
	}
}));

afterEach(() => (site.old = false));

const MOVED =
	'搬家了：新網址是 littlebluewhite.com。這裡還能用，但不能登入。瀏覽器裡的草稿帶不過去：先打開草稿、存成流程檔，再到新網址打開。';

describe('舊網址版', () => {
	it('首頁有黃條和「到新網址」，沒有「登入」', async () => {
		site.old = true;
		render(Page, editorPage().props);
		await flush();
		expect(screen.getByRole('note').textContent).toContain(MOVED);
		expect(screen.getByRole('link', { name: '到新網址' }).getAttribute('href')).toBe('https://littlebluewhite.com/');
		expect(screen.queryByRole('link', { name: '登入' })).toBeNull();
	});

	it('新網址版沒有黃條', async () => {
		render(Page, editorPage().props);
		await flush();
		expect(screen.queryByText(/搬家了/)).toBeNull();
		expect(screen.queryByRole('link', { name: '到新網址' })).toBeNull();
		expect(screen.getByRole('link', { name: '登入' })).toBeTruthy();
	});
});

/** 登入才用得到的頁：舊網址版不能登入（#267），打開直接回首頁。 */
const LOGIN_ONLY = ['account', 'forgot-password', 'login', 'set-password', 'users'];
const pages = Object.keys(import.meta.glob('./*/+page.svelte')).map((path) => path.split('/')[1]);
const loads = import.meta.glob<{ load?: () => unknown }>('./*/+page.ts', { eager: true });

/** 打開這一頁時轉去哪（沒轉址是 null）。 */
function redirectedTo(name: string): string | null {
	const load = loads[`./${name}/+page.ts`]?.load;
	if (!load) return null;
	try {
		load();
	} catch (e) {
		if (isRedirect(e)) return e.location;
		throw e;
	}
	return null;
}

describe('舊網址版：登入才用得到的頁', () => {
	it('除了首頁、使用說明，每一頁都是登入才用得到的（多了新頁要在這裡決定）', () => {
		expect(pages.filter((name) => name !== 'guide').sort()).toEqual(LOGIN_ONLY);
	});

	it('打開直接回首頁，看不到登入表單', () => {
		site.old = true;
		for (const name of LOGIN_ONLY) expect(redirectedTo(name), name).toBe('/');
		expect(redirectedTo('guide')).toBeNull();
	});

	it('新網址版照常打開', () => {
		for (const name of LOGIN_ONLY) expect(redirectedTo(name), name).toBeNull();
	});
});
