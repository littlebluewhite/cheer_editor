// 上方列的「選單」（#279）：不常按的五樣（開啟流程檔、新建｜輸出影片、流程設定｜使用說明）收在最左邊的小窗裡。
// 窄不窄、是不是觸控螢幕是媒體查詢：jsdom 沒有 matchMedia，換一個假的。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFlow, renameFlow } from '#lib/core';
import { NARROW_SCREEN } from '#lib/editor-layout.js';
import { editorPage, fakeSaver, flush, fromMenu, menuItem, menuPop, openFile, practiceFlow } from '#lib/test-fakes.js';
import { flowOf, libSample } from '#lib/test-flows.js';
import { writeFlowFile } from '#lib/core/flow-file.js';
import Page from './+page.svelte';

Element.prototype.scrollIntoView = () => {};

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

const menuButton = () => screen.getByRole('button', { name: '選單' });
const topbar = () => document.querySelector<HTMLElement>('.topbar')!;
/** 選單小窗裡的項目名字，照畫面上的順序；分組的線寫成「｜」。 */
const menuItems = () =>
	[...menuPop()!.querySelectorAll('button, a, hr')].map((el) => (el.tagName === 'HR' ? '｜' : el.textContent!.trim()));

/** 打開範例流程（有段、有動作），選好動作 x1。 */
async function withSample(adapters: Parameters<typeof editorPage>[1] = {}) {
	const page = editorPage(libSample(), adapters);
	render(Page, page.props);
	page.session.selectAction('x1');
	await tick();
	return page;
}

