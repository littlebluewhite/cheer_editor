// 頁面：首頁列出最近的流程（有草稿的那幾支，點了打開、丟掉先問），欄位裡打了字還沒送出時關分頁先問、顯示「未存」、也進草稿。
// 草稿的規則（停手 1 秒存、存檔後清掉、兩個分頁…）在 src/lib/flow-file.test.ts。IndexedDB 換成記憶體裡的假草稿庫。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { createFlow, readFlowFile, writeFlowFile } from '#lib/core';
import type { DraftStore } from '#lib/file/draft.js';
import type { OpenTabChannel } from '#lib/tab-channel.js';
import { audioFlow, editorPage, fakeDraftStore, fakeTabs, flush, openFile, testEditor } from '#lib/test-fakes.js';
import { flowOf, libSample } from '#lib/test-flows.js';
import { hasUnsavedChanges } from '#lib/unsaved.js';
import Page from './+page.svelte';

function setup(draftStore: DraftStore, openTabChannel: OpenTabChannel | null = null) {
	return render(Page, editorPage(null, { draftStore, openTabChannel }).props);
}

const newFlowOf = (name: string) => flowOf(createFlow({ name, field: { strips: 9, layout: 'vertical' } }));

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

/** 首頁「最近的流程」裡那支流程的按鈕（點了打開它）。 */
const recent = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) });

