// +layout.svelte 接手 app.html 的語言小程式：顯示畫面（ADR 0017）。
import { cleanup, render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLocale } from '#lib/paraglide/runtime.js';
import Layout from './+layout.svelte';

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
