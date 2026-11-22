// 打開 App 就回上次那支（#378，規格 #360「用起來更順」第 1 條）：網頁記、網頁開，殼只存（小設定的 cheer-editor:lastFlow）。
// 離開 App（殼說 background）時在本機流程裡就記那支，在首頁就清掉；打開時有記就直接開那支，不見了就停在首頁。網頁版不記也不開。
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';
import { useShellIfInApp } from '#lib/app-shell.js';
import { scenarioShell } from '#lib/scenario-shell.js';
import { createFlow, writeFlowFile } from '#lib/core';
import { cloudEditor, fakeDraftStore, fakeHost, fakeOfflineStore, fakeSettings, fakeShell, flush, testEditor } from '#lib/test-fakes.js';
import { flowOf, libSample } from '#lib/test-flows.js';
import { localDate } from '#lib/local-date.js';

afterEach(() => {
	delete window.__cheerShell;
});

const contest = () => flowOf(createFlow({ name: '全國賽', field: { strips: 9, layout: 'vertical' } }));

/** 會存小設定的殼，說要切到背景（App 裡才會說）。features 換掉殼會的。 */
function shellThatGoesAway(features = ['settings']) {
	let listener: (() => void) | null = null;
	const shell = { ...fakeShell(features) };
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

	it('殼不會存小設定（小設定還在網頁裡）：不記也不開，停在首頁', async () => {
		const drafts = fakeDraftStore();
		await drafts.store.save('n1', writeFlowFile(contest(), {}));
		const { settings, saved } = fakeSettings({ 'cheer-editor:lastFlow': 'n1' });
		const { shell, goAway } = shellThatGoesAway(['drafts']);
		fakeHost({ shell, settings });
		const { editor, session } = testEditor(null, { draftStore: drafts.store });
		expect(editor.file.reopening).toBe(false);
		const disconnect = editor.file.connect();
		await flush();
		await flush();
		expect(session.flow).toBeNull();
		goAway();
		expect(saved.get('cheer-editor:lastFlow')).toBe('n1');
		disconnect();
	});
});

// 上次那支是雲端流程（#383）：先開這台的離線副本（只能看、能記），連上了自動換成最新的、可以改。
const LIN = 'lin@example.com';
const WANG = 'wang@example.com';

/** 林教練在 App 裡打開過 c1（留了離線副本）、回首頁；cloud 換掉 c1 的權限。 */
async function openedBefore(cloud: Parameters<typeof cloudEditor>[0] = {}) {
	const offline = fakeOfflineStore();
	const s = await cloudEditor(cloud, { offline: offline.store });
	await s.editor.file.leaveToHome();
	await flush();
	return { ...s, offline };
}

/** 關掉再開 App：上次那支記著 last，新的編輯器用同一個伺服器和離線存放，打開頁面。 */
function reopenApp(s: Awaited<ReturnType<typeof openedBefore>>, last = 'cloud:c1') {
	const { settings } = fakeSettings({ 'cheer-editor:lastFlow': last });
	fakeHost({ shell: shellThatGoesAway().shell, settings });
	const t = testEditor(null, { server: s.server, offline: s.offline.store });
	const disconnect = t.editor.file.connect();
	onTestFinished(disconnect);
	return t;
}

/** 用「記」的問題記一次（第 1 組上法）：回被擋的原因（空字串是記了）。 */
function record(session: ReturnType<typeof testEditor>['session']) {
	const ask = session.recordAsk();
	ask.send({ name: 'recordAttempt', args: ['x1', { date: localDate(), who: 'g1', practice: 'drill', whole: true, marks: { p1: '✓' } }] });
	return ask.error;
}

const settle = async (times = 6) => {
	for (let i = 0; i < times; i++) await flush();
};

