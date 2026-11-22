// 草稿存在殼裡（#377）：App 裡的草稿存放問殼。殼用照情境檔演的假殼（bridge-scenarios/current/drafts.json），殼的測試跑同一份。
import { afterEach, describe, expect, it } from 'vitest';
import { browserHost, host } from '#lib/host.js';
import { appShell, useShellIfInApp } from '#lib/app-shell.js';
import { createIndexedDbDraftStore } from '#lib/file/draft.js';
import { scenarioShell } from '#lib/scenario-shell.js';
import { shellDraftStore } from '#lib/shell-drafts.js';
import { addSegment, createFlow, readFlowFile } from '#lib/core';
import { fakeDraftStore, fakeHost, flush, testEditor } from '#lib/test-fakes.js';
import { flowOf } from '#lib/test-flows.js';

afterEach(() => {
	delete window.__cheerShell;
});

const at = new Date(Date.UTC(2026, 0, 1));

describe('App 裡的草稿存放', () => {
	it('存了列得出來、讀得回來、蓋得掉、清得掉', async () => {
		const fake = scenarioShell('drafts.json', '存了草稿列得出來、讀得回來、蓋得掉、清得掉');
		const store = shellDraftStore(appShell(fake.bridge));
		expect(await store.list()).toEqual([]);
		await store.save('n1', new Uint8Array([1, 2, 3]));
		expect(await store.list()).toEqual([{ id: 'n1', savedAt: at }]);
		expect(await store.load('n1')).toEqual({ id: 'n1', bytes: new Uint8Array([1, 2, 3]), savedAt: at });
		await store.save('n1', new Uint8Array([4, 5]));
		expect(await store.load('n1')).toEqual({ id: 'n1', bytes: new Uint8Array([4, 5]), savedAt: at });
		await store.clear('n1');
		expect(await store.load('n1')).toBeNull();
		expect(await store.list()).toEqual([]);
		fake.done();
	});

	it('沒有的草稿是 null；殼存不了就 reject（呼叫端當作草稿只是保險）', async () => {
		const fake = scenarioShell('drafts.json', '沒有的草稿讀到 null；不像草稿 id 的不存');
		const store = shellDraftStore(appShell(fake.bridge));
		expect(await store.load('current')).toBeNull();
		await expect(store.save('../x', new Uint8Array([1, 2, 3]))).rejects.toThrow('failed');
		expect(await store.list()).toEqual([]);
		fake.done();
	});

	it('存的當下就把整包交給殼（關掉 App 前那一下也來得及送出），不先等別的', () => {
		const sent: unknown[] = [];
		const store = shellDraftStore({ ...browserHost.shell, inApp: true, send: (name, body) => (sent.push({ name, body }), Promise.resolve(null)) });
		void store.save('n1', new Uint8Array([1, 2, 3]));
		expect(sent).toEqual([{ name: 'draftSave', body: { id: 'n1', bytes: 'AQID' } }]);
	});
});

describe('換不換成殼的草稿存放', () => {
	it('殼會存草稿：App 裡的草稿存在殼裡', async () => {
		const fake = scenarioShell('drafts.json', '沒有的草稿讀到 null；不像草稿 id 的不存');
		window.__cheerShell = fake.bridge;
		const undo = useShellIfInApp();
		try {
			expect(await host().createDraftStore().load('current')).toBeNull();
		} finally {
			undo?.();
		}
		expect(host().createDraftStore).toBe(createIndexedDbDraftStore);
	});

	it('殼不會（比這版舊的殼）、網頁版：照舊存在瀏覽器裡', () => {
		const fake = scenarioShell('shell.json', '一開始塞殼的版本、建置號、會什麼');
		window.__cheerShell = fake.bridge;
		const undo = useShellIfInApp();
		try {
			expect(host().createDraftStore).toBe(createIndexedDbDraftStore);
		} finally {
			undo?.();
		}
		expect(browserHost.createDraftStore).toBe(createIndexedDbDraftStore);
		fake.done();
	});
});

describe('要切到背景', () => {
	it('殼說要切到背景：還沒進草稿的改動馬上存，不等停手 1 秒（滑掉 App 前那一下）', async () => {
		const fake = scenarioShell('drafts.json', '要切到背景時殼說一聲，網頁馬上把還沒進草稿的改動存起來');
		fakeHost({ shell: appShell(fake.bridge) });
		const drafts = fakeDraftStore();
		const { editor, session } = testEditor(null, { draftStore: drafts.store });
		const disconnect = editor.file.connect();
		await flush();
		editor.file.create(flowOf(createFlow({ name: '全國賽', field: { strips: 9, layout: 'vertical' } })));
		await flush();
		session.change(flowOf(addSegment(session.flow!, 'chant')));
		fake.say();
		const r = readFlowFile(drafts.latest()!);
		expect(r.kind === 'ok' && r.flow.segments).toHaveLength(1);
		disconnect();
		fake.done();
	});
});
