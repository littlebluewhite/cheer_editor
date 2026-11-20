// 編輯頁上的書籤（GLOSSARY「書籤」）：書籤自己的鍵不漏到編輯頁的快捷鍵，存檔的鍵照樣能用；換一支流程時打到一半的名字不帶過去。
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addBookmark, writeFlowFile } from '#lib/core';
import { editorPage, flush, openFile } from '#lib/test-fakes.js';
import { flowOf, libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

afterEach(cleanup);

/** 範例流程加一個書籤「翻騰」（第一個八拍）。 */
function withBookmark() {
	return flowOf(addBookmark(libSample(), '翻騰', { segmentId: 's1', at: 0 }, { segmentId: 's1', at: 16 }));
}

function setup() {
	const page = editorPage(withBookmark());
	render(Page, page.props);
	return page;
}

/** 找書籤框裡的那一列。 */
const searchResult = (name: string) => within(screen.getByRole('dialog', { name: '找書籤' })).getByRole('button', { name: new RegExp(name) });

describe('編輯頁上的書籤', () => {
	it('找書籤的框裡按 Delete：不刪到選著的動作', async () => {
		const { session } = setup();
		session.selectAction('x1');
		await fireEvent.keyDown(window, { key: '/' });
		const result = searchResult('翻騰');
		result.focus();
		await fireEvent.keyDown(result, { key: 'Delete' });
		expect(session.flow!.actions).toHaveLength(1);
	});

	it('找書籤的框裡、焦點在書籤上按 Esc：框關掉，選著的動作還選著', async () => {
		const { session } = setup();
		session.selectAction('x1');
		await fireEvent.keyDown(window, { key: '/' });
		const result = searchResult('翻騰');
		result.focus();
		await fireEvent.keyDown(result, { key: 'Escape' });
		expect(screen.queryByRole('dialog', { name: '找書籤' })).toBeNull();
		expect(session.selectedActionId).toBe('x1');
	});

	it('找書籤的框裡按 Shift+Tab 跳到框外：框關掉（不會框還開著、鍵卻給了編輯頁）', async () => {
		setup();
		await fireEvent.keyDown(window, { key: '/' });
		const outside = screen.getByRole('button', { name: /存成書籤/ });
		await fireEvent.focusOut(screen.getByRole('textbox', { name: '找書籤' }), { relatedTarget: outside });
		expect(screen.queryByRole('dialog', { name: '找書籤' })).toBeNull();
	});

	it('上方列收成一顆鈕、小窗開著時按 /：小窗收起來，Esc 關的是找書籤的框', async () => {
		vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
		try {
			setup();
			await fireEvent.click(screen.getByRole('button', { name: '書籤' }));
			await fireEvent.keyDown(window, { key: '/' });
			expect(screen.queryByRole('group', { name: '書籤' })).toBeNull();
			await fireEvent.keyDown(screen.getByRole('textbox', { name: '找書籤' }), { key: 'Escape' });
			expect(screen.queryByRole('dialog', { name: '找書籤' })).toBeNull();
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('打書籤名字、找書籤時按 ⌘S：照樣存檔', async () => {
		const { saves } = setup();
		await fireEvent.click(screen.getByRole('button', { name: /存成書籤/ }));
		await fireEvent.keyDown(screen.getByRole('textbox', { name: '書籤名字' }), { key: 's', metaKey: true });
		await flush();
		expect(saves).toHaveLength(1);
		await fireEvent.keyDown(screen.getByRole('textbox', { name: '書籤名字' }), { key: 'Escape' });
		await fireEvent.keyDown(window, { key: '/' });
		await fireEvent.keyDown(screen.getByRole('textbox', { name: '找書籤' }), { key: 's', ctrlKey: true });
		await flush();
		expect(saves).toHaveLength(2);
	});

	it('書籤名字打到一半開另一支流程：打的名字不帶到新的流程', async () => {
		setup();
		await fireEvent.click(screen.getByRole('button', { name: /存成書籤/ }));
		await fireEvent.input(screen.getByRole('textbox', { name: '書籤名字' }), { target: { value: '草稿' } });
		await openFile(writeFlowFile(libSample(), {}));
		expect(screen.queryByRole('textbox', { name: '書籤名字' })).toBeNull();
	});
});
