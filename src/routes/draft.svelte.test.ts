// 頁面：草稿自動存、打開時問要不要救回。IndexedDB 換成記憶體裡的假草稿庫（真的要手動在四家瀏覽器檢查）。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFlowFile, writeFlowFile } from '#lib/core';
import { createFakeEngine } from '#lib/audio/fake-engine.js';
import type { DraftStore } from '#lib/file/draft.js';
import { audioFlow, fakeDecode, fakeDraftStore, fakeSaver, flush } from '#lib/test-fakes.js';
import { hasUnsavedChanges } from '#lib/unsaved.js';
import Page from './+page.svelte';

function setup(draftStore: DraftStore) {
	return render(Page, {
		createEngine: () => createFakeEngine(),
		createSaver: () => fakeSaver().saver,
		decode: fakeDecode,
		draftStore
	});
}

async function newFlow() {
	await fireEvent.input(screen.getByLabelText('流程名字'), { target: { value: '全國賽' } });
	await fireEvent.click(screen.getByRole('button', { name: '建立' }));
}

async function addChant() {
	await fireEvent.click(screen.getByRole('button', { name: '在最後加一段' }));
	await fireEvent.click(screen.getByRole('button', { name: '＋口號段' }));
}

/** 關掉分頁、重新整理：瀏覽器有沒有先問。 */
function leaveAsks() {
	const e = new Event('beforeunload', { cancelable: true });
	window.dispatchEvent(e);
	return e.defaultPrevented;
}

describe('打開時救回草稿', () => {
	afterEach(() => vi.useRealTimers());

	it('有草稿就問；按「救回」打開草稿（含動作、音樂），還算未存', async () => {
		const { store } = fakeDraftStore(writeFlowFile(audioFlow(), { a1: new Uint8Array([1]) }));
		setup(store);
		await flush();
		expect(screen.getByRole('alertdialog').textContent).toContain('練習用');
		await fireEvent.click(screen.getByRole('button', { name: '救回' }));
		await flush();
		expect(screen.getByText('練習用')).toBeTruthy();
		expect(document.querySelector('[data-lane="m1"] [data-action-id]')).toBeTruthy();
		expect(screen.getByRole('button', { name: /音樂 1/ }).textContent).not.toContain('找不到音樂');
		expect(screen.getByText('未存')).toBeTruthy();
		expect(hasUnsavedChanges()).toBe(true);
	});

	it('按「丟掉」：草稿刪掉，回到新建流程', async () => {
		const drafts = fakeDraftStore(writeFlowFile(audioFlow(), {}));
		setup(drafts.store);
		await flush();
		await fireEvent.click(screen.getByRole('button', { name: '丟掉' }));
		// 先問別的分頁有沒有在編輯它，等一下下
		await vi.waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
		expect(screen.getByLabelText('流程名字')).toBeTruthy();
		expect(drafts.state.bytes).toBeNull();
	});

	it('問的時候寫出草稿是什麼時候存的', async () => {
		const { store } = fakeDraftStore(writeFlowFile(audioFlow(), {}), new Date(2026, 10, 5, 14, 3));
		setup(store);
		await flush();
		expect(screen.getByRole('alertdialog').textContent).toContain('11/5 14:03 存的草稿');
	});

	it('另一個分頁正在編輯這份草稿：「丟掉」不刪，告訴我', async () => {
		const drafts = fakeDraftStore();
		vi.useFakeTimers();
		const editing = setup(drafts.store);
		await vi.advanceTimersByTimeAsync(0);
		await newFlow();
		await addChant();
		await vi.advanceTimersByTimeAsync(1000);
		const saved = drafts.state.bytes;
		expect(saved).not.toBeNull();
		vi.useRealTimers();
		const home = within(setup(drafts.store).container);
		await flush();
		await fireEvent.click(home.getByRole('button', { name: '丟掉' }));
		await vi.waitFor(() => expect(home.getByRole('alertdialog').textContent).toContain('另一個分頁正在編輯'));
		expect(drafts.state.bytes).toBe(saved);
		editing.unmount();
	});

	it('沒有草稿就不問', async () => {
		setup(fakeDraftStore().store);
		await flush();
		expect(screen.queryByRole('alertdialog')).toBeNull();
		expect(screen.getByLabelText('流程名字')).toBeTruthy();
	});
});

