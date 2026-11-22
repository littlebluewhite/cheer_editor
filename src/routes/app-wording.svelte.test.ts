// App 裡的字（#392）：網頁問殼在不在 App 裡（不看是不是觸控螢幕）。App 裡不會發生的藏起來，還會發生的換說法，
// 會踩到的地方多一句「同一台 iPad 上，App 和瀏覽器各存各的、各登各的」。網頁版照舊。
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFlow, writeFlowFile } from '#lib/core';
import { editorPage, fakeDraftStore, fakeHost, fakeServer, fakeShell, fakeTabs, flush, menuItem, testEditor } from '#lib/test-fakes.js';
import { flowOf, libSample } from '#lib/test-flows.js';
import { localStorageKey } from '#lib/paraglide/runtime.js';
import Page from './+page.svelte';

Element.prototype.scrollIntoView = () => {};

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

/** iPhone 的 WKWebView（iPad 的是電腦版，寫 Macintosh）。 */
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

const coach = { email: 'lin@example.com', name: '林教練', isAdmin: false, password: '我們這一隊今年一定會贏 go go' };

/** 裝成有滑鼠的裝置（電腦，或接了觸控板的 iPad）。 */
const mouse = () => vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(pointer: fine)' }));

async function openMenu() {
	const page = editorPage(libSample());
	render(Page, page.props);
	await tick();
	await fireEvent.click(screen.getByRole('button', { name: '選單' }));
}

describe('輸出影片', () => {
	it('App 裡、有滑鼠：選單裡沒有輸出影片', async () => {
		fakeHost({ shell: fakeShell() });
		mouse();
		await openMenu();
		expect(await menuItem('流程設定')).toBeTruthy();
		expect(await menuItem('輸出影片')).toBeFalsy();
	});

	it('網頁版、有滑鼠：照舊有輸出影片', async () => {
		mouse();
		await openMenu();
		expect(await menuItem('輸出影片')).toBeTruthy();
	});
});

describe('另一個分頁正在編', () => {
	it('App 裡（只有一個視窗）：首頁不標「另一個分頁正在編」，打得開', async () => {
		fakeHost({ shell: fakeShell() });
		const drafts = fakeDraftStore();
		const tabs = fakeTabs();
		const other = testEditor(null, { draftStore: drafts.store, openTabChannel: tabs });
		other.editor.file.connect();
		other.editor.file.create(flowOf(createFlow({ name: '全國賽', field: { strips: 9, layout: 'vertical' } })));
		await flush();
		await other.editor.file.leaveToHome();
		await other.editor.file.openRecent([...drafts.all.keys()][0]);
		await flush();
		render(Page, editorPage(null, { draftStore: drafts.store, openTabChannel: tabs }).props);
		await new Promise((r) => setTimeout(r, 350));
		expect(screen.getByRole('button', { name: /^全國賽/ }).textContent).not.toContain('另一個分頁正在編');
		await fireEvent.click(screen.getByRole('button', { name: /^全國賽/ }));
		await vi.waitFor(() => expect(screen.queryByRole('textbox', { name: /流程名/ })).toBeNull());
		expect(screen.queryByText(/另一個分頁/)).toBeNull();
	});
});

describe('「同一台 iPad 上，App 和瀏覽器各存各的、各登各的」：首頁', () => {
	const SAME = '同一台 iPad 上，App 和瀏覽器各存各的、各登各的';
	/** 首頁，有一份草稿（最近的流程、草稿的提醒才出現）。 */
	function homeWithDraft() {
		const drafts = fakeDraftStore();
		drafts.all.set('n1', { bytes: writeFlowFile(flowOf(createFlow({ name: '全國賽', field: { strips: 9, layout: 'vertical' } })), {}), savedAt: new Date(2026, 10, 4, 9, 0) });
		render(Page, editorPage(null, { draftStore: drafts.store }).props);
	}
	/** 登入後的首頁，「這台裝置」那一欄是空的。 */
	function signedInEmpty() {
		const fake = fakeServer({ users: [coach], signedIn: coach.email });
		render(Page, editorPage(null, { server: fake.server, draftStore: fakeDraftStore().store }).props);
	}
	const hereColumn = () => screen.getByRole('region', { name: '這台裝置' });

	it('App 裡「這台裝置」是空的：說各存各的，Safari 做的流程先存成流程檔再用 App 打開', async () => {
		fakeHost({ shell: fakeShell() });
		signedInEmpty();
		await flush();
		const text = hereColumn().textContent!;
		expect(text).toContain(SAME);
		expect(text).toContain('在 Safari 做的流程，先存成流程檔，再用 App 打開');
	});

	it('App 裡草稿的提醒：不寫「這個瀏覽器」，寫存在 App 裡、各存各的', async () => {
		fakeHost({ shell: fakeShell() });
		homeWithDraft();
		await flush();
		const note = screen.getByText(/草稿只存在/).textContent!;
		expect(note).not.toContain('這個瀏覽器');
		expect(note).toContain('App 裡');
		expect(note).toContain(SAME);
	});

	it('iPhone 的 App：句子裡寫 iPhone', async () => {
		fakeHost({ shell: fakeShell() });
		vi.stubGlobal('navigator', { ...navigator, userAgent: IPHONE });
		homeWithDraft();
		await flush();
		expect(screen.getByText(/草稿只存在/).textContent).toContain('同一台 iPhone 上，App 和瀏覽器各存各的、各登各的');
	});

	it('網頁版：草稿的提醒照舊，沒有那一句', async () => {
		homeWithDraft();
		await flush();
		expect(screen.getByText(/草稿只存在/).textContent).toBe('草稿只存在這個瀏覽器裡。只是打開看、不小心改到的，按「丟掉」再開原檔。');
		expect(document.body.textContent).not.toContain('各存各的');
	});

	// 日文還沒開放（project.inlang 只有 zh-TW、en），ja.json 跟繁中一樣多 key 由 src/lib/messages.test.ts 管
	it('英文也有那一句', async () => {
		fakeHost({ shell: fakeShell() });
		localStorage.setItem(localStorageKey, 'en');
		homeWithDraft();
		await flush();
		expect(document.querySelector('.recent-note')!.textContent).toContain('on the same iPad, the App and the browser keep their own data and sign-ins');
	});

	it('網頁版：「這台裝置」是空的照舊只寫「還沒有。」', async () => {
		signedInEmpty();
		await flush();
		expect(hereColumn().querySelector('li.empty')!.textContent).toBe('還沒有。');
		expect(document.body.textContent).not.toContain('各存各的');
	});
});
