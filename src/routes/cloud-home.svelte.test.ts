// 頁面：登入後的首頁兩欄（雲端的「我的流程」、這台電腦的「最近的流程」）、新建表單「存在：雲端／這台」、
// 新建和打開雲端流程（#247；打開就能改，#248）。伺服器換成測試共用的假伺服器（fakeServer）。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFlow, writeFlowFile } from '#lib/core';
import { editorPage, fakeDraftStore, fakeServer, flush, type FakeCloudFlow } from '#lib/test-fakes.js';
import { flowOf } from '#lib/test-flows.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView（錯誤訊息出現時捲過去，reveal.ts）。
Element.prototype.scrollIntoView = () => {};

const lin = { email: 'lin@example.com', name: '林教練', isAdmin: true, password: '我們這一隊今年一定會贏 go go' };
const wang = { email: 'wang@example.com', name: '王教練', isAdmin: false, password: '' };
const newFlowOf = (name: string) => flowOf(createFlow({ name, field: { strips: 9, layout: 'vertical' } }));
const at = (month: number, day: number, h: number, m: number) => new Date(2026, month - 1, day, h, m).toISOString();

function signedIn(flows: FakeCloudFlow[] = [], drafts = fakeDraftStore()) {
	const fake = fakeServer({ users: [lin, wang], signedIn: lin.email, flows });
	const page = editorPage(null, { server: fake.server, draftStore: drafts.store });
	render(Page, page.props);
	return { ...fake, page, drafts };
}

async function create(name: string) {
	await fireEvent.input(screen.getByLabelText('流程名字'), { target: { value: name } });
	await fireEvent.click(screen.getByRole('button', { name: '建立' }));
	await flush();
	await flush();
}

const goOffline = (offline: boolean) => {
	vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(!offline);
	window.dispatchEvent(new Event(offline ? 'offline' : 'online'));
};

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe('登入後的首頁', () => {
	it('兩欄：左邊雲端「我的流程」（每列名字、最後改的時間，最近改的在上）和這台電腦「最近的流程」；右邊新建、開啟流程檔', async () => {
		const drafts = fakeDraftStore();
		drafts.all.set('n1', { bytes: writeFlowFile(newFlowOf('隊內練習'), {}), savedAt: new Date(2026, 10, 4, 9, 0) });
		signedIn(
			[
				{ id: 'c1', owner: lin.email, flow: newFlowOf('全國賽'), updatedAt: at(11, 5, 9, 3) },
				{ id: 'c2', owner: lin.email, flow: newFlowOf('校慶表演'), updatedAt: at(11, 6, 15, 20) },
				{ id: 'c3', owner: wang.email, flow: newFlowOf('王教練的流程'), updatedAt: at(11, 6, 16, 0) }
			],
			drafts
		);
		await flush();

		const cloud = screen.getByRole('region', { name: '雲端' });
		const mine = within(cloud).getByRole('list', { name: '我的流程' });
		expect([...mine.querySelectorAll('li')].map((li) => li.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
			'校慶表演 11/6 15:20 改過',
			'全國賽 11/5 09:03 改過'
		]);
		const here = screen.getByRole('region', { name: '這台電腦' });
		expect(within(here).getByRole('list', { name: '最近的流程' }).textContent).toContain('隊內練習');
		expect(screen.getByRole('button', { name: '建立' })).toBeTruthy();
		expect(screen.getByLabelText('開啟流程檔')).toBeTruthy();
		expect(screen.getByRole('button', { name: '林教練 ▾' })).toBeTruthy();
	});

	it('「我的流程」空的時候：說怎麼放流程上去', async () => {
		signedIn();
		await flush();
		const mine = screen.getByRole('list', { name: '我的流程' });
		expect(mine.textContent).toContain('還沒有。新建時選「存在：雲端」，或打開一支本機流程按「傳上雲端」。');
	});

	it('沒登入：跟現在一樣（沒有雲端、沒有「存在」那格）', async () => {
		render(Page, editorPage().props);
		await flush();
		expect(screen.getByRole('heading', { name: /競技啦啦隊/ })).toBeTruthy();
		expect(screen.queryByRole('region', { name: '雲端' })).toBeNull();
		expect(screen.queryByRole('group', { name: '存在' })).toBeNull();
		expect(screen.getByRole('link', { name: '登入' })).toBeTruthy();
	});
});