describe('上次那支是雲端流程', () => {
	it('在雲端流程裡切到背景：記那支（雲端流程的 id）', async () => {
		const { shell, goAway } = shellThatGoesAway();
		const { settings, saved } = fakeSettings({ 'cheer-editor:lastFlow': 'n1' });
		const s = await openedBefore();
		fakeHost({ shell, settings });
		await s.editor.file.openCloud('c1');
		await flush();
		const disconnect = s.editor.file.connect();
		await flush();
		goAway();
		expect(saved.get('cheer-editor:lastFlow')).toBe('cloud:c1');
		disconnect();
	});

	it('有離線副本：打開馬上是離線副本（不等伺服器），只能看、能記；連上了自動換成最新的、可以改', async () => {
		const s = await openedBefore();
		s.state.holdRoom = true;
		const { editor, session } = reopenApp(s);
		expect(editor.file.reopening).toBe(true);
		await settle(2);
		expect(editor.file.reopening).toBe(false);
		expect(session.flow?.name).toBe(libSample().name);
		expect(editor.file.source.kind).toBe('offline');
		expect(editor.file.can(true).edit.ok).toBe(false);
		expect(editor.file.can(true).record.ok).toBe(true);

		s.releaseRoom();
		await settle();
		expect(editor.file.source.kind).toBe('cloud');
		expect(editor.file.can(true).edit.ok).toBe(true);
	});

	it('換成最新的時：離線副本裡有的音樂不再下載', async () => {
		const flow = libSample();
		flow.audio = [{ id: 'a1', file: 'audio/a1.mp3', name: 'song.mp3' }];
		const s = await openedBefore({ flow, audio: { a1: new Uint8Array([1, 2, 3]) } });
		const downloads: string[] = [];
		const get = s.server.audioBytes.bind(s.server);
		s.server.audioBytes = (flowId, audioId) => (downloads.push(audioId), get(flowId, audioId));
		const { editor } = reopenApp(s);
		await settle(10);
		expect(editor.file.source.kind).toBe('cloud');
		expect(downloads).toEqual([]);
		expect([...(editor.music.bytes(editor.session.flow!).a1 ?? [])]).toEqual([1, 2, 3]);
		expect([...(s.offline.audioOf('c1')?.a1 ?? [])]).toEqual([1, 2, 3]);
	});

	it('還沒連上那一下記的：連上後傳上去，只有一筆', async () => {
		const s = await openedBefore();
		s.state.holdRoom = true;
		const { editor, session } = reopenApp(s);
		await settle(2);
		expect(record(session)).toBe('');
		await flush();
		s.releaseRoom();
		await settle(10);
		expect(editor.file.source.kind).toBe('cloud');
		expect(s.state.flows[0].records ?? []).toHaveLength(1);
		expect(session.flow!.actions.flatMap((a) => a.successRate?.records ?? [])).toHaveLength(1);
		expect(editor.file.cloud!.unsentCount).toBe(0);
	});

	it('分享被收回：先開離線副本，連上時回首頁說原因，離線副本刪掉', async () => {
		const s = await openedBefore({ owner: WANG, people: { [LIN]: 'editor' } });
		s.changeRole('c1', LIN, null);
		const { editor, session } = reopenApp(s);
		await settle();
		expect(session.flow).toBeNull();
		expect(editor.file.revoked).toContain('不能打開');
		expect(s.offline.copy('c1')).toBeNull();
	});

	it('流程被刪了：回首頁', async () => {
		const s = await openedBefore();
		s.deleteFlow('c1');
		const { session } = reopenApp(s);
		await settle();
		expect(session.flow).toBeNull();
	});

	it('沒有離線副本：照現在等伺服器打開', async () => {
		const s = await openedBefore();
		await s.offline.store.dropCopy('c1');
		const { editor } = reopenApp(s);
		await settle();
		expect(editor.file.source.kind).toBe('cloud');
		expect(editor.file.can(true).edit.ok).toBe(true);
	});

	it('網頁版：記著雲端流程也不開，停在首頁', async () => {
		const s = await openedBefore();
		const { settings } = fakeSettings({ 'cheer-editor:lastFlow': 'cloud:c1' });
		fakeHost({ settings });
		const { editor, session } = testEditor(null, { server: s.server, offline: s.offline.store });
		const disconnect = editor.file.connect();
		await settle();
		expect(session.flow).toBeNull();
		disconnect();
	});
});
