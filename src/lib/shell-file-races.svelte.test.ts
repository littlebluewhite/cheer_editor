// App 裡打開、存流程檔撞在一起時（#384、#385 審查）：存檔還沒好就換了流程、兩個檔一前一後交來、
// 交檔時欄位裡還有沒送出的字、選檔畫面按取消後又從「檔案」交檔、殼讀不到交來的檔、電腦上救回草稿後存檔。
import { describe, expect, it } from 'vitest';
import { createFlow, readFlowFile, renameFlow, writeFlowFile } from '#lib/core';
import type { SaveOutcome } from '#lib/file/save.js';
import type { Shell } from '#lib/host.js';
import { OPEN_FILE_FEATURE } from '#lib/shell-open-file.js';
import { audioFlow, cloudEditor, fakeDraftStore, fakeHost, fakePendingInput, fakeSaver, fakeSettings, flush, testEditor } from '#lib/test-fakes.js';
import { flowOf } from '#lib/test-flows.js';

const contest = () => flowOf(createFlow({ name: '全國賽', field: { strips: 9, layout: 'vertical' } }));
const practice = () => flowOf(createFlow({ name: '練習', field: { strips: 9, layout: 'vertical' } }));

/** 等著的結果：resolve 了才回。 */
function later<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => (resolve = r));
	return { promise, resolve };
}

/** 會交檔（也會存小設定）的殼：held 是收著的檔；hand() 是「檔案」又交來一個、殼說 fileOpened；broken 時讀不到檔（拿的時候出錯）。 */
function handShell(handed: { name: string; bytes: Uint8Array } | null = null, init: { broken?: boolean } = {}) {
	let held = handed;
	const listeners = new Set<() => void>();
	const shell: Shell = {
		inApp: true,
		can: (feature) => [OPEN_FILE_FEATURE, 'settings'].includes(feature),
		async send(name) {
			if (name !== 'takeOpenedFile') throw new Error('unknown');
			if (init.broken && held) {
				held = null;
				throw new Error('read failed');
			}
			const r = held && { name: held.name, bytes: held.bytes.toBase64() };
			held = null;
			return r;
		},
		on(name, fn) {
			if (name !== 'fileOpened') return () => {};
			const l = () => fn(null);
			listeners.add(l);
			return () => listeners.delete(l);
		}
	};
	return {
		shell,
		hand(file: { name: string; bytes: Uint8Array }) {
			held = file;
			for (const l of listeners) l();
		}
	};
}

/** 等幾輪（開檔一路上的 await）。 */
async function settle(n = 6) {
	for (let i = 0; i < n; i++) await flush();
}

/** 草稿裡放一份「這個檔改過沒存」的：開那個檔、改名、切到背景存草稿。回傳那份草稿的 id。 */
async function changedDraftOf(drafts: ReturnType<typeof fakeDraftStore>, file: { name: string; bytes: Uint8Array }, rename: string) {
	const before = new Set(drafts.all.keys());
	const { editor, session } = testEditor(null, { draftStore: drafts.store });
	const disconnect = editor.file.connect();
	await settle();
	await editor.file.open(new File([file.bytes.slice()], file.name));
	session.change(flowOf(renameFlow(session.flow!, rename)));
	editor.file.pageHidden();
	await settle();
	disconnect();
	return [...drafts.all.keys()].find((id) => !before.has(id))!;
}

describe('存檔還沒好就換了流程（#385）', () => {
	it('存好時不丟換上來那支的草稿、不把它算成沒存', async () => {
		const pending = later<SaveOutcome>();
		const drafts = fakeDraftStore();
		fakeHost({ settings: fakeSettings().settings });
		const { editor, session } = testEditor(null, { draftStore: drafts.store, createSaver: () => ({ save: () => pending.promise }) });
		const disconnect = editor.file.connect();
		await settle();
		editor.file.create(contest());
		const saving = editor.file.save();
		const opening = editor.file.open(new File([writeFlowFile(practice(), {}).slice()], '練習.cheer'));
		await settle();
		if (editor.file.askingToOpen) await editor.file.answer('discard');
		await opening;
		await settle();
		expect(session.flow?.name).toBe('練習');
		const kept = [...drafts.all.keys()];
		pending.resolve('saved');
		await saving;
		await settle();
		expect(session.flow?.name).toBe('練習');
		expect(session.unsaved).toBe(false);
		for (const id of kept) expect(drafts.all.has(id)).toBe(true);
		disconnect();
	});
});