describe('首頁：最近的流程', () => {
	it('有兩支流程的草稿：首頁照樣看得到新建、開檔，旁邊列出這兩支；點一支打開它（還算未存）', async () => {
		const drafts = fakeDraftStore();
		drafts.all.set('n1', { bytes: writeFlowFile(newFlowOf('全國賽'), {}), savedAt: new Date(2026, 10, 4, 9, 0) });
		drafts.all.set('n2', { bytes: writeFlowFile(audioFlow(), { a1: new Uint8Array([1]) }), savedAt: new Date(2026, 10, 5, 14, 3) });
		setup(drafts.store);
		await flush();
		expect(screen.getByLabelText('流程名字')).toBeTruthy();
		expect(screen.getByRole('button', { name: '建立' })).toBeTruthy();
		expect(screen.getByLabelText('開啟流程檔')).toBeTruthy();
		const list = screen.getByRole('list', { name: '最近的流程' });
		// 最近編的在上面
		expect([...list.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
			expect.stringContaining('練習用'),
			expect.stringContaining('全國賽')
		]);
		expect(recent('練習用').textContent).toContain('11/5 14:03');
		expect(recent('練習用').textContent).toContain('還沒存');
		await fireEvent.click(recent('練習用'));
		await flush();
		expect(screen.getByText('練習用')).toBeTruthy();
		expect(screen.getByText('未存')).toBeTruthy();
	});

	it('另一個分頁正在編的那支：標出來，點了不會打開', async () => {
		const drafts = fakeDraftStore();
		const tabs = fakeTabs();
		const other = testEditor(null, { draftStore: drafts.store, openTabChannel: tabs });
		other.editor.file.connect();
		await flush();
		other.editor.file.create(newFlowOf('全國賽'));
		await flush();
		setup(drafts.store, tabs);
		await vi.waitFor(() => expect(recent('全國賽').textContent).toContain('另一個分頁正在編'));
		expect((recent('全國賽') as HTMLButtonElement).disabled).toBe(true);
		await fireEvent.click(recent('全國賽'));
		await flush();
		expect(screen.getByLabelText('流程名字')).toBeTruthy();
	});

	it('按「丟掉」先問；按取消草稿還在，確定才丟掉', async () => {
		const drafts = fakeDraftStore(writeFlowFile(audioFlow(), {}));
		setup(drafts.store);
		await flush();
		await fireEvent.click(screen.getByRole('button', { name: '丟掉「練習用」' }));
		expect(screen.getByRole('alertdialog').textContent).toContain('丟掉「練習用」的草稿？');
		await fireEvent.click(screen.getByRole('button', { name: '取消' }));
		expect(screen.queryByRole('alertdialog')).toBeNull();
		expect(drafts.latest()).not.toBeNull();
		expect(recent('練習用')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: '丟掉「練習用」' }));
		await fireEvent.click(screen.getByRole('button', { name: '丟掉' }));
		await vi.waitFor(() => expect(screen.queryByRole('list', { name: '最近的流程' })).toBeNull());
		expect(drafts.latest()).toBeNull();
	});

	it('「丟掉」的確認是對話框：焦點先在「取消」，Escape 等於取消，焦點回到「丟掉」', async () => {
		const drafts = fakeDraftStore(writeFlowFile(audioFlow(), {}));
		setup(drafts.store);
		await flush();
		const drop = screen.getByRole('button', { name: '丟掉「練習用」' });
		drop.focus();
		await fireEvent.click(drop);
		const dialog = screen.getByRole('dialog', { name: /丟掉「練習用」的草稿？/ });
		expect(dialog.getAttribute('aria-modal')).toBe('true');
		expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '取消' }));
		await fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
		await flush();
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(drafts.latest()).not.toBeNull();
		expect(document.activeElement).toBe(drop);
	});

	it('開了流程檔沒改、重新整理：首頁的最近的流程裡有它，點了打開（不算未存）', async () => {
		const drafts = fakeDraftStore();
		const first = setup(drafts.store);
		await flush();
		await openFile(writeFlowFile(audioFlow(), {}));
		expect(screen.getByText('練習用')).toBeTruthy();
		first.unmount();
		setup(drafts.store);
		await flush();
		expect(recent('練習用').textContent).not.toContain('還沒存');
		await fireEvent.click(recent('練習用'));
		await flush();
		expect(screen.getByText('練習用')).toBeTruthy();
		expect(screen.queryByText('未存')).toBeNull();
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

describe('欄位裡打到一半的字（還沒離開欄位）', () => {
	/** 開著範例流程（Lib），選到 Lib；草稿讀過了。 */
	async function opened() {
		const drafts = fakeDraftStore();
		const page = editorPage(libSample(), { draftStore: drafts.store });
		render(Page, page.props);
		await flush();
		await fireEvent.click(document.querySelector('[data-lane="m1"] [data-action-id="x1"]')!);
		return { ...page, drafts };
	}

	/** 在動作名稱打字，不離開欄位。 */
	async function typeName(value: string) {
		const name = screen.getByLabelText('名稱');
		name.focus();
		await fireEvent.input(name, { target: { value } });
		return name;
	}

	/** 草稿裡 Lib 的名字。 */
	const draftName = (bytes: Uint8Array | null) => {
		const r = readFlowFile(bytes ?? new Uint8Array());
		return r.kind === 'ok' ? r.flow.actions[0].name : null;
	};

	it('在動作名稱打字不離開：馬上顯示「未存」', async () => {
		await opened();
		expect(screen.queryByText('未存')).toBeNull();
		await typeName('高 Lib');
		expect(screen.getByText('未存')).toBeTruthy();
	});

	it('停手 1 秒存草稿時還在打字：先送出，草稿裡有打的字；焦點還在欄位裡', async () => {
		const { drafts } = await opened();
		vi.useFakeTimers();
		try {
			// 先改了別的（備註），停手 1 秒就要存草稿；這 1 秒裡去打名稱
			await fireEvent.change(screen.getByLabelText('備註'), { target: { value: '慢慢來' } });
			const name = await typeName('高 Lib');
			await vi.advanceTimersByTimeAsync(1000);
			expect(draftName(drafts.latest())).toBe('高 Lib');
			expect(document.activeElement).toBe(name);
		} finally {
			vi.useRealTimers();
		}
	});

	it.each([
		['關掉、收掉分頁（pagehide）', () => window.dispatchEvent(new Event('pagehide'))],
		[
			'切到別的分頁、別的 app（visibilitychange 變 hidden）',
			() => {
				Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
				document.dispatchEvent(new Event('visibilitychange'));
			}
		]
	])('%s：送出打到一半的字，馬上存草稿（不等 1 秒）', async (_, hide) => {
		const { drafts, session } = await opened();
		await typeName('高 Lib');
		try {
			hide();
			await flush();
		} finally {
			Reflect.deleteProperty(document, 'visibilityState');
		}
		expect(session.flow!.actions[0].name).toBe('高 Lib');
		expect(draftName(drafts.latest())).toBe('高 Lib');
	});

	it('切回這個分頁（visibilitychange 變 visible）：不送出', async () => {
		const { session } = await opened();
		await typeName('高 Lib');
		document.dispatchEvent(new Event('visibilitychange'));
		await flush();
		expect(session.flow!.actions[0].name).toBe('Lib');
	});
});
