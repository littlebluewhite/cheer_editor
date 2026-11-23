// 要求刪除帳號前把這台沒傳的紀錄傳上去（#370）：伺服器、離線存放換成測試共用的假的。
// 帳號頁怎麼用它在 routes/account/account.svelte.test.ts。
import { describe, expect, it } from 'vitest';
import type { UnsentRecords } from '#lib/offline-store.js';
import { sendUnsent } from '#lib/send-unsent.js';
import { fakeOfflineStore, fakeServer, flush } from '#lib/test-fakes.js';
import { libSample } from '#lib/test-flows.js';

const lin = { email: 'lin@example.com', name: '林教練', isAdmin: false, password: '我們這一隊今年一定會贏 go go' };

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
});
