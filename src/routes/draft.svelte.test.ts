// 頁面：草稿自動存、打開時問要不要救回。IndexedDB 換成記憶體裡的假草稿庫（真的要手動在四家瀏覽器檢查）。
import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	addAction,
	addMembers,
	addSegment,
	createFlow,
	loadSegmentAudio,
	readFlowFile,
	writeFlowFile,
	type CommandResult,
	type Flow
} from '#lib/core';
import { createFakeEngine } from '#lib/audio/fake-engine.js';
import type { DraftStore } from '#lib/file/draft.js';
import { fakeDecode, fakeDraftStore, fakeSaver, settle } from '#lib/test-fakes.js';
import { hasUnsavedChanges } from '#lib/unsaved.js';
import Page from './+page.svelte';

function setup(draftStore: DraftStore) {
	render(Page, {
		createEngine: () => createFakeEngine(),
		createSaver: () => fakeSaver().saver,
		decode: fakeDecode,
		draftStore
	});
}

function flowOf(r: CommandResult): Flow {
	if (r.kind !== 'ok') throw new Error(r.message);
	return r.flow;
}

/** 音樂 1（a1.mp3）；小A 在一個動作裡。 */
function sampleFlow(): Flow {
	let flow = flowOf(createFlow({ name: '練習用', field: { strips: 9, layout: 'vertical' } }));
	flow = flowOf(addMembers(flow, [{ name: '小A', gender: 'F', globalRole: 'top' }]));
	flow = flowOf(addSegment(flow, 'music'));
	flow = flowOf(loadSegmentAudio(flow, 's1', '主歌.mp3'));
	return flowOf(
		addAction(flow, {
			segmentId: 's1',
			category: 'stunt',
			name: 'Lib',
			start: 0,
			length: 16,
			note: '',
			members: [{ memberId: 'm1', role: '上層' }]
		})
	);
}

describe('打開時救回草稿', () => {
	it('有草稿就問；按「救回」打開草稿（含動作、音樂），還算未存', async () => {
		const { store } = fakeDraftStore(writeFlowFile(sampleFlow(), { a1: new Uint8Array([1]) }));
		setup(store);
		await settle();
		expect(screen.getByRole('alertdialog').textContent).toContain('練習用');
		await fireEvent.click(screen.getByRole('button', { name: '救回' }));
		await settle();
		expect(screen.getByText('練習用')).toBeTruthy();
		expect(document.querySelector('[data-lane="m1"] [data-action-id]')).toBeTruthy();
		expect(screen.getByRole('button', { name: /音樂 1/ }).textContent).not.toContain('找不到音樂');
		expect(screen.getByText('未存')).toBeTruthy();
		expect(hasUnsavedChanges()).toBe(true);
	});

	it('按「丟掉」：草稿刪掉，回到新建流程', async () => {
		const drafts = fakeDraftStore(writeFlowFile(sampleFlow(), {}));
		setup(drafts.store);
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: '丟掉' }));
		await settle();
		expect(screen.queryByRole('alertdialog')).toBeNull();
		expect(screen.getByLabelText('流程名字')).toBeTruthy();
		expect(drafts.state.bytes).toBeNull();
	});

	it('沒有草稿就不問', async () => {
		setup(fakeDraftStore().store);
		await settle();
		expect(screen.queryByRole('alertdialog')).toBeNull();
		expect(screen.getByLabelText('流程名字')).toBeTruthy();
	});
});

describe('編輯時自動存草稿', () => {
	afterEach(() => vi.useRealTimers());

	async function newFlow() {
		await fireEvent.input(screen.getByLabelText('流程名字'), { target: { value: '全國賽' } });
		await fireEvent.click(screen.getByRole('button', { name: '建立' }));
	}

	async function addChant() {
		await fireEvent.click(screen.getByRole('button', { name: '在最後加一段' }));
		await fireEvent.click(screen.getByRole('button', { name: '＋口號段' }));
	}

	function draftFlow(bytes: Uint8Array | null) {
		const r = bytes && readFlowFile(bytes);
		if (!r || r.kind !== 'ok') throw new Error('沒有草稿');
		return r;
	}

	it('改了停 1 秒就存；連續改只存最後的樣子', async () => {
		const drafts = fakeDraftStore();
		setup(drafts.store);
		await settle();
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
		const drafts = fakeDraftStore(writeFlowFile(sampleFlow(), { a1: new Uint8Array([7, 7]) }));
		setup(drafts.store);
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: '救回' }));
		await settle();
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
		await settle();
		vi.useFakeTimers();
		await newFlow();
		await vi.advanceTimersByTimeAsync(1000);
		expect(drafts.state.bytes).not.toBeNull();
		await fireEvent.keyDown(window, { key: 's', ctrlKey: true });
		await vi.advanceTimersByTimeAsync(1000);
		expect(drafts.state.bytes).toBeNull();
		await addChant();
		await vi.advanceTimersByTimeAsync(1000);
		expect(draftFlow(drafts.state.bytes).flow.segments).toHaveLength(1);
	});

	it('救回草稿時清空復原紀錄；復原後草稿照常存（存的是復原後的流程，音樂還在）', async () => {
		const drafts = fakeDraftStore(writeFlowFile(sampleFlow(), { a1: new Uint8Array([7, 7]) }));
		setup(drafts.store);
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: '救回' }));
		await settle();
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

	it('剛開的流程檔沒改過，不存草稿', async () => {
		const drafts = fakeDraftStore();
		setup(drafts.store);
		await settle();
		vi.useFakeTimers();
		const file = new File([writeFlowFile(sampleFlow(), {}) as Uint8Array<ArrayBuffer>], '練習用.zip');
		await fireEvent.change(screen.getByLabelText('開啟流程檔'), { target: { files: [file] } });
		await vi.advanceTimersByTimeAsync(1000);
		expect(screen.getByText('練習用')).toBeTruthy();
		expect(drafts.state.bytes).toBeNull();
	});
});
