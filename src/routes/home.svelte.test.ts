// 首頁和換流程（#218）：手機首頁只放開啟、看得出只能看；最近的流程同名的分得出來、「另一個分頁正在編」即時更新、丟掉有回饋；
// 新建和開檔以後一律回到「編排・編輯」。
import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFlow, writeFlowFile } from '#lib/core';
import type { DraftStore } from '#lib/file/draft.js';
import { NARROW_SCREEN } from '#lib/editor-layout.js';
import type { OpenTabChannel } from '#lib/tab-channel.js';
import { audioFlow, editorPage, fakeDraftStore, fakeTabs, flush, openFile, testEditor } from '#lib/test-fakes.js';
import { flowOf, libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

Element.prototype.scrollIntoView = () => {};

afterEach(() => vi.unstubAllGlobals());

const newFlowOf = (name: string) => flowOf(createFlow({ name, field: { strips: 9, layout: 'vertical' } }));

function home(draftStore: DraftStore, openTabChannel: OpenTabChannel | null = null) {
	return render(Page, editorPage(null, { draftStore, openTabChannel }).props);
}

/** 首頁「最近的流程」裡那支流程的按鈕（點了打開它）。 */
const recent = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) });

describe('手機首頁', () => {
	it('窄螢幕首頁沒有新建：只有「開啟流程檔」，寫著手機只能看', async () => {
		vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === NARROW_SCREEN }));
		home(fakeDraftStore().store);
		await flush();
		expect(screen.queryByLabelText('流程名字')).toBeNull();
		expect(screen.queryByRole('button', { name: '建立' })).toBeNull();
		expect(screen.getByLabelText('開啟流程檔')).toBeTruthy();
		expect(screen.getByText(/檢視模式/).textContent).toContain('只能看');
	});

	it('手機首頁說草稿存在哪裡：不寫「這台電腦」（N37）', async () => {
		vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === NARROW_SCREEN }));
		const drafts = fakeDraftStore();
		drafts.all.set('n1', { bytes: writeFlowFile(newFlowOf('全國賽'), {}), savedAt: new Date(2026, 10, 4, 9, 0) });
		home(drafts.store);
		await flush();
		const note = screen.getByText(/草稿只存在/).textContent!;
		expect(note).not.toContain('電腦');
	});
});

describe('新建和開檔以後回到編排・編輯', () => {
	const editPressed = () => screen.getByRole('button', { name: '編輯' }).getAttribute('aria-pressed');
	const arrangePressed = () => screen.getByRole('button', { name: '編排' }).getAttribute('aria-pressed');

	it('檢視模式時按「新建」建一支新的：回到編輯', async () => {
		const { session, props } = editorPage(libSample());
		render(Page, props);
		await fireEvent.click(screen.getByRole('button', { name: '檢視' }));
		expect(session.viewing).toBe(true);
		await fireEvent.click(screen.getByRole('button', { name: '新建' }));
		await fireEvent.input(screen.getByLabelText('流程名字'), { target: { value: '全國賽' } });
		await fireEvent.click(screen.getByRole('button', { name: '建立' }));
		await flush();
		expect(session.viewing).toBe(false);
		expect(editPressed()).toBe('true');
	});

	it('檢視模式時從上方列開檔：回到編輯', async () => {
		const { session, props } = editorPage(libSample());
		render(Page, props);
		await fireEvent.click(screen.getByRole('button', { name: '檢視' }));
		await openFile(writeFlowFile(audioFlow(), {}), '開啟');
		expect(session.flow!.name).toBe('練習用');
		expect(session.viewing).toBe(false);
		expect(editPressed()).toBe('true');
	});

	it('在練習分頁時從上方列開檔：回到編排', async () => {
		const { props } = editorPage(libSample());
		render(Page, props);
		await fireEvent.click(screen.getByRole('button', { name: '練習' }));
		expect(arrangePressed()).toBe('false');
		await openFile(writeFlowFile(audioFlow(), {}), '開啟');
		expect(arrangePressed()).toBe('true');
		expect(editPressed()).toBe('true');
	});
});

