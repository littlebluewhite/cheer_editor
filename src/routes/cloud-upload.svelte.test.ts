// 頁面：本機流程「☁ 傳上雲端」、雲端流程「⤓ 下載」（#259）。
// 傳上雲端＝搬過去：變成一支新的雲端流程（傳的人是擁有者），打開雲端那支、丟掉這台的草稿；音樂檔超過 60 MB 擋下跳框。
// 下載：擁有者、編輯者才有，手機沒有；包成流程檔，帶紀錄、不帶記的人、擁有者、權限、分享連結。
// 伺服器換成測試共用的假伺服器（fakeServer）。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSegmentAudio, putRecords, readFlowFile, writeFlowFile, type Flow } from '#lib/core';
import { NARROW_SCREEN } from '#lib/editor-layout.js';
import { editorPage, fakeDraftStore, fakeServer, flush, fromMenu, menuItem, openFile, recordedFlow, type FakeCloudFlow } from '#lib/test-fakes.js';
import { flowOf } from '#lib/test-flows.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

const pw = '我們這一隊今年一定會贏 go go';
const lin = { email: 'lin@example.com', name: '林教練', isAdmin: false, password: pw };
const wang = { email: 'wang@example.com', name: '王教練', isAdmin: false, password: pw };

/** recordedFlow（Lib 記了 3 次）加上音樂 1 的音樂檔（a1）。 */
const LOCAL = flowOf(loadSegmentAudio(recordedFlow(), 's1', '主歌.mp3'));
const localFlow = (): Flow => structuredClone(LOCAL);

afterEach(() => {
	vi.unstubAllGlobals();
});

/** 林教練（signedIn 才登入）在首頁開一個本機流程檔（音樂 1 的音樂檔是 music）。 */
async function openLocal(music: Uint8Array, signedIn = true) {
	const fake = fakeServer({ users: [lin, wang], signedIn: signedIn ? lin.email : null });
	const drafts = fakeDraftStore();
	const page = editorPage(null, { server: fake.server, draftStore: drafts.store });
	render(Page, page.props);
	await flush();
	await openFile(writeFlowFile(localFlow(), { a1: music }));
	await flush();
	return { ...fake, page, drafts };
}

describe('傳上雲端', () => {
	it('沒登入：沒有「傳上雲端」、沒有「這台」', async () => {
		await openLocal(new Uint8Array([7, 2, 3]), false);
		expect(screen.queryByRole('button', { name: /傳上雲端/ })).toBeNull();
		expect(screen.queryByText('這台')).toBeNull();
	});

	it('按了直接傳：變成一支新的雲端流程（我是擁有者、紀錄沒有記的人、音樂也上去了），打開的是雲端那支，這台的草稿沒了', async () => {
		const s = await openLocal(new Uint8Array([7, 2, 3]));
		expect(screen.getByText('這台')).toBeTruthy();
		expect(s.drafts.all.size).toBe(1);

		// 傳的時候：「傳上雲端中…」
		let go = () => {};
		const gate = new Promise<void>((r) => (go = r));
		const upload = s.server.uploadFlow;
		s.server.uploadFlow = async (doc) => {
			await gate;
			return upload(doc);
		};
		await fireEvent.click(screen.getByRole('button', { name: /傳上雲端/ }));
		expect(screen.getByRole('status').textContent).toBe('傳上雲端中…');
		go();
		await flush();
		await flush();

		expect(s.state.flows).toHaveLength(1);
		const made = s.state.flows[0];
		expect(made.owner).toBe(lin.email);
		expect(made.flow.name).toBe('練習用');
		expect(made.flow.actions[0].successRate!.records).toEqual([]);
		expect(made.records!.map((r) => [r.attempt.who, r.by])).toEqual([
			['g1', undefined],
			['g1', undefined],
			['g2', undefined]
		]);
		expect(made.audio).toEqual({ a1: new Uint8Array([7, 2, 3]) });

		// 打開的是雲端那支：有「分享」、沒有存檔、不寫「這台」
		expect(s.page.editor.file.cloudId).toBe(made.id);
		expect(screen.getByRole('button', { name: '分享' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: /存檔/ })).toBeNull();
		expect(screen.queryByText('這台')).toBeNull();
		expect(s.page.session.flow!.actions[0].successRate!.records).toHaveLength(3);
		expect(screen.getByRole('status').textContent).toBe(
			'傳上雲端了：現在開的是雲端那支，可以分享了。這台的草稿丟掉了，資料夾裡的流程檔沒動。'
		);
		await flush();
		expect(s.drafts.all.size).toBe(0);
	});

	it('同一個檔傳兩次：兩支', async () => {
		const s = await openLocal(new Uint8Array([7, 2, 3]));
		await fireEvent.click(screen.getByRole('button', { name: /傳上雲端/ }));
		await flush();
		await fireEvent.click(screen.getByRole('button', { name: '首頁' }));
		await flush();
		await openFile(writeFlowFile(localFlow(), { a1: new Uint8Array([7, 2, 3]) }));
		await fireEvent.click(screen.getByRole('button', { name: /傳上雲端/ }));
		await flush();
		expect(s.state.flows.map((f) => f.flow.name)).toEqual(['練習用', '練習用']);
		expect(new Set(s.state.flows.map((f) => f.id)).size).toBe(2);
	});

	it('有 72 MB 的音樂檔：擋下，跳框寫是哪一段、幾 MB；沒傳、還是本機流程', async () => {
		const s = await openLocal(new Uint8Array(72 * 1024 * 1024));
		await fireEvent.click(screen.getByRole('button', { name: /傳上雲端/ }));
		await flush();

		const dialog = screen.getByRole('dialog', { name: '傳不上去：音樂檔太大' });
		expect(dialog.textContent).toContain(
			'「音樂 1」的音樂檔 72 MB，一個音樂檔最多 60 MB。請轉成 mp3（3 分鐘約 3–7 MB），在流程設定換掉再傳。'
		);
		expect(s.state.flows).toEqual([]);
		expect(s.page.editor.file.cloudId).toBeNull();

		await fireEvent.click(within(dialog).getByRole('button', { name: '知道了' }));
		expect(screen.queryByRole('dialog', { name: '傳不上去：音樂檔太大' })).toBeNull();
		expect(screen.getByRole('button', { name: /存檔/ })).toBeTruthy();
	});

	it('連不上伺服器：沒傳，說原因，還是本機流程', async () => {
		const s = await openLocal(new Uint8Array([7, 2, 3]));
		s.state.unreachable = true;
		await fireEvent.click(screen.getByRole('button', { name: /傳上雲端/ }));
		await flush();
		expect(screen.getByRole('status').textContent).toBe('連不上伺服器，沒傳上雲端');
		expect(s.page.editor.file.cloudId).toBeNull();
		expect(s.drafts.all.size).toBe(1);
	});
});