describe('兩個檔一前一後交來（#384）', () => {
	it('App 打開時第一個檔還在問草稿、又交來第二個：問完都開得了，之後照常存草稿', async () => {
		const drafts = fakeDraftStore();
		const a = { name: '全國賽.cheer', bytes: writeFlowFile(contest(), {}) };
		const b = { name: '練習.cheer', bytes: writeFlowFile(practice(), {}) };
		await changedDraftOf(drafts, a, '全國賽改');
		const idB = await changedDraftOf(drafts, b, '練習改');
		const { shell, hand } = handShell(a);
		fakeHost({ shell, settings: fakeSettings().settings });
		const { editor, session } = testEditor(null, { draftStore: drafts.store });
		const disconnect = editor.file.connect();
		await settle();
		expect(editor.file.draftAsk).not.toBeNull();
		hand(b);
		await settle();
		for (let i = 0; i < 4 && editor.file.draftAsk; i++) {
			editor.file.answerDraft('file');
			await settle();
		}
		expect(session.flow?.name).toBe('練習');
		session.change(flowOf(renameFlow(session.flow!, '練習三')));
		editor.file.pageHidden();
		await settle();
		const r = readFlowFile(drafts.all.get(idB)!.bytes);
		expect(r.kind === 'ok' && r.flow.name).toBe('練習三');
		disconnect();
	});

	it('App 打開時正在回上次那支、還沒開好就交來一個檔：開交來的那個，上次那支不蓋過它', async () => {
		const drafts = fakeDraftStore();
		await drafts.store.save('n1', writeFlowFile(practice(), {}));
		const slow = later<void>();
		const store = { ...drafts.store, load: async (id: string) => (id === 'n1' && (await slow.promise), drafts.store.load(id)) };
		const { shell, hand } = handShell();
		fakeHost({ shell, settings: fakeSettings({ 'cheer-editor:lastFlow': 'n1' }).settings });
		const { editor, session } = testEditor(null, { draftStore: store });
		const disconnect = editor.file.connect();
		await settle();
		hand({ name: '全國賽.cheer', bytes: writeFlowFile(contest(), {}) });
		await settle();
		slow.resolve();
		await settle();
		// 回上次那支是救回草稿（還算沒存）：交來的檔照「開別支」先問
		expect(editor.file.askingToOpen).toBe(true);
		await editor.file.answer('discard');
		await settle();
		expect(session.flow?.name).toBe('全國賽');
		disconnect();
	});
});

describe('還在問「丟掉修改」時又交來一個檔（#384 審查）', () => {
	it('第一個檔還在問：第二個等它問完才問，第一個按取消後第二個照樣問、丟掉才開', async () => {
		const { shell, hand } = handShell();
		fakeHost({ shell });
		const { editor, session } = testEditor(null);
		const disconnect = editor.file.connect();
		await settle();
		editor.file.create(practice());
		session.change(flowOf(renameFlow(session.flow!, '練習二')));
		hand({ name: '全國賽.cheer', bytes: writeFlowFile(contest(), {}) });
		await settle();
		expect(editor.file.askingToOpen).toBe(true);
		hand({ name: '區賽.cheer', bytes: writeFlowFile(flowOf(createFlow({ name: '區賽', field: { strips: 9, layout: 'vertical' } })), {}) });
		await settle();
		await editor.file.answer('cancel');
		await settle();
		expect(session.flow?.name).toBe('練習二');
		expect(editor.file.askingToOpen).toBe(true);
		await editor.file.answer('discard');
		await settle();
		expect(session.flow?.name).toBe('區賽');
		disconnect();
	});
});

