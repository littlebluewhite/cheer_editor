// 頁面：離線副本（#261，#187、#192 的結論）。登入的人打開過的雲端流程這台留一份（含音樂），留最近打開的 5 支（有沒傳紀錄的不刪）；
// 斷網的首頁只列離線副本；斷網打開離線副本是檢視模式、能播放、能記、編輯按不了、灰條；登出清掉；連上後發現被收回、被刪掉就刪掉那份。
// 伺服器、離線存放換成測試共用的假的（fakeServer 的 network() 換網路，fakeOfflineStore 存在記憶體）；瀏覽器的有沒有網路用 testEditor 的 net。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSegmentAudio, writeFlowFile, type StoredAttempt } from '#lib/core';
import { NARROW_SCREEN } from '#lib/editor-layout.js';
import { localDate } from '#lib/local-date.js';
import type { UnsentRecords } from '#lib/offline-store.js';
import { editorPage, fakeDraftStore, fakeOfflineStore, fakeServer, flush, type FakeCloudFlow } from '#lib/test-fakes.js';
import { flowOf, libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

const pw = '我們這一隊今年一定會贏 go go';
const lin = { email: 'lin@example.com', name: '林教練', isAdmin: false, password: pw };
const wang = { email: 'wang@example.com', name: '王教練', isAdmin: false, password: pw };

/** 一支雲端流程（libSample 改名字），林教練是 role（擁有者就是林教練的）。 */
const cloudFlow = (id: string, name: string, role: 'owner' | 'recorder' = 'owner', audio?: Record<string, Uint8Array>): FakeCloudFlow => {
	const flow = libSample();
	flow.name = name;
	return {
		id,
		owner: role === 'owner' ? lin.email : wang.email,
		flow,
		updatedAt: new Date(2026, 10, 6, 15, 20).toISOString(),
		...(role !== 'owner' && { people: { [lin.email]: role } }),
		...(audio && { audio })
	};
};

/** 這台還有 n 筆沒傳的（第 1 組小美上法成功）。 */
function unsentOf(flowId: string, flowName: string, n: number): UnsentRecords {
	const records = Array.from({ length: n }, (_, i) => {
		const id = `t${flowId}000000000${i}`.slice(0, 13);
		const record: StoredAttempt = { actionId: 'x1', attempt: { id, date: localDate(), who: 'g1', practice: 'drill', whole: true, marks: { p1: '✓' } } };
		return { record, row: { id, date: localDate(), action: '技巧·Lib', who: '第 1 組 小美', marks: '✓··', runThrough: false } };
	});
	return { flowId, flowName, records, amends: [], dropped: [] };
}

/** 等房間、離線存放的來回都跑完。 */
const settle = async () => {
	for (let i = 0; i < 6; i++) await flush();
};

/** 林教練登入、在首頁（offline：離線存放，同一個就像同一台電腦）。 */
function home(flows: FakeCloudFlow[], offline = fakeOfflineStore(), fake = fakeServer({ users: [lin, wang], signedIn: lin.email, flows })) {
	const page = editorPage(null, { server: fake.server, offline: offline.store });
	const view = render(Page, page.props);
	return { ...fake, page, offline, view };
}

/** 首頁點一支流程打開。 */
async function openFromHome(name: string) {
	await fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));
	await settle();
}

/** 回首頁。 */
async function goHome() {
	await fireEvent.click(screen.getByRole('button', { name: '首頁' }));
	await settle();
}

