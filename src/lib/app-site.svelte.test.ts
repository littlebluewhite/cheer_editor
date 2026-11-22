// 殼代網頁上網（#380，ADR 0023）：網頁照舊 fetch('/api/…')，App 裡由殼轉到網站（殼的測試在 ios/）。
// 網頁這邊：分享連結、雲端流程照殼說的網站網址做（App 裡 location.href 是 app://local/）；管理使用者頁在 App 裡藏起來。
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { isRedirect } from '@sveltejs/kit';
import { host } from '#lib/host.js';
import { appShell, useShellIfInApp } from '#lib/app-shell.js';
import { scenarioShell } from '#lib/scenario-shell.js';
import { shareUrl } from '#lib/share-link.js';
import { editorPage, fakeHost, fakeServer, flush } from '#lib/test-fakes.js';
import Page from '../routes/+page.svelte';
import { load as usersLoad } from '../routes/users/+page.js';

const lin = { email: 'lin@example.com', name: '林教練', isAdmin: true, password: '我們這一隊今年一定會贏 go go' };

afterEach(() => {
	cleanup();
	delete window.__cheerShell;
});

describe('App 裡的網站網址', () => {
	it('照殼一開始說的網站網址做分享連結，不是 app://local/', () => {
		const fake = scenarioShell('network.json', '一開始告訴網頁殼轉到哪個網站');
		window.__cheerShell = fake.bridge;
		const undo = useShellIfInApp();
		try {
			expect(host().siteUrl()).toBe('https://littlebluewhite.com/');
			expect(shareUrl('t0k')).toBe('https://littlebluewhite.com/#share=t0k');
		} finally {
			undo?.();
		}
		expect(host().siteUrl()).toBe(location.href);
	});

	it('網頁畫面出來以後照樣跟殼說好了', async () => {
		const fake = scenarioShell('network.json', '一開始告訴網頁殼轉到哪個網站');
		window.__cheerShell = fake.bridge;
		const undo = useShellIfInApp();
		try {
			await host().shell.send('ready');
		} finally {
			undo?.();
		}
		fake.done();
	});
});

describe('App 裡沒有管理使用者頁', () => {
	it('管理員的選單裡沒有「管理使用者」', async () => {
		const fake = scenarioShell('network.json', '一開始告訴網頁殼轉到哪個網站');
		fakeHost({ shell: appShell(fake.bridge) });
		const { server } = fakeServer({ users: [lin], signedIn: lin.email });
		render(Page, editorPage(null, { server }).props);
		await flush();
		await fireEvent.click(screen.getByRole('button', { name: '林教練 ▾' }));
		const menu = screen.getByRole('menu');
		expect(within(menu).getByRole('menuitem', { name: '我的帳號' })).toBeTruthy();
		expect(within(menu).queryByRole('menuitem', { name: '管理使用者' })).toBeNull();
	});

	it('直接打網址也進不去：回首頁', () => {
		const fake = scenarioShell('network.json', '一開始告訴網頁殼轉到哪個網站');
		fakeHost({ shell: appShell(fake.bridge) });
		let thrown: unknown;
		try {
			usersLoad();
		} catch (e) {
			thrown = e;
		}
		expect(isRedirect(thrown) && thrown.location).toBe('/');
	});

	it('網頁版照舊進得去', () => {
		expect(() => usersLoad()).not.toThrow();
	});
});
