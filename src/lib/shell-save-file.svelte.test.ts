// App 裡存檔蓋回原本的檔、「傳給別人」、雲端流程下載成 .cheer（#385）。說的話：bridge-scenarios/current/saveFile.json。
// 情境裡存的位元組是固定的（0x01 0x02）；整支流程存檔（zip 帶時間，每次不一樣）用這裡的假殼 filesShell 測。
import { describe, expect, it } from 'vitest';
import { appShell } from '#lib/app-shell.js';
import { scenarioShell } from '#lib/scenario-shell.js';
import { createFlow, renameFlow, writeFlowFile } from '#lib/core';
import type { Shell } from '#lib/host.js';
import { takeOpenedFile } from '#lib/shell-open-file.js';
import { SAVE_FILE_FEATURE, shareFlowFile, shellAskWhere, shellSaver } from '#lib/shell-save-file.js';
import { cloudEditor, fakeDraftStore, fakeHost, fakeSettings, flush, testEditor } from '#lib/test-fakes.js';
import { flowOf } from '#lib/test-flows.js';

const bytes = new Uint8Array([1, 2]);
const contest = () => flowOf(createFlow({ name: '全國賽', field: { strips: 9, layout: 'vertical' } }));

describe('照情境', () => {
	it('從「檔案」打開的：存檔交回殼給的書籤，蓋回原本那個檔', async () => {
		const fake = scenarioShell('saveFile.json', '從「檔案」打開的流程檔：存檔蓋回原本那個檔，不問存到哪');
		const shell = appShell(fake.bridge);
		const handed = await takeOpenedFile(shell);
		const saver = shellSaver(shell, handed!.target);
		expect(await saver.save(bytes, '全國賽.zip')).toBe('saved');
		expect(saver.fileName).toBe('全國賽.cheer');
		fake.done();
	});

	it('新的流程：第一次問存到哪、存成 .cheer；第二次交回那個書籤', async () => {
		const fake = scenarioShell('saveFile.json', '新的流程第一次存檔：問存到哪，存成 .cheer；第二次不問，蓋回那裡');
		const saver = shellSaver(appShell(fake.bridge), null);
		expect(await saver.save(bytes, '新流程.zip')).toBe('saved');
		expect(saver.remembered).toBe('5paw5rWB56iLLmNoZWVy');
		expect(await saver.save(bytes, '新流程.zip')).toBe('saved');
		fake.done();
	});

	it('存到哪按取消：沒存', async () => {
		const fake = scenarioShell('saveFile.json', '新的流程第一次存檔，存到哪按取消：回 null');
		const saver = shellSaver(appShell(fake.bridge), null);
		expect(await saver.save(bytes, '新流程.zip')).toBe('cancelled');
		expect(saver.remembered).toBeUndefined();
		fake.done();
	});

	it('App 關掉再開：用記著的書籤建的存檔薄層蓋回同一個檔', async () => {
		const fake = scenarioShell('saveFile.json', 'App 關掉再開：網頁交回記著的書籤，蓋回同一個檔');
		expect(await shellSaver(appShell(fake.bridge), '5YWo5ZyL6LO9LmNoZWVy').save(bytes, '全國賽.zip')).toBe('saved');
		fake.done();
	});

	it('傳給別人：送 .zip，說按的那顆鈕在哪', async () => {
		const fake = scenarioShell('saveFile.json', '傳給別人：殼叫出分享選單送 .zip');
		expect(await shareFlowFile(appShell(fake.bridge), bytes, '全國賽.zip', { x: 10, y: 20, width: 80, height: 32 })).toBe(true);
		fake.done();
	});
});

