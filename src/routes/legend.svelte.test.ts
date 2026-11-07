// 頁面：場地左下的圖例可以收起來，收起來的狀態存在這台電腦（#214）。
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { editorPage, teamFlow } from '#lib/test-fakes.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

afterEach(() => {
	cleanup();
	localStorage.clear();
});

const toggle = () => screen.getByRole('button', { name: '圖例' });
/** 圖例本身（底層、上層、很喘、走太快、撞位）。 */
const legend = () => document.getElementById(toggle().getAttribute('aria-controls')!)!;

describe('場地左下的圖例', () => {
	it('預設打開：底層、上層、很喘、走太快、撞位都看得到', () => {
		render(Page, editorPage(teamFlow()).props);
		expect(toggle().getAttribute('aria-expanded')).toBe('true');
		expect(legend().hidden).toBe(false);
		for (const word of ['底層', '上層', '很喘', '走太快', '撞位']) expect(legend().textContent).toContain(word);
	});

	it('按「圖例」收起來，再按打開；收起來時「只看橘紅走位線」還在', async () => {
		render(Page, editorPage(teamFlow()).props);
		await fireEvent.click(toggle());
		expect(toggle().getAttribute('aria-expanded')).toBe('false');
		expect(legend().hidden).toBe(true);
		expect(screen.getByRole('checkbox', { name: '只看橘紅走位線' })).toBeTruthy();
		await fireEvent.click(toggle());
		expect(legend().hidden).toBe(false);
	});

	it('收起來的狀態存在這台電腦：重開頁面還是收著', async () => {
		render(Page, editorPage(teamFlow()).props);
		await fireEvent.click(toggle());
		cleanup();
		render(Page, editorPage(teamFlow()).props);
		expect(toggle().getAttribute('aria-expanded')).toBe('false');
		expect(legend().hidden).toBe(true);
	});
});
