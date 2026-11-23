// 在 App 裡打開流程檔（#384）：從「檔案」點 .cheer、LINE 分享交給 App 的，殼收著、網頁拿來照開檔的規則打開；
// 點流程檔打開 App 時開那個檔，不開上次那支。App 裡按「開啟流程檔」請殼叫出選檔畫面。說的話：bridge-scenarios/current/openFile.json。
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { appShell } from '#lib/app-shell.js';
import { scenarioShell } from '#lib/scenario-shell.js';
import { createFlow, renameFlow, writeFlowFile } from '#lib/core';
import type { Shell } from '#lib/host.js';
import { OPEN_FILE_FEATURE, shellFilePicker } from '#lib/shell-open-file.js';
import { fakeDraftStore, fakeHost, fakeSaver, fakeSettings, flush, testEditor } from '#lib/test-fakes.js';
import { flowOf } from '#lib/test-flows.js';

const contest = () => flowOf(createFlow({ name: '全國賽', field: { strips: 9, layout: 'vertical' } }));
const practice = () => flowOf(createFlow({ name: '練習', field: { strips: 9, layout: 'vertical' } }));

const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** 會開流程檔（也會存小設定）的殼：手上收著 handed 那個檔，拿一次就沒了；say() 是殼說 fileOpened。 */
function handingShell(handed: { name: string; bytes: Uint8Array } | null, features = [OPEN_FILE_FEATURE, 'settings']) {
	let held = handed;
	let listener: (() => void) | null = null;
	const shell: Shell = {
		inApp: true,
		can: (feature) => features.includes(feature),
		async send(name) {
			if (name !== 'takeOpenedFile') throw new Error('unknown');
			const r = held && { name: held.name, bytes: base64(held.bytes) };
			held = null;
			return r;
		},
		on(name, fn) {
			if (name === 'fileOpened') listener = () => fn(null);
			return () => (listener = null);
		}
	};
	return {
		shell,
		hand(file: { name: string; bytes: Uint8Array }) {
			held = file;
			listener?.();
		}
	};
}

