// +layout.svelte 接手 app.html 的語言小程式：顯示畫面（ADR 0017）。App 裡停在別頁時交來流程檔：回編輯器（#384）。
import { cleanup, render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { goto } from '$app/navigation';
import { getLocale } from '#lib/paraglide/runtime.js';
import type { Shell } from '#lib/host.js';
import { fakeHost } from '#lib/test-fakes.js';
import Layout from './+layout.svelte';

const at = vi.hoisted(() => ({ route: '/' as string | null }));
vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}) }));
vi.mock('$app/state', () => ({
	page: {
		get route() {
			return { id: at.route };
		}
	}
}));

const children = createRawSnippet(() => ({ render: () => '<p>內容</p>' }));

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('+layout 接手語言', () => {
	it('跑起來就顯示畫面（拿掉 app.html 藏畫面的標記）', () => {
		document.documentElement.dataset.localePending = '';
		render(Layout, { children });
		expect('localePending' in document.documentElement.dataset).toBe(false);
	});

	// 測試的 setup（src/svelte-warnings.setup.ts）：有的測試會清掉 localStorage，畫面也不能變英文
	it('測試裡清掉 localStorage 還是中文', () => {
		localStorage.clear();
		expect(getLocale()).toBe('zh-TW');
	});
});

describe('App 裡停在別頁時交來流程檔（#384）', () => {
	/** 殼：say() 是說 fileOpened。 */
	function fileShell() {
		const listeners = new Set<(body: unknown) => void>();
		const shell: Shell = {
			inApp: true,
			can: (f) => f === 'openFile',
			send: async () => null,
			on(name, fn) {
				if (name !== 'fileOpened') return () => {};
				listeners.add(fn);
				return () => listeners.delete(fn);
			}
		};
		return { shell, say: () => listeners.forEach((l) => l(null)) };
	}

	it('在使用說明、帳號、登入頁：回編輯器（編輯器一開就拿那個檔打開）', () => {
		const { shell, say } = fileShell();
		fakeHost({ shell });
		at.route = '/guide';
		render(Layout, { children });
		say();
		expect(goto).toHaveBeenCalledWith('/');
	});

	it('已經在編輯器：不換頁（編輯器自己拿）', () => {
		vi.mocked(goto).mockClear();
		const { shell, say } = fileShell();
		fakeHost({ shell });
		at.route = '/';
		render(Layout, { children });
		say();
		expect(goto).not.toHaveBeenCalled();
	});
});
