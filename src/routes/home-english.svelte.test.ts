// 首頁和編輯畫面的外框（上方列、選單、播放列的「⋯」、右邊欄的分頁、對話框）英文畫面照語言寫（ADR 0017）。
// 只看這一頁自己寫的字：裡面放的元件（新建表單、時間軸、隊員、動作表單、帳號選單、語言選單…）各自的測試看。
// 名字都用英數字，教練自己取的名字不算。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addBookmark, addMembers, addSegment, createFlow, writeFlowFile } from '#lib/core';
import { localStorageKey } from '#lib/paraglide/runtime.js';
import { editorPage, fakeDraftStore, fakeServer, flush } from '#lib/test-fakes.js';
import { flowOf } from '#lib/test-flows.js';
import Page from './+page.svelte';

Element.prototype.scrollIntoView = () => {};

const han = /\p{Script=Han}/u;

/** 元素和裡面看得到、聽得到的字（字、aria-label、title、placeholder），有中文的挑出來。 */
function hanIn(...els: Element[]): string[] {
	const found: string[] = [];
	for (const el of els) {
		for (const e of [el, ...el.querySelectorAll('*')]) {
			for (const name of ['aria-label', 'title', 'placeholder']) {
				const v = e.getAttribute(name);
				if (v && han.test(v)) found.push(`${name}=${v}`);
			}
		}
		if (han.test(el.textContent ?? '')) found.push(el.textContent!.trim());
	}
	return found;
}

const one = (selector: string) => {
	const el = document.querySelector(selector);
	if (!el) throw new Error(`找不到 ${selector}`);
	return el;
};

const newFlowOf = (name: string) => flowOf(createFlow({ name, field: { strips: 9, layout: 'vertical' } }));
const coach = { email: 'coach@example.com', name: 'Coach', isAdmin: false, password: '' };

beforeEach(() => localStorage.setItem(localStorageKey, 'en'));
afterEach(() => vi.restoreAllMocks());

describe('首頁（英文）', () => {
	it('沒登入：標題、說明、開啟流程檔、最近的流程、丟掉的確認框和回饋都是英文', async () => {
		const drafts = fakeDraftStore();
		drafts.all.set('n1', { bytes: writeFlowFile(newFlowOf('Nationals'), {}), savedAt: new Date(2026, 10, 4, 9, 0) });
		render(Page, editorPage(null, { draftStore: drafts.store }).props);
		await flush();
		await flush();

		expect(document.title).toBe('Routine Editor');
		expect(one('.intro h1').textContent).toBe('CheerRoutine Editor');
		expect(screen.getByRole('button', { name: 'Discard “Nationals”' })).toBeTruthy();
		expect(hanIn(one('.intro'), one('.home-open'), one('.recent'), one('.home-guide'))).toEqual([]);

		await fireEvent.click(screen.getByRole('button', { name: 'Discard “Nationals”' }));
		const dialog = screen.getByRole('dialog');
		expect(dialog.getAttribute('aria-label')).toBe(
			"Discard the draft of “Nationals”? Unsaved changes will be lost and can't be undone."
		);
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
		await flush();
		expect(screen.getByText('Discarded the draft of “Nationals”')).toBeTruthy();
	});

	it('登入：雲端、我的流程、這台電腦、存在哪裡都是英文', async () => {
		const fake = fakeServer({
			users: [coach],
			signedIn: coach.email,
			flows: [{ id: 'c1', owner: coach.email, flow: newFlowOf('Spring show'), updatedAt: new Date(2026, 10, 5, 9, 3).toISOString() }]
		});
		render(Page, editorPage(null, { server: fake.server, draftStore: fakeDraftStore().store }).props);
		await flush();
		await flush();

		expect(screen.getByRole('heading', { name: 'My routines' })).toBeTruthy();
		expect(one('.brand').textContent).toBe('Cheer Routine Editor');
		expect(hanIn(one('.home-lists'), one('fieldset.where'), one('.home-open'))).toEqual([]);
	});
});

describe('編輯畫面的外框（英文）', () => {
	function open() {
		let flow = newFlowOf('Nationals');
		flow = flowOf(addSegment(flow, 'music'));
		render(Page, editorPage(flow).props);
	}

	it('上方列、播放列、選單、「⋯」、右邊欄的分頁、分界、場上沒人的提示都是英文', async () => {
		open();
		await flush();

		expect(document.title).toBe('Nationals — Routine Editor');
		expect(screen.getByRole('button', { name: 'Choreography' })).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
		await fireEvent.click(screen.getByRole('button', { name: 'More playback options' }));
		expect(
			hanIn(
				one('header.topbar'),
				one('.menu-pop'),
				one('.more-pop'),
				one('.skip'),
				one('.inspector .tabs'),
				one('.col-split'),
				one('.split'),
				one('.field-empty'),
				one('.rotate-hint')
			)
		).toEqual([]);
		// 時間軸裡面是時間軸元件自己的字，這裡只看外框的名字
		expect(one('.timeline-host').getAttribute('aria-label')).toBe('Timeline');
	});

	it('書籤：書籤列、管理、存成書籤打名字、找書籤的框都是英文', async () => {
		let flow = flowOf(addSegment(newFlowOf('Nationals'), 'music'));
		flow = flowOf(addBookmark(flow, 'Lib', { segmentId: flow.segments[0].id, at: 0 }, null));
		render(Page, editorPage(flow).props);
		await flush();
		await fireEvent.click(screen.getByRole('button', { name: 'Manage' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Save as bookmark' }));
		expect(screen.getByRole('textbox', { name: 'Bookmark name' })).toBeTruthy();
		expect(hanIn(one('header.topbar .bookmarks'))).toEqual([]);
		await fireEvent.keyDown(window, { key: 'Escape' });
		await fireEvent.keyDown(window, { key: '/' });
		expect(hanIn(screen.getByRole('dialog', { name: 'Find bookmark' }))).toEqual([]);
	});

	it('檢視模式：右上角、「我」選單、右邊欄的說明都是英文', async () => {
		let flow = newFlowOf('Nationals');
		flow = flowOf(addMembers(flow, [{ name: 'Amy', gender: 'F', globalRole: 'top' }]));
		render(Page, editorPage(flow).props);
		await flush();
		await fireEvent.click(screen.getByRole('button', { name: 'View' }));

		expect(one('.view-badge').textContent!.trim()).toBe('View mode · read only');
		expect(hanIn(one('.view-me'), one('.view-hint'))).toEqual([]);
	});

	it('還沒存就新建：問句和按鈕都是英文', async () => {
		const flow = newFlowOf('Nationals');
		const page = editorPage(flow);
		render(Page, page.props);
		await flush();
		page.session.ask.send({ name: 'renameFlow', args: ['Regionals'] });
		await flush();
		expect(screen.getByText('Unsaved')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
		await fireEvent.click(within(one('.menu-pop') as HTMLElement).getByRole('button', { name: 'New' }));
		await flush();
		const dialog = screen.getByRole('dialog');
		expect(dialog.getAttribute('aria-label')).toBe('“Regionals” isn\'t saved; your changes will be lost.');
		expect(within(dialog).getByRole('button', { name: 'Don\'t save, continue' })).toBeTruthy();
		expect(within(dialog).getByRole('button', { name: 'Save first' })).toBeTruthy();
	});
});