/** 換網路（假伺服器的開關，瀏覽器說的跟著換），等跑完。 */
async function network(s: Pick<ReturnType<typeof home>, 'network'>, status: 'online' | 'offline') {
	s.network(status);
	await settle();
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('打開過的雲端流程這台留一份', () => {
	it('打開雲端流程：留一份（編排、紀錄、音樂）；第 6 支進來刪最舊的', async () => {
		const flows = [1, 2, 3, 4, 5, 6].map((i) => cloudFlow(`c${i}`, `流程${i}`));
		flows[0].flow.audio = [{ id: 'a1', file: 'audio/a1.mp3', name: 'song.mp3' }];
		flows[0].audio = { a1: new Uint8Array([1, 2, 3]) };
		const s = home(flows);
		await settle();

		await openFromHome('流程1');
		const copy = s.offline.copy('c1');
		expect(copy?.name).toBe('流程1');
		expect([...(s.offline.audioOf('c1')?.a1 ?? [])]).toEqual([1, 2, 3]);

		for (const i of [2, 3, 4, 5]) {
			await goHome();
			await openFromHome(`流程${i}`);
		}
		expect(s.offline.copyIds()).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
		await goHome();
		await openFromHome('流程6');
		expect(s.offline.copyIds()).toEqual(['c2', 'c3', 'c4', 'c5', 'c6']);
	});

	it('開著的時候換成最新的：別人改了，停手 1 秒後這台的那份跟著換', async () => {
		const flows = [cloudFlow('c1', '流程1', 'recorder')];
		const s = home(flows);
		await settle();
		await openFromHome('流程1');
		vi.useFakeTimers();
		s.joinAs('c1', wang.email).step({ name: 'renameFlow', args: ['全國賽'] });
		await vi.advanceTimersByTimeAsync(1100);
		vi.useRealTimers();
		await settle();
		const copy = s.offline.copy('c1')!;
		expect(copy.name).toBe('全國賽');
		expect(copy.step).toBe(1);
	});

	it('有紀錄還沒傳的那支不刪', async () => {
		const flows = [1, 2, 3, 4, 5, 6].map((i) => cloudFlow(`c${i}`, `流程${i}`));
		const s = home(flows, fakeOfflineStore({ unsent: [unsentOf('c1', '流程1', 1)] }));
		s.state.link = 'offline';
		await settle();
		for (const i of [1, 2, 3, 4, 5, 6]) {
			if (i > 1) await goHome();
			await openFromHome(`流程${i}`);
		}
		expect(s.offline.copyIds()).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
	});

	it('用分享連結看的不留', async () => {
		const f = cloudFlow('c1', '流程1');
		f.link = 'share-1';
		const fake = fakeServer({ users: [lin, wang], signedIn: null, flows: [f] });
		const offline = fakeOfflineStore();
		const page = editorPage(null, { server: fake.server, offline: offline.store });
		location.hash = '#share=share-1';
		render(Page, page.props);
		await settle();
		location.hash = '';
		expect(page.session.flow?.name).toBe('流程1');
		expect(offline.copyIds()).toEqual([]);
	});
});

/** 林教練打開過「流程1」（自己的）、「王教練的流程」（記錄者），「流程3」沒打開過；11/6 15:20 存的。回到首頁。 */
async function openedTwo() {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date(2026, 10, 6, 15, 20));
	const flows = [cloudFlow('c1', '流程1'), cloudFlow('c2', '王教練的流程', 'recorder'), cloudFlow('c3', '流程3')];
	const s = home(flows);
	await settle();
	await openFromHome('流程1');
	await goHome();
	await openFromHome('王教練的流程');
	await goHome();
	vi.useRealTimers();
	return s;
}

/** 斷網，再打開網頁（同一台：同一個離線存放）。 */
async function reloadOffline(s: Awaited<ReturnType<typeof openedTwo>>) {
	s.view.unmount();
	s.network('offline');
	const page = editorPage(null, { server: s.server, offline: s.offline.store });
	const view = render(Page, page.props);
	await settle();
	return { ...s, page, view };
}

