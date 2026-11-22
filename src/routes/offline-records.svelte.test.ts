// 頁面：斷網記成功率、沒傳的紀錄（#260，#191 的 A）。斷網照記，存在這台（離線存放，重新整理也在），連上自動傳；
// 記錄頁、總表上方的提示條（斷網、傳不上去＋「現在再試」、登入超過 30 天＋「再登入」、傳中、都傳上去了）；
// 還沒傳的那一次後面「沒傳」；斷網時改、刪自己記的；被收回時擋住的框；登出時的小框；首頁「N 筆沒傳」；iPhone 的提醒。
// 伺服器、離線存放換成測試共用的假的（fakeServer 的 network() 換網路，fakeOfflineStore 存在記憶體）。
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { StoredAttempt } from '#lib/core';
import { localDate } from '#lib/local-date.js';
import type { UnsentRecords } from '#lib/offline-store.js';
import { editorPage, fakeOfflineStore, fakeServer, flush, type FakeCloudFlow } from '#lib/test-fakes.js';
import { libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

const pw = '我們這一隊今年一定會贏 go go';
const lin = { email: 'lin@example.com', name: '林教練', isAdmin: false, password: pw };
const wang = { email: 'wang@example.com', name: '王教練', isAdmin: false, password: pw };

/** 王教練的「測試」（libSample：Lib 三個環節上法、中段、下法，第 1 組小美、第 2 組小芳），林教練是記錄者。 */
const wangsFlow = (records: FakeCloudFlow['records'] = []): FakeCloudFlow => ({
	id: 'c1',
	owner: wang.email,
	flow: libSample(),
	updatedAt: new Date(2026, 10, 6, 15, 20).toISOString(),
	people: { [lin.email]: 'recorder' },
	records
});

/** 等房間、離線存放的來回都跑完。 */
const settle = async () => {
	for (let i = 0; i < 4; i++) await flush();
};

/** 林教練登入、打開王教練的「測試」、切到練習。offline：離線存放（同一個就像同一台手機）。 */
async function open(flow: FakeCloudFlow | null = wangsFlow(), offline = fakeOfflineStore(), fake = fakeServer({ users: [lin, wang], signedIn: lin.email, flows: flow ? [flow] : [] })) {
	const page = editorPage(null, { server: fake.server, offline: offline.store });
	const view = render(Page, page.props);
	await settle();
	await fireEvent.click(screen.getByRole('button', { name: /^測試/ }));
	await settle();
	await fireEvent.click(screen.getByRole('button', { name: '練習' }));
	return { ...fake, page, offline, view };
}

const card = (who: string) => within(screen.getByRole('region', { name: who }));
const tap = (who: string, phase: string, mark: '成功' | '小失誤' | '失敗') =>
	fireEvent.click(screen.getByRole('button', { name: `${who} ${phase} ${mark}` }));
/** 記第 1 組小美一次（上法 mark），按「存這一次」。 */
async function recordOne(mark: '成功' | '失敗' = '成功') {
	await tap('第 1 組 小美', '上法', mark);
	await fireEvent.click(card('第 1 組 小美').getByRole('button', { name: '存這一次' }));
	await settle();
}
/** 卡片下面那一排：這天的每一次（記號，別人記的寫名字，還沒傳的寫「沒傳」）。 */
function dayRow(who: string): string[] {
	const list = card(who).queryByRole('list', { name: '這天的每一次' });
	return list ? within(list).getAllByRole('listitem').map((li) => li.textContent!.replace(/\s+/g, ' ').trim()) : [];
}
/** 提示條（練習的頁、日期那一排下面）的字。 */
const bars = () => [...document.querySelectorAll('.practice .bar')].map((b) => b.textContent!.replace(/\s+/g, ' ').trim());
/** 存在假伺服器上的紀錄（沒清掉的）。 */
const stored = (s: { state: { flows: FakeCloudFlow[] } }) => (s.state.flows[0].records ?? []).filter((r) => !r.gone);

describe('斷網照記，連上自動傳', () => {
	it('斷網記一次：存在這台，提示條寫幾筆、那一次寫「沒傳」；連上自動傳，「都傳上去了。」', async () => {
		const s = await open();
		s.network('offline');
		await settle();
		expect(bars()).toEqual(['斷線了：記的會先存在這台，連上網路自動傳。']);

		await recordOne();
		expect(bars()).toEqual(['斷線了：還有 1 筆沒傳，連上網路會自動傳。']);
		expect(dayRow('第 1 組 小美')).toEqual(['✓··沒傳']);
		expect(s.offline.of('c1')!.records.map((r) => r.record.attempt.marks)).toEqual([{ p1: '✓' }]);
		expect(stored(s)).toEqual([]);

		s.network('online');
		await settle();
		expect(stored(s).map((r) => [r.attempt.marks, r.by])).toEqual([[{ p1: '✓' }, lin.email]]);
		expect(bars()).toEqual(['都傳上去了。']);
		expect(dayRow('第 1 組 小美')).toEqual(['✓··']);
		expect(s.offline.of('c1')).toBeNull();
	});

	it('連上時先寫「傳中…（N 筆）」', async () => {
		const s = await open();
		s.network('offline');
		await settle();
		await recordOne();
		await recordOne('失敗');
		s.state.holdRoom = true;
		s.network('online');
		await settle();
		// 伺服器說好了，紀錄送出去、還沒回答
		s.releaseRoom(true);
		await flush();
		expect(bars()).toEqual(['傳中…（2 筆）']);
		s.releaseRoom();
		await settle();
		expect(bars()).toEqual(['都傳上去了。']);
		expect(stored(s).length).toBe(2);
	});

	it('重新整理（關掉網頁）也還在：再打開這支流程，放回畫面、接著傳', async () => {
		const offline = fakeOfflineStore();
		const fake = fakeServer({ users: [lin, wang], signedIn: lin.email, flows: [wangsFlow()] });
		const first = await open(null, offline, fake);
		fake.network('offline');
		await settle();
		await recordOne();
		// 關掉網頁
		first.page.session.open(null);
		first.view.unmount();
		document.body.innerHTML = '';

		// 網路回來了，這台又打開（伺服器還沒回答）：沒傳的那一次在畫面上
		fake.network('online');
		fake.state.holdRoom = true;
		const again = await open(null, offline, fake);
		expect(dayRow('第 1 組 小美')).toEqual(['✓··沒傳']);
		fake.releaseRoom();
		await settle();
		expect(stored(again).map((r) => r.attempt.marks)).toEqual([{ p1: '✓' }]);
		expect(dayRow('第 1 組 小美')).toEqual(['✓··']);
		expect(offline.of('c1')).toBeNull();
	});

	it('斷網時按「＋ 記一次全上」：不問，直接開只有自己的一次', async () => {
		const s = await open();
		s.network('offline');
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: '＋ 記一次全上' }));
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(screen.getByRole('button', { name: /存這次全上/ })).toBeTruthy();
	});
});

