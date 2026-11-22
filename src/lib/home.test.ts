// 首頁和帳號在 Node（不畫編輯頁，#314）：登入的是誰、「我的流程」、還沒傳的紀錄、離線副本、登出。
// 伺服器是測試共用的假伺服器（fakeServer），離線存放是 fakeOfflineStore。
import { describe, expect, it } from 'vitest';
import { libSample } from '#lib/test-flows.js';
import type { StoredAttempt } from '#lib/core';
import { localDate } from '#lib/local-date.js';
import type { OfflineCopy, UnsentRecords } from '#lib/offline-store.js';
import { fakeOfflineStore, fakeServer, flush, testEditor } from '#lib/test-fakes.js';

const pw = '我們這一隊今年一定會贏 go go';
const lin = { email: 'lin@example.com', name: '林教練', isAdmin: false, password: pw };
const wang = { email: 'wang@example.com', name: '王教練', isAdmin: false, password: pw };

/** 林教練的「測試」（c1）、王教練分享給林教練編的「春季盃」（c2）。 */
function flows() {
	const named = (name: string) => ({ ...libSample(), name });
	return [
		{ id: 'c1', owner: lin.email, flow: named('測試'), updatedAt: new Date(2026, 10, 7).toISOString() },
		{
			id: 'c2',
			owner: wang.email,
			flow: named('春季盃'),
			updatedAt: new Date(2026, 10, 8).toISOString(),
			people: { [lin.email]: 'editor' as const }
		}
	];
}

/** 這支流程這台還沒傳的 n 筆。 */
function unsentOf(flowId: string, flowName: string, n: number): UnsentRecords {
	const records = Array.from({ length: n }, (_, i) => {
		const id = `t${flowId}000000000${i}`.slice(0, 13);
		const record: StoredAttempt = { actionId: 'x1', attempt: { id, date: localDate(), who: 'g1', practice: 'drill', whole: true, marks: { p1: '✓' } } };
		return { record, row: { id, date: localDate(), action: '技巧·Lib', who: '第 1 組 小美', marks: '✓··', runThrough: false } };
	});
	return { flowId, flowName, records, amends: [], dropped: [] };
}

/** 這支流程的離線副本。 */
function copyOf(flowId: string, name: string): OfflineCopy {
	return { flowId, name, savedAt: 1, openedAt: 1, role: 'owner', step: 0, flow: libSample(), records: [] };
}

/** 首頁（沒開流程）：林教練登入著（signedIn 給 null 是沒登入），離線存放帶著 unsent。 */
function home(signedIn: string | null = lin.email, unsent: UnsentRecords[] = []) {
	const fake = fakeServer({ users: [lin, wang], signedIn, flows: flows() });
	const offline = fakeOfflineStore({ unsent });
	const t = testEditor(null, { server: fake.server, offline: offline.store });
	return { ...fake, ...t, offline, home: t.editor.home };
}

