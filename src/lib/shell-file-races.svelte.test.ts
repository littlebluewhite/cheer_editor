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
		const opening = editor.file.open(new File([writeFlowFile(practice(), {})], '練習.cheer'));
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
