// 第一次打開（ADR 0017）：+layout.svelte 問一次語言，Paraglide 就把瀏覽器語言存起來。
// 自己一個檔：Paraglide 只在一頁第一次問語言時存，同一個檔裡別的測試先問過就測不到。
import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { expect, it, vi } from 'vitest';
import { localStorageKey } from '#lib/paraglide/runtime.js';
import Layout from './+layout.svelte';

it('直接打開沒用到翻譯的頁：也把瀏覽器語言存起來，之後改瀏覽器語言不會跟著變', () => {
	localStorage.removeItem(localStorageKey);
	vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US']);
	render(Layout, { children: createRawSnippet(() => ({ render: () => '<p>內容</p>' })) });
	expect(localStorage.getItem(localStorageKey)).toBe('en');
});