describe('首頁和帳號（Node）', () => {
	it('登入後：知道是誰，「我的流程」「分享給我的」、每支幾筆沒傳、離線副本都拿到，記下這台登入的是誰', async () => {
		const s = home(lin.email, [unsentOf('c1', '測試', 2)]);
		await s.offline.store.saveCopy(copyOf('c1', '測試'));

		await s.home.load();
		expect(s.home.account?.name).toBe('林教練');

		s.home.refresh();
		await flush();
		expect(s.home.myFlows?.mine.map((f) => f.name)).toEqual(['測試']);
		expect(s.home.myFlows?.shared.map((f) => f.name)).toEqual(['春季盃']);
		expect(s.home.cloudError).toBe(false);
		expect(s.home.unsentByFlow).toEqual({ c1: 2 });
		expect(s.home.copyIds).toEqual(new Set(['c1']));
		expect(s.offline.signedInHere()).toEqual({ me: s.home.account, cloudIds: ['c1', 'c2'] });
	});

	it('沒登入：account 是 null，不跟伺服器拿我的流程', async () => {
		const s = home(null);
		await s.home.load();
		expect(s.home.account).toBeNull();

		s.home.refresh();
		await flush();
		expect(s.home.myFlows).toBeNull();
		expect(s.home.cloudError).toBe(false);
	});

	it('連不上伺服器（有網路）：我的流程拿不到是 cloudError，這台沒傳的、離線副本照樣列', async () => {
		const s = home(lin.email, [unsentOf('c1', '測試', 1)]);
		await s.offline.store.saveCopy(copyOf('c1', '測試'));
		await s.home.load();

		s.state.unreachable = true;
		s.home.refresh();
		await flush();
		expect(s.home.myFlows).toBeNull();
		expect(s.home.cloudError).toBe(true);
		expect(s.home.unsentByFlow).toEqual({ c1: 1 });
		expect(s.home.copies.map((c) => c.flowId)).toEqual(['c1']);
	});

	it('斷網：用這台記著的登入的人，列離線副本和上次看到的雲端流程', async () => {
		const s = home();
		await s.home.load();
		s.home.refresh();
		await flush();
		await s.offline.store.saveCopy(copyOf('c2', '春季盃'));

		const t = testEditor(null, { server: s.server, offline: s.offline.store });
		s.network('offline');
		await t.editor.home.load();
		expect(t.editor.home.account?.name).toBe('林教練');
		t.editor.home.refresh();
		await flush();
		expect(t.editor.home.knownCloudIds).toEqual(['c1', 'c2']);
		expect(t.editor.home.copyIds).toEqual(new Set(['c2']));
		expect(t.editor.home.myFlows).toBeNull();
		expect(t.editor.home.cloudError).toBe(false);
	});

	it('問伺服器時還連著、回來前斷網：照樣用這台記著的登入的人', async () => {
		const s = home();
		await s.home.load();
		s.home.refresh();
		await flush();

		const t = testEditor(null, { server: s.server, offline: s.offline.store });
		s.network('unreachable');
		const asked = t.editor.home.load();
		s.network('offline');
		await asked;
		expect(t.editor.home.account?.name).toBe('林教練');
	});

	it('問伺服器時斷著、回來前連上了：照樣用這台記著的登入的人', async () => {
		const s = home();
		await s.home.load();
		s.home.refresh();
		await flush();

		const t = testEditor(null, { server: s.server, offline: s.offline.store });
		s.network('offline');
		const asked = t.editor.home.load();
		s.network('online');
		await asked;
		expect(t.editor.home.account?.name).toBe('林教練');
	});

	it('問伺服器時斷著、回來前連上了，伺服器說沒登入（過期、被登出）：就是沒登入，不用這台記著的', async () => {
		const s = home();
		await s.home.load();
		s.home.refresh();
		await flush();

		const t = testEditor(null, { server: s.server, offline: s.offline.store });
		s.state.signedIn = null;
		// 瀏覽器說斷網，可是這一次問得到伺服器
		s.network('offline');
		s.state.unreachable = false;
		const asked = t.editor.home.load();
		s.network('online');
		await asked;
		expect(t.editor.home.account).toBeNull();
	});

	it('在首頁時斷網、再連上：重拿時列的跟著換（斷網列上次看到的雲端流程，連上又跟伺服器拿我的流程）', async () => {
		const s = home();
		await s.home.load();
		s.home.refresh();
		await flush();
		await s.offline.store.saveCopy(copyOf('c2', '春季盃'));

		const t = testEditor(null, { server: s.server, offline: s.offline.store });
		await t.editor.home.load();
		s.network('offline');
		let leave = t.editor.home.refresh();
		await flush();
		expect(t.editor.home.knownCloudIds).toEqual(['c1', 'c2']);
		expect(t.editor.home.copyIds).toEqual(new Set(['c2']));
		expect(t.editor.home.myFlows).toBeNull();

		leave();
		s.network('online');
		leave = t.editor.home.refresh();
		await flush();
		expect(t.editor.home.myFlows?.mine.map((f) => f.name)).toEqual(['測試']);
		expect(t.editor.home.cloudError).toBe(false);
		leave();
	});

	it('離開首頁之後才回來的我的流程不算', async () => {
		const s = home();
		await s.home.load();
		const leave = s.home.refresh();
		leave();
		await flush();
		expect(s.home.myFlows).toBeNull();
	});

	it('登出：這台沒有沒傳的紀錄就直接登出，離線副本清掉', async () => {
		const s = home();
		await s.offline.store.saveCopy(copyOf('c1', '測試'));
		await s.home.load();

		await s.home.logout();
		expect(s.home.unsentAtLogout).toBeNull();
		expect(s.home.account).toBeNull();
		expect(s.state.signedIn).toBeNull();
		expect(s.offline.copyIds()).toEqual([]);
		expect(s.offline.signedInHere()).toBeNull();
	});

	it('登出時這台還有沒傳的：先問（每支流程幾筆），「先不要登出」什麼都不變', async () => {
		const s = home(lin.email, [unsentOf('c1', '測試', 2)]);
		await s.offline.store.saveCopy(copyOf('c1', '測試'));
		await s.home.load();

		await s.home.logout();
		expect(s.home.unsentAtLogout?.map((u) => u.flowName)).toEqual(['測試']);
		expect(s.home.account?.name).toBe('林教練');

		s.home.stay();
		expect(s.home.unsentAtLogout).toBeNull();
		expect(s.state.signedIn).toBe(lin.email);
		expect(s.offline.of('c1')).not.toBeNull();
		expect(s.offline.copyIds()).toEqual(['c1']);
	});

	it('「丟掉，登出」：還沒傳的紀錄和離線副本都清掉', async () => {
		const s = home(lin.email, [unsentOf('c1', '測試', 2)]);
		await s.offline.store.saveCopy(copyOf('c1', '測試'));
		await s.home.load();
		await s.home.logout();

		await s.home.signOut(true);
		expect(s.home.unsentAtLogout).toBeNull();
		expect(s.home.account).toBeNull();
		expect(s.state.signedIn).toBeNull();
		expect(s.offline.of('c1')).toBeNull();
		expect(s.offline.copyIds()).toEqual([]);
	});

	it('登出時連不上伺服器：還是登入著，離線副本留著', async () => {
		const s = home();
		await s.offline.store.saveCopy(copyOf('c1', '測試'));
		await s.home.load();

		s.state.unreachable = true;
		await s.home.logout();
		expect(s.home.account?.name).toBe('林教練');
		expect(s.offline.copyIds()).toEqual(['c1']);
	});
});