describe('編輯時自動存草稿', () => {
	afterEach(() => vi.useRealTimers());

	function draftFlow(bytes: Uint8Array | null) {
		const r = bytes && readFlowFile(bytes);
		if (!r || r.kind !== 'ok') throw new Error('沒有草稿');
		return r;
	}

	it('改了停 1 秒就存；連續改只存最後的樣子', async () => {
		const drafts = fakeDraftStore();
		setup(drafts.store);
		await flush();
		vi.useFakeTimers();
		await newFlow();
		await vi.advanceTimersByTimeAsync(500);
		expect(drafts.state.bytes).toBeNull();
		await addChant();
		await vi.advanceTimersByTimeAsync(500);
		expect(drafts.state.bytes).toBeNull();
		await vi.advanceTimersByTimeAsync(500);
		const r = draftFlow(drafts.state.bytes);
		expect(r.flow.name).toBe('全國賽');
		expect(r.flow.segments.map((s) => s.kind)).toEqual(['chant']);
	});

	it('草稿裡有音樂', async () => {
		const drafts = fakeDraftStore(writeFlowFile(audioFlow(), { a1: new Uint8Array([7, 7]) }));
		setup(drafts.store);
		await flush();
		await fireEvent.click(screen.getByRole('button', { name: '救回' }));
		await flush();
		vi.useFakeTimers();
		await addChant();
		await vi.advanceTimersByTimeAsync(1000);
		const r = draftFlow(drafts.state.bytes);
		expect(r.flow.segments.map((s) => s.kind)).toEqual(['music', 'chant']);
		expect(r.audio).toEqual({ a1: new Uint8Array([7, 7]) });
	});

	it('Ctrl+S 存成流程檔後草稿就丟掉；再改又存', async () => {
		const drafts = fakeDraftStore();
		setup(drafts.store);
		await flush();
		vi.useFakeTimers();
		await newFlow();
		await addChant();
		await vi.advanceTimersByTimeAsync(1000);
		expect(drafts.state.bytes).not.toBeNull();
		await fireEvent.keyDown(window, { key: 's', ctrlKey: true });
		await vi.advanceTimersByTimeAsync(1000);
		expect(drafts.state.bytes).toBeNull();
		await addChant();
		await vi.advanceTimersByTimeAsync(1000);
		expect(draftFlow(drafts.state.bytes).flow.segments).toHaveLength(2);
	});

	it('救回草稿時清空復原紀錄；復原後草稿照常存（存的是復原後的流程，音樂還在）', async () => {
		const drafts = fakeDraftStore(writeFlowFile(audioFlow(), { a1: new Uint8Array([7, 7]) }));
		setup(drafts.store);
		await flush();
		await fireEvent.click(screen.getByRole('button', { name: '救回' }));
		await flush();
		expect((screen.getByRole('button', { name: '復原' }) as HTMLButtonElement).disabled).toBe(true);
		vi.useFakeTimers();
		await addChant();
		await fireEvent.click(screen.getByRole('button', { name: '關閉' }));
		await vi.advanceTimersByTimeAsync(1000);
		expect(draftFlow(drafts.state.bytes).flow.segments).toHaveLength(2);
		await fireEvent.click(screen.getByRole('button', { name: '復原' }));
		await vi.advanceTimersByTimeAsync(1000);
		const r = draftFlow(drafts.state.bytes);
		expect(r.flow.segments.map((s) => s.kind)).toEqual(['music']);
		expect(r.audio).toEqual({ a1: new Uint8Array([7, 7]) });
	});

	it('剛建好、還沒改的流程也存草稿，重新整理救得回來', async () => {
		const drafts = fakeDraftStore();
		const first = setup(drafts.store);
		await flush();
		vi.useFakeTimers();
		await newFlow();
		await vi.advanceTimersByTimeAsync(1000);
		vi.useRealTimers();
		first.unmount();
		setup(drafts.store);
		await flush();
		await fireEvent.click(screen.getByRole('button', { name: '救回' }));
		await flush();
		expect(screen.getByText('全國賽')).toBeTruthy();
	});

	it('有改動時按新建、選「不存了，繼續」：草稿清掉', async () => {
		const drafts = fakeDraftStore();
		setup(drafts.store);
		await flush();
		vi.useFakeTimers();
		await newFlow();
		await addChant();
		await fireEvent.click(screen.getByRole('button', { name: '關閉' }));
		await vi.advanceTimersByTimeAsync(1000);
		expect(drafts.state.bytes).not.toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: '新建' }));
		await fireEvent.click(screen.getByRole('button', { name: '不存了，繼續' }));
		await vi.advanceTimersByTimeAsync(1000);
		expect(drafts.state.bytes).toBeNull();
	});

	it('欄位裡打了字還沒送出：關分頁、重新整理前瀏覽器先問', async () => {
		setup(fakeDraftStore().store);
		await flush();
		await newFlow();
		expect(leaveAsks()).toBe(false);
		const name = screen.getByLabelText(/^名字/);
		await fireEvent.input(name, { target: { value: '小A' } });
		expect(leaveAsks()).toBe(true);
		expect(hasUnsavedChanges()).toBe(true);
	});

	it('剛開的流程檔沒改過，不存草稿', async () => {
		const drafts = fakeDraftStore();
		setup(drafts.store);
		await flush();
		vi.useFakeTimers();
		const file = new File([writeFlowFile(audioFlow(), {}) as Uint8Array<ArrayBuffer>], '練習用.zip');
		await fireEvent.change(screen.getByLabelText('開啟流程檔'), { target: { files: [file] } });
		await vi.advanceTimersByTimeAsync(1000);
		expect(screen.getByText('練習用')).toBeTruthy();
		expect(drafts.state.bytes).toBeNull();
	});
});
