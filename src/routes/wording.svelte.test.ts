// 第 5 批（#231）：錯誤訊息和畫面上的文字。每一項的 T 編號是 UX 報告（2026-11-07）裡的編號。
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { editorPage, teamFlow } from '#lib/test-fakes.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

afterEach(cleanup);

describe('「重複」的提示（T08）', () => {
	it('寫到口號段沒有八拍時重複多長', () => {
		render(Page, editorPage(teamFlow()).props);
		const repeat = screen.getByRole('checkbox', { name: '重複' }).closest('label')!;
		expect(repeat.title).toBe('重複：有選動作就重複那個動作；沒選就重複目前的八拍（口號段是目前的 5 秒）');
	});
});