describe('新建表單：存在雲端／這台', () => {
	it('預設存在雲端', async () => {
		signedIn();
		await flush();
		const where = screen.getByRole('group', { name: '存在' });
		expect((within(where).getByRole('radio', { name: /^雲端/ }) as HTMLInputElement).checked).toBe(true);
		expect(within(where).getByText('換台電腦也打得開，可以分享')).toBeTruthy();
		expect(within(where).getByText('只在這台電腦，靠草稿和流程檔留著')).toBeTruthy();
	});

	it('沒網路：雲端選不了、說原因、自動選這台；網路回來又能選', async () => {
		goOffline(true);
		signedIn();
		await flush();
		const where = screen.getByRole('group', { name: '存在' });
		const cloud = within(where).getByRole('radio', { name: /^雲端/ }) as HTMLInputElement;
		expect(cloud.disabled).toBe(true);
		expect(cloud.checked).toBe(false);
		expect((within(where).getByRole('radio', { name: /^這台/ }) as HTMLInputElement).checked).toBe(true);
		expect(within(where).getByText('沒有網路，現在不能存在雲端')).toBeTruthy();

		goOffline(false);
		await flush();
		expect(cloud.disabled).toBe(false);
	});

	it('新建雲端流程：伺服器存起來，打開的是它（能改），沒有存草稿；回首頁列在我的流程，不在最近的流程', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const s = signedIn();
		await vi.advanceTimersByTimeAsync(0);
		await fireEvent.input(screen.getByLabelText('流程名字'), { target: { value: '全國賽' } });
		await fireEvent.click(screen.getByRole('button', { name: '建立' }));
		await vi.advanceTimersByTimeAsync(0);

		expect(s.state.flows.map((f) => [f.owner, f.flow.name])).toEqual([[lin.email, '全國賽']]);
		expect(s.page.editor.file.cloudId).toBe(s.state.flows[0].id);
		expect(s.page.session.flow?.name).toBe('全國賽');
		expect(s.page.session.viewing).toBe(false);

		// 停手好幾秒也不存草稿
		await vi.advanceTimersByTimeAsync(5000);
		expect(s.drafts.all.size).toBe(0);

		await fireEvent.click(screen.getByRole('button', { name: '首頁' }));
		await vi.advanceTimersByTimeAsync(0);
		expect(screen.getByRole('list', { name: '我的流程' }).textContent).toContain('全國賽');
		expect(screen.queryByRole('list', { name: '最近的流程' })?.textContent ?? '').not.toContain('全國賽');
		expect(s.drafts.all.size).toBe(0);
	});

	it('選「這台」：跟以前一樣建本機流程（存草稿、不送伺服器）', async () => {
		const s = signedIn();
		await flush();
		await fireEvent.click(screen.getByRole('radio', { name: /^這台/ }));
		await create('隊內練習');
		expect(s.state.flows).toEqual([]);
		expect(s.page.editor.file.cloudId).toBeNull();
		expect(s.page.session.flow?.name).toBe('隊內練習');
		expect(s.drafts.all.size).toBe(1);
	});
});

describe('打開雲端流程', () => {
	it('點「我的流程」的一列：從伺服器拿編排打開，能改', async () => {
		const flow = newFlowOf('校慶表演');
		const s = signedIn([{ id: 'c2', owner: lin.email, flow, updatedAt: at(11, 6, 15, 20) }]);
		await flush();
		await fireEvent.click(screen.getByRole('button', { name: /^校慶表演/ }));
		await flush();
		expect(s.page.session.flow).toEqual(flow);
		expect(s.page.editor.file.cloudId).toBe('c2');
		expect(s.page.session.viewing).toBe(false);
		expect((screen.getByRole('button', { name: '編輯' }) as HTMLButtonElement).disabled).toBe(false);
		await flush();
		expect(s.drafts.all.size).toBe(0);
	});
});