describe('斷網的首頁', () => {
	const rows = () =>
		[...screen.getByRole('region', { name: '雲端' }).querySelectorAll('li')].map((li) => li.textContent!.replace(/\s+/g, ' ').trim());

	it('有網路時：有離線副本的那一列右邊「離線可開」', async () => {
		await openedTwo();
		expect(rows()).toEqual(['流程1 11/6 15:20 改過 離線可開', '流程3 11/6 15:20 改過', '王教練的流程 王教練的・記錄者・11/6 15:20 改過 離線可開']);
	});

	it('斷網再打開網頁：雲端那塊上面一條灰的、只列離線副本（時間換成這台的樣子）、最下面還有幾支看不到', async () => {
		await reloadOffline(await openedTwo());
		const cloud = screen.getByRole('region', { name: '雲端' });
		expect(cloud.textContent).toContain('沒有網路：只列這台留著的（離線副本），能看、記成功率，不能改。');
		expect(rows()).toEqual(['流程1 這台的是 11/6 15:20 的樣子 離線可開', '王教練的流程 這台的是 11/6 15:20 的樣子 離線可開']);
		expect(cloud.textContent).toContain('還有 1 支雲端流程，連上網路才看得到。');
		expect(screen.getByRole('button', { name: '林教練 ▾' })).toBeTruthy();
	});

	it('在首頁時斷網：一樣只列離線副本；連上又列全部', async () => {
		const s = await openedTwo();
		await network(s, 'offline');
		expect(rows()).toEqual(['流程1 這台的是 11/6 15:20 的樣子 離線可開', '王教練的流程 這台的是 11/6 15:20 的樣子 離線可開']);
		await network(s, 'online');
		expect(rows()).toHaveLength(3);
	});
});

describe('斷網打開離線副本', () => {
	const GREY = '沒有網路，這是 11/6 15:20 的樣子。只能看、記成功率；連上網路就換成最新的。';
	const greyBar = () => screen.queryByRole('status', { name: '沒有網路' });

	it('檢視模式、能播放（音樂是這台存的）、編輯按不了；上方列下面一條灰的、名字旁「⚠ 沒有網路」', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(2026, 10, 6, 15, 20));
		const withMusic = cloudFlow('c1', '流程1');
		withMusic.flow = { ...flowOf(loadSegmentAudio(withMusic.flow, 's1', '主歌.mp3')), name: '流程1' };
		withMusic.audio = { a1: new Uint8Array([5, 1]) };
		const s = home([withMusic]);
		await settle();
		await openFromHome('流程1');
		await goHome();
		vi.useRealTimers();
		const o = await reloadOffline(s);

		await openFromHome('流程1');
		expect(o.page.session.flow?.name).toBe('流程1');
		expect(greyBar()?.textContent).toBe(GREY);
		expect(document.querySelector('.topbar .title')!.textContent).toContain('⚠ 沒有網路');
		expect(document.querySelector('.topbar .title')!.textContent).not.toContain('⚠ 斷線');
		expect(screen.getByRole('button', { name: /編輯/ }).hasAttribute('disabled')).toBe(true);
		expect(o.page.session.viewing).toBe(true);
		expect(screen.getByRole('button', { name: /^音樂 1/ }).textContent).not.toContain('找不到音樂');
		await fireEvent.click(screen.getByRole('button', { name: '播放' }));
		expect(o.page.editor.playback.playing).toBe(true);
	});

	it('練習頁也有灰條，能記（沒傳的存在這台）；連上網路換成最新的、傳上去，灰條不見', async () => {
		const o = await reloadOffline(await openedTwo());
		await openFromHome('王教練的流程');
		await fireEvent.click(screen.getByRole('button', { name: '練習' }));
		expect(greyBar()?.textContent).toBe(GREY);

		const card = within(screen.getByRole('region', { name: '第 1 組 小美' }));
		await fireEvent.click(screen.getByRole('button', { name: '第 1 組 小美 上法 成功' }));
		await fireEvent.click(card.getByRole('button', { name: '存這一次' }));
		await settle();
		expect(o.offline.of('c2')!.records).toHaveLength(1);

		o.state.flows[1].flow.name = '王教練改過的名字';
		await network(o, 'online');
		expect(greyBar()).toBeNull();
		expect(o.page.session.flow?.name).toBe('王教練改過的名字');
		expect((o.state.flows[1].records ?? []).map((r) => r.attempt.marks)).toEqual([{ p1: '✓' }]);
		expect(o.offline.of('c2')).toBeNull();
		// 還在練習頁
		expect(screen.getByRole('button', { name: '練習' }).getAttribute('aria-pressed')).toBe('true');
	});

	it('手機（窄螢幕）也一樣：灰條、名字旁「⚠ 沒有網路」', async () => {
		const o = await reloadOffline(await openedTwo());
		o.view.unmount();
		vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === NARROW_SCREEN }));
		const page = editorPage(null, { server: o.server, offline: o.offline.store });
		render(Page, page.props);
		await settle();
		await openFromHome('流程1');
		expect(greyBar()?.textContent).toBe(GREY);
		expect(document.querySelector('.topbar .title')!.textContent).toContain('⚠ 沒有網路');
	});
});

