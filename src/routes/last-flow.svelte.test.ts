// 頁面：打開 App 回上次那支（#378）。規則（記、開、不見了）在 src/lib/last-flow.svelte.test.ts；這裡測畫面不先閃一下首頁。
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { createFlow, writeFlowFile } from '#lib/core';
import { editorPage, fakeDraftStore, fakeHost, fakeSettings, fakeShell, flush } from '#lib/test-fakes.js';
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
		fakeHost({ shell: fakeShell(), settings: fakeSettings({ 'cheer-editor:lastFlow': 'n1' }).settings });
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
		fakeHost({ shell: fakeShell(), settings: fakeSettings({ 'cheer-editor:lastFlow': 'n1' }).settings });
		document.documentElement.dataset.reopening = '';
		render(Page, editorPage(null).props);
		await flush();
		await flush();
		expect(screen.getByLabelText('流程名字')).toBeTruthy();
		expect('reopening' in document.documentElement.dataset).toBe(false);
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
