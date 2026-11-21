// 練習的權限（#318）：能不能記、誰記的、共用紀錄、只看自己的、沒存進去的、還沒傳的。
// 編輯器 module 在 Node 打開：本機流程、雲端流程（擁有者、編輯者、記錄者、檢視者）、分享連結、離線副本。
import { describe, expect, it } from 'vitest';
import type { StoredAttempt } from '#lib/core';
import type { EditorSession } from '#lib/editor-session.svelte.js';
import { localDate } from '#lib/local-date.js';
import { ALL_ALLOWED as SHARED } from '#lib/practice-rights.js';
import type { UnsentRecords } from '#lib/offline-store.js';
import { cloudEditor, fakeOfflineStore, fakeServer, flush, testEditor } from '#lib/test-fakes.js';
import { libSample } from '#lib/test-flows.js';

const LIN = 'lin@example.com';
const WANG = 'wang@example.com';

/** 畫面從這裡拿的練習的權限（還沒傳的照 id 排）。 */
function rights(session: EditorSession) {
	const p = session.practice;
	return {
		cannotRecord: p.cannotRecord,
		recordedBy: p.recordedBy,
		sharedRecords: p.sharedRecords,
		ownRecordsOnly: p.ownRecordsOnly,
		droppedRecords: p.droppedRecords,
		unsentRecords: [...p.unsentRecords].sort()
	};
}

const ALL_ALLOWED = { cannotRecord: '', recordedBy: {}, sharedRecords: false, ownRecordsOnly: false, droppedRecords: [], unsentRecords: [] };

/** 第 1 組上法的一次（by 記的；沒有 by 是從流程檔傳上來的）。 */
const attempt = (id: string, by?: string): StoredAttempt & { by?: string } => ({
	actionId: 'x1',
	attempt: { id, date: localDate(), who: 'g1', practice: 'drill', whole: true, marks: { p1: '✓' } },
	...(by && { by })
});

/** 林教練的、王教練的、從流程檔來的各一次。 */
const records = () => [attempt('tlin000000001', LIN), attempt('twang00000001', WANG), attempt('tfile00000001')];

/** 用「記」的問題記一次：回被擋的原因（空字串是記了）。 */
async function record(session: EditorSession): Promise<string> {
	const ask = session.recordAsk();
	ask.send({ name: 'recordAttempt', args: ['x1', { date: localDate(), who: 'g1', practice: 'drill', whole: true, marks: { p1: '✓' } }] });
	await flush();
	return ask.error;
}