describe('斷網時改、刪自己記的', () => {
	it('已經傳的：改、刪先留在這台，連上再送', async () => {
		const s = await open();
		await recordOne('失敗');
		await recordOne('失敗');
		expect(stored(s).length).toBe(2);
		s.network('offline');
		await settle();

		await fireEvent.click(card('第 1 組 小美').getByRole('button', { name: /^改第 1 次/ }));
		await fireEvent.click(screen.getByRole('button', { name: '第 1 次 上法 成功' }));
		await fireEvent.click(screen.getByRole('button', { name: '存修改' }));
		await settle();
		await fireEvent.click(card('第 1 組 小美').getByRole('button', { name: '刪掉我的上一次' }));
		await settle();
		expect(dayRow('第 1 組 小美')).toEqual(['✓··沒傳']);
		expect(bars()).toEqual(['斷線了：還有 2 筆沒傳，連上網路會自動傳。']);
		expect(stored(s).map((r) => r.attempt.marks)).toEqual([{ p1: '✗' }, { p1: '✗' }]);

		s.network('online');
		await settle();
		expect(stored(s).map((r) => r.attempt.marks)).toEqual([{ p1: '✓' }]);
		expect(dayRow('第 1 組 小美')).toEqual(['✓··']);
		expect(s.offline.of('c1')).toBeNull();
	});

	it('還沒傳的：直接改、刪這台的，不用送', async () => {
		const s = await open();
		s.network('offline');
		await settle();
		await recordOne('失敗');
		await fireEvent.click(card('第 1 組 小美').getByRole('button', { name: /^改第 1 次/ }));
		await fireEvent.click(screen.getByRole('button', { name: '第 1 次 上法 成功' }));
		await fireEvent.click(screen.getByRole('button', { name: '存修改' }));
		await settle();
		expect(bars()).toEqual(['斷線了：還有 1 筆沒傳，連上網路會自動傳。']);
		expect(s.offline.of('c1')!.records.map((r) => r.record.attempt.marks)).toEqual([{ p1: '✓' }]);
		expect(s.offline.of('c1')!.amends).toEqual([]);

		await fireEvent.click(card('第 1 組 小美').getByRole('button', { name: '刪掉我的上一次' }));
		await settle();
		expect(bars()).toEqual(['斷線了：記的會先存在這台，連上網路自動傳。']);
		expect(s.offline.of('c1')).toBeNull();

		// 刪了又救回：還是一筆沒傳的
		await fireEvent.click(screen.getByRole('button', { name: '救回' }));
		await settle();
		expect(dayRow('第 1 組 小美')).toEqual(['✓··沒傳']);
		s.network('online');
		await settle();
		expect(stored(s).map((r) => r.attempt.marks)).toEqual([{ p1: '✓' }]);
	});
});

