// 舊網址版（GitHub Pages，#267）：首頁最上面一條黃的搬家提示和「到新網址」，沒有「登入」。新網址版沒有黃條。
import { render, screen } from '@testing-library/svelte';
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