/** 王教練的「練習用」（recordedFlow 加音樂；紀錄王教練記 2 次、從流程檔來的 1 次），林教練的權限是 role，開著分享連結。 */
function wangsFlow(role: 'owner' | 'editor' | 'recorder' | 'viewer'): FakeCloudFlow {
	const full = localFlow();
	const records = full.actions[0].successRate!.records.map((attempt, i) => ({
		actionId: 'x1',
		attempt,
		...(i < 2 ? { by: wang.email } : {})
	}));
	const flow = putRecords(full, []);
	return {
		id: 'c1',
		owner: role === 'owner' ? lin.email : wang.email,
		flow,
		updatedAt: new Date(2026, 10, 6, 15, 20).toISOString(),
		people: role === 'owner' ? { [wang.email]: 'editor' } : { [lin.email]: role },
		records,
		audio: { a1: new Uint8Array([5, 1]) },
		link: 'secretlinktoken'
	};
}

/** 林教練登入、從首頁打開「練習用」。 */
async function openCloud(flow: FakeCloudFlow) {
	const fake = fakeServer({ users: [lin, wang], signedIn: lin.email, flows: [flow] });
	const page = editorPage(null, { server: fake.server });
	render(Page, page.props);
	await flush();
	await fireEvent.click(screen.getByRole('button', { name: /^練習用/ }));
	await flush();
	return { ...fake, page };
}

describe('下載成流程檔', () => {
	it.each(['owner', 'editor'] as const)('%s：按「下載」存成流程檔，讀回來編排和紀錄一樣，沒有記的人、擁有者、權限、分享連結', async (role) => {
		const s = await openCloud(wangsFlow(role));
		await fromMenu('下載成流程檔');
		await flush();

		expect(s.page.saves).toHaveLength(1);
		const bytes = s.page.saves[0];
		const read = readFlowFile(bytes);
		expect(read.kind).toBe('ok');
		if (read.kind !== 'ok') return;
		expect(read.flow).toEqual(localFlow());
		expect(read.audio).toEqual({ a1: new Uint8Array([5, 1]) });
		const json = JSON.stringify(read.flow);
		for (const secret of [lin.email, wang.email, lin.name, wang.name, 'secretlinktoken', 'owner', 'editor']) {
			expect(json).not.toContain(secret);
		}
		expect(screen.getByRole('status').textContent).toContain('練習用.zip');
		// 下載的那份跟雲端流程不再有關係：還是開著雲端那支
		expect(s.page.editor.file.cloudId).toBe('c1');
	});

	it.each(['recorder', 'viewer'] as const)('%s：沒有「下載」', async (role) => {
		await openCloud(wangsFlow(role));
		expect(screen.getByRole('button', { name: '分享' })).toBeTruthy();
		expect(await menuItem('下載成流程檔')).toBeNull();
	});

	it('手機：沒有「下載」，只有回首頁', async () => {
		vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === NARROW_SCREEN }));
		await openCloud(wangsFlow('owner'));
		expect(screen.getByRole('button', { name: /回首頁/ })).toBeTruthy();
		expect(screen.queryByRole('button', { name: /下載/ })).toBeNull();
	});
});