describe('傳不上去、登入過期', () => {
	it('伺服器沒回應：紅條和「現在再試」；還連不上照樣紅，連得上了一按就傳', async () => {
		const s = await open();
		s.network('unreachable');
		await settle();
		await recordOne();
		expect(bars()).toEqual(['傳不上去（伺服器沒回應）：還有 1 筆沒傳，等一下會自動再試。 現在再試']);

		await fireEvent.click(screen.getByRole('button', { name: '現在再試' }));
		await settle();
		expect(bars()).toEqual(['傳不上去（伺服器沒回應）：還有 1 筆沒傳，等一下會自動再試。 現在再試']);
		expect(stored(s)).toEqual([]);

		// 伺服器回來了（還沒到自動再試的時候）
		s.state.link = 'online';
		s.state.unreachable = false;
		await fireEvent.click(screen.getByRole('button', { name: '現在再試' }));
		await settle();
		expect(stored(s).length).toBe(1);
		expect(bars()).toEqual(['都傳上去了。']);
	});

	it('登入超過 30 天：紅條和「再登入」（到登入頁）；沒傳的留在這台', async () => {
		const s = await open();
		s.network('expired');
		await settle();
		await recordOne();
		expect(bars()).toEqual(['登入超過 30 天了：還有 1 筆沒傳，再登入一次就會傳。 再登入']);
		expect(screen.getByRole('link', { name: '再登入' }).getAttribute('href')).toBe('/login');
		expect(s.offline.of('c1')!.records.length).toBe(1);
		expect(dayRow('第 1 組 小美')).toEqual(['✓··沒傳']);
	});
});

describe('流程被刪了時還有沒傳的', () => {
	it('斷線時流程被刪了：框寫被刪掉了（不是被收回），按「知道了」才刪掉、回首頁', async () => {
		const s = await open();
		s.network('offline');
		await settle();
		await recordOne();
		s.deleteFlow('c1');
		s.network('online');
		await settle();

		const box = screen.getByRole('dialog', { name: '「測試」被擁有者刪掉了，這 1 筆沒存進去' });
		expect(box.textContent).toContain('傳上去時這支流程已經刪掉了');
		await fireEvent.click(within(box).getByRole('button', { name: '知道了' }));
		await settle();
		expect(screen.getByRole('alert').textContent).toContain('「測試」被擁有者刪掉了。');
		expect(s.offline.of('c1')).toBeNull();
	});

	it('斷線時流程被刪了、沒有沒傳的：連上就回首頁，黃條說被刪掉了', async () => {
		const s = await open();
		s.network('offline');
		await settle();
		s.deleteFlow('c1');
		s.network('online');
		await settle();
		expect(s.page.session.flow).toBeNull();
		expect(screen.getByRole('alert').textContent).toContain('「測試」被擁有者刪掉了。');
	});
});

describe('被收回時還有沒傳的', () => {
	it('連上時才知道被收回：擋住畫面的框列出那幾筆，按「知道了」才刪掉、回首頁', async () => {
		const s = await open();
		s.network('offline');
		await settle();
		await recordOne();
		// 王教練（在別的地方）收回了林教練的權限
		s.state.flows[0].people = {};
		s.network('online');
		await settle();

		const box = screen.getByRole('dialog', { name: '擁有者收回了你的權限，這 1 筆沒存進去' });
		expect(box.textContent).toContain('這幾筆只在這台裝置上，按「知道了」就刪掉。要的話，先抄下來再補記。');
		const row = within(box).getAllByRole('row')[1];
		expect(within(row).getAllByRole('cell').map((c) => c.textContent)).toEqual([localDate(), '技巧·Lib', '第 1 組 小美', '✓··']);
		expect(s.offline.of('c1')).not.toBeNull();

		await fireEvent.click(within(box).getByRole('button', { name: '知道了' }));
		await settle();
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(screen.getByRole('alert').textContent).toContain('你已經不能打開「測試」。');
		expect(s.offline.of('c1')).toBeNull();
		expect(stored(s)).toEqual([]);
	});
});

