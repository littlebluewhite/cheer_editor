// 離線存放存在殼裡（#383）：App 裡的離線副本（含音樂）、沒傳的紀錄、這台登入的是誰問殼。
// 殼用照情境檔演的假殼（bridge-scenarios/current/offline.json），殼的測試跑同一份。
import { afterEach, describe, expect, it } from 'vitest';
import { host } from '#lib/host.js';
import { appShell, useShellIfInApp } from '#lib/app-shell.js';
import { createIndexedDbOfflineStore, type OfflineCopy, type UnsentRecords } from '#lib/offline-store.js';
import { scenarioShell } from '#lib/scenario-shell.js';
import { shellOfflineStore } from '#lib/shell-offline.js';
import type { DroppedRecord } from '#lib/practice-rights.js';

afterEach(() => {
	delete window.__cheerShell;
});

const unsent = (flowId: string, flowName: string, dropped: string): UnsentRecords => ({
	flowId,
	flowName,
	records: [],
	amends: [],
	dropped: [{ id: dropped } as DroppedRecord]
});

const copy = (savedAt: number, step: number): OfflineCopy => ({
	flowId: 'c1',
	name: '全國賽',
	savedAt,
	openedAt: savedAt,
	role: 'owner',
	step,
	flow: { name: '全國賽' },
	records: []
});

const store = (name: string) => {
	const fake = scenarioShell('offline.json', name);
	return { fake, store: shellOfflineStore(appShell(fake.bridge)) };
};

describe('App 裡的離線存放', () => {
	it('沒傳的紀錄存了讀得回來、都空了就刪掉、全部丟掉', async () => {
		const { fake, store: s } = store('沒傳的紀錄存了讀得回來、刪得掉、全部丟掉');
		expect(await s.unsent()).toEqual([]);
		await s.saveUnsent(unsent('c1', '全國賽', 't1'));
		expect(await s.unsent()).toEqual([unsent('c1', '全國賽', 't1')]);
		await s.saveUnsent({ ...unsent('c1', '全國賽', 't1'), dropped: [] });
		expect(await s.unsent()).toEqual([]);
		await s.saveUnsent(unsent('c2', '練習', 't2'));
		await s.clearUnsent();
		expect(await s.unsent()).toEqual([]);
		fake.done();
	});

	it('離線副本存了列得出來（不帶音樂）、音樂另外拿、沒給音樂時音樂不動、刪得掉', async () => {
		const { fake, store: s } = store('離線副本存了列得出來、音樂另外一個一個拿、刪得掉');
		await s.saveCopy(copy(1767225600000, 3), { a1: new Uint8Array([1, 2, 3]) });
		expect(await s.copies()).toEqual([copy(1767225600000, 3)]);
		expect(await s.copyAudio('c1')).toEqual({ a1: new Uint8Array([1, 2, 3]) });
		await s.saveCopy(copy(1767225700000, 4));
		expect(await s.copyAudio('c1')).toEqual({ a1: new Uint8Array([1, 2, 3]) });
		await s.dropCopy('c1');
		expect(await s.copies()).toEqual([]);
		expect(await s.copyAudio('c1')).toEqual({});
		fake.done();
	});

	it('登出：離線副本和這台登入的是誰清掉，沒傳的紀錄留著（跟網頁版一樣）', async () => {
		const { fake, store: s } = store('登出：離線副本和這台登入的是誰清掉，沒傳的紀錄留著');
		const here = { me: { email: 'lin@example.com', name: '林教練', isAdmin: false }, cloudIds: ['c1'] };
		expect(await s.signedInHere()).toBeNull();
		await s.saveSignedInHere(here);
		expect(await s.signedInHere()).toEqual(here);
		await s.saveCopy(copy(1767225600000, 3));
		await s.saveUnsent(unsent('c1', '全國賽', 't1'));
		await s.clearCopies();
		expect(await s.copies()).toEqual([]);
		expect(await s.signedInHere()).toBeNull();
		expect(await s.unsent()).toEqual([unsent('c1', '全國賽', 't1')]);
		fake.done();
	});

	it('殼存不了：跟網頁版一樣不丟錯（只是沒存到）', async () => {
		const { store: s } = store('不像流程 id、音樂 id 的不存');
		await s.saveCopy({ ...copy(0, 0), flowId: '../x' } as OfflineCopy);
		expect(await s.copies()).toEqual([]);
	});

	it('殼讀不到（殼回錯）：當作沒有，打開流程、首頁不會卡住', async () => {
		const failing = shellOfflineStore({ ...appShell(scenarioShell('offline.json', '不像流程 id、音樂 id 的不存').bridge), send: () => Promise.reject(new Error('failed')) });
		expect(await failing.unsent()).toEqual([]);
		expect(await failing.copies()).toEqual([]);
		expect(await failing.copyAudio('c1')).toEqual({});
		expect(await failing.signedInHere()).toBeNull();
	});

	it('App 裡不提醒加到主畫面', () => {
		const { store: s } = store('不像流程 id、音樂 id 的不存');
		expect(s.needsHomeScreen()).toBe(false);
	});
});

describe('換不換成殼的離線存放', () => {
	it('殼會存離線存放：編輯器、登入頁、帳號頁建的都是殼的', async () => {
		const fake = scenarioShell('offline.json', '不像流程 id、音樂 id 的不存');
		window.__cheerShell = fake.bridge;
		const undo = useShellIfInApp();
		try {
			expect(host().createOfflineStore).not.toBe(createIndexedDbOfflineStore);
			expect(host().createOfflineStore().needsHomeScreen()).toBe(false);
		} finally {
			undo?.();
		}
		expect(host().createOfflineStore).toBe(createIndexedDbOfflineStore);
	});

	it('殼不會（比這版舊的殼）、網頁版：照舊存在瀏覽器裡', () => {
		const fake = scenarioShell('shell.json', '一開始塞殼的版本、建置號、會什麼');
		window.__cheerShell = fake.bridge;
		const undo = useShellIfInApp();
		try {
			expect(host().createOfflineStore).toBe(createIndexedDbOfflineStore);
		} finally {
			undo?.();
		}
		fake.done();
	});
});
