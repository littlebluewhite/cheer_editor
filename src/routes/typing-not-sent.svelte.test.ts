// 守門（A 群）：欄位裡打到一半的字，只有教練送出（Enter、離開欄位、存檔、關對話框）才進流程。
// 每個流程欄位都跑：停手 1 秒自動存草稿不送出（N01）；按 Esc 丟掉、欄位回到原本的字（N06）。
// 拆掉有焦點的欄位時照 Chrome 發 change，才測得到「被拆掉當成送出」。
import '#lib/test-chrome-removal.js';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { moveMembers, renameFlow } from '#lib/core';
import { editorPage, fakeDraftStore, flush } from '#lib/test-fakes.js';
import { flowOf, libSample } from '#lib/test-flows.js';
import Page from './+page.svelte';

// jsdom 沒有 scrollIntoView。
Element.prototype.scrollIntoView = () => {};

afterEach(() => {
	vi.useRealTimers();
	cleanup();
});

/** 一個流程欄位：怎麼找到它（打開要按的東西先按好）、打什麼字。 */
interface FlowField {
	name: string;
	open: () => Promise<HTMLInputElement | HTMLTextAreaElement>;
	typed: string;
	/** 在對話框裡：Esc 是關對話框、照樣送出（#93），不在 Esc 那張表。 */
	inDialog?: boolean;
}

const pickLib = () => fireEvent.click(document.querySelector('[data-lane="m1"] [data-action-id="x1"]')!);
const membersTab = () => fireEvent.click(screen.getByRole('tab', { name: /^隊員/ }));

const FIELDS: FlowField[] = [
	{ name: '動作名稱', typed: '高 Lib', open: async () => (await pickLib(), screen.getByLabelText('名稱')) },
	{ name: '動作開始', typed: '2-1', open: async () => (await pickLib(), screen.getByLabelText('開始')) },
	{ name: '動作長度', typed: '16', open: async () => (await pickLib(), screen.getByLabelText('長度')) },
	{ name: '動作備註', typed: '慢慢來', open: async () => (await pickLib(), screen.getByLabelText('備註')) },
	{ name: '隊員名字', typed: '阿美', open: async () => (await membersTab(), screen.getByLabelText('第 1 位隊員的名字')) },
	{
		name: '隊員號碼',
		typed: '2',
		open: async () => {
			await membersTab();
			await fireEvent.click(screen.getByRole('button', { name: '改第 1 位隊員的號碼' }));
			return screen.getByLabelText('第 1 位隊員的號碼');
		}
	},
	{
		name: '站位名稱',
		typed: '開場',
		open: async () => (await fireEvent.click(screen.getByRole('button', { name: '站位 2' })), screen.getByLabelText('站位名稱'))
	},
	{
		name: '流程名字（流程設定）',
		typed: '臺灣盃',
		inDialog: true,
		open: async () => {
			await fireEvent.click(screen.getByRole('button', { name: '流程設定' }));
			return within(screen.getByRole('dialog', { name: '流程設定' })).getByLabelText('流程名字');
		}
	}
];

/** 開著 Lib 範例（兩張站位），草稿讀過了。 */
async function opened() {
	const page = editorPage(flowOf(moveMembers(libSample(), 8, { m1: [3, 3] })), { draftStore: fakeDraftStore().store });
	render(Page, page.props);
	await flush();
	return page;
}

async function typeInto(field: FlowField) {
	const el = await field.open();
	el.focus();
	const original = el.value;
	await fireEvent.input(el, { target: { value: field.typed } });
	return { el, original };
}

describe('停手 1 秒自動存草稿：欄位裡打到一半的字不送出（N01）', () => {
	it.each(FIELDS)('$name：流程沒變、沒有多一步復原，字還在欄位裡', async (field) => {
		const { session } = await opened();
		vi.useFakeTimers();
		// 剛送出別的改動：1 秒後要存草稿，這 1 秒裡去打這一格
		session.change(flowOf(renameFlow(session.flow!, '縣賽')));
		const { el } = await typeInto(field);
		const before = session.flow;
		const couldUndo = session.canUndo;
		await vi.advanceTimersByTimeAsync(1100);
		expect(session.flow).toBe(before);
		expect(session.canUndo).toBe(couldUndo);
		expect(el.value).toBe(field.typed);
	});
});

describe('按 Esc：丟掉打到一半的字（N06）', () => {
	it.each(FIELDS.filter((f) => !f.inDialog))('$name：流程沒變，欄位還在的話回到原本的字', async (field) => {
		const { session } = await opened();
		const { el, original } = await typeInto(field);
		const before = session.flow;
		await fireEvent.keyDown(el, { key: 'Escape' });
		await flush();
		expect(session.flow).toBe(before);
		if (el.isConnected) expect(el.value).toBe(original);
	});
});