describe('上方列的「選單」', () => {
	it('電腦：選單在上方列最左邊；開啟、新建、輸出影片、流程設定、使用說明不在外面', async () => {
		await withSample();
		const bar = within(topbar());
		const first = topbar().querySelector('button, a, input, select');
		expect(first).toBe(menuButton());
		for (const name of ['開啟', '開啟流程檔', '新建', '輸出影片', '流程設定']) expect(bar.queryByRole('button', { name })).toBeNull();
		expect(bar.queryByLabelText('開啟')).toBeNull();
		expect(bar.queryByRole('link', { name: /使用說明/ })).toBeNull();
	});

	it('點「選單」出現五樣、分三組；報讀軟體讀得出會打開小窗、開著還是關著', async () => {
		await withSample();
		expect(menuButton().getAttribute('aria-haspopup')).toBe('dialog');
		expect(menuButton().getAttribute('aria-expanded')).toBe('false');
		expect(menuPop()).toBeNull();
		await fireEvent.click(menuButton());
		expect(menuButton().getAttribute('aria-expanded')).toBe('true');
		expect(menuItems()).toEqual(['開啟流程檔', '新建', '｜', '輸出影片', '流程設定', '｜', '使用說明']);
	});

	it('點外面、再點一次「選單」、按 Esc 都會關；Esc 關的時候選到的動作還在，焦點回到「選單」', async () => {
		const { session } = await withSample();
		await fireEvent.click(menuButton());
		await fireEvent.click(menuButton());
		expect(menuPop()).toBeNull();
		expect(menuButton().getAttribute('aria-expanded')).toBe('false');

		await fireEvent.click(menuButton());
		await fireEvent.pointerDown(menuPop()!);
		expect(menuPop()).toBeTruthy();
		await fireEvent.pointerDown(document.querySelector('.timeline, main') ?? document.body);
		expect(menuPop()).toBeNull();

		await fireEvent.click(menuButton());
		const item = (await menuItem('新建'))!;
		item.focus();
		await fireEvent.keyDown(item, { key: 'Escape' });
		expect(menuPop()).toBeNull();
		expect(session.selectedActionId).toBe('x1');
		expect(document.activeElement).toBe(menuButton());
	});

	it('選單開了之後，裡面每一項都在「選單」後面、按 Tab 走得到', async () => {
		await withSample();
		await fireEvent.click(menuButton());
		const items = [...menuPop()!.querySelectorAll<HTMLElement>('button, a')];
		expect(items).toHaveLength(5);
		for (const el of items) {
			expect(el.tabIndex).toBe(0);
			expect(menuButton().compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		}
		// 小窗裡最後一項後面才是流程名字那些：Tab 從選單走進小窗，走完才往右
		expect(items.at(-1)!.compareDocumentPosition(screen.getByRole('button', { name: '編排' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	it('流程設定：點了小窗關掉、打開流程設定；關掉後焦點回到「選單」', async () => {
		await withSample();
		await fromMenu('流程設定');
		expect(menuPop()).toBeNull();
		const dialog = screen.getByRole('dialog', { name: '流程設定' });
		await fireEvent.click(within(dialog).getByRole('button', { name: '關閉' }));
		await flush();
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(document.activeElement).toBe(menuButton());
	});

	it('輸出影片：在播的先停，打開輸出影片；關掉後焦點回到「選單」', async () => {
		await withSample();
		await fireEvent.click(screen.getByRole('button', { name: '播放' }));
		expect(screen.getByRole('button', { name: '暫停' })).toBeTruthy();
		await fromMenu('輸出影片');
		expect(menuPop()).toBeNull();
		expect(screen.getByRole('button', { name: '播放' })).toBeTruthy();
		const dialog = screen.getByRole('dialog', { name: '輸出影片' });
		await fireEvent.keyDown(await within(dialog).findByRole('button', { name: '開始' }), { key: 'Escape' });
		await flush();
		expect(document.activeElement).toBe(menuButton());
	});

	it('新建：回到新建流程', async () => {
		await withSample();
		await fromMenu('新建');
		expect(screen.getByRole('button', { name: '建立' })).toBeTruthy();
	});

	it('使用說明：開在新分頁的連結，點了小窗關掉', async () => {
		await withSample();
		const link = (await menuItem('使用說明')) as HTMLAnchorElement;
		expect(link.getAttribute('href')).toMatch(/\/guide\?from=editor$/);
		expect(link.target).toBe('_blank');
		link.addEventListener('click', (e) => e.preventDefault());
		await fireEvent.click(link);
		expect(menuPop()).toBeNull();
	});

	it('開啟流程檔：點了在同一下叫出選檔欄位（欄位在小窗外面，小窗關了還在），選好的檔開起來', async () => {
		await withSample();
		const input = screen.getByLabelText('開啟流程檔') as HTMLInputElement;
		expect(input.type).toBe('file');
		expect(input.accept).toBe('.zip');
		let clicked = 0;
		input.addEventListener('click', () => clicked++);
		await fromMenu('開啟流程檔');
		expect(clicked).toBe(1);
		expect(menuPop()).toBeNull();
		expect(input.isConnected).toBe(true);
		await openFile(writeFlowFile(flowOf(renameFlow(libSample(), '縣賽')), {}), '開啟流程檔', '縣賽.zip');
		expect(document.querySelector('.topbar b')?.textContent).toBe('縣賽');
	});

	it('開啟流程檔：有未存的修改先問；按「取消」不選檔，焦點回到「選單」', async () => {
		const { session } = await withSample();
		session.change(flowOf(renameFlow(session.flow!, '改過')));
		await tick();
		await fromMenu('開啟流程檔');
		const dialog = screen.getByRole('dialog', { name: /還沒存/ });
		expect(dialog.textContent).toContain('要開別的流程檔');
		await fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
		await flush();
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(document.activeElement).toBe(menuButton());
	});

	it('開啟流程檔：選檔視窗（Chrome、Edge）直接打開選到的檔', async () => {
		const file = new File([writeFlowFile(flowOf(renameFlow(libSample(), '縣賽')), {}) as Uint8Array<ArrayBuffer>], '縣賽.zip');
		let picks = 0;
		const { saver } = fakeSaver();
		await withSample({ pickFlowFile: async () => (picks++, { file, saver }) });
		await fromMenu('開啟流程檔');
		await flush();
		expect(picks).toBe(1);
		expect(document.querySelector('.topbar b')?.textContent).toBe('縣賽');
	});

	it('開啟流程檔開到音樂檔：照舊提示去點段列上的段載入', async () => {
		await withSample();
		await openFile(new TextEncoder().encode('ID3'), '開啟流程檔', '主歌.MP3');
		expect(screen.getByRole('status').textContent).toBe(
			'打不開「主歌.MP3」：這是音樂檔，不是流程檔。音樂要點段列上的段，在段設定按「載入音樂檔」'
		);
	});
});

describe('選單裡每一項照原本的規則', () => {
	it('流程沒有段：輸出影片是灰的，寫「先加一段」', async () => {
		render(Page, editorPage(flowOf(createFlow({ name: '練習用', field: { strips: 9, layout: 'vertical' } }))).props);
		const video = (await menuItem('輸出影片')) as HTMLButtonElement;
		expect(video.disabled).toBe(true);
		expect(video.title).toBe('先加一段');
	});

	it('檢視模式：流程設定是灰的，其他照樣能用', async () => {
		await withSample();
		await fireEvent.click(screen.getByRole('button', { name: '檢視' }));
		expect(((await menuItem('流程設定')) as HTMLButtonElement).disabled).toBe(true);
		for (const name of ['開啟流程檔', '新建', '輸出影片']) expect(((await menuItem(name)) as HTMLButtonElement).disabled, name).toBe(false);
		expect(await menuItem('使用說明')).toBeTruthy();
	});

	it('觸控螢幕（iPad 橫拿）：有選單，裡面沒有輸出影片', async () => {
		vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(pointer: coarse)' }));
		await withSample();
		await fireEvent.click(menuButton());
		expect(menuItems()).toEqual(['開啟流程檔', '新建', '｜', '流程設定', '｜', '使用說明']);
	});

	it('練習：只有開啟流程檔、新建、使用說明', async () => {
		render(Page, editorPage(practiceFlow()).props);
		await fireEvent.click(screen.getByRole('button', { name: '練習' }));
		await fireEvent.click(menuButton());
		expect(menuItems()).toEqual(['開啟流程檔', '新建', '｜', '使用說明']);
	});
});

describe('窄螢幕（手機檢視畫面）的上方列不動', () => {
	it('沒有「選單」；開啟、回首頁、存檔、八拍表、使用說明在外面', async () => {
		vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === NARROW_SCREEN }));
		render(Page, editorPage(libSample()).props);
		const bar = within(topbar());
		expect(bar.queryByRole('button', { name: '選單' })).toBeNull();
		expect(bar.getByLabelText('開啟')).toBeTruthy();
		for (const name of ['回首頁', '存檔', '八拍表']) expect(bar.getByRole('button', { name: new RegExp(name) })).toBeTruthy();
		expect(bar.getByRole('link', { name: /使用說明/ })).toBeTruthy();
	});
});