describe('交檔時還有沒存的東西（#384）', () => {
	it('欄位裡打了還沒送出的字：先送出、照「開別支」先問，不悄悄丟掉', async () => {
		const { shell, hand } = handShell();
		fakeHost({ shell });
		const pendingInput = fakePendingInput();
		const { editor, session } = testEditor(null, { pendingInput });
		const disconnect = editor.file.connect();
		await settle();
		await editor.file.open(new File([writeFlowFile(practice(), {}).slice()], '練習.cheer'));
		expect(session.unsaved).toBe(false);
		pendingInput.pending = true;
		pendingInput.onflush = () => session.change(flowOf(renameFlow(session.flow!, '練習二')));
		hand({ name: '全國賽.cheer', bytes: writeFlowFile(contest(), {}) });
		await settle();
		expect(editor.file.askingToOpen).toBe(true);
		expect(session.flow?.name).toBe('練習二');
		disconnect();
	});

	it('全上表改過格子還開著：跟切頁一樣先問，丟掉才開；按取消不開', async () => {
		const { shell, hand } = handShell();
		fakeHost({ shell });
		const { editor, session } = testEditor(null);
		const disconnect = editor.file.connect();
		await settle();
		await editor.file.open(new File([writeFlowFile(practice(), {}).slice()], '練習.cheer'));
		const asked: (() => void)[] = [];
		session.practiceLeave = (go) => void asked.push(go);
		const file = { name: '全國賽.cheer', bytes: writeFlowFile(contest(), {}) };
		hand(file);
		await settle();
		expect(asked).toHaveLength(1);
		expect(session.flow?.name).toBe('練習');
		// 按取消（不叫 go）：不開；再交一次、這次丟掉格子：才開
		hand(file);
		await settle();
		asked[1]();
		await settle();
		expect(session.flow?.name).toBe('全國賽');
		disconnect();
	});

	it('雲端流程：交來的檔還在解碼時又改了一步（還沒送到）：不換掉，沒送到的步不丟', async () => {
		const decoding = later<void>();
		const { shell, hand } = handShell();
		fakeHost({ shell });
		const s = await cloudEditor(
			{},
			{
				decode: async () => {
					await decoding.promise;
					throw new Error('cannot decode');
				}
			}
		);
		const disconnect = s.editor.file.connect();
		await settle();
		const name = s.session.flow!.name;
		hand({ name: '練習用.cheer', bytes: writeFlowFile(audioFlow(), { a1: new Uint8Array([7, 7]) }) });
		await settle();
		s.state.holdRoom = true;
		s.session.ask.send({ name: 'renameFlow', args: ['區賽'] });
		expect(s.editor.file.cloud!.unsent).toBe(1);
		decoding.resolve();
		await settle();
		expect(s.session.flow!.name).toBe('區賽');
		expect(s.session.flow!.name).not.toBe(name);
		expect(s.editor.file.cloud!.unsent).toBe(1);
		disconnect();
	});
});

describe('選檔畫面按取消（#384）', () => {
	it('答應丟掉修改後按取消：之後從「檔案」交來的檔照樣先問', async () => {
		const { shell, hand } = handShell();
		fakeHost({ shell });
		const { editor, session } = testEditor(null, { pickFlowFile: async () => null });
		const disconnect = editor.file.connect();
		await settle();
		editor.file.create(practice());
		session.change(flowOf(renameFlow(session.flow!, '練習二')));
		let picking: Promise<void> | undefined;
		expect(editor.file.mayChoose(() => (picking = editor.file.pick()))).toBe(false);
		await editor.file.answer('discard');
		await picking;
		expect(session.flow?.name).toBe('練習二');
		hand({ name: '全國賽.cheer', bytes: writeFlowFile(contest(), {}) });
		await settle();
		expect(editor.file.askingToOpen).toBe(true);
		expect(session.flow?.name).toBe('練習二');
		disconnect();
	});
});

