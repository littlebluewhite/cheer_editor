// 流程來源和能做什麼（#322）：編輯器 module 在 Node 打開每種來源（本機流程、雲端流程的四種權限、分享連結、離線副本），
// 看 editor.file.can(登入了沒) 每一項的答案和原因。窄、寬兩個選單、上方列都照這組答案畫。
import { describe, expect, it } from 'vitest';
import type { Role } from '#lib/api-types/Role.js';
import type { Editor } from '#lib/editor.svelte.js';
import type { Can } from '#lib/flow-source.js';
import { cloudEditor, fakeOfflineStore, fakeServer, flush, testEditor } from '#lib/test-fakes.js';
import { libSample } from '#lib/test-flows.js';

const LIN = 'lin@example.com';
const WANG = 'wang@example.com';

const yes = (why: Can['why']): Can => ({ ok: true, why });
const no = (why: Can['why']): Can => ({ ok: false, why });

/** 本機流程（登入了）：都照本機的；沒改過，存檔狀態沒有字。 */
const LOCAL = {
	openFile: yes('local'),
	newFlow: yes('local'),
	save: yes('local'),
	upload: yes('local'),
	download: no('local'),
	share: no('local'),
	practice: yes('local'),
	record: yes('local'),
	here: yes('local'),
	edit: yes('local'),
	status: null
};

/** 雲端流程的擁有者（連著、都存好了）。 */
const OWNER = {
	openFile: no('cloud'),
	newFlow: no('cloud'),
	save: no('cloud'),
	upload: no('cloud'),
	download: yes('owner_or_editor'),
	share: yes('cloud'),
	practice: yes('cloud'),
	record: yes('cloud'),
	here: no('cloud'),
	edit: yes('owner_or_editor'),
	status: 'saved'
};

/** 雲端流程照這個權限打開（林教練是 role；擁有者時是他自己的）。 */
async function cloudAs(role: Role) {
	return role === 'owner' ? cloudEditor() : cloudEditor({ owner: WANG, people: { [LIN]: role } });
}

/** 分享連結（沒登入、沒權限）打開的。 */
async function linkOnly() {
	const fake = fakeServer({
		users: [],
		signedIn: null,
		flows: [{ id: 'c1', owner: WANG, flow: libSample(), updatedAt: new Date(2026, 10, 7).toISOString(), link: 'share-1' }]
	});
	const t = testEditor(null, { server: fake.server });
	await t.editor.file.openLink('share-1');
	await flush();
	return t;
}

/** 林教練（role）打開過、斷網後從離線副本打開的。 */
async function offlineCopy(role: Role) {
	const offline = fakeOfflineStore();
	const s = await (role === 'owner'
		? cloudEditor({}, { offline: offline.store })
		: cloudEditor({ owner: WANG, people: { [LIN]: role } }, { offline: offline.store }));
	s.editor.file.leaveToHome();
	await flush();
	s.network('offline');
	await s.editor.file.openCloud('c1');
	await flush();
	return s;
}

const can = (editor: Editor, signedIn = true) => ({ ...editor.file.can(signedIn) });

describe('流程來源', () => {
	it('本機流程、在首頁：來源是本機', async () => {
		expect(testEditor(libSample()).editor.file.source).toEqual({ kind: 'local' });
		expect(testEditor(null).editor.file.source).toEqual({ kind: 'local' });
	});

	it('雲端流程：帶 id 和一步一步存的那個', async () => {
		const s = await cloudEditor();
		expect(s.editor.file.source).toMatchObject({ kind: 'cloud', id: 'c1' });
		expect(s.editor.file.source).toHaveProperty('steps', s.editor.file.cloud);
	});

	it('分享連結：只有 id', async () => {
		expect((await linkOnly()).editor.file.source).toEqual({ kind: 'link', id: 'c1' });
	});

	it('離線副本：帶那份是什麼時候的樣子', async () => {
		const s = await offlineCopy('owner');
		expect(s.editor.file.source).toMatchObject({ kind: 'offline', id: 'c1', steps: s.editor.file.cloud });
		expect(s.editor.file.source).toHaveProperty('savedAt', expect.any(Number));
	});
});

