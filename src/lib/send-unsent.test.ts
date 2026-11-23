// 要求刪除帳號前把這台沒傳的紀錄傳上去（#370）：伺服器、離線存放換成測試共用的假的。
// 帳號頁怎麼用它在 routes/account/account.svelte.test.ts。
import { describe, expect, it } from 'vitest';
import type { UnsentRecords } from '#lib/offline-store.js';
import { sendUnsent } from '#lib/send-unsent.js';
import { fakeOfflineStore, fakeServer, flush } from '#lib/test-fakes.js';
import { libSample } from '#lib/test-flows.js';

const lin = { email: 'lin@example.com', name: '林教練', isAdmin: false, password: '我們這一隊今年一定會贏 go go' };
const wang = { email: 'wang@example.com', name: '王教練', isAdmin: false, password: '我們這一隊今年一定會贏 go go' };

/** 第 1 組小美記了一次（id 是 id）。 */
const recorded = (id: string): UnsentRecords['records'][number] => ({
	record: { actionId: 'x1', attempt: { id, date: '2026-11-07', who: 'g1', practice: 'drill', whole: true, marks: { p1: '✓' } } },
	row: { id, date: '2026-11-07', action: '技巧·Lib', who: '第 1 組 小美', marks: '✓··', runThrough: false }
});