describe('選檔畫面還開著時從「檔案」交來檔（#384 審查）', () => {
	it('答應丟掉修改、選檔畫面還沒回來就交來一個檔：交來的檔照樣先問，不拿走選檔那次的答應', async () => {
		const { shell, hand } = handShell();
		fakeHost({ shell });
		const picker = later<null>();
		const { editor, session } = testEditor(null, { pickFlowFile: () => picker.promise });
		const disconnect = editor.file.connect();
		await settle();
		editor.file.create(practice());
		session.change(flowOf(renameFlow(session.flow!, '練習二')));
		let picking: Promise<void> | undefined;
		expect(editor.file.mayChoose(() => (picking = editor.file.pick()))).toBe(false);
		await editor.file.answer('discard');
		hand({ name: '全國賽.cheer', bytes: writeFlowFile(contest(), {}) });
		await settle();
		expect(editor.file.askingToOpen).toBe(true);
		expect(session.flow?.name).toBe('練習二');
		picker.resolve(null);
		await picking;
		disconnect();
	});
});

describe('選檔畫面選了打不開的檔（#384）', () => {
	it('答應丟掉修改後選了不是流程檔的：之後從「檔案」交來的檔照樣先問', async () => {
		const { shell, hand } = handShell();
		fakeHost({ shell });
		const { editor, session } = testEditor(null, { pickFlowFile: async () => ({ file: new File(['hello'], '筆記.cheer'), saver: fakeSaver().saver }) });
		const disconnect = editor.file.connect();
		await settle();
		editor.file.create(practice());
		session.change(flowOf(renameFlow(session.flow!, '練習二')));
		let picking: Promise<void> | undefined;
		expect(editor.file.mayChoose(() => (picking = editor.file.pick()))).toBe(false);
		await editor.file.answer('discard');
		await picking;
		expect(session.flow?.name).toBe('練習二');
		hand({ name: '全國賽.cheer', bytes: writeFlowFile(contest(), {}) });
		await settle();
		expect(editor.file.askingToOpen).toBe(true);
		disconnect();
	});
});

describe('殼讀不到交來的檔（#384）', () => {
	it('點流程檔打開 App、殼讀不到（例：iCloud 還沒下載又沒網路）：說打不開，不悄悄開上次那支', async () => {
		const drafts = fakeDraftStore();
		await drafts.store.save('n1', writeFlowFile(practice(), {}));
		const { shell } = handShell({ name: '全國賽.cheer', bytes: new Uint8Array() }, { broken: true });
		fakeHost({ shell, settings: fakeSettings({ 'cheer-editor:lastFlow': 'n1' }).settings });
		const { editor, session } = testEditor(null, { draftStore: drafts.store });
		const disconnect = editor.file.connect();
		await settle();
		expect(session.flow).toBeNull();
		expect(editor.file.openError).not.toBe('');
		disconnect();
	});

	it('App 開著時殼讀不到：說打不開，原本那支不動', async () => {
		const { shell, hand } = handShell(null, { broken: true });
		fakeHost({ shell });
		const { editor, session } = testEditor(null);
		const disconnect = editor.file.connect();
		await settle();
		await editor.file.open(new File([writeFlowFile(practice(), {}).slice()], '練習.cheer'));
		session.notice = '';
		hand({ name: '全國賽.cheer', bytes: new Uint8Array() });
		await settle();
		expect(session.flow?.name).toBe('練習');
		expect(session.notice).not.toBe('');
		disconnect();
	});
});

describe('電腦上救回草稿後存檔（#385 不改網頁版）', () => {
	it('Chrome、Edge 選檔打開、選「救回修改」：存檔照舊問存到哪，不蓋回原檔', async () => {
		const drafts = fakeDraftStore();
		const file = { name: '全國賽.zip', bytes: writeFlowFile(contest(), {}) };
		await changedDraftOf(drafts, file, '全國賽改');
		const picked = fakeSaver();
		const fresh = fakeSaver();
		const { editor } = testEditor(null, {
			draftStore: drafts.store,
			pickFlowFile: async () => ({ file: new File([file.bytes.slice()], file.name), saver: picked.saver }),
			createSaver: () => fresh.saver
		});
		const disconnect = editor.file.connect();
		await settle();
		const picking = editor.file.pick();
		await settle();
		editor.file.answerDraft('draft');
		await picking;
		await editor.file.save();
		expect(picked.saves).toHaveLength(0);
		expect(fresh.saves).toHaveLength(1);
		disconnect();
	});
});