/** 殼這邊的「檔案」：檔名 → 位元組。書籤就是 'mark:' 加檔名。 */
function filesShell(init: { handed?: string; settings?: boolean } = {}) {
	const files = new Map<string, Uint8Array>();
	const said: { name: string; body: Record<string, unknown> }[] = [];
	let held = init.handed ?? null;
	const handedBytes = writeFlowFile(contest(), {});
	/** 問存到哪時存成這個名字；null 是按取消。 */
	let saveAs: string | null = null;
	const features = [SAVE_FILE_FEATURE, 'openFile', ...(init.settings === false ? [] : ['settings'])];
	const shell: Shell = {
		inApp: true,
		can: (feature) => features.includes(feature),
		async send(name, body) {
			const b = (body ?? {}) as Record<string, unknown>;
			said.push({ name, body: b });
			if (name === 'takeOpenedFile') {
				const r = held && { name: held, bytes: handedBytes.toBase64(), target: `mark:${held}` };
				held = null;
				return r;
			}
			if (name === 'saveFlowFile') {
				const target = b.target as string | null;
				const at = target?.startsWith('mark:') ? target.slice(5) : saveAs;
				if (!at) return null;
				files.set(at, Uint8Array.fromBase64(b.bytes as string));
				return { target: `mark:${at}`, name: at };
			}
			throw new Error('unknown');
		},
		on: () => () => {}
	};
	return {
		shell,
		files,
		said,
		handedBytes,
		saves: () => said.filter((s) => s.name === 'saveFlowFile').map((s) => ({ target: s.body.target, name: s.body.name })),
		askAs(name: string | null) {
			saveAs = name;
		}
	};
}

describe('編輯器裡存檔', () => {
	it('從「檔案」打開、改一下、存檔：蓋回原本那個檔，不問存到哪', async () => {
		const fake = filesShell({ handed: '全國賽.cheer' });
		fakeHost({ shell: fake.shell, settings: fakeSettings().settings });
		const { editor, session } = testEditor(null, { createSaver: (r) => shellSaver(fake.shell, r ?? null) });
		const disconnect = editor.file.connect();
		await flush();
		await flush();
		session.change(flowOf(renameFlow(session.flow!, '全國賽決賽')));
		await editor.file.save();
		expect(fake.saves()).toEqual([{ target: 'mark:全國賽.cheer', name: '全國賽決賽.cheer' }]);
		expect([...fake.files.keys()]).toEqual(['全國賽.cheer']);
		expect(session.notice).toContain('全國賽.cheer');
		expect(session.unsaved).toBe(false);
		disconnect();
	});

	it('新的流程：第一次問存到哪；改了再存、App 關掉再開再存，都蓋回同一個檔', async () => {
		const fake = filesShell();
		const { settings } = fakeSettings();
		fakeHost({ shell: fake.shell, settings });
		const drafts = fakeDraftStore();
		const adapters = { createSaver: (r?: string) => shellSaver(fake.shell, r ?? null), draftStore: drafts.store };
		const first = testEditor(null, adapters);
		let disconnect = first.editor.file.connect();
		await flush();
		first.editor.file.create(contest());
		fake.askAs('全國賽.cheer');
		await first.editor.file.save();
		first.session.change(flowOf(renameFlow(first.session.flow!, '全國賽二')));
		await first.editor.file.save();
		expect(fake.saves()).toEqual([
			{ target: null, name: '全國賽.cheer' },
			{ target: 'mark:全國賽.cheer', name: '全國賽二.cheer' }
		]);
		// 改了還沒存就關掉 App：草稿存起來，記著上次那支
		first.session.change(flowOf(renameFlow(first.session.flow!, '全國賽三')));
		first.editor.file.pageHidden();
		await flush();
		disconnect();
		fake.askAs(null);
		const again = testEditor(null, adapters);
		disconnect = again.editor.file.connect();
		await flush();
		await flush();
		expect(again.session.flow?.name).toBe('全國賽三');
		await again.editor.file.save();
		expect(fake.saves().at(-1)).toEqual({ target: 'mark:全國賽.cheer', name: '全國賽三.cheer' });
		expect([...fake.files.keys()]).toEqual(['全國賽.cheer']);
		disconnect();
	});

	it('同一個檔的副本（LINE 傳來的，位元組一樣）：不沿用原檔記的存到哪，App 關掉再開存檔也問', async () => {
		const fake = filesShell({ handed: '全國賽.cheer' });
		const { settings } = fakeSettings();
		fakeHost({ shell: fake.shell, settings });
		const drafts = fakeDraftStore();
		const adapters = { createSaver: (r?: string) => shellSaver(fake.shell, r ?? null), draftStore: drafts.store };
		const first = testEditor(null, adapters);
		let disconnect = first.editor.file.connect();
		await flush();
		await flush();
		disconnect();
		// 同一個檔的副本（沒有書籤）
		const copy = fake.handedBytes;
		const second = testEditor(null, adapters);
		disconnect = second.editor.file.connect();
		await flush();
		await second.editor.file.open(new File([copy.slice()], '全國賽.zip'));
		second.session.change(flowOf(renameFlow(second.session.flow!, '全國賽二')));
		second.editor.file.pageHidden();
		await flush();
		disconnect();
		const again = testEditor(null, adapters);
		disconnect = again.editor.file.connect();
		await flush();
		await flush();
		expect(again.session.flow?.name).toBe('全國賽二');
		await again.editor.file.save();
		expect(fake.saves()).toEqual([{ target: null, name: '全國賽二.cheer' }]);
		disconnect();
	});

	it('存到哪按取消：還沒存，下次存檔再問', async () => {
		const fake = filesShell();
		fakeHost({ shell: fake.shell, settings: fakeSettings().settings });
		const { editor, session } = testEditor(null, { createSaver: (r) => shellSaver(fake.shell, r ?? null) });
		const disconnect = editor.file.connect();
		await flush();
		editor.file.create(contest());
		await editor.file.save();
		fake.askAs('全國賽.cheer');
		await editor.file.save();
		expect(fake.saves().map((s) => s.target)).toEqual([null, null]);
		expect(session.unsaved).toBe(false);
		disconnect();
	});

	it('丟掉最近的流程：記的存到哪也丟掉', async () => {
		const fake = filesShell();
		const { settings, saved } = fakeSettings();
		fakeHost({ shell: fake.shell, settings });
		const drafts = fakeDraftStore();
		const { editor } = testEditor(null, { createSaver: (r) => shellSaver(fake.shell, r ?? null), draftStore: drafts.store });
		const disconnect = editor.file.connect();
		await flush();
		editor.file.create(contest());
		fake.askAs('全國賽.cheer');
		await editor.file.save();
		expect([...saved.values()]).toContain('mark:全國賽.cheer');
		// 存好的檔也留一份草稿（最近的流程）
		editor.file.pageHidden();
		await flush();
		expect(drafts.all.size).toBe(1);
		await editor.file.leaveToHome();
		for (const id of [...drafts.all.keys()]) await editor.file.discardRecent(id);
		expect([...saved.values()]).not.toContain('mark:全國賽.cheer');
		disconnect();
	});
});