/** 這台存著的沒傳的：flowId 那支流程（名字 flowName）有 n 筆。 */
function unsentOf(flowId: string, flowName: string, n: number): UnsentRecords {
	const records = Array.from({ length: n }, (_, i) => {
		const id = `t${flowId}000000000${i}`.slice(0, 13);
		const record: StoredAttempt = { actionId: 'x1', attempt: { id, date: localDate(), who: 'g1', practice: 'drill', whole: true, marks: { p1: '✓' } } };
		return { record, row: { id, date: localDate(), action: '技巧·Lib', who: '第 1 組 小美', marks: '✓··', runThrough: false } };
	});
	return { flowId, flowName, records, amends: [], dropped: [] };
}

describe('首頁、登出', () => {
	it('首頁雲端流程那一列右邊「N 筆沒傳」', async () => {
		const offline = fakeOfflineStore({ unsent: [unsentOf('c1', '測試', 2)] });
		const fake = fakeServer({ users: [lin, wang], signedIn: lin.email, flows: [wangsFlow()] });
		render(Page, editorPage(null, { server: fake.server, offline: offline.store }).props);
		await settle();
		expect(screen.getByRole('button', { name: /^測試/ }).textContent).toContain('2 筆沒傳');
	});

	it('登出時這台還有沒傳的：小框列每支流程幾筆，「先不要登出」（預設）、「丟掉，登出」', async () => {
		const offline = fakeOfflineStore({ unsent: [unsentOf('c1', '區賽 2026', 1), unsentOf('c2', '春季盃', 2)] });
		const fake = fakeServer({ users: [lin, wang], signedIn: lin.email, flows: [wangsFlow()] });
		render(Page, editorPage(null, { server: fake.server, offline: offline.store }).props);
		await settle();
		const logout = async () => {
			await fireEvent.click(screen.getByRole('button', { name: '林教練 ▾' }));
			await fireEvent.click(screen.getByRole('menuitem', { name: '登出' }));
			await settle();
		};
		await logout();
		const box = screen.getByRole('dialog', { name: '還有 3 筆成功率紀錄沒傳' });
		expect(box.textContent).toContain('登出就丟掉，別人看不到。先連上網路，等它傳完再登出。');
		const rows = within(box).getAllByRole('listitem').map((li) => [...li.children].map((c) => c.textContent).join('｜'));
		expect(rows).toEqual(['區賽 2026｜1 筆', '春季盃｜2 筆']);
		expect(document.activeElement).toBe(within(box).getByRole('button', { name: '先不要登出' }));

		await fireEvent.click(within(box).getByRole('button', { name: '先不要登出' }));
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(fake.state.signedIn).toBe(lin.email);

		await logout();
		await fireEvent.click(screen.getByRole('button', { name: '丟掉，登出' }));
		await settle();
		expect(fake.state.signedIn).toBeNull();
		expect(await offline.store.unsent()).toEqual([]);
	});

	it('這台沒有沒傳的：直接登出', async () => {
		const fake = fakeServer({ users: [lin, wang], signedIn: lin.email, flows: [wangsFlow()] });
		render(Page, editorPage(null, { server: fake.server }).props);
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: '林教練 ▾' }));
		await fireEvent.click(screen.getByRole('menuitem', { name: '登出' }));
		await settle();
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(fake.state.signedIn).toBeNull();
	});
});

describe('iPhone、iPad 的 Safari：提醒加到主畫面', () => {
	const hint = () => screen.queryByRole('complementary', { name: '加到主畫面，沒傳的紀錄才不會被清掉' });

	it('第一次記好後從下面滑上來；「知道了」以後不跳', async () => {
		const s = await open(wangsFlow(), fakeOfflineStore({ volatile: true }));
		expect(hint()).toBeNull();
		await recordOne();
		expect(hint()!.textContent).toContain('按 Safari 下面的「分享」');
		await fireEvent.click(within(hint()!).getByRole('button', { name: '知道了' }));
		expect(hint()).toBeNull();
		await recordOne();
		expect(hint()).toBeNull();

		// 換一支再打開這支（回首頁）、記第一次：不再跳
		s.page.session.open(null);
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: /^測試/ }));
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: '練習' }));
		await recordOne();
		expect(hint()).toBeNull();
	});

	it('「下次再說」：這次不再跳，下次打開這支流程、記第一次再跳', async () => {
		const s = await open(wangsFlow(), fakeOfflineStore({ volatile: true }));
		await recordOne();
		await fireEvent.click(within(hint()!).getByRole('button', { name: '下次再說' }));
		expect(hint()).toBeNull();
		await recordOne();
		expect(hint()).toBeNull();

		s.page.session.open(null);
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: /^測試/ }));
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: '練習' }));
		expect(hint()).toBeNull();
		await recordOne();
		expect(hint()).not.toBeNull();
	});

	it('電腦、Android、從主畫面打開的不跳', async () => {
		await open();
		await recordOne();
		expect(hint()).toBeNull();
	});
});
