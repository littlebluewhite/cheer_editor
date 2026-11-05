// 頁面：打開時問要不要救回草稿（救回、丟掉的按鈕），欄位裡打了字還沒送出時關分頁先問。
// 草稿的規則（停手 1 秒存、存檔後清掉、兩個分頁…）在 src/lib/flow-file.test.ts。IndexedDB 換成記憶體裡的假草稿庫。
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { writeFlowFile } from '#lib/core';
import type { DraftStore } from '#lib/file/draft.js';
import { audioFlow, editorPage, fakeDraftStore, flush } from '#lib/test-fakes.js';
import { hasUnsavedChanges } from '#lib/unsaved.js';
import Page from './+page.svelte';

function setup(draftStore: DraftStore) {
	return render(Page, editorPage(null, { draftStore }).props);
}

async function newFlow() {
	await fireEvent.input(screen.getByLabelText('流程名字'), { target: { value: '全國賽' } });
	await fireEvent.click(screen.getByRole('button', { name: '建立' }));
}

/** 關掉分頁、重新整理：瀏覽器有沒有先問。 */
function leaveAsks() {
	const e = new Event('beforeunload', { cancelable: true });
	window.dispatchEvent(e);
	return e.defaultPrevented;
}

describe('打開時救回草稿', () => {
	it('有草稿就問；按「救回」打開草稿，還算未存', async () => {
		const { store } = fakeDraftStore(writeFlowFile(audioFlow(), { a1: new Uint8Array([1]) }), new Date(2026, 10, 5, 14, 3));
		setup(store);
		await flush();
		expect(screen.getByRole('alertdialog').textContent).toContain('上次編的「練習用」還沒存，要救回嗎？（11/5 14:03 存的草稿）');
		await fireEvent.click(screen.getByRole('button', { name: '救回' }));
		await flush();
		expect(screen.getByText('練習用')).toBeTruthy();
		expect(screen.getByText('未存')).toBeTruthy();
	});

	it('按「丟掉」：草稿刪掉，回到新建流程', async () => {
		const drafts = fakeDraftStore(writeFlowFile(audioFlow(), {}));
		setup(drafts.store);
		await flush();
		await fireEvent.click(screen.getByRole('button', { name: '丟掉' }));
		await vi.waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
		expect(screen.getByLabelText('流程名字')).toBeTruthy();
		expect(drafts.latest()).toBeNull();
	});
});

describe('關分頁、重新整理', () => {
	it('欄位裡打了字還沒送出：關分頁、重新整理前瀏覽器先問', async () => {
		setup(fakeDraftStore().store);
		await flush();
		await newFlow();
		expect(leaveAsks()).toBe(false);
		const name = screen.getByLabelText(/^名字/);
		name.focus();
		await fireEvent.input(name, { target: { value: '小A' } });
		expect(leaveAsks()).toBe(true);
		expect(hasUnsavedChanges()).toBe(true);
	});
});