describe('傳給別人', () => {
	it('App 裡：送跟存檔一樣的流程檔，叫「流程名.zip」；不算存過', async () => {
		const sent: { name: string; bytes: string }[] = [];
		const shell: Shell = {
			inApp: true,
			can: (f) => f === SAVE_FILE_FEATURE,
			async send(name, body) {
				if (name !== 'shareFlowFile') throw new Error('unknown');
				sent.push(body as { name: string; bytes: string });
				return true;
			},
			on: () => () => {}
		};
		fakeHost({ shell });
		const { editor, session } = testEditor(contest());
		session.change(flowOf(renameFlow(session.flow!, '全國賽決賽')));
		expect(editor.file.canSend).toBe(true);
		await editor.file.sendToOthers();
		expect(sent.map((s) => s.name)).toEqual(['全國賽決賽.zip']);
		expect(session.notice).toContain('全國賽決賽.zip');
		expect(session.unsaved).toBe(true);
	});

	it('網頁版沒有傳給別人', () => {
		const { editor } = testEditor(contest());
		expect(editor.file.canSend).toBe(false);
	});
});

describe('雲端流程下載成流程檔', () => {
	it('App 裡每次都問存到哪、存成 .cheer，不記', async () => {
		const fake = filesShell();
		fakeHost({ shell: fake.shell });
		fake.askAs('測試.cheer');
		const { editor, session } = await cloudEditor({}, { download: shellAskWhere(fake.shell) });
		await editor.file.download();
		await editor.file.download();
		expect(fake.saves()).toEqual([
			{ target: null, name: '測試.cheer' },
			{ target: null, name: '測試.cheer' }
		]);
		expect(session.notice).toContain('測試.cheer');
	});

	it('存檔畫面裡改了名字（codex 審查）：提示寫存成的名字，不寫建議的', async () => {
		const fake = filesShell();
		fakeHost({ shell: fake.shell });
		fake.askAs('改名.cheer');
		const { editor, session } = await cloudEditor({}, { download: shellAskWhere(fake.shell) });
		await editor.file.download();
		expect(fake.saves()).toEqual([{ target: null, name: '測試.cheer' }]);
		expect(session.notice).toContain('改名.cheer');
		expect(session.notice).not.toContain('測試.cheer');
	});
});
