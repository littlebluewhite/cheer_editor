// 頁面：本機流程「☁ 傳上雲端」、雲端流程「⤓ 下載」（#259）。
// 傳上雲端＝搬過去：變成一支新的雲端流程（傳的人是擁有者），打開雲端那支、丟掉這台的草稿；音樂檔超過 60 MB 擋下跳框。
// 下載：擁有者、編輯者才有，手機沒有；包成流程檔，帶紀錄、不帶記的人、擁有者、權限、分享連結。
// 伺服器換成測試共用的假伺服器（fakeServer）。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSegmentAudio, putRecords, readFlowFile, renameFlow, writeFlowFile, type Flow } from '#lib/core';
import { NARROW_SCREEN } from '#lib/editor-layout.js';
import { createBrowserSaver } from '#lib/file/save.js';
import { ServerUnreachable } from '#lib/server-api.js';
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

	/** 按「傳上雲端」，音樂檔傳到一半停著：回傳讓它傳完的。 */
	async function uploadHeld(s: Awaited<ReturnType<typeof openLocal>>) {
		let go = () => {};
		const gate = new Promise<void>((r) => (go = r));
		const uploadAudio = s.server.uploadAudio;
		s.server.uploadAudio = async (...args) => {
			await gate;
			return uploadAudio(...args);
		};
		await fireEvent.click(screen.getByRole('button', { name: /傳上雲端/ }));
		await flush();
		return async () => {
			go();
			await flush();
			await flush();
		};
	}

	const CHANGED = '傳上雲端了，但傳的時候流程又改了：這台的草稿留著，雲端那支沒有剛剛的修改（回首頁從「我的流程」打開）';

	it('upload keeps edits made during upload：傳音樂的時候改了，還是本機流程、改的留著，草稿沒丟', async () => {
		const s = await openLocal(new Uint8Array([7, 2, 3]));
		const done = await uploadHeld(s);
		s.page.session.ask.send({ name: 'renameFlow', args: ['全國賽'] });
		await flush();
		await done();

		expect(s.state.flows).toHaveLength(1);
		expect(s.page.editor.file.cloudId).toBeNull();
		expect(s.page.session.flow!.name).toBe('全國賽');
		expect(s.drafts.all.size).toBe(1);
		expect(screen.getByRole('status').textContent).toBe(CHANGED);
	});

	it('upload keeps edits made while opening the cloud copy：傳好、打開雲端那支的時候改了，還是本機流程、改的留著', async () => {
		const s = await openLocal(new Uint8Array([7, 2, 3]));
		let go = () => {};
		const gate = new Promise<void>((r) => (go = r));
		const cloudFlow = s.server.cloudFlow;
		s.server.cloudFlow = async (id) => {
			await gate;
			return cloudFlow(id);
		};
		await fireEvent.click(screen.getByRole('button', { name: /傳上雲端/ }));
		await flush();
		expect(s.state.flows).toHaveLength(1);
		s.page.session.ask.send({ name: 'renameFlow', args: ['全國賽'] });
		await flush();
		go();
		await flush();
		await flush();

		expect(s.page.editor.file.cloudId).toBeNull();
		expect(s.page.session.flow!.name).toBe('全國賽');
		expect(s.drafts.all.size).toBe(1);
		expect(screen.getByRole('status').textContent).toBe(CHANGED);
	});

	it('upload keeps text typed while opening the cloud copy：傳好、打開雲端那支的時候在欄位裡打字還沒送出，還是本機流程、打的字進流程、草稿沒丟', async () => {
		const s = await openLocal(new Uint8Array([7, 2, 3]));
		await fireEvent.click(document.querySelector('[data-lane="m1"] [data-action-id="x1"]')!);
		let go = () => {};
		const gate = new Promise<void>((r) => (go = r));
		const cloudFlow = s.server.cloudFlow;
		s.server.cloudFlow = async (id) => {
			await gate;
			return cloudFlow(id);
		};
		await fireEvent.click(screen.getByRole('button', { name: /傳上雲端/ }));
		await flush();
		expect(s.state.flows).toHaveLength(1);
		const name = screen.getByLabelText('名稱') as HTMLInputElement;
		name.focus();
		await fireEvent.input(name, { target: { value: '大托舉' } });
		go();
		await flush();
		await flush();

		expect(s.page.editor.file.cloudId).toBeNull();
		expect(s.page.session.flow!.actions[0].name).toBe('大托舉');
		expect(s.drafts.all.size).toBe(1);
		expect(screen.getByRole('status').textContent).toBe(CHANGED);
	});

	it('upload keeps a draft opened during upload：傳音樂的時候開了別的檔，開著的不換掉、它的草稿不清', async () => {
		const s = await openLocal(new Uint8Array([7, 2, 3]));
		const done = await uploadHeld(s);
		const other = flowOf(renameFlow(localFlow(), '區賽'));
		await openFile(writeFlowFile(other, { a1: new Uint8Array([7, 2, 3]) }));
		await flush();
		const drafts = [...s.drafts.all.keys()];
		await done();

		expect(s.page.editor.file.cloudId).toBeNull();
		expect(s.page.session.flow!.name).toBe('區賽');
		expect([...s.drafts.all.keys()]).toEqual(drafts);
		expect(screen.getByRole('status').textContent).toBe(CHANGED);
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

	/** 王教練（在別的地方）把音樂 1 換成新的音樂檔：伺服器上的流程和音樂檔都換了，這個分頁沒拿過。 */
	function replaceTrack(s: Awaited<ReturnType<typeof openCloud>>, bytes: Uint8Array) {
		const f = s.state.flows[0];
		const r = loadSegmentAudio(f.flow, 's1', '新歌.mp3');
		if (r.kind !== 'ok') throw new Error(r.kind);
		f.flow = r.flow;
		f.audio = { ...f.audio, [r.audioId]: bytes };
		return r.audioId;
	}

	it('export fetches a track not cached here：別人換了音樂，下載的流程檔帶著新的音樂檔', async () => {
		const s = await openCloud(wangsFlow('owner'));
		const id = replaceTrack(s, new Uint8Array([9, 9, 9]));
		await fromMenu('下載成流程檔');
		await flush();

		expect(s.page.saves).toHaveLength(1);
		const read = readFlowFile(s.page.saves[0]);
		expect(read.kind).toBe('ok');
		if (read.kind !== 'ok') return;
		expect(read.audio[id]).toEqual(new Uint8Array([9, 9, 9]));
	});

	it('export asks where to save before fetching：Chrome 按下去之後跟伺服器拿東西太久，存檔對話框就不能跳；先問存到哪再拿，照樣存下來', async () => {
		vi.stubGlobal('matchMedia', () => ({ matches: false }));
		// 按「下載」算使用者的動作；等過伺服器（慢的音樂檔）就過期了，那之後 showSaveFilePicker 被擋（Chrome 丟 SecurityError）
		let active = false;
		const written: Uint8Array[] = [];
		vi.stubGlobal('showSaveFilePicker', async ({ suggestedName }: { suggestedName: string }) => {
			if (!active) throw new DOMException('Must be handling a user gesture to show a file picker.', 'SecurityError');
			return {
				name: suggestedName,
				createWritable: async () => ({ write: async (b: Uint8Array) => void written.push(b), close: async () => {} })
			};
		});
		const fake = fakeServer({ users: [lin, wang], signedIn: lin.email, flows: [wangsFlow('owner')] });
		const page = editorPage(null, { server: fake.server, createSaver: () => createBrowserSaver() });
		render(Page, page.props);
		await flush();
		await fireEvent.click(screen.getByRole('button', { name: /^練習用/ }));
		await flush();
		const id = replaceTrack({ ...fake, page }, new Uint8Array([9, 9, 9]));
		const audioBytes = fake.server.audioBytes;
		fake.server.audioBytes = async (...args) => {
			const bytes = await audioBytes(...args);
			active = false;
			return bytes;
		};
		active = true;
		await fromMenu('下載成流程檔');
		await flush();

		expect(written).toHaveLength(1);
		const read = readFlowFile(written[0]);
		expect(read.kind).toBe('ok');
		if (read.kind !== 'ok') return;
		expect(read.audio[id]).toEqual(new Uint8Array([9, 9, 9]));
		expect(screen.getByRole('status').textContent).toContain('練習用.zip');
	});

	it('export failing after choosing a file says the file is now empty：Chrome 選了舊檔當下就清空，拿不到東西時要說選的檔變空的', async () => {
		vi.stubGlobal('matchMedia', () => ({ matches: false }));
		const backup: { name: string; isSameEntry(o: unknown): Promise<boolean>; createWritable(): Promise<unknown> } = {
			name: '上週備份.zip',
			isSameEntry: async (o) => o === backup,
			createWritable: async () => ({ write: async () => {}, close: async () => {} })
		};
		vi.stubGlobal('showSaveFilePicker', async () => backup);
		const fake = fakeServer({ users: [lin, wang], signedIn: lin.email, flows: [wangsFlow('owner')] });
		const page = editorPage(null, { server: fake.server, createSaver: () => createBrowserSaver() });
		render(Page, page.props);
		await flush();
		await fireEvent.click(screen.getByRole('button', { name: /^練習用/ }));
		await flush();
		replaceTrack({ ...fake, page }, new Uint8Array([9, 9, 9]));
		fake.server.audioBytes = async () => {
			throw new ServerUnreachable();
		};
		await fromMenu('下載成流程檔');
		await flush();

		expect(screen.getByRole('status').textContent).toBe('連不上伺服器，沒下載；選的「上週備份.zip」已經變成空的檔案，請再下載一次');
	});

	it('a failed export does not call the file empty after a later export saved it：同一個檔下載兩次，後一次存好了、前一次才失敗，不說那個檔變空的', async () => {
		vi.stubGlobal('matchMedia', () => ({ matches: false }));
		const backup: { name: string; isSameEntry(o: unknown): Promise<boolean>; createWritable(): Promise<unknown> } = {
			name: '上週備份.zip',
			isSameEntry: async (o) => o === backup,
			createWritable: async () => ({ write: async () => {}, close: async () => {} })
		};
		vi.stubGlobal('showSaveFilePicker', async () => backup);
		const fake = fakeServer({ users: [lin, wang], signedIn: lin.email, flows: [wangsFlow('owner')] });
		const page = editorPage(null, { server: fake.server, createSaver: () => createBrowserSaver() });
		render(Page, page.props);
		await flush();
		await fireEvent.click(screen.getByRole('button', { name: /^練習用/ }));
		await flush();
		replaceTrack({ ...fake, page }, new Uint8Array([9, 9, 9]));
		const audioBytes = fake.server.audioBytes;
		let fail = () => {};
		let calls = 0;
		fake.server.audioBytes = async (...args) => {
			if (++calls === 1) await new Promise<void>((_, reject) => (fail = () => reject(new ServerUnreachable())));
			return audioBytes(...args);
		};
		await fromMenu('下載成流程檔');
		await flush();
		await fromMenu('下載成流程檔');
		await flush();
		expect(screen.getByRole('status').textContent).toContain('上週備份.zip');

		fail();
		await flush();

		expect(screen.getByRole('status').textContent).toBe('連不上伺服器，沒下載');
	});

	/** 雲端流程開著，每次存檔對話框選 picks 裡的下一個檔；第 1、2 次下載拿音樂卡住，fails[0]、fails[1] 讓它失敗。 */
	async function exportsTo(picks: { name: string; dir: string }[]) {
		vi.stubGlobal('matchMedia', () => ({ matches: false }));
		const handles = picks.map((p) => ({
			...p,
			isSameEntry: async (o: unknown) => (o as typeof p).dir === p.dir && (o as typeof p).name === p.name,
			createWritable: async () => ({ write: async () => {}, close: async () => {} })
		}));
		let n = 0;
		vi.stubGlobal('showSaveFilePicker', async () => handles[n++]);
		const fake = fakeServer({ users: [lin, wang], signedIn: lin.email, flows: [wangsFlow('owner')] });
		const page = editorPage(null, { server: fake.server, createSaver: () => createBrowserSaver() });
		render(Page, page.props);
		await flush();
		await fireEvent.click(screen.getByRole('button', { name: /^練習用/ }));
		await flush();
		replaceTrack({ ...fake, page }, new Uint8Array([9, 9, 9]));
		const audioBytes = fake.server.audioBytes;
		const fails: (() => void)[] = [];
		const oks: (() => void)[] = [];
		let calls = 0;
		fake.server.audioBytes = async (...args) => {
			if (++calls <= picks.length)
				await new Promise<void>((ok, reject) => {
					fails.push(() => reject(new ServerUnreachable()));
					oks.push(ok);
				});
			return audioBytes(...args);
		};
		for (let i = 0; i < picks.length; i++) {
			await fromMenu('下載成流程檔');
			await flush();
		}
		return { fails, oks };
	}

	it('a failed export still warns when a later export saved a same-named file elsewhere：A、B 兩個資料夾都有「備份.zip」，存 B 的成功、存 A 的失敗，還是說 A 的變空了', async () => {
		const { fails, oks } = await exportsTo([
			{ name: '備份.zip', dir: 'A' },
			{ name: '備份.zip', dir: 'B' }
		]);
		oks[1]();
		await flush();
		fails[0]();
		await flush();

		expect(screen.getByRole('status').textContent).toContain('「備份.zip」已經變成空的檔案');
	});

	it('both exports to one file fail newer first, the older failure still warns：同一個檔下載兩次都失敗，後一次先失敗，前一次失敗還是說那個檔變空的', async () => {
		const { fails } = await exportsTo([
			{ name: '備份.zip', dir: 'A' },
			{ name: '備份.zip', dir: 'A' }
		]);
		fails[1]();
		await flush();
		fails[0]();
		await flush();

		expect(screen.getByRole('status').textContent).toContain('「備份.zip」已經變成空的檔案');
	});

	it('a failed export does not warn when an export chosen before it saved afterwards：同一個檔下載三次，第一次存好了、第二次失敗、第三次還在等，不說那個檔變空的', async () => {
		const same = { name: '備份.zip', dir: 'A' };
		const { fails, oks } = await exportsTo([same, same, same]);
		oks[0]();
		await flush();
		fails[1]();
		await flush();

		expect(screen.getByRole('status').textContent).not.toContain('變成空的檔案');
		expect(screen.getByRole('status').textContent).toContain('連不上伺服器');
	});

	it('export fails when a track not cached here is unreachable：拿不到別人換的音樂，不存、說原因', async () => {
		const s = await openCloud(wangsFlow('owner'));
		replaceTrack(s, new Uint8Array([9, 9, 9]));
		s.server.audioBytes = async () => {
			throw new ServerUnreachable();
		};
		await fromMenu('下載成流程檔');
		await flush();

		expect(s.page.saves).toHaveLength(0);
		expect(screen.getByRole('status').textContent).toBe('連不上伺服器，沒下載');
	});
});
