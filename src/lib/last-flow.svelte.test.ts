// 打開 App 就回上次那支（#378，規格 #360「用起來更順」第 1 條）：網頁記、網頁開，殼只存（小設定的 cheer-editor:lastFlow）。
// 離開 App（殼說 background）時在本機流程裡就記那支，在首頁就清掉；打開時有記就直接開那支，不見了就停在首頁。網頁版不記也不開。
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';
import { useShellIfInApp } from '#lib/app-shell.js';
import { scenarioShell } from '#lib/scenario-shell.js';
import { createFlow, readFlowFile, writeFlowFile } from '#lib/core';
import { cloudEditor, fakeDraftStore, fakeHost, fakeOfflineStore, fakeSettings, fakeShell, flush, testEditor } from '#lib/test-fakes.js';
import { flowOf, libSample } from '#lib/test-flows.js';
import type { Flow } from '#lib/core';
import type { EditorAdapters } from '#lib/editor.svelte.js';
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

	it('打開流程就記、回首頁就清（不等切到背景）：在首頁換上新網頁、重新載入，回首頁', async () => {
		const { settings, saved } = fakeSettings({ 'cheer-editor:lastFlow': 'old' });
		fakeHost({ shell: shellThatGoesAway().shell, settings });
		const drafts = fakeDraftStore();
		const { editor } = testEditor(null, { draftStore: drafts.store });
		const disconnect = editor.file.connect();
		await flush();
		editor.file.create(contest());
		await flush();
		expect(saved.get('cheer-editor:lastFlow')).toBe([...drafts.all.keys()][0]);
		await editor.file.leaveToHome();
		await flush();
		expect(saved.has('cheer-editor:lastFlow')).toBe(false);
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

// 回上次那支時，草稿就是那個檔（沒改過）還是改過沒存（#379 不再整個檔算一次 id 也要一樣）
describe('回上次那支：改過沒存的照樣算未存', () => {
	const named = (name: string) => flowOf(createFlow({ name, field: { strips: 9, layout: 'vertical' } }));

	/** 從檔案開過 name 那支（草稿 id 照檔案算），回傳它的草稿 id。 */
	async function openedFromFile(drafts: ReturnType<typeof fakeDraftStore>, name: string): Promise<string> {
		fakeHost({ shell: shellThatGoesAway().shell, settings: fakeSettings().settings });
		const { editor } = testEditor(null, { draftStore: drafts.store });
		const disconnect = editor.file.connect();
		await flush();
		await editor.file.open(new File([writeFlowFile(named(name), {}) as Uint8Array<ArrayBuffer>], `${name}.zip`));
		await flush();
		disconnect();
		const id = [...drafts.all.keys()][0];
		expect(id).toMatch(/^f/);
		return id;
	}

	/** 關掉再開 App：上次那支是 id。 */
	async function reopen(drafts: ReturnType<typeof fakeDraftStore>, id: string) {
		const { settings } = fakeSettings({ 'cheer-editor:lastFlow': id });
		fakeHost({ shell: shellThatGoesAway().shell, settings });
		const t = testEditor(null, { draftStore: drafts.store });
		const disconnect = t.editor.file.connect();
		onTestFinished(disconnect);
		await flush();
		await flush();
		return t;
	}

	it('新建的（草稿 id 不是照檔案算的）：還算未存', async () => {
		const drafts = fakeDraftStore();
		await drafts.store.save('n1', writeFlowFile(named('全國賽'), {}));
		const { session } = await reopen(drafts, 'n1');
		expect(session.flow?.name).toBe('全國賽');
		expect(session.unsaved).toBe(true);
	});

	it('從檔案開、沒改過：算存過的', async () => {
		const drafts = fakeDraftStore();
		const id = await openedFromFile(drafts, '全國賽');
		const { session } = await reopen(drafts, id);
		expect(session.flow?.name).toBe('全國賽');
		expect(session.unsaved).toBe(false);
	});

	it('從檔案開、改過沒存（檔案一樣長）：還算未存', async () => {
		const drafts = fakeDraftStore();
		const id = await openedFromFile(drafts, '全國賽');
		const opened = readFlowFile(drafts.all.get(id)!.bytes);
		if (opened.kind !== 'ok') throw new Error('草稿打不開');
		// 壓縮過的長度跟著內容變：挑一個改了名字還一樣長的
		const length = drafts.all.get(id)!.bytes.length;
		const name = [...'杯盃季隊組區市縣'].map((c) => `全國${c}`).find((n) => writeFlowFile({ ...opened.flow, name: n }, {}).length === length);
		expect(name).toBeDefined();
		await drafts.store.save(id, writeFlowFile({ ...opened.flow, name: name! }, {}));
		const { session } = await reopen(drafts, id);
		expect(session.flow?.name).toBe(name);
		expect(session.unsaved).toBe(true);
	});

	it('從檔案開、改過沒存（檔案長度變了）：還算未存', async () => {
		const drafts = fakeDraftStore();
		const id = await openedFromFile(drafts, '全國賽');
		await drafts.store.save(id, writeFlowFile(named('全國賽決賽'), {}));
		const { session } = await reopen(drafts, id);
		expect(session.flow?.name).toBe('全國賽決賽');
		expect(session.unsaved).toBe(true);
	});
});

// 回上次那支先畫場地，音樂之後才解碼好（#379）：解碼要 0.3–0.6 秒（模擬器），不等它
describe('回上次那支：音樂還在載入', () => {
	/** 有一段音樂（song.mp3）的流程。 */
	function withSong(): Flow {
		const flow = libSample();
		flow.audio = [{ id: 'a1', file: 'audio/a1.mp3', name: 'song.mp3' }];
		flow.segments = flow.segments.map((seg) => (seg.kind === 'music' ? { ...seg, audioId: 'a1' } : seg));
		return flow;
	}

	/** 解碼等 finish() 才好（低耗電的 iPhone 很慢）。 */
	function slowDecode() {
		const waiting: (() => void)[] = [];
		const decode = (() => new Promise((ok) => waiting.push(() => ok({ durationSec: 30, peaks: [] })))) as EditorAdapters['decode'];
		return { decode, finish: () => waiting.splice(0).forEach((go) => go()) };
	}

	async function reopenWithSong() {
		const drafts = fakeDraftStore();
		await drafts.store.save('n1', writeFlowFile(withSong(), { a1: new Uint8Array([1, 2, 3]) }));
		const { settings } = fakeSettings({ 'cheer-editor:lastFlow': 'n1' });
		fakeHost({ shell: shellThatGoesAway().shell, settings });
		const slow = slowDecode();
		const t = testEditor(null, { draftStore: drafts.store, decode: slow.decode });
		const disconnect = t.editor.file.connect();
		onTestFinished(disconnect);
		await flush();
		await flush();
		return { ...t, drafts, finish: slow.finish };
	}

	it('不等音樂解碼好就開好（場地先出來）；音樂載入中，不標「找不到音樂」', async () => {
		const { editor, session, finish } = await reopenWithSong();
		expect(editor.file.reopening).toBe(false);
		expect(session.flow?.name).toBe('測試');
		expect(editor.music.loading).toBe(true);
		expect(editor.music.missingSegmentIds).toEqual([]);
		finish();
		await flush();
		expect(editor.music.loading).toBe(false);
		expect(editor.music.lengths).toEqual({ a1: 30 });
	});

	it('音樂還在載入：不能播（播放鍵、空白鍵、鎖定畫面、試聽都一樣），載入好了才能播', async () => {
		const { editor, finish } = await reopenWithSong();
		editor.playback.play();
		expect(editor.playback.playing).toBe(false);
		editor.playback.space(false);
		expect(editor.playback.playing).toBe(false);
		editor.playback.preview('s1');
		expect(editor.playback.previewing).toBe(false);
		finish();
		await flush();
		editor.playback.play();
		expect(editor.playback.playing).toBe(true);
	});

	it('音樂解完才知道解不開：那時才說（開好時不說）', async () => {
		const drafts = fakeDraftStore();
		await drafts.store.save('n1', writeFlowFile(withSong(), { a1: new Uint8Array([1, 2, 3]) }));
		const { settings } = fakeSettings({ 'cheer-editor:lastFlow': 'n1' });
		fakeHost({ shell: shellThatGoesAway().shell, settings });
		let fail = () => {};
		const decode = (() => new Promise((_, no) => (fail = () => no(new Error('bad'))))) as EditorAdapters['decode'];
		const { editor, session } = testEditor(null, { draftStore: drafts.store, decode });
		onTestFinished(editor.file.connect());
		await flush();
		await flush();
		expect(session.flow?.name).toBe('測試');
		expect(session.notice).toBe('');
		fail();
		await flush();
		expect(editor.music.hasBroken).toBe(true);
		expect(session.notice).toContain('讀不出來');
	});

	it('音樂還在載入時存草稿（回首頁）：音樂照樣存進去，不會不見', async () => {
		const { editor, drafts } = await reopenWithSong();
		expect(editor.music.loading).toBe(true);
		await editor.file.leaveToHome();
		await flush();
		const r = readFlowFile(drafts.all.get('n1')!.bytes);
		expect(r.kind === 'ok' && [...(r.audio.a1 ?? [])]).toEqual([1, 2, 3]);
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
function reopenApp(s: Awaited<ReturnType<typeof openedBefore>>, last = 'cloud:c1', adapters: Partial<EditorAdapters> = {}) {
	const { settings } = fakeSettings({ 'cheer-editor:lastFlow': last });
	fakeHost({ shell: shellThatGoesAway().shell, settings });
	const t = testEditor(null, { server: s.server, offline: s.offline.store, ...adapters });
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

	it('打開雲端流程就記那支（不等切到背景）', async () => {
		const { settings, saved } = fakeSettings();
		const s = await openedBefore();
		fakeHost({ shell: shellThatGoesAway().shell, settings });
		const disconnect = s.editor.file.connect();
		await flush();
		await s.editor.file.openCloud('c1');
		await flush();
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

	it('有離線副本、帶音樂：不等音樂解碼好就開好（#379），音樂照樣留著', async () => {
		const flow = libSample();
		flow.audio = [{ id: 'a1', file: 'audio/a1.mp3', name: 'song.mp3' }];
		const s = await openedBefore({ flow, audio: { a1: new Uint8Array([1, 2, 3]) } });
		s.state.holdRoom = true;
		let finish = () => {};
		const decode = (() => new Promise((ok) => (finish = () => ok({ durationSec: 30, peaks: [] })))) as EditorAdapters['decode'];
		const { editor, session } = reopenApp(s, 'cloud:c1', { decode });
		await settle(2);
		expect(editor.file.reopening).toBe(false);
		expect(session.flow?.name).toBe(libSample().name);
		expect(editor.music.loading).toBe(true);
		expect([...(editor.music.bytes(session.flow!).a1 ?? [])]).toEqual([1, 2, 3]);
		finish();
		await flush();
		expect(editor.music.loading).toBe(false);
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

	it('沒有離線副本、等伺服器時在首頁建了一支：不被上次那支換掉，存進草稿', async () => {
		const s = await openedBefore();
		await s.offline.store.dropCopy('c1');
		const read = s.server.cloudFlow.bind(s.server);
		const held = Promise.withResolvers<void>();
		s.server.cloudFlow = async (id) => {
			await held.promise;
			return read(id);
		};
		const drafts = fakeDraftStore();
		const { editor, session } = reopenApp(s, 'cloud:c1', { draftStore: drafts.store });
		await flush();
		editor.file.create(contest());
		held.resolve();
		await settle();
		expect(session.flow?.name).toBe('全國賽');
		expect(editor.file.source.kind).toBe('local');
		await new Promise((r) => setTimeout(r, 1100));
		const names = [...drafts.all.values()].map((d) => {
			const r = readFlowFile(d.bytes);
			return r.kind === 'ok' ? r.flow.name : '';
		});
		expect(names).toContain('全國賽');
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