describe('能做什麼：每種來源 × 每種權限', () => {
	it('本機流程（登入了）', () => {
		expect(can(testEditor(libSample()).editor)).toEqual(LOCAL);
	});

	it('本機流程（沒登入）：沒有傳上雲端、不寫「這台」', () => {
		expect(can(testEditor(libSample()).editor, false)).toEqual({ ...LOCAL, upload: no('signed_out'), here: no('signed_out') });
	});

	it.each([
		['owner', OWNER],
		['editor', OWNER],
		['recorder', { ...OWNER, download: no('recorder_or_viewer'), edit: no('recorder_or_viewer') }],
		['viewer', { ...OWNER, download: no('recorder_or_viewer'), edit: no('recorder_or_viewer'), record: no('practice_rights') }]
	] as const)('雲端流程的 %s', async (role, expected) => {
		const s = await cloudAs(role);
		expect(can(s.editor)).toEqual(expected);
		// 能不能記照練習的權限
		expect(s.session.practice.cannotRecord === '').toBe(expected.record.ok);
	});

	it('分享連結（沒有權限）：檢視模式，什麼都沒有；存檔狀態照本機的（沒改過沒有字）', async () => {
		const t = await linkOnly();
		const all = no('link_only');
		expect(can(t.editor, false)).toEqual({
			openFile: all,
			newFlow: all,
			save: all,
			upload: all,
			download: all,
			share: all,
			practice: all,
			record: all,
			here: all,
			edit: all,
			status: null
		});
	});

	it('分享連結（已經有權限）：照自己的權限打開，跟從首頁點的一樣', async () => {
		const fake = fakeServer({
			users: [{ email: LIN, name: '林教練', isAdmin: false, password: '我們這一隊今年一定會贏 go go' }],
			signedIn: LIN,
			flows: [{ id: 'c1', owner: WANG, flow: libSample(), updatedAt: new Date(2026, 10, 7).toISOString(), link: 'share-1', people: { [LIN]: 'recorder' } }]
		});
		const t = testEditor(null, { server: fake.server });
		await t.editor.file.openLink('share-1');
		await flush();
		expect(t.editor.file.source.kind).toBe('cloud');
		expect(can(t.editor)).toEqual({ ...OWNER, download: no('recorder_or_viewer'), edit: no('recorder_or_viewer') });
	});

	it.each([
		['owner', yes('owner_or_editor'), yes('offline_copy')],
		['editor', yes('owner_or_editor'), yes('offline_copy')],
		['recorder', no('recorder_or_viewer'), yes('offline_copy')],
		['viewer', no('recorder_or_viewer'), no('practice_rights')]
	] as const)('離線副本的 %s：斷線不能改，下載、分享照雲端流程；存檔狀態寫離線', async (role, download, record) => {
		const s = await offlineCopy(role);
		const not = no('offline_copy');
		expect(can(s.editor)).toEqual({
			openFile: not,
			newFlow: not,
			save: not,
			upload: not,
			download,
			share: yes('offline_copy'),
			practice: yes('offline_copy'),
			record,
			here: not,
			edit: no('disconnected'),
			status: 'offline_copy'
		});
	});
});

describe('能做什麼跟著變', () => {
	it('本機流程改了：存檔狀態寫未存', () => {
		const t = testEditor(libSample());
		t.session.ask.send({ name: 'renameFlow', args: ['全國賽'] });
		expect(t.editor.file.can(true).status).toBe('unsaved');
	});

	it('雲端流程送一步：存中，伺服器收了已存', async () => {
		const s = await cloudEditor();
		s.state.holdRoom = true;
		s.session.ask.send({ name: 'renameFlow', args: ['全國賽'] });
		expect(s.editor.file.can(true).status).toBe('saving');
		s.releaseRoom();
		await flush();
		expect(s.editor.file.can(true).status).toBe('saved');
	});

	it('雲端流程斷線：不能改、寫斷線；下載、分享照樣有', async () => {
		const s = await cloudEditor();
		s.disconnect();
		await flush();
		expect(can(s.editor)).toEqual({ ...OWNER, edit: no('disconnected'), status: 'disconnected' });
	});

	it('雲端流程有新版：不能改、不能下載、存檔狀態沒有字；照樣能記（#368）', async () => {
		const s = await cloudEditor();
		s.disconnect();
		await flush();
		s.state.fingerprint = 'newer';
		s.reconnect();
		await flush();
		expect(can(s.editor)).toEqual({ ...OWNER, edit: no('new_version'), download: no('new_version'), status: null });
	});

	it('開著時權限改了：編輯者 → 記錄者 → 檢視者', async () => {
		const s = await cloudAs('editor');
		s.changeRole('c1', LIN, 'recorder');
		await flush();
		expect(can(s.editor)).toMatchObject({ download: no('recorder_or_viewer'), edit: no('recorder_or_viewer'), record: yes('cloud') });
		s.changeRole('c1', LIN, 'viewer');
		await flush();
		expect(can(s.editor)).toMatchObject({ record: no('practice_rights') });
	});

	it('離線副本連回來：換成雲端流程（最新的）', async () => {
		const s = await offlineCopy('owner');
		s.network('online');
		await flush();
		await flush();
		expect(s.editor.file.source.kind).toBe('cloud');
		expect(can(s.editor)).toEqual(OWNER);
	});

	it('回首頁：換回本機', async () => {
		const s = await cloudEditor();
		s.editor.file.leaveToHome();
		await flush();
		expect(s.editor.file.source).toEqual({ kind: 'local' });
	});
});