describe('首頁：最近的流程', () => {
	it('同名兩支：寫最後改的時間分得出來，「丟掉」也分得出是哪一支', async () => {
		const drafts = fakeDraftStore();
		drafts.all.set('n1', { bytes: writeFlowFile(newFlowOf('全國賽'), {}), savedAt: new Date(2026, 10, 4, 9, 0) });
		drafts.all.set('n2', { bytes: writeFlowFile(newFlowOf('全國賽'), {}), savedAt: new Date(2026, 10, 5, 14, 3) });
		home(drafts.store);
		await flush();
		const names = screen.getAllByRole('button', { name: /^全國賽/ }).map((b) => b.textContent);
		expect(names).toEqual([expect.stringContaining('最後改 11/5 14:03'), expect.stringContaining('最後改 11/4 09:00')]);
		await fireEvent.click(screen.getByRole('button', { name: '丟掉「全國賽」（最後改 11/4 09:00）' }));
		await fireEvent.click(screen.getByRole('button', { name: '丟掉' }));
		await vi.waitFor(() => expect(drafts.all.has('n1')).toBe(false));
		expect(drafts.all.has('n2')).toBe(true);
	});

	it('同名、同一分鐘改的兩支：時間寫到秒分得出來，「丟掉」的確認框也寫是哪一支，不只寫名字（N40）', async () => {
		const drafts = fakeDraftStore();
		drafts.all.set('n1', { bytes: writeFlowFile(newFlowOf('全國賽'), {}), savedAt: new Date(2026, 10, 4, 9, 0, 5) });
		drafts.all.set('n2', { bytes: writeFlowFile(newFlowOf('全國賽'), {}), savedAt: new Date(2026, 10, 4, 9, 0, 40) });
		home(drafts.store);
		await flush();
		const names = screen.getAllByRole('button', { name: /^全國賽/ }).map((b) => b.textContent);
		expect(names).toEqual([expect.stringContaining('最後改 11/4 09:00:40'), expect.stringContaining('最後改 11/4 09:00:05')]);
		await fireEvent.click(screen.getByRole('button', { name: '丟掉「全國賽」（最後改 11/4 09:00:05）' }));
		expect(screen.getByRole('alertdialog').textContent).toContain('丟掉「全國賽」（最後改 11/4 09:00:05）的草稿？');
	});

	it('另一個分頁打開、離開一支流程：首頁的「另一個分頁正在編」跟著出現、消失，不用重新整理', async () => {
		const drafts = fakeDraftStore();
		const tabs = fakeTabs();
		const other = testEditor(null, { draftStore: drafts.store, openTabChannel: tabs });
		other.editor.file.connect();
		await flush();
		other.editor.file.create(newFlowOf('全國賽'));
		await flush();
		await other.editor.file.leaveToHome();
		home(drafts.store, tabs);
		await flush();
		await new Promise((r) => setTimeout(r, 350));
		expect(recent('全國賽').textContent).not.toContain('另一個分頁正在編');

		const [id] = drafts.all.keys();
		await other.editor.file.openRecent(id);
		await vi.waitFor(() => expect(recent('全國賽').textContent).toContain('另一個分頁正在編'));
		// 那個分頁換去編別支：不再標
		other.editor.file.create(newFlowOf('縣賽'));
		await vi.waitFor(() => expect(recent('全國賽').textContent).not.toContain('另一個分頁正在編'));
	});

	it('另一個分頁關掉：「另一個分頁正在編」當下就拿掉', async () => {
		const drafts = fakeDraftStore();
		const tabs = fakeTabs();
		const other = testEditor(null, { draftStore: drafts.store, openTabChannel: tabs });
		const closeOther = other.editor.file.connect();
		await flush();
		other.editor.file.create(newFlowOf('全國賽'));
		await flush();
		home(drafts.store, tabs);
		await vi.waitFor(() => expect(recent('全國賽').textContent).toContain('另一個分頁正在編'));
		closeOther();
		await flush();
		expect(recent('全國賽').textContent).not.toContain('另一個分頁正在編');
	});

	it('丟掉一支：寫「已丟掉」；另一個分頁正在編的丟不掉，說為什麼', async () => {
		const drafts = fakeDraftStore(writeFlowFile(audioFlow(), {}));
		const tabs = fakeTabs();
		const other = testEditor(null, { draftStore: drafts.store, openTabChannel: tabs });
		other.editor.file.connect();
		await flush();
		other.editor.file.create(newFlowOf('全國賽'));
		await flush();
		home(drafts.store, tabs);
		await flush();

		await fireEvent.click(screen.getByRole('button', { name: '丟掉「練習用」' }));
		await fireEvent.click(screen.getByRole('button', { name: '丟掉' }));
		await vi.waitFor(() => expect(screen.getByRole('status').textContent).toContain('已丟掉「練習用」'));

		await fireEvent.click(screen.getByRole('button', { name: '丟掉「全國賽」' }));
		await fireEvent.click(screen.getByRole('button', { name: '丟掉' }));
		await vi.waitFor(() => expect(screen.getByRole('status').textContent).toContain('另一個分頁正在編「全國賽」，沒有丟掉'));
		expect(recent('全國賽')).toBeTruthy();
	});
});
