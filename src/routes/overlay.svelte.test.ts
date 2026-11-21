// 蓋住編輯畫面的東西（#lib/overlay.svelte.ts）：對話框、找書籤的框、小窗蓋著時，編輯頁的快捷鍵（Delete、數字鍵…）不動；
// ⌘S／Ctrl+S 照樣存檔；Esc 一次關一層；不擋畫面的那種（找書籤的框）焦點跑到外面就關。
// 2193686、b9d36fc 修過的四種按鍵情況（找書籤的框裡按 Delete、⌘S、Shift+Tab 跳出去、收起來的小窗開著時按 /）都在這裡。
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addBookmark } from '#lib/core';
import { editorPage, flush, fromMenu } from '#lib/test-fakes.js';
import { flowOf, libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

/** 範例流程加一個書籤「翻騰」（第一個八拍），選著動作 x1。 */
function setup() {
	const page = editorPage(flowOf(addBookmark(libSample(), '翻騰', { segmentId: 's1', at: 0 }, { segmentId: 's1', at: 16 })));
	render(Page, page.props);
	page.session.selectAction('x1');
	return page;
}

const box = () => screen.queryByRole('dialog', { name: '找書籤' });
const searchInput = () => screen.getByRole('textbox', { name: '找書籤' });
const result = (name: string) => within(box()!).getByRole('button', { name: new RegExp(name) });
const settings = () => screen.queryByRole('dialog', { name: '流程設定' });

/** 上方列收成一顆鈕（1441 寬以下）。 */
function narrowBar() {
	vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
}

describe('蓋著時編輯頁的快捷鍵不動', () => {
	it('找書籤的框裡、焦點在書籤上按 Delete：不刪選著的動作', async () => {
		const { session } = setup();
		await fireEvent.keyDown(window, { key: '/' });
		result('翻騰').focus();
		await fireEvent.keyDown(result('翻騰'), { key: 'Delete' });
		expect(session.flow!.actions).toHaveLength(1);
	});

	it('找書籤的框開著、焦點不在框裡（點了沒給焦點）按 Delete：照樣不刪', async () => {
		const { session } = setup();
		await fireEvent.keyDown(window, { key: '/' });
		(document.activeElement as HTMLElement).blur();
		await fireEvent.keyDown(document.body, { key: 'Delete' });
		expect(session.flow!.actions).toHaveLength(1);
		expect(box()).toBeTruthy();
	});

	it('找書籤的輸入框裡按 ⌘Z：交給瀏覽器退字，不退流程', async () => {
		const { session } = setup();
		session.ask.send({ name: 'renameFlow', args: ['改過'] });
		await fireEvent.keyDown(window, { key: '/' });
		await fireEvent.keyDown(searchInput(), { key: 'z', metaKey: true });
		expect(session.flow!.name).toBe('改過');
	});

	it('流程設定開著時按 Delete、數字鍵：不刪動作、不分組', async () => {
		const { session } = setup();
		await fromMenu('流程設定');
		const before = session.flow;
		await fireEvent.keyDown(settings()!, { key: 'Delete' });
		await fireEvent.keyDown(settings()!, { key: '1' });
		expect(session.flow).toBe(before);
	});
});

describe('框裡的欄位照樣收自己的鍵', () => {
	it('找書籤的輸入框按 ↓ 選第二個、Enter 跳過去：框關掉，播放頭到那個書籤', async () => {
		const page = editorPage(
			flowOf(addBookmark(flowOf(addBookmark(libSample(), '翻騰', { segmentId: 's1', at: 0 }, { segmentId: 's1', at: 16 })), '後面', { segmentId: 's1', at: 24 }, null))
		);
		render(Page, page.props);
		await fireEvent.keyDown(window, { key: '/' });
		await fireEvent.keyDown(searchInput(), { key: 'ArrowDown' });
		await fireEvent.keyDown(searchInput(), { key: 'Enter' });
		expect(box()).toBeNull();
		expect(page.editor.playback.repeat).toBe(false);
		expect(page.editor.playback.sec).toBeGreaterThan(0);
	});
});

describe('⌘S／Ctrl+S 一定存檔', () => {
	it('找書籤的輸入框裡按 Ctrl+S、流程設定開著時按 ⌘S：都存檔', async () => {
		const { saves } = setup();
		await fireEvent.keyDown(window, { key: '/' });
		await fireEvent.keyDown(searchInput(), { key: 's', ctrlKey: true });
		await flush();
		expect(saves).toHaveLength(1);
		await fireEvent.keyDown(searchInput(), { key: 'Escape' });
		await fromMenu('流程設定');
		await fireEvent.keyDown(settings()!, { key: 's', metaKey: true });
		await flush();
		expect(saves).toHaveLength(2);
	});
});

describe('焦點離開就關（找書籤的框）', () => {
	it('Shift+Tab 跳到框外：框關掉；點東西時焦點沒去哪（Safari）：框還開著', async () => {
		setup();
		await fireEvent.keyDown(window, { key: '/' });
		await fireEvent.focusOut(searchInput(), { relatedTarget: null });
		expect(box()).toBeTruthy();
		await fireEvent.focusOut(searchInput(), { relatedTarget: screen.getByRole('button', { name: /存成書籤/ }) });
		expect(box()).toBeNull();
	});
});

describe('Esc 一次關一層', () => {
	it('找書籤的框裡、焦點在書籤上按 Esc：只關框，選著的動作還選著；再按一次才清選取', async () => {
		const { session } = setup();
		await fireEvent.keyDown(window, { key: '/' });
		result('翻騰').focus();
		await fireEvent.keyDown(result('翻騰'), { key: 'Escape' });
		expect(box()).toBeNull();
		expect(session.selectedActionId).toBe('x1');
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(session.selectedActionId).toBeNull();
	});

	it('收起來的書籤小窗開著時按 /：小窗先收（它在最上層會蓋住框），Esc 關的是框', async () => {
		narrowBar();
		const { session } = setup();
		await fireEvent.click(screen.getByRole('button', { name: '書籤' }));
		expect(screen.getByRole('group', { name: '書籤' })).toBeTruthy();
		await fireEvent.keyDown(window, { key: '/' });
		expect(screen.queryByRole('group', { name: '書籤' })).toBeNull();
		await fireEvent.keyDown(searchInput(), { key: 'Escape' });
		expect(box()).toBeNull();
		expect(session.selectedActionId).toBe('x1');
	});

	it('收起來的書籤小窗開著時按 Esc：只收小窗，選著的動作還選著', async () => {
		narrowBar();
		const { session } = setup();
		await fireEvent.click(screen.getByRole('button', { name: '書籤' }));
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(screen.queryByRole('group', { name: '書籤' })).toBeNull();
		expect(session.selectedActionId).toBe('x1');
	});

	it('流程設定開著時按 Esc：只關對話框，選著的動作還選著', async () => {
		const { session } = setup();
		await fromMenu('流程設定');
		await fireEvent.keyDown(settings()!, { key: 'Escape' });
		expect(settings()).toBeNull();
		expect(session.selectedActionId).toBe('x1');
	});
});