describe('傳這台沒傳的紀錄', () => {
	it('等伺服器回答時別的分頁又記了一次：伺服器收了的拿掉，後記的那次留在這台', async () => {
		const fake = fakeServer({
			users: [lin],
			signedIn: lin.email,
			flows: [{ id: 'c1', owner: lin.email, flow: libSample(), updatedAt: '2026-11-07T00:00:00Z' }]
		});
		const offline = fakeOfflineStore({ unsent: [{ flowId: 'c1', flowName: '區賽', records: [recorded('tfirst0000001')], amends: [], dropped: [] }] });
		fake.state.holdRoom = true;
		const done = sendUnsent(fake.server, offline.store);
		await flush();
		// 打招呼回答了，記的那一批送出去、留著還沒回
		fake.releaseRoom(true);
		await flush();
		const [u] = await offline.store.unsent();
		await offline.store.saveUnsent({ ...u, records: [...u.records, recorded('tsecond000002')] });
		fake.releaseRoom();
		await done;
		expect(fake.state.flows[0].records?.map((r) => r.attempt.id)).toEqual(['tfirst0000001']);
		expect(offline.of('c1')!.records.map((r) => r.record.attempt.id)).toEqual(['tsecond000002']);
	});

	it('伺服器沒照做的刪（記錄者刪別人記的，伺服器回答時那一次還在）：不算傳了，留在這台', async () => {
		const wangs = recorded('twang00000001').record;
		const fake = fakeServer({
			users: [lin, wang],
			signedIn: lin.email,
			flows: [
				{
					id: 'c1',
					owner: wang.email,
					flow: libSample(),
					updatedAt: '2026-11-07T00:00:00Z',
					people: { [lin.email]: 'recorder' },
					records: [{ ...wangs, by: wang.email }]
				}
			]
		});
		const amend = { ids: ['twang00000001'], request: { kind: 'deleteRecords' as const, ids: ['twang00000001'] } };
		const offline = fakeOfflineStore({ unsent: [{ flowId: 'c1', flowName: '區賽', records: [], amends: [amend], dropped: [] }] });
		await sendUnsent(fake.server, offline.store);
		expect(fake.state.flows[0].records?.filter((r) => !r.gone).map((r) => r.attempt.id)).toEqual(['twang00000001']);
		expect(offline.of('c1')!.amends).toEqual([amend]);
	});
	it('等伺服器回答時別的分頁改了那一次的記號（同一個 id）：伺服器收的是改之前的，改過的留在這台（下次送「改」）', async () => {
		const fake = fakeServer({
			users: [lin],
			signedIn: lin.email,
			flows: [{ id: 'c1', owner: lin.email, flow: libSample(), updatedAt: '2026-11-07T00:00:00Z' }]
		});
		const offline = fakeOfflineStore({ unsent: [{ flowId: 'c1', flowName: '區賽', records: [recorded('tfirst0000001')], amends: [], dropped: [] }] });
		fake.state.holdRoom = true;
		const done = sendUnsent(fake.server, offline.store);
		await flush();
		fake.releaseRoom(true);
		await flush();
		const [u] = await offline.store.unsent();
		const changed = structuredClone(u.records[0]);
		changed.record.attempt.marks = { p1: '✗' };
		await offline.store.saveUnsent({ ...u, records: [changed] });
		fake.releaseRoom();
		await done;
		// 伺服器上那一次已經有了（再記一次不會換）：改過的記號變成「改」留在這台，下次送
		expect(offline.of('c1')!.records).toEqual([]);
		expect(offline.of('c1')!.amends).toEqual([{ ids: ['tfirst0000001'], request: { kind: 'changeRecords', attempts: [changed.record] } }]);
	});

	it('等刪的回答時別的分頁救回又刪了同一次：伺服器照做的那個刪拿掉，後來的救回、刪照先後留在這台', async () => {
		const mine = recorded('tmine00000001').record;
		const fake = fakeServer({
			users: [lin],
			signedIn: lin.email,
			flows: [{ id: 'c1', owner: lin.email, flow: libSample(), updatedAt: '2026-11-07T00:00:00Z', records: [{ ...mine, by: lin.email }] }]
		});
		const del = { ids: ['tmine00000001'], request: { kind: 'deleteRecords' as const, ids: ['tmine00000001'] } };
		const restore = { ids: ['tmine00000001'], request: { kind: 'restoreRecords' as const, ids: ['tmine00000001'] } };
		const offline = fakeOfflineStore({ unsent: [{ flowId: 'c1', flowName: '區賽', records: [], amends: [del], dropped: [] }] });
		fake.state.holdRoom = true;
		const done = sendUnsent(fake.server, offline.store);
		await flush();
		fake.releaseRoom(true);
		await flush();
		const [u] = await offline.store.unsent();
		await offline.store.saveUnsent({ ...u, amends: [del, restore, del] });
		fake.releaseRoom();
		await done;
		expect(offline.of('c1')!.amends).toEqual([restore, del]);
	});
	it('傳完要從這台存著的拿掉傳了的時候，別的分頁剛好又記了一次：後記的那次留在這台', async () => {
		const fake = fakeServer({
			users: [lin],
			signedIn: lin.email,
			flows: [{ id: 'c1', owner: lin.email, flow: libSample(), updatedAt: '2026-11-07T00:00:00Z' }]
		});
		const offline = fakeOfflineStore({ unsent: [{ flowId: 'c1', flowName: '區賽', records: [recorded('tfirst0000001')], amends: [], dropped: [] }] });
		/** 別的分頁記的（同一台）：存進這台。 */
		const otherTab = async () => {
			const [u] = await offline.store.unsent();
			await offline.store.saveUnsent({ ...u, records: [...u.records, recorded('tsecond000002')] });
		};
		// 一次讀改存（別的分頁存的只能在前、在後）：別的分頁在它之前存
		const update = offline.store.updateUnsent.bind(offline.store);
		offline.store.updateUnsent = async (flowId, change) => {
			await otherTab();
			return update(flowId, change);
		};
		await sendUnsent(fake.server, offline.store);
		expect(fake.state.flows[0].records?.map((r) => r.attempt.id)).toEqual(['tfirst0000001']);
		expect(offline.of('c1')!.records.map((r) => r.record.attempt.id)).toEqual(['tsecond000002']);
	});
	it('一批刪伺服器只照做了一部分（記錄者連別人記的一起刪）：刪掉的拿掉，只留沒刪掉的那幾次（下次不再刪別人救回的）', async () => {
		const wangs = recorded('twang00000001').record;
		const mine = recorded('tmine00000001').record;
		const fake = fakeServer({
			users: [lin, wang],
			signedIn: lin.email,
			flows: [
				{
					id: 'c1',
					owner: wang.email,
					flow: libSample(),
					updatedAt: '2026-11-07T00:00:00Z',
					people: { [lin.email]: 'recorder' },
					records: [
						{ ...wangs, by: wang.email },
						{ ...mine, by: lin.email }
					]
				}
			]
		});
		const ids = ['twang00000001', 'tmine00000001'];
		const offline = fakeOfflineStore({
			unsent: [{ flowId: 'c1', flowName: '區賽', records: [], amends: [{ ids, request: { kind: 'deleteRecords', ids } }], dropped: [] }]
		});
		await sendUnsent(fake.server, offline.store);
		expect(fake.state.flows[0].records?.filter((r) => !r.gone).map((r) => r.attempt.id)).toEqual(['twang00000001']);
		expect(offline.of('c1')!.amends).toEqual([{ ids: ['twang00000001'], request: { kind: 'deleteRecords', ids: ['twang00000001'] } }]);
	});
});
