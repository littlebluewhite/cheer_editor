// 頁面：被新版擋住時（#368，#307 第 3 點）。伺服器只讓流程核心指紋一樣的人連進房間；對不上（被擋）時：
// 能看（照樣抓伺服器上最新的，從離線副本開的、斷線連回來才被擋的也換成最新的）、能記（存著當沒傳的，更新後再傳），
// 不能改、不能下載流程檔。伺服器、離線存放換成測試共用的假的（fakeServer 的 state.fingerprint 是伺服器的指紋）。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteAction } from '#lib/core';
import { CORE_FINGERPRINT } from '#lib/core-fingerprint.js';
import { editorPage, fakeOfflineStore, fakeServer, flush, fromMenu, menuItem, type FakeCloudFlow } from '#lib/test-fakes.js';
import { flowOf, libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

const pw = '我們這一隊今年一定會贏 go go';
const lin = { email: 'lin@example.com', name: '林教練', isAdmin: false, password: pw };
const wang = { email: 'wang@example.com', name: '王教練', isAdmin: false, password: pw };

/** 林教練的「測試」（libSample），王教練是編輯者。 */
const linsFlow = (): FakeCloudFlow => ({
	id: 'c1',
	owner: lin.email,
	flow: libSample(),
	updatedAt: new Date(2026, 10, 6, 15, 20).toISOString(),
	people: { [wang.email]: 'editor' },
	records: []
});

/** 等房間、離線存放的來回都跑完。 */
const settle = async () => {
	for (let i = 0; i < 6; i++) await flush();
};

/** 林教練登入、打開「測試」。offline：離線存放（同一個就像同一台）；fake：假伺服器（同一個就像同一個網站）。 */
async function open(offline = fakeOfflineStore(), fake = fakeServer({ users: [lin, wang], signedIn: lin.email, flows: [linsFlow()] })) {
	const page = editorPage(null, { server: fake.server, offline: offline.store });
	const view = render(Page, page.props);
	await settle();
	await fireEvent.click(screen.getByRole('button', { name: /^測試/ }));
	await settle();
	return { ...fake, page, offline, view };
}

/** 關掉網頁（重新整理前）。 */
function close(s: Awaited<ReturnType<typeof open>>) {
	s.page.session.open(null);
	s.view.unmount();
	document.body.innerHTML = '';
}

/** 練習頁記第 1 組小美一次（上法成功），按「存這一次」。 */
async function recordOne() {
	const card = within(screen.getByRole('region', { name: '第 1 組 小美' }));
	await fireEvent.click(screen.getByRole('button', { name: '第 1 組 小美 上法 成功' }));
	await fireEvent.click(card.getByRole('button', { name: '存這一次' }));
	await settle();
}

/** 提示條（練習的頁、日期那一排下面）的字。 */
const bars = () => [...document.querySelectorAll('.practice .bar')].map((b) => b.textContent!.replace(/\s+/g, ' ').trim());
/** 存在假伺服器上的紀錄（沒清掉的）。 */
const stored = (s: { state: { flows: FakeCloudFlow[] } }) => (s.state.flows[0].records ?? []).filter((r) => !r.gone);

afterEach(() => {
	vi.restoreAllMocks();
});

describe('被新版擋住時能看最新的', () => {
	it('打開時看到伺服器上最新的', async () => {
		const fake = fakeServer({ users: [lin, wang], signedIn: lin.email, flows: [linsFlow()] });
		fake.state.fingerprint = 'newer-core';
		fake.state.flows[0].flow.name = '測試（王教練改過）';
		const s = await open(fakeOfflineStore(), fake);
		expect(s.page.session.flow!.name).toBe('測試（王教練改過）');
		expect(s.page.editor.file.cloud!.newVersion).toBe(true);
	});

	it('開著時斷線、伺服器換了新版：連回來被擋，換成伺服器上最新的', async () => {
		const s = await open();
		s.disconnect();
		await settle();
		s.state.flows[0].flow.name = '王教練改的名字';
		s.state.fingerprint = 'newer-core';
		const fetched = vi.spyOn(s.server, 'cloudFlow');
		s.reconnect();
		await settle();
		expect(s.page.session.flow!.name).toBe('王教練改的名字');
		expect(s.page.editor.file.cloud!.newVersion).toBe(true);
		expect(document.querySelector('.field-host')!.textContent).toContain('有新版，請重新整理');
		// 換上的那支打招呼也被擋，不會一直再抓
		await settle();
		expect(fetched).toHaveBeenCalledTimes(1);
	});

	it('斷線時改的步沒送到就被擋：換成最新的，說那幾步沒存進去', async () => {
		const s = await open();
		s.state.holdRoom = true;
		await fromMenu('流程設定');
		await fireEvent.change(screen.getByLabelText('流程名字'), { target: { value: '我改的名字' } });
		await fireEvent.click(screen.getByRole('button', { name: '關閉' }));
		await settle();
		s.disconnect();
		await settle();
		s.state.holdRoom = false;
		s.state.fingerprint = 'newer-core';
		s.reconnect();
		await settle();
		expect(s.page.session.flow!.name).toBe('測試');
		expect(s.page.session.notice).toContain('還沒送到的 1 步沒存進去');
		expect(s.page.editor.file.cloud!.unsent).toBe(0);
	});

	it('打開後、伺服器說有新版前改了：換回伺服器上的，說那一步沒存進去', async () => {
		const fake = fakeServer({ users: [lin, wang], signedIn: lin.email, flows: [linsFlow()] });
		fake.state.fingerprint = 'newer-core';
		fake.state.holdRoom = true;
		const s = await open(fakeOfflineStore(), fake);
		await fromMenu('流程設定');
		await fireEvent.change(screen.getByLabelText('流程名字'), { target: { value: '我改的名字' } });
		await fireEvent.click(screen.getByRole('button', { name: '關閉' }));
		await settle();
		s.releaseRoom();
		await settle();
		expect(s.page.session.flow!.name).toBe('測試');
		expect(s.page.session.notice).toContain('還沒送到的 1 步沒存進去');
		expect(s.page.editor.file.cloud!.unsent).toBe(0);
	});

	it('練習頁點了記號還沒存，斷線連回來被擋：點的還在，存了算沒傳的', async () => {
		const offline = fakeOfflineStore();
		const s = await open(offline);
		await fireEvent.click(screen.getByRole('button', { name: '練習' }));
		await fireEvent.click(screen.getByRole('button', { name: '第 1 組 小美 上法 成功' }));
		s.disconnect();
		await settle();
		s.state.fingerprint = 'newer-core';
		s.reconnect();
		await settle();
		expect(s.page.editor.file.cloud!.newVersion).toBe(true);
		const card = within(screen.getByRole('region', { name: '第 1 組 小美' }));
		await fireEvent.click(card.getByRole('button', { name: '存這一次' }));
		await settle();
		expect(offline.of('c1')!.records.map((r) => r.record.attempt.marks)).toEqual([{ p1: '✓' }]);
		expect(stored(s)).toEqual([]);
	});

	it('從離線副本打開，連上時被擋：換成伺服器上最新的', async () => {
		const offline = fakeOfflineStore();
		const fake = fakeServer({ users: [lin, wang], signedIn: lin.email, flows: [linsFlow()] });
		close(await open(offline, fake));
		vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
		fake.network('offline');
		const s = await open(offline, fake);
		expect(s.page.editor.file.source.kind).toBe('offline');

		fake.state.flows[0].flow.name = '王教練改的名字';
		fake.state.fingerprint = 'newer-core';
		vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
		fake.network('online');
		window.dispatchEvent(new Event('online'));
		await settle();
		expect(s.page.editor.file.source.kind).toBe('cloud');
		expect(s.page.session.flow!.name).toBe('王教練改的名字');
		expect(s.page.editor.file.cloud!.newVersion).toBe(true);
	});
});

/** 換成最新的時讀音樂先停著（換上之前那一段），回傳讓它讀完的。 */
function holdMusic(s: Awaited<ReturnType<typeof open>>) {
	const read = s.page.editor.readMusic.bind(s.page.editor);
	const gate = Promise.withResolvers<void>();
	vi.spyOn(s.page.editor, 'readMusic').mockImplementationOnce(async (audio) => {
		await gate.promise;
		return read(audio);
	});
	return gate.resolve;
}

/** 開著時斷線、伺服器換了新版，連回來被擋（換成最新的那支還在讀音樂）。 */
async function staleWhileLoading(s: Awaited<ReturnType<typeof open>>, disconnect = true) {
	if (disconnect) {
		s.disconnect();
		await settle();
	}
	s.state.fingerprint = 'newer-core';
	const release = holdMusic(s);
	s.reconnect();
	await settle();
	return release;
}

describe('換成最新的時', () => {
	it('換的時候在讀音樂、這時回首頁了：讀完不再打開那支', async () => {
		const s = await open();
		const release = await staleWhileLoading(s);
		s.page.session.open(null);
		await settle();
		release();
		await settle();
		expect(s.page.session.flow).toBeNull();
	});

	it('斷線時改的步沒送到就被擋、換的時候在讀音樂，這時回首頁了：不說那幾步沒存進去', async () => {
		const s = await open();
		s.state.holdRoom = true;
		await fromMenu('流程設定');
		await fireEvent.change(screen.getByLabelText('流程名字'), { target: { value: '我改的名字' } });
		await fireEvent.click(screen.getByRole('button', { name: '關閉' }));
		await settle();
		s.disconnect();
		await settle();
		s.state.holdRoom = false;
		const release = await staleWhileLoading(s, false);
		s.page.session.open(null);
		await settle();
		release();
		await settle();
		expect(s.page.session.notice ?? '').not.toContain('沒存進去');
	});

	it('換的時候在讀音樂、這時記了一次，換上後又記一次：兩次都留在這台', async () => {
		const offline = fakeOfflineStore();
		const s = await open(offline);
		await fireEvent.click(screen.getByRole('button', { name: '練習' }));
		const release = await staleWhileLoading(s);
		await recordOne();
		release();
		await settle();
		await recordOne();
		expect(offline.of('c1')!.records).toHaveLength(2);
	});

	it('換的時候在讀音樂、這個分頁沒有沒傳的，別的分頁記了一次：換上後這邊再記一次，別的分頁記的那次還在這台', async () => {
		const offline = fakeOfflineStore();
		const s = await open(offline);
		await fireEvent.click(screen.getByRole('button', { name: '練習' }));
		const release = await staleWhileLoading(s);
		// 別的分頁（同一台）記的：存進這台
		await offline.store.saveUnsent({
			flowId: 'c1',
			flowName: '測試',
			records: [
				{
					record: { actionId: 'x1', attempt: { id: 'tothertab0001', date: '2026-11-07', who: 'g1', practice: 'drill', whole: true, marks: { p1: '✓' } } },
					row: { id: 'tothertab0001', date: '2026-11-07', action: '技巧·Lib', who: '第 1 組 小美', marks: '✓··', runThrough: false }
				}
			],
			amends: [],
			dropped: []
		});
		release();
		await settle();
		await recordOne();
		expect(offline.of('c1')!.records.map((r) => r.record.attempt.id)).toContain('tothertab0001');
		expect(offline.of('c1')!.records).toHaveLength(2);
	});

	it('換的時候在讀音樂、這個分頁記了一次，別的分頁也記了一次：兩邊的合起來，換上後再記一次，三次都在這台', async () => {
		const offline = fakeOfflineStore();
		const s = await open(offline);
		await fireEvent.click(screen.getByRole('button', { name: '練習' }));
		const release = await staleWhileLoading(s);
		await recordOne();
		// 別的分頁（同一台）存的：蓋掉這台存著的，只剩它記的那次
		await offline.store.saveUnsent({
			flowId: 'c1',
			flowName: '測試',
			records: [
				{
					record: { actionId: 'x1', attempt: { id: 'tothertab0001', date: '2026-11-07', who: 'g1', practice: 'drill', whole: true, marks: { p1: '✓' } } },
					row: { id: 'tothertab0001', date: '2026-11-07', action: '技巧·Lib', who: '第 1 組 小美', marks: '✓··', runThrough: false }
				}
			],
			amends: [],
			dropped: []
		});
		release();
		await settle();
		await recordOne();
		expect(offline.of('c1')!.records.map((r) => r.record.attempt.id)).toContain('tothertab0001');
		expect(offline.of('c1')!.records).toHaveLength(3);
	});


	it('連回來被擋、換上的那支打招呼還沒回：照樣不能改、不能下載流程檔', async () => {
		const s = await open();
		const before = s.page.editor.file.cloud;
		s.disconnect();
		await settle();
		s.state.fingerprint = 'newer-core';
		s.state.holdRoom = true;
		s.reconnect();
		await settle();
		// 舊的那支打招呼被擋（換成最新的）；換上的那支打招呼留著不回
		s.releaseRoom(true);
		await settle();
		expect(s.page.editor.file.cloud).not.toBe(before);
		expect(s.page.editor.file.cloud!.newVersion).toBe(true);
		expect(s.page.session.viewing).toBe(true);
		expect(await menuItem('下載成流程檔')).toBeNull();
	});

	it('連回來被擋、換上的那支打招呼前伺服器換回舊版、讓它進來：可以改、可以下載流程檔', async () => {
		const s = await open();
		s.disconnect();
		await settle();
		s.state.fingerprint = 'newer-core';
		s.state.holdRoom = true;
		s.reconnect();
		await settle();
		// 舊的那支打招呼被擋的回答到之前，伺服器換回舊版（指紋對上了）：換上的那支打招呼被收（回答先留著）
		s.state.fingerprint = CORE_FINGERPRINT;
		s.releaseRoom(true);
		await settle();
		expect(s.page.editor.file.cloud!.newVersion).toBe(true);
		s.releaseRoom();
		await settle();
		expect(s.page.editor.file.cloud!.newVersion).toBe(false);
		expect(s.page.session.viewing).toBe(false);
		expect(await menuItem('下載成流程檔')).not.toBeNull();
	});
});

describe('被新版擋住時能記，更新後自動傳', () => {
	it('記的存著、寫「沒傳」；重新整理（指紋對上）以後自動傳上去，只有一筆', async () => {
		const offline = fakeOfflineStore();
		const fake = fakeServer({ users: [lin, wang], signedIn: lin.email, flows: [linsFlow()] });
		fake.state.fingerprint = 'newer-core';
		const s = await open(offline, fake);
		await fireEvent.click(screen.getByRole('button', { name: '練習' }));
		expect(bars()).toEqual(['有新版：記的先存著，更新後自動傳。']);

		await recordOne();
		expect(bars()).toEqual(['有新版：還有 1 筆沒傳，更新後自動傳。']);
		expect(offline.of('c1')!.records).toHaveLength(1);
		expect(stored(s)).toEqual([]);

		close(s);
		fake.state.fingerprint = CORE_FINGERPRINT;
		const again = await open(offline, fake);
		expect(stored(again).map((r) => r.attempt.marks)).toEqual([{ p1: '✓' }]);
		expect(offline.of('c1')).toBeNull();
		// 再打開一次也不會再傳一次
		close(again);
		await open(offline, fake);
		expect(stored(again)).toHaveLength(1);
	});

	it('記到的動作在更新前被刪掉了：那一次照樣丟掉，列進沒存進去的', async () => {
		const offline = fakeOfflineStore();
		const fake = fakeServer({ users: [lin, wang], signedIn: lin.email, flows: [linsFlow()] });
		fake.state.fingerprint = 'newer-core';
		const s = await open(offline, fake);
		await fireEvent.click(screen.getByRole('button', { name: '練習' }));
		await recordOne();
		close(s);

		fake.state.flows[0].flow = flowOf(deleteAction(fake.state.flows[0].flow, 'x1', { confirmed: true }));
		fake.state.fingerprint = CORE_FINGERPRINT;
		const again = await open(offline, fake);
		await fireEvent.click(screen.getByRole('button', { name: '練習' }));
		await settle();
		expect(stored(again)).toEqual([]);
		expect(document.querySelector('.practice .dropped')!.textContent).toContain('第 1 組 小美');
	});

	it('檢視者被擋時照樣不能記', async () => {
		const flow = { ...linsFlow(), owner: wang.email, people: { [lin.email]: 'viewer' as const } };
		const fake = fakeServer({ users: [lin, wang], signedIn: lin.email, flows: [flow] });
		fake.state.fingerprint = 'newer-core';
		const s = await open(fakeOfflineStore(), fake);
		expect(s.page.session.practice.cannotRecord).not.toBe('');
	});
});

describe('被新版擋住時不能改、不能下載流程檔', () => {
	it('選單沒有「下載成流程檔」；指紋對上時有', async () => {
		const offline = fakeOfflineStore();
		const fake = fakeServer({ users: [lin, wang], signedIn: lin.email, flows: [linsFlow()] });
		fake.state.fingerprint = 'newer-core';
		const s = await open(offline, fake);
		expect(s.page.session.viewing).toBe(true);
		expect(await menuItem('下載成流程檔')).toBeNull();

		close(s);
		fake.state.fingerprint = CORE_FINGERPRINT;
		await open(offline, fake);
		expect(await menuItem('下載成流程檔')).not.toBeNull();
	});
});