describe('練習的權限', () => {
	it('本機流程共用的那一個改不動（每個 session 都拿同一個；還沒傳的也是）', () => {
		expect(Object.isFrozen(SHARED)).toBe(true);
		expect(() => (SHARED.unsentRecords as Set<string>).add('t1')).toThrow();
		expect(SHARED.unsentRecords.size).toBe(0);
	});

	it('本機流程：都可以', async () => {
		const t = testEditor(libSample());
		expect(rights(t.session)).toEqual(ALL_ALLOWED);
		expect(await record(t.session)).toBe('');
	});

	it('雲端流程的擁有者：能記、共用紀錄、看得到別人記的名字（流程檔來的沒有名字），自己記的不列', async () => {
		const s = await cloudEditor({ records: records() });
		expect(rights(s.session)).toEqual({
			...ALL_ALLOWED,
			sharedRecords: true,
			recordedBy: { twang00000001: '王教練', tfile00000001: '' }
		});
		expect(await record(s.session)).toBe('');
		expect(s.state.flows[0].records).toHaveLength(4);
	});

	it.each([
		['editor', false],
		['recorder', true]
	] as const)('雲端流程的%s：能記；記錄者只能動自己記的', async (role, ownRecordsOnly) => {
		const s = await cloudEditor({ owner: WANG, people: { [LIN]: role }, records: records() });
		expect(rights(s.session)).toEqual({
			...ALL_ALLOWED,
			sharedRecords: true,
			ownRecordsOnly,
			recordedBy: { twang00000001: '王教練', tfile00000001: '' }
		});
		expect(await record(s.session)).toBe('');
	});

	it('雲端流程的檢視者：不能記（你只能看這支流程），看得到別人記的', async () => {
		const s = await cloudEditor({ owner: WANG, people: { [LIN]: 'viewer' }, records: records() });
		expect(rights(s.session)).toEqual({
			...ALL_ALLOWED,
			cannotRecord: '你只能看這支流程',
			sharedRecords: true,
			recordedBy: { twang00000001: '王教練', tfile00000001: '' }
		});
		expect(await record(s.session)).toBe('你只能看這支流程');
		expect(s.state.flows[0].records).toHaveLength(3);
	});

	it('開著時權限改了：跟著變（編輯者 → 記錄者 → 檢視者）', async () => {
		const s = await cloudEditor({ owner: WANG, people: { [LIN]: 'editor' } });
		s.changeRole('c1', LIN, 'recorder');
		await flush();
		expect(rights(s.session)).toMatchObject({ cannotRecord: '', ownRecordsOnly: true });
		s.changeRole('c1', LIN, 'viewer');
		await flush();
		expect(rights(s.session)).toMatchObject({ cannotRecord: '你只能看這支流程', ownRecordsOnly: false });
	});

	it('別人記的進來：記下名字', async () => {
		const s = await cloudEditor();
		s.recordAs('c1', WANG, [attempt('twang00000002')]);
		await flush();
		expect(rights(s.session).recordedBy).toEqual({ twang00000002: '王教練' });
	});

	it('回首頁：換回都可以', async () => {
		const s = await cloudEditor({ owner: WANG, people: { [LIN]: 'viewer' }, records: records() });
		s.editor.file.leaveToHome();
		await flush();
		expect(rights(s.session)).toEqual(ALL_ALLOWED);
	});

	it('分享連結（沒有權限）：跟本機流程一樣（練習頁不出現）', async () => {
		const fake = fakeServer({
			users: [],
			signedIn: null,
			flows: [{ id: 'c1', owner: WANG, flow: libSample(), updatedAt: new Date(2026, 10, 7).toISOString(), link: 'share-1', records: records() }]
		});
		const t = testEditor(null, { server: fake.server });
		await t.editor.file.openLink('share-1');
		await flush();
		expect(t.editor.file.source.kind).toBe('link');
		expect(rights(t.session)).toEqual(ALL_ALLOWED);
	});

	it('離線副本：斷網打開能記，記的是還沒傳的；這台存著沒存進去的照舊列出來', async () => {
		const offline = fakeOfflineStore();
		const s = await cloudEditor({ owner: WANG, people: { [LIN]: 'recorder' }, records: records() }, { offline: offline.store });
		s.editor.file.leaveToHome();
		await flush();
		const dropped = { id: 'tgone00000001', date: localDate(), action: '技巧·Lib', who: '第 1 組 小美', marks: '✓··', runThrough: false };
		const saved: UnsentRecords = { flowId: 'c1', flowName: '測試', records: [], amends: [], dropped: [dropped] };
		await offline.store.saveUnsent(saved);
		s.network('offline');
		await s.editor.file.openCloud('c1');
		await flush();
		expect(s.editor.file.source.kind).toBe('offline');
		expect(rights(s.session)).toEqual({
			...ALL_ALLOWED,
			sharedRecords: true,
			ownRecordsOnly: true,
			recordedBy: { twang00000001: '王教練', tfile00000001: '' },
			droppedRecords: [dropped]
		});

		expect(await record(s.session)).toBe('');
		expect(rights(s.session).unsentRecords).toEqual(s.editor.file.cloud!.unsentIds);
		expect(rights(s.session).unsentRecords).toHaveLength(1);
	});
});