describe('從「檔案」或 LINE 打開流程檔', () => {
	it('App 開著：殼說一聲，網頁拿那個檔打開（照情境）', async () => {
		const fake = scenarioShell('openFile.json', 'App 開著時從「檔案」或 LINE 打開：殼說一聲，網頁拿那個檔打開');
		fakeHost({ shell: appShell(fake.bridge) });
		const { editor, session } = testEditor(null);
		const disconnect = editor.file.connect();
		await flush();
		expect(session.flow).toBeNull();
		fake.say();
		await flush();
		await flush();
		expect(session.flow?.name).toBe('全國賽');
		expect(session.notice).toContain('全國賽.cheer');
		disconnect();
		fake.done();
	});

	it('點流程檔打開 App：開那個檔；重新載入（拿過了）不會又打開（照情境）', async () => {
		const fake = scenarioShell('openFile.json', '點流程檔打開 App：網頁一開始先拿那個檔；拿過就沒了，重新載入不會又打開');
		fakeHost({ shell: appShell(fake.bridge) });
		const first = testEditor(null);
		let disconnect = first.editor.file.connect();
		await flush();
		await flush();
		expect(first.session.flow?.name).toBe('全國賽');
		disconnect();
		const again = testEditor(null);
		disconnect = again.editor.file.connect();
		await flush();
		expect(again.session.flow).toBeNull();
		disconnect();
		fake.done();
	});

	it('點流程檔打開 App、記著上次那支：開那個檔，不開上次那支', async () => {
		const drafts = fakeDraftStore();
		await drafts.store.save('n1', writeFlowFile(practice(), {}));
		const { settings } = fakeSettings({ 'cheer-editor:lastFlow': 'n1' });
		const { shell } = handingShell({ name: '全國賽.cheer', bytes: writeFlowFile(contest(), {}) });
		fakeHost({ shell, settings });
		const { editor, session } = testEditor(null, { draftStore: drafts.store });
		const disconnect = editor.file.connect();
		await flush();
		await flush();
		expect(session.flow?.name).toBe('全國賽');
		expect(editor.file.reopening).toBe(false);
		// 上次那支的草稿還在
		expect(drafts.all.has('n1')).toBe(true);
		disconnect();
	});

	it('原本停在別支流程、有沒存的修改：照「開別支」先問，不悄悄丟掉；答應了才開', async () => {
		const { shell, hand } = handingShell(null);
		fakeHost({ shell });
		const { editor, session } = testEditor(null);
		const disconnect = editor.file.connect();
		await flush();
		editor.file.create(practice());
		session.change(flowOf(renameFlow(session.flow!, '練習二')));
		expect(session.unsaved).toBe(true);
		const file = { name: '全國賽.cheer', bytes: writeFlowFile(contest(), {}) };
		hand(file);
		await flush();
		await flush();
		expect(editor.file.askingToOpen).toBe(true);
		expect(session.flow?.name).toBe('練習二');
		// 取消：留著原本那支和它的修改
		await editor.file.answer('cancel');
		expect(session.flow?.name).toBe('練習二');
		expect(session.unsaved).toBe(true);
		// 再點一次、這次答應丟掉：才開
		hand(file);
		await flush();
		await flush();
		expect(editor.file.askingToOpen).toBe(true);
		await editor.file.answer('discard');
		expect(session.flow?.name).toBe('全國賽');
		disconnect();
	});

	it('Mac 的 LINE 包了兩層的也打得開', async () => {
		const inner = writeFlowFile(contest(), {});
		const { shell } = handingShell({ name: '全國賽.zip', bytes: zipSync({ '全國賽.cheer': inner }) });
		fakeHost({ shell });
		const { editor, session } = testEditor(null);
		const disconnect = editor.file.connect();
		await flush();
		await flush();
		expect(session.flow?.name).toBe('全國賽');
		disconnect();
	});

	it('不是流程檔：首頁說打不開', async () => {
		const { shell } = handingShell({ name: '筆記.cheer', bytes: strToU8('hello') });
		fakeHost({ shell });
		const { editor, session } = testEditor(null);
		const disconnect = editor.file.connect();
		await flush();
		await flush();
		expect(session.flow).toBeNull();
		expect(editor.file.openError).toContain('筆記.cheer');
		disconnect();
	});

	it('殼不會（舊殼、網頁版）：不問殼', async () => {
		const { shell } = handingShell({ name: '全國賽.cheer', bytes: writeFlowFile(contest(), {}) }, ['settings']);
		fakeHost({ shell });
		const { editor, session } = testEditor(null);
		const disconnect = editor.file.connect();
		await flush();
		await flush();
		expect(session.flow).toBeNull();
		disconnect();
	});
});

describe('App 裡按「開啟流程檔」', () => {
	it('殼叫出選檔畫面，選了就打開（照情境）', async () => {
		const fake = scenarioShell('openFile.json', 'App 裡按「開啟流程檔」：殼叫出選檔畫面，選了回那個檔');
		const shell = appShell(fake.bridge);
		fakeHost({ shell });
		const { editor, session } = testEditor(null, { pickFlowFile: shellFilePicker(shell, () => fakeSaver().saver) });
		expect(editor.file.canPick).toBe(true);
		await editor.file.pick();
		await flush();
		expect(session.flow?.name).toBe('全國賽');
		expect(session.notice).toContain('全國賽.zip');
		fake.done();
	});

	it('按取消：不開（照情境）', async () => {
		const fake = scenarioShell('openFile.json', '選檔畫面按取消：回 null，不開');
		const shell = appShell(fake.bridge);
		fakeHost({ shell });
		const { editor, session } = testEditor(null, { pickFlowFile: shellFilePicker(shell, () => fakeSaver().saver) });
		await editor.file.pick();
		expect(session.flow).toBeNull();
		expect(editor.file.openError).toBe('');
		fake.done();
	});
});
