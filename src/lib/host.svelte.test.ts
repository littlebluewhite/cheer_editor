// 網頁跑在哪裡（#373）：小設定、網站網址、「問殼」、離線存放四樣都換得掉；網頁版照舊（瀏覽器的儲存、頁面自己的網址、不在 App 裡、IndexedDB）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { browserHost, host } from '#lib/host.js';
import { loadFlowSetting, loadLatencyMs, loadLayoutPx, loadLegendOpen, loadReturnOnStop, saveFlowSetting, saveLayoutPx, saveLegendOpen } from '#lib/local-settings.js';
import { shareUrl } from '#lib/share-link.js';
import { httpServer } from '#lib/server-api.js';
import { browserAdapters } from '#lib/editor.svelte.js';
import { fakeHost, fakeOfflineStore, fakeServer, fakeSettings, fakeShell, flush } from '#lib/test-fakes.js';
import Login from '../routes/login/+page.svelte';

afterEach(() => {
	localStorage.clear();
	vi.unstubAllGlobals();
});

describe('網頁版', () => {
	it('不在 App 裡，殼什麼都不會', () => {
		expect(host().shell.inApp).toBe(false);
		expect(host().shell.can('print')).toBe(false);
	});

	it('網站網址是頁面自己的網址', () => {
		expect(host().siteUrl()).toBe(location.href);
	});

	it('小設定存在瀏覽器裡', () => {
		saveFlowSetting('me', '區賽', 'p1');
		expect(localStorage.getItem('cheer-editor:me:區賽')).toBe('p1');
	});
});

describe('換成假的', () => {
	it('小設定：讀寫都走假的，不碰瀏覽器的儲存', () => {
		const { settings, saved } = fakeSettings({ 'cheer-editor:latencyMs': '120', 'cheer-editor:returnOnStop': '0' });
		fakeHost({ settings });
		expect(loadLatencyMs()).toBe(120);
		expect(loadReturnOnStop()).toBe(false);
		saveLegendOpen(false);
		expect(loadLegendOpen()).toBe(false);
		saveFlowSetting('print', '區賽', 'role:top');
		expect(loadFlowSetting('print', '區賽')).toBe('role:top');
		saveLayoutPx('timelineHeightPx', 300);
		saveLayoutPx('timelineHeightPx', null);
		expect(loadLayoutPx('timelineHeightPx')).toBeNull();
		expect(Object.fromEntries(saved)).toEqual({
			'cheer-editor:latencyMs': '120',
			'cheer-editor:returnOnStop': '0',
			'cheer-editor:legendOpen': '0',
			'cheer-editor:print:區賽': 'role:top'
		});
		expect(Object.keys(localStorage).filter((k) => k.startsWith('cheer-editor:'))).toEqual([]);
	});

	it('網站網址：分享連結跟著變', () => {
		fakeHost({ siteUrl: () => 'https://cheer.example/' });
		expect(shareUrl('abc')).toBe('https://cheer.example/#share=abc');
	});

	it('網站網址：雲端流程的連線跟著變（https 用 wss）', () => {
		fakeHost({ siteUrl: () => 'https://cheer.example/' });
		const urls: string[] = [];
		class Socket {
			static OPEN = 1;
			constructor(url: string | URL) {
				urls.push(String(url));
			}
			close() {}
		}
		vi.stubGlobal('WebSocket', Socket);
		httpServer().openRoom('c1').close();
		expect(urls).toEqual(['wss://cheer.example/api/flows/c1/room']);
	});

	it('問殼：答在 App 裡、會的那幾件', () => {
		fakeHost({ shell: fakeShell(['print']) });
		expect(host().shell.inApp).toBe(true);
		expect(host().shell.can('print')).toBe(true);
		expect(host().shell.can('video')).toBe(false);
	});

	it('App 只有一個視窗：不開分頁頻道（打開流程不用等別的分頁回答，#378 回上次那支要快）；網頁版照開', () => {
		expect(browserAdapters().openTabChannel).not.toBeNull();
		fakeHost({ shell: fakeShell() });
		expect(browserAdapters().openTabChannel).toBeNull();
	});

	it('離線存放：編輯器、登入頁沒給的時候都用換上的', async () => {
		const row = { id: 'tabc123def456', date: '2026-11-07', action: '技巧·Lib', who: '第 1 組 小美', marks: '✓··', runThrough: false };
		const record = { actionId: 'x1', attempt: { id: 'tabc123def456', date: '2026-11-07', who: 'g1', practice: 'drill' as const, whole: true, marks: { p1: '✓' as const } } };
		const offline = fakeOfflineStore({ unsent: [{ flowId: 'c1', flowName: '區賽', records: [{ record, row }], amends: [], dropped: [] }] }).store;
		fakeHost({ createOfflineStore: () => offline });
		expect(browserAdapters().offline).toBe(offline);
		history.replaceState(null, '', '/login');
		const fake = fakeServer();
		fake.state.expired = true;
		render(Login, { server: fake.server, go: () => {} });
		await flush();
		expect(screen.getByRole('status').textContent!.trim()).toBe('登入超過 30 天了，請再登入一次。這台還有 1 筆成功率紀錄沒傳，登入後會自動傳。');
	});
});

describe('換了會換回網頁版', () => {
	it('一個測試換兩次', () => {
		fakeHost({ shell: fakeShell() });
		fakeHost({ siteUrl: () => 'https://cheer.example/' });
		expect(host().shell.inApp).toBe(true);
	});

	it('下一個測試又是網頁版', () => {
		expect(host()).toBe(browserHost);
	});
});

describe('在 beforeEach 換', () => {
	beforeEach(() => fakeHost({ shell: fakeShell() }));

	it('換得上', () => {
		expect(host().shell.inApp).toBe(true);
	});
});

describe('beforeEach 換的也會換回來', () => {
	it('網頁版', () => {
		expect(host()).toBe(browserHost);
	});
});