describe('登出、被收回、被刪掉', () => {
	it('登出清掉離線副本；草稿還在', async () => {
		const drafts = fakeDraftStore();
		drafts.all.set('n1', { bytes: writeFlowFile(libSample(), {}), savedAt: new Date(2026, 10, 4, 9, 0) });
		const fake = fakeServer({ users: [lin, wang], signedIn: lin.email, flows: [cloudFlow('c1', '流程1')] });
		const offline = fakeOfflineStore();
		render(Page, editorPage(null, { server: fake.server, offline: offline.store, draftStore: drafts.store }).props);
		await settle();
		await openFromHome('流程1');
		await goHome();
		expect(offline.copyIds()).toEqual(['c1']);

		await fireEvent.click(screen.getByRole('button', { name: '林教練 ▾' }));
		await fireEvent.click(screen.getByRole('menuitem', { name: '登出' }));
		await settle();
		expect(offline.copyIds()).toEqual([]);
		expect(offline.signedInHere()).toBeNull();
		expect(screen.getByRole('link', { name: '登入' })).toBeTruthy();
		expect(drafts.all.has('n1')).toBe(true);
	});

	it('連上網路回到首頁：被收回、被刪掉的那份刪掉，最上面黃的說是哪幾支', async () => {
		const s = await openedTwo();
		s.view.unmount();
		s.changeRole('c2', lin.email, null);
		s.deleteFlow('c1');
		render(Page, editorPage(null, { server: s.server, offline: s.offline.store }).props);
		await settle();
		expect(s.offline.copyIds()).toEqual([]);
		// 被刪掉的說被刪掉，不說被收回
		expect(screen.getByRole('alert').textContent).toContain('「流程1」被擁有者刪掉了。你已經不能打開「王教練的流程」。這台留著的那份也刪掉了。');
	});

	it('被收回的那支這台還有沒傳的：先擋住列出來，按「知道了」才刪', async () => {
		const s = await openedTwo();
		s.view.unmount();
		await s.offline.store.saveUnsent(unsentOf('c2', '王教練的流程', 2));
		s.changeRole('c2', lin.email, null);
		render(Page, editorPage(null, { server: s.server, offline: s.offline.store }).props);
		await settle();
		const box = screen.getByRole('dialog', { name: '擁有者收回了你的權限，這 2 筆沒存進去' });
		expect(s.offline.copyIds()).toEqual(['c1', 'c2']);
		await fireEvent.click(within(box).getByRole('button', { name: '知道了' }));
		await settle();
		expect(s.offline.copyIds()).toEqual(['c1']);
		expect(s.offline.of('c2')).toBeNull();
		expect(screen.getByRole('alert').textContent).toContain('你已經不能打開「王教練的流程」。');
	});

	it('斷網打開的離線副本，連上後發現被收回：那份刪掉，回首頁', async () => {
		const o = await reloadOffline(await openedTwo());
		await openFromHome('王教練的流程');
		o.changeRole('c2', lin.email, null);
		await network(o, 'online');
		expect(o.page.session.flow).toBeNull();
		expect(o.offline.copyIds()).toEqual(['c1']);
		expect(screen.getByRole('alert').textContent).toContain('你已經不能打開「王教練的流程」。這台留著的那份也刪掉了。');
	});
});
