// 頁面：打開 App 回上次那支（#378）。規則（記、開、不見了）在 src/lib/last-flow.svelte.test.ts；這裡測畫面不先閃一下首頁。
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { createFlow, writeFlowFile } from '#lib/core';
import { cloudEditor, editorPage, fakeDraftStore, fakeHost, fakeSettings, fakeShell, flush } from '#lib/test-fakes.js';
import { flowOf } from '#lib/test-flows.js';
import html from '../app.html?raw';
import Page from './+page.svelte';

const hideScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((s) => s[1]).find((s) => s.includes('lastFlow'));

afterEach(() => {
	cleanup();
	delete window.__cheerShell;
	delete document.documentElement.dataset.reopening;
});

describe('打開 App 回上次那支', () => {
	it('中間不畫首頁，開好了就是那支流程的場地', async () => {
		const drafts = fakeDraftStore();
		await drafts.store.save('n1', writeFlowFile(flowOf(createFlow({ name: '全國賽', field: { strips: 9, layout: 'vertical' } })), {}));
		fakeHost({ shell: fakeShell(['settings']), settings: fakeSettings({ 'cheer-editor:lastFlow': 'n1' }).settings });
		document.documentElement.dataset.reopening = '';
		render(Page, editorPage(null, { draftStore: drafts.store }).props);
		expect(screen.queryByLabelText('流程名字')).toBeNull();
		expect('reopening' in document.documentElement.dataset).toBe(true);
		await flush();
		await flush();
		expect(screen.getByTitle('全國賽')).toBeTruthy();
		expect('reopening' in document.documentElement.dataset).toBe(false);
	});

	it('上次那支不見了：停在首頁，畫面也接手', async () => {
		fakeHost({ shell: fakeShell(['settings']), settings: fakeSettings({ 'cheer-editor:lastFlow': 'n1' }).settings });
		document.documentElement.dataset.reopening = '';
		render(Page, editorPage(null).props);
		await flush();
		await flush();
		expect(screen.getByLabelText('流程名字')).toBeTruthy();
		expect('reopening' in document.documentElement.dataset).toBe(false);
	});

	it('App 換上新網頁回到雲端流程（?cloud=c1）、上次那支記著別支：開 c1，不開那支（#394）', async () => {
		const s = await cloudEditor();
		await s.editor.file.leaveToHome();
		const drafts = fakeDraftStore();
		await drafts.store.save('n1', writeFlowFile(flowOf(createFlow({ name: '全國賽', field: { strips: 9, layout: 'vertical' } })), {}));
		fakeHost({ shell: fakeShell(['settings', 'webUpdate']), settings: fakeSettings({ 'cheer-editor:lastFlow': 'n1' }).settings });
		// 草稿讀得比伺服器慢：兩個一起開時，後開好的不能蓋掉 c1
		const load = drafts.store.load.bind(drafts.store);
		drafts.store.load = async (id) => (await new Promise((r) => setTimeout(r, 30)), load(id));
		history.replaceState(null, '', '/?cloud=c1');
		const page = editorPage(null, { server: s.server, draftStore: drafts.store });
		render(Page, page.props);
		await new Promise((r) => setTimeout(r, 60));
		for (let i = 0; i < 10; i++) await flush();
		expect(page.editor.file.cloudId).toBe('c1');
		expect(page.session.flow?.name).not.toBe('全國賽');
	});
});

describe('app.html：程式跑起來之前先藏起畫面', () => {
	const run = (boot: object | undefined, path = '/') => {
		window.__cheerShell = boot && ({ boot } as never);
		history.replaceState(null, '', path);
		new Function(hideScript!)();
		return 'reopening' in document.documentElement.dataset;
	};

	it('殼記著上次那支、在首頁：藏', () => {
		expect(run({ settings: { 'cheer-editor:lastFlow': 'n1' } })).toBe(true);
	});

	it('網頁版、上次停在首頁、殼太舊沒塞小設定、在使用說明：不藏', () => {
		expect(run(undefined)).toBe(false);
		expect(run({ settings: {} })).toBe(false);
		expect(run({ features: [] })).toBe(false);
		expect(run({ settings: { 'cheer-editor:lastFlow': 'n1' } }, '/guide')).toBe(false);
		history.replaceState(null, '', '/');
	});
});
