// 打開 App 就回上次那支（#378，規格 #360「用起來更順」第 1 條）：網頁記、網頁開，殼只存（小設定的 cheer-editor:lastFlow）。
// 離開 App（殼說 background）時在本機流程裡就記那支，在首頁就清掉；打開時有記就直接開那支，不見了就停在首頁。網頁版不記也不開。
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';
import { appShell, useShellIfInApp } from '#lib/app-shell.js';
import { scenarioShell } from '#lib/scenario-shell.js';
import { createFlow, writeFlowFile } from '#lib/core';
import { fakeDraftStore, fakeHost, fakeSettings, flush, testEditor } from '#lib/test-fakes.js';
import { flowOf } from '#lib/test-flows.js';

afterEach(() => {
	delete window.__cheerShell;
});

const contest = () => flowOf(createFlow({ name: '全國賽', field: { strips: 9, layout: 'vertical' } }));

/** 殼說要切到背景（App 裡才會說）。 */
function shellThatGoesAway() {
	let listener: (() => void) | null = null;
	const shell = { ...appShell(scenarioShell('shell.json', '一開始塞殼的版本、建置號、會什麼').bridge) };
	shell.on = (name, fn) => {
		if (name === 'background') listener = () => fn(null);
		return () => (listener = null);
	};
	return { shell, goAway: () => listener?.() };
}

describe('離開 App 時記下上次那支', () => {
	it('在首頁切到背景：上次那支清掉（照情境寫回殼）', async () => {
		const fake = scenarioShell('settings.json', '在首頁切到背景：上次那支清掉，下次打開停在首頁');
		window.__cheerShell = fake.bridge;
		const undo = useShellIfInApp();
		onTestFinished(() => undo?.());
		const { editor } = testEditor(null);
		const disconnect = editor.file.connect();
		await flush();
		fake.say();
		await flush();
		disconnect();
		fake.done();
	});

	it('在本機流程裡切到背景：記那支（就是它的草稿）', async () => {
		const { shell, goAway } = shellThatGoesAway();
		const { settings, saved } = fakeSettings();
		fakeHost({ shell, settings });
		const drafts = fakeDraftStore();
		const { editor } = testEditor(null, { draftStore: drafts.store });
		const disconnect = editor.file.connect();
		await flush();
		editor.file.create(contest());
		goAway();
		await flush();
		expect([...drafts.all.keys()]).toHaveLength(1);
		expect(saved.get('cheer-editor:lastFlow')).toBe([...drafts.all.keys()][0]);
		disconnect();
	});
});

describe('打開 App 回上次那支', () => {
	it('上次那支還在：一打開就開它，不先讀最近的流程', async () => {
		const bytes = writeFlowFile(contest(), {});
		const drafts = fakeDraftStore();
		await drafts.store.save('n1', bytes);
		const { settings } = fakeSettings({ 'cheer-editor:lastFlow': 'n1' });
		fakeHost({ shell: shellThatGoesAway().shell, settings });
		const { editor, session } = testEditor(null, { draftStore: drafts.store });
		expect(editor.file.reopening).toBe(true);
		const disconnect = editor.file.connect();
		await flush();
		await flush();
		expect(session.flow?.name).toBe('全國賽');
		expect(editor.file.reopening).toBe(false);
		expect(editor.file.recent).toEqual([]);
		disconnect();
	});

	it('上次那支不見了（草稿沒了）：停在首頁，不說錯', async () => {
		const { settings } = fakeSettings({ 'cheer-editor:lastFlow': 'n1' });
		fakeHost({ shell: shellThatGoesAway().shell, settings });
		const { editor, session } = testEditor(null);
		const disconnect = editor.file.connect();
		await flush();
		await flush();
		expect(session.flow).toBeNull();
		expect(editor.file.reopening).toBe(false);
		expect(editor.file.openError).toBe('');
		disconnect();
	});

	it('網頁版：就算記著也不開，停在首頁', async () => {
		const drafts = fakeDraftStore();
		await drafts.store.save('n1', writeFlowFile(contest(), {}));
		const { settings } = fakeSettings({ 'cheer-editor:lastFlow': 'n1' });
		fakeHost({ settings });
		const { editor, session } = testEditor(null, { draftStore: drafts.store });
		expect(editor.file.reopening).toBe(false);
		const disconnect = editor.file.connect();
		await flush();
		await flush();
		expect(session.flow).toBeNull();
		expect(editor.file.recent.map((f) => f.name)).toEqual(['全國賽']);
		disconnect();
	});
});
