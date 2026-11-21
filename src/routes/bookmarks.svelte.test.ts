// 編輯頁上的書籤（GLOSSARY「書籤」）：書籤自己的鍵不漏到編輯頁的快捷鍵，存檔的鍵照樣能用；換一支流程時打到一半的名字不帶過去。
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
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

describe('編輯頁上的書籤', () => {
	it('找書籤的框登記成蓋住編輯畫面的一層（按鍵規則在 overlay.svelte.test.ts）：開著時 Delete 不刪選著的動作，Esc 關框', async () => {
		const { session } = setup();
		session.selectAction('x1');
		await fireEvent.keyDown(window, { key: '/' });
		(document.activeElement as HTMLElement).blur();
		await fireEvent.keyDown(document.body, { key: 'Delete' });
		expect(session.flow!.actions).toHaveLength(1);
		await fireEvent.keyDown(document.body, { key: 'Escape' });
		expect(screen.queryByRole('dialog', { name: '找書籤' })).toBeNull();
		expect(session.selectedActionId).toBe('x1');
	});

	it('打書籤名字時按 ⌘S：照樣存檔（打字欄位吃自己的鍵，存檔的鍵除外）', async () => {
		const { saves } = setup();
		await fireEvent.click(screen.getByRole('button', { name: /存成書籤/ }));
		await fireEvent.keyDown(screen.getByRole('textbox', { name: '書籤名字' }), { key: 's', metaKey: true });
		await flush();
		expect(saves).toHaveLength(1);
	});

	it('書籤名字打到一半開另一支流程：打的名字不帶到新的流程', async () => {
		setup();
		await fireEvent.click(screen.getByRole('button', { name: /存成書籤/ }));
		await fireEvent.input(screen.getByRole('textbox', { name: '書籤名字' }), { target: { value: '草稿' } });
		await openFile(writeFlowFile(libSample(), {}));
		expect(screen.queryByRole('textbox', { name: '書籤名字' })).toBeNull();
	});
});
