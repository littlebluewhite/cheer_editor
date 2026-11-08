// 頁面：場地左下的圖例可以收起來，收起來的狀態存在這台電腦（#214）。
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { editorPage, teamFlow } from '#lib/test-fakes.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

afterEach(() => {
	cleanup();
	localStorage.clear();
	vi.unstubAllGlobals();
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

	it('撞位寫明只看騰翻，滑鼠移上去有完整說明（T14）', () => {
		render(Page, editorPage(teamFlow()).props);
		const clash = [...legend().querySelectorAll('span')].find((s) => s.textContent?.includes('撞位'))!;
		expect(clash.textContent).toBe('✕撞位（只看騰翻）');
		expect(clash.title).toBe('至少一人正在騰翻中走位，跟別人靠得不到半格；一般走位靠很近不算');
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

describe('觸控又矮的螢幕（橫拿的 iPad 1180×820）：左欄放不下，圖例預設收起來（N58）', () => {
	/** 觸控螢幕、畫面高 h。 */
	function touchScreen(h: number) {
		vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(pointer: coarse)' }));
		vi.stubGlobal('innerHeight', h);
	}

	it('沒動過圖例：預設收著，「圖例」按了打開', async () => {
		touchScreen(820);
		render(Page, editorPage(teamFlow()).props);
		expect(toggle().getAttribute('aria-expanded')).toBe('false');
		expect(legend().hidden).toBe(true);
		await fireEvent.click(toggle());
		expect(legend().hidden).toBe(false);
	});

	it('自己打開過：記住，重開頁面還是開著', async () => {
		touchScreen(820);
		render(Page, editorPage(teamFlow()).props);
		await fireEvent.click(toggle());
		cleanup();
		render(Page, editorPage(teamFlow()).props);
		expect(toggle().getAttribute('aria-expanded')).toBe('true');
	});

	it('觸控但夠高（1366×1024 橫拿的大 iPad）、或滑鼠的矮螢幕：照舊打開', () => {
		touchScreen(1024);
		render(Page, editorPage(teamFlow()).props);
		expect(toggle().getAttribute('aria-expanded')).toBe('true');
		cleanup();
		vi.unstubAllGlobals();
		vi.stubGlobal('innerHeight', 768);
		render(Page, editorPage(teamFlow()).props);
		expect(toggle().getAttribute('aria-expanded')).toBe('true');
	});
});
